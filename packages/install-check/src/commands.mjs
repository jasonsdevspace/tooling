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
 * npx's own options, before the tool it runs, with the value of each option that takes one passed
 * over, so the package `-p` names is not taken for the tool. They end at the tool or at `--`.
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
 * The words npm reads a command's own settings from: every word of an install, but for npx and
 * `npm exec` only npm's options before the subcommand and npx's own before the tool, since a flag
 * after the tool, or after `--`, belongs to the tool.
 *
 * @param {NpmCommand} command
 */
const ownWordsOf = ({ command, flags, args }) =>
    EXECS.has(command) ? [...flags, ...optionsBeforeTool(args)] : [...flags, ...args];

/**
 * Whether a command leaves install scripts off, the last of its own flags that names them deciding,
 * as npm reads them.
 *
 * @param {NpmCommand} command
 * @returns {boolean}
 */
export function skipsScripts(command) {
    const words = ownWordsOf(command);
    let off = false;
    words.forEach((word, index) => {
        if (word === '--ignore-scripts') off = words[index + 1] !== 'false';
        else if (word === '--ignore-scripts=true') off = true;
        else if (word === '--ignore-scripts=false' || word === '--no-ignore-scripts') off = false;
    });
    return off;
}

/** The flags of `npm init` that take the word after them as their value. */
const INIT_VALUED = new Set(['-w', '--workspace', '--scope']);

/**
 * The initializer `npm init` or `npm create` is given, past its flags and the value of each flag
 * that takes one, or undefined when it is given none.
 *
 * @param {readonly string[]} args
 * @returns {string | undefined}
 */
const initializerOf = (args) => {
    for (let at = 0; at < args.length; at += 1) {
        const word = args[at] ?? '';
        if (word === '--') return args[at + 1];
        if (!word.startsWith('-')) return word;
        if (INIT_VALUED.has(word) || (word.startsWith('--init-') && !word.includes('='))) at += 1;
    }
    return undefined;
};

/**
 * Whether a command installs packages, and so may run their install scripts: one of npm's install
 * subcommands, npx or `npm exec` unless `--no-install` is among their own options, or `npm init`
 * and `npm create` given an initializer, which they fetch and run.
 *
 * @param {NpmCommand} command
 * @returns {boolean}
 */
export function installs(command) {
    if (INSTALLS.has(command.command)) return true;
    if (EXECS.has(command.command)) return !ownWordsOf(command).includes('--no-install');
    if (INITS.has(command.command)) return initializerOf(command.args) !== undefined;
    return false;
}

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
 * Whether what is read so far ends by starting another shell on its next word, as `sh -c` does.
 *
 * @param {string} text
 */
const opensShell = (text) => /\b(?:ba|da|z)?sh\s+-c\s*$/.test(text);

/**
 * The index of the `)` that closes the `(` at `start`, counting the parentheses inside it.
 *
 * @param {string} script
 * @param {number} start
 */
const closeOf = (script, start) => {
    let depth = 0;
    for (let at = start; at < script.length; at += 1) {
        if (script[at] === '(') depth += 1;
        else if (script[at] === ')') {
            depth -= 1;
            if (depth === 0) return at;
        }
    }
    return script.length;
};

/**
 * The double-quoted string whose opening quote is at `start`: its text as one word, the scripts its
 * substitutions run, and the index after its closing quote. An escaped quote or backslash is the
 * character, and an escaped backtick or dollar sign is only text, so neither opens a substitution.
 *
 * @param {string} script
 * @param {number} start
 */
const doubleQuotedAt = (script, start) => {
    let literal = '';
    /** @type {string[]} */
    const runs = [];
    let at = start + 1;
    while (at < script.length && script[at] !== '"') {
        const char = script[at] ?? '';
        const next = script[at + 1] ?? '';
        if (char === '\\') {
            literal += next === '$' || next === '`' ? '_' : next;
            at += 2;
        } else if (char === '$' && next === '(') {
            const end = closeOf(script, at + 1);
            runs.push(script.slice(at + 2, end));
            literal += '_';
            at = end + 1;
        } else if (char === '`') {
            const end = script.indexOf('`', at + 1);
            const stop = end < 0 ? script.length : end;
            runs.push(script.slice(at + 1, stop));
            literal += '_';
            at = stop + 1;
        } else {
            literal += char;
            at += 1;
        }
    }
    return { literal, runs, next: at + 1 };
};

