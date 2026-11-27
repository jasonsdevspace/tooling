// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { npmCommandsIn, runsOf } from '@jasonsdevspace/install-check';
import { describe, expect, it } from 'vitest';

import { repositoryFiles } from './repository.mjs';

/*
 * What the workflows promise that only reading them can hold: only the tools the lockfile installs
 * run with npx, every job on a named image
 * with a time limit, and a release that publishes each package from its own tag, artifact and
 * checksum, from a job that holds the publishing token and does nothing else.
 */

const workflows = repositoryFiles(import.meta.url, (path) =>
    /^\.github\/workflows\/[^/]+\.ya?ml$/.test(path)
);

/** One step of a workflow: how far its dash is indented, and its lines. */
interface Step {
    readonly indent: string;
    readonly text: string;
}

/**
 * A workflow's steps, each with its lines, read without comments or Windows line ends. A comment
 * after a value is dropped as well as a line of one, so a step that mentions a flag in a comment
 * is not taken for using it.
 */
const stepsOf = (text: string): Step[] =>
    [
        ...`${text}\n`
            .replace(/\r\n/g, '\n')
            .replace(/^[ \t]*#.*\n/gm, '')
            .replace(/[ \t]+#[ \t].*$/gm, '')
            .matchAll(/^( *)- .*\n(?:\1 {2}.*\n|[ \t]*\n)*/gm),
    ].map(([step = '', indent = '']) => ({ indent, text: step }));

/** A workflow's jobs, each by its id with the lines under it, read without comments. */
const jobsOf = (text: string) => {
    const lines = `${text}\n`
        .replace(/\r\n/g, '\n')
        .replace(/^[ \t]*#.*\n/gm, '')
        .replace(/[ \t]+#[ \t].*$/gm, '');
    const start = lines.search(/^jobs:/m);
    if (start < 0) return [];
    return lines
        .slice(start)
        .split(/^ {4}(?=[A-Za-z_][\w-]*:\s*$)/m)
        .slice(1)
        .map((block) => ({
            id: block.slice(0, block.indexOf(':')),
            body: `\n${block.slice(block.indexOf('\n') + 1)}`,
        }));
};

/** An npm or npx command a step runs, as the install check reads it, and the folder it runs in. */
type NpmCommand = ReturnType<typeof npmCommandsIn>[number] & { readonly dir: string | undefined };

/** What a command fetches and runs from npm: a package by its name, or the tool a package provides. */
interface Fetched {
    readonly kind: 'bin' | 'package';
    readonly name: string;
}

/**
 * What npx or `npm exec` runs, from the words after it: the package `--package` names, or else the
 * tool. npx's own options come before the tool, and what follows the tool is the tool's own.
 */
const npxTarget = (words: readonly string[]): Fetched => {
    let at = 0;
    while (at < words.length && (words[at] ?? '').startsWith('-')) {
        at += words[at] === '--package' || words[at] === '-p' ? 2 : 1;
    }
    const options = words.slice(0, at);
    const named = options.findIndex((word) => word === '--package' || word === '-p');
    const pkg =
        options.find((word) => word.startsWith('--package='))?.slice('--package='.length) ??
        (named >= 0 ? options[named + 1] : undefined);
    if (pkg !== undefined) return { kind: 'package', name: pkg.replace(/(?<=.)@.*$/, '') };
    return { kind: 'bin', name: words[at] ?? '' };
};

/**
 * The package a command would fetch and run, if it runs one: what npx or `npm exec` runs, or the
 * initializer `npm init` or `npm create` names. Nothing for a command that runs nothing from npm.
 */
const fetchedBy = ({ npx, command, args }: NpmCommand): Fetched | undefined => {
    const words = args.filter((word) => word !== '--');
    if (npx || command === 'exec' || command === 'x') return npxTarget(words);
    if (!['init', 'create', 'innit'].includes(command)) return undefined;
    const name = words.find((word) => !word.startsWith('-'));
    return name === undefined ? undefined : { kind: 'package', name: `create-${name}` };
};

/** A lockfile's entries, by their path under node_modules, each as unknown until looked at. */
const entriesOf = (lockfile: unknown): [string, unknown][] => {
    const listed =
        typeof lockfile === 'object' && lockfile !== null && 'packages' in lockfile
            ? lockfile.packages
            : undefined;
    if (typeof listed !== 'object' || listed === null) return [];
    return Object.keys(listed).map((key): [string, unknown] => [key, Reflect.get(listed, key)]);
};

/** The commands an entry puts on the path: its own name for a single bin, or each it names. */
const binsOf = (name: string, entry: unknown): string[] => {
    const bin: unknown =
        typeof entry === 'object' && entry !== null && 'bin' in entry ? entry.bin : undefined;
    if (typeof bin === 'string') return [name.split('/').pop() ?? name];
    return typeof bin === 'object' && bin !== null ? Object.keys(bin) : [];
};

/** The packages the lockfile installs at the top of node_modules, and the commands they put on the path. */
const lockfileTools = (lockfile: unknown) => {
    const packages = new Set<string>();
    const bins = new Set<string>();
    for (const [path, entry] of entriesOf(lockfile)) {
        if (path.lastIndexOf('node_modules/') !== 0) continue;
        const name = path.slice('node_modules/'.length);
        packages.add(name);
        for (const bin of binsOf(name, entry)) bins.add(bin);
    }
    return { packages, bins };
};

/** The lockfile at the root, which says what npm installs and what tools npx finds. */
const LOCKFILE: unknown = JSON.parse(
    readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8')
);

describe('the workflows', () => {
    const steps = [...workflows.values()].flatMap(stepsOf);
    /** Every npm and npx command the workflows' steps run. */
    const npmCommands: NpmCommand[] = [...workflows.values()].flatMap((text) =>
        runsOf(text).flatMap(({ run, dir }) =>
            npmCommandsIn(run).map((command) => ({ ...command, dir }))
        )
    );

    // A workflow that can publish to npm, by the environment npm's trusted publisher is registered
    // against. Its publishing job holds the token trusted publishing issues, so what it installs is
    // what a release trusts most, and every such workflow is held to the same rules.
    const releases = [...workflows].filter(([, text]) =>
        /^\s+environment:\s*(?:npm|\n\s+name:\s*npm)\s*$/m.test(text)
    );
    const publishing = releases.flatMap(([, text]) => stepsOf(text));

    // Every package releases through the one workflow, by its tag's prefix, so the rules a
    // release keeps are written once.
    const RELEASE = '.github/workflows/release.yml';
    const PACKAGES = ['prose-check', 'install-check'] as const;
    const releaseJob = (id: string) =>
        jobsOf(workflows.get(RELEASE) ?? '').find((job) => job.id === id)?.body ?? '';

    /** The package the release's agree step names for a tag, or undefined where it stops. */
    const packageFor = (tag: string): string | undefined => {
        const step =
            stepsOf(releaseJob('agree')).find(({ text }) => /case "\$TAG" in/.test(text))?.text ??
            '';
        const block = /case "\$TAG" in[\s\S]*?\besac\b/.exec(step)?.[0] ?? '';
        expect(block).not.toBe('');
        const run = spawnSync(
            'bash',
            ['-c', `${block.replace(/^\s+/gm, '')}\nprintf %s "$package"`],
            {
                env: { TAG: tag, PATH: process.env.PATH ?? '' },
                encoding: 'utf8',
            }
        );
        return run.status === 0 ? run.stdout : undefined;
    };

    it('publish to npm from one workflow, for each package by its tag', () => {
        expect(releases.map(([path]) => path)).toEqual([RELEASE]);
        for (const name of PACKAGES)
            expect(workflows.get(RELEASE)).toMatch(new RegExp(`^\\s+- '${name}-v\\*'\\s*$`, 'm'));
    });

    it('use no cache in any workflow that publishes to npm', () => {
        expect(
            releases
                .filter(([, text]) => !/^cache-mode: none\s*$/m.test(text))
                .map(([path]) => path)
        ).toEqual([]);
        expect(steps.filter(({ text }) => /actions\/cache|^\s+cache: /m.test(text))).toEqual([]);
    });

    it('pin every action they use to a full commit', () => {
        const unpinned = [...workflows].flatMap(([path, text]) =>
            [...text.matchAll(/^\s+(?:- )?uses: (\S+)/gm)]
                .map((match) => match[1] ?? '')
                .filter((use) => !use.startsWith('./') && !/@[0-9a-f]{40}$/.test(use))
                .map((use) => `${path} ${use}`)
        );
        for (const path of [RELEASE, '.github/workflows/ci.yml'])
            expect(workflows.get(path) ?? '', path).toMatch(/^\s+(?:- )?uses: \S+@[0-9a-f]{40}/m);
        expect(unpinned).toEqual([]);
    });

    it('check out without keeping the token in the repository', () => {
        const keeping = [...workflows].flatMap(([path, text]) =>
            stepsOf(text)
                .filter(({ text: step }) => /uses: actions\/checkout@/.test(step))
                .filter(({ text: step }) => !/^\s+persist-credentials: false$/m.test(step))
                .map(() => path)
        );
        for (const path of [RELEASE, '.github/workflows/ci.yml'])
            expect(workflows.get(path) ?? '', path).toMatch(/uses: actions\/checkout@/);
        expect(keeping).toEqual([]);
    });

    /**
     * How the release's agree step ends for a package folder holding the version and changelog
     * given, when the tag names `version`: its version, heading and Unreleased checks, taken from
     * the workflow and run in bash, as the release runs them.
     */
    const agreeEnds = (declared: string, changelog: string, version: string) => {
        const step =
            stepsOf(releaseJob('agree')).find(({ text }) => /declared=/.test(text))?.text ?? '';
        const block = /declared=[\s\S]*?(?=\n\s*left=)/.exec(runsOf(step)[0]?.run ?? '')?.[0] ?? '';
        expect(block).not.toBe('');
        const root = mkdtempSync(join(tmpdir(), 'agree-'));
        try {
            mkdirSync(join(root, 'package'));
            writeFileSync(
                join(root, 'package', 'package.json'),
                JSON.stringify({ version: declared })
            );
            writeFileSync(join(root, 'package', 'CHANGELOG.md'), changelog);
            // GitHub runs a step's block with these options, so the test stops where it does.
            const { status, stdout } = spawnSync(
                'bash',
                ['--noprofile', '--norc', '-eo', 'pipefail', '-c', block.replace(/^\s+/gm, '')],
                {
                    cwd: root,
                    env: { dir: 'package', version, PATH: process.env.PATH ?? '' },
                    encoding: 'utf8',
                }
            );
            return { status, stdout };
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    };

    it('release only a version its package declares and its changelog heads, with no Unreleased heading left', () => {
        const changelog = '# Changelog\n\n## 0.2.0\n\nA change.\n\n## 0.1.0\n\nThe first.\n';
        expect(agreeEnds('0.2.0', changelog, '0.2.0').status).toBe(0);
        const stops = (ends: { status: number | null; stdout: string }, says: string) => {
            expect(ends.status).toBe(1);
            expect(ends.stdout).toContain(says);
        };
        stops(agreeEnds('0.1.0', changelog, '0.2.0'), 'the tag says 0.2.0');
        stops(agreeEnds('0.3.0', changelog, '0.3.0'), 'has no entry for 0.3.0');
        stops(
            agreeEnds('0.2.0', `# Changelog\n\n## Unreleased\n\n${changelog.slice(13)}`, '0.2.0'),
            'still has an Unreleased heading'
        );
    });

    it('name the package from its tag, and stop on a tag that names none', () => {
        expect(packageFor('prose-check-v0.2.0')).toBe('prose-check');
        expect(packageFor('prose-check-v0.2.0-next.1')).toBe('prose-check');
        expect(packageFor('install-check-v0.1.0')).toBe('install-check');
        expect(packageFor('design-kit-v1.0.0')).toBeUndefined();
    });

    it('publish the package the tag names, from its own artifact and its own checksum', () => {
        const publish = releaseJob('publish');
        expect(publish).toMatch(/name: \$\{\{ needs\.agree\.outputs\.package \}\}-package\s*$/m);
        expect(publish).toMatch(
            /^ {12}SHA256: \$\{\{ needs\.agree\.outputs\.package == 'prose-check' && needs\.checks\.outputs\.prose-check-sha256 \|\| needs\.agree\.outputs\.package == 'install-check' && needs\.checks\.outputs\.install-check-sha256 \|\| '' \}\}$/m
        );
        expect(publish).toMatch(
            /"\$RUNNER_TEMP\/package\/jasonsdevspace-\$PACKAGE-\$VERSION\.tgz"/
        );
        expect(publish).not.toMatch(/jasonsdevspace-prose-check-/);
        const ci = workflows.get('.github/workflows/ci.yml') ?? '';
        for (const name of PACKAGES)
            expect(ci).toMatch(new RegExp(`^\\s+name: ${name}-package\\s*$`, 'm'));
    });

    it('stop a release while a change file is left beside its package', () => {
        for (const name of PACKAGES)
            expect(
                existsSync(new URL(`../packages/${name}/changes/README.md`, import.meta.url)),
                name
            ).toBe(true);
        expect(releaseJob('agree')).toMatch(/^\s+dir="packages\/\$package"\s*$/m);
        expect(releaseJob('agree')).toMatch(
            /left=\$\(find "\$dir\/changes" ! -type d ! -path "\$dir\/changes\/README\.md"\)\n\s+if \[ -n "\$left" \]; then\n(?:\s+echo[^\n]*\n)+\s+exit 1\n/
        );
    });

    it('install npm where a release publishes only from a tarball held to a pinned checksum', () => {
        const installs = publishing.filter(({ text }) => /\bnpm install -g\b/.test(text));
        expect(installs.length).toBeGreaterThan(0);
        for (const { text } of installs) {
            expect(text).toMatch(/NPM_INTEGRITY: sha512-[A-Za-z0-9+/]+=*\s*$/m);
            // The digest is compared with the pin, and a mismatch stops the step, before the
            // install.
            const compared = text.search(
                /if \[ "\$got" != "\$NPM_INTEGRITY" \]; then\n\s+echo[^\n]*\n\s+exit 1\n/
            );
            expect(text.indexOf('openssl dgst -sha512')).toBeGreaterThan(-1);
            expect(compared).toBeGreaterThan(text.indexOf('openssl dgst -sha512'));
            expect(compared).toBeLessThan(text.indexOf('npm install -g'));
            expect(text).toMatch(/npm install -g --offline --ignore-scripts "\$tarball"/);
            expect(text).not.toMatch(/npm install -g[^\n]*\bnpm@/);
        }
    });

    it('run with npx only the tools the lockfile installs, in the repository, so nothing is fetched with its scripts', () => {
        const { packages, bins } = lockfileTools(LOCKFILE);
        const fetched = npmCommands
            .filter((command) => {
                const wanted = fetchedBy(command);
                if (wanted === undefined) return false;
                // Outside the repository npx finds none of its tools, and fetches what it runs.
                if (
                    command.dir !== undefined &&
                    (/\$\{\{/.test(command.dir) || command.dir.startsWith('/'))
                )
                    return true;
                return wanted.kind === 'bin' ? !bins.has(wanted.name) : !packages.has(wanted.name);
            })
            .map(({ text }) => text);
        expect(fetched).toEqual([]);
    });

    it('name what npx, npm exec and npm create fetch and run', () => {
        const fetched = (script: string) =>
            npmCommandsIn(script).map((command) => fetchedBy({ ...command, dir: undefined }));
        expect(fetched('npx --package=evil tool')).toEqual([{ kind: 'package', name: 'evil' }]);
        expect(fetched('npx tsc -p scripts')).toEqual([{ kind: 'bin', name: 'tsc' }]);
        expect(fetched('npx -p evil@1 tool')).toEqual([{ kind: 'package', name: 'evil' }]);
        expect(fetched('npm create vite')).toEqual([{ kind: 'package', name: 'create-vite' }]);
    });

    it('publish packages that run no script of their own when they are installed', () => {
        for (const name of PACKAGES) {
            const manifest: unknown = JSON.parse(
                readFileSync(new URL(`../packages/${name}/package.json`, import.meta.url), 'utf8')
            );
            const scripts =
                typeof manifest === 'object' && manifest !== null && 'scripts' in manifest
                    ? Object.keys(manifest.scripts ?? {})
                    : [];
            expect(scripts.filter((script) => /^(?:pre|post)?install$/.test(script))).toEqual([]);
        }
    });

    it('give the publishing token to no job in CI', () => {
        // Called from a release, every job in CI runs as the release, so any of them holding the
        // token could publish to npm as the release does.
        const ci = (workflows.get('.github/workflows/ci.yml') ?? '')
            .replace(/\r\n/g, '\n')
            .replace(/^[ \t]*#.*\n/gm, '')
            .replace(/[ \t]+#[ \t].*$/gm, '');
        expect(ci).not.toMatch(/id-token:\s*write|write-all/);
    });

    it('name no secret in any workflow', () => {
        const naming = [...workflows]
            .filter(([, text]) => /\bsecrets\b(?!\.GITHUB_TOKEN\b)/.test(text))
            .map(([path]) => path);
        expect(naming).toEqual([]);
    });

    it('run every job on a named image, with a name and a time limit of its own', () => {
        const unready = [...workflows].flatMap(([path, text]) =>
            jobsOf(text)
                // A job that calls another workflow takes the image and the time limits of the
                // jobs in it.
                .filter(({ body }) => !/^ {8}uses:/m.test(body))
                .filter(
                    ({ body }) =>
                        !/^ {8}name: \S/m.test(body) ||
                        !/^ {8}timeout-minutes: \d+\s*$/m.test(body) ||
                        !/^ {8}runs-on: ubuntu-26\.04\s*$/m.test(body)
                )
                .map(({ id }) => `${path} ${id}`)
        );
        expect([...workflows.keys()].length).toBeGreaterThan(0);
        expect(unready).toEqual([]);
    });

    it("read a workflow's jobs by their ids, each with its own lines", () => {
        const jobs = jobsOf(
            [
                'on: push',
                'jobs:',
                '    build:',
                '        name: Build',
                '        runs-on: ubuntu-26.04',
                '        timeout-minutes: 5',
                '    checks:',
                '        uses: ./.github/workflows/ci.yml',
                '    Lint_All:',
                '        runs-on: ubuntu-26.04 # a comment after the value',
            ].join('\n')
        );
        expect(jobs.map(({ id }) => id)).toEqual(['build', 'checks', 'Lint_All']);
        expect(jobs[2]?.body).toMatch(/^ {8}runs-on: ubuntu-26\.04\s*$/m);
        expect(jobs[0]?.body).toContain('timeout-minutes: 5');
        expect(jobs[1]?.body).not.toContain('runs-on');
    });
});

describe('the release workflow', () => {
    const text = workflows.get('.github/workflows/release.yml') ?? '';
    const jobs = jobsOf(text);
    const job = (id: string) => jobs.find((found) => found.id === id)?.body ?? '';

    it('grants only read access to the repository by default', () => {
        expect(text).toMatch(/^permissions:\n {4}contents: read\n/m);
    });

    it('runs one release at a time for a tag, never canceling one under way', () => {
        expect(text).toMatch(
            /^concurrency:\n {4}group: release-\$\{\{ github\.ref \}\}\n {4}cancel-in-progress: false\n/m
        );
    });

    it('releases only a commit on main', () => {
        expect(job('agree')).toMatch(
            /^ {18}if ! git merge-base --is-ancestor "\$GITHUB_SHA" origin\/main; then\n {22}echo "the tagged commit is not on main"\n {22}exit 1\n/m
        );
    });

    it('holds the npm environment and its publishing token in the publish job alone', () => {
        expect(
            jobs.filter(({ body }) => /^ {8}environment: npm$/m.test(body)).map(({ id }) => id)
        ).toEqual(['publish']);
        expect(job('publish')).toMatch(
            /^ {8}permissions:\n {12}contents: read\n {12}id-token: write\n/m
        );
    });

    it('stages with provenance, under next for a version with a hyphen and latest otherwise', () => {
        const publish = job('publish');
        expect(publish).toMatch(
            /^ {18}tag=latest\n {18}\[ "\$PRERELEASE" = "true" \] && tag=next\n {18}npm stage publish "\$tarball" --provenance --access public --tag "\$tag"$/m
        );
        expect(job('agree')).toMatch(
            /^ {22}\*-\*\) echo "prerelease=true" >> "\$GITHUB_OUTPUT" ;;$/m
        );
    });

    it('never marks a package Latest by hand, so each release takes the default', () => {
        expect(text).not.toMatch(/--latest/);
    });
});
