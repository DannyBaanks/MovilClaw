/** A static server for the PWA: no dependencies, no directory traversal. */
import { createServer, request as httpRequest } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

// fileURLToPath, not `.pathname`: the URL is percent-encoded, so a project path with a
// space ("ISyCo Git") would never resolve and every request would 404.
const ROOT = fileURLToPath(new URL(".", import.meta.url));
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
                ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
                ".svg": "image/svg+xml", ".png": "image/png" };

/** The orchestrator address the static server proxies to (same origin for the browser). */
const API = process.env.MOVILCLAW_API ?? "http://127.0.0.1:8788";

createServer(async (req, res) => {
  const requested = new URL(req.url ?? "/", "http://localhost").pathname;

  // /api/* goes to the orchestrator, so the PWA needs a single base URL and no CORS.
  if (requested.startsWith("/api/")) {
    const target = new URL(API);
    const proxy = httpRequest(
      { hostname: target.hostname, port: target.port, path: req.url, method: req.method,
        headers: { ...req.headers, host: `${target.hostname}:${target.port}` } },
      (upstream) => {
        res.writeHead(upstream.statusCode ?? 502, upstream.headers);
        upstream.pipe(res);
      },
    );
    proxy.on("error", () => {
      res.writeHead(502, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: `orchestrator unreachable at ${API}` }));
    });
    req.pipe(proxy);
    return;
  }

  const safe = normalize(requested).replace(/^(\.\.[/\\])+/, "");
  const file = join(ROOT, safe === "/" ? "index.html" : safe);
  if (!file.startsWith(ROOT)) { res.writeHead(403).end("forbidden"); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream",
                         "cache-control": "no-store" });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("not found");
  }
}).listen(Number(process.env.WEB_PORT ?? 4173), () => console.log("PWA on http://127.0.0.1:4173"));
