// Keeps the VS Code API we compile against no newer than the VS Code we claim
// to support.
//
//   node tools/release/vscode-engine.mjs
//
// `vscode/package.json` `engines.vscode` is the promise to users: "works on this
// VS Code and later". `@types/vscode` in the *root* `package.json` is what
// `src/vscode/` is type-checked against. If the types are newer than the
// engine, code can call an API that older-but-supported builds do not have,
// pass `npm test`, and throw at runtime for those users.
//
// `vsce package` normally refuses exactly this, but it reads `vscode/package.json`,
// and the types live in the root manifest, so it never sees them. Through
// 1.10.1 the engine said ^1.90.0 while the types had drifted to ^1.146.0.
//
// Run by `npm test` (so a Dependabot bump fails on its own PR) and by
// `assert-vscode-manifest.mjs` (so a release cannot skip it).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * The lowest version a simple npm range admits: `^1.90.0`, `~1.90.0`,
 * `>=1.90.0`, `1.90.0`, `1.90.x`. Anything more elaborate returns null, and the
 * caller treats that as a problem rather than guessing.
 */
export function minimumVersion(range) {
  const match = /^\s*(?:\^|~|>=|=)?\s*v?(\d+)\.(\d+|x|\*)(?:\.(\d+|x|\*))?\s*$/.exec(range ?? "");
  if (!match) {
    return null;
  }
  const part = (value) => (value === undefined || value === "x" || value === "*" ? 0 : Number(value));
  return [Number(match[1]), part(match[2]), part(match[3])];
}

/**
 * Problems with the engine/types pairing, or an empty list. Patch versions are
 * ignored: `@types/vscode` publishes one release per VS Code minor.
 */
export function vscodeEngineProblems(
  rootManifest = readJson(path.join(REPO_ROOT, "package.json")),
  extensionManifest = readJson(path.join(REPO_ROOT, "vscode", "package.json"))
) {
  const typesRange = rootManifest.devDependencies?.["@types/vscode"] ?? rootManifest.dependencies?.["@types/vscode"];
  const engineRange = extensionManifest.engines?.vscode;

  if (!typesRange) {
    return ['root package.json has no "@types/vscode"; src/vscode/ would not type-check'];
  }
  if (!engineRange) {
    return ['vscode/package.json has no "engines.vscode"'];
  }

  const types = minimumVersion(typesRange);
  const engine = minimumVersion(engineRange);
  if (!types || !engine) {
    return [
      `cannot compare @types/vscode "${typesRange}" with engines.vscode "${engineRange}"; ` +
        "use a plain ^, ~ or exact version for both"
    ];
  }

  const [typesMajor, typesMinor] = types;
  const [engineMajor, engineMinor] = engine;
  if (typesMajor > engineMajor || (typesMajor === engineMajor && typesMinor > engineMinor)) {
    return [
      `@types/vscode "${typesRange}" (root package.json) is newer than engines.vscode ` +
        `"${engineRange}" (vscode/package.json), so src/vscode/ can call APIs that supported ` +
        "VS Code builds lack. Pin @types/vscode to the engine's minor, or raise the engine " +
        "deliberately (a user-visible support change) and note it in vscode/CHANGELOG.md."
    ];
  }

  return [];
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const problems = vscodeEngineProblems();
  if (problems.length > 0) {
    for (const problem of problems) {
      console.error(`vscode-engine: ${problem}`);
    }
    process.exit(1);
  }
}
