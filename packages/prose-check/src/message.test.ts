// @vitest-environment node
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { commentOf, messageProblems, storedMessage, textToCheck, TOOLS } from './message.mjs';

const DASH = String.fromCodePoint(0x2014);

describe('the commit message check', () => {
    it('reads a pull request body as GitHub keeps it, headings included', () => {
        // The tool's name is put together here, as in the messages below.
        const body = `Fix the check\n\n## Notes from ${'Co'}dex`;
        const edited = `${body}\n# Please enter the commit message for your changes.`;
        expect(messageProblems(textToCheck(edited, '#', false))).toEqual([]);
        expect(messageProblems(textToCheck(body, '#', false))).not.toEqual([]);
        expect(messageProblems(textToCheck(body, '#', true))).not.toEqual([]);
    });

    it('passes a plain message', () => {
        expect(
            messageProblems('Keep the floor job beside the other checks\n\nIt gates the release.')
        ).toEqual([]);
    });

    it('refuses a tool named in the message or a bot co-author', () => {
        expect(messageProblems('Written with ChatGPT')).toEqual([
            'names a tool (/\\bchatgpt\\b/i)',
        ]);
        expect(messageProblems('Fix\n\nCo-authored-by: helper bot <a@b.c>')).toHaveLength(1);
    });

    it('leaves quoted code and entities alone', () => {
        expect(
            messageProblems('Run `a; b` before the build, and write it as &amp; in the header')
        ).toEqual([]);
    });

    it('refuses an em dash and a semicolon joining clauses', () => {
        expect(messageProblems(`Fix the floor ${DASH} and the job; then ship`)).toEqual([
            'uses an em dash on line 1',
            'joins clauses with a semicolon on line 1',
        ]);
    });

    it('holds a message to every other prose rule, naming the rule and the line', () => {
        // The words are put together here, so this file passes the check it tests.
        expect(messageProblems(`Fix the check\n\nKeep the ${'col'}our of the button`)).toEqual([
            'breaks the British spelling rule on line 3',
        ]);
        expect(messageProblems(`Fix the check\n\nThe rest is ${'TO'}DO`)).toEqual([
            'breaks the process artifact rule on line 3',
        ]);
        expect(messageProblems(`${'Addition'}ally, fix the check`)).toEqual([
            'breaks the empty opener rule on line 1',
        ]);
    });

    it('names a rule once however many lines break it', () => {
        expect(messageProblems(`One ${DASH} two\n\nThree ${DASH} four`)).toEqual([
            'uses an em dash on line 1',
        ]);
    });

    it('counts lines as the author wrote them, git comment lines included', () => {
        const raw = `Fix the check\n# Please enter the commit message\nKeep the ${'col'}our`;
        expect(messageProblems(textToCheck(raw, '#', false))).toEqual([
            'breaks the British spelling rule on line 3',
        ]);
    });

    it("counts a pull request body's own lines, and names the title apart", () => {
        const message = `Keep the ${'col'}our\n\nThe first line\nThen a ${DASH} here`;
        expect(messageProblems(message, { titleAndBody: true })).toEqual([
            'uses an em dash on line 2 of the body',
            'breaks the British spelling rule in the title',
        ]);
    });

    it('skips a code block indented four spaces, as a fenced one', () => {
        expect(messageProblems('Fix the check\n\nRun it as\n\n    npm ci; npm test\n')).toEqual([]);
    });

    it('reads an issue number in a body as Markdown does, so closing an issue passes', () => {
        expect(messageProblems('Fix the check\n\nCloses #12')).toEqual([]);
    });

    it('reads only what git stores, not its comments or the diff below the scissors', () => {
        const raw = [
            'Fix the check',
            '# Please enter the commit message for your changes.',
            '# ------------------------ >8 ------------------------',
            '# Do not modify or remove the line above.',
            'diff --git a/x b/x',
            '+// talk to claude; and more',
        ].join('\n');
        expect(storedMessage(raw, '#')).toBe('Fix the check');
        expect(
            storedMessage('Fix\n; Please enter the commit message for your changes.\n; a note', ';')
        ).toBe('Fix');
        const auto =
            'Fix\n# a heading the author wrote\n; ------------------------ >8 ------------------------\n+claude; diff';
        expect(storedMessage(auto, '#')).toBe('Fix\n# a heading the author wrote');
    });

    it('keeps comment lines when git wrote none of its own text, as git stores them', () => {
        // As a message given with -m, which git does not edit, so it strips no comment lines.
        expect(storedMessage('Add a file\n\n# A heading', '#')).toBe('Add a file\n\n# A heading');
        expect(textToCheck('Fix\n; a note', ';', false)).toBe('Fix\n; a note');
    });

    it('works out the comment character as git does when it is auto', () => {
        expect(commentOf('Fix\n; Please enter the commit message for your changes.', 'auto')).toBe(
            ';'
        );
        expect(commentOf('Fix\n#12 closes it\n;a line', 'auto')).toBe('@');
        expect(commentOf('Fix', 'auto')).toBe('#');
        expect(commentOf('Fix', ';')).toBe(';');
        expect(commentOf('Fix', '')).toBe('#');
    });
});

/**
 * One message for each way of naming a tool. Each must be refused by exactly one pattern, and
 * each pattern must refuse one of them, so an overlap or a pattern added without a sample fails.
 */
const NAMING_A_TOOL = [
    `Asked ${'Clau'}de about the cache`,
    `Thanks to ${'Anthro'}pic`,
    `Written with ${'Chat'}GPT`,
    `Ported from an ${'Open'}AI sample`,
    `Notes from ${'Co'}dex`,
    `Checked with ${'Gem'}ini`,
    `Suggested by ${'Co'}pilot`,
    `Suggested by ${'Co'}-pilot`,
    `Suggested by a ${'Co'} pilot`,
    `An ${'L'}LM wrote the fixture`,
    `Two ${'L'}LMs disagreed`,
    'Generated by a script',
    'Generated with a script',
    'Fix\n\nCo-authored-by: helper bot <a@b.c>',
    'Fix\n\nCo-authored-by: Helper AI <a@b.c>',
];

