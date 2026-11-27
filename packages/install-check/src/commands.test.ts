// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { dockerRunsOf, installs, npmCommandsIn, runsOf, skipsScripts } from './commands.mjs';

/** Each install a script holds, as whether it leaves install scripts off. */
const read = (script: string) => npmCommandsIn(script).filter(installs).map(skipsScripts);

/** Each install a workflow's steps hold, as whether it leaves install scripts off. */
const readSteps = (workflow: string) => runsOf(workflow).flatMap(({ run }) => read(run));

describe('reading an install', () => {
    it("finds every install, in any of npm's spellings, with scripts off only where the last flag says so", () => {
        expect(read('npm ci')).toEqual([false]);
        expect(read('npm ci --ignore-scripts')).toEqual([true]);
        expect(read('npm --ignore-scripts ci')).toEqual([true]);
        expect(read('FOO=1 npm ic --ignore-scripts')).toEqual([true]);
        expect(read('npm install-clean')).toEqual([false]);
        expect(read('npm clean-install-test')).toEqual([false]);
        expect(read('npm ci --ignore-scripts false')).toEqual([false]);
        expect(read('npm ci --ignore-scripts=true')).toEqual([true]);
        expect(read('npm ci --ignore-scripts=false')).toEqual([false]);
        expect(read('npm ci --ignore-scripts --no-ignore-scripts')).toEqual([false]);
        expect(read('npm ci "--ignore-scripts"')).toEqual([true]);
        expect(read('npm rebuild')).toEqual([false]);
        expect(read('npm update')).toEqual([false]);
        expect(read('npm run build')).toEqual([]);
        expect(read('npm test')).toEqual([]);
    });

    it('finds an install wherever it sits in a script', () => {
        expect(read('npm ci --ignore-scripts && npm install')).toEqual([true, false]);
        expect(read('npm ci --ignore-scripts & npm install')).toEqual([true, false]);
        expect(read('(cd site && npm ci)')).toEqual([false]);
        expect(read('if [ -n "$X" ]; then npm clean-install; fi')).toEqual([false]);
        expect(read("echo it\\'s done; npm ci; echo 'ok'")).toEqual([false]);
        expect(read('npm ci \\\n    --ignore-scripts')).toEqual([true]);
    });

    it('skips a flag that takes a value, with its value, to find the command', () => {
        expect(read('npm --prefix test ci')).toEqual([false]);
        expect(read('npm --loglevel info ci')).toEqual([false]);
        expect(read('npm -w docs ci')).toEqual([false]);
        expect(read('npm --workspace docs --cache /tmp/c ci --ignore-scripts')).toEqual([true]);
        expect(read('npm -C demo --userconfig x.npmrc install')).toEqual([false]);
        expect(read('npm --loglevel=info ci')).toEqual([false]);
        expect(read('npm --loglevel warn ci --ignore-scripts')).toEqual([true]);
    });

    it('reads an install inside another shell or a substitution, which run what they hold', () => {
        expect(read("sh -c 'npm install'")).toEqual([false]);
        expect(read('bash -c "npm ci --ignore-scripts"')).toEqual([true]);
        expect(read('echo "$(npm ci)"')).toEqual([false]);
        expect(read('x=$(npm ci)')).toEqual([false]);
        // Double quotes still run a substitution, backticks included, as bash does.
        expect(read('echo "install it with `npm install x`"')).toEqual([false]);
    });

    it('reads quotes in one pass, so an apostrophe inside double quotes opens nothing', () => {
        expect(read('echo "Don\'t panic" && npm ci && echo "it\'s done"')).toEqual([false]);
        expect(read("echo 'a \"b' && npm ci")).toEqual([false]);
    });

    it('reads no command in a shell comment', () => {
        expect(read('echo done # npm ci')).toEqual([]);
        expect(read('# npm ci\necho done')).toEqual([]);
    });

    it('reads an install inside a process substitution', () => {
        expect(read('diff <(npm ci) expected')).toEqual([false]);
        expect(read('tee >(npm ci) < x')).toEqual([false]);
    });

    it('reads no command in words a message names', () => {
        // Single quotes run nothing inside them.
        expect(read("echo 'install it with `npm install x`'")).toEqual([]);
        expect(read('echo "says nothing about npm install"')).toEqual([]);
        // An escaped backtick inside double quotes is a backtick, not a substitution.
        expect(read('export NOTE="install it with \\`npm install x\\`."')).toEqual([]);
    });

    it('leaves a redirection and its target out of the command', () => {
        expect(read('npm ci>log')).toEqual([false]);
        expect(read('npm ci --ignore-scripts 2>&1 >log')).toEqual([true]);
    });

    it('takes npx and npm exec as installs unless their own options say not to install', () => {
        expect(read('npx playwright install chromium')).toEqual([false]);
        expect(read('npx --no-install playwright install chromium')).toEqual([]);
        expect(read('npm exec -- tsc')).toEqual([false]);
        expect(read('npm exec --package=foo -- foo')).toEqual([false]);
        expect(read('npm x --no-install -- foo')).toEqual([]);
        expect(read('npm exec --no-install tsc')).toEqual([]);
        expect(read('npx --ignore-scripts some-tool')).toEqual([true]);
        expect(read('npm --ignore-scripts exec some-tool')).toEqual([true]);
        // After the tool, or after --, a flag is the tool's own, so scripts stay on.
        expect(read('npx some-tool --ignore-scripts')).toEqual([false]);
        expect(read('npm exec some-tool -- --ignore-scripts')).toEqual([false]);
        expect(read('npm exec -- --ignore-scripts')).toEqual([false]);
        // After the tool, an option is the tool's own, so npx still installs.
        expect(read('npx foo --no-install')).toEqual([false]);
        // The value of --package or -p is not the tool, so an option after it is still npx's.
        expect(read('npx -p foo --no-install tool')).toEqual([]);
    });

    it('takes npm init and npm create with an initializer as installs, since they fetch it and run it', () => {
        expect(read('npm create vite')).toEqual([false]);
        expect(read('npm init vite --ignore-scripts')).toEqual([true]);
        expect(read('npm init -y')).toEqual([]);
        // A flag's value is not an initializer.
        expect(read('npm init -w packages/a')).toEqual([]);
        expect(read('npm init --workspace packages/a -y')).toEqual([]);
        expect(read('npm init --scope @me')).toEqual([]);
        expect(read('npm init --init-author-name Jason')).toEqual([]);
        expect(read('npm init --scope @me vite')).toEqual([false]);
    });
});

