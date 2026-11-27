# tooling

The build tools Jason Poteet's repositories share, each published to npm under `@jasonsdevspace`, so
a fix reaches every repository by moving one exact pin, and no repository keeps a copy that drifts.

## Packages

| Package                                                                                    | What it does                                                                                                                                             |
| ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`@jasonsdevspace/prose-check`](https://www.npmjs.com/package/@jasonsdevspace/prose-check) | Fails a build on prose that should never reach a reader, in comments, docs and page text. Its [README](packages/prose-check/README.md) lists every rule. |

Each package is versioned on its own and keeps its own changelog.

## How a release reaches npm

A package releases when a tag that names it is pushed to a commit on main, such as
`prose-check-v0.2.0`. The release workflow checks that the tag, the package's version and its
changelog agree and that no change file is left, runs every check CI runs, and stages the tarball
CI packed and proved on the oldest supported Node, held to the checksum that job reported. It
publishes through npm's trusted publishing, so no npm token is stored anywhere and each version
carries provenance linking it to the commit and the run that built it. A staged version goes live
only once it is promoted on npm, and a release on GitHub carries its changelog entry. The
[contributing guide](.github/CONTRIBUTING.md#releasing) lists the steps around it.

## Development

Install with `npm ci`, on the Node in `.nvmrc`, which also sets up the hook that checks each commit
message. `npm run verify` runs every check CI runs on a pull request:

- `npm run type-check`, the TypeScript compiler over the scripts and each package
- `npm run lint`, ESLint, where every rule is an error
- `npm run format:check`, Prettier
- `npm run prose`, the prose check from this repository's own package, over every file it reads
- `npm run node-check`, which keeps every place that names a Node major on the one in `.nvmrc`
- `npm run test:run`, the unit tests, the workflows' own tests among them

CI also packs each package, checks its manifest against what the tarball holds, and installs it in
an empty repository on the oldest Node its engines admit and on the project's Node, where it passes
plain prose, fails an em dash and type-checks as Node and a bundler resolve it.

## Decisions

The decisions behind this repository, with the options each turned down, are in
[docs/decisions](docs/decisions/README.md), starting with why the house's build tools live here
rather than beside the design kit.

## License

MIT, as [LICENSE](LICENSE) says.
