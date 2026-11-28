# Changelog

What changed in each version of `@jasonsdevspace/repo-check`, newest first. Until 1.0.0, a minor
version can fail a build that passed before, with a rule that asks more, and a patch never does, as
the package's README says. Each version has a release on GitHub with its entry as the notes.

## 0.1.0

The first version: a `check-installs` command that fails a build wherever npm could run a
package's install scripts or fetch a dependency from git or a URL, holding a repository to npm's
own settings rather than reading the commands it runs.

- **Rules.** Every package root, the repository's root and any folder with a `package.json` of its
  own that no package above it lists as a workspace, holds a `.npmrc` that sets
  `ignore-scripts=true`, `allow-git=none` and `allow-remote=none`, with workspace globs read as npm
  reads them, brace lists expanded and `!` entries leaving folders out. No `.npmrc` sets any of the
  three otherwise, each read as npm's ini reader reads it. No text file but a doc or a test turns
  install scripts back on with the flag or the `npm_config_ignore_scripts` setting. Every Dockerfile
  stage sets `npm_config_ignore_scripts=true` with ENV before its first RUN or ONBUILD RUN, a `FROM`
  an image starting a stage with the setting unset and a `FROM` an earlier stage inheriting it.
- **Command.** `check-installs` reads every `package.json`, `.npmrc`, Dockerfile and other text file
  git tracks or would add, names each file that breaks a rule, with its line where there is one,
  and exits 0 on a pass, 1 on a refusal and 2 with how to run it when given an argument or run
  outside a git repository.
- **Function.** `installProblems`, `packageRootsOf`, `npmrcProblems`, `dockerfileProblems`,
  `scriptsOnProblems`, `isDockerfile` and `repositoryRoot` are exported with their types.
- **Docs.** The README says what the rule is and why, how hooks and builds run by name under it,
  what the check reads, and what a failure looks like.
- **Tests.** Each rule is checked through the command in throwaway repositories and through the
  rules alone, with a package root without a `.npmrc`, settings left out or set otherwise, a nested
  package root that is no workspace, a workspace that needs no `.npmrc`, a workflow and a script
  that turn install scripts back on, a multi-stage Dockerfile, a setting made after its RUN, ARG in
  place of ENV, and a continued RUN.
