/**
 * What a `.npmrc` holds wrong: each line that sets `ignore-scripts` to anything but true, and, for a
 * package root's own file, no line that turns install scripts off.
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
 * above it lists as a workspace, since a workspace shares its root's `.npmrc`.
 *
 * @param {ReadonlyMap<string, string>} manifests
 * @returns {string[]}
 */
export function packageRootsOf(manifests: ReadonlyMap<string, string>): string[];
/**
 * Each RUN of a Dockerfile that runs npm or npx, as a word, before its stage sets
 * `npm_config_ignore_scripts` to true with ENV. Each FROM starts a stage with the setting unset.
 *
 * @param {string} path
 * @param {string} text
 * @returns {string[]}
 */
export function dockerfileProblems(path: string, text: string): string[];
