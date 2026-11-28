// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
    dockerfileProblems,
    npmFloorProblems,
    npmrcProblems,
    packageRootsOf,
    scriptsOnProblems,
} from './rules.mjs';

/** The line each problem of a Dockerfile names, from the problems that match a pattern. */
const linesOf = (text: string, kind: RegExp) => [
    ...new Set(
        dockerfileProblems('Dockerfile', text)
            .filter((problem) => kind.test(problem))
            .map((problem) => /^Dockerfile:(\d+)/.exec(problem)?.[1])
    ),
];

/** The lines of a Dockerfile that run before their stage turns install scripts off. */
const lines = (text: string) => linesOf(text, /ignore.scripts/i);

/** The lines of a Dockerfile that run before their stage stops git and URL dependencies. */
const fetchLines = (text: string) => linesOf(text, /git and URL/);

/** The lines of a Dockerfile that break either rule. */
const allLines = (text: string) => linesOf(text, /./);

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

describe('the final review', () => {
    // Each refused word is built from parts, so this file holds none of them whole.
    const off = ['--ignore', '-scripts'].join('');
    const named = ['npm_config', '_ignore', '_scripts'].join('');
    const hyphened = ['npm_config', '_ignore', '-scripts'].join('');

    it('refuses the flag given any value but true, quoted or not, as npm reads it', () => {
        for (const value of ['0', 'null', '"false"', "'false'", '', 'no'])
            expect(
                scriptsOnProblems('ci.yml', `run: npm ci ${off}=${value}\n`),
                value
            ).toHaveLength(1);
        for (const value of ['false', '0', 'null', '"false"', "'false'"])
            expect(
                scriptsOnProblems('ci.yml', `run: npm ci ${off} ${value}\n`),
                value
            ).toHaveLength(1);
        expect(scriptsOnProblems('ci.yml', `run: npm ci ${off}=true\n`)).toEqual([]);
        expect(scriptsOnProblems('ci.yml', `run: npm ci ${off}="true"\n`)).toEqual([]);
        expect(scriptsOnProblems('ci.yml', `run: npm install ${off} left-pad\n`)).toEqual([]);
    });

    it('reads the setting with a hyphen after the prefix too, in any case', () => {
        expect(
            scriptsOnProblems('ci.yml', `env:\n    ${hyphened.toUpperCase()}: 'false'\n`)
        ).toHaveLength(1);
        expect(lines(`FROM node\nENV ${hyphened}=true\nRUN npm ci\n`)).toEqual([]);
        expect(lines(`FROM node\nENV ${named.toUpperCase()}=true\nRUN npm ci\n`)).toEqual([]);
    });

    it('refuses an install pointed outside the project without the flag', () => {
        expect(
            scriptsOnProblems('ci.yml', 'run: npm --prefix /tmp/x install left-pad\n')
        ).toHaveLength(1);
        expect(scriptsOnProblems('ci.yml', 'run: npm ci -C ../other\n')).toHaveLength(1);
        expect(scriptsOnProblems('ci.yml', 'run: npm install --prefix=/opt/app\n')).toHaveLength(1);
        expect(
            scriptsOnProblems('ci.yml', `run: npm --prefix /tmp/x install ${off} --offline\n`)
        ).toEqual([]);
        expect(scriptsOnProblems('ci.yml', 'run: npm --prefix demo run build\n')).toEqual([]);
    });

    it('joins a continued line whose backslash has spaces or tabs after it', () => {
        expect(
            lines('FROM node\nENV CI=1 \\ \t\n    npm_config_ignore_scripts=true\nRUN npm ci\n')
        ).toEqual([]);
        expect(lines('FROM node\nRUN echo start \\  \n    && npm ci\nRUN echo done\n')).toEqual([
            '2',
            '4',
        ]);
    });
});

describe('a .npmrc, read as npm reads it', () => {
    it('unquotes a key before reading it', () => {
        expect(npmrcProblems('docs/.npmrc', '"ignore-scripts"=false\n', false)).toEqual([
            'docs/.npmrc:1  ignore-scripts=false turns install scripts back on',
        ]);
        expect(npmrcProblems('docs/.npmrc', "'allow-git'=all\n", false)).toHaveLength(1);
    });
});

describe('nested workspaces', () => {
    const roots = (files: Record<string, string>) => packageRootsOf(new Map(Object.entries(files)));

    it('makes a workspace that declares workspaces of its own a package root for its children', () => {
        expect(
            roots({
                'package.json': '{ "workspaces": ["packages/*"] }',
                'packages/a/package.json': '{ "workspaces": ["sub/*"] }',
                'packages/a/sub/x/package.json': '{}',
                'packages/b/package.json': '{}',
            })
        ).toEqual(['', 'packages/a']);
        expect(
            roots({
                'package.json': '{ "workspaces": ["packages/**"] }',
                'packages/a/package.json': '{ "workspaces": ["sub/*"] }',
                'packages/a/sub/x/package.json': '{}',
            })
        ).toEqual(['', 'packages/a']);
    });
});

