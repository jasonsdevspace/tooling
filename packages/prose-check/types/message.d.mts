/**
 * The prefix of git's comment lines in a message, from the repository's setting. For `auto`, it is
 * the prefix of git's own "Please enter" line when the message holds one, and otherwise the first
 * character git picks from that no line starts with, as git works it out. An empty setting is `#`.
 *
 * @param {string} raw
 * @param {string} setting
 * @returns {string}
 */
export function commentOf(raw: string, setting: string): string;
/**
 * The message git will store: for a message git let the author edit, everything above the
 * scissors line without git's comment lines, with the comment prefix worked out from the
 * repository's setting as `commentOf` does, and for any other message, every line.
 *
 * @param {string} raw
 * @param {string} commentChar
 * @returns {string}
 */
export function storedMessage(raw: string, commentChar: string): string;
/**
 * The text to check, line for line as the author wrote it: the lines git will store, with any
 * comment lines it strips blanked and the diff below the scissors left out, or, for one GitHub
 * writes as it is, such as a pull request's title and body, every line of it.
 *
 * @param {string} raw
 * @param {string} commentChar
 * @param {boolean} asIs
 * @returns {string}
 */
export function textToCheck(raw: string, commentChar: string, asIs: boolean): string;
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
export function messageProblems(message: string, { titleAndBody }?: {
    titleAndBody?: boolean;
}): string[];
/** The names of tools a message must not carry, and a bot or an assistant as a co-author. */
export const TOOLS: RegExp[];
