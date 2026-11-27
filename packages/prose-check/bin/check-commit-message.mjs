#!/usr/bin/env node
/**
 * Refuses a commit message that names a tool or breaks a prose rule, saying why and on which line,
 * and passes otherwise. A commit hook runs it with the path to the message file, and CI runs it
 * with `--as-is` on a file holding a pull request's title, a blank line and its body, read as
 * written, lines that start like git's comments included.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { messageProblems, textToCheck } from '../src/message.mjs';

const USAGE = 'usage: check-commit-message [--as-is] <path to the commit message>';

/**
 * What the repository sets git to start a comment line with, empty when unset. Newer git reads
 * `core.commentString` as well as `core.commentChar`, and whichever comes last in its config wins.
 * `auto` is passed on as it is, for the check to work out from the message as git does.
 *
 * @returns {string}
 */
const commentSetting = () => {
    try {
        const settings = execFileSync(
            'git',
            ['config', '--get-regexp', '^core\\.comment(char|string)$'],
            { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
        ).trim();
        return settings.split('\n').at(-1)?.split(' ').slice(1).join(' ') ?? '';
    } catch {
        return '';
    }
};

const args = process.argv.slice(2);
const asIs = args.includes('--as-is');
const paths = args.filter((arg) => arg !== '--as-is');
const [messagePath] = paths;
if (paths.length !== 1 || messagePath === undefined || messagePath.startsWith('--')) {
    console.error(USAGE);
    process.exit(2);
}
/** @type {string} */
let raw;
try {
    raw = readFileSync(messagePath, 'utf8');
} catch (error) {
    console.error(
        `check-commit-message: ${error instanceof Error ? error.message : String(error)}`
    );
    console.error(USAGE);
    process.exit(2);
}
const problems = messageProblems(textToCheck(raw, commentSetting(), asIs), { titleAndBody: asIs });
if (problems.length > 0) {
    console.error(
        `The commit message ${problems.join(', and ')}. Describe the change in plain sentences.`
    );
    process.exit(1);
}
