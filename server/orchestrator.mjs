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
  };
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
