/**
 * The rules the repo check holds: every package root turns npm's install scripts off in its
 * `.npmrc` and keeps it from fetching git and URL dependencies, no file sets any of those settings
 * otherwise, and every Dockerfile stage sets all three before it runs anything. npm honors its own
 * settings for every install however it is written, so how an install is written need not be read,
 * apart from the two cases no project setting reaches: an install into npm's global folder, and a
 * tool that npx, or npm's exec command, may fetch to run.
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
        if (!found || iniValue(found[1] ?? '') !== key) continue;
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
        .sort((a, b) => b.length - a.length);
    const lists = new Map(
        folders.map((folder) => {
            const globs = workspacesOf(
                manifests.get(folder === '' ? 'package.json' : `${folder}/package.json`) ?? ''
            ).flatMap(expanded);
            const pattern = (/** @type {string} */ glob) => workspacePattern(folder, glob);
            return [
                folder,
                {
                    declares: globs.length > 0,
                    included: globs.filter((glob) => !glob.startsWith('!')).map(pattern),
                    excluded: globs
                        .filter((glob) => glob.startsWith('!'))
                        .map((glob) => pattern(glob.slice(1))),
                },
            ];
        })
    );
    const above = (/** @type {string} */ folder) =>
        folders.filter(
            (other) => other !== folder && (other === '' || folder.startsWith(`${other}/`))
        );
    // A folder is a workspace of the nearest package above it whose globs list it, unless that
    // package's `!` entries leave it out. One that declares workspaces of its own is a package root,
    // since npm reads only one level of workspaces, from the root it runs in.
    const isWorkspace = (/** @type {string} */ folder) => {
        for (const other of above(folder)) {
            const list = lists.get(other);
            if (list?.included.some((pattern) => pattern.test(folder)))
                return !list.excluded.some((pattern) => pattern.test(folder));
        }
        return false;
    };
    return folders
        .filter(
            (folder) =>
                folder === '' || lists.get(folder)?.declares === true || !isWorkspace(folder)
        )
        .sort((a, b) => a.length - b.length);
}

/**
 * The settings an ENV instruction's words give, each by its npm name, such as `allow-git`, with the
 * value it is given, in both forms ENV takes.
 *
 * @param {string} rest
 * @returns {Map<string, string>}
 */
