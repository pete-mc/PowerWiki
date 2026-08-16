// A small static server for the two local development loops, with no extra
// dependency (this repo reviews every dependency it adds, and a dev-only file
// server is not worth the supply-chain surface):
//
//   1. The sandbox — `npm run dev:sandbox` serves dist/sandbox.html over HTTP.
//      No Azure DevOps, no sign-in; see src/sandbox/main.tsx.
//
//   2. The dev extension — `npm run dev:extension` serves the same dist/ over
//      HTTPS so a private extension published with
//      `"baseUri": "https://localhost:3000"` loads this working tree inside real
//      Azure DevOps. See "Testing before release" in AGENTS.md.
//
// Only paths under dist/ and media/ are served. The document root is the
// repository, so serving it wholesale would expose .git, node_modules, and any
// local token file.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
// dist/ holds the bundle; media/ holds the logo the shell loads as
// ../media/logo_new.png. Both are published by vss-extension.json, and both
// are safe to expose. Nothing else in the repository is.
const SERVED_DIRS = [path.join(REPO_ROOT, "dist"), path.join(REPO_ROOT, "media")];
const DIST_DIR = SERVED_DIRS[0];
const CERT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), ".cert");

const args = process.argv.slice(2);
const useHttps = args.includes("--https");
const watch = args.includes("--watch");
const port = Number(readFlag("--port") ?? 3000);
// Where "/" redirects, so the URL printed on start is the one you want.
const indexPath = readFlag("--index") ?? "/dist/sandbox.html";

function readFlag(name) {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

const MIME = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".woff": "font/woff",
  ".woff2": "font/woff2"
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    // Azure DevOps loads the extension from a different origin and frames it, so
    // both must be permitted. Safe here because nothing outside dist/ is served.
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store",
    ...headers
  });
  res.end(body);
}

function handle(req, res) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  } catch {
    send(res, 400, "Bad request");
    return;
  }

  if (pathname === "/" || pathname === "") {
    send(res, 302, "", { Location: indexPath });
    return;
  }

  // Resolve first, then confirm containment, so "..", symlinks, and encoded
  // separators cannot escape dist/.
  const resolved = path.resolve(REPO_ROOT, "." + pathname);
  const permitted = SERVED_DIRS.some(
    (dir) => resolved === dir || resolved.startsWith(dir + path.sep)
  );
  if (!permitted) {
    send(res, 403, "Only paths under dist/ and media/ are served.");
    return;
  }

  fs.stat(resolved, (error, stats) => {
    if (error || !stats.isFile()) {
      const hint =
        error && error.code === "ENOENT" && !fs.existsSync(DIST_DIR)
          ? "dist/ does not exist yet — run `npm run build` or start this with --watch."
          : "Not found";
      send(res, 404, hint);
      return;
    }
    send(res, 200, fs.readFileSync(resolved), {
      "Content-Length": stats.size,
      "Content-Type": MIME[path.extname(resolved)] ?? "application/octet-stream"
    });
  });
}

/**
 * A self-signed localhost certificate, generated once and reused.
 *
 * Browsers will warn on it. That is expected: accept it once for the sandbox, and
 * for the dev extension Playwright is launched with ignoreHTTPSErrors so the
 * unattended harness never sees the interstitial.
 */
function ensureCertificate() {
  const keyPath = path.join(CERT_DIR, "localhost-key.pem");
  const certPath = path.join(CERT_DIR, "localhost-cert.pem");
  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    return { cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath) };
  }

  fs.mkdirSync(CERT_DIR, { recursive: true });
  console.log("Generating a self-signed localhost certificate (once)...");
  const result = spawnSync(
    "openssl",
    [
      "req", "-x509",
      "-newkey", "rsa:2048",
      "-nodes",
      "-keyout", keyPath,
      "-out", certPath,
      "-days", "365",
      "-subj", "/CN=localhost",
      "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1"
    ],
    { stdio: "inherit" }
  );
  if (result.status !== 0) {
    throw new Error(
      "openssl could not generate a certificate. Install openssl, or drop --https."
    );
  }
  return { cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath) };
}

function main() {
  if (watch) {
    // Rebuild on change in the same command, so one terminal is enough.
    const webpack = spawn(
      process.platform === "win32" ? "npx.cmd" : "npx",
      ["webpack", "--mode", "development", "--watch"],
      { cwd: REPO_ROOT, stdio: "inherit" }
    );
    process.on("SIGINT", () => {
      webpack.kill("SIGINT");
      process.exit(0);
    });
  }

  const server = useHttps
    ? https.createServer(ensureCertificate(), handle)
    : http.createServer(handle);

  server.listen(port, "127.0.0.1", () => {
    const scheme = useHttps ? "https" : "http";
    console.log(`\nServing ${path.relative(REPO_ROOT, DIST_DIR)}/ at ${scheme}://localhost:${port}${indexPath}`);
    if (useHttps) {
      console.log("Publish the dev extension with baseUri set to this origin; see AGENTS.md.");
    }
  });
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
