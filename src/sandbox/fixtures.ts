import type { SeedPage } from "./FakeWikiRepositoryClient";

/**
 * Seed content for the local sandbox.
 *
 * These pages deliberately exercise the rendering pipeline's interesting cases —
 * Mermaid, KaTeX, callouts, fenced code, tables, wiki links, and the Azure
 * DevOps placeholder syntaxes — so `npm run dev:sandbox` shows renderer
 * regressions immediately. Keep the tree shallow but nested, because the page
 * tree's expand, reorder, and reparent behaviour is what the sandbox is best at
 * exercising.
 *
 * Work-item (`AB#123`), query, and `@mention` syntaxes are included on purpose:
 * they resolve through host services that the sandbox does not fake, so this is
 * also where you see how the renderer degrades when enrichment is unavailable.
 */
export const SANDBOX_PAGES: readonly SeedPage[] = [
  {
    path: "/Home",
    content: `# Sandbox home

This wiki is in-memory. Every edit, rename, move, and delete works, and all of it
is discarded when you reload the page.

> [!NOTE]
> Rendering, editing, and page-tree behaviour are faithful here. Attachments,
> follow, work-item enrichment, and @mentions need real host services, so they
> degrade instead of working.

## What to try

| Area | Try this |
| --- | --- |
| Page tree | Drag a page onto another to reparent it, or between two to reorder |
| Editor | Press \`/\` for the slash menu, or use the Markdown toolbar |
| Rename | Rename **Guides** and watch its children follow |
| Search | Search for "Mermaid" |

See [Markdown reference](/Guides/Markdown-reference) and
[Diagrams](/Guides/Diagrams).
`
  },
  {
    path: "/Guides",
    content: `# Guides

A parent page, here so renaming and moving a subtree is easy to exercise.
`
  },
  {
    path: "/Guides/Markdown-reference",
    content: `# Markdown reference

## Callouts

> [!TIP]
> Callouts come from \`calloutsPlugin\`.

> [!WARNING]
> Nested content works too:
>
> \`\`\`json
> { "ok": true }
> \`\`\`

## Math

Inline $E = mc^2$, and a block:

$$
\\int_{0}^{\\infty} e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2}
$$

## Code

\`\`\`typescript
export function greet(name: string): string {
  return \`Hello, \${name}\`;
}
\`\`\`

## Table with alignment

| Left | Centre | Right |
| :--- | :----: | ----: |
| a | b | 1 |
| c | d | 22 |

## Task list

- [x] Render Markdown
- [ ] Ship the canary pipeline

## Degrades without host services

A work item reference: AB#15. A mention: @<sandbox-user>.
`
  },
  {
    path: "/Guides/Diagrams",
    content: `# Diagrams

## Flowchart

\`\`\`mermaid
flowchart LR
  Dev[Local sandbox] --> Canary[Private canary]
  Canary --> Public[Public Marketplace]
  Canary -.->|fails| Dev
\`\`\`

## Sequence

\`\`\`mermaid
sequenceDiagram
  autonumber
  Maintainer->>CI: push to main
  CI->>Marketplace: publish private canary
  CI->>Playwright: pw:verify against canary
  Playwright-->>Maintainer: green
\`\`\`

Use the diagram toolbar to zoom, pan, fullscreen, and export.
`
  },
  {
    path: "/Guides/Editing",
    content: `# Editing

Edit this page to try autosave and draft recovery: start typing, reload before
saving, and the draft offer should appear.

1. Ordered lists
2. Survive a round trip
   - Including nested bullets

Term separated by a horizontal rule:

---

*Emphasis*, **strong**, \`inline code\`, and ~~strikethrough~~.
`
  },
  {
    path: "/Release-process",
    content: `# Release process

\`\`\`mermaid
flowchart TD
  A[Working tree] -->|npm run dev:sandbox| B[Local sandbox]
  A -->|dev extension, baseUri| C[Real ADO, live code]
  A -->|push to main| D[Private canary]
  D -->|pw:verify green| E[Tag v*]
  E --> F[Public Marketplace]
\`\`\`

Layer 1 is this sandbox. Layers 2 and 3 need the private extensions described in
\`AGENTS.md\`.
`
  }
];
