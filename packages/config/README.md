# @jasonsdevspace/config

[![npm version](https://img.shields.io/npm/v/@jasonsdevspace/config)](https://www.npmjs.com/package/@jasonsdevspace/config)
[![CI](https://github.com/jasonsdevspace/tooling/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/jasonsdevspace/tooling/actions/workflows/ci.yml)
[![MIT license](https://img.shields.io/npm/l/@jasonsdevspace/config)](https://github.com/jasonsdevspace/tooling/blob/main/packages/config/LICENSE)

The lint, format and TypeScript settings the house's repositories share: ESLint presets, the
Prettier config and a strict TypeScript base. A rule raised here is raised in every repository that
moves its pin, rather than in the one copy it was edited in.

[Changelog](https://github.com/jasonsdevspace/tooling/blob/main/packages/config/CHANGELOG.md) ·
[Source](https://github.com/jasonsdevspace/tooling/tree/main/packages/config)

## Installing

```sh
npm install --save-dev --save-exact @jasonsdevspace/config eslint typescript-eslint typescript prettier
```

The package brings the lint plugins its presets name, at the versions it was tested with, so a
plugin update reaches a repository through a release of this package. ESLint, typescript-eslint,
TypeScript and Prettier stay the repository's own, since they are the tools it runs and
typescript-eslint names the TypeScript versions it supports, so the two move together in the
repository's own dependency updates.

## The ESLint presets

Each preset is a function that returns flat config objects, which a repository spreads into its own
`eslint.config.js` and follows with its own blocks:

```js
import { base, react, tests, typed } from '@jasonsdevspace/config/eslint';
import { defineConfig } from 'eslint/config';

export default defineConfig(
    ...base({ ignores: ['packages/engine/smoke/types.ts'] }),
    ...typed({ tsconfigRootDir: import.meta.dirname, allowDefaultProject: ['vitest.config.ts'] }),
    ...react({ files: ['apps/web/**/*.{ts,tsx}'] }),
    ...tests(),
    {
        // This repository's own rules, such as the imports a folder that runs in a browser may not
        // make.
    }
);
```

- **`base({ ignores })`** holds any code, JavaScript and TypeScript, to ESLint's and
  typescript-eslint's recommended sets, the rules that catch real mistakes, such as `eqeqeq` and
  SonarJS's identical-branch checks, the size budgets a function may not grow past, and the
  mechanical rules `eslint --fix` applies, such as import order. Every callable is a value, written
  as an arrow function. A disable comment has to say why after `--`, and one whose rule no longer
  fires fails the lint. The builds in `dist` and the coverage reports are left out, beside the paths
  given.
- **`typed({ tsconfigRootDir, allowDefaultProject })`** holds TypeScript files to
  typescript-eslint's type-aware set, such as a promise nobody awaits and a condition that is
  always true, read through each file's own tsconfig. `allowDefaultProject` names the files at the
  root that no tsconfig includes.
- **`react({ files })`** holds the files given to React's rules of hooks, every one the plugin
  recommends raised to an error, with the browser's globals.
- **`tests({ files })`** turns off `max-params` in the test files, every `*.test.*` file unless
  named, so a fixture builder can take a record's fields in order, and turns off nothing else.

Every rule in every preset is an error, since a warning that does not fail the build is a rule
nobody follows. A repository keeps for itself what names its own folders: which ones run in a
browser or a worker, the imports one may not make, and the files only it holds.

## The Prettier config

Named from the repository's `package.json`:

```json
{
    "prettier": "@jasonsdevspace/config/prettier"
}
```

Four spaces, single quotes, a hundred columns, semicolons, and the trailing commas ES5 allows.

## The TypeScript base

Extended from the repository's `tsconfig.json`, which adds what is its own, such as its `lib`, its
`types`, `jsx` and what it includes:

```json
{
    "extends": "@jasonsdevspace/config/tsconfig.json",
    "compilerOptions": { "types": ["node"], "noEmit": true },
    "include": ["src"]
}
```

It is strict, with `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitReturns`,
`noPropertyAccessFromIndexSignature`, `noImplicitOverride`, unused locals and parameters,
`verbatimModuleSyntax` and `isolatedModules`, and it checks library declarations too, with
`skipLibCheck` off, so a broken declaration in what a package ships or installs fails the type check
rather than reaching a repository that installs it. A tsconfig that compiles a dependency whose own
declarations are broken, and cannot be fixed from here, turns `skipLibCheck` back on for itself
alone.

## Versions and license

The package is versioned on its own. Until 1.0.0, a minor version can fail a build that passed
before, with a rule that asks more or a new one, and a patch never does, so read the changelog
before moving to a minor version. The package is MIT licensed, and the terms are in
[LICENSE](https://github.com/jasonsdevspace/tooling/blob/main/packages/config/LICENSE).
