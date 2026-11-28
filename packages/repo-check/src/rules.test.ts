// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { dockerfileProblems, npmrcProblems, packageRootsOf, scriptsOnProblems } from './rules.mjs';

/** The lines of a Dockerfile that run npm before its stage turns install scripts off. */
const lines = (text: string) =>
    dockerfileProblems('Dockerfile', text).map((problem) => /^Dockerfile:(\d+)/.exec(problem)?.[1]);

describe('a Dockerfile', () => {
    it('passes a stage that turns install scripts off before it runs npm', () => {
        expect(lines('FROM node\nENV npm_config_ignore_scripts=true\nRUN npm ci\n')).toEqual([]);
    });

    it('names a RUN of npm or npx in a stage that never turns install scripts off', () => {
        expect(lines('FROM node\nRUN npm ci\n')).toEqual(['2']);
        expect(lines('FROM node\nRUN npx some-tool\n')).toEqual(['2']);
        expect(lines('FROM node\nRUN ["npm", "ci"]\n')).toEqual(['2']);
        expect(lines('FROM node\nRUN /usr/local/bin/npm install\n')).toEqual(['2']);
    });

    it('starts each stage afresh at its FROM', () => {
        const text =
            'FROM node AS build\nENV npm_config_ignore_scripts=true\nRUN npm ci\n' +
            'FROM node\nCOPY --from=build /app /app\nRUN npm ci --omit=dev\n';
        expect(lines(text)).toEqual(['6']);
    });

    it('names a RUN that comes before the setting in its stage', () => {
        expect(lines('FROM node\nRUN npm ci\nENV npm_config_ignore_scripts=true\n')).toEqual(['2']);
    });

    it('reads a continued RUN whole, past comment lines, and names the line it starts on', () => {
        expect(lines('FROM node\nRUN echo start \\\n# a note\n    && npm ci\n')).toEqual(['2']);
        expect(
            lines('FROM node\n# RUN npm ci\nENV npm_config_ignore_scripts=true\nRUN echo done\n')
        ).toEqual([]);
    });

    it('reads the setting in each form ENV takes, and a later false turns it back off', () => {
        expect(lines('FROM node\nENV npm_config_ignore_scripts true\nRUN npm ci\n')).toEqual([]);
        expect(lines('FROM node\nENV CI=1 npm_config_ignore_scripts="true"\nRUN npm ci\n')).toEqual(
            []
        );
        expect(lines('FROM node\nENV NPM_CONFIG_IGNORE_SCRIPTS=true\nRUN npm ci\n')).toEqual([]);
        expect(
            lines(
                'FROM node\nENV npm_config_ignore_scripts=true\nENV npm_config_ignore_scripts=false\nRUN npm ci\n'
            )
        ).toEqual(['4']);
    });

    it("reads a heredoc's body as part of its RUN", () => {
        expect(lines('FROM node\nRUN <<EOF\nset -e\nnpm ci\nEOF\n')).toEqual(['2']);
    });

    it('skips blank lines in a continued RUN, as it skips comment lines', () => {
        expect(lines('FROM node\nRUN echo start \\\n\n    && npm ci\n')).toEqual(['2']);
    });

    it('lets a stage built FROM an earlier stage inherit its setting', () => {
        const base = 'FROM node AS base\nENV npm_config_ignore_scripts=true\n';
        expect(lines(`${base}FROM base AS build\nRUN npm ci\n`)).toEqual([]);
        expect(lines(`${base}FROM --platform=linux/amd64 base\nRUN npm ci\n`)).toEqual([]);
        expect(lines(`${base}FROM node\nRUN npm ci\n`)).toEqual(['4']);
    });

    it('counts only ENV, never ARG, since a build argument can be overridden', () => {
        expect(lines('FROM node\nARG npm_config_ignore_scripts=true\nRUN npm ci\n')).toEqual(['3']);
    });

    it('needs the setting before any RUN of its stage, whatever the RUN runs', () => {
        expect(lines('FROM alpine\nRUN ./install.sh\n')).toEqual(['2']);
        expect(lines('FROM node\nRUN pnpm install && cat .npmrc\n')).toEqual(['2']);
        expect(lines('FROM node\nRUN rm -rf ~/.npm\n')).toEqual(['2']);
        expect(lines('FROM node\nENV npm_config_ignore_scripts=true\nRUN ./install.sh\n')).toEqual(
            []
        );
        expect(lines('FROM node\nCOPY . .\nWORKDIR /app\n')).toEqual([]);
    });

    it('needs the setting before an ONBUILD RUN as well', () => {
        expect(
            lines('FROM node\nONBUILD RUN npm ci\nENV npm_config_ignore_scripts=true\n')
        ).toEqual(['2']);
        expect(
            lines('FROM node\nENV npm_config_ignore_scripts=true\nONBUILD RUN npm ci\n')
        ).toEqual([]);
    });
});

