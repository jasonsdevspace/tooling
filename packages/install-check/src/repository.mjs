/**
 * Every install in a repository that runs install scripts, in its workflows, its composite actions
 * and its Dockerfiles, from the files git tracks and the new ones it would add.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

import { dockerRunsOf, installs, npmCommandsIn, runsOf, skipsScripts } from './commands.mjs';

/**
 * Whether a path names a Dockerfile: `Dockerfile`, `Dockerfile.` followed by a name, or a name
 * ending in `.Dockerfile`. The prose check holds the same rule, and a test holds the two alike.
 *
 * @param {string} path
 * @returns {boolean}
 */
export function isDockerfile(path) {
    return /^Dockerfile(\..+)?$|\.Dockerfile$/.test(basename(path));
}

/**
 * The top of the git repository a folder sits in.
 *
 * @param {string} folder
 * @returns {string}
 */
export function repositoryRoot(folder) {
    try {
        return execFileSync('git', ['rev-parse', '--show-toplevel'], {
            cwd: folder,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();
    } catch {
        throw new Error(`${folder} is not inside a git repository`);
    }
}

/**
 * Whether a path is a workflow or a composite action, whose steps run as a workflow's do.
 *
 * @param {string} path
 */
const isWorkflow = (path) =>
    /^\.github\/workflows\/[^/]+\.ya?ml$/.test(path) ||
    /^\.github\/actions\/.+\/action\.ya?ml$/.test(path);

/**
 * Every install in the repository at `root` that runs install scripts, as `path:line  install runs
 * scripts` with the command beneath, read from each workflow, composite action and Dockerfile.
 *
 * @param {string} root
 * @returns {string[]}
 */
export function installProblems(root) {
    const listed = [
        ...new Set(
            execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
                cwd: root,
                encoding: 'utf8',
                maxBuffer: 64 * 1024 * 1024,
            }).split('\0')
        ),
    ].filter(
        (path) =>
            (isWorkflow(path) || isDockerfile(path)) &&
            statSync(join(root, path), { throwIfNoEntry: false })?.isFile()
    );
    return listed.flatMap((path) => {
        const text = readFileSync(join(root, path), 'utf8');
        const runs = isWorkflow(path) ? runsOf(text) : dockerRunsOf(text);
        return runs.flatMap(({ run, line }) =>
            npmCommandsIn(run)
                .filter((command) => installs(command) && !skipsScripts(command))
                .map(({ text: command }) => `${path}:${line}  install runs scripts\n    ${command}`)
        );
    });
}
