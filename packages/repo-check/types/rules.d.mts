/**
 * What a `.npmrc` holds wrong: each line that sets one of the settings the check holds to another
 * value than it needs, and, for a package root's own file, each of those settings it leaves out.
 *
 * @param {string} path
 * @param {string} text
 * @param {boolean} packageRoot
 * @returns {string[]}
 */
export function npmrcProblems(path: string, text: string, packageRoot: boolean): string[];
/**
 * The folders that are package roots, from the package.json files a repository holds, each by its
 * folder: the repository's root, and each folder with a package.json of its own that no package
 * above it lists as a workspace, since a workspace shares its root's `.npmrc`. As npm reads the
 * globs, a brace list is expanded and a `!` entry leaves out what the others matched, so a folder it
 * leaves out is a package root of its own.
 *
 * @param {ReadonlyMap<string, string>} manifests
 * @returns {string[]}
 */
export function packageRootsOf(manifests: ReadonlyMap<string, string>): string[];
/**
 * Each RUN of a Dockerfile, ONBUILD RUN among them, that comes before its stage holds npm's three
 * settings, whatever it runs, since a script it calls may run npm: install scripts turned off, and
 * git and URL dependencies stopped, each set with ENV, or the `.npmrc` that holds all three copied
 * in. An image build often copies only a `package.json` and its lockfile before installing, so the
 * repository's `.npmrc` counts only where the stage copies it. ARG does not count, since a build
 * argument can be set otherwise when the image is built. A FROM starts a stage with nothing set,
 * unless it builds on an earlier stage, whose settings and files it inherits.
 *
 * @param {string} path
 * @param {string} text
 * @returns {string[]}
 */
export function dockerfileProblems(path: string, text: string): string[];
/**
 * Each line of a file that lets npm do what the settings stop, as `lineProblem` reads it.
 *
 * @param {string} path
 * @param {string} text
 * @returns {string[]}
 */
export function scriptsOnProblems(path: string, text: string): string[];
/**
 * What is wrong with the npm that runs the check, given its version: older than the first that
 * reads `allow-git` and `allow-remote`, so it would pass over both settings without a word. The
 * floor is held here rather than by `engines.npm`, since Dependabot's npm updater reads that field
 * and may refuse to run on an older npm.
 *
 * @param {string} version
 * @returns {string[]}
 */
export function npmFloorProblems(version: string): string[];
/**
 * What a stage has set before a RUN: install scripts off, git and URL dependencies each stopped, and
 * the `.npmrc` copied in, which holds all three.
 */
export type Held = {
    scripts: boolean;
    git: boolean;
    remote: boolean;
    npmrc: boolean;
};
