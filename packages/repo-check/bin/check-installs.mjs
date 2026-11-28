#!/usr/bin/env node
/**
 * Fails when the repository it is run in lets npm run install scripts or fetch git and URL
 * dependencies: a package root whose `.npmrc` leaves out `ignore-scripts=true`, `allow-git=none` or
 * `allow-remote=none`, a `.npmrc`, flag or setting that gives one another value, a Dockerfile stage
 * that runs before holding all three, an install outside the project with install scripts on, or a
 * tool fetched to run, naming each file, and when the npm running it is too old to read the
 * settings. It passes otherwise.
 * It exits 0 on a pass, 1 on a refusal, and 2 with how to run it when given an argument or run
 * outside a git repository.
 */
import { execFileSync } from 'node:child_process';

import { installProblems, npmFloorProblems, repositoryRoot } from '../src/index.mjs';

if (process.argv.length > 2) {
    console.error(
        'check-installs takes no arguments and reads the whole repository it is run in. Run it from anywhere inside the repository.'
    );
    process.exit(2);
}

/** @type {string[]} */
let failures;
try {
    // npm names itself in the user agent it sets for a script it runs, which is the npm that reads
    // the settings. Run another way, the npm on the path is asked, through a shell on Windows, where
    // npm is a script that cannot be run without one.
    const agent = /(?:^|\s)npm\/(\S+)/.exec(process.env['npm_config_user_agent'] ?? '')?.[1];
    const npm =
        agent ??
        execFileSync('npm', ['--version'], {
            encoding: 'utf8',
            shell: process.platform === 'win32',
        });
    failures = [...npmFloorProblems(npm), ...installProblems(repositoryRoot(process.cwd()))];
} catch (error) {
    console.error(`check-installs: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(2);
}
if (failures.length > 0) {
    console.error(
        `Install check failed. Each place below lets npm run install scripts or fetch what it should not:\n`
    );
    console.error(failures.join('\n'));
    process.exit(1);
}
console.log('Install check passed. npm runs no install scripts here.');
