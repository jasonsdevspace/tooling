/**
 * React's rules of hooks, every one the plugin recommends raised to an error with its options
 * kept, and the browser's globals, for the files that render in a browser. Markup is parsed in
 * JavaScript files too, so a `.jsx` file is read as one. The plugin is an optional peer of this
 * package, which a repository with React installs itself.
 *
 * @param {{ files: string[] }} options The files that hold components and hooks.
 * @returns {import('eslint').Linter.Config[]}
 */
export function react({ files }: {
    files: string[];
}): import("eslint").Linter.Config[];
