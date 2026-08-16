// Derives a complete manifest for a non-public build of PowerWiki.
//
// Why this is generated rather than checked in as a second manifest: the dev and
// canary builds differ from the real one in only a handful of fields, but they
// must keep the *same* contributions, scopes, and files. A hand-maintained copy
// drifts, and the way it drifts is silent — a canary that no longer matches what
// ships is worse than no canary.
//
//   node tools/release/variant-manifest.mjs dev    [--base-uri https://localhost:3000]
//   node tools/release/variant-manifest.mjs canary [--build 42]
//
// Writes vss-extension.<variant>.json, a *complete* manifest to be passed to tfx
// as the sole --manifest-globs argument.
//
// It is a whole manifest rather than a tfx --overrides-file because tfx merges an
// overrides file by *concatenating* arrays: supplying `contributions` there yields
// "duplicate contribution id" errors instead of replacing them, so the hub labels
// could not be suffixed. Generating the whole file keeps full control while still
// deriving every shared field from the real manifest.
//
// The variant MUST use a different extension id from the public `powerwiki`.
// Publisher + id is the extension's identity, so publishing a private build under
// the public id would replace the public listing that every installed
// organisation updates from. See "Testing before release" in AGENTS.md.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const BASE_MANIFEST = path.join(REPO_ROOT, "vss-extension.json");

const [variant, ...rest] = process.argv.slice(2);

function readFlag(name) {
  const index = rest.indexOf(name);
  return index === -1 ? undefined : rest[index + 1];
}

const VARIANTS = {
  dev: {
    idSuffix: "-dev",
    label: "Dev",
    // Assets are served from the maintainer's machine, so the packaged bundle is
    // irrelevant — the point is to iterate without republishing.
    usesBaseUri: true
  },
  canary: {
    idSuffix: "-canary",
    label: "Canary",
    // Deliberately no baseUri: the canary exists to exercise the real packaged
    // .vsix, which is what baseUri development skips.
    usesBaseUri: false
  }
};

if (!Object.hasOwn(VARIANTS, variant ?? "")) {
  console.error(`Usage: variant-manifest.mjs <${Object.keys(VARIANTS).join("|")}> [options]`);
  process.exit(2);
}

const config = VARIANTS[variant];
const base = JSON.parse(fs.readFileSync(BASE_MANIFEST, "utf8"));

const manifest = {
  ...base,
  id: `${base.id}${config.idSuffix}`,
  name: `${base.name} (${config.label})`,
  // Private: installable only in organisations it is explicitly shared with, so
  // it never reaches the organisations that consume the public extension.
  public: false,
  // Keep it out of search results even for anyone it is shared with.
  galleryFlags: ["Preview"],
  description: `${base.description} — ${config.label.toUpperCase()} BUILD, not for production use.`
};

if (config.usesBaseUri) {
  // Azure DevOps resolves every relative contribution URI against this, so the
  // hub HTML and its chunks come from the local dev server instead of the CDN.
  manifest.baseUri = readFlag("--base-uri") ?? "https://localhost:3000";
}

const build = readFlag("--build");
if (build !== undefined) {
  // A separate extension id has its own version stream, so a build number can
  // simply be appended. Confirm the gallery accepts the 4-part form on the first
  // canary publish; if it does not, fall back to bumping the patch component.
  if (!/^\d+$/.test(build)) {
    console.error(`--build must be a number, got "${build}"`);
    process.exit(2);
  }
  manifest.version = `${base.version}.${build}`;
}

// Both variants can be installed alongside the public extension, so every
// user-visible label is suffixed. Without this, an organisation with both shows
// two identical "Power Wiki" menu entries and there is no way to tell which build
// you are looking at — the single most confusing part of side-by-side testing.
manifest.contributions = base.contributions.map((contribution) => {
  if (typeof contribution.properties?.name !== "string") {
    return contribution;
  }
  return {
    ...contribution,
    properties: {
      ...contribution.properties,
      name: `${contribution.properties.name} (${config.label})`
    }
  };
});

const outputPath = path.join(REPO_ROOT, `vss-extension.${variant}.json`);
fs.writeFileSync(outputPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");

console.log(`Wrote ${path.relative(REPO_ROOT, outputPath)}`);
console.log(`  id:      ${manifest.id}  (public: ${manifest.public})`);
console.log(`  version: ${manifest.version}`);
if (manifest.baseUri) {
  console.log(`  baseUri: ${manifest.baseUri}`);
}
