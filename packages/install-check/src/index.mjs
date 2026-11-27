/**
 * The install check: `installProblems` for every install in a repository that runs install scripts,
 * which the `check-installs` command runs, and the readers it is built from, for a repository's
 * own checks of the npm commands its workflows run.
 */
export { dockerRunsOf, installs, npmCommandsIn, runsOf, skipsScripts } from './commands.mjs';
export { installProblems, isDockerfile, repositoryRoot } from './repository.mjs';