describe('reading a workflow', () => {
    it('reads a step that is one quoted scalar, and a block with its indent and chomping in either order', () => {
        expect(readSteps('steps:\n    - run: "npm ci"\n')).toEqual([false]);
        expect(readSteps("steps:\n    - run: 'npm install'\n")).toEqual([false]);
        expect(readSteps('steps:\n    - run: "npm ci --ignore-scripts"\n')).toEqual([true]);
        expect(readSteps('steps:\n    - run: |2-\n          npm ci\n')).toEqual([false]);
        expect(readSteps('steps:\n    - run: |-2\n          npm ci\n')).toEqual([false]);
    });

    it("reads a block's lines and a folded block, continued lines joined, and none of the step's other keys", () => {
        expect(
            readSteps('steps:\n    - run: |\n          npm ci \\\n              --ignore-scripts\n')
        ).toEqual([true]);
        expect(
            readSteps('steps:\n    - run: >\n          npm ci\n          --ignore-scripts\n')
        ).toEqual([true]);
        expect(
            readSteps(
                'steps:\n    - run: |\n          npm ci --ignore-scripts\n      env:\n          X: npm install\n'
            )
        ).toEqual([true]);
        expect(
            readSteps('steps:\n    - name: Install with npm ci\n      run: echo done\n')
        ).toEqual([]);
    });

    it('reads no command in a comment', () => {
        expect(readSteps('steps:\n    # - run: npm ci\n    - run: echo done # npm ci\n')).toEqual(
            []
        );
    });

    it('strips a comment only outside quotes and outside a block', () => {
        expect(readSteps('steps:\n    - run: echo "a # b" && npm ci\n')).toEqual([false]);
        expect(readSteps('steps:\n    - run: |\n          echo "step # 1"; npm ci\n')).toEqual([
            false,
        ]);
        expect(readSteps('steps:\n    - run: "npm ci" # a note\n')).toEqual([false]);
        expect(readSteps('steps:\n    - run: | # a note\n          npm ci\n')).toEqual([false]);
    });

    it('names the folder a step runs in, where it names one', () => {
        const workflow =
            'steps:\n    - working-directory: demo\n      run: npm ci\n    - run: npm ci\n    - run: npm ci\n      working-directory: "${{ runner.temp }}/x"\n';
        expect(runsOf(workflow).map(({ dir }) => dir)).toEqual([
            'demo',
            undefined,
            '${{ runner.temp }}/x',
        ]);
    });

    it("names the line of each step's run, comments counted", () => {
        const workflow =
            'jobs:\n  a:\n    # a note\n    steps:\n      - name: Install\n        run: npm ci\n';
        expect(runsOf(workflow).map(({ line }) => line)).toEqual([6]);
    });
});