describe('the fetch settings outside a .npmrc', () => {
    // Each refused word is built from parts, so this file holds none of them whole.
    const git = ['--allow', '-git'].join('');
    const remote = ['--allow', '-remote'].join('');
    const gitSetting = ['npm_config', '_allow', '_git'].join('');
    const remoteSetting = ['npm_config', '_allow', '_remote'].join('');
    const refused = (path: string, text: string) => scriptsOnProblems(path, text).length;

    it('refuses a flag that lets npm fetch from git or a URL, given any value but none', () => {
        for (const flag of [git, remote]) {
            expect(refused('ci.yml', `run: npm ci ${flag}=all\n`), flag).toBe(1);
            expect(refused('ci.yml', `run: npm ci ${flag} root\n`), flag).toBe(1);
            expect(refused('ci.yml', `run: npm ci ${flag}="all"\n`), flag).toBe(1);
            expect(refused('ci.yml', `run: npm ci ${flag}=none\n`), flag).toBe(0);
            expect(refused('ci.yml', `run: npm ci ${flag} none\n`), flag).toBe(0);
        }
    });

    it('refuses the settings given any value but none in an env block, a Dockerfile or a script', () => {
        expect(refused('.github/workflows/ci.yml', `env:\n    ${gitSetting}: all\n`)).toBe(1);
        expect(
            refused(
                '.github/workflows/ci.yml',
                `env:\n    ${remoteSetting.toUpperCase()}: 'root'\n`
            )
        ).toBe(1);
        expect(refused('Dockerfile', `ENV ${gitSetting}=all\n`)).toBe(1);
        expect(
            refused('package.json', `{ "scripts": { "a": "${remoteSetting}=all npm ci" } }\n`)
        ).toBe(1);
        expect(refused('Dockerfile', `ENV ${gitSetting}=none ${remoteSetting}="none"\n`)).toBe(0);
    });
});

describe('a Dockerfile stage and the fetch settings', () => {
    const all =
        'ENV npm_config_ignore_scripts=true npm_config_allow_git=none npm_config_allow_remote=none\n';

    it('passes a stage that sets all three settings with ENV, or copies the .npmrc, before it runs', () => {
        expect(allLines(`FROM node\n${all}RUN npm ci\n`)).toEqual([]);
        expect(
            allLines('FROM node\nCOPY package.json package-lock.json .npmrc ./\nRUN npm ci\n')
        ).toEqual([]);
        expect(allLines(`FROM node AS base\n${all}FROM base\nRUN npm ci\n`)).toEqual([]);
    });

    it('refuses a stage that turns install scripts off but leaves the fetch settings unset', () => {
        expect(fetchLines('FROM node\nENV npm_config_ignore_scripts=true\nRUN npm ci\n')).toEqual([
            '3',
        ]);
        expect(
            fetchLines(
                'FROM node\nENV npm_config_ignore_scripts=true npm_config_allow_git=all npm_config_allow_remote=none\nRUN npm ci\n'
            )
        ).toEqual(['3']);
        expect(allLines('FROM node\nCOPY . .\nRUN npm ci\n')).toEqual(['3']);
    });
});

describe('install scripts turned back on from code', () => {
    // Each refused word is built from parts, so this file holds none of them whole.
    const named = ['npm_config', '_ignore', '_scripts'].join('');

    it('reads a quote and a closing bracket before the separator', () => {
        expect(scriptsOnProblems('set.mjs', `process.env["${named}"] = "false";\n`)).toHaveLength(
            1
        );
        expect(scriptsOnProblems('set.py', `os.environ['${named}'] = 'false'\n`)).toHaveLength(1);
        expect(scriptsOnProblems('set.mjs', `process.env.${named} = 'false';\n`)).toHaveLength(1);
        expect(scriptsOnProblems('set.mjs', `process.env["${named}"] = "true";\n`)).toEqual([]);
        expect(
            scriptsOnProblems('set.mjs', `if (process.env["${named}"] === "true") run();\n`)
        ).toEqual([]);
    });
});

