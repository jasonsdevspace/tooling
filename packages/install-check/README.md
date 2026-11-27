# @jasonsdevspace/install-check

[![npm version](https://img.shields.io/npm/v/@jasonsdevspace/install-check)](https://www.npmjs.com/package/@jasonsdevspace/install-check)
[![CI](https://github.com/jasonsdevspace/tooling/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/jasonsdevspace/tooling/actions/workflows/ci.yml)
[![MIT license](https://img.shields.io/npm/l/@jasonsdevspace/install-check)](https://github.com/jasonsdevspace/tooling/blob/main/packages/install-check/LICENSE)

A check that fails a build on an npm install that runs its packages' install scripts, in a
repository's GitHub Actions workflows, its composite actions and its Dockerfiles. An install script
runs code from every package as it installs, before any test has looked at it, which is how a
compromised release spreads, so an install in CI or an image passes `--ignore-scripts`. The
`check-installs` command reads a whole repository and names each install that leaves scripts on,
by its file and line.

[Changelog](https://github.com/jasonsdevspace/tooling/blob/main/packages/install-check/CHANGELOG.md) ·
[Source](https://github.com/jasonsdevspace/tooling/tree/main/packages/install-check)

## What it checks

An install, in any of npm's spellings, that leaves install scripts on:

- **npm's install commands**, `npm ci`, `npm install`, `npm install-test`, `npm rebuild`,
  `npm update`, `npm dedupe` and `npm link`, with their short forms and the misspellings npm
  accepts, such as `npm i`, `npm ic` and `npm isntall`.
- **npx, `npm exec` and `npm x`**, which fetch a package that is not installed and run it, unless
  `--no-install` is among their own options, before the tool they run.
- **`npm init` and `npm create` given an initializer**, such as `npm create vite`, which fetch the
  initializer and run it. A flag's value, as in `npm init -w packages/a`, is not an initializer.

Scripts are off when the last flag that names them says so: `--ignore-scripts`,
`--ignore-scripts=true` or `--ignore-scripts true` turn them off, and `--ignore-scripts=false`,
`--ignore-scripts false` or `--no-ignore-scripts` turn them back on. For npx and `npm exec` the
flag counts only among npm's or npx's own options, before the tool and before `--`, since one after
them belongs to the tool.

## What it reads

- **Workflows**, every `.yml` or `.yaml` file in `.github/workflows`, and **composite actions**,
  every `action.yml` or `action.yaml` under `.github/actions`: the `run` of each step, a block or a
  folded block, or one quoted value unquoted, and none of a step's other keys. A comment is left out
  of the key's own line only outside quotes, and a block's lines are read whole.
- **Dockerfiles**, any file named `Dockerfile`, `Dockerfile.` followed by a name, or ending in
  `.Dockerfile`: each `RUN` behind any BuildKit flags, in shell form, exec form or with a heredoc,
  whose own line is read as well as its body, with continued lines joined past comment lines, as
  Docker joins them.

In a script it finds a command wherever it sits: after a keyword, an assignment or another command,
inside parentheses, a substitution, a process substitution such as `<(npm ci)`, or another shell
started with `sh -c` or `bash -c`. It reads quotes in one pass, left to right, as bash runs them:

- Double quotes still run a substitution, so `echo "$(npm ci)"` and a backticked `npm ci` inside
  double quotes are installs.
- Single quotes run nothing, so a command named inside them is only text, and so is an escaped
  backtick or dollar sign. An apostrophe inside double quotes opens nothing.
- A `#` that starts a word starts a comment, which runs nothing.
- A flag that takes a value, such as `--prefix demo` or `-w docs`, is passed over with its value to
  find the command, and a redirection and its target are no part of it.

It reads every file git tracks and every new one git would add, leaving out what the repository
ignores.

## Setup

```sh
npm install --save-dev --save-exact @jasonsdevspace/install-check
```

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
Install check failed. Each install below runs its packages' install scripts, so add --ignore-scripts:

.github/workflows/ci.yml:24  install runs scripts
    npm ci
Dockerfile:7  install runs scripts
    npm install --omit=dev
```

Each install names the file, the line of its step's `run` or its `RUN`, and the command. The command
exits 0 when every install leaves install scripts off, 1 when one does not, and 2 with how to run it
when given an argument or run outside a git repository.

## What it exports

`installProblems(root)` returns every install in the repository at `root` that runs install scripts,
in the form the command prints, and an empty list when there are none.

The readers it is built from are exported too, for a repository's own checks of what its workflows
run:

- `runsOf(text)` reads a workflow or composite action as each step's script, the line of its `run`
  and the folder its `working-directory` names, where it names one.
- `dockerRunsOf(text)` reads a Dockerfile as each `RUN`'s script and line.
- `npmCommandsIn(script)` reads a script as its npm and npx commands, each with its subcommand, the
  words before and after it, and its text. npx reads as `npm exec`.
- `installs(command)` says whether a command installs packages, and `skipsScripts(command)` whether
  it leaves their install scripts off.

```js
import { npmCommandsIn, runsOf } from '@jasonsdevspace/install-check';

const fetched = runsOf(workflow)
    .flatMap(({ run }) => npmCommandsIn(run))
    .filter(({ npx }) => npx);
```

Each comes with its types.

## Versions and license

The rules live in this package and nowhere else, so a repository takes a fix by moving its exact pin
to the version that holds it. The package is versioned on its own, and before 1.0.0 a version says
what a build may do once a repository moves to it:

- **A minor version** can fail a build that passed before: a reader that finds more installs than
  it did.
- **A patch** never fails a build that passed: a fix that stops the check from naming an install
  that leaves scripts off.

Read the
[changelog](https://github.com/jasonsdevspace/tooling/blob/main/packages/install-check/CHANGELOG.md)
before moving to a minor version, since a reader that finds more may name an install written before
it. The package is MIT licensed, and the terms are in
[LICENSE](https://github.com/jasonsdevspace/tooling/blob/main/packages/install-check/LICENSE).
