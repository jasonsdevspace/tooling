/**
 * The repo check: `installProblems` for every place in a repository that lets npm run install
 * scripts, which the `check-installs` command runs, and the rules it is built from.
 */
export { installProblems, isDockerfile, repositoryRoot } from './repository.mjs';
export { dockerfileProblems, npmrcProblems, packageRootsOf, scriptsOnProblems } from './rules.mjs';
