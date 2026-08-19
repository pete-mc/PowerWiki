// Checks that a VS Code Marketplace publish is publishing what it thinks it is.
//
//   node tools/release/assert-vscode-manifest.mjs <version>
//
// This repository now publishes two extensions to the same Marketplace account
// from the same CI, and they are not interchangeable:
//
//   * `dataversepowertools.powerwiki`        — the Azure DevOps hub extension,
//     installed by 20+ organizations, released by a `v*` tag
//   * `dataversepowertools.powerwiki-vscode` — the VS Code extension,
//     released by a `vscode-v*` tag
//
// Publisher + name is an extension's identity, and a version number can never
// be republished. So a copy-paste that pointed the VS Code release at the hub
// extension's id would overwrite a live listing, irreversibly. Assert the
// identity before anything is uploaded rather than trusting the workflow to
// have passed the right manifest.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { decodePng } from "../media/png.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const EXPECTED_PUBLISHER = "dataversepowertools";
const EXPECTED_NAME = "powerwiki-vscode";
/** The Azure DevOps extension's id, which this must never be. */
const FORBIDDEN_NAME = "powerwiki";

const expectedVersion = process.argv[2];
if (!expectedVersion) {
  console.error("Usage: assert-vscode-manifest.mjs <version>");
  process.exit(2);
}

const manifestPath = path.join(REPO_ROOT, "vscode", "package.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

const problems = [];

if (manifest.publisher !== EXPECTED_PUBLISHER) {
  problems.push(`publisher is "${manifest.publisher}", expected "${EXPECTED_PUBLISHER}"`);
}

if (manifest.name === FORBIDDEN_NAME) {
  problems.push(
    `name is "${FORBIDDEN_NAME}", which is the Azure DevOps extension. Publishing under ` +
      "that id would replace a listing every installed organization updates from."
  );
} else if (manifest.name !== EXPECTED_NAME) {
  problems.push(`name is "${manifest.name}", expected "${EXPECTED_NAME}"`);
}

if (manifest.version !== expectedVersion) {
  problems.push(`version is "${manifest.version}", expected "${expectedVersion}" from the tag`);
}

// vsce fails late and unhelpfully on these; failing here says which one.
for (const required of ["displayName", "description", "engines", "repository", "icon"]) {
  if (!manifest[required]) {
    problems.push(`"${required}" is missing, and the Marketplace listing needs it`);
  }
}

if (manifest.icon) {
  const iconPath = path.join(REPO_ROOT, "vscode", manifest.icon);
  if (!fs.existsSync(iconPath)) {
    problems.push(`icon "${manifest.icon}" does not exist at ${iconPath}`);
  } else {
    problems.push(...iconProblems(iconPath));
  }
}

for (const required of ["README.md", "CHANGELOG.md", "LICENSE"]) {
  if (!fs.existsSync(path.join(REPO_ROOT, "vscode", required))) {
    problems.push(`vscode/${required} is missing; the Marketplace listing renders it`);
  }
}

/**
 * An icon must carry its own background.
 *
 * 0.1.1 shipped the brand logo as-is: a near-black glyph on transparency. It
 * looked right on the Marketplace's white page and was invisible in the VS Code
 * Extensions view, which is dark for most people. Nothing in the toolchain
 * noticed, because a transparent PNG is a perfectly valid PNG — so check it
 * here, where a version number is about to be spent.
 */
function iconProblems(iconPath) {
  let image;
  try {
    image = decodePng(fs.readFileSync(iconPath));
  } catch (error) {
    return [`icon could not be read: ${error.message}`];
  }

  const found = [];
  if (image.width < 128 || image.height < 128) {
    found.push(`icon is ${image.width}x${image.height}; the Marketplace wants at least 128x128`);
  }

  let transparent = 0;
  let total = 0;
  for (let y = 0; y < image.height; y += 8) {
    for (let x = 0; x < image.width; x += 8) {
      total += 1;
      if (image.data[(y * image.width + x) * 4 + 3] < 250) {
        transparent += 1;
      }
    }
  }

  if (transparent / total > 0.02) {
    found.push(
      `icon is ${Math.round((transparent / total) * 100)}% transparent, so it borrows the ` +
        "theme's background and disappears in dark themes. Run " +
        "`node tools/media/make-vscode-icon.mjs`."
    );
  }

  return found;
}

if (problems.length > 0) {
  console.error(`Refusing to publish ${manifestPath}:`);
  for (const problem of problems) {
    console.error(`  - ${problem}`);
  }
  process.exit(1);
}

console.log(`OK: ${manifest.publisher}.${manifest.name} ${manifest.version}`);