/**
 * A piece of a script as it reads: its text, and the index after it.
 *
 * @typedef {object} Piece
 * @property {string} text
 * @property {number} next
 */

/**
 * An escaped character outside quotes, which is text: itself where it cannot change how the line
 * splits, and a plain character otherwise.
 *
 * @param {string} script
 * @param {number} at
 * @returns {Piece}
 */
const escapedAt = (script, at) => {
    const next = script[at + 1] ?? '';
    return { text: /[\w.\-/@=:,+]/.test(next) ? next : '_', next: at + 2 };
};

/**
 * A single-quoted string, which runs nothing: its text as one word, or an empty pair when it holds
 * a space and so is a message, or read as a script when it opens another shell.
 *
 * @param {string} script
 * @param {number} at
 * @param {boolean} opens
 * @returns {Piece}
 */
const singleQuotedAt = (script, at, opens) => {
    const end = script.indexOf("'", at + 1);
    const stop = end < 0 ? script.length : end;
    const body = script.slice(at + 1, stop);
    if (opens) return { text: `\n${unquotedScript(body)}\n`, next: stop + 1 };
    return { text: /\s/.test(body) ? "''" : body, next: stop + 1 };
};

/**
 * A double-quoted string: its text as one word, or an empty pair when it holds a space, followed by
 * each substitution it runs on a line of its own, or read as a script when it opens another shell.
 *
 * @param {string} script
 * @param {number} at
 * @param {boolean} opens
 * @returns {Piece}
 */
