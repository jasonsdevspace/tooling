// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { dockerfileProblems } from './rules.mjs';

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
});