describe('a .npmrc', () => {
    const FETCH = 'allow-git=none\nallow-remote=none\n';
    const problems = (text: string) => npmrcProblems('.npmrc', text, true);

    it('reads a value as npm reads an ini file: inline comments left out, quotes taken off', () => {
        expect(problems(`ignore-scripts=true ; scripts stay off\n${FETCH}`)).toEqual([]);
        expect(problems(`ignore-scripts = true # off\n${FETCH}`)).toEqual([]);
        expect(problems(`ignore-scripts="true"\n${FETCH}`)).toEqual([]);
        expect(npmrcProblems('docs/.npmrc', 'ignore-scripts=false ; on\n', false)).toEqual([
            'docs/.npmrc:1  ignore-scripts=false turns install scripts back on',
        ]);
    });

    it('reads a bare key as true', () => {
        expect(problems(`ignore-scripts\n${FETCH}`)).toEqual([]);
    });

    it('says what a package root lacks when it leaves the setting out', () => {
        expect(problems(`fund=false\n${FETCH}`)).toEqual([
            ".npmrc  a package root's .npmrc sets ignore-scripts=true, and this one does not",
        ]);
    });

    it('needs a package root to keep npm from fetching git and URL dependencies', () => {
        expect(problems('ignore-scripts=true\n')).toEqual([
            ".npmrc  a package root's .npmrc sets allow-git=none, and this one does not",
            ".npmrc  a package root's .npmrc sets allow-remote=none, and this one does not",
        ]);
        expect(npmrcProblems('docs/.npmrc', 'allow-git=all\nallow-remote=root\n', false)).toEqual([
            'docs/.npmrc:1  allow-git=all lets npm fetch dependencies from git',
            'docs/.npmrc:2  allow-remote=root lets npm fetch dependencies from URLs',
        ]);
    });
});

describe('the package roots', () => {
    const roots = (files: Record<string, string>) => packageRootsOf(new Map(Object.entries(files)));

    it('leaves out a folder a workspace glob negates, as npm does, so it is its own root', () => {
        expect(
            roots({
                'package.json': '{ "workspaces": ["packages/*", "!packages/legacy"] }',
                'packages/a/package.json': '{}',
                'packages/legacy/package.json': '{}',
            })
        ).toEqual(['', 'packages/legacy']);
    });

    it('expands a brace list in a workspace glob', () => {
        expect(
            roots({
                'package.json': '{ "workspaces": ["{apps,libs}/*"] }',
                'apps/web/package.json': '{}',
                'libs/ui/package.json': '{}',
                'tools/x/package.json': '{}',
            })
        ).toEqual(['', 'tools/x']);
    });
});

describe('a file that runs commands', () => {
    // Each refused word is built from parts, so this file holds none of them whole.
    const off = ['--ignore', '-scripts'].join('');
    const named = ['npm_config', '_ignore_scripts'].join('');

    it('names each line that turns install scripts back on, in any form', () => {
        expect(
            scriptsOnProblems('.github/workflows/ci.yml', `env:\n    ${named}: 'false'\n`)
        ).toEqual([
            `.github/workflows/ci.yml:2  turns install scripts back on\n    ${named}: 'false'`,
        ]);
        expect(
            scriptsOnProblems('package.json', `{ "scripts": { "setup": "npm ci ${off}=false" } }\n`)
        ).toHaveLength(1);
        expect(scriptsOnProblems('.husky/pre-commit', `npm ci ${off} false\n`)).toHaveLength(1);
        expect(scriptsOnProblems('run.sh', `npm ci --no${off.slice(1)}\n`)).toHaveLength(1);
        expect(
            scriptsOnProblems('Dockerfile', `RUN ${named.toUpperCase()}=0 npm ci\n`)
        ).toHaveLength(1);
    });

    it('passes a file that keeps install scripts off', () => {
        expect(
            scriptsOnProblems(
                '.github/workflows/ci.yml',
                `env:\n    ${named}: true\njobs:\n    a:\n        steps:\n            - run: npm ci ${off}\n`
            )
        ).toEqual([]);
        expect(
            scriptsOnProblems('Dockerfile', `ENV ${named}=true\nRUN ${named}="true" npm ci\n`)
        ).toEqual([]);
        expect(
            scriptsOnProblems('ci.yml', `printf 'ENV ${named}=true\\nRUN npm ci' > Dockerfile\n`)
        ).toEqual([]);
        expect(scriptsOnProblems('x.mjs', ` * sets \`${named}=true\`, and passes\n`)).toEqual([]);
    });
});
