#!/usr/bin/env node
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const port = process.env.PORT || 3000;
const root = fileURLToPath(new URL(".", import.meta.url));

const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".wasm": "application/wasm",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
};

const server = createServer(async (req, res) => {
  try {
    const urlPath = decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname);
    const safePath = normalize(urlPath).replace(/^(\.\.[/\\])+/, "");
    let filePath = join(root, safePath || ".");
    let info;
    try {
      info = await stat(filePath);
    } catch {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    if (info.isDirectory()) {
      filePath = join(filePath, "index.html");
      info = await stat(filePath);
    }

    const buf = await readFile(filePath);
    const type = mime[extname(filePath)] || "application/octet-stream";
    res.writeHead(200, {
      "Content-Type": type,
      "Cross-Origin-Embedder-Policy": "require-corp",
      "Cross-Origin-Opener-Policy": "same-origin",
    });
    res.end(buf);
  } catch (err) {
    res.writeHead(500);
    res.end(String(err));
  }
});

server.listen(port, () => {
  console.log(`Serving ${root} on http://localhost:${port}`);
  console.log("Headers: COOP same-origin, COEP require-corp (SharedArrayBuffer enabled)");
});
