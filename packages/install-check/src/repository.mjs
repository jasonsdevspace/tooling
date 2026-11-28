/**
 * The install check over a whole repository: its package roots, its `.npmrc` files and its
 * Dockerfiles.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

import { dockerfileProblems, npmrcProblems, packageRootsOf } from './rules.mjs';

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
 * Every place in the repository at `root` that lets npm run install scripts: a package root whose
 * `.npmrc` does not turn them off, a `.npmrc` that turns them back on, and a Dockerfile stage that
 * runs npm before turning them off, each as `path:line  what is wrong`, from the files git tracks
 * and the new ones it would add.
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
        (path) => path !== '' && statSync(join(root, path), { throwIfNoEntry: false })?.isFile()
    );
    const read = (/** @type {string} */ path) => readFileSync(join(root, path), 'utf8');
    const manifests = new Map(
        listed
            .filter((path) => path === 'package.json' || path.endsWith('/package.json'))
            .map((path) => [path, read(path)])
    );
    const npmrcs = new Set(listed.filter((path) => path === '.npmrc' || path.endsWith('/.npmrc')));
    const roots = new Set(
        packageRootsOf(manifests).map((folder) => (folder === '' ? '.npmrc' : `${folder}/.npmrc`))
    );
    return [
        ...[...roots]
            .filter((path) => !npmrcs.has(path))
            .map(
                (path) =>
                    `${path}  a package root's .npmrc sets ignore-scripts=true, and there is none`
            ),
        ...[...npmrcs].flatMap((path) => npmrcProblems(path, read(path), roots.has(path))),
        ...listed.filter(isDockerfile).flatMap((path) => dockerfileProblems(path, read(path))),
    ];
}
