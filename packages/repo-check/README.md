# @jasonsdevspace/repo-check

[![npm version](https://img.shields.io/npm/v/@jasonsdevspace/repo-check)](https://www.npmjs.com/package/@jasonsdevspace/repo-check)
[![CI](https://github.com/jasonsdevspace/tooling/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/jasonsdevspace/tooling/actions/workflows/ci.yml)
[![MIT license](https://img.shields.io/npm/l/@jasonsdevspace/repo-check)](https://github.com/jasonsdevspace/tooling/blob/main/packages/repo-check/LICENSE)

The house's checks of a repository as a whole, each a command of its own. The first,
`check-installs`, fails a build wherever npm could run a package's install scripts or fetch a
dependency from git or a URL. An install script runs code from every package as it installs, before
any test has looked at it, which is how a compromised release spreads. npm's own settings stop every
one of them, however the install is written, so the check holds a repository to those settings
rather than reading the commands it runs.

[Changelog](https://github.com/jasonsdevspace/tooling/blob/main/packages/repo-check/CHANGELOG.md) ·
[Source](https://github.com/jasonsdevspace/tooling/tree/main/packages/repo-check)

## The rule `check-installs` holds

- **Every package root holds a `.npmrc` that sets `ignore-scripts=true`, `allow-git=none` and
  `allow-remote=none`.** The first stops install scripts. The other two stop npm fetching a
  dependency from a git repository or a tarball's address, which npm's notes name as a way around
  the first. A package root is the repository's root, and any folder with a `package.json` of its
  own that no package above it lists as a workspace, such as a demo with its own dependencies. npm
  reads a project's `.npmrc` from the root of the project it runs in, and a workspace shares its
  root's. Workspace globs are read as npm reads them, a brace list expanded and a `!` entry leaving
  a folder out, so a folder left out is a package root of its own.
- **No `.npmrc` sets any of the three otherwise.**
- **No file turns install scripts back on.** The flag set to false or written in its negated form,
  or the `npm_config_ignore_scripts` setting given anything but `true`, with `=` or `:`, in any
  case, is refused in a workflow's `env` block, a `package.json` script, a hook, a shell script, a
  Dockerfile or any other text file the repository tracks, apart from its docs and its tests.
- **Every Dockerfile stage sets `ENV npm_config_ignore_scripts=true` before its first RUN**,
  whatever that RUN runs, since a script it calls may run npm, and before an `ONBUILD RUN` too. Only
  ENV counts, since a build argument set with ARG can be given another value when the image is
  built. A `FROM` an image starts a stage with the setting unset, and a `FROM` an earlier stage
  inherits that stage's setting. An image build often copies only a `package.json` and its lockfile
  before installing, so the `.npmrc` may not be there.

npm honors these settings for `npm ci`, `npm install`, npx and every other way of installing, so no
workflow, script or Dockerfile command needs to be read for how it installs. A flag that turns
install scripts off on an install stays harmless, and is no longer needed.

## Lifecycle scripts under the rule

With install scripts off, npm skips more than a package's install scripts. It skips a repository's
own `prepare`, `prepack` and `prepublishOnly`, and every `pre` and `post` script, such as
`pretest`. npm's docs say a script run by name still runs: commands "explicitly intended to run a
particular script, such as `npm start`, `npm stop`, `npm restart`, `npm test`, and `npm run` will
still run their intended script if `ignore-scripts` is set". So under the rule:

- **Hooks are set up by name.** A hook manager such as husky sets itself up in `prepare`, so setup
  runs it after installing:

    ```sh
    npm ci
    npm run prepare
    ```

- **A package builds by name before it packs.** A package that builds in `prepack` would be packed
  without its build, so the build runs by name before `npm pack`, and `prepack` can go.
- **`allowScripts` can go.** The field lists packages allowed to run install scripts, and npm 11
  does nothing with it by default.

A global install, such as `npm install -g`, does not read a project's `.npmrc`, so it turns install
scripts off itself.

## What it reads

- **Every `package.json`**, to find the package roots and the workspaces each lists, as an array or
  under `packages`, with `*` for one folder's name and `**` for any depth.
- **Every `.npmrc`**, for its three settings at the top level, as npm's ini reader takes them: a
  quoted value unquoted, an inline `;` or `#` comment left out, and a key written alone read as
  true.
- **Dockerfiles**, any file named `Dockerfile`, `Dockerfile.` followed by a name, or ending in
  `.Dockerfile`: each `FROM`, each `ENV` that sets `npm_config_ignore_scripts` in either form ENV
  takes, and each `RUN` and `ONBUILD RUN`, with continued lines joined past comment and blank lines,
  as Docker joins them, and a heredoc's body kept with its `RUN`.
- **Every other text file** the repository tracks, apart from its docs and its tests, for a line
  that turns install scripts back on.

It reads every file git tracks and every new one git would add, leaving out what the repository
ignores.

## Setup

```sh
npm install --save-dev --save-exact @jasonsdevspace/repo-check
printf 'ignore-scripts=true\nallow-git=none\nallow-remote=none\n' >> .npmrc
```

The settings are added to the `.npmrc` each package root already has, beside what it holds. It
needs Node 24 or later and git. The install pins one exact version, since a minor version can fail
a build that passed, as [Versions and license](#versions-and-license) explains.

Run it in `verify`, beside the other checks, and in CI:

```json
{
    "scripts": {
        "installs": "check-installs",
        "verify": "npm run installs && npm run test:run"
    }
}
```

## What a failure looks like

```text
Install check failed. Each place below lets npm run install scripts:

demo/.npmrc  is missing, and each package root holds one with the three settings
Dockerfile:9  runs before npm_config_ignore_scripts=true is set in its stage
    npm ci --omit=dev
```

Each problem names the file, and the line where there is one. The command exits 0 when the
repository keeps the rule, 1 when it does not, and 2 with how to run it when given an argument or
run outside a git repository.

## What it exports

`installProblems(root)` returns every problem in the repository at `root`, in the form the command
prints, and an empty list when there are none. The rules it is built from are exported too:

- `packageRootsOf(manifests)` gives the package roots, by folder, from a map of each `package.json`
  path to its text.
- `npmrcProblems(path, text, packageRoot)` gives what a `.npmrc` holds wrong.
- `dockerfileProblems(path, text)` gives each `RUN` that comes before its stage's setting.
- `scriptsOnProblems(path, text)` gives each line of a file that turns install scripts back on.
- `isDockerfile(path)` says whether a path names a Dockerfile, and `repositoryRoot(folder)` gives
  the top of the git repository a folder sits in.

Each comes with its types.

## Versions and license

The rules live in this package and nowhere else, so a repository takes a fix by moving its exact pin
to the version that holds it. The package is versioned on its own, and before 1.0.0 a version says
what a build may do once a repository moves to it:

- **A minor version** can fail a build that passed before: a rule that asks more than it did, or a
  new command.
- **A patch** never fails a build that passed: a fix that stops a check from naming a file that
  keeps its rule.

Read the
[changelog](https://github.com/jasonsdevspace/tooling/blob/main/packages/repo-check/CHANGELOG.md)
before moving to a minor version. The package is MIT licensed, and the terms are in
[LICENSE](https://github.com/jasonsdevspace/tooling/blob/main/packages/repo-check/LICENSE).
