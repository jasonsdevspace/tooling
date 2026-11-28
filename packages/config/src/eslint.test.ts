import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ESLint, type Linter } from 'eslint';
import { afterAll, describe, expect, it } from 'vitest';

import { base, tests, typed } from './eslint.mjs';
import prettier from './prettier.mjs';
import { react } from './react.mjs';

/** A project of its own, so the type-aware rules read a tsconfig that holds only the sample. */
const project = mkdtempSync(join(tmpdir(), 'config-'));
writeFileSync(
    join(project, 'tsconfig.json'),
    JSON.stringify({
        compilerOptions: { strict: true, target: 'ES2023', module: 'ESNext', noEmit: true },
        include: ['*.ts', '*.tsx', '*.mts', '*.cts'],
    })
);
afterAll(() => {
    rmSync(project, { recursive: true, force: true });
});

/** Every preset together, as a repository that takes them all would compose them. */
const all: Linter.Config[] = [
    ...base(),
    ...typed({ tsconfigRootDir: project }),
    ...react({ files: ['**/*.{tsx,jsx}'] }),
    ...tests(),
];

/** The rules that fire on `text`, read as the file at `name` inside the sample project. */
const fired = async (config: Linter.Config[], name: string, text: string) => {
    writeFileSync(join(project, name), text);
    const eslint = new ESLint({ cwd: project, overrideConfigFile: true, overrideConfig: config });
    const [result] = await eslint.lintText(text, { filePath: join(project, name) });
    return (result?.messages ?? []).map(({ ruleId, severity }) => ({ ruleId, severity }));
};

/** Whether a rule's setting is a warning, written as a word, a number or the first of a list. */
const warns = (setting: unknown) => {
    const level: unknown = Array.isArray(setting) ? setting[0] : setting;
    return level === 'warn' || level === 1;
};

describe('the presets', () => {
    it('set no rule to a warning, for any kind of file', async () => {
        const eslint = new ESLint({ cwd: project, overrideConfigFile: true, overrideConfig: all });
        for (const name of [
            'a.js',
            'a.mjs',
            'a.cjs',
            'a.jsx',
            'a.ts',
            'a.mts',
            'a.cts',
            'a.tsx',
            'a.test.ts',
            'a.test.tsx',
            'a.test.cjs',
        ]) {
            const resolved = (await eslint.calculateConfigForFile(join(project, name))) as {
                rules?: Record<string, unknown>;
            };
            const warnings = Object.entries(resolved.rules ?? {})
                .filter(([, setting]) => warns(setting))
                .map(([rule]) => `${name} ${rule}`);
            expect(warnings).toEqual([]);
        }
    });

    it('hold any code to the bug catchers at an error', async () => {
        expect(await fired(base(), 'loose.js', 'export const same = (a, b) => a == b;\n')).toEqual([
            { ruleId: 'eqeqeq', severity: 2 },
        ]);
    });

    it('fail a disable comment that gives no reason, and pass one that does', async () => {
        const bare = '// eslint-disable-next-line eqeqeq\nexport const same = (a, b) => a == b;\n';
        expect(await fired(base(), 'bare.js', bare)).toContainEqual({
            ruleId: '@eslint-community/eslint-comments/require-description',
            severity: 2,
        });
        const said =
            '// eslint-disable-next-line eqeqeq -- loose on purpose\nexport const same = (a, b) => a == b;\n';
        expect(await fired(base(), 'said.js', said)).toEqual([]);
    });

    it('read every kind of JavaScript and TypeScript file, CommonJS and module files among them', async () => {
        const bare =
            '// eslint-disable-next-line eqeqeq\nconst same = (a, b) => a == b;\nvoid same;\n';
        for (const name of ['bare.cjs', 'bare.mts', 'bare.cts', 'bare.jsx'])
            expect(await fired(base(), name, bare), name).toContainEqual({
                ruleId: '@eslint-community/eslint-comments/require-description',
                severity: 2,
            });
    });

    it('fail a disable comment that suppresses nothing', async () => {
        const stale = '// eslint-disable-next-line eqeqeq -- once needed\nexport const one = 1;\n';
        expect(await fired(base(), 'stale.js', stale)).toEqual([{ ruleId: null, severity: 2 }]);
    });

    it('catch a promise nobody awaits with the type-aware rules', async () => {
        const text = 'const later = async () => 1;\nlater();\nexport {};\n';
        expect(
            await fired([...base(), ...typed({ tsconfigRootDir: project })], 'floating.ts', text)
        ).toContainEqual({ ruleId: '@typescript-eslint/no-floating-promises', severity: 2 });
    });

    it("hold a component's hooks to React's rules at an error", async () => {
        const text = [
            "import { useState } from 'react';",
            '',
            'export const View = ({ open }: { open: boolean }) => {',
            '    if (open) {',
            '        useState(0);',
            '    }',
            '    return null;',
            '};',
            '',
        ].join('\n');
        expect(
            await fired([...base(), ...react({ files: ['**/*.tsx'] })], 'view.tsx', text)
        ).toContainEqual({ ruleId: 'react-hooks/rules-of-hooks', severity: 2 });
    });

    it("hold a JavaScript component's hooks to React's rules, reading its markup", async () => {
        const text = [
            "import { useState } from 'react';",
            '',
            'export const View = ({ open }) => {',
            '    if (open) {',
            '        useState(0);',
            '    }',
            '    return <p>open</p>;',
            '};',
            '',
        ].join('\n');
        expect(
            await fired([...base(), ...react({ files: ['**/*.jsx'] })], 'view.jsx', text)
        ).toContainEqual({ ruleId: 'react-hooks/rules-of-hooks', severity: 2 });
    });

    it('let a test take more parameters than code does, and change nothing else for it', async () => {
        const text = 'export const row = (a, b, c, d, e) => [a, b, c, d, e];\n';
        expect(await fired(base(), 'row.js', text)).toEqual([
            { ruleId: 'max-params', severity: 2 },
        ]);
        expect(await fired([...base(), ...tests()], 'row.test.js', text)).toEqual([]);
        expect(await fired([...base(), ...tests()], 'row.test.cjs', text)).toEqual([]);
        const rules = tests().flatMap(({ rules: set }) => Object.entries(set ?? {}));
        expect(rules).toEqual([['max-params', 'off']]);
    });
});

describe('the Prettier config', () => {
    it("is the house's style", () => {
        expect(prettier).toEqual({
            semi: true,
            singleQuote: true,
            tabWidth: 4,
            trailingComma: 'es5',
            printWidth: 100,
            arrowParens: 'always',
        });
    });
});

describe('the TypeScript base', () => {
    it('turns on every strict check the house holds to, library declarations included', () => {
        const { compilerOptions } = JSON.parse(
            readFileSync(new URL('../tsconfig.base.json', import.meta.url), 'utf8')
        ) as { compilerOptions: Record<string, unknown> };
        expect(compilerOptions).toMatchObject({
            strict: true,
            noUncheckedIndexedAccess: true,
            exactOptionalPropertyTypes: true,
            noImplicitOverride: true,
            noFallthroughCasesInSwitch: true,
            noImplicitReturns: true,
            noPropertyAccessFromIndexSignature: true,
            noUnusedLocals: true,
            noUnusedParameters: true,
            verbatimModuleSyntax: true,
            isolatedModules: true,
            skipLibCheck: false,
        });
    });
});
