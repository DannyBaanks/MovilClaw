/**
 * The orchestrator: it owns sandboxes from birth to destruction.
 *
 * It wires three things that are each simple on their own and dangerous together:
 * the lifecycle state machine (lifecycle.mjs), the Docker isolation (docker.mjs) and
 * the expiry clock. Keeping them apart is what makes the "never destroy undelivered
 * work" rule testable instead of hopeful.
 *
 * `docker` and `now` are injected. The tests drive the whole thing with a fake daemon
 * and a fake clock, so expiry is proven without waiting 30 minutes.
 */
import { createHash, randomBytes } from "node:crypto";
import {
  PHASES, advance, canDestroy, describe, markSnapshotDelivered, newLifecycle, remainingMs, touch,
} from "./lifecycle.mjs";
import { DEFAULT_SPEC, realDocker } from "./docker.mjs";
import { PHASES as NET_PHASES, assertHostAllowed, createNetwork, describePhase } from "./network.mjs";

export class OrchestratorError extends Error {}

/** Refuse a bad id before it reaches Docker: the id becomes part of a volume name. */
function assertSafeId(id) {
  if (typeof id !== "string" || !/^mc-[a-z0-9]{4,32}$/.test(id)) {
    throw new OrchestratorError("sandbox id must look like mc-<hex>");
  }
}