const doubleQuotedPieceAt = (script, at, opens) => {
    const { literal, runs, next } = doubleQuotedAt(script, at);
    if (opens) {
        const raw = script.slice(at + 1, next - 1).replace(/\\(["\\$`])/g, '$1');
        return { text: `\n${unquotedScript(raw)}\n`, next };
    }
    const word = /\s/.test(literal) ? '""' : literal;
    return { text: word + runs.map((run) => `\n${unquotedScript(run)}\n`).join(''), next };
};

/**
 * The piece of a script that starts at `at`, given what is read before it: an escaped character, a
 * quoted string, a comment from a `#` that starts a word to the line's end, or one character.
 *
 * @param {string} script
 * @param {number} at
 * @param {string} before
 * @returns {Piece}
 */
const pieceAt = (script, at, before) => {
    const char = script[at] ?? '';
    if (char === '\\') return escapedAt(script, at);
    if (char === "'") return singleQuotedAt(script, at, opensShell(before));
    if (char === '"') return doubleQuotedPieceAt(script, at, opensShell(before));
    if (char === '#' && (before === '' || /\s$/.test(before))) {
        const end = script.indexOf('\n', at);
        return { text: '', next: end < 0 ? script.length : end };
    }
    return { text: char, next: at + 1 };
};

/**
 * A script with its quotes read in one pass, left to right, as bash reads them. Single quotes run
 * nothing, so their text is one word, or an empty pair when it holds a space and so is a message.
 * Double quotes are read the same way, except that each substitution inside them runs, set on a line
 * of its own. A quoted string that opens another shell, as after `sh -c`, is read as a script. An
 * escaped character is text, and a `#` that starts a word starts a comment.
 *
 * @param {string} script
 * @returns {string}
 */
const unquotedScript = (script) => {
    let out = '';
    let at = 0;
    while (at < script.length) {
        const piece = pieceAt(script, at, out);
        out += piece.text;
        at = piece.next;
    }
    return out;
};

/**
 * Each npm or npx command in a script, wherever it sits: after a keyword, an assignment or another
 * command, inside parentheses, another shell, a substitution or a process substitution, with
 * continued lines joined and quotes read as bash reads them. A redirection and its target are no
 * part of a command.
 *
 * @param {string} script
 * @returns {NpmCommand[]}
 */
export function npmCommandsIn(script) {
    return unquotedScript(script.replace(/\\\n\s*/g, ' '))
        .replace(/\$\(([^()]*)\)|`([^`]*)`/g, '\n$1$2\n')
        .replace(/\d*(?:>>?|<)(?!\()&?\s*[^\s;&|()]*/g, ' ')
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
 * A YAML value without the comment after it: a `#` that starts a word, outside any quotes.
 *
 * @param {string} value
 */
const withoutComment = (value) => {
    let quote = '';
    for (let at = 0; at < value.length; at += 1) {
        const char = value[at] ?? '';
        const wordStart = at === 0 || /\s/.test(value[at - 1] ?? '');
        if (quote !== '') {
            if (char === '\\' && quote === '"') at += 1;
            else if (char === quote) quote = '';
        } else if ((char === '"' || char === "'") && wordStart) quote = char;
        else if (char === '#' && wordStart) return value.slice(0, at).trimEnd();
    }
    return value;
};

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
        if (found) {
            const value = withoutComment(found[1] ?? '');
            return unquoted(value) ?? value;
        }
    }
    return undefined;
};

/**
 * What each step of a workflow or composite action runs, the line its `run:` key sits on, and the
 * folder it names to run in, if it names one: the value, unquoted where it is one quoted scalar, a block's lines under it with its indent and
 * chomping read in either order, a folded block joined into one, and nothing of the step's other
 * keys, so a step's name is not read as a command.
 *
 * @param {string} text
 * @returns {Run[]}
 */
export function runsOf(text) {
    const lines = text.replace(/\r\n/g, '\n').split('\n');
    /** @type {Run[]} */
    const runs = [];
    lines.forEach((line, at) => {
        const found = /^( *)(- )?run: *(.*)$/.exec(line);
        if (!found) return;
        const [, indent = '', dash = '', written = ''] = found;
        // A comment is stripped from the key's own line, outside quotes, and never from a block.
        const value = withoutComment(written);
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

/** Whether a Dockerfile line is a comment, which Docker drops before joining continued lines. */
const isComment = (/** @type {string} */ line) => /^\s*#/.test(line);

/**
 * The instruction that starts at line `at`, its continued lines joined past any comment line among
 * them, and the line after it.
 *
 * @param {readonly string[]} lines
 * @param {number} at
 */
const instructionAt = (lines, at) => {
    let end = at;
    let joined = lines[at] ?? '';
    while (joined.endsWith('\\') && end + 1 < lines.length) {
        end += 1;
        const next = lines[end] ?? '';
        if (!isComment(next)) joined = `${joined.slice(0, -1)} ${next}`;
    }
    return { joined, next: end + 1 };
};

/**
 * The heredoc a RUN line opens, if it opens one: a `<<` at the start of a word, naming a terminator
 * that a later line holds. Its body is the lines from line `at` to that terminator, a dashed one
 * ignoring leading tabs, and the line after the terminator is where reading goes on.
 *
 * @param {string} rest
 * @param {readonly string[]} lines
 * @param {number} at
 */
const heredocIn = (rest, lines, at) => {
    const found = /(?:^|\s)<<(-?)(["']?)([A-Za-z_]\w*)\2/.exec(rest);
    if (!found) return undefined;
    const [, dash = '', , end = ''] = found;
    const closes = (/** @type {string} */ line) => (dash ? line.replace(/^\t+/, '') : line) === end;
    const terminator = lines.findIndex((line, index) => index >= at && closes(line));
    if (terminator < 0) return undefined;
    return { body: lines.slice(at, terminator).join('\n'), next: terminator + 1 };
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
 * What a Dockerfile runs, and the line each `RUN` starts on, behind any BuildKit flags: the shell
 * form with its continued lines joined, the exec form read as its words, or a heredoc's own line
 * with its body up to its terminator, and none of its comment lines.
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
        if (isComment(lines[at] ?? '')) {
            at += 1;
            continue;
        }
        const line = at + 1;
        const { joined, next } = instructionAt(lines, at);
        at = next;
        const written = /^\s*RUN\s+(.*)$/i.exec(joined)?.[1];
        if (written === undefined) continue;
        const rest = written.replace(/^(?:--\S+\s+)+/, '');
        const heredoc = heredocIn(rest, lines, at);
        if (heredoc) {
            at = heredoc.next;
            runs.push({ run: `${rest}\n${heredoc.body}`, line });
        } else {
            runs.push({ run: rest.trim().startsWith('[') ? execFormOf(rest) : rest, line });
        }
    }
    return runs;
}
