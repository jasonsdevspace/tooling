import { isDockerfile as installCheckReads } from '@jasonsdevspace/install-check';
import { isDockerfile as proseCheckReads } from '@jasonsdevspace/prose-check';
import { describe, expect, it } from 'vitest';

/*
 * The install check and the prose check each say which files are Dockerfiles, the install check
 * with a copy of the rule so it depends on no package. The two copies give the same answer for
 * every name, so a change to one that leaves the other behind fails here.
 */

const NAMES = [
    'Dockerfile',
    'Dockerfile.prod',
    'Dockerfile.test',
    'api.Dockerfile',
    'docker/Dockerfile',
    'demo/app.Dockerfile',
    'docs/Dockerfile.md',
    'Dockerfile.',
    'notDockerfile',
    'Dockerfiles',
    'Dockerfiles.md',
    'dockerfile',
    'Dockerfile-prod',
    '.Dockerfile',
    'README.md',
];

describe('which files are Dockerfiles', () => {
    it('is the same in the install check and the prose check, for every name', () => {
        expect(NAMES.map(installCheckReads)).toEqual(NAMES.map(proseCheckReads));
    });
});
