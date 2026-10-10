/**
 * HTTP surface of the orchestrator. Deliberately small: five operations, no frameworks,
 * no dependencies, and no path that can reach the host filesystem.
 *
 * It binds to loopback by default. Exposing it to a network is a decision the operator
 * makes explicitly (and should put behind TLS), not something this file does on its own.
 */
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { OrchestratorError, createOrchestrator } from "./orchestrator.mjs";

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
      if (parts[0] !== "api") return send(res, 404, { error: "not found" });

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
    console.log(`MovilClaw listening on http://${host}:${port}`);
  });
}
