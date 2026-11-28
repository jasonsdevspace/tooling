# tooling

The build tools Jason Poteet's repositories share, each published to npm under `@jasonsdevspace`, so
a fix reaches every repository by moving one exact pin, and no repository keeps a copy that drifts.

## Packages

| Package                                                                                        | What it does                                                                                                                                                                                                                   |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`@jasonsdevspace/prose-check`](https://www.npmjs.com/package/@jasonsdevspace/prose-check)     | Fails a build on prose that should never reach a reader, in comments, docs and page text. Its [README](packages/prose-check/README.md) lists every rule.                                                                       |
| [`@jasonsdevspace/install-check`](https://www.npmjs.com/package/@jasonsdevspace/install-check) | Fails a build where npm could run install scripts: a package root whose `.npmrc` does not turn them off, or a Dockerfile stage that runs npm before turning them off. Its [README](packages/install-check/README.md) says why. |

Each package is versioned on its own and keeps its own changelog.

## How a release reaches npm

A package releases when a tag that names it is pushed to a commit on main, such as
`prose-check-v0.2.0`. Each package's tag is routed by the release workflow and allowed by the `npm`
environment and the release tags ruleset, and npm trusts this repository's `release.yml` to stage
it, so adding a package means adding its tag to all three and registering it on npm. The release
workflow checks that the tag, the package's version and its changelog agree and that no change file
is left, runs every check CI runs, and stages the tarball CI packed and proved on the oldest
supported Node, held to the checksum that job reported. It
publishes through npm's trusted publishing, so no npm token is stored anywhere and each version
carries provenance linking it to the commit and the run that built it. A staged version goes live
only once it is promoted on npm, and a release on GitHub carries its changelog entry. The
[contributing guide](.github/CONTRIBUTING.md#releasing) lists the steps around it.

## Development

Install with `npm ci`, on the Node in `.nvmrc`, then run `npm run prepare` to set up the hooks that
check each commit and its message. The `.npmrc` turns npm's install scripts off, so npm runs no
package's code as it installs, and it skips this repository's own `prepare` as well until it is run
by name. `npm run verify` runs every check CI runs on a pull request:

- `npm run type-check`, the TypeScript compiler over the scripts and each package
- `npm run lint`, ESLint, where every rule is an error
- `npm run format:check`, Prettier
- `npm run prose`, the prose check from this repository's own package, over every file it reads
- `npm run installs`, the install check from this repository's own package, over its `.npmrc` and
  any Dockerfile
- `npm run node-check`, which keeps every place that names a Node major on the one in `.nvmrc`
- `npm run test:run`, the unit tests, the workflows' own tests among them

CI also packs each package, checks its manifest against what the tarball holds, and installs it in
an empty repository on the oldest Node its engines admit and on the project's Node, where its
command passes a repository that keeps its rules, refuses one that breaks them, and type-checks as
Node and a bundler resolve it.

## Decisions

The decisions behind this repository, with the options each turned down, are in
[docs/decisions](docs/decisions/README.md), starting with why the house's build tools live here
rather than beside the design kit.

## License

MIT, as [LICENSE](LICENSE) says.
