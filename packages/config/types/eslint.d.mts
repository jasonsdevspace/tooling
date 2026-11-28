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
export function base({ ignores }?: {
    ignores?: string[];
}): import("eslint").Linter.Config[];
/**
 * The rules that need the types, for TypeScript files, read through each file's own tsconfig by
 * typescript-eslint's project service.
 *
 * @param {{ tsconfigRootDir: string, allowDefaultProject?: string[] }} options The folder the
 *   project service starts from, the repository's root, and the files at the root that no tsconfig
 *   includes, read with a default project.
 * @returns {import('eslint').Linter.Config[]}
 */
export function typed({ tsconfigRootDir, allowDefaultProject }: {
    tsconfigRootDir: string;
    allowDefaultProject?: string[];
}): import("eslint").Linter.Config[];
/**
 * The one rule a test may break: a fixture builder takes a record's fields in order, so a table of
 * fixtures reads as one row per line, which an object of named fields would spread over several.
 *
 * @param {{ files?: string[] }} [options] The test files, every `*.test.*` file unless named.
 * @returns {import('eslint').Linter.Config[]}
 */
export function tests({ files }?: {
    files?: string[];
}): import("eslint").Linter.Config[];
