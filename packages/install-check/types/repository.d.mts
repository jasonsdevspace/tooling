/**
 * Every install in the repository at `root` that runs install scripts, as `path:line  install runs
 * scripts` with the command beneath, read from each workflow, composite action and Dockerfile.
 *
 * @param {string} root
 * @returns {string[]}
 */
export function installProblems(root: string): string[];
