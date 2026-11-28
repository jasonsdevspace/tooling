import { base, tests, typed } from '@jasonsdevspace/config/eslint';
import { defineConfig } from 'eslint/config';

/*
 * The house's presets from this repository's own config package, read from the workspace, so a
 * change to a preset is linted here before it is released. What follows them is this
 * repository's own.
 */
export default defineConfig(
    // The packages' declarations are written from their JSDoc and checked against it by a test.
    ...base({ ignores: ['packages/*/types'] }),
    {
        // A package's exports are declarations, since the types written from its JSDoc keep a
        // function's docs only on a declaration, and the published types are what a repository
        // that installs it reads. Its helpers inside stay values, as everywhere else.
        files: ['packages/*/src/*.mjs'],
        rules: {
            'func-style': 'off',
        },
    },
    ...typed({ tsconfigRootDir: import.meta.dirname }),
    ...tests()
);
