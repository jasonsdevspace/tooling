// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { repositoryFiles } from './repository.mjs';

/*
 * What the workflows promise that only reading them can hold: npx run only with --no-install, every
 * job on a named image with a time limit, and a release that publishes each package from its own
 * tag, artifact and checksum, from a job that holds the publishing token and does nothing else.
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

/** npm's subcommands that install, in every spelling it accepts. */
const INSTALLS = [
    'ci',
    'clean-install',
    'ic',
    'install-clean',
    'isntall-clean',
    'i',
    'in',
    'ins',
    'inst',
    'insta',
    'instal',
    'install',
    'isnt',
    'isnta',
    'isntal',
    'isntall',
    'add',
    'it',
    'cit',
    'sit',
    'install-test',
    'install-ci-test',
    'clean-install-test',
    'rebuild',
    'rb',
    'update',
    'up',
    'upgrade',
    'udpate',
    'dedupe',
    'ddp',
    'link',
    'ln',
].join('|');

/** npm's flags before its subcommand, each with its value where it takes one. */
const FLAGS = String.raw`(?:(?:--prefix|--workspace|-w|-C|--cache|--loglevel|--userconfig)\s+\S+\s+|-\S+\s+)*`;

/**
 * Whether a line runs npm or npx to install or fetch a package, by its words: npx, or npm with an
 * install or exec subcommand after only its flags. A plain match, not a reading of the shell.
 */
const INSTALLING = new RegExp(
    String.raw`(?:^|[\s;&|(])(?:npx(?=\s)|npm\s+${FLAGS}(?:${INSTALLS}|exec|x)(?=\s|$))`
);

/**
 * The lines of a workflow that install or fetch with npm where npm reads no project `.npmrc`, and so
 * runs install scripts unless the line turns them off: a global install, any step of a job that
 * checks nothing out, and a step that runs outside the repository, by its working-directory or a
 * `cd` into the runner's temporary folder or an absolute path.
 */
