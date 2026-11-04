// A small static server for the sandbox, with no extra dependency (this repo
// reviews every dependency it adds, and a dev-only file server is not worth the
// supply-chain surface): `npm run dev:sandbox` serves dist/sandbox.html over
// HTTP. No Azure DevOps, no sign-in; see src/sandbox/main.tsx.
//
// Only paths under dist/ and media/ are served. The document root is the
// repository, so serving it wholesale would expose .git, node_modules, and any
// local token file.
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
// dist/ holds the bundle; media/ holds the logo the shell loads as
// ../media/logo_new.png. Both are published by vss-extension.json, and both
// are safe to expose. Nothing else in the repository is.
const SERVED_DIRS = [path.join(REPO_ROOT, "dist"), path.join(REPO_ROOT, "media")];
const DIST_DIR = SERVED_DIRS[0];

const args = process.argv.slice(2);
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

  // One read, and Content-Length taken from the bytes actually being sent.
  // Deliberately not stat-then-read: --watch rewrites dist/ while this server is
  // running, so a size from an earlier stat can disagree with the body and
  // truncate the response. A directory or missing file fails here as EISDIR or
  // ENOENT, which is the same 404 either way.
  fs.readFile(resolved, (error, body) => {
    if (error) {
      const hint =
        error.code === "ENOENT" && !fs.existsSync(DIST_DIR)
          ? "dist/ does not exist yet — run `npm run build` or start this with --watch."
          : "Not found";
      send(res, 404, hint);
      return;
    }
    send(res, 200, body, {
      "Content-Length": body.length,
      "Content-Type": MIME[path.extname(resolved)] ?? "application/octet-stream"
    });
  });
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

  const server = http.createServer(handle);

  server.listen(port, "127.0.0.1", () => {
    console.log(`\nServing ${path.relative(REPO_ROOT, DIST_DIR)}/ at http://localhost:${port}${indexPath}`);
  });
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
