import { defineConfig } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

/**
 * React's rules of hooks, every one the plugin recommends raised to an error with its options
 * kept, and the browser's globals, for the files that render in a browser. Markup is parsed in
 * JavaScript files too, so a `.jsx` file is read as one. The plugin is an optional peer of this
 * package, which a repository with React installs itself.
 *
 * @param {{ files: string[] }} options The files that hold components and hooks.
 * @returns {import('eslint').Linter.Config[]}
 */
export function react({ files }) {
    /** @type {Record<string, import('eslint').Linter.RuleEntry>} */
    const recommended = reactHooks.configs.flat.recommended.rules;
    return defineConfig({
        files,
        languageOptions: {
            globals: globals.browser,
            parserOptions: { ecmaFeatures: { jsx: true } },
        },
        // The plugin's own types describe its legacy configs beside the rules, which ESLint's
        // plugin type does not admit, so it is passed on as the plugin it is at run time.
        plugins: {
            'react-hooks': /** @type {import('eslint').ESLint.Plugin} */ (
                /** @type {unknown} */ (reactHooks)
            ),
        },
        rules: Object.fromEntries(
            Object.entries(recommended).map(([rule, setting]) => [rule, raised(setting)])
        ),
    });
}

/**
 * A rule's setting with a warning raised to an error and its options kept.
 *
 * @param {import('eslint').Linter.RuleEntry} setting
 * @returns {import('eslint').Linter.RuleEntry}
 */
const raised = (setting) => {
    if (setting === 'warn' || setting === 1) return 'error';
    if (Array.isArray(setting) && (setting[0] === 'warn' || setting[0] === 1)) {
        return ['error', ...setting.slice(1)];
    }
    return setting;
};
