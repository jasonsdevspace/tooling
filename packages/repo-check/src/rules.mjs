/**
 * The rules the repo check holds: every package root turns npm's install scripts off in its
 * `.npmrc` and keeps it from fetching git and URL dependencies, no file turns the scripts back on,
 * and every Dockerfile stage turns them off before it runs anything. npm honors its own settings for
 * every install however it is written, so how a workflow or a script installs need not be read.
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

/** The settings a package root's `.npmrc` holds, each with the value it needs and what any other does. */
const REQUIRED = [
    { key: 'ignore-scripts', value: 'true', wrong: 'turns install scripts back on' },
    { key: 'allow-git', value: 'none', wrong: 'lets npm fetch dependencies from git' },
    { key: 'allow-remote', value: 'none', wrong: 'lets npm fetch dependencies from URLs' },
];

/**
 * What a `.npmrc` holds wrong: each line that sets one of the settings the check holds to another
 * value than it needs, and, for a package root's own file, each of those settings it leaves out.
 *
 * @param {string} path
 * @param {string} text
 * @param {boolean} packageRoot
 * @returns {string[]}
 */
export function npmrcProblems(path, text, packageRoot) {
    return REQUIRED.flatMap(({ key, value: needed, wrong }) => {
        const settings = settingsOf(text, key);
        const problems = settings
            .filter(({ value }) => value !== needed)
            .map(({ value, line }) => `${path}:${line}  ${key}=${value} ${wrong}`);
        if (packageRoot && !settings.some(({ value }) => value === needed))
            problems.unshift(
                `${path}  a package root's .npmrc sets ${key}=${needed}, and this one does not`
            );
        return problems;
    });
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
        if (key.toLowerCase() === SETTING) setting = value.trim() === 'true';
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
 * Whether an instruction runs a command in the image, as RUN does now and ONBUILD RUN does in a
 * later build.
 *
 * @param {string} keyword
 * @param {string} rest
 */
const runs = (keyword, rest) =>
    keyword === 'RUN' || (keyword === 'ONBUILD' && /^RUN\b/i.test(rest));

/**
 * Each RUN of a Dockerfile, ONBUILD RUN among them, that comes before its stage sets the npm setting
 * that turns install scripts off to true with ENV, whatever it runs, since a script it calls may run
 * npm. ARG does not count, since a build argument can be set otherwise when the image is built. A
 * FROM starts a stage with the setting unset, unless it builds on an earlier stage, whose setting it
 * inherits.
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
        } else if (keyword === 'ENV') off = scriptsSetting(rest) ?? off;
        else if (runs(keyword, rest) && !off)
            problems.push(
                `${path}:${line}  runs before ${SETTING}=true is set in its stage\n    ${rest.split('\n')[0]?.trim() ?? ''}`
            );
    }
    return problems;
}

/**
 * The npm flag and environment setting that name install scripts, each built from its parts, so
 * this file holds neither whole and the check can read it like any other.
 */
const FLAG = ['--ignore', '-scripts'].join('');
const SETTING = ['npm_config', '_ignore', '_scripts'].join('');

/** The flag set to false, and the flag's negated form, in any case. */
const FLAG_ON = new RegExp(`${FLAG}(?:=|\\s+)false\\b|--no${FLAG.slice(1)}\\b`, 'i');

/**
 * The environment setting given a value with `=` or `:`, quoted or not, in any case. An unquoted
 * value ends at a space, a shell operator, a bracket, a backslash, a backtick or a quote.
 */
const SETTING_VALUE = new RegExp(
    `${SETTING}["']?\\s*[:=]\\s*("[^"\\n]*"|'[^'\\n]*'|[^\\s;&|,})\\]\\\\\\x60"']*)`,
    'gi'
);

/**
 * Each line of a file that turns install scripts back on: the flag set to false or negated, or the
 * environment setting given any value but true, wherever the line sets it.
 *
 * @param {string} path
 * @param {string} text
 * @returns {string[]}
 */
export function scriptsOnProblems(path, text) {
    return text
        .replace(/\r\n/g, '\n')
        .split('\n')
        .flatMap((line, index) => {
            const setOn = [...line.matchAll(SETTING_VALUE)].some(
                ([, value = '']) => value.replace(/^(["'])(.*)\1$/, '$2').toLowerCase() !== 'true'
            );
            if (!FLAG_ON.test(line) && !setOn) return [];
            return [`${path}:${index + 1}  turns install scripts back on\n    ${line.trim()}`];
        });
}
