# 1. The house's build tools live in this repository, apart from the design kit

**Status:** accepted

## Context

Jason's repositories share build tools: the prose check, which holds every comment, document and
page to the house's writing rules, the commit message check, which holds a commit message and a pull
request's title and body to the same rules, and the lint, format and TypeScript settings each
repository keeps a copy of today. A tool every repository runs needs one home, so a fix reaches each
of them through a published version rather than a copy edited in each.

The prose check began in the design kit's workspace, beside the kit's own package and its site, and
released its first version from there. The kit is a design system, a package every app's pages load,
with a site and browser tests of its own. The prose check is a tool that runs in a repository's
checks and never reaches a page.

## Options

**A. Beside the kit, in the design kit's workspace.** The tools as more packages of the kit's
repository, released from tags of their own. Rejected, since a tool there takes on what the kit's
repository is built around. A change to a prose rule ran the kit's browser tests, the kit's releases
page and issues carried the tools' own, and the kit read its own tools from its workspace rather
than from npm, so a change to a tool that broke a repository installing it from npm could pass in
the kit unseen.

**B. A repository for each package.** The prose check in one repository and the config package in
another. Rejected, since the tools share everything around their code: the release workflow, staging
with provenance, change files, the check on the oldest Node a package supports and the checks every
repository runs. Each repository would keep a copy of all of it, and the copies would drift, which is
the trouble these tools exist to end.

**C. One repository for every tool, apart from the kit.** The tools as packages of one workspace of
their own, released from one workflow that reads which package a tag names.

## Decision

Option C. This repository holds the house's build tools as packages under `packages/`, each released
from a tag that names it, such as `prose-check-v0.2.0`, through the one `release.yml`, which stages
the package on npm with provenance from this repository for Jason to promote. The prose check moved
here with its history, and a tool written later, such as the config package, starts here. The kit
keeps its own repository and installs the tools from npm at an exact version, as every other
repository does. No tool rides inside the kit's own package, since the kit ships to every app's
visitors and a build tool there would reach every install.

## Consequences

- A change to a tool runs only this repository's checks, and reaches the kit and the other
  repositories as a version each moves its pin to, after reading the changelog.
- The kit is checked by the same published tools as every other repository, so a version that
  breaks one repository breaks it in the kit too, where it is seen.
- A new tool is a package and a line in the release workflow's tag routing, not a repository and a
  copy of the release setup.
- npm's trusted publisher for each package names this repository and `release.yml`, so moving a
  package again means registering it again.
- The prose check's first version, published from the design kit's repository by hand, carries no
  provenance and names that repository, while every version from here names this one.

## How it is tested

The release workflow's tests hold every package to the same publishing rules: a tag names one
package or the release stops, the package is staged from the tarball its own check on the oldest
Node proved, and only the publish job reads the token. The check on the oldest Node installs each
packed package into an empty repository and runs it there, as a repository that installs it from
npm does.