describe('npm config writing a project setting', () => {
    const at = (line: string) => scriptsOnProblems('ci.yml', `run: ${line}\n`).length;

    it('refuses a write of any of the three settings to the project file', () => {
        expect(at('npm config set ignore-scripts false --location=project')).toBe(1);
        expect(at('npm config set allow-git=all -L project')).toBe(1);
        expect(at('npm config delete allow-remote --location project')).toBe(1);
        expect(at('npm config edit --location=project')).toBe(1);
    });

    it('passes a write elsewhere, and a project write of another setting', () => {
        expect(at('npm config set ignore-scripts false')).toBe(0);
        expect(at('npm config set fund false --location=project')).toBe(0);
        expect(at('npm config get ignore-scripts')).toBe(0);
    });
});

describe('the installs no project setting reaches', () => {
    // Each refused word is built from parts, so this file holds none of them whole.
    const off = ['--ignore', '-scripts'].join('');
    const at = (line: string) => scriptsOnProblems('ci.yml', `run: ${line}\n`).length;

    it('refuses a global install that leaves install scripts on', () => {
        expect(at('npm install -g npm@11.14.0')).toBe(1);
        expect(at('npm i --global left-pad')).toBe(1);
        expect(at('npm install --location=global left-pad')).toBe(1);
        expect(at(`npm install -g --offline ${off} "$tarball"`)).toBe(0);
        expect(at('npm ls -g')).toBe(0);
        expect(at('npm ci && git log -g')).toBe(0);
    });

    it('refuses npx, npm exec and npm x unless they are told not to fetch', () => {
        expect(at('npx playwright install')).toBe(1);
        expect(at('npm exec -- tsc')).toBe(1);
        expect(at('npm x tsc')).toBe(1);
        expect(at('npx --yes tsc')).toBe(1);
        expect(at('npx --no-install --yes tsc')).toBe(1);
        expect(at('npx --no-install tsc')).toBe(0);
        expect(at('npm exec --no -- tsc')).toBe(0);
        expect(at('npm exec --yes=false -- tsc')).toBe(0);

        expect(at('npx --no tsc')).toBe(0);
        expect(at('echo done && npx --no-install tsc')).toBe(0);
    });

    it('refuses npm create and npm init given an initializer, which always fetch one', () => {
        expect(at('npm create vite')).toBe(1);
        expect(at('npm init vite')).toBe(1);
        expect(at('npm init -y')).toBe(0);
    });

    it('reads only commands, not words in a sentence', () => {
        expect(
            scriptsOnProblems('x.mjs', ' * a run of npx tools, or the npm exec command\n')
        ).toEqual([]);
    });
});

describe('the review of the first round', () => {
    // Each refused word is built from parts, so this file holds none of them whole.
    const off = ['--ignore', '-scripts'].join('');
    const fetchOff = ['--allow', '-git=none ', '--allow', '-remote=none'].join('');
    const at = (line: string) => scriptsOnProblems('ci.yml', `run: ${line}\n`).length;

    it("refuses npm's exec command given --no-install, which it does not read as --no", () => {
        expect(at('npm exec --no-install -- tsc')).toBe(1);
        expect(at('npm x --no-install tsc')).toBe(1);
    });

    it('refuses an install outside the project that turns install scripts off but may still fetch', () => {
        expect(at(`npm install -g ${off} github:someone/tool`)).toBe(1);
        expect(at(`npm ci --prefix other ${off}`)).toBe(1);
        expect(at(`npm install -g ${off} ${fetchOff} left-pad`)).toBe(0);
        expect(at(`npm install -g --offline ${off} "$tarball"`)).toBe(0);
    });

    it('counts a copied .npmrc only in the folder the stage runs in', () => {
        expect(allLines('FROM node\nCOPY .npmrc /root/backup/\nRUN npm ci\n')).toEqual(['3']);
        expect(
            allLines('FROM node\nWORKDIR /app\nCOPY .npmrc package.json ./\nRUN npm ci\n')
        ).toEqual([]);
        expect(allLines('FROM node\nWORKDIR /app\nCOPY [".npmrc", "/app/"]\nRUN npm ci\n')).toEqual(
            []
        );
        expect(
            allLines('FROM node\nWORKDIR /app\nCOPY .npmrc ./\nWORKDIR /srv\nRUN npm ci\n')
        ).toEqual(['5']);
    });
});

describe('the npm floor', () => {
    it('refuses an npm older than the first that reads allow-git and allow-remote', () => {
        expect(npmFloorProblems('11.13.9')).toHaveLength(1);
        expect(npmFloorProblems('10.9.2\n')).toHaveLength(1);
        expect(npmFloorProblems('11.14.0')).toEqual([]);
        expect(npmFloorProblems('11.14.0-pre.0')).toHaveLength(1);
        expect(npmFloorProblems('11.14.1-pre.0')).toEqual([]);

        expect(npmFloorProblems('11.19.1-pre.0+build.5')).toEqual([]);
        expect(npmFloorProblems('12.0.0')).toEqual([]);
    });
});