describe('the tools the commit message check refuses', () => {
    it.each(NAMING_A_TOOL)('refuses %j by exactly one of its patterns', (message) => {
        expect(messageProblems(message)).toEqual([expect.stringMatching(/^names a tool/)]);
    });

    it('has a message above for every pattern it lists', () => {
        const unmatched = TOOLS.filter(
            (pattern) => !NAMING_A_TOOL.some((message) => pattern.test(message))
        );
        expect(unmatched).toEqual([]);
    });
});

/** The command, as a repository that installs the package runs it. */
const COMMAND = fileURLToPath(new URL('../bin/check-commit-message.mjs', import.meta.url));

/**
 * The environment with every `GIT_` variable dropped and git's global and system config shut off,
 * so a throwaway repository is not pointed at a real one by a hook's variables.
 */
const isolated = (): NodeJS.ProcessEnv => ({
    ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_'))),
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
});

/**
 * The command's exit status on a message, and what it wrote to stderr, run as the hook runs it
 * in a repository of its own.
 */
const ranOn = (message: string, args: string[] = [], config: Record<string, string> = {}) => {
    const root = mkdtempSync(join(tmpdir(), 'check-commit-message-'));
    const options = { cwd: root, env: isolated(), timeout: 10_000 };
    try {
        execFileSync('git', ['init', '--quiet'], options);
        for (const [key, value] of Object.entries(config)) {
            execFileSync('git', ['config', key, value], options);
        }
        writeFileSync(join(root, 'MESSAGE'), message);
        const ran = spawnSync(process.execPath, [COMMAND, ...args, 'MESSAGE'], {
            ...options,
            encoding: 'utf8',
        });
        return { status: ran.status, stderr: ran.stderr };
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
};

describe('the check-commit-message command', () => {
    const commented = `Fix the check\n# Notes from ${'Co'}dex\n`;
    const passed = { status: 0, stderr: '' };
    // The reason, as well as the status, so a crash that also exits 1 is not taken for a refusal.
    const expectRefused = (
        { status, stderr }: { status: number | null; stderr: string },
        reason = 'names a tool'
    ) => {
        expect(status).toBe(1);
        expect(stderr).toContain(reason);
    };

    it('exits 0 on a plain message and 1 on one that names a tool', () => {
        expect(ranOn('Fix the check\n')).toEqual(passed);
        expectRefused(ranOn(`Fix the check with ${'Co'}dex\n`));
    });

    it('exits 1 on a message that breaks a prose rule, naming the rule', () => {
        expectRefused(ranOn(`Keep the ${'col'}our\n`), 'British spelling');
    });

    it('drops comment lines when git wrote its own text, unless told to read the message as it is', () => {
        const edited = `${commented}# Please enter the commit message for your changes.\n`;
        expect(ranOn(edited)).toEqual(passed);
        expectRefused(ranOn(edited, ['--as-is']));
    });

    it('refuses a comment line given with -m, which git stores', () => {
        expectRefused(ranOn(`Add a file\n\n# Written with ${'Clau'}de\n`));
        expectRefused(ranOn(commented));
    });

    it('drops the comment character the repository sets, when git wrote its text after it', () => {
        const message = `Fix the check\n; Notes from ${'Co'}dex\n; Please enter the commit message for your changes.\n`;
        expect(ranOn(message, [], { 'core.commentChar': ';' })).toEqual(passed);
        expectRefused(
            ranOn(`Fix the check\n; Notes from ${'Co'}dex\n`, [], { 'core.commentChar': ';' })
        );
    });

    it('drops hash lines under auto when git wrote its text after a hash', () => {
        const edited = `${commented}# Please enter the commit message for your changes.\n`;
        expect(ranOn(edited, [], { 'core.commentChar': 'auto' })).toEqual(passed);
    });

    it('reads a hash line as the author wrote it under auto when git wrote no text of its own', () => {
        // As a message given with -m, where git adds no comments and stores every line.
        expectRefused(ranOn(commented, [], { 'core.commentChar': 'auto' }));
    });

    it('keeps a line of the author that starts with a hash when git picked another character', () => {
        // An amended message whose own line starts with #, so git, with commentChar auto, writes
        // its text after ;, and lists a changed file whose path holds a British spelling.
        const message = [
            'Fix the check',
            '',
            '#12 is the issue it closes',
            '; Please enter the commit message for your changes. Lines starting',
            "; with ';' will be ignored.",
            ';',
            '; Changes to be committed:',
            `;\tmodified:   src/${'col'}our.ts`,
            '',
        ].join('\n');
        expect(ranOn(message, [], { 'core.commentChar': 'auto' })).toEqual(passed);
    });

    it('drops the comment string a newer git sets in place of the character', () => {
        const message = `Fix the check\n// Notes from ${'Co'}dex\n// Please enter the commit message for your changes.\n`;
        expect(ranOn(message, [], { 'core.commentString': '//' })).toEqual(passed);
    });

    it.each([[[]], [['missing-file']], [['--as-is']], [['--fast', 'MESSAGE']]])(
        'exits 2 and says how to run it when given %j',
        (args) => {
            const { status, stderr } = spawnSync(process.execPath, [COMMAND, ...args], {
                cwd: tmpdir(),
                encoding: 'utf8',
            });
            expect(status).toBe(2);
            expect(stderr).toContain('usage: check-commit-message [--as-is]');
        }
    );
});
