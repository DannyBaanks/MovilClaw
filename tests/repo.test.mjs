/**
 * The repository workflow, end to end.
 *
 * This suite talks to real Docker and real github.com, so it is skipped when either is
 * missing. That is deliberate: a mocked clone would prove nothing about the promises here,
 * and the interesting failures (a network that stayed open, a path that escaped) only
 * appear against the real thing.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOrchestrator, parseRepoUrl, OrchestratorError } from "../server/orchestrator.mjs";

function has(command, args = ["info"]) {
  try {
    return spawnSync(command, args, { encoding: "utf8", timeout: 15_000 }).status === 0;
  } catch {
    return false;
  }
}

const hasDocker = has("docker");
const hasImage = hasDocker && has("docker", ["image", "inspect", "movilclaw/sandbox:latest"]);
const skip = !hasImage ? "needs Docker and `npm run sandbox:build`" : false;

async function withSandbox(fn) {
  const root = await mkdtemp(join(tmpdir(), "mc-repo-"));
  const orch = createOrchestrator({
    now: () => Date.now(),
    idFactory: () => `mc-${Math.random().toString(16).slice(2, 14)}`,
  });
  const { id } = await orch.create({ ttlMinutes: 30 });
  try {
    return await fn(orch, id);
  } finally {
    await orch.destroy(id, { force: true }).catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
}

test("a repository URL is validated before anything runs", () => {
  const ok = parseRepoUrl("https://github.com/DannyBaanks/MovilClaw");
  assert.equal(ok.owner, "DannyBaanks");
  assert.equal(ok.repo, "MovilClaw");
  assert.equal(ok.cloneUrl, "https://github.com/DannyBaanks/MovilClaw.git");

  // Each refusal has a reason, and each is a way an attacker would try.
  for (const [url, why] of [
    ["http://github.com/a/b", /https/],
    ["git@github.com:a/b.git", /no es una URL valida/],
    ["https://evil.example.com/a/b", /solo.*github/],
    ["https://github.com/", /tipo/],
    ["https://user:pass@github.com/a/b", /credenciales/],
  ]) {
    assert.throws(() => parseRepoUrl(url), why, `deberia rechazar ${url}`);
  }
});

test("a repo path cannot climb out of the repository", { skip }, async () => {
  await withSandbox(async (orch, id) => {
    for (const path of ["../../etc/passwd", "/etc/passwd", "a/../../../b"]) {
      await assert.rejects(() => orch.tool(id, "read", { path }), /relativa|dentro del repositorio/);
    }
  });
});

test("clones a real public repository, then closes the network", { skip }, async () => {
  await withSandbox(async (orch, id) => {
    // 1. Before: no network at all.
    assert.equal((await orch.network(id)).phase, "cerrada");

    // 2. Clone a small public repo.
    const cloned = await orch.cloneRepo(id, "https://github.com/octocat/Hello-World");
    assert.equal(cloned.repo, "octocat/Hello-World");
    assert.ok(cloned.commit.length > 0, "a commit hash must be reported");

    // 3. After: the door is closed again, without anyone asking.
    assert.equal((await orch.network(id)).phase, "cerrada");

    // 4. And the network really is gone, measured from inside.
    const escape = await orch.tool(id, "run", {
      argv: ["sh", "-c", "timeout 5 curl -s -o /dev/null https://github.com && echo SALIO || echo bloqueado"],
    });
    assert.match(escape.out, /bloqueado/, "the sandbox must not reach the network after cloning");
  });
});

test("a failed clone still closes the network", { skip }, async () => {
  await withSandbox(async (orch, id) => {
    await assert.rejects(
      () => orch.cloneRepo(id, "https://github.com/octocat/no-such-repo-xyzzy-12345"),
      OrchestratorError,
    );
    // The important part: the failure did not leave the door open.
    assert.equal((await orch.network(id)).phase, "cerrada");
  });
});

test("the tools let an agent read, edit, search, commit and run tests", { skip }, async () => {
  await withSandbox(async (orch, id) => {
    await orch.cloneRepo(id, "https://github.com/octocat/Hello-World");

    // read
    const before = await orch.tool(id, "read", { path: "README" });
    assert.ok(before.content.length > 0);

    // search
    const found = await orch.tool(id, "search", { query: "Hello" });
    assert.ok(found.count > 0, "ripgrep must find the word that is in the file");

    // edit: a precise replacement
    const edited = await orch.tool(id, "edit", {
      path: "README",
      from: "Hello World!",
      to: "Hello World, edited inside the sandbox!",
    });
    assert.equal(edited.replaced, 1);
    const after = await orch.tool(id, "read", { path: "README" });
    assert.match(after.content, /edited inside the sandbox/);

    // git: the change is visible
    const status = await orch.tool(id, "git", { op: "status" });
    assert.match(status.out, /README/);

    // commit
    const committed = await orch.tool(id, "commit", { message: "docs: editado por el agente" });
    assert.match(committed.commit, /editado por el agente/);

    // run: a real program inside the sandbox
    const ran = await orch.tool(id, "run", { argv: ["git", "log", "--oneline", "-1"] });
    assert.equal(ran.code, 0);
    assert.match(ran.out, /editado por el agente/);
  });
});

test("edit refuses an ambiguous replacement instead of guessing", { skip }, async () => {
  await withSandbox(async (orch, id) => {
    await orch.tool(id, "run", { argv: ["git", "init", "-b", "main"] });
    await orch.tool(id, "write", { path: "notas.txt", content: "hola hola hola" });
    await assert.rejects(
      () => orch.tool(id, "edit", { path: "notas.txt", from: "hola", to: "adios" }),
      /aparece 3 veces/,
    );
    await assert.rejects(
      () => orch.tool(id, "edit", { path: "notas.txt", from: "no estoy", to: "x" }),
      /no aparece/,
    );
  });
});

test("write and read agree, and a git operation outside the list is refused", { skip }, async () => {
  await withSandbox(async (orch, id) => {
    await orch.tool(id, "run", { argv: ["git", "init", "-b", "main"] });
    await orch.tool(id, "write", { path: "src/nota.md", content: "# Nota\n\ncreado por el agente\n" });
    const read = await orch.tool(id, "read", { path: "src/nota.md" });
    assert.match(read.content, /creado por el agente/);

    // Only the declared git operations are reachable.
    await assert.rejects(() => orch.tool(id, "git", { op: "push" }), /no esta permitido/);
    await assert.rejects(() => orch.tool(id, "git", { op: "reset" }), /no esta permitido/);
    await assert.rejects(() => orch.tool(id, "no-existe", {}), /tool desconocida/);
  });
});

test("a symbolic link cannot smuggle a file in from outside the repository", { skip }, async () => {
  await withSandbox(async (orch, id) => {
    await orch.cloneRepo(id, "https://github.com/octocat/Hello-World");

    // Plant the trap: a secret outside /work/app, and a link to it inside.
    // This is not hypothetical: it was found by auditing, and it used to work.
    const planted = await orch.tool(id, "run", {
      argv: ["sh", "-c",
        "echo 'SECRETO FUERA DEL REPO' > /work/secreto.txt && " +
        "ln -sf /work/secreto.txt /work/app/enlace.txt && " +
        "ls -l /work/app/enlace.txt"],
    });
    assert.equal(planted.code, 0, "the trap must be planted for the test to mean anything");

    // Reading through the link must be refused, not merely discouraged.
    await assert.rejects(
      () => orch.tool(id, "read", { path: "enlace.txt" }),
      /fuera del repositorio|enlace/,
      "leer por un enlace que sale del repo debe rechazarse",
    );

    // And nothing was written through it either.
    const intact = await orch.tool(id, "run", { argv: ["sh", "-c", "cat /work/secreto.txt"] });
    assert.match(intact.out, /SECRETO FUERA DEL REPO/, "el archivo de fuera no debe haber cambiado");

    // A legitimate file in the repository still works: the check is not "refuse everything".
    await orch.tool(id, "write", { path: "normal.txt", content: "esto si" });
    const readBack = await orch.tool(id, "read", { path: "normal.txt" });
    assert.match(readBack.content, /esto si/);
  });
});

test("a link that points inside the repository is still allowed", { skip }, async () => {
  await withSandbox(async (orch, id) => {
    await orch.cloneRepo(id, "https://github.com/octocat/Hello-World");
    // An internal link is harmless and must not be caught by the same rule.
    await orch.tool(id, "run", {
      argv: ["sh", "-c", "ln -sf /work/app/README /work/app/interno.txt"],
    });
    const read = await orch.tool(id, "read", { path: "interno.txt" });
    assert.match(read.content, /Hello/i);
  });
});
