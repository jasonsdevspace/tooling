# @jasonsdevspace/install-check

[![npm version](https://img.shields.io/npm/v/@jasonsdevspace/install-check)](https://www.npmjs.com/package/@jasonsdevspace/install-check)
[![CI](https://github.com/jasonsdevspace/tooling/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/jasonsdevspace/tooling/actions/workflows/ci.yml)
[![MIT license](https://img.shields.io/npm/l/@jasonsdevspace/install-check)](https://github.com/jasonsdevspace/tooling/blob/main/packages/install-check/LICENSE)

A check that fails a build wherever npm could run a package's install scripts. An install script
runs code from every package as it installs, before any test has looked at it, which is how a
compromised release spreads. npm's own `ignore-scripts` setting stops every one of them, however
the install is written, so the check holds a repository to that setting rather than reading the
commands it runs. The `check-installs` command reads a whole repository and names each file that
breaks the rule.

[Changelog](https://github.com/jasonsdevspace/tooling/blob/main/packages/install-check/CHANGELOG.md) ·
[Source](https://github.com/jasonsdevspace/tooling/tree/main/packages/install-check)

## The rule

- **Every package root holds a `.npmrc` that sets `ignore-scripts=true`.** A package root is the
  repository's root, and any folder with a `package.json` of its own that no package above it lists
  as a workspace, such as a demo with its own dependencies. npm reads a project's `.npmrc` from the
  root of the project it runs in, and a workspace shares its root's.
- **No `.npmrc` sets `ignore-scripts` to anything but `true`**, so nothing turns the setting back on.
- **Every Dockerfile stage that runs npm or npx sets `ENV npm_config_ignore_scripts=true` before
  it.** Each `FROM` starts a stage with the setting unset, and an image build often copies only a
  `package.json` and its lockfile before installing, so the `.npmrc` may not be there.

npm honors the setting for `npm ci`, `npm install`, npx and every other way of installing, so no
workflow, script or Dockerfile command needs to be read for how it installs. A flag such as
`--ignore-scripts` on an install stays harmless, and is no longer needed.

## Setting up hooks under the rule

With install scripts off, npm skips a repository's own `prepare` script too, which is where a hook
manager such as husky sets itself up. npm's docs say a script run by name still runs: commands
"explicitly intended to run a particular script, such as `npm start`, `npm stop`, `npm restart`,
`npm test`, and `npm run` will still run their intended script if `ignore-scripts` is set". So a
repository's setup steps run it after installing:

```sh
npm ci
npm run prepare
```

A global install, such as `npm install -g`, does not read a project's `.npmrc`, so it passes
`--ignore-scripts` itself.

## What it reads

- **Every `package.json`**, to find the package roots and the workspaces each lists, as an array or
  under `packages`, with `*` for one folder's name and `**` for any depth.
- **Every `.npmrc`**, for its `ignore-scripts` lines.
- **Dockerfiles**, any file named `Dockerfile`, `Dockerfile.` followed by a name, or ending in
  `.Dockerfile`: each `FROM`, each `ENV` that sets `npm_config_ignore_scripts` in either form ENV
  takes, and each `RUN` that names `npm` or `npx` as a word, with continued lines joined past
  comment lines, as Docker joins them, and a heredoc's body kept with its `RUN`.

It reads every file git tracks and every new one git would add, leaving out what the repository
ignores.

## Setup

```sh
npm install --save-dev --save-exact @jasonsdevspace/install-check
printf 'ignore-scripts=true\n' >> .npmrc
```

The setting is added to the `.npmrc` each package root already has, beside what it holds.

It needs Node 24 or later and git. The install pins one exact version, since a minor version can
fail a build that passed, as [Versions and license](#versions-and-license) explains.

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

demo/.npmrc  a package root's .npmrc sets ignore-scripts=true, and there is none
Dockerfile:9  runs npm before npm_config_ignore_scripts=true is set in its stage
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
- `dockerfileProblems(path, text)` gives each `RUN` of npm that comes before its stage's setting.
- `isDockerfile(path)` says whether a path names a Dockerfile, and `repositoryRoot(folder)` gives
  the top of the git repository a folder sits in.

Each comes with its types.

## Versions and license

The rule lives in this package and nowhere else, so a repository takes a fix by moving its exact pin
to the version that holds it. The package is versioned on its own, and before 1.0.0 a version says
what a build may do once a repository moves to it:

- **A minor version** can fail a build that passed before: a rule that asks more than it did.
- **A patch** never fails a build that passed: a fix that stops the check from naming a file that
  keeps the rule.

Read the
[changelog](https://github.com/jasonsdevspace/tooling/blob/main/packages/install-check/CHANGELOG.md)
before moving to a minor version. The package is MIT licensed, and the terms are in
[LICENSE](https://github.com/jasonsdevspace/tooling/blob/main/packages/install-check/LICENSE).
