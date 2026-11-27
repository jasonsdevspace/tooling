/**
 * Reading the npm commands a workflow, a composite action or a Dockerfile runs, and which of them
 * install packages with their install scripts on.
 */

/** npm's subcommands that install, or that run packages' install scripts, in every spelling. */
const INSTALLS = new Set(
    (
        'ci clean-install ic install-clean isntall-clean i in ins inst insta instal install isnt ' +
        'isnta isntal isntall add it cit sit install-test install-ci-test clean-install-test ' +
        'rebuild rb update up upgrade udpate dedupe ddp link ln'
    ).split(' ')
);

/** npm's subcommands that fetch a package and run it, as npx does. */
const EXECS = new Set(['exec', 'x']);

/** npm's subcommands that fetch an initializer and run it when given one. */
const INITS = new Set(['init', 'create', 'innit']);

/** npm's other subcommands, so a word that is none of these is read as a flag's value. */
const OTHERS = new Set(
    (
        'run run-script rum urn pack view info show v version test tst t publish stage query ls ' +
        'list la ll audit config c pkg prune uninstall remove rm r un unlink start stop restart ' +
        'cache doctor explain why fund outdated owner search token whoami help bin root prefix ' +
        'sbom diff completion edit explore find-dupes get set hook login logout adduser org team ' +
        'access deprecate dist-tag ping profile repo docs home bugs shrinkwrap star stars unstar ' +
        'unpublish'
    ).split(' ')
);

/** npm's flags that take the word after them as their value, when written without `=`. */
const VALUED = new Set([
    '--loglevel',
    '--prefix',
    '-w',
    '--workspace',
    '--cache',
    '-C',
    '--userconfig',
]);

/**
 * An npm or npx command: whether npx runs it, its subcommand (`exec` for npx), the words before
 * the subcommand and the words after it, and the text it was read from.
 *
 * @typedef {object} NpmCommand
 * @property {boolean} npx
 * @property {string} command
 * @property {readonly string[]} flags
 * @property {readonly string[]} args
 * @property {string} text
 */

/**
 * A script a workflow step or a Dockerfile instruction runs, the line of the file it starts on,
 * and for a step that names one, the folder it runs in.
 *
 * @typedef {object} Run
 * @property {string} run
 * @property {number} line
 * @property {string} [dir]
 */

/**
 * Whether a command's flags, before and after its subcommand, leave install scripts off, the last
 * that names them deciding, as npm reads them.
 *
 * @param {NpmCommand} command
 * @returns {boolean}
 */
export function skipsScripts({ flags, args }) {
    const words = [...flags, ...args];
    let off = false;
    words.forEach((word, index) => {
        if (word === '--ignore-scripts') off = words[index + 1] !== 'false';
        else if (word === '--ignore-scripts=true') off = true;
        else if (word === '--ignore-scripts=false' || word === '--no-ignore-scripts') off = false;
    });
    return off;
}

/**
 * npx's own options, before the tool it runs, with the value of each option that takes one passed
 * over, so the package `-p` names is not taken for the tool.
 *
 * @param {readonly string[]} words
 */
const optionsBeforeTool = (words) => {
    /** @type {string[]} */
    const options = [];
    for (let at = 0; at < words.length; at += 1) {
        const word = words[at] ?? '';
        if (word === '--' || !word.startsWith('-')) break;
        options.push(word);
        if (['--package', '-p', '--call', '-c'].includes(word)) at += 1;
    }
    return options;
};

/**
 * Whether a command installs packages, and so may run their install scripts: one of npm's install
 * subcommands, npx or `npm exec` unless `--no-install` is among their own options, or `npm init`
 * and `npm create` given an initializer, which they fetch and run.
 *
 * @param {NpmCommand} command
 * @returns {boolean}
 */
export function installs({ command, flags, args }) {
    if (INSTALLS.has(command)) return true;
    if (EXECS.has(command)) return ![...flags, ...optionsBeforeTool(args)].includes('--no-install');
    if (INITS.has(command)) return args.some((word) => !word.startsWith('-'));
    return false;
}

/**
 * The scripts a line hands to another shell, `sh -c '...'` and its kin, each set on a line of its
 * own so the quotes around it do not hide what it runs.
 *
 * @param {string} script
 */
