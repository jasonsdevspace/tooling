/**
 * The rules the install check holds: every package root turns npm's install scripts off in its
 * `.npmrc`, no `.npmrc` turns them back on, and every Dockerfile stage that runs npm turns them off
 * first. npm honors its own setting for every install however it is written, so nothing a workflow
 * or a script runs needs to be read.
 */

/**
 * A value as npm's ini reader takes it: quotes taken off a quoted value, and otherwise everything
 * from an unescaped `;` or `#` on left out as a comment.
 *
 * @param {string} written
 */
const iniValue = (written) => {
    const quoted = /^(["'])(.*)\1$/.exec(written.trim());
    if (quoted) return quoted[2] ?? '';
    let value = '';
    for (let at = 0; at < written.length; at += 1) {
        const char = written[at] ?? '';
        if (char === '\\' && at + 1 < written.length) {
            value += written[at + 1] ?? '';
            at += 1;
        } else if (char === ';' || char === '#') break;
        else value += char;
    }
    return value.trim();
};

/**
 * Every line at the top level of an ini file, before any `[section]`, that sets a key, each with
 * the value it gives and its line number. A key written alone is true, as npm reads it.
 *
 * @param {string} text
 * @param {string} key
 * @returns {{ value: string, line: number }[]}
 */
const settingsOf = (text, key) => {
    /** @type {{ value: string, line: number }[]} */
    const settings = [];
    const lines = text.replace(/\r\n/g, '\n').split('\n');
    for (const [index, line] of lines.entries()) {
        if (/^\s*\[/.test(line)) break;
        const found = /^\s*([^=;#\s][^=]*?)\s*(?:=(.*))?$/.exec(line);
        if (!found || found[1] !== key) continue;
        settings.push({
            value: found[2] === undefined ? 'true' : iniValue(found[2]),
            line: index + 1,
        });
    }
    return settings;
};

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
        wrong.unshift(
            `${path}  a package root's .npmrc sets ignore-scripts=true, and this one does not`
        );
    return wrong;
}

/**
 * A glob with each brace list expanded, `{a,b}/*` as `a/*` and `b/*`.
 *
 * @param {string} glob
 * @returns {string[]}
 */
const expanded = (glob) => {
    const found = /\{([^{}]*)\}/.exec(glob);
    if (!found) return [glob];
    const [whole, list = ''] = found;
    return list
        .split(',')
        .flatMap((choice) =>
            expanded(glob.slice(0, found.index) + choice + glob.slice(found.index + whole.length))
        );
};

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
 * above it lists as a workspace, since a workspace shares its root's `.npmrc`. As npm reads the
 * globs, a brace list is expanded and a `!` entry leaves out what the others matched, so a folder it
 * leaves out is a package root of its own.
 *
 * @param {ReadonlyMap<string, string>} manifests
 * @returns {string[]}
 */
export function packageRootsOf(manifests) {
    const folders = [...manifests.keys()]
        .map((path) => (path === 'package.json' ? '' : path.slice(0, -'/package.json'.length)))
        .sort((a, b) => a.length - b.length);
    const lists = folders.map((folder) => {
        const globs = workspacesOf(
            manifests.get(folder === '' ? 'package.json' : `${folder}/package.json`) ?? ''
        ).flatMap(expanded);
        const pattern = (/** @type {string} */ glob) => workspacePattern(folder, glob);
        return {
            included: globs.filter((glob) => !glob.startsWith('!')).map(pattern),
            excluded: globs
                .filter((glob) => glob.startsWith('!'))
                .map((glob) => pattern(glob.slice(1))),
        };
    });
    const isWorkspace = (/** @type {string} */ folder) =>
        lists.some(
            ({ included, excluded }) =>
                included.some((pattern) => pattern.test(folder)) &&
                !excluded.some((pattern) => pattern.test(folder))
        );
    return folders.filter((folder) => folder === '' || !isWorkspace(folder));
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
 * comment or blank line among them, as Docker joins them, comment lines dropped, and a heredoc's body kept
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
            if (!/^\s*#/.test(next) && next.trim() !== '')
                joined = `${joined.slice(0, -1)} ${next}`;
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

/** Whether a RUN names npm or npx where it starts a command word, not inside a path like `~/.npm`. */
const RUNS_NPM = /(?:^|[\s;&|(`"'[]|\/)np[mx](?![\w.-])/;

/**
 * Whether a RUN turns install scripts back on for its own commands: `--ignore-scripts=false`,
 * `--ignore-scripts false`, `--no-ignore-scripts`, or an `npm_config_ignore_scripts` set before a
 * command to anything but true.
 *
 * @param {string} rest
 */
const turnsScriptsOn = (rest) =>
    /--ignore-scripts(?:=|\s+)false\b|--no-ignore-scripts\b/.test(rest) ||
    [...rest.matchAll(/(?:^|[\s;&|(])npm_config_ignore_scripts=("[^"]*"|'[^']*'|\S*)/gi)].some(
        ([, value = '']) => value.replace(/^(["'])(.*)\1$/, '$2') !== 'true'
    );

/**
 * The stage a FROM starts: the image or earlier stage it builds on, and the name it gives itself.
 *
 * @param {string} rest
 */
const stageOf = (rest) => {
    const words = rest.split(/\s+/).filter((word) => word !== '' && !word.startsWith('--'));
    const as = words.findIndex((word) => word.toLowerCase() === 'as');
    return { base: words[0] ?? '', name: as >= 0 ? words[as + 1] : undefined };
};

/**
 * What is wrong with a RUN, given whether its stage has turned install scripts off: nothing when it
 * runs no npm, or when the stage turned them off and the RUN leaves them off.
 *
 * @param {string} rest
 * @param {boolean} off
 * @returns {string | undefined}
 */
const runProblem = (rest, off) => {
    if (!RUNS_NPM.test(rest)) return undefined;
    if (!off) return 'runs npm before npm_config_ignore_scripts=true is set in its stage';
    return turnsScriptsOn(rest) ? 'turns install scripts back on for npm' : undefined;
};

/**
 * The setting a FROM's stage starts with, and the name it is known by: an earlier stage's setting
 * when it builds on one, and unset when it builds on an image.
 *
 * @param {string} rest
 * @param {ReadonlyMap<string, boolean>} stages
 */
const entering = (rest, stages) => {
    const { base, name } = stageOf(rest);
    return { off: stages.get(base.toLowerCase()) ?? false, stage: name?.toLowerCase() };
};

/**
 * Each RUN of a Dockerfile that runs npm or npx, as a command word, before its stage sets
 * `npm_config_ignore_scripts` to true with ENV or ARG, or that turns install scripts back on for
 * itself. A FROM starts a stage with the setting unset, unless it builds on an earlier stage, whose
 * setting it inherits.
 *
 * @param {string} path
 * @param {string} text
 * @returns {string[]}
 */
export function dockerfileProblems(path, text) {
    /** @type {string[]} */
    const problems = [];
    /** @type {Map<string, boolean>} */
    const stages = new Map();
    /** @type {string | undefined} */
    let stage;
    let off = false;
    for (const { text: instruction, line } of instructionsOf(text)) {
        const [, word = '', rest = ''] = /^\s*(\S+)\s*([\s\S]*)$/.exec(instruction) ?? [];
        const keyword = word.toUpperCase();
        if (keyword === 'FROM') {
            if (stage !== undefined) stages.set(stage, off);
            ({ off, stage } = entering(rest, stages));
        } else if (keyword === 'ENV' || keyword === 'ARG') off = scriptsSetting(rest) ?? off;
        else if (keyword === 'RUN') {
            const problem = runProblem(rest, off);
            if (problem !== undefined)
                problems.push(
                    `${path}:${line}  ${problem}\n    ${rest.split('\n')[0]?.trim() ?? ''}`
                );
        }
    }
    return problems;
}
