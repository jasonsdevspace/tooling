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
export function storedMessage(raw: string, commentChar: string): string;
/**
 * The text to check: the message as git will store it, or, for one GitHub writes as it is, such
 * as a pull request's title and body, every line of it.
 *
 * @param {string} raw
 * @param {string} commentChar
 * @param {boolean} asIs
 * @returns {string}
 */
export function textToCheck(raw: string, commentChar: string, asIs: boolean): string;
/**
 * What is wrong with a message, one entry per tool named and per prose rule broken, each rule
 * named once, at the first line that breaks it.
 *
 * @param {string} message
 * @returns {string[]}
 */
export function messageProblems(message: string): string[];
/** The names of tools a message must not carry, and a bot or an assistant as a co-author. */
export const TOOLS: RegExp[];