const shellsOpened = (script) => script.replace(/\b(?:ba|da|z)?sh\s+-c\s+(["'])(.*?)\1/g, '\n$2\n');

/**
 * One part of a script, split at its separators, read as an npm or npx command if it holds one.
 * The subcommand is the first word npm knows, past any flag and the value of a flag that takes one.
 *
 * @param {string} part
 * @returns {NpmCommand[]}
 */
const commandOf = (part) => {
    const words = part.trim().split(/\s+/).filter(Boolean);
    const at = words.findIndex((word) => word === 'npm' || word === 'npx');
    if (at < 0) return [];
    const rest = words.slice(at + 1);
    const text = part.trim();
    if (words[at] === 'npx') return [{ npx: true, command: 'exec', flags: [], args: rest, text }];
    let index = 0;
    while (index < rest.length) {
        const word = rest[index] ?? '';
        if (INSTALLS.has(word) || EXECS.has(word) || INITS.has(word) || OTHERS.has(word)) break;
        index += VALUED.has(word) ? 2 : 1;
    }
    return [
        {
            npx: false,
            command: rest[index] ?? '',
            flags: rest.slice(0, index),
            args: rest.slice(index + 1),
            text,
        },
    ];
};

/**
 * Each npm or npx command in a script, wherever it sits: after a keyword, an assignment or another
 * command, inside parentheses, another shell or a substitution, with continued lines joined. Single
 * quotes run nothing, so a message there that names a command is not one, while double quotes still
 * run a substitution, backticks included, as bash does, and an escaped backtick or dollar sign is
 * only text. A quoted word reads as the word, a quoted
 * string with a space reads as nothing, and a redirection and its target are no part of a command.
 *
 * @param {string} script
 * @returns {NpmCommand[]}
 */
export function npmCommandsIn(script) {
    return shellsOpened(script.replace(/\\\n\s*/g, ' ').replace(/\\["'`$]/g, ''))
        .replace(/'[^'\n]*\s[^'\n]*'/g, "''")
        .replace(/\$\(([^()]*)\)|`([^`]*)`/g, '\n$1$2\n')
        .replace(/\d*(?:>>?|<)&?\s*[^\s;&|]*/g, ' ')
        .replace(/"([^"\s]*)"|'([^'\s]*)'/g, '$1$2')
        .replace(/"[^"\n]*"|'[^'\n]*'/g, '""')
        .split(/\n|&&|\|\||;|\||&|\(|\)/)
        .flatMap(commandOf);
}

/**
 * A YAML value that is one double- or single-quoted scalar, unquoted, or undefined if it is not.
 *
 * @param {string} value
 * @returns {string | undefined}
 */
const unquoted = (value) => {
    const double = /^"((?:[^"\\]|\\.)*)"\s*$/.exec(value)?.[1];
    if (double !== undefined) return double.replace(/\\(.)/g, '$1');
    return /^'((?:[^']|'')*)'\s*$/.exec(value)?.[1]?.replace(/''/g, "'");
};

/**
 * A block scalar's lines after its header: those indented past the step's keys.
 *
 * @param {readonly string[]} lines
 * @param {number} keys
 */
const blockAfter = (lines, keys) => {
    /** @type {string[]} */
    const block = [];
    for (const next of lines) {
        if (next.trim() === '') block.push('');
        else if ((/^ */.exec(next)?.[0].length ?? 0) > keys) block.push(next);
        else break;
    }
    return block;
};

/**
 * A YAML file with every comment blanked and its line ends made plain, each comment line left
 * empty, so a line number still points at the same line.
 *
 * @param {string} text
 */
const withoutComments = (text) =>
    `${text}\n`
        .replace(/\r\n/g, '\n')
        .replace(/^[ \t]*#.*$/gm, '')
        .replace(/[ \t]+#[ \t].*$/gm, '');

/**
 * The folder a step names to run in, read from the lines of the step that holds line `at`: from its
 * dash to the next line indented no further than the dash.
 *
 * @param {readonly string[]} lines
 * @param {number} at
 * @returns {string | undefined}
 */
const dirAround = (lines, at) => {
    const indentOf = (/** @type {string} */ line) => /^ */.exec(line)?.[0].length ?? 0;
    let start = at;
    while (start > 0 && !/^ *- /.test(lines[start] ?? '')) start -= 1;
    const dash = indentOf(lines[start] ?? '');
    let end = start + 1;
    while (
        end < lines.length &&
        ((lines[end] ?? '').trim() === '' || indentOf(lines[end] ?? '') > dash)
    )
        end += 1;
    for (const line of lines.slice(start, end)) {
        const found = /^ *(?:- )?working-directory: *(.+?) *$/.exec(line);
        if (found) return unquoted(found[1] ?? '') ?? found[1];
    }
    return undefined;
};

/**
 * What each step of a workflow or composite action runs, the line its `run:` key sits on, and the
 * folder it names to run in, if it names one: the
 * value, unquoted where it is one quoted scalar, a block's lines under it with its indent and
 * chomping read in either order, a folded block joined into one, and nothing of the step's other
 * keys, so a step's name is not read as a command.
 *
 * @param {string} text
 * @returns {Run[]}
 */
export function runsOf(text) {
    const lines = withoutComments(text).split('\n');
    /** @type {Run[]} */
    const runs = [];
    lines.forEach((line, at) => {
        const found = /^( *)(- )?run: *(.*)$/.exec(line);
        if (!found) return;
        const [, indent = '', dash = '', value = ''] = found;
        const quoted = unquoted(value);
        /** @type {string} */
        let run = quoted ?? value;
        if (quoted === undefined && /^[|>](?:[-+]?\d*|\d+[-+])\s*$/.test(value)) {
            // Under a dash the step's keys sit two past it, so a block's lines sit further in.
            const block = blockAfter(lines.slice(at + 1), indent.length + dash.length);
            run = value.startsWith('>') ? block.join(' ') : block.join('\n');
        }
        const dir = dirAround(lines, at);
        runs.push(dir === undefined ? { run, line: at + 1 } : { run, line: at + 1, dir });
    });
    return runs;
}

/**
 * The instruction that starts at line `at`, its continued lines joined, and the line after it.
 *
 * @param {readonly string[]} lines
 * @param {number} at
 */
const instructionAt = (lines, at) => {
    let end = at;
    let joined = lines[at] ?? '';
    while (joined.endsWith('\\') && end + 1 < lines.length) {
        end += 1;
        joined = `${joined.slice(0, -1)} ${lines[end] ?? ''}`;
    }
    return { joined, next: end + 1 };
};

/**
 * A heredoc's lines from line `at` up to its terminator, a dashed one ignoring leading tabs, and the
 * line after the terminator.
 *
 * @param {readonly string[]} lines
 * @param {number} at
 * @param {boolean} dashed
 * @param {string} end
 */
const heredocAt = (lines, at, dashed, end) => {
    /** @type {string[]} */
    const body = [];
    let next = at;
    for (; next < lines.length; next += 1) {
        const line = lines[next] ?? '';
        if ((dashed ? line.replace(/^\t+/, '') : line) === end) break;
        body.push(line);
    }
    return { body: body.join('\n'), next: next + 1 };
};

/**
 * An exec-form instruction's words joined as a script, or the text as it is when it is not a JSON
 * list.
 *
 * @param {string} rest
 */
const execFormOf = (rest) => {
    try {
        /** @type {unknown} */
        const words = JSON.parse(rest);
        return Array.isArray(words) ? words.map(String).join(' ') : rest;
    } catch {
        return rest;
    }
};

/**
 * What a Dockerfile runs, and the line each `RUN` starts on: the shell form with its continued
 * lines joined, the exec form read as its words, or a heredoc's lines up to its terminator, and
 * none of its comments.
 *
 * @param {string} text
 * @returns {Run[]}
 */
export function dockerRunsOf(text) {
    const lines = text.replace(/\r\n/g, '\n').split('\n');
    /** @type {Run[]} */
    const runs = [];
    let at = 0;
    while (at < lines.length) {
        const line = at + 1;
        const { joined, next } = instructionAt(lines, at);
        at = next;
        const rest = /^\s*RUN\s+(.*)$/i.exec(joined)?.[1];
        if (rest === undefined) continue;
        const heredoc = /<<(-?)["']?(\w+)["']?/.exec(rest);
        if (heredoc) {
            const found = heredocAt(lines, at, heredoc[1] === '-', heredoc[2] ?? '');
            at = found.next;
            runs.push({ run: found.body, line });
        } else {
            runs.push({ run: rest.trim().startsWith('[') ? execFormOf(rest) : rest, line });
        }
    }
    return runs;
}
