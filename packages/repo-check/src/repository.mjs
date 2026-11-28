/**
 * The repo check over a whole repository: its package roots, its `.npmrc` files and its
 * Dockerfiles.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

import { dockerfileProblems, npmrcProblems, packageRootsOf, scriptsOnProblems } from './rules.mjs';

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
 * Whether a file is read for a line that turns install scripts back on: any text file but a doc, a
 * test or a `.npmrc`, which has a rule of its own.
 *
 * @param {string} path
 */
const readForScripts = (path) =>
    !/\.(?:md|markdown|png|jpe?g|gif|webp|avif|ico|woff2?|ttf|otf|eot|pdf|zip|gz|tgz|wasm|mp4|webm|mov)$/i.test(
        path
    ) &&
    !/(?:^|\/)(?:docs|tests?|__tests__)\//.test(path) &&
    !/\.(?:test|spec)\.[^/]+$/.test(path) &&
    !/(?:^|\/)\.npmrc$/.test(path);

/**
 * Every place in the repository at `root` that lets npm run install scripts or fetch git and URL
 * dependencies: a package root whose `.npmrc` leaves a setting out, a `.npmrc` that sets one
 * otherwise, a Dockerfile stage that runs a command before turning install scripts off, and a line
 * of any other text file but a doc or a test that turns them back on, each as `path:line  what is wrong`, from the files git tracks
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
                    `${path}  is missing, and each package root holds one with the three settings`
            ),
        ...[...npmrcs].flatMap((path) => npmrcProblems(path, read(path), roots.has(path))),
        ...listed.filter(isDockerfile).flatMap((path) => dockerfileProblems(path, read(path))),
        ...listed.filter(readForScripts).flatMap((path) => {
            const text = read(path);
            return text.includes('\0') ? [] : scriptsOnProblems(path, text);
        }),
    ];
}
