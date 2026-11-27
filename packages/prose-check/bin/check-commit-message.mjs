#!/usr/bin/env node
/**
 * Refuses a commit message that names a tool or breaks a prose rule, saying why, and passes
 * otherwise. A commit hook runs it with the path to the message file, and CI runs it with
 * `--as-is` on a file holding a pull request's title and body, read as written, lines that start
 * like git's comments included.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { messageProblems, textToCheck } from '../src/message.mjs';

/**
 * What git starts a comment line with in the repository it runs in, `#` when unset. Newer git
 * reads `core.commentString` as well as `core.commentChar`, and whichever comes last in its config
 * wins. `auto` is read as `#`, the one git picks unless the message already has a line starting
 * with it.
 *
 * @returns {string}
 */
const commentCharacter = () => {
    try {
        const settings = execFileSync(
            'git',
            ['config', '--get-regexp', '^core\\.comment(char|string)$'],
            { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
        ).trim();
        const set = settings.split('\n').at(-1)?.split(' ').slice(1).join(' ') ?? '';
        return set === '' || set === 'auto' ? '#' : set;
    } catch {
        return '#';
    }
};

const args = process.argv.slice(2);
const asIs = args.includes('--as-is');
const messagePath = args.find((arg) => arg !== '--as-is');
if (!messagePath) {
    console.error('usage: check-commit-message [--as-is] <path to the commit message>');
    process.exit(2);
}
const problems = messageProblems(
    textToCheck(readFileSync(messagePath, 'utf8'), commentCharacter(), asIs)
);
if (problems.length > 0) {
    console.error(
        `The commit message ${problems.join(', and ')}. Describe the change in plain sentences.`
    );
    process.exit(1);
}