export function createOrchestrator({
  docker = realDocker(),
  now = () => Date.now(),
  idFactory = () => `mc-${randomBytes(6).toString("hex")}`,
  maxSandboxes = 5,
} = {}) {
  /** In memory on purpose: a sandbox that outlives its process is not a sandbox. */
  const sandboxes = new Map();
  /** What the caller handed us: the repo and the branch they want the PR against. */
  const requests = new Map();

  function requireSandbox(id) {
    assertSafeId(id);
    const sandbox = sandboxes.get(id);
    if (!sandbox) throw new OrchestratorError(`no such sandbox: ${id}`);
    return sandbox;
  }

  /** Apply the clock to every sandbox and carry out what the state machine decided. */
  async function sweep() {
    const at = now();
    for (const [id, sandbox] of [...sandboxes]) {
      const before = sandbox.state.phase;
      const next = advance(sandbox.state, at);
      if (next.phase === before) continue;
      // Keep the whole sandbox, not just its state: name and token must survive.
      sandboxes.set(id, { ...sandbox, state: next });
      await applyEffects(sandbox, next);
    }
  }

  async function applyEffects(sandbox, next) {
    if (next.phase === sandbox.state.phase) return;
    if (next.phase === PHASES.SUSPENDED) await docker.pause(sandbox.name);
    if (next.phase === PHASES.DESTROYED) await docker.stop(sandbox.name);
  }

  return {
    /** Create a sandbox. Refuses once the host is full instead of overcommitting it. */
    async create({ ttlMinutes = 120, repo = "", branch = "" } = {}) {
      if (sandboxes.size >= maxSandboxes) {
        throw new OrchestratorError(
          `the host is at its limit of ${maxSandboxes} sandboxes; free one or wait for the clock`,
        );
      }
      const at = now();
      const id = idFactory();
      const name = `${id}-box`;
      const state = newLifecycle(id, ttlMinutes, at);
      await docker.start(name, DEFAULT_SPEC);
      const sandbox = {
        name,
        state,
        // A token is issued per sandbox and dies with it. It is never logged.
        token: issueToken(id, repo, at + state.ttlMs),
        repo,
        branch,
      };
      sandboxes.set(id, sandbox);
      requests.set(id, { repo, branch });
      return { id, name, state };
    },

    /** What the UI shows: phase, countdown and why, in words. */
    async status(id) {
      await sweep();
      const sandbox = requireSandbox(id);
      return {
        id,
        phase: sandbox.state.phase,
        remainingMs: remainingMs(sandbox.state, now()),
        explanation: describe(sandbox.state, now()),
        repo: sandbox.repo,
        snapshotDelivered: sandbox.state.snapshotDelivered,
        canDestroy: canDestroy(sandbox.state),
      };
    },

    async list() {
      await sweep();
      const at = now();
      return [...sandboxes.entries()].map(([id, sandbox]) => ({
        id,
        phase: sandbox.state.phase,
        remainingMs: remainingMs(sandbox.state, at),
        explanation: describe(sandbox.state, at),
      }));
    },

    /**
     * Any real use resets the countdown and wakes a suspended sandbox.
     * This is why a sandbox never dies while somebody is actually working.
     */
    async use(id) {
      await sweep();
      const sandbox = requireSandbox(id);
      if (sandbox.state.phase === PHASES.SUSPENDED) await docker.resume(sandbox.name);
      const next = touch(sandbox.state, now());
      sandboxes.set(id, { ...sandbox, state: next });
      return { id, phase: next.phase, remainingMs: remainingMs(next, now()) };
    },

    /**
     * Hand over the snapshot and only then allow destruction.
     * Returns bytes the client saves; the caller decides where.
     */
    async snapshot(id) {
      await sweep();
      const sandbox = requireSandbox(id);
      if (sandbox.state.phase === PHASES.DESTROYED) {
        throw new OrchestratorError("sandbox is already destroyed");
      }
      const manifest = {
        format: "movilclaw/snapshot/1",
        id,
        repo: sandbox.repo,
        branch: sandbox.branch,
        takenAt: now(),
        // Where the work would be re-injected: a new sandbox mounts this volume name.
        volume: `${sandbox.name}-work`,
      };
      const body = Buffer.from(JSON.stringify(manifest, null, 2), "utf8");
      const next = markSnapshotDelivered(sandbox.state, now());
      sandboxes.set(id, { ...sandbox, state: next });
      return { manifest, bytes: body, digest: sha256(body) };
    },

    /** Destroy now, by hand. Refuses while the work has not been handed over. */
    async destroy(id, { force = false } = {}) {
      await sweep();
      const sandbox = requireSandbox(id);
      if (sandbox.state.phase === PHASES.DESTROYED) return { id, phase: PHASES.DESTROYED };
      if (!force && !canDestroy(sandbox.state)) {
        throw new OrchestratorError(
          "refusing to destroy: the snapshot has not been delivered. Download it first (or pass force)",
        );
      }
      await docker.stop(sandbox.name);
      const next = { ...sandbox.state, phase: PHASES.DESTROYED, phaseChangedAt: now() };
      sandboxes.set(id, { ...sandbox, state: next });
      return { id, phase: PHASES.DESTROYED };
    },

    /** Used by the isolation tests to run a command inside a sandbox. */
    async exec(id, argv) {
      const sandbox = requireSandbox(id);
      return docker.exec(sandbox.name, argv);
    },

    /** What the sandbox may reach right now, in words, for the UI and the API. */
    async network(id) {
      const sandbox = requireSandbox(id);
      return describePhase(sandbox.netPhase ?? NET_PHASES.CLOSED);
    },

    /**
     * Clone a public repository into the sandbox.
     *
     * Sequence, and the order matters: open the network for one destination, clone, close it
     * again **even if the clone fails**. A sandbox that stayed open after an error would be
     * the worst kind of bug: silent and permanent.
     */
    async cloneRepo(id, url) {
      await sweep();
      const sandbox = requireSandbox(id);
      const parsed = parseRepoUrl(url);
      const network = createNetwork(docker);

      sandbox.netPhase = NET_PHASES.REPO;
      await network.setPhase(sandbox.name, NET_PHASES.REPO);
      try {
        assertHostAllowed(NET_PHASES.REPO, parsed.host);
        // --depth 1: a sandbox needs a working tree, not the whole history.
        const result = await docker.runCommand(
          sandbox.name,
          ["git", "clone", "--depth", "1", parsed.cloneUrl, "/work/app"],
          { timeoutMs: 300_000 },
        );
        const target = parsed.branch ? ["-C", "/work/app", "checkout", parsed.branch] : null;
        const checkout = target ? await docker.runCommand(sandbox.name, ["git", ...target]) : { code: 0 };
        const head = await docker.runCommand(sandbox.name, ["git", "-C", "/work/app", "log", "-1", "--format=%H %s"]);
        sandbox.repo = `${parsed.owner}/${parsed.repo}`;
        sandbox.repoCommit = head.out.trim();
        if (result.code !== 0) {
          throw new OrchestratorError(`git clone fallo: ${(result.err || result.out).slice(0, 300)}`);
        }
        if (checkout.code !== 0) {
          throw new OrchestratorError(`la rama ${parsed.branch} no existe en ese repositorio`);
        }
        return {
          repo: sandbox.repo,
          url: parsed.canonical,
          branch: parsed.branch ?? null,
          commit: sandbox.repoCommit,
          files: (await docker.runCommand(sandbox.name, ["ls", "/work/app"])).out.split("\n").filter(Boolean).slice(0, 40),
        };
      } finally {
        // Whatever happened above, the door closes here. This is the guarantee.
        sandbox.netPhase = NET_PHASES.CLOSED;
        await network.setPhase(sandbox.name, NET_PHASES.CLOSED);
      }
    },

    /**
     * The tools the agent works with. Every one is a fixed argv: the caller picks which
     * tool and its arguments, and never composes a shell command.
     */
    async tool(id, name, args = {}) {
      await sweep();
      const sandbox = requireSandbox(id);
      const repo = "/work/app";

      switch (name) {
        case "read": {
          const path = safePath(args.path);
          const result = await docker.runCommand(sandbox.name, ["cat", `${repo}/${path}`], { timeoutMs: 30_000 });
          if (result.code !== 0) throw new OrchestratorError(`no se puede leer ${path}`);
          // Bounded: a 200 MB file must not travel through the API.
          return { path, content: result.out.slice(0, 200_000), truncated: result.out.length > 200_000 };
        }
        case "write": {
          const path = safePath(args.path);
          const content = typeof args.content === "string" ? args.content : "";
          if (content.length > 1_000_000) throw new OrchestratorError("el contenido supera 1 MB");
          // Written through a file, not a shell, so the content is never parsed as code.
          const encoded = Buffer.from(content, "utf8").toString("base64");
          const result = await docker.runCommand(sandbox.name, [
            "sh", "-c",
            `mkdir -p "$(dirname "${repo}/${path}")" && printf '%s' '${encoded}' | base64 -d > "${repo}/${path}"`,
          ]);
          if (result.code !== 0) throw new OrchestratorError(`no se puede escribir ${path}: ${result.err.slice(0, 200)}`);
          return { path, bytes: Buffer.byteLength(content, "utf8") };
        }
        case "list": {
          const path = safePath(args.path ?? ".", true);
          const result = await docker.runCommand(sandbox.name, ["ls", "-la", `${repo}/${path}`]);
          return { path, listing: result.out };
        }
        case "search": {
          const query = String(args.query ?? "").slice(0, 200);
          if (!query) throw new OrchestratorError("search necesita un texto");
          // ripgrep is in the image for exactly this. Fixed argv, no shell.
          const result = await docker.runCommand(sandbox.name, [
            "rg", "--line-number", "--no-heading", "--max-count", "200", "--", query, repo,
          ]);
          return { query, matches: result.out.slice(0, 100_000), count: result.out.split("\n").filter(Boolean).length };
        }
        case "edit": {
          // A precise replacement: find the old text, put the new one in its place.
          const path = safePath(args.path);
          const from = typeof args.from === "string" ? args.from : "";
          const to = typeof args.to === "string" ? args.to : "";
          if (!from) throw new OrchestratorError("edit necesita el texto a reemplazar");
          const read = await docker.runCommand(sandbox.name, ["cat", `${repo}/${path}`]);
          if (read.code !== 0) throw new OrchestratorError(`no se puede leer ${path}`);
          const occurrences = read.out.split(from).length - 1;
          if (occurrences === 0) throw new OrchestratorError("el texto a reemplazar no aparece en el archivo");
          if (occurrences > 1) throw new OrchestratorError(`el texto aparece ${occurrences} veces; usa mas contexto`);
          const updated = read.out.replace(from, to);
          const encoded = Buffer.from(updated, "utf8").toString("base64");
          await docker.runCommand(sandbox.name, [
            "sh", "-c", `printf '%s' '${encoded}' | base64 -d > "${repo}/${path}"`,
          ]);
          return { path, replaced: 1 };
        }
        case "git": {
          // A closed list of read-only and staging operations. Commit and push come later.
          const allowed = {
            status: ["status", "--short"],
            diff: ["diff"],
            staged: ["diff", "--cached"],
            log: ["log", "--oneline", "-20"],
            branch: ["branch", "--show-current"],
            stage: ["add", "-A"],
          };
          const argv = allowed[args.op];
          if (!argv) throw new OrchestratorError(`git ${args.op} no esta permitido`);
          const result = await docker.runCommand(sandbox.name, ["git", "-C", repo, ...argv]);
          return { op: args.op, code: result.code, out: (result.out || result.err).slice(0, 100_000) };
        }
        case "commit": {
          const message = String(args.message ?? "").slice(0, 500);
          if (!message) throw new OrchestratorError("commit necesita un mensaje");
          await docker.runCommand(sandbox.name, ["git", "-C", repo, "add", "-A"]);
          const result = await docker.runCommand(sandbox.name, ["git", "-C", repo, "commit", "-m", message]);
          if (result.code !== 0) throw new OrchestratorError(`no se pudo commitear: ${(result.err || result.out).slice(0, 200)}`);
          const head = await docker.runCommand(sandbox.name, ["git", "-C", repo, "log", "-1", "--format=%H %s"]);
          return { commit: head.out.trim() };
        }
        case "run": {
          // Run a program inside the sandbox. The argv is a list; there is no shell.
          const argv = Array.isArray(args.argv) ? args.argv.map(String).slice(0, 40) : [];
          if (!argv.length) throw new OrchestratorError("run necesita argv");
          const result = await docker.runCommand(sandbox.name, ["sh", "-c", `cd ${repo} && exec "$@"`, "run", ...argv], {
            timeoutMs: Math.min(Number(args.timeoutMs) || 120_000, 600_000),
          });
          return { code: result.code, out: result.out.slice(0, 200_000), err: result.err.slice(0, 20_000) };
        }
        default:
          throw new OrchestratorError(`tool desconocida: ${name}`);
      }
    },
  };
}

