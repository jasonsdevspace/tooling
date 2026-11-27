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

/**
 * The message git will store: everything above the scissors line that `git commit -v` adds
 * before the diff, without git's own comment lines. The scissors line is found by its shape,
 * whatever comment prefix git wrote on it, since with `core.commentChar` set to `auto` git picks
 * one per commit. When there is one, its prefix marks the comment lines in place of the one
 * passed in.
 *
 * @param {string} raw
 * @param {string} commentChar
 * @returns {string}
 */
export function storedMessage(raw, commentChar) {
    const lines = raw.split('\n');
    const scissors = lines.findIndex((line) => /^\S+ -{24} >8 -{24}$/.test(line));
    const comment = scissors === -1 ? commentChar : (lines[scissors]?.split(' ')[0] ?? commentChar);
    return (scissors === -1 ? lines : lines.slice(0, scissors))
        .filter((line) => !line.startsWith(comment))
        .join('\n');
}

/**
 * The text to check: the message as git will store it, or, for one GitHub writes as it is, such
 * as a pull request's title and body, every line of it.
 *
 * @param {string} raw
 * @param {string} commentChar
 * @param {boolean} asIs
 * @returns {string}
 */
export function textToCheck(raw, commentChar, asIs) {
    return asIs ? raw : storedMessage(raw, commentChar);
}

/** How a broken prose rule reads in the refusal, the two the house names most in plain words. */
const SAID = new Map([
    ['em dash', 'uses an em dash'],
    ['semicolon in prose', 'joins clauses with a semicolon'],
]);

/**
 * What is wrong with a message, one entry per tool named and per prose rule broken, each rule
 * named once, at the first line that breaks it.
 *
 * @param {string} message
 * @returns {string[]}
 */
export function messageProblems(message) {
    /** @type {Map<string, string>} */
    const rules = new Map();
    for (const problem of proseProblems('message.md', message)) {
        const [, line = '', rule = ''] = /^message\.md:(\d+) {2}(.+)$/m.exec(problem) ?? [];
        if (!rules.has(rule))
            rules.set(rule, SAID.get(rule) ?? `breaks the ${rule} rule on line ${line}`);
    }
    return [
        ...TOOLS.filter((pattern) => pattern.test(message)).map(
            (pattern) => `names a tool (${String(pattern)})`
        ),
        ...rules.values(),
    ];
}