const outsideInstalls = (text: string): string[] =>
    jobsOf(text).flatMap(({ body }) => {
        const checkedOut = /uses: actions\/checkout@/.test(body);
        return stepsOf(body).flatMap((step) => {
            const outside =
                !checkedOut ||
                /working-directory:\s*(?:\$\{\{\s*runner\.temp|\/|~|"?\$RUNNER_TEMP)/.test(
                    step.text
                ) ||
                /\bcd\s+"?(?:\$RUNNER_TEMP|\$\{\{\s*runner\.temp|\/|~)/.test(step.text);
            return step.text
                .split('\n')
                .filter(
                    (line) =>
                        INSTALLING.test(line) &&
                        (outside ||
                            /\s(?:-g|--global)(?=\s|$)/.test(line) ||
                            /\s(?:--prefix(?:=|\s)|-C\s)/.test(line)) &&
                        !/--ignore-scripts(?![=\w-])|--ignore-scripts=true/.test(line)
                )
                .map((line) => line.trim());
        });
    });

/**
 * The lines that fetch a package and run it: npx, `npm exec` and `npm x`, and `npm init` or `npm
 * create` given an initializer, which always fetches it, each refused unless `--no-install` holds
 * it to what the lockfile installed.
 */
const fetchingLines = (lines: readonly string[]): string[] =>
    lines
        .filter(
            (line) =>
                new RegExp(
                    String.raw`(?:^|[\s;&|(])(?:npx(?=\s)|npm\s+${FLAGS}(?:exec|x)(?=\s)|npm\s+(?:init|create|innit)\s+(?!-)\S)`
                ).test(line) && !/--no-install\b/.test(line)
        )
        .map((line) => line.trim());

/** What the lockfile records for one installed package. */
type LockEntry = {
    dependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
    hasInstallScript?: boolean;
};

/**
 * Every lockfile path installed for `names` as `from` resolves them, and for what those depend
 * on in turn, found as Node finds a package: in the folder's own node_modules, then each one above.
 */
const reachableFrom = (from: string, names: string[], packages: Record<string, LockEntry>) => {
    const seen = new Set<string>();
    const visit = (folder: string, name: string) => {
        let at = folder;
        for (;;) {
            const path = at === '' ? `node_modules/${name}` : `${at}/node_modules/${name}`;
            if (path in packages) {
                if (seen.has(path)) return;
                seen.add(path);
                const entry = packages[path];
                for (const next of Object.keys({
                    ...entry?.dependencies,
                    ...entry?.optionalDependencies,
                }))
                    visit(path, next);
                return;
            }
            if (at === '') return;
            const cut = at.lastIndexOf('/node_modules/');
            at = cut === -1 ? '' : at.slice(0, cut);
        }
    };
    for (const name of names) visit(from, name);
    return [...seen];
};

describe('the workflows', () => {
    const steps = [...workflows.values()].flatMap(stepsOf);

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
    const PACKAGES = ['prose-check', 'repo-check', 'config'] as const;
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
                env: { TAG: tag, PATH: process.env['PATH'] ?? '' },
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
        const block = /declared=[\s\S]*?(?=\n\s*left=)/.exec(step)?.[0] ?? '';
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
                    env: { dir: 'package', version, PATH: process.env['PATH'] ?? '' },
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
        expect(packageFor('repo-check-v0.1.0')).toBe('repo-check');
        expect(packageFor('config-v0.1.0')).toBe('config');
        expect(packageFor('design-kit-v1.0.0')).toBeUndefined();
    });

    it('publish the package the tag names, from its own artifact and its own checksum', () => {
        const publish = releaseJob('publish');
        expect(publish).toMatch(/name: \$\{\{ needs\.agree\.outputs\.package \}\}-package\s*$/m);
        expect(publish).toMatch(
            /^ {12}SHA256: \$\{\{ needs\.agree\.outputs\.package == 'prose-check' && needs\.checks\.outputs\.prose-check-sha256 \|\| needs\.agree\.outputs\.package == 'repo-check' && needs\.checks\.outputs\.repo-check-sha256 \|\| needs\.agree\.outputs\.package == 'config' && needs\.checks\.outputs\.config-sha256 \|\| '' \}\}$/m
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

    it('fetch nothing with npx, npm exec, npm x or npm init without --no-install', () => {
        expect(fetchingLines(steps.flatMap(({ text }) => text.split('\n')))).toEqual([]);
    });

    it("read an install in any of npm's spellings, and one pointed outside the repository", () => {
        const job = (run: string) =>
            `jobs:\n    a:\n        steps:\n            - uses: actions/checkout@v7\n            - run: ${run}\n`;
        for (const command of [
            'clean-install',
            'ic',
            'install-clean',
            'in',
            'ins',
            'cit',
            'install-ci-test',
            'up',
            'upgrade',
            'dedupe',
        ])
            expect(outsideInstalls(job(`npm -g ${command} x`)), command).toHaveLength(1);
        expect(outsideInstalls(job('npm --prefix /tmp/x install left-pad'))).toHaveLength(1);
        expect(outsideInstalls(job('npm ci -C ../other'))).toHaveLength(1);
        expect(outsideInstalls(job('npm ci'))).toEqual([]);
    });

    it('read a fetch by its words', () => {
        expect(
            fetchingLines([
                'npx tsc',
                'npx --no-install tsc',
                'npm exec tsc',
                'npm x --no-install tsc',
                'npm init vite',
                'npm create vite',
                'npm init -y',
                'npm ci',
            ])
        ).toEqual(['npx tsc', 'npm exec tsc', 'npm init vite', 'npm create vite']);
    });

    it('turn install scripts off on every install where npm reads no project .npmrc', () => {
        expect([...workflows.values()].flatMap(outsideInstalls)).toEqual([]);
    });

    it('find an install outside the repository that leaves install scripts on', () => {
        const release = workflows.get(RELEASE) ?? '';
        const dropped = release.replace(/(npm install -g[^\n]*?) --ignore-scripts/, '$1');
        expect(dropped).not.toBe(release);
        expect(outsideInstalls(dropped)).toEqual([
            expect.stringMatching(/^npm install -g --offline "\$tarball"$/),
        ]);
        const job = (step: string, checkout = '            - uses: actions/checkout@v7\n') =>
            `jobs:\n    a:\n        steps:\n${checkout}${step}`;
        expect(
            outsideInstalls(
                job(
                    '            - working-directory: ${{ runner.temp }}/x\n              run: npm ci\n'
                )
            )
        ).toEqual(['run: npm ci']);
        expect(outsideInstalls(job('            - run: npm ci\n', ''))).toEqual(['- run: npm ci']);
        expect(outsideInstalls(job('            - run: npm ci\n'))).toEqual([]);
    });

    // The prose check and the repo check run unpacked with no install, the prose check from the
    // tarball a repository's message workflow downloads, so each has to work alone. The config
    // package is installed as a development dependency and brings the lint plugins its presets
    // name, so it is held to no such rule.
    const UNPACKED = ['prose-check', 'repo-check'] as const;

    it('publish the packages that run unpacked with no dependency, so installing one brings in nothing else', () => {
        const fields = [
            'dependencies',
            'optionalDependencies',
            'peerDependencies',
            'bundleDependencies',
        ];
        const declared = UNPACKED.flatMap((name) => {
            const manifest: unknown = JSON.parse(
                readFileSync(new URL(`../packages/${name}/package.json`, import.meta.url), 'utf8')
            );
            return fields
                .filter(
                    (field) =>
                        typeof manifest === 'object' && manifest !== null && field in manifest
                )
                .map((field) => `${name} ${field}`);
        });
        expect(declared).toEqual([]);
    });

    it("hand the release each package's checksum from that package's own oldest Node job", () => {
        const ci = workflows.get('.github/workflows/ci.yml') ?? '';
        for (const name of PACKAGES)
            expect(ci, name).toMatch(
                new RegExp(
                    `^ {12}${name}-sha256:\\n(?: {16}.*\\n)*? {16}value: \\$\\{\\{ jobs\\.${name}-floor\\.outputs\\.sha256 \\}\\}\\s*$`,
                    'm'
                )
            );
    });

    it('install the config with its plugins at exact versions, none of which runs an install script', () => {
        const manifest: unknown = JSON.parse(
            readFileSync(new URL('../packages/config/package.json', import.meta.url), 'utf8')
        );
        const deps: Record<string, string> =
            typeof manifest === 'object' && manifest !== null && 'dependencies' in manifest
                ? (manifest.dependencies as Record<string, string>)
                : {};
        expect(Object.keys(deps).length).toBeGreaterThan(0);
        expect(
            Object.entries(deps)
                .filter(([, version]) => !/^\d+\.\d+\.\d+$/.test(version))
                .map(([name]) => name)
        ).toEqual([]);
        const lock = JSON.parse(
            readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8')
        ) as { packages: Record<string, LockEntry> };
        const scripted = reachableFrom('packages/config', Object.keys(deps), lock.packages).filter(
            (path) => lock.packages[path]?.hasInstallScript === true
        );
        expect(scripted).toEqual([]);
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
