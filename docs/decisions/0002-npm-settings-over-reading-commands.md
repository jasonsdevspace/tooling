# 2. npm's own setting over reading commands

**Status:** accepted

## Context

An install script runs code from every package as npm installs it, before any test has looked at
it, which is how a compromised release spreads. Each repository held its installs to skipping those
scripts with a test that read every npm command its workflows and Dockerfiles ran and required the
flag that turns them off. The test was copied into each repository, and the copies were fixed in
parallel for the same gaps and still read some commands differently. The repo check was to replace
the copies with one command.

## Options

**A. Read each command for the flag.** One reader of shell and YAML, shipped as a command, that
finds every npm install, npx call and Dockerfile RUN and checks its flags. Rejected. It was built,
and two reviews each found a list of gaps in it, in quoting, comments, heredocs, process
substitution, BuildKit flags and npx's own options, and every fix left another, since a shell cannot
be read fully without running it.

**B. Hold each repository to npm's own setting.** Every package root's `.npmrc` turns install
scripts off and keeps npm from fetching git and URL dependencies, no file turns the scripts back on,
and every Dockerfile stage turns them off with ENV before it runs anything. npm honors the settings
for every install however it is written, so what a command says about installing need not be read.

## Decision

Option B, as the repo check's `check-installs` command.

## Consequences

- A repository's installs are covered however they are written, by a workflow, a script, a hook or
  an image, with no list of commands to keep up.
- npm skips a repository's own lifecycle scripts as well: `prepare`, `prepack`, `prepublishOnly` and
  every `pre` and `post` script. Setup runs `npm run prepare` by name after installing, so hooks are
  set up, and a package that built in `prepack` builds by name before it packs. A script run by name
  still runs under the setting, as npm's docs say.
- A global install reads no project `.npmrc`, so it turns install scripts off itself, and the
  repository's own workflow test holds it to that.
- A Dockerfile stage needs the setting before any RUN, whatever the RUN runs, which asks a line of a
  stage that runs no npm at all.

## How it is tested

The repo check's tests run the command in throwaway repositories for each rule: a package root
without its `.npmrc` or with a setting left out or set otherwise, a nested package root that is no
workspace, a workspace that needs no `.npmrc`, a file that turns install scripts back on, and
Dockerfile stages that run before their setting. CI's `repo-check-floor` job runs the packed
command against a repository that keeps the rule and against each kind of refusal. This
repository's own `verify` runs the command on itself.