const envSettings = (rest) => {
    const pairs = [...rest.matchAll(/(\S+?)=("[^"]*"|'[^']*'|\S*)/g)].map(
        ([, key = '', value = '']) => [key, value.replace(/^(["'])(.*)\1$/, '$2')]
    );
    const legacy = /^(\S+)\s+(\S.*)$/.exec(rest.trim());
    const all = pairs.length > 0 ? pairs : legacy ? [[legacy[1] ?? '', legacy[2] ?? '']] : [];
    /** @type {Map<string, string>} */
    const settings = new Map();
    for (const [key = '', value = ''] of all) {
        const named = ENV_NAME.exec(key);
        if (named) settings.set((named[1] ?? '').toLowerCase().replace(/_/g, '-'), value.trim());
    }
    return settings;
};

/**
 * A folder in the image, from where a stage stands and a path that may be relative to it, with no
 * slash at its end but the root's own.
 *
 * @param {string} from
 * @param {string} path
 */
const folderAt = (from, path) => {
    const whole = path.startsWith('/') ? path : `${from.replace(/\/$/, '')}/${path}`;
    /** @type {string[]} */
    const parts = [];
    for (const part of whole.split('/')) {
        if (part === '..') parts.pop();
        else if (part !== '' && part !== '.') parts.push(part);
    }
    return `/${parts.join('/')}`;
};

/**
 * Whether a COPY or ADD instruction's words copy a `.npmrc` into the folder the stage runs in,
 * named as one of its sources, so npm reads it there. A copy of a whole folder does not count,
 * since a `.dockerignore` may leave the file out, and nor does a copy to another folder.
 *
 * @param {string} rest
 * @param {string} workdir
 */
const copiesNpmrc = (rest, workdir) => {
    const words = rest
        .split(/\s+/)
        .filter((word) => word !== '' && !word.startsWith('--'))
        .map((word) => word.replace(/["',[\]]/g, ''))
        .filter(Boolean);
    const target = words.at(-1) ?? '';
    const into = folderAt(workdir, target.replace(/(?:^|\/)\.npmrc$/, '') || '.');
    return (
        words.slice(0, -1).some((word) => /(?:^|\/)\.npmrc$/.test(word)) &&
        into === folderAt(workdir, '.')
    );
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
        while (/\\[ \t]*$/.test(joined) && at < lines.length) {
            const next = lines[at] ?? '';
            at += 1;
            joined = joined.replace(/\\[ \t]*$/, '\\');
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
 * What a stage has set before a RUN: install scripts off, git and URL dependencies each stopped,
 * the folder it runs in, and the folder a `.npmrc` that holds all three was copied into, if any.
 *
 * @typedef {{ scripts: boolean, git: boolean, remote: boolean, workdir: string, npmrc: string | undefined }} Held
 */

/** A stage that has set nothing, as one built on an image starts, in the image's root. */
const UNSET = Object.freeze({
    scripts: false,
    git: false,
    remote: false,
    workdir: '/',
    npmrc: undefined,
});

/**
 * What a FROM's stage starts with, and the name it is known by: what an earlier stage held when it
 * builds on one, and nothing when it builds on an image.
 *
 * @param {string} rest
 * @param {ReadonlyMap<string, Held>} stages
 */
const entering = (rest, stages) => {
    const { base, name } = stageOf(rest);
    return { held: { ...(stages.get(base.toLowerCase()) ?? UNSET) }, stage: name?.toLowerCase() };
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
 * What a stage holds after an ENV instruction: each of the three settings it gives counts where it
 * gives the value that stops what the setting governs, and is unset where it gives any other.
 *
 * @param {Held} held
 * @param {string} rest
 * @returns {Held}
 */
const afterEnv = (held, rest) => {
    const settings = envSettings(rest);
    const set = (
        /** @type {string} */ key,
        /** @type {string} */ needed,
        /** @type {boolean} */ was
    ) => (settings.has(key) ? settings.get(key) === needed : was);
    return {
        ...held,
        scripts: set('ignore-scripts', 'true', held.scripts),
        git: set('allow-git', 'none', held.git),
        remote: set('allow-remote', 'none', held.remote),
    };
};

/**
 * What is wrong with a RUN, given what its stage holds as it runs: install scripts not yet off, and
 * git and URL dependencies not yet stopped, unless the `.npmrc` was copied into the folder it runs
 * in.
 *
 * @param {string} where
 * @param {Held} held
 * @param {string} rest
 * @returns {string[]}
 */
const runProblems = (where, held, rest) => {
    if (held.npmrc === held.workdir) return [];
    const command = rest.split('\n')[0]?.trim() ?? '';
    return [
        ...(held.scripts
            ? []
            : [
                  `${where}  runs before its stage sets ${SETTING}=true with ENV or copies in the .npmrc\n    ${command}`,
              ]),
        ...(held.git && held.remote
            ? []
            : [
                  `${where}  runs before its stage stops git and URL dependencies, with ${FETCH_SETTINGS} set to none by ENV or the .npmrc copied in\n    ${command}`,
              ]),
    ];
};

/**
 * Each RUN of a Dockerfile, ONBUILD RUN among them, that comes before its stage holds npm's three
 * settings, whatever it runs, since a script it calls may run npm: install scripts turned off, and
 * git and URL dependencies stopped, each set with ENV, or the `.npmrc` that holds all three copied
 * into the folder the RUN runs in. An image build often copies only a `package.json` and its
 * lockfile before installing, so the repository's `.npmrc` counts only where the stage copies it.
 * ARG does not count, since a build
 * argument can be set otherwise when the image is built. A FROM starts a stage with nothing set,
 * unless it builds on an earlier stage, whose settings and files it inherits.
 *
 * @param {string} path
 * @param {string} text
 * @returns {string[]}
 */
export function dockerfileProblems(path, text) {
    /** @type {string[]} */
    const problems = [];
    /** @type {Map<string, Held>} */
    const stages = new Map();
    /** @type {string | undefined} */
    let stage;
    /** @type {Held} */
    let held = { ...UNSET };
    for (const { text: instruction, line } of instructionsOf(text)) {
        const [, word = '', rest = ''] = /^\s*(\S+)\s*([\s\S]*)$/.exec(instruction) ?? [];
        const keyword = word.toUpperCase();
        if (keyword === 'FROM') {
            if (stage !== undefined) stages.set(stage, held);
            ({ held, stage } = entering(rest, stages));
        } else if (keyword === 'ENV') held = afterEnv(held, rest);
        else if (keyword === 'WORKDIR')
            held = { ...held, workdir: folderAt(held.workdir, rest.trim()) };
        else if ((keyword === 'COPY' || keyword === 'ADD') && copiesNpmrc(rest, held.workdir))
            held = { ...held, npmrc: held.workdir };
        else if (runs(keyword, rest)) problems.push(...runProblems(`${path}:${line}`, held, rest));
    }
    return problems;
}

/**
 * The npm flag and environment setting that name install scripts, each built from its parts, so
 * this file holds neither whole and the check can read it like any other. npm reads the setting's
 * name in any case, with an underscore or a hyphen after the prefix.
 */
const FLAG = ['--ignore', '-scripts'].join('');
const SETTING = ['npm_config', '_ignore', '_scripts'].join('');
const SETTING_SOURCE = `${SETTING.slice(0, -'_scripts'.length)}[-_]scripts`;

/**
 * The environment names of the three settings, each with what follows the prefix, so `allow_git`
 * reads as `allow-git`. npm reads them in any case, with an underscore or a hyphen between words.
 */
const ENV_NAME = /^npm_config[-_]((?:ignore|allow)[-_](?:scripts|git|remote))$/i;

/** The two fetch settings as a Dockerfile sets them, named in a message. */
const FETCH_SETTINGS = ['allow_git', 'allow_remote']
    .map((name) => `npm_config_${name}`)
    .join(' and ');

/** A value with its quotes taken off, in lower case. */
const plain = (/** @type {string} */ value) => value.replace(/^(["'])(.*)\1$/, '$2').toLowerCase();

/**
 * The flag given a value with `=`, which npm reads as false for anything but true, and the flag
 * followed by a word npm reads as false, quoted or not.
 */
const FLAG_VALUE = new RegExp(`${FLAG}=("[^"]*"|'[^']*'|[^\\s;&|)]*)`, 'gi');
const FLAG_FALSE = new RegExp(
    `${FLAG}\\s+(["']?)(?:false|0|null)\\1(?![\\w-])|--no${FLAG.slice(1)}\\b`,
    'i'
);

/**
 * The environment setting given a value with `=` or `:`, quoted or not, in any case. An unquoted
 * value ends at a space, a shell operator, a bracket, a backslash, a backtick or a quote.
 */
const VALUE = `("[^"\\n]*"|'[^'\\n]*'|[^\\s;&|,})\\]\\\\\\x60"']*)`;

/**
 * The separator between a setting's name and its value: a colon or an equals sign, after a quote
 * and a closing bracket where code reads it as a key, such as `env["name"] = value`, and with the
 * rest of a comparison such as `===` passed over, so a test of the value reads the value it tests.
 */
const SEPARATOR = `["']?\\]?\\s*[:=]=*\\s*`;
const SETTING_VALUE = new RegExp(`${SETTING_SOURCE}${SEPARATOR}${VALUE}`, 'gi');

/**
 * The flags and environment settings that let npm fetch dependencies from git or a URL, each given
 * a value, which npm reads in place of the `.npmrc`'s whenever it is anything but none. Each is
 * built from its parts, as the install scripts flag is.
 */
const FETCH_FLAG_VALUE = new RegExp(
    `${['--allow', '-'].join('')}(?:git|remote)(?:=|\\s+)("[^"]*"|'[^']*'|[^\\s;&|)]*)`,
    'gi'
);
const FETCH_SETTING_VALUE = new RegExp(
    `${['npm_config', '[-_]allow'].join('')}[-_](?:git|remote)${SEPARATOR}${VALUE}`,
    'gi'
);

/** npm's subcommands that install, in every spelling it accepts. */
const INSTALLS =
    'ci|clean-install|ic|install-clean|isntall-clean|i|in|ins|inst|insta|instal|install|isnt|isnta|isntal|isntall|add|it|cit|sit|install-test|install-ci-test|clean-install-test|rebuild|rb|update|up|upgrade|udpate|dedupe|ddp|link|ln';

/** An npm install on a line that names another project with `--prefix` or `-C`. */
const INSTALL = new RegExp(`(?:^|[\\s;&|(])npm\\s(?:.*\\s)?(?:${INSTALLS})(?=\\s|$)`);
const ELSEWHERE =
    /\s(?:--prefix(?:=|\s)|-C\s|-g(?=\s|$)|--global(?=[\s=]|$)|--location(?:=|\s+)global\b)/;

/**
 * A write to the project's own `.npmrc` by npm's config command: `edit` of the whole file, or `set`
 * or `delete` of one of the three settings, which would change what the check read from the file
 * after it read it.
 */
const CONFIG_WRITE = /(?:^|[\s;&|(])npm\s+(?:.*\s)?(?:config|c)\s+(set|delete|rm|edit)\b(.*)$/;
const PROJECT = /\s(?:--location|-L)(?:=|\s+)project\b/;
const HELD_KEY = /\b(?:ignore-scripts|allow-git|allow-remote)\b/;

/**
 * Whether a line writes one of the three settings into the project's `.npmrc`.
 *
 * @param {string} line
 */
const writesProject = (line) => {
    const found = CONFIG_WRITE.exec(line);
    if (!found || !PROJECT.test(line)) return false;
    return found[1] === 'edit' || HELD_KEY.test(found[2] ?? '');
};

/** npm's and npx's options that take a value, so the value is not read as the tool. */
const VALUED = new Set([
    '--prefix',
    '--workspace',
    '-w',
    '-C',
    '--cache',
    '--loglevel',
    '--userconfig',
    '--registry',
    '--scope',
    '--package',
    '-p',
    '--call',
    '-c',
]);

/**
 * The words that may come before a command where it starts a line or a script: a list item's dash,
 * a key such as `run:` or a script's name, a Dockerfile's RUN, a variable set for the command, and
 * the commands that run another, such as `sudo` and `env`.
 */
const LEAD = /^(?:-|[\w.-]+:|RUN|ONBUILD|sudo|exec|env|time|command|[A-Za-z_]\w*=\S*)$/;

/** Whether a word runs a tool, by name or by a path that ends in it. */
const isTool = (/** @type {string} */ word, /** @type {string} */ tool) =>
    word === tool || word.endsWith(`/${tool}`);

/** Where the first word from `from` that is not an option sits, passing over an option's value. */
const operandAt = (/** @type {readonly string[]} */ words, /** @type {number} */ from) => {
    for (let at = from; at < words.length; at += 1) {
        const word = words[at] ?? '';
        if (word === '--') return at + 1 < words.length ? at + 1 : -1;
        if (!word.startsWith('-')) return at;
        if (VALUED.has(word)) at += 1;
    }
    return -1;
};

/**
 * Whether npx, or npm's exec command, by its own options before the tool, may fetch what it runs:
 * the last of the options that say whether it may deciding, and fetching when none is given. npx
 * reads `--no-install` as `--no`, and npm's exec command does not, so there it stops nothing.
 *
 * @param {readonly string[]} words
 * @param {number} from
 * @param {boolean} throughNpx
 */
const mayFetch = (words, from, throughNpx) => {
    let fetches = true;
    for (let at = from; at < words.length; at += 1) {
        const word = words[at] ?? '';
        if (word === '--' || !word.startsWith('-')) break;
        if (word === '--no' || word === '--yes=false' || (throughNpx && word === '--no-install'))
            fetches = false;
        else if (word === '--yes' || word === '-y') fetches = true;
        else if (VALUED.has(word)) at += 1;
    }
    return fetches;
};

/**
 * Whether a line runs a command that may fetch a package to run it: npx, or npm's exec command or
 * its alias, whose own options leave it free to fetch, npm's create command, or its init command
 * given an initializer, each read only where it starts a command, so a sentence that names one is
 * passed over.
 *
 * @param {string} line
 */
const fetchesToRun = (line) =>
    line
        .split(/&&|\|\||;|\||&|\$\(|`/)
        .map((command) => command.split(/[\s"'()<>]+/).filter(Boolean))
        .some((words) => {
            const at = words.findIndex((word) => !LEAD.test(word));
            const first = words[at] ?? '';
            if (isTool(first, 'npx')) return mayFetch(words, at + 1, true);
            if (!isTool(first, 'npm')) return false;
            const sub = operandAt(words, at + 1);
            const subcommand = sub < 0 ? '' : (words[sub] ?? '');
            if (subcommand === 'exec' || subcommand === 'x') return mayFetch(words, sub + 1, false);
            if (subcommand === 'create') return true;
            if (subcommand === 'init' || subcommand === 'innit')
                return operandAt(words, sub + 1) >= 0;
            return false;
        });
const FLAG_OFF = new RegExp(`${FLAG}(?![=\\w-])|${FLAG}=(["']?)true\\1(?![\\w-])`, 'i');

/** The flags that stop an install fetching from git and from a URL, built from their parts. */
const FETCH_OFF = ['git', 'remote'].map(
    (kind) =>
        new RegExp(`${['--allow', '-'].join('')}${kind}(?:=|\\s+)(["']?)none\\1(?![\\w-])`, 'i')
);

/**
 * Whether a line runs an install outside the project, by `--prefix` or `-C`, or into npm's global
 * folder, without the flags that hold what the project's `.npmrc` would: install scripts off, and
 * git and URL dependencies stopped, by their two flags or by `--offline`, which fetches nothing.
 * Each command on the line is judged by its own words.
 *
 * @param {string} line
 */
const installsOutside = (line) =>
    line
        .split(/&&|\|\||;|\||&/)
        .some(
            (command) =>
                INSTALL.test(command) &&
                ELSEWHERE.test(command) &&
                (!FLAG_OFF.test(command) ||
                    !(
                        /\s--offline\b/.test(command) ||
                        FETCH_OFF.every((flag) => flag.test(command))
                    ))
        );

/**
 * What a line does that the settings do not hold, or undefined: turns install scripts back on, with
 * the flag given any value npm reads as false or negated, the environment setting given any value
 * but true, or a write of one of the settings to the project's `.npmrc`. Installs outside the
 * project without the flags that hold its settings. Lets npm fetch from git or a URL, with a flag
 * or a setting given any value but none. Or fetches a package to run it.
 *
 * @param {string} line
 * @returns {string | undefined}
 */
const lineProblem = (line) => {
    const flagOn =
        FLAG_FALSE.test(line) ||
        [...line.matchAll(FLAG_VALUE)].some(([, value = '']) => plain(value) !== 'true');
    const setOn = [...line.matchAll(SETTING_VALUE)].some(
        ([, value = '']) => plain(value) !== 'true'
    );
    if (flagOn || setOn || writesProject(line)) return 'turns install scripts back on';
    if (installsOutside(line))
        return 'installs outside the project, where its .npmrc is not read, without the flags that hold its settings';
    const fetchOn = [
        ...line.matchAll(FETCH_FLAG_VALUE),
        ...line.matchAll(FETCH_SETTING_VALUE),
    ].some(([, value = '']) => plain(value) !== 'none');
    if (fetchOn) return 'lets npm fetch dependencies from git or URLs';
    if (fetchesToRun(line))
        return 'may fetch a package to run it, without --no, or --no-install for npx, to stop it';
    return undefined;
};

/**
 * Each line of a file that lets npm do what the settings stop: one that sets install scripts on, or
 * git or URL dependencies allowed, by a flag or an `npm_config_` setting, one that writes a setting
 * to the project's `.npmrc` with npm's config command, an install outside the project without the
 * flags that hold its settings, and a run of npx, or npm's exec, create or init command, that may
 * fetch a package to run it.
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
            const problem = lineProblem(line);
            return problem === undefined
                ? []
                : [`${path}:${index + 1}  ${problem}\n    ${line.trim()}`];
        });
}

/** The first npm that reads `allow-git` and `allow-remote`, which the settings rely on. */
const NPM_FLOOR = [11, 14, 0];

/**
 * What is wrong with the npm that runs the check, given its version: older than the first that
 * reads `allow-git` and `allow-remote`, a prerelease of it included, so it would pass over both
 * settings without a word. The floor is held here rather than by `engines.npm`, since Dependabot's
 * npm updater reads that field and may refuse to run on an older npm.
 *
 * @param {string} version
 * @returns {string[]}
 */
export function npmFloorProblems(version) {
    const written = version.trim();
    // The release's own numbers end at the first hyphen, which starts a prerelease, or plus sign,
    // which starts build details. Found by a plain search, so a long version costs one pass.
    const cut = [...written].findIndex((char) => char === '-' || char === '+');
    const release = cut < 0 ? written : written.slice(0, cut);
    const prerelease = cut >= 0 && written[cut] === '-';
    const parts = release.split('.').map(Number);
    const differs = NPM_FLOOR.findIndex((part, index) => (parts[index] ?? 0) !== part);
    // A prerelease of the floor itself comes before the release, so it may not read the settings.
    const enough = differs < 0 ? !prerelease : (parts[differs] ?? 0) > (NPM_FLOOR[differs] ?? 0);
    return enough
        ? []
        : [
              `npm ${written} is older than ${NPM_FLOOR.join('.')}, the first that reads allow-git and allow-remote, so it would pass over both`,
          ];
}
