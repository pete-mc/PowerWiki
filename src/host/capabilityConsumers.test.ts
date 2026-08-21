// Every declared capability must actually be read by the UI.
//
// `WikiHostCapabilities` is how a host says what it can do, and the UI is
// supposed to omit what is unavailable rather than render an action that fails.
// A member nothing reads breaks that silently: it looks like the rule is being
// followed, the type checks, every host dutifully sets a value — and the UI
// shows the feature anyway.
//
// This has now happened twice. `search` was declared, set to false on the work
// item form, and read by nothing, so the whole-wiki search box appeared on a
// surface with nowhere to come back from. `mentions` was declared and read by
// nothing; mentions degraded only because the identity provider happened to be
// absent as well. Both were found by reading the code, which is not a strategy.

import { readFileSync, readdirSync, statSync } from "node:fs";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

const SOURCE_ROOT = path.resolve(__dirname, "..");
const HOST_INTERFACE = path.join(SOURCE_ROOT, "host", "WikiHost.ts");

/** Layers that consume capabilities. The hosts themselves only declare them. */
const CONSUMER_DIRS = ["app", "rendering", "export", "drawio", "extension", "vscode"];

/** Reads the member names out of the `WikiHostCapabilities` interface. */
function declaredCapabilities(): readonly string[] {
  const source = readFileSync(HOST_INTERFACE, "utf8");
  const start = source.indexOf("export interface WikiHostCapabilities {");
  expect(start, "WikiHostCapabilities should exist").toBeGreaterThan(-1);
  const body = source.slice(start, source.indexOf("\n}", start));

  const names: string[] = [];
  for (const line of body.split("\n")) {
    const match = /^\s*readonly (\w+)\s*:/.exec(line);
    if (match) {
      names.push(match[1]);
    }
  }
  return names;
}

function sourceFiles(): readonly string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
        files.push(full);
      }
    }
  };
  for (const dir of CONSUMER_DIRS) {
    const full = path.join(SOURCE_ROOT, dir);
    try {
      walk(full);
    } catch {
      // A layer that does not exist yet is not a failure.
    }
  }
  return files;
}

describe("host capabilities", () => {
  const capabilities = declaredCapabilities();
  const corpus = sourceFiles()
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");

  it("declares the capabilities this test knows how to find", () => {
    // Guards the parsing above: if the interface is reshaped and this comes back
    // empty, every assertion below would pass vacuously.
    expect(capabilities.length).toBeGreaterThan(5);
  });

  it.each(capabilities.map((name) => [name]))("%s is read by the UI", (name) => {
    // `capabilities.x` or a destructured `x` off a capabilities object. Loose on
    // purpose: the point is to catch a member nothing anywhere mentions, not to
    // police how it is accessed.
    const referenced =
      corpus.includes(`capabilities.${name}`) ||
      corpus.includes(`capabilities?.${name}`) ||
      new RegExp(`\\b${name}\\b\\s*[,}]`).test(corpus);

    expect(
      referenced,
      `WikiHostCapabilities.${name} is declared but nothing outside the hosts reads it, ` +
        `so the UI cannot be hiding anything on its account. Either read it where the ` +
        `feature is rendered, or delete it.`
    ).toBe(true);
  });
});
