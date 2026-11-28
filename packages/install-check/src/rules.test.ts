// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { dockerfileProblems, npmrcProblems, packageRootsOf } from './rules.mjs';

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
        expect(lines('FROM node\nRUN echo start \\\n    && npm ci\n')).toEqual(['2']);
        expect(lines('FROM node\nRUN echo start \\\n# && npm ci\n    && echo done\n')).toEqual([]);
        expect(lines('FROM node\n# RUN npm ci\nRUN echo done\n')).toEqual([]);
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

    it('reads npm only as a word', () => {
        expect(lines('FROM node\nRUN pnpm install && cat .npmrc\n')).toEqual([]);
    });

    it("reads a heredoc's body as part of its RUN", () => {
        expect(lines('FROM node\nRUN <<EOF\nset -e\nnpm ci\nEOF\n')).toEqual(['2']);
    });

    it('skips blank lines in a continued RUN, as it skips comment lines', () => {
        expect(lines('FROM node\nRUN echo start \\\n\n    && npm ci\n')).toEqual(['2']);
    });

    it('refuses a RUN that turns install scripts back on for itself, after the setting', () => {
        const off = 'FROM node\nENV npm_config_ignore_scripts=true\n';
        expect(lines(`${off}RUN npm ci --ignore-scripts=false\n`)).toEqual(['3']);
        expect(lines(`${off}RUN npm ci --no-ignore-scripts\n`)).toEqual(['3']);
        expect(lines(`${off}RUN npm ci --ignore-scripts false\n`)).toEqual(['3']);
        expect(lines(`${off}RUN npm_config_ignore_scripts=false npm ci\n`)).toEqual(['3']);
        expect(lines(`${off}RUN npm_config_ignore_scripts= npm ci\n`)).toEqual(['3']);
        expect(lines(`${off}RUN npm_config_ignore_scripts=true npm ci\n`)).toEqual([]);
        expect(lines(`${off}RUN npm ci --ignore-scripts\n`)).toEqual([]);
    });

    it('lets a stage built FROM an earlier stage inherit its setting, and reads ARG too', () => {
        const base = 'FROM node AS base\nENV npm_config_ignore_scripts=true\n';
        expect(lines(`${base}FROM base AS build\nRUN npm ci\n`)).toEqual([]);
        expect(lines(`${base}FROM --platform=linux/amd64 base\nRUN npm ci\n`)).toEqual([]);
        expect(lines(`${base}FROM node\nRUN npm ci\n`)).toEqual(['4']);
        expect(lines('FROM node\nARG npm_config_ignore_scripts=true\nRUN npm ci\n')).toEqual([]);
    });

    it('reads npm or npx only where it starts a command word, not inside a path such as ~/.npm', () => {
        expect(lines('FROM node\nRUN rm -rf ~/.npm\n')).toEqual([]);
        expect(lines('FROM node\nRUN --mount=type=cache,target=/root/.npm echo done\n')).toEqual(
            []
        );
        expect(lines('FROM node\nRUN echo a;npm ci\n')).toEqual(['2']);
        expect(lines('FROM node\nRUN echo "$(npm --version)"\n')).toEqual(['2']);
    });
});

describe('a .npmrc', () => {
    const problems = (text: string) => npmrcProblems('.npmrc', text, true);

    it('reads a value as npm reads an ini file: inline comments left out, quotes taken off', () => {
        expect(problems('ignore-scripts=true ; scripts stay off\n')).toEqual([]);
        expect(problems('ignore-scripts = true # off\n')).toEqual([]);
        expect(problems('ignore-scripts="true"\n')).toEqual([]);
        expect(npmrcProblems('docs/.npmrc', 'ignore-scripts=false ; on\n', false)).toEqual([
            'docs/.npmrc:1  ignore-scripts=false turns install scripts back on',
        ]);
    });

    it('reads a bare key as true', () => {
        expect(problems('ignore-scripts\n')).toEqual([]);
    });

    it('says what a package root lacks when it leaves the setting out', () => {
        expect(problems('fund=false\n')).toEqual([
            ".npmrc  a package root's .npmrc sets ignore-scripts=true, and this one does not",
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
