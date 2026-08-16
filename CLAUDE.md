# CLAUDE.md

**Read [`AGENTS.md`](AGENTS.md) — it is the authoritative engineering guide for
this repository.** Module boundaries, theming rules, the release process, backlog
conventions, and the Azure DevOps API constraints that have already cost real
time all live there. [`CONTRIBUTING.md`](CONTRIBUTING.md) covers build, test, and
pull-request mechanics.

This file exists only so that Claude Code picks the guide up automatically. It
deliberately holds no guidance of its own: instructions duplicated across
per-tool files drift apart, and the copy an agent happens to read wins. Keep
`AGENTS.md` the single source of truth and add tool-specific files only as
pointers to it, the way this one does.

## Machine-specific notes

Anything true only of one machine — provisioned tool versions, local credential
paths, how a browser or display is launched there — belongs in an untracked
`CLAUDE.local.md` beside this file, not here and not in `AGENTS.md`. That file is
gitignored; create one if your environment needs it.

If a note would also be true on another contributor's machine, it is not
machine-specific — put it in `AGENTS.md` so every agent and human gets it.
