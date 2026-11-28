/**
 * The rules the install check holds: every package root turns npm's install scripts off in its
 * `.npmrc`, no `.npmrc` turns them back on, and every Dockerfile stage that runs npm turns them off
 * first. npm honors its own setting for every install however it is written, so nothing a workflow
 * or a script runs needs to be read.
 */

/**
 * The value an ini file gives a key, from its last line that sets it, with the line it sits on, or
 * undefined where no line sets it.
 *
 * @param {string} text
 * @param {string} key
 * @returns {{ value: string, line: number }[]}
 */
const settingsOf = (text, key) =>
    text
        .replace(/\r\n/g, '\n')
        .split('\n')
        .flatMap((line, index) => {
            const found = /^\s*([^=;#\s][^=]*?)\s*=\s*(.*?)\s*$/.exec(line);
            if (!found || found[1] !== key) return [];
            return [{ value: (found[2] ?? '').replace(/^(["'])(.*)\1$/, '$2'), line: index + 1 }];
        });

/**
 * What a `.npmrc` holds wrong: each line that sets `ignore-scripts` to anything but true, and, for a
 * package root's own file, no line that turns install scripts off.
 *
 * @param {string} path
 * @param {string} text
 * @param {boolean} packageRoot
 * @returns {string[]}
 */
export function npmrcProblems(path, text, packageRoot) {
    const settings = settingsOf(text, 'ignore-scripts');
    const wrong = settings
        .filter(({ value }) => value !== 'true')
        .map(
            ({ value, line }) =>
                `${path}:${line}  ignore-scripts=${value} turns install scripts back on`
        );
    if (packageRoot && !settings.some(({ value }) => value === 'true'))
        wrong.unshift(`${path}  a package root's .npmrc sets ignore-scripts=true`);
    return wrong;
}

/**
 * The pattern a workspace glob names, from the folder of the package.json that lists it: `**` for
 * any depth and `*` for one folder's name.
 *
 * @param {string} folder
 * @param {string} glob
 */
const workspacePattern = (folder, glob) => {
    const path = `${folder === '' ? '' : `${folder}/`}${glob.replace(/^\.\//, '').replace(/\/+$/, '')}`;
    const source = path
        .split('/')
        .map((part) =>
            part === '**'
                ? '.*'
                : part.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')
        )
        .join('/');
    return new RegExp(`^${source}$`);
};

/**
 * The workspace globs a package.json lists, as an array or under `packages`, or none.
 *
 * @param {string} text
 * @returns {string[]}
 */
const workspacesOf = (text) => {
    /** @type {unknown} */
    let manifest;
    try {
        manifest = JSON.parse(text);
    } catch {
        return [];
    }
    if (typeof manifest !== 'object' || manifest === null || !('workspaces' in manifest)) return [];
    /** @type {unknown} */
    const listed = manifest.workspaces;
    /** @type {unknown} */
    const globs =
        typeof listed === 'object' && listed !== null && 'packages' in listed
            ? listed.packages
            : listed;
    return Array.isArray(globs) ? globs.filter((glob) => typeof glob === 'string') : [];
};

/**
 * The folders that are package roots, from the package.json files a repository holds, each by its
 * folder: the repository's root, and each folder with a package.json of its own that no package
 * above it lists as a workspace, since a workspace shares its root's `.npmrc`.
 *
 * @param {ReadonlyMap<string, string>} manifests
 * @returns {string[]}
 */
export function packageRootsOf(manifests) {
    const folders = [...manifests.keys()]
        .map((path) => (path === 'package.json' ? '' : path.slice(0, -'/package.json'.length)))
        .sort((a, b) => a.length - b.length);
    const patterns = folders.flatMap((folder) =>
        workspacesOf(
            manifests.get(folder === '' ? 'package.json' : `${folder}/package.json`) ?? ''
        ).map((glob) => workspacePattern(folder, glob))
    );
    return folders.filter(
        (folder) => folder === '' || !patterns.some((pattern) => pattern.test(folder))
    );
}

/**
 * Whether an ENV instruction's words turn npm's install scripts off, on, or leave them as they
 * were: `true`, `false` or undefined.
 *
 * @param {string} rest
 * @returns {boolean | undefined}
 */
const scriptsSetting = (rest) => {
    const pairs = [...rest.matchAll(/(\S+?)=("[^"]*"|'[^']*'|\S*)/g)].map(
        ([, key = '', value = '']) => [key, value.replace(/^(["'])(.*)\1$/, '$2')]
    );
    const legacy = /^(\S+)\s+(\S.*)$/.exec(rest.trim());
    const all = pairs.length > 0 ? pairs : legacy ? [[legacy[1] ?? '', legacy[2] ?? '']] : [];
    /** @type {boolean | undefined} */
    let setting;
    for (const [key = '', value = ''] of all) {
        if (key.toLowerCase() === 'npm_config_ignore_scripts') setting = value.trim() === 'true';
    }
    return setting;
};

/**
 * Each instruction of a Dockerfile with the line it starts on: continued lines joined past any
 * comment line among them, as Docker joins them, comment lines dropped, and a heredoc's body kept
 * with the RUN that opens it.
 *
 * @param {string} text
 * @returns {{ text: string, line: number }[]}
 */
const instructionsOf = (text) => {
    const lines = text.replace(/\r\n/g, '\n').split('\n');
    /** @type {{ text: string, line: number }[]} */
    const instructions = [];
    let at = 0;
    while (at < lines.length) {
        const start = at;
        let joined = lines[at] ?? '';
        at += 1;
        if (/^\s*#/.test(joined) || joined.trim() === '') continue;
        while (joined.endsWith('\\') && at < lines.length) {
            const next = lines[at] ?? '';
            at += 1;
            if (!/^\s*#/.test(next)) joined = `${joined.slice(0, -1)} ${next}`;
        }
        const heredoc = /(?:^|\s)<<-?(["']?)([A-Za-z_]\w*)\1/.exec(joined);
        const end = heredoc
            ? lines.findIndex((line, index) => index >= at && line.trim() === heredoc[2])
            : -1;
        if (end >= 0) {
            joined = `${joined}\n${lines.slice(at, end).join('\n')}`;
            at = end + 1;
        }
        instructions.push({ text: joined, line: start + 1 });
    }
    return instructions;
};

/**
 * Each RUN of a Dockerfile that runs npm or npx, as a word, before its stage sets
 * `npm_config_ignore_scripts` to true with ENV. Each FROM starts a stage with the setting unset.
 *
 * @param {string} path
 * @param {string} text
 * @returns {string[]}
 */
export function dockerfileProblems(path, text) {
    /** @type {string[]} */
    const problems = [];
    let off = false;
    for (const { text: instruction, line } of instructionsOf(text)) {
        const [, word = '', rest = ''] = /^\s*(\S+)\s*([\s\S]*)$/.exec(instruction) ?? [];
        const keyword = word.toUpperCase();
        if (keyword === 'FROM') off = false;
        else if (keyword === 'ENV') off = scriptsSetting(rest) ?? off;
        else if (keyword === 'RUN' && !off && /(?:^|[^\w-])np[mx](?![\w-])/.test(rest))
            problems.push(
                `${path}:${line}  runs npm before npm_config_ignore_scripts=true is set in its stage\n    ${rest.split('\n')[0]?.trim() ?? ''}`
            );
    }
    return problems;
}
