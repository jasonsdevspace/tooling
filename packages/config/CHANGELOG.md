# Changelog

What changed in each version of `@jasonsdevspace/config`, newest first. Until 1.0.0, a minor version
can fail a build that passed before, with a rule that asks more, and a patch never does, as the
package's README says. Each version has a release on GitHub with its entry as the notes.

## 0.1.0

The first version: the lint, format and TypeScript settings every repository of the house shares,
so a rule raised in one is raised in all of them through a published version.

- **ESLint.** Four presets, each a function that returns flat config objects. `base` holds any code
  to ESLint's and typescript-eslint's recommended sets, the bug catchers, the size budgets and the
  mechanical rules, with a disable comment that has to say why and fails once its rule no longer
  fires. `typed` holds TypeScript files to the rules that need the types, read through each file's
  own tsconfig. `tests` turns off `max-params` and nothing else. Every preset reads every kind of
  JavaScript and TypeScript file, CommonJS and module files and markup among them, and a `.cjs` file
  reads as CommonJS, with `require` and `module.exports`. `react`, from
  `@jasonsdevspace/config/react`, holds the files given to React's rules of hooks, every one at an
  error, with markup parsed in JavaScript files too. No rule in any preset is a warning. The lint
  plugins the presets name come with the package, apart from React's hooks plugin, an optional peer
  a repository with React installs itself, and ESLint, typescript-eslint and TypeScript stay the
  repository's own.
- **Prettier.** The house's style, four spaces, single quotes, a hundred columns, named from a
  repository's `package.json` as `"@jasonsdevspace/config/prettier"`.
- **TypeScript.** A strict base, extended as `"@jasonsdevspace/config/tsconfig.json"`, with every
  check the house holds to and library declarations checked too.
- **Docs.** The README says how a repository takes each preset, the Prettier config and the
  TypeScript base, and what it keeps for itself.
- **Tests.** A sample breaks a rule of each preset and fails at an error, a disable comment with no
  reason fails, no rule resolves to a warning for any kind of file, and CI installs the packed
  package in an empty project and runs every preset, the Prettier config and the TypeScript base
  there.
