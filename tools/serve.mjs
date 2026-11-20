#!/usr/bin/env node
/* Serve site/ for local work.
 *
 *     node tools/serve.mjs [port]
 *
 * The page is mounted at /foundry/ as production serves it. /assets/* (the
 * circuit rails, which belong to datarail-site) and every other path redirect
 * to the live datarail.org, so the preview wears the real rails.
 */

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..", "site");
const PORT = Number(process.argv[2] || 5304);
const MOUNT = "/foundry";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

createServer(async (request, response) => {
  const path = decodeURIComponent(new URL(request.url, "http://localhost").pathname);

  if (path === "/" || path === MOUNT) {
    response.writeHead(302, { location: `${MOUNT}/` }).end();
    return;
  }
  if (!path.startsWith(`${MOUNT}/`)) {
    response.writeHead(302, { location: `https://datarail.org${path}` }).end();
    return;
  }

  let file = path.slice(MOUNT.length);
  if (file.endsWith("/")) file += "index.html";
  const target = join(ROOT, normalize(file));
  if (!target.startsWith(ROOT)) {
    response.writeHead(403).end("403");
    return;
  }

  try {
    const body = await readFile(target);
    response.writeHead(200, {
      "content-type": TYPES[extname(target)] || "application/octet-stream",
      "cache-control": "no-store",
    });
    response.end(body);
  } catch {
    response.writeHead(404, { "content-type": "text/plain" }).end(`404 ${path}`);
  }
}).listen(PORT, () => console.log(`Foundry on http://localhost:${PORT}${MOUNT}/`));