/**
 * Accept only a public repository URL over HTTPS from a known code host.
 *
 * Refused on purpose, each for a reason: plain http (no integrity), ssh (would need keys),
 * any other host (the sandbox is not a general-purpose fetcher), and anything pointing at
 * a local or private address (a sandbox must not be able to reach into the host's network).
 */
export function parseRepoUrl(input) {
  let url;
  try {
    url = new URL(String(input ?? "").trim());
  } catch {
    throw new OrchestratorError("la direccion del repositorio no es una URL valida");
  }
  if (url.protocol !== "https:") {
    throw new OrchestratorError("solo se aceptan repositorios por https");
  }
  if (url.username || url.password) {
    throw new OrchestratorError("la URL no debe llevar credenciales");
  }
  const host = url.hostname.toLowerCase();
  if (host !== "github.com") {
    throw new OrchestratorError("por ahora solo se aceptan repositorios de github.com");
  }
  const parts = url.pathname.replace(/^\/+|\.git$/g, "").split("/").filter(Boolean);
  if (parts.length < 2) {
    throw new OrchestratorError("la URL debe ser del tipo https://github.com/usuario/repositorio");
  }
  const [owner, repo] = parts;
  const branch = parts[2] === "tree" && parts[3] ? parts.slice(3).join("/") : null;
  return {
    host,
    owner,
    repo,
    branch,
    cloneUrl: `https://github.com/${owner}/${repo}.git`,
    canonical: `https://github.com/${owner}/${repo}`,
  };
}

/** A repository-relative path, with no way out of /work/app. */
function safePath(value, allowRoot = false) {
  const path = String(value ?? "").trim();
  if (!path || path === ".") {
    if (allowRoot) return ".";
    throw new OrchestratorError("falta la ruta");
  }
  if (path.startsWith("/") || path.includes("..") || path.includes("\0")) {
    throw new OrchestratorError("la ruta debe ser relativa y quedarse dentro del repositorio");
  }
  return path.replace(/^\.\//, "");
}

/** A token that only ever unlocks one repo, and expires with the sandbox. */
function issueToken(id, repo, expiresAt) {
  const raw = randomBytes(32).toString("base64url");
  return {
    // Only the digest is kept; the raw value is returned once and never stored in logs.
    digest: createHash("sha256").update(raw).digest("hex"),
    repo,
    expiresAt,
  };
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}
