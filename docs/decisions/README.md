# Decision records

The decisions about this repository that had a real alternative, with the options rejected, what
the choice costs, and the test behind it.

1. [The house's build tools live in this repository, apart from the design
   kit](0001-the-house-build-tools-live-here.md): one workspace for every tool the repositories
   share, released from one workflow, and why a place beside the kit, a repository for each
   package and a place inside the kit's package were turned down.
2. [npm's own setting over reading commands](0002-npm-settings-over-reading-commands.md): the repo
   check holds each repository to npm's `ignore-scripts`, `allow-git` and `allow-remote` settings
   rather than reading how each install is written, and what that costs a repository's own
   lifecycle scripts.
