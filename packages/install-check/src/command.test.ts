// @vitest-environment node
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/** The command, as a repository that installs the package runs it. */
const COMMAND = fileURLToPath(new URL('../bin/check-installs.mjs', import.meta.url));

/**
 * The environment with every `GIT_` variable dropped and git's global and system config shut off,
 * so a throwaway repository is not pointed at a real one by a hook's variables.
 */
const isolated = (): NodeJS.ProcessEnv => ({
    ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_'))),
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
});

/** Runs the command in a throwaway repository holding the files given. */
const runIn = (
    files: Record<string, string>,
    { args = [], git = true }: { args?: string[]; git?: boolean } = {}
) => {
    const root = mkdtempSync(join(tmpdir(), 'install-check-'));
    const options = { cwd: root, env: isolated(), timeout: 10_000 };
    try {
        if (git) execFileSync('git', ['init', '--quiet'], options);
        for (const [path, text] of Object.entries(files)) {
            mkdirSync(dirname(join(root, path)), { recursive: true });
            writeFileSync(join(root, path), text);
        }
        const { status, stdout, stderr } = spawnSync(process.execPath, [COMMAND, ...args], {
            ...options,
            encoding: 'utf8',
        });
        return { status, stdout, stderr };
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
};

/** A workflow whose one step runs the script given. */
const workflow = (run: string) =>
    `on: push\njobs:\n    a:\n        runs-on: ubuntu-26.04\n        steps:\n            - run: ${run}\n`;

describe('check-installs', () => {
    it('passes a repository whose installs all leave install scripts off', () => {
        const { status, stdout } = runIn({
            '.github/workflows/ci.yml': workflow('npm ci --ignore-scripts'),
            Dockerfile: 'FROM node\nRUN npm ci --ignore-scripts\n',
        });
        expect(status).toBe(0);
        expect(stdout).toContain('Install check passed');
    });

    it('refuses an install that runs scripts in a workflow, naming the file and line', () => {
        const { status, stderr } = runIn({ '.github/workflows/ci.yml': workflow('npm ci') });
        expect(status).toBe(1);
        expect(stderr).toContain('.github/workflows/ci.yml:6');
        expect(stderr).toContain('npm ci');
    });

    it('refuses one in a composite action and in any Dockerfile', () => {
        const { status, stderr } = runIn({
            '.github/actions/setup/action.yml':
                'runs:\n    using: composite\n    steps:\n        - run: npx some-tool\n          shell: bash\n',
            'docker/app.Dockerfile': 'FROM node\nRUN ["npm", "install"]\n',
        });
        expect(status).toBe(1);
        expect(stderr).toContain('.github/actions/setup/action.yml:4');
        expect(stderr).toContain('docker/app.Dockerfile:2');
    });

    it('reads no other file', () => {
        const { status } = runIn({
            'scripts/setup.yml': workflow('npm ci'),
            'docs/install.md': 'Run `npm install`.\n',
        });
        expect(status).toBe(0);
    });

    it('exits 2 with how to run it when given an argument or run outside git', () => {
        const given = runIn({}, { args: ['ci.yml'] });
        expect(given.status).toBe(2);
        expect(given.stderr).toContain('check-installs takes no arguments');
        const outside = runIn({}, { git: false });
        expect(outside.status).toBe(2);
        expect(outside.stderr).toContain('not inside a git repository');
    });
});
