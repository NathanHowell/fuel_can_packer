#!/usr/bin/env node
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const port = Number(process.env["PORT"]) || 3000;
const root = fileURLToPath(new URL(".", import.meta.url));

const mime: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".wasm": "application/wasm",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
};

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  try {
    const host = req.headers.host;
    if (host === undefined || req.url === undefined) {
      res.writeHead(400);
      res.end("Bad request");
      return;
    }

    const urlPath = decodeURIComponent(new URL(req.url, `http://${host}`).pathname);
    const safePath = normalize(urlPath).replace(/^(\.\.[/\\])+/, "");
    let filePath = join(root, safePath !== "" ? safePath : ".");
    let info;
    try {
      info = await stat(filePath);
    } catch {
      if (safePath === "favicon.ico") {
        filePath = join(root, "dist", "favicon.ico");
        try {
          info = await stat(filePath);
        } catch {
          res.writeHead(404);
          res.end("Not found");
          return;
        }
      } else {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
    }
    if (info.isDirectory()) {
      filePath = join(filePath, "index.html");
      info = await stat(filePath);
    }

    const buf = await readFile(filePath);
    const type = mime[extname(filePath)] ?? "application/octet-stream";
    res.writeHead(200, {
      "Content-Type": type,
    });
    res.end(buf);
  } catch (err) {
    res.writeHead(500);
    res.end(String(err));
  }
});

server.listen(port, () => {
  console.log(`Serving ${root} on http://localhost:${port}`);
});
