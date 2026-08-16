# Contributing to PowerWiki

Thanks for your interest in PowerWiki. This document covers how to build, test,
and verify a change, and what to expect from review.

## Guiding principle

PowerWiki keeps **Azure DevOps as the wiki system of record**. Pages are stored
as ordinary Markdown in the standard Azure DevOps Wiki Git repositories, and the
built-in Wiki experience is never removed, hidden, or disabled. A change that
introduces a proprietary page format, a separate backing store, or syntax that
cannot degrade gracefully in the built-in wiki is out of scope.

Before implementing a feature, compare it with the current Azure DevOps Wiki
behavior and document any intentional difference — especially differences that
affect stored Markdown, links, attachments, permissions, or page history.

`AGENTS.md` in the repository root is the fuller architectural guide, including
the module boundaries, theming rules, and hard-won API constraints. Read it
before a non-trivial change.

## Prerequisites

- Node.js 24.15 or later, and npm.
- An Azure DevOps organization you can install extensions into (only needed for
  end-to-end verification — see below).

You do **not** need Marketplace publisher access to develop or test PowerWiki.

## Build and test

```bash
npm install
```

```bash
npm test
```

`npm test` runs `tsc --noEmit` followed by the Vitest unit tests. Both must pass
before a pull request can merge; CI runs the same command.

To build the bundled extension assets into `dist/`:

```bash
npm run build
```

To iterate with a watching build:

```bash
npm run dev
```

Better, to actually *see* your change without an Azure DevOps organization:

```bash
npm run dev:sandbox
```

That serves the whole UI at <http://localhost:3000/dist/sandbox.html> against an
in-memory wiki — no organization, no extension install, no sign-in — and rebuilds
as you edit. Add `?theme=dark` to check the dark theme, or `?latency=800` to make
loading states obvious. Rendering, the editors, the page tree, and export can all
be developed here. Attachments, follow, work-item enrichment, and `@mentions` need
real host services, so they degrade rather than work; the seed content shows what
that looks like.

## Where code goes

Keep responsibilities separated — do not mix UI, API access, rendering, and
business rules in one file:

- `src/extension/` — Azure DevOps extension host initialization and entry points.
- `src/app/` — screen shell, page tree, editor, comments panel, theme helpers.
- `src/rendering/` — Markdown, Mermaid, and sanitization boundaries.
- `src/drawio/` — draw.io embed protocol, editor dialog, diagram naming rules.
- `src/wiki/` — wiki repository/page/comment abstractions and API access.
- `src/workItems/` — Azure Boards work item and query access.

Renderer dependencies should stay upgradeable independently of the Azure DevOps
integration. Any renderer-specific behavior belongs behind a fixture in
`src/rendering/*.test.ts`, so future Markdown or Mermaid upgrades are deliberate
rather than accidental.

## Theming

PowerWiki follows the active Azure DevOps theme rather than defining its own.
Keep colors behind the `--pw-*` tokens in `src/app/styles.css` and map those to
host CSS variables. Verify UI chrome, Markdown preview, editor chrome, and
Mermaid diagrams in **both light and dark** Azure DevOps themes. Hard-coded
colors are acceptable only for semantic states such as destructive actions.

## End-to-end verification (maintainers)

PowerWiki runs inside a cross-origin iframe, so a real browser is needed to assert
on what it renders. The Playwright harness in `tools/pw/` does that.

This no longer requires a public release. Maintainers publish two *private*
extensions — a `powerwiki-dev` build whose assets are served from localhost, and a
`powerwiki-canary` build published automatically from `main` — and verify against
those. See "Testing before release" in `AGENTS.md`; the public Marketplace is the
last step, never the test bed.

```bash
npm run pw:auth
```

```bash
npm run pw:verify
```

`pw:auth` opens Chrome against a dedicated persistent profile and asks you to
sign in to Azure DevOps once. That profile holds session cookies — it lives
outside the repository and must never be committed.

Because the harness needs an interactive Azure DevOps sign-in, it cannot run in
CI and outside contributors generally cannot run it. That is expected: develop
against `npm run dev:sandbox`, open your pull request with unit tests passing, and
a maintainer will run the end-to-end pass before release. If you add a feature
worth guarding, add an assertion to `tools/pw/verify.mjs` anyway so the maintainer
pass covers it.

CI packages the `.vsix` on every run and uploads it as a build artifact, so a
maintainer can sideload your pull request into a test organization without
publishing anything.

## Pull requests

- Branch from `main` and keep the change set focused.
- Make sure `npm test` passes locally.
- Describe the user-visible behavior change and any difference from the built-in
  Azure DevOps Wiki.
- Update `README.md` when setup, build, packaging, or publishing steps change.

Planning happens on an Azure Boards backlog. If your work relates to a tracked
item, mention it as `AB#<id>` in the pull request description or a commit
message and it will link automatically.

## Releasing

Publishing to the Visual Studio Marketplace is maintainer-only — it requires the
`dataversepowertools` publisher token, which never leaves the maintainer's
machine. Contributors do not need to bump versions; the maintainer increments
the patch version in `package.json` and `vss-extension.json`, builds, publishes,
and tags the release.

## Reporting bugs and security issues

Open a [GitHub issue](https://github.com/pete-mc/PowerWiki/issues) for bugs and
feature requests. Include your Azure DevOps organization type (Services or
Server), the PowerWiki version, and the Markdown that reproduces a rendering
problem where relevant.

For a suspected security vulnerability, please do not open a public issue —
report it privately through GitHub's security advisory form on the repository.
