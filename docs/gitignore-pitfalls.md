# .gitignore rules do not mean what they look like

Detail behind the ignore-rule guidance in `AGENTS.md`.

Two rules failed on the same day, in opposite directions, and both failures were
silent — the file was committed, or wasn't, and `git status` was clean either
way:

- **A trailing slash matches a directory and nothing else.** `.vscode-test/` did
  not match `.vscode-test` when it was a *symlink*, so the symlink was committed
  — an absolute path pointing at itself, which would break any clone that
  followed it.
- **An unanchored name matches at every depth.** `screenshots/` silently
  swallowed `media/screenshots/`, so a new store image was missing from the
  commit that was supposed to add it.

So: **prefer anchored paths** (`/dist/`, `/media/screenshots/`) over bare names,
and **run `git status` after adding or changing an ignore rule** to see what it
actually caught. `git check-ignore -v <path>` names the rule and line responsible
when the answer is surprising.

The reason this bites rather than merely annoys: `git add -A` is how most commits
here are made, so a rule that is too narrow silently commits build output, and one
that is too broad silently drops a file the commit message says was added. Neither
shows up until someone clones, or looks.
