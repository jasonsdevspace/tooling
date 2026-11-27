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
export function skipsScripts({ flags, args }: NpmCommand): boolean;
/**
 * Whether a command installs packages, and so may run their install scripts: one of npm's install
 * subcommands, npx or `npm exec` unless `--no-install` is among their own options, or `npm init`
 * and `npm create` given an initializer, which they fetch and run.
 *
 * @param {NpmCommand} command
 * @returns {boolean}
 */
export function installs({ command, flags, args }: NpmCommand): boolean;
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
export function npmCommandsIn(script: string): NpmCommand[];
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
export function runsOf(text: string): Run[];
/**
 * What a Dockerfile runs, and the line each `RUN` starts on: the shell form with its continued
 * lines joined, the exec form read as its words, or a heredoc's lines up to its terminator, and
 * none of its comments.
 *
 * @param {string} text
 * @returns {Run[]}
 */
export function dockerRunsOf(text: string): Run[];
/**
 * An npm or npx command: whether npx runs it, its subcommand (`exec` for npx), the words before
 * the subcommand and the words after it, and the text it was read from.
 */
export type NpmCommand = {
    npx: boolean;
    command: string;
    flags: readonly string[];
    args: readonly string[];
    text: string;
};
/**
 * A script a workflow step or a Dockerfile instruction runs, the line of the file it starts on,
 * and for a step that names one, the folder it runs in.
 */
export type Run = {
    run: string;
    line: number;
    dir?: string;
};
