// @vitest-environment node
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import * as exported from './index.mjs';

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

/** The setting each package root's `.npmrc` holds. */
const OFF = 'ignore-scripts=true\nallow-git=none\nallow-remote=none\n';

/**
 * Runs the command in a throwaway repository holding a package.json at its root, a `.npmrc` that
 * turns install scripts off beside it unless `null` replaces it, and the files given.
 */
const runIn = (
    files: Record<string, string | null>,
    { args = [], git = true, npm }: { args?: string[]; git?: boolean; npm?: string } = {}
) => {
    const root = mkdtempSync(join(tmpdir(), 'repo-check-'));
    const env = isolated();
    if (npm !== undefined) {
        // A stand-in npm first on the path, which prints the version given.
        const bin = mkdtempSync(join(tmpdir(), 'repo-check-npm-'));
        writeFileSync(join(bin, 'npm'), `#!/bin/sh\necho ${npm}\n`, { mode: 0o755 });
        env['PATH'] = `${bin}:${env['PATH'] ?? ''}`;
    }
    const options = { cwd: root, env, timeout: 10_000 };
    try {
        if (git) execFileSync('git', ['init', '--quiet'], options);
        const written: Record<string, string | null> = {
            'package.json': '{}\n',
            '.npmrc': OFF,
            ...files,
        };
        for (const [path, text] of Object.entries(written)) {
            if (text === null) continue;
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

describe('check-installs', () => {
    it('passes a repository whose package root turns install scripts off', () => {
        const { status, stdout } = runIn({});
        expect(status).toBe(0);
        expect(stdout).toContain('Install check passed');
        expect(
            runIn({ '.npmrc': `; settings\nignore-scripts = true\n${OFF.slice(20)}` }).status
        ).toBe(0);
    });

    it('refuses a package root with no .npmrc, or one that leaves the setting out', () => {
        const missing = runIn({ '.npmrc': null });
        expect(missing.status).toBe(1);
        expect(missing.stderr).toMatch(/^\.npmrc {2}/m);
        const unset = runIn({ '.npmrc': 'fund=false\n' });
        expect(unset.status).toBe(1);
        expect(unset.stderr).toMatch(/^\.npmrc {2}/m);
    });

    it('refuses ignore-scripts=false in any .npmrc, naming its line', () => {
        const turned = runIn({ '.npmrc': 'ignore-scripts=true\nignore-scripts=false\n' });
        expect(turned.status).toBe(1);
        expect(turned.stderr).toContain('.npmrc:2');
        const elsewhere = runIn({ 'docs/.npmrc': 'ignore-scripts=false\n' });
        expect(elsewhere.status).toBe(1);
        expect(elsewhere.stderr).toContain('docs/.npmrc:1');
    });

    it('refuses a nested package root that is no workspace and has no .npmrc of its own', () => {
        const { status, stderr } = runIn({ 'demo/package.json': '{}\n' });
        expect(status).toBe(1);
        expect(stderr).toMatch(/^demo\/\.npmrc {2}/m);
        expect(runIn({ 'demo/package.json': '{}\n', 'demo/.npmrc': OFF }).status).toBe(0);
    });

    it("passes a workspace without a .npmrc, since it shares its root's", () => {
        expect(
            runIn({
                'package.json': '{ "workspaces": ["packages/*"] }\n',
                'packages/a/package.json': '{}\n',
            }).status
        ).toBe(0);
        expect(
            runIn({
                'package.json': '{ "workspaces": { "packages": ["apps/**"] } }\n',
                'apps/web/site/package.json': '{}\n',
            }).status
        ).toBe(0);
    });

    it('refuses a Dockerfile stage that runs npm before turning install scripts off', () => {
        const { status, stderr } = runIn({
            'docker/app.Dockerfile':
                'FROM node AS build\nENV npm_config_ignore_scripts=true npm_config_allow_git=none npm_config_allow_remote=none\nRUN npm ci\nFROM node\nRUN npm ci\n',
        });
        expect(status).toBe(1);
        expect(stderr).toContain('docker/app.Dockerfile:5');
        expect(stderr).not.toContain('docker/app.Dockerfile:3');
    });

    it('refuses a workflow or a package.json script that turns install scripts back on', () => {
        // Each refused word is built from parts, so this file holds none of them whole.
        const named = ['npm_config', '_ignore_scripts'].join('');
        const off = ['--ignore', '-scripts'].join('');
        const workflow = runIn({ '.github/workflows/ci.yml': `env:\n    ${named}: 'false'\n` });
        expect(workflow.status).toBe(1);
        expect(workflow.stderr).toContain('.github/workflows/ci.yml:2');
        const script = runIn({
            'package.json': `{ "scripts": { "setup": "npm ci ${off}=false" } }\n`,
        });
        expect(script.status).toBe(1);
        expect(script.stderr).toContain('package.json:1');
    });

    it('reads no doc or test for a setting that turns install scripts back on', () => {
        const off = ['--ignore', '-scripts'].join('');
        expect(
            runIn({
                'docs/setup.md': `Never run npm ci ${off}=false.\n`,
                'README.md': `Never run npm ci ${off}=false.\n`,
                'src/setup.test.ts': `const flag = '${off}=false';\n`,
            }).status
        ).toBe(0);
    });

    it('refuses an npm older than the first that reads allow-git and allow-remote', () => {
        const old = runIn({}, { npm: '11.13.0' });
        expect(old.status).toBe(1);
        expect(old.stderr).toContain('npm 11.13.0 is older than 11.14.0');
        expect(runIn({}, { npm: '11.14.0' }).status).toBe(0);
        expect(runIn({}, { npm: '12.0.0' }).status).toBe(0);
    });

    it('refuses a workflow that lets npm fetch from git, or runs npx free to fetch', () => {
        const flag = ['--allow', '-git'].join('');
        const fetching = runIn({
            '.github/workflows/ci.yml': `jobs:\n    a:\n        steps:\n            - run: npm ci ${flag}=all\n            - run: npx playwright install\n`,
        });
        expect(fetching.status).toBe(1);
        expect(fetching.stderr).toContain('.github/workflows/ci.yml:4');
        expect(fetching.stderr).toContain('.github/workflows/ci.yml:5');
    });

    it('exits 2 with how to run it when given an argument or run outside git', () => {
        const given = runIn({}, { args: ['.npmrc'] });
        expect(given.status).toBe(2);
        expect(given.stderr).toContain('check-installs takes no arguments');
        const outside = runIn({}, { git: false });
        expect(outside.status).toBe(2);
        expect(outside.stderr).toContain('not inside a git repository');
    });
});

describe('the package', () => {
    it('exports every rule the command is built from', () => {
        expect(Object.keys(exported).sort()).toEqual([
            'dockerfileProblems',
            'installProblems',
            'isDockerfile',
            'npmFloorProblems',
            'npmrcProblems',
            'packageRootsOf',
            'repositoryRoot',
            'scriptsOnProblems',
        ]);
    });
});
