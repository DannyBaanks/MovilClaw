/**
 * HTTP surface of the orchestrator. Deliberately small: five operations, no frameworks,
 * no dependencies, and no path that can reach the host filesystem.
 *
 * It binds to loopback by default. Exposing it to a network is a decision the operator
 * makes explicitly (and should put behind TLS), not something this file does on its own.
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { extname, join, normalize, resolve } from "node:path";
import { OrchestratorError, createOrchestrator } from "./orchestrator.mjs";

/**
 * The PWA is served by this same process, on this same port.
 *
 * It used to live on a second port behind a proxy, and the very first thing a person did
 * was open the API port, get `{"error":"not found"}` and reasonably conclude it was broken.
 * One process, one port, one URL: /api/* is the API and everything else is the app.
 */
const WEB_ROOT = resolve(fileURLToPath(new URL("../web", import.meta.url)), ".");
const STATIC_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
};

/** One file from web/, or null. Refuses anything that tries to climb out of the folder. */
async function staticFile(pathname) {
  const safe = normalize(pathname).replace(/^(\.[./\\])+/, "");
  const file = join(WEB_ROOT, safe === "/" || safe === "." ? "index.html" : safe);
  if (!file.startsWith(WEB_ROOT)) return null;
  try {
    return { body: await readFile(file), type: STATIC_TYPES[extname(file)] ?? "application/octet-stream" };
  } catch {
    return null;
  }
}

const MAX_BODY_BYTES = 16 * 1024;

function send(res, code, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(code, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    // no caching: a sandbox state is only true for a moment
    "cache-control": "no-store",
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new OrchestratorError("request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new OrchestratorError("body must be JSON"));
      }
    });
    req.on("error", reject);
  });
}

export function createApi(orch = createOrchestrator()) {
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const parts = url.pathname.split("/").filter(Boolean); // ["api","sandboxes","<id>","snapshot"]
    try {
      // Everything that is not the API is the app itself.
      if (parts[0] !== "api") {
        const asset = await staticFile(url.pathname);
        if (asset) {
          res.writeHead(200, {
            "content-type": asset.type,
            "content-length": asset.body.length,
            "cache-control": "no-store",
          });
          return res.end(asset.body);
        }
        res.writeHead(404, { "content-type": "text/html; charset=utf-8" });
        return res.end(
          "<!doctype html><meta charset=utf-8><body style=\"font:15px system-ui;background:#120d22;color:#f2eefc;padding:24px\">" +
            "<h1>MovilClaw</h1><p>Esa ruta no existe. La app está en <a style=\"color:#00dec6\" href=\"/\">/</a> " +
            "y la API en <code>/api/health</code>.</p></body>",
        );
      }

      // GET /api/health
      if (req.method === "GET" && parts[1] === "health") {
        return send(res, 200, { ok: true, service: "movilclaw", version: 1 });
      }

      // GET /api/sandboxes  ·  POST /api/sandboxes
      if (parts[1] === "sandboxes" && parts.length === 2) {
        if (req.method === "GET") return send(res, 200, { sandboxes: await orch.list() });
        if (req.method === "POST") {
          const body = await readBody(req);
          const created = await orch.create({
            ttlMinutes: body.ttlMinutes ?? 120,
            repo: typeof body.repo === "string" ? body.repo.slice(0, 200) : "",
            branch: typeof body.branch === "string" ? body.branch.slice(0, 200) : "",
          });
          // The token is never returned here: it lives server-side and dies with the sandbox.
          return send(res, 201, { id: created.id, phase: created.state.phase });
        }
        return send(res, 405, { error: "method not allowed" });
      }

      // /api/sandboxes/<id> and its sub-operations
      if (parts[1] === "sandboxes" && parts.length >= 3) {
        const id = parts[2];
        const op = parts[3];
        if (parts.length === 3) {
          if (req.method === "GET") return send(res, 200, await orch.status(id));
          if (req.method === "DELETE") {
            const force = url.searchParams.get("force") === "1";
            return send(res, 200, await orch.destroy(id, { force }));
          }
          if (req.method === "POST") return send(res, 200, await orch.use(id));
          return send(res, 405, { error: "method not allowed" });
        }
        if (op === "snapshot" && req.method === "GET") {
          const { manifest, bytes, digest } = await orch.snapshot(id);
          res.writeHead(200, {
            "content-type": "application/json; charset=utf-8",
            "content-length": bytes.length,
            "cache-control": "no-store",
            "x-movilclaw-digest": digest,
            "content-disposition": `attachment; filename="${id}.movilclaw.json"`,
          });
          return res.end(bytes);
        }
        if (op === "exec" && req.method === "POST") {
          // Only used for the demo of "it has no network". It is a dev affordance,
          // so it is refused unless the operator enabled it explicitly.
          if (process.env.MOVILCLAW_ALLOW_EXEC !== "1") {
            return send(res, 403, { error: "exec is disabled; set MOVILCLAW_ALLOW_EXEC=1 to enable it in development" });
          }
          const body = await readBody(req);
          const argv = Array.isArray(body.argv) ? body.argv.map(String).slice(0, 8) : [];
          if (!argv.length) return send(res, 400, { error: "argv is required" });
          const out = await orch.exec(id, argv);
          return send(res, 200, { out });
        }
        return send(res, 404, { error: "unknown operation" });
      }

      return send(res, 404, { error: "not found" });
    } catch (error) {
      const known = error instanceof OrchestratorError;
      // A refused operation is a 409: the request was understood and denied on purpose.
      const code = known ? 409 : 500;
      return send(res, code, { error: error.message, kind: known ? "refused" : "internal" });
    }
  });
}

/**
 * Start only when this file is the entry point.
 *
 * Comparing `import.meta.url` against a hand-built `file://` string looks right and is
 * wrong: the URL is percent-encoded, so a project path with a space ("ISyCo Git") never
 * matches and the server silently refuses to listen. `fileURLToPath` decodes it.
 */
const invokedDirectly =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (invokedDirectly) {
  const port = Number(process.env.PORT ?? 8788);
  const host = process.env.HOST ?? "127.0.0.1";
  createApi().listen(port, host, () => {
    // One URL, and it is the app. The API is behind /api on the same origin.
    console.log(`MovilClaw listo: abre http://${host}:${port} en el navegador`);
    console.log(`(la API vive en http://${host}:${port}/api/health)`);
  });
}
