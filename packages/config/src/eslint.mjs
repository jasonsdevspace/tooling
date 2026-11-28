import js from '@eslint/js';
import comments from '@eslint-community/eslint-plugin-eslint-comments';
import { defineConfig } from 'eslint/config';
import importX from 'eslint-plugin-import-x';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import sonarjs from 'eslint-plugin-sonarjs';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/*
 * Three kinds of rule live here.
 *
 * Mechanical ones, such as import order, are fixed by `eslint --fix` and exist so a diff never
 * carries reordering noise. Bug catchers, from typescript-eslint's type-aware set and SonarJS, flag
 * code that is wrong rather than code that is unusual. Size budgets catch a function that has grown
 * past what a reader can hold at once. Everything is an error, since a warning that does not fail
 * the build is a rule nobody follows.
 *
 * Each preset is a function that returns flat config objects, so a repository spreads the ones it
 * takes into its own `defineConfig` and adds its own blocks after them: the folders that run in a
 * browser, the imports one folder may not make, the files no tsconfig includes. React's rules of
 * hooks live apart, in `@jasonsdevspace/config/react`, so a repository without React installs no
 * plugin for them.
 */

/** Every file of code a preset reads. */
const CODE = ['**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}'];

/**
 * Rules that fire on real mistakes and almost never on style.
 *
 * @type {import('eslint').Linter.RulesRecord}
 */
const bugCatchers = {
    'sonarjs/no-identical-conditions': 'error',
    'sonarjs/no-identical-expressions': 'error',
    'sonarjs/no-all-duplicated-branches': 'error',
    'sonarjs/no-element-overwrite': 'error',
    'sonarjs/no-ignored-return': 'error',
    'sonarjs/no-use-of-empty-return-value': 'error',
    'sonarjs/no-empty-collection': 'error',
    'sonarjs/no-unused-collection': 'error',
    'sonarjs/no-collection-size-mischeck': 'error',
    'sonarjs/no-extra-arguments': 'error',
    'sonarjs/no-gratuitous-expressions': 'error',
    'sonarjs/no-redundant-jump': 'error',
    eqeqeq: ['error', 'always'],
    'no-param-reassign': 'error',
    'array-callback-return': 'error',
    'no-return-assign': 'error',
};

/**
 * How large a function may grow before it should be split.
 *
 * @type {import('eslint').Linter.RulesRecord}
 */
const sizeBudgets = {
    complexity: ['error', 15],
    'sonarjs/cognitive-complexity': ['error', 15],
    'max-depth': ['error', 4],
    'max-params': ['error', 4],
};

/**
 * The rules for any code, JavaScript and TypeScript alike: ESLint's and typescript-eslint's
 * recommended sets, the bug catchers, the size budgets and the mechanical rules. A disable comment
 * has to say why after `--`, and one whose rule no longer fires fails the lint, so neither outlives
 * its reason.
 *
 * @param {{ ignores?: string[] }} [options] Paths left out of the lint, beside the builds and the
 *   coverage reports it always leaves out.
 * @returns {import('eslint').Linter.Config[]}
 */
export function base({ ignores = [] } = {}) {
    return defineConfig(
        { linterOptions: { reportUnusedDisableDirectives: 'error' } },
        { ignores: ['**/coverage', '**/dist', ...ignores] },
        {
            extends: [js.configs.recommended, ...tseslint.configs.recommended],
            files: CODE,
            languageOptions: {
                ecmaVersion: 2023,
                globals: globals.node,
            },
            plugins: {
                '@eslint-community/eslint-comments': comments,
                'import-x': importX,
                'simple-import-sort': simpleImportSort,
                sonarjs,
            },
            rules: {
                '@typescript-eslint/no-unused-vars': [
                    'error',
                    { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
                ],
                // Every callable is a value, so a file reads top to bottom with no hoisting
                // surprises.
                'func-style': ['error', 'expression'],
                'prefer-arrow-callback': ['error', { allowNamedFunctions: false }],
                'simple-import-sort/imports': 'error',
                'simple-import-sort/exports': 'error',
                'import-x/first': 'error',
                'import-x/newline-after-import': 'error',
                'import-x/no-duplicates': ['error', { 'prefer-inline': true }],
                '@eslint-community/eslint-comments/require-description': 'error',
                ...bugCatchers,
                ...sizeBudgets,
            },
        },
        {
            // A `.cjs` file is CommonJS whatever the package says, so it reads with `require` and
            // assigns `module.exports`, and the rule that asks for imports instead does not apply.
            files: ['**/*.cjs'],
            languageOptions: { sourceType: 'commonjs' },
            rules: { '@typescript-eslint/no-require-imports': 'off' },
        }
    );
}

/**
 * The rules that need the types, for TypeScript files, read through each file's own tsconfig by
 * typescript-eslint's project service.
 *
 * @param {{ tsconfigRootDir: string, allowDefaultProject?: string[] }} options The folder the
 *   project service starts from, the repository's root, and the files at the root that no tsconfig
 *   includes, read with a default project.
 * @returns {import('eslint').Linter.Config[]}
 */
export function typed({ tsconfigRootDir, allowDefaultProject }) {
    return defineConfig({
        extends: [...tseslint.configs.recommendedTypeChecked],
        files: ['**/*.{ts,tsx,mts,cts}'],
        languageOptions: {
            parserOptions: {
                projectService: allowDefaultProject === undefined ? true : { allowDefaultProject },
                tsconfigRootDir,
            },
        },
        rules: {
            '@typescript-eslint/no-floating-promises': 'error',
            '@typescript-eslint/no-misused-promises': 'error',
            '@typescript-eslint/await-thenable': 'error',
            '@typescript-eslint/require-array-sort-compare': 'error',
            '@typescript-eslint/prefer-nullish-coalescing': 'error',
            '@typescript-eslint/prefer-optional-chain': 'error',
            '@typescript-eslint/no-unnecessary-condition': 'error',
            '@typescript-eslint/prefer-readonly': 'error',
            // A switch over a union names every case, so a new member left out fails the lint.
            '@typescript-eslint/switch-exhaustiveness-check': 'error',
        },
    });
}

/**
 * The one rule a test may break: a fixture builder takes a record's fields in order, so a table of
 * fixtures reads as one row per line, which an object of named fields would spread over several.
 *
 * @param {{ files?: string[] }} [options] The test files, every `*.test.*` file unless named.
 * @returns {import('eslint').Linter.Config[]}
 */
export function tests({ files = ['**/*.test.{ts,tsx,mts,cts,js,jsx,mjs,cjs}'] } = {}) {
    return defineConfig({ files, rules: { 'max-params': 'off' } });
}
