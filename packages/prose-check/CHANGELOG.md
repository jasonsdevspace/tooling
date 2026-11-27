# Changelog

What changed in each version of `@jasonsdevspace/prose-check`, newest first. Until 1.0.0, a minor
version can fail a build that passed before, with a new rule or a rule that matches more, and a
patch never does, as the package's README says. Each version has a release on GitHub with its entry
as the notes.

## 0.3.0

A `check-commit-message` command holds a commit message, or a pull request's title and body, to
every prose rule and refuses one that names a tool, and Markdown leaves out a block indented four
spaces, in a minor version, since it adds a command and a document may now pass a line it failed
before only where that line is code.

- **Rules.** In Markdown, a block indented four spaces or a tab after a blank line, outside a list,
  is read as code and left out, as a fenced block is. Inside a list the same indent continues the
  item and is still read.
- **Command.** `check-commit-message` takes the path to a message file and reads only what git will
  store, leaving out git's comment lines and the diff below the scissors line, or every line as
  written with `--as-is`. It refuses a message that names a tool rather than the work, or a bot as
  a co-author, and one that breaks a prose rule, read as Markdown, so a British spelling or a
  marker such as `TODO` fails while `Closes #12` passes. It names each rule once, at the first line
  that breaks it, counting lines as the author wrote them, or with `--as-is` as the title or by the
  line's number in the body. With `core.commentChar` set to `auto`, it works out git's comment
  character as git does, so a line of the author's that starts with `#` is read when git chose
  another. It exits 0 on a pass, 1 on a refusal, and 2 with how to run it when given no file, a
  file it cannot read or an option it does not know.
- **Function.** `messageProblems`, `commentOf`, `storedMessage`, `textToCheck` and `TOOLS` are
  exported with their types.
- **Docs.** The README says what the command checks, how it reads git's comment lines and how a
  commit hook and a workflow run it, and that Markdown leaves out an indented code block.
- **Tests.** The cases of the command each repository kept as a script of its own pass against it,
  with a British spelling, a process artifact and an empty opener now refused, and CI runs the
  command from the packed tarball on the oldest Node, requiring the refusal to name the rule.

## 0.2.0

The check finds writing that fills space rather than saying something, an en dash used as a dash, a
placeholder left in and an emoji. It reads `.jsx` files and finds more semicolons joining clauses. A
repository that moves to this version may find lines written before it.

- **Rules.** A trailing -ing clause, an inflated word, an empty opener, a canned closer, a wordy
  phrase, an intensifier, a leftover placeholder, an en dash used as a dash and an emoji are each a
  rule of their own, with words that have a technical meaning in code or docs, such as `harness` and
  `dynamic`, left out. A stock phrase such as `in summary` counts only where it opens a sentence
  with a comma. A semicolon after a digit, a closing bracket or a quote with more on the line joins
  clauses as one after a letter does. `.jsx` files are read. Code quoted in backticks in a comment
  and a doc comment's example are left out, and so are a page's code samples, as Markdown's inline
  code is. A numeric character reference such as `&#169;` reads as no text, and a Markdown reference
  whose label the file defines reads as a link.
- **Command.** A passing run says every file it read follows every rule, rather than naming the
  rules.
- **Docs.** The README lists every rule with an example, says what it reads in each kind of file,
  shows a failure as text, covers CI with the Node it needs, a pre-commit hook and every export, and
  opens with badges and links. The package's description names the new rules, and its repository,
  homepage and links point at `jasonsdevspace/tooling`, where its source now lives.
- **Tests.** Each new rule finds the lines it names and passes the lines that only look like them. A
  semicolon after a digit, a bracket or a quote is found while code quoted in a comment, a
  commented-out statement, a doc comment's example, a page's code sample and a character reference
  are not. A doc comment's bracketed parameter and a defined Markdown reference are not read as
  placeholders.

## 0.1.0

Released from jasonsdevspace/design-kit, as
[its release there](https://github.com/jasonsdevspace/design-kit/releases/tag/prose-check-v0.1.0)
shows.

The prose check as a package of its own, which every repository installs in place of its own copy.

- **Rules.** Em dashes anywhere, semicolons joining clauses, process artifacts held to word
  boundaries, issue and pull request numbers in comments, and British spellings, the British
  spelling of gray among them, in comments, Markdown, page text and workflows.
- **Command.** `check-prose` reads every file of the repository it is run in that git tracks or
  would add, leaving out what the repository ignores and the files and folders its
  `proseCheck.skip` names, written with or without a leading `./` or `/` and a trailing slash. It
  takes no arguments, refuses a skipped path that matches no file, and ends with one line where it
  cannot start, such as outside git or with a `package.json` it cannot read.
- **Function.** `proseProblems` checks one piece of text, given a path that says what kind it is,
  such as `body.md` for a pull request's body. Its types are written from the code's own JSDoc.
