/**
 * Whether a path names a Dockerfile: `Dockerfile`, `Dockerfile.` followed by a name, or a name
 * ending in `.Dockerfile`. The prose check holds the same rule, and a test holds the two alike.
 *
 * @param {string} path
 * @returns {boolean}
 */
export function isDockerfile(path: string): boolean;
/**
 * The top of the git repository a folder sits in.
 *
 * @param {string} folder
 * @returns {string}
 */
export function repositoryRoot(folder: string): string;
/**
 * Every install in the repository at `root` that runs install scripts, as `path:line  install runs
 * scripts` with the command beneath, read from each workflow, composite action and Dockerfile.
 *
 * @param {string} root
 * @returns {string[]}
 */
export function installProblems(root: string): string[];
