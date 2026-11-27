/**
 * Whether a command leaves install scripts off, the last of its own flags that names them deciding,
 * as npm reads them.
 *
 * @param {NpmCommand} command
 * @returns {boolean}
 */
export function skipsScripts(command: NpmCommand): boolean;
/**
 * Whether a command installs packages, and so may run their install scripts: one of npm's install
 * subcommands, npx or `npm exec` unless `--no-install` is among their own options, or `npm init`
 * and `npm create` given an initializer, which they fetch and run.
 *
 * @param {NpmCommand} command
 * @returns {boolean}
 */
export function installs(command: NpmCommand): boolean;
/**
 * Each npm or npx command in a script, wherever it sits: after a keyword, an assignment or another
 * command, inside parentheses, another shell, a substitution or a process substitution, with
 * continued lines joined and quotes read as bash reads them. A redirection and its target are no
 * part of a command.
 *
 * @param {string} script
 * @returns {NpmCommand[]}
 */
export function npmCommandsIn(script: string): NpmCommand[];
/**
 * What each step of a workflow or composite action runs, the line its `run:` key sits on, and the
 * folder it names to run in, if it names one: the value, unquoted where it is one quoted scalar, a block's lines under it with its indent and
 * chomping read in either order, a folded block joined into one, and nothing of the step's other
 * keys, so a step's name is not read as a command.
 *
 * @param {string} text
 * @returns {Run[]}
 */
export function runsOf(text: string): Run[];
/**
 * What a Dockerfile runs, and the line each `RUN` starts on, behind any BuildKit flags: the shell
 * form with its continued lines joined, the exec form read as its words, or a heredoc's own line
 * with its body up to its terminator, and none of its comment lines.
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
/**
 * A piece of a script as it reads: its text, and the index after it.
 */
export type Piece = {
    text: string;
    next: number;
};
