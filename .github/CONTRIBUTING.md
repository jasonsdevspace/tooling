# Contributing

This repository holds the build tools Jason Poteet's repositories share, and it is held to the
checks below whoever opens a pull request. Everyone taking part follows the [code of
conduct](https://github.com/jasonsdevspace/.github/blob/main/CODE_OF_CONDUCT.md).

## Setting up and running the checks

[Development](../README.md#development) in the README says what each check covers. Install, then set
up the hooks by name, since the `.npmrc` turns npm's install scripts off and npm skips `prepare`
with them, and run the checks CI runs before a pull request:

```bash
npm ci
npm run prepare
npm run verify
```

CI also packs each package and installs it in an empty repository on the oldest Node it supports,
as the README describes.

## Writing

Every file is held to one style, which the prose check enforces: no em dashes, no semicolons joining
clauses, American spelling, no issue numbers in comments, and no notes about the process, such as a
list of what is left to do, in anything a reader sees. A commit message says what changed and why in
plain sentences, held to the same prose rules, and names the work rather than whatever tool wrote
it, which the prose check's `check-commit-message` command enforces. Installing with `npm ci` sets
that command up as a hook on each commit, and CI runs it on a pull request's title and body.

## Issues

Issues follow the repository's templates, for a piece of work, a parent issue that holds several,
and a bug. Each piece of work says what is wrong or missing, what is already settled, and criteria a
test or a look can check. A bug says what happens, what should happen and how to see it.

## Pull requests

A pull request follows the template. Pull requests are squashed, so the title becomes the commit on
main, and the title and the body both pass the commit message check. The body says what changed and
why, with no counts, no checklist and no notes to the reviewer, and ends with "Closes #N", or "Part
of #N" when the issue has more to do. A pull request that changes a package writes its changelog
text in a file of its own under that package's `changes` folder, as the README there says, rather
than in `CHANGELOG.md`. Every check in CI passes before a pull request is merged.

## Releasing

Each package releases on its own, through the one release workflow, from a tag that names it, such
as `prose-check-v0.2.0`. [How a release reaches npm](../README.md#how-a-release-reaches-npm) in the
README says what the workflow does. Around it, a maintainer:

- bumps the version in the package's `package.json`, adds a `## VERSION` heading to its
  `CHANGELOG.md` that folds in every change file under its `changes` folder, which that pull request
  deletes, under the lead-ins the entries before it use, and points every link in its README pinned
  to a tag at the new version's tag, in a pull request of its own
- tags main with `PACKAGE-vVERSION` once that merges, which starts the release workflow
- reads the run's summary for "Staged on npm", since a run that finds the version already on npm
  passes without staging anything
- promotes the staged version on the package's npm page
- moves npm's `next` tag to a stable version once it is promoted and no newer prerelease is staged,
  with `npm dist-tag add @jasonsdevspace/PACKAGE@VERSION next`, so `next` is never older than
  `latest`
- moves each repository's exact pin to the promoted version, in a pull request of its own in that
  repository, reading the changelog first, since a minor version can fail a build that passed

A new package's first version reaches npm through the release workflow too, with provenance, once
npm holds the package's name so a trusted publisher can be registered for it. Before its tag, the
`npm` environment allows the package's tag and the release tags ruleset covers it, and the
maintainer has npm 11.15 or newer and a login session that has passed two-factor authentication.
npm already shows a public `0.0.0-stage` placeholder for a name staged for the first time, and it
never becomes `latest`. Then the maintainer:

- merges the package's release pull request, which sets its first version, such as 0.1.0
- packs a throwaway version, `0.1.0-bootstrap.0`, by setting it in a copy of the package and
  running `npm pack`, and stages it by hand with `npm stage publish TARBALL --access public`, which
  creates the name on npm and is never promoted
- registers the trusted publisher with the `npm trust github` command below
- in the same sitting, tags the merge commit with `PACKAGE-v0.1.0` and pushes the tag, so the
  workflow stages 0.1.0 with provenance before the registration lapses
- promotes 0.1.0 on the package's npm page, then rejects the staged bootstrap version there

If `npm trust` refuses a name whose only versions are the placeholder or the bootstrap, the first
version is staged by hand instead, from the tarball CI proved for the merge commit. The maintainer
downloads it from that commit's push run with
`gh run download RUN --name PACKAGE-package --dir DIR`, compares `shasum -a 256` of the tarball with
the checksum in the oldest Node job's Packed summary, stages it with
`npm stage publish TARBALL --access public`, promotes it, and tags that same commit with
`git tag PACKAGE-v0.1.0 SHA` before pushing the tag. The release workflow then finds the version on
npm, stages nothing and creates the GitHub release, and the trusted publisher is registered with
the next version's tag.

Once for each package, not for each release, its trusted publisher is registered on npm for the
first tag that publishes through this repository's `release.yml`, with the workflow `release.yml`
and the `npm` environment, never left blank, since a release's CI jobs run under the same file, and
allowed to stage but not to publish. It is registered in the same sitting as that tag, since npm
drops a registration that publishes nothing within two days. A registration left from another
repository or an earlier workflow is revoked and made again, not edited, since an edit keeps its old
clock:

```sh
npm trust list @jasonsdevspace/PACKAGE
npm trust revoke @jasonsdevspace/PACKAGE --id ID
npm trust github @jasonsdevspace/PACKAGE --file release.yml --repo jasonsdevspace/tooling --env npm --allow-stage-publish
npm trust list @jasonsdevspace/PACKAGE
```

The last list shows one entry and no other: the repository `jasonsdevspace/tooling`, the workflow
`release.yml` and the environment `npm`, allowed to stage but not to publish.

The release workflow stops on a version npm already holds, staged or published, since it cannot tell
one staged by an earlier run from one staged from other code. A run whose later step failed is
repeated with "Re-run failed jobs", which keeps the staging and runs only what failed.

## Security

Report a security issue privately, as the [security policy](SECURITY.md) says, not in a public
issue.
