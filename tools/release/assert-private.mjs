// Refuses to let a non-public build be published as anything but private.
//
//   node tools/release/assert-private.mjs vss-extension.canary.json
//
// The failure this guards against is severe and irreversible. Publisher + id is
// an extension's identity, so publishing a variant under the public `powerwiki`
// id would replace the listing that every installed organization auto-updates
// from — 20+ of them — and a version number can never be republished.
//
// Both publish workflows call this before uploading anything. It is a script
// rather than an inline check in each workflow so there is exactly one copy of
// the rule; a guard that exists in two places is a guard that will disagree with
// itself.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const target = process.argv[2];
if (!target) {
  console.error("Usage: assert-private.mjs <manifest.json>");
  process.exit(2);
}

const base = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "vss-extension.json"), "utf8"));
const manifest = JSON.parse(fs.readFileSync(path.resolve(REPO_ROOT, target), "utf8"));

const problems = [];

if (manifest.public !== false) {
  problems.push(`"public" must be exactly false, found ${JSON.stringify(manifest.public)}`);
}

if (manifest.id === base.id) {
  problems.push(`"id" is "${manifest.id}", the same as the public extension`);
}

if (typeof manifest.id !== "string" || !manifest.id.startsWith(`${base.id}-`)) {
  problems.push(`"id" must start with "${base.id}-", found ${JSON.stringify(manifest.id)}`);
}

if (manifest.publisher !== base.publisher) {
  // Not dangerous, but it means --share-with is pointing at the wrong publisher's
  // extension and the install will silently never appear.
  problems.push(`"publisher" is ${JSON.stringify(manifest.publisher)}, expected ${JSON.stringify(base.publisher)}`);
}

if (problems.length > 0) {
  for (const problem of problems) {
    // ::error:: makes it a GitHub Actions annotation; harmless locally.
    console.error(`::error::${target}: ${problem}`);
  }
  console.error(`\nRefusing to publish ${target}.`);
  process.exit(1);
}

console.log(`${target} is safe to publish:`);
console.log(`  id        ${manifest.id}`);
console.log(`  version   ${manifest.version}`);
console.log(`  public    ${manifest.public}`);
console.log(`  publisher ${manifest.publisher}`);
if (manifest.baseUri) {
  console.log(`  baseUri   ${manifest.baseUri}`);
}
