export default config;
/**
 * The house's Prettier config: four spaces, single quotes, a hundred columns, semicolons, and the
 * trailing commas ES5 allows. A repository names it from the `prettier` field of its `package.json`
 * as `"@jasonsdevspace/config/prettier"`.
 *
 * @type {{
 *   semi: boolean,
 *   singleQuote: boolean,
 *   tabWidth: number,
 *   trailingComma: 'es5',
 *   printWidth: number,
 *   arrowParens: 'always',
 * }}
 */
declare const config: {
    semi: boolean;
    singleQuote: boolean;
    tabWidth: number;
    trailingComma: "es5";
    printWidth: number;
    arrowParens: "always";
};
