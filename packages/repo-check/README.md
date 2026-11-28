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
  a folder out, so a folder left out is a package root of its own, and so is a workspace that
  declares workspaces of its own, since npm reads only one level of them.
- **No `.npmrc` sets any of the three otherwise.**
- **No file sets them otherwise.** npm reads a command's flags and the `npm_config_` environment
  settings ahead of a project's `.npmrc`, so each is refused where it gives another value, in a
  workflow's `env` block, a `package.json` script, a hook, a shell script, a Dockerfile or any other
  text file the repository tracks, apart from its docs and its tests:
    - the install scripts flag given any value npm reads as false, such as `false`, `0` or `null`,
      quoted or not, or written in its negated form
    - the `npm_config_ignore_scripts` setting given anything but `true`
    - the `--allow-git` and `--allow-remote` flags, and the `npm_config_allow_git` and
      `npm_config_allow_remote` settings, given anything but `none`

    A setting is read with `=` or `:`, in any case, with a hyphen or an underscore between its words,
    and after a quote and a closing bracket where code reads it as a key, such as
    `process.env["npm_config_ignore_scripts"] = "false"`.

- **No command rewrites the project's `.npmrc`.** npm's config command run with `--location=project`
  or `-L project`, to set or delete one of the three settings, or to edit the file, is refused, since
  it would change the file after the check has read it.
- **No install leaves the project with install scripts on.** An install pointed at another folder
  with `--prefix` or `-C`, or at npm's global folder with `-g`, `--global` or `--location=global`,
  reads another project's settings rather than this one's, so it is refused unless it passes the
  flag that turns install scripts off.
- **No command fetches a tool to run it.** npx, and npm's `exec` command and its alias `x`, fetch
  a tool that is not installed, and run it, unless told not to, so each is refused unless its own
  options end with `--no-install` or `--no`. npm's `create` command, and its `init` command given an
  initializer, always fetch one, so each is refused. A command is read where it starts a line, a
  script or a step, so a sentence that names one is passed over.
- **Every Dockerfile stage holds all three settings before its first RUN**, whatever that RUN runs,
  since a script it calls may run npm, and before an `ONBUILD RUN` too. A stage holds them when it
  sets `npm_config_ignore_scripts=true`, `npm_config_allow_git=none` and
  `npm_config_allow_remote=none` with ENV, or copies in the `.npmrc` by name. An image build often
  copies only a `package.json` and its lockfile before installing, so the repository's `.npmrc`
  counts only where the stage copies it, and a copy of a whole folder does not count, since a
  `.dockerignore` may leave the file out. Only ENV counts among the instructions that set, since a
  build argument set with ARG can be given another value when the image is built. A `FROM` an image
  starts a stage with nothing set, and a `FROM` an earlier stage inherits what that stage held.
- **The npm that runs the check is 11.14.0 or later**, the first that reads `allow-git` and
  `allow-remote`. An older npm passes over both without a word. The floor is held by the command
  rather than by `engines.npm`, since Dependabot's npm updater reads that field and may refuse to
  run on an older npm.

npm honors these settings for `npm ci`, `npm install` and every other way of installing inside the
project, so no command needs to be read for how it installs, apart from the two cases no project
setting reaches, an install outside the project and a tool fetched to run. A flag that turns
install scripts off on an install inside the project stays harmless, and is no longer needed.

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

A project's `.npmrc` covers the installs run in that project. An install pointed elsewhere reads the
other place's settings instead: a global install, such as `npm install -g`, or one given another
folder with `--prefix` or `-C`. So it carries the flag that turns install scripts off itself, and an
install given `--prefix` or `-C` without it is refused.

## What it reads

- **Every `package.json`**, to find the package roots and the workspaces each lists, as an array or
  under `packages`, with `*` for one folder's name and `**` for any depth.
- **Every `.npmrc`**, for its three settings at the top level, as npm's ini reader takes them: a
  quoted value unquoted, an inline `;` or `#` comment left out, and a key written alone read as
  true.
- **Dockerfiles**, any file named `Dockerfile`, `Dockerfile.` followed by a name, or ending in
  `.Dockerfile`: each `FROM`, each `ENV` that sets one of the three settings in either form ENV
  takes, each `COPY` and `ADD` that names a `.npmrc`, and each `RUN` and `ONBUILD RUN`, with
  continued lines joined past comment and blank lines, as Docker joins them, and a heredoc's body
  kept with its `RUN`.
- **Every other text file** the repository tracks, apart from its docs and its tests, a line at a
  time, for a setting given another value, a write to the project's `.npmrc`, an install outside the
  project and a tool fetched to run.
- **The npm on the path**, for its version.

It reads every file git tracks and every new one git would add, leaving out what the repository
ignores.

## Setup

```sh
npm install --save-dev --save-exact @jasonsdevspace/repo-check
printf '\nignore-scripts=true\nallow-git=none\nallow-remote=none\n' >> .npmrc
```

The settings are added to the `.npmrc` each package root already has, beside what it holds, after a
newline in case its last line has none. It
needs Node 24 or later, npm 11.14.0 or later and git. The install pins one exact version, since a minor version can fail
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
Install check failed. Each place below lets npm run install scripts or fetch what it should not:

demo/.npmrc  is missing, and each package root holds one with the three settings
Dockerfile:9  runs before its stage sets npm_config_ignore_scripts=true with ENV or copies in the .npmrc
    npm ci --omit=dev
.github/workflows/ci.yml:31  may fetch a package to run it, without --no-install
    - run: npx playwright install --with-deps
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
- `dockerfileProblems(path, text)` gives each `RUN` that comes before its stage holds the settings.
- `scriptsOnProblems(path, text)` gives each line of a file that sets one of the settings
  otherwise, rewrites the project's `.npmrc`, installs outside the project with install scripts on,
  or fetches a tool to run it.
- `npmFloorProblems(version)` gives what is wrong with an npm of that version, an empty list for
  11.14.0 or later.
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
