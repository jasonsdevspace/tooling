# Security

## Reporting a vulnerability

Please report security issues privately through
[GitHub's private vulnerability reporting](https://github.com/jasonsdevspace/tooling/security/advisories/new)
rather than in a public issue.

## Supported versions

Fixes land in a new version of the package on npm. Older versions and prereleases are not patched,
so upgrade to pick up a fix.

## What is in scope

These are tools that run in a repository's own checks, on a developer's machine and in CI, not a
deployed service: the prose check, `@jasonsdevspace/prose-check`, and the repo check,
`@jasonsdevspace/repo-check`. Reports about the code are welcome, especially a way for a
repository's files or its settings to make either check read a file outside the repository, run a
command other than git, take far longer than its text warrants, or pass a repository that lets npm
run install scripts.

## Dependencies and licenses

Neither package depends on anything at run time. Everything the repository installs beside them is
a tool for checking the code, and none of it ships. Among them, a lint plugin is under the GNU
Lesser General Public License, and a CSS parser that a test tool brings in is under the Mozilla
Public License, both accepted for tools that run only in development.
