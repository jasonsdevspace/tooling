#!/usr/bin/env node
/**
 * Fails when the repository it is run in installs npm packages with their install scripts on, in a
 * workflow, a composite action or a Dockerfile, naming each file and line, and passes otherwise.
 * It exits 0 on a pass, 1 on a refusal, and 2 with how to run it when given an argument or run
 * outside a git repository.
 */
import { installProblems, repositoryRoot } from '../src/index.mjs';

if (process.argv.length > 2) {
    console.error(
        'check-installs takes no arguments and reads the whole repository it is run in. Run it from anywhere inside the repository.'
    );
    process.exit(2);
}

/** @type {string[]} */
let failures;
try {
    failures = installProblems(repositoryRoot(process.cwd()));
} catch (error) {
    console.error(`check-installs: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(2);
}
if (failures.length > 0) {
    console.error(
        `Install check failed. Each install below runs its packages' install scripts, so add --ignore-scripts:\n`
    );
    console.error(failures.join('\n'));
    process.exit(1);
}
console.log('Install check passed. Every install leaves install scripts off.');
