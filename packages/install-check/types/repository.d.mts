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
 * Every place in the repository at `root` that lets npm run install scripts: a package root whose
 * `.npmrc` does not turn them off, a `.npmrc` that turns them back on, and a Dockerfile stage that
 * runs npm before turning them off, each as `path:line  what is wrong`, from the files git tracks
 * and the new ones it would add.
 *
 * @param {string} root
 * @returns {string[]}
 */
export function installProblems(root: string): string[];
