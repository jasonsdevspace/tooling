import { readFileSync, statSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/*
 * The prose check's README, which npm shows as the package's page, may link a file at the tag of
 * the release it ships with, so a reader on npm reads the rules that version holds. A release that
 * moves the version moves every one of those links with it. The release's pull request is the
 * commit the tag names, so each file a link names is held to be there, and a file moved since the
 * last release fails before the tag rather than after it.
 */

const readme = readFileSync(new URL('../packages/prose-check/README.md', import.meta.url), 'utf8');
const { version } = JSON.parse(
    readFileSync(new URL('../packages/prose-check/package.json', import.meta.url), 'utf8')
) as { version: string };

describe("the prose check's README", () => {
    it("links every tagged file at the tag of the package's own version", () => {
        const tags = [...readme.matchAll(/\/blob\/prose-check-v([^/]+)\//g)].map(([, tag]) => tag);
        expect(tags.filter((tag) => tag !== version)).toEqual([]);
    });

    it('names a file the repository holds in every link pinned to a tag', () => {
        const paths = [...readme.matchAll(/\/blob\/prose-check-v[^/]+\/([^)#\s]+)/g)].map(
            ([, path = '']) => path
        );
        expect(
            paths.filter(
                (path) =>
                    statSync(new URL(`../${path}`, import.meta.url), { throwIfNoEntry: false }) ===
                    undefined
            )
        ).toEqual([]);
    });
});
