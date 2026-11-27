import { readdirSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { floorOf } from './floor.mjs';

/** Every published package's engines range, by folder name. */
const published = readdirSync(new URL('../packages/', import.meta.url))
    .map((name) => ({
        name,
        manifest: JSON.parse(
            readFileSync(new URL(`../packages/${name}/package.json`, import.meta.url), 'utf8')
        ) as { private?: boolean; engines?: { node?: string } },
    }))
    .filter(({ manifest }) => manifest.private !== true);

describe('the oldest supported Node', () => {
    it('is read from a lower bound alone, down to the patch', () => {
        expect(floorOf('>=24')).toBe('24.0.0');
        expect(floorOf('>=22.12')).toBe('22.12.0');
        expect(floorOf('>= 22.12.1')).toBe('22.12.1');
        expect(floorOf('^24')).toBeUndefined();
        expect(floorOf('>=24 <25')).toBeUndefined();
    });

    for (const { name, manifest } of published) {
        it(`can be found for ${name}`, () => {
            expect(floorOf(manifest.engines?.node ?? '')).toBeDefined();
        });
    }
});