describe('reading a Dockerfile', () => {
    it('reads an instruction in shell form, continued lines joined, and none of its comments', () => {
        const runs = dockerRunsOf('FROM x\n# RUN npm ci\nRUN npm ci \\\n    --omit=dev\n');
        expect(runs.flatMap(({ run }) => read(run))).toEqual([false]);
        expect(runs.map(({ line }) => line)).toEqual([3]);
        expect(
            dockerRunsOf('RUN npm ci --omit=dev --ignore-scripts\n').flatMap(({ run }) => read(run))
        ).toEqual([true]);
    });

    it('skips comment lines before joining continued lines, as Docker does', () => {
        const runs = (text: string) => dockerRunsOf(text).flatMap(({ run }) => read(run));
        expect(runs('RUN npm ci \\\n# a note\n    --ignore-scripts\n')).toEqual([true]);
        expect(runs('# a note \\\nRUN npm ci\n')).toEqual([false]);
    });

    it('reads a RUN behind BuildKit flags, in exec form too', () => {
        const runs = (text: string) => dockerRunsOf(text).flatMap(({ run }) => read(run));
        expect(runs('RUN --mount=type=cache,target=/r ["npm", "ci"]\n')).toEqual([false]);
        expect(runs('RUN --mount=type=cache,target=/r npm ci --ignore-scripts\n')).toEqual([true]);
    });

    it("reads a heredoc's own line as well as its body, and a << that opens none", () => {
        const runs = (text: string) => dockerRunsOf(text).flatMap(({ run }) => read(run));
        expect(runs('RUN echo $((1<<2)) && npm ci\n')).toEqual([false]);
        expect(runs('RUN npm ci && cat <<EOF > /x\nhello\nEOF\n')).toEqual([false]);
        expect(runs('RUN npm ci <<NONE\n')).toEqual([false]);
    });

    it('reads an instruction in exec form and from a heredoc', () => {
        expect(dockerRunsOf('RUN ["npm", "ci"]\n').flatMap(({ run }) => read(run))).toEqual([
            false,
        ]);
        expect(
            dockerRunsOf('RUN ["npm", "ci", "--ignore-scripts"]\n').flatMap(({ run }) => read(run))
        ).toEqual([true]);
        expect(
            dockerRunsOf('RUN <<EOF\nset -e\nnpm ci\nEOF\nRUN echo done\n').flatMap(({ run }) =>
                read(run)
            )
        ).toEqual([false]);
        expect(
            dockerRunsOf('RUN <<-"END"\n\tnpm ci --ignore-scripts\n\tEND\n').flatMap(({ run }) =>
                read(run)
            )
        ).toEqual([true]);
    });
});
