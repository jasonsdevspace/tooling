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
 * Each RUN of a Dockerfile, ONBUILD RUN among them, that comes before its stage sets the npm setting
 * that turns install scripts off to true with ENV, whatever it runs, since a script it calls may run
 * npm. ARG does not count, since a build argument can be set otherwise when the image is built. A
 * FROM starts a stage with the setting unset, unless it builds on an earlier stage, whose setting it
 * inherits.
 *
 * @param {string} path
 * @param {string} text
 * @returns {string[]}
 */
export function dockerfileProblems(path: string, text: string): string[];
/**
 * Each line of a file that turns install scripts back on: the flag set to false or negated, or the
 * environment setting given any value but true, wherever the line sets it.
 *
 * @param {string} path
 * @param {string} text
 * @returns {string[]}
 */
export function scriptsOnProblems(path: string, text: string): string[];
