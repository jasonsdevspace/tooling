/**
 * The commit message check: a message that names a tool rather than the work, or breaks a prose
 * rule, is refused.
 *
 * A commit explains what changed and why. The name of whatever wrote it, human or otherwise, is
 * not part of that, so the message is refused before the commit exists rather than cleaned up
 * after. The message is prose a reader sees, a squashed pull request's title becoming the commit
 * on main, so it is held to every prose rule, read as Markdown, as a pull request's body is
 * written. The `check-commit-message` command runs it, from a commit hook with the path to the
 * message file, and from CI with `--as-is` for a pull request's title and body as written.
 */
import { proseProblems } from './rules.mjs';

/** The names of tools a message must not carry, and a bot or an assistant as a co-author. */
export const TOOLS = [
    /\bclaude\b/i,
    /\banthropic\b/i,
    /\bchatgpt\b/i,
    /\bopenai\b/i,
    /\bcodex\b/i,
    /\bgemini\b/i,
    /\bco[\s._-]?pilot\b/i,
    /\bllms?\b/i,
    /\bgenerated (by|with)\b/i,
    /^co-authored-by:.*\b(bot|ai)\b/im,
];

/** The characters git picks from, in order, when `core.commentChar` is `auto`. */
const AUTO_COMMENTS = ['#', ';', '@', '!', '$', '%', '^', '&', '|', ':'];

/**
 * The prefix of git's comment lines in a message, from the repository's setting. For `auto`, it is
 * the prefix of git's own "Please enter" line when the message holds one, and otherwise the first
 * character git picks from that no line starts with, as git works it out. An empty setting is `#`.
 *
 * @param {string} raw
 * @param {string} setting
 * @returns {string}
 */
export function commentOf(raw, setting) {
    if (setting !== 'auto') return setting === '' ? '#' : setting;
    const said = /^(\S+) Please enter (?:the|a) commit message/m.exec(raw)?.[1];
    if (said !== undefined) return said;
    const lines = raw.split('\n');
    return AUTO_COMMENTS.find((char) => !lines.some((line) => line.startsWith(char))) ?? '#';
}

/**
 * Each line of a message as written, with git's comment lines blanked rather than dropped, so a
 * line keeps its number, and everything from the scissors line that `git commit -v` adds before
 * the diff left out. The scissors line is found by its shape, whatever comment prefix git wrote on
 * it, and its prefix marks the comment lines in place of the one worked out from the setting.
 *
 * @param {string} raw
 * @param {string} setting
 * @returns {string[]}
 */
const keptLines = (raw, setting) => {
    const lines = raw.split('\n');
    const scissors = lines.findIndex((line) => /^\S+ -{24} >8 -{24}$/.test(line));
    const comment =
        scissors === -1 ? commentOf(raw, setting) : (lines[scissors]?.split(' ')[0] ?? '#');
    return (scissors === -1 ? lines : lines.slice(0, scissors)).map((line) =>
        line.startsWith(comment) ? '' : line
    );
};

/**
 * The message git will store: everything above the scissors line, without git's own comment
 * lines, with the comment prefix worked out from the repository's setting as `commentOf` does.
 *
 * @param {string} raw
 * @param {string} commentChar
 * @returns {string}
 */
export function storedMessage(raw, commentChar) {
    const lines = raw.split('\n');
    return keptLines(raw, commentChar)
        .filter((line, index) => line !== '' || lines[index] === '')
        .join('\n');
}

/**
 * The text to check, line for line as the author wrote it: the message with git's comment lines
 * blanked and the diff below the scissors left out, or, for one GitHub writes as it is, such as a
 * pull request's title and body, every line of it.
 *
 * @param {string} raw
 * @param {string} commentChar
 * @param {boolean} asIs
 * @returns {string}
 */
export function textToCheck(raw, commentChar, asIs) {
    return asIs ? raw : keptLines(raw, commentChar).join('\n');
}

/** How a broken prose rule reads in the refusal, the two the house names most in plain words. */
const SAID = new Map([
    ['em dash', 'uses an em dash'],
    ['semicolon in prose', 'joins clauses with a semicolon'],
]);

/**
 * What is wrong with a message, one entry per tool named and per prose rule broken, each rule
 * named once, at the first line that breaks it. With `titleAndBody`, the message is a pull
 * request's title, a blank line and its body, so a line is named as the title or by its number in
 * the body.
 *
 * @param {string} message
 * @param {{ titleAndBody?: boolean }} [options]
 * @returns {string[]}
 */
export function messageProblems(message, { titleAndBody = false } = {}) {
    /** @type {(line: number) => string} */
    const where = (line) => {
        if (!titleAndBody) return `on line ${line}`;
        return line === 1 ? 'in the title' : `on line ${line - 2} of the body`;
    };
    /** @type {Map<string, string>} */
    const rules = new Map();
    for (const problem of proseProblems('message.md', message)) {
        const [, line = '0', rule = ''] = /^message\.md:(\d+) {2}(.+)$/m.exec(problem) ?? [];
        if (!rules.has(rule))
            rules.set(
                rule,
                `${SAID.get(rule) ?? `breaks the ${rule} rule`} ${where(Number(line))}`
            );
    }
    return [
        ...TOOLS.filter((pattern) => pattern.test(message)).map(
            (pattern) => `names a tool (${String(pattern)})`
        ),
        ...rules.values(),
    ];
}
