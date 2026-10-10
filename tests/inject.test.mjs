/**
 * Re-injection: the archive that came out of one sandbox must go back into another.
 *
 * The guard tests run against a fake daemon — they prove the refusals. The round trip
 * runs against real Docker, because "it was injected" only means something when the
 * bytes really landed in a container's /work/app.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { createOrchestrator } from "../server/orchestrator.mjs";

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

/** A daemon that records what it was asked to do and answers with a fixed listing. */
function fakeDocker(listing = "a.txt\nb.txt") {
  const commands = [];
  const inputs = [];
  return {
    commands,
    inputs,
    async start() {},
    async pause() {},
    async resume() {},
    async stop() {},
    async exec() { return { code: 0, out: "", err: "" }; },
    async runCommand(_name, argv, options = {}) {
      commands.push(argv);
      inputs.push(options.input ?? null);
      if (argv[0] === "ls") return { code: 0, out: listing, err: "" };
      return { code: 0, out: "", err: "" };
    },
  };
}

test("an empty archive is refused before anything touches the container", async () => {
  const docker = fakeDocker();
  const orch = createOrchestrator({ docker });
  const { id } = await orch.create({ ttlMinutes: 30 });
  await assert.rejects(() => orch.injectWork(id, Buffer.alloc(0)), /vacio/);
  await assert.rejects(() => orch.injectWork(id, null), /vacio/);
  assert.deepEqual(docker.commands, [], "the refusals must not run anything");
});

test("an archive over the size ceiling is refused", async () => {
  const orch = createOrchestrator({ docker: fakeDocker() });
  const { id } = await orch.create({ ttlMinutes: 30 });
  const huge = Buffer.alloc(64 * 1024 * 1024 + 1);
  await assert.rejects(() => orch.injectWork(id, huge), /limite de 64 MiB/);
});

test("a destroyed sandbox cannot receive work", async () => {
  const orch = createOrchestrator({ docker: fakeDocker() });
  const { id } = await orch.create({ ttlMinutes: 30 });
  await orch.destroy(id, { force: true });
  await assert.rejects(
    () => orch.injectWork(id, Buffer.from("x")),
    /destroyed/,
  );
});

test("the archive travels in through stdin, never as a mount nor on the command line", async () => {
  const docker = fakeDocker("README.md\nsrc\n");
  const orch = createOrchestrator({ docker });
  const { id } = await orch.create({ ttlMinutes: 30 });
  const archive = Buffer.from("archive-bytes");
  const result = await orch.injectWork(id, archive);
  const at = docker.commands.findIndex((argv) => argv[0] === "sh");
  assert.ok(at >= 0, "the injection must run a command");
  const script = docker.commands[at][2];
  assert.match(script, /tar -xzf - -C \/work\/app/);
  assert.match(script, /rm -rf \/work\/app/);
  assert.doesNotMatch(script, /--mount|\/home\//, "no path into the host may appear");
  // The bytes must NOT be in argv: that is what overflowed with `spawn E2BIG` on a real repo.
  assert.ok(!script.includes("archive-bytes"), "the archive must not ride the command line");
  assert.deepEqual(docker.inputs[at], archive, "the archive must arrive as stdin input");
  assert.deepEqual(result.files, ["README.md", "src"]);
  assert.equal(result.into, "/work/app");
});

test("dockerSpawn writes input to the child's stdin, never into argv", async () => {
  // The exact mechanism that fixes `spawn E2BIG`: a big payload goes in through the
  // pipe, so the command line stays small no matter how large the archive is.
  const { dockerSpawn } = await import("../server/docker.mjs");
  const { PassThrough } = await import("node:stream");
  let written = "";
  let seenArgs = null;
  const fakeSpawn = (_cmd, args) => {
    seenArgs = args;
    const child = {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill() {},
      on(event, handler) {
        if (event === "close") setImmediate(() => handler(0));
        return this;
      },
    };
    child.stdin.on("data", (d) => { written += d; });
    return child;
  };
  const payload = "x".repeat(4 * 1024 * 1024);
  const run = dockerSpawn(fakeSpawn);
  await run(["exec", "-i", "c", "sh", "-c", "tar -xzf - -C /work/app"], { input: payload });
  assert.equal(written.length, payload.length, "the whole payload must reach stdin");
  assert.ok(!seenArgs.some((a) => String(a).includes("xxxx")), "no payload bytes in argv");
});

test("round trip: work collected from one sandbox reads back in another", { skip }, async () => {
  const orch = createOrchestrator();
  const a = await orch.create({ ttlMinutes: 30 });
  const b = await orch.create({ ttlMinutes: 30 });
  try {
    await orch.tool(a.id, "write", { path: "hola.txt", content: "trabajo de la sesion 1\n" });
    await orch.tool(a.id, "write", { path: "src/main.js", content: "export const x = 41 + 1;\n" });
    const archive = await orch.collectWork(a.id);
    assert.ok(archive.length > 0, "the archive must not be empty");

    const injected = await orch.injectWork(b.id, archive);
    assert.ok(injected.files.includes("hola.txt"), `hola.txt missing from ${injected.files}`);

    // `read` returns the container's stdout trimmed, so compare against the trimmed text.
    const read = await orch.tool(b.id, "read", { path: "hola.txt" });
    assert.equal(read.content, "trabajo de la sesion 1");
    const code = await orch.tool(b.id, "read", { path: "src/main.js" });
    assert.match(code.content, /41 \+ 1/);
  } finally {
    await orch.destroy(a.id, { force: true }).catch(() => {});
    await orch.destroy(b.id, { force: true }).catch(() => {});
  }
});

test("a sealed archive opens in the browser code and injects the same bytes", { skip }, async () => {
  // The exact seal/open pair the PWA uses (web/seal.mjs), driven here with Node's WebCrypto.
  const { open, seal } = await import("../web/seal.mjs");
  const orch = createOrchestrator();
  const a = await orch.create({ ttlMinutes: 30 });
  const b = await orch.create({ ttlMinutes: 30 });
  try {
    await orch.tool(a.id, "write", { path: "secreto.txt", content: "solo yo lo leo\n" });
    const archive = await orch.collectWork(a.id);
    const envelope = await seal(archive, "frase-de-prueba-123");

    // The server side only ever sees the envelope: shape-valid ciphertext, opaque to it.
    // The browser side opens it with the phrase and gets the identical bytes back.
    const recovered = await open(envelope, "frase-de-prueba-123");
    assert.deepEqual(Buffer.from(recovered), archive, "open must return exactly what was sealed");

    await orch.injectWork(b.id, Buffer.from(recovered));
    const read = await orch.tool(b.id, "read", { path: "secreto.txt" });
    assert.equal(read.content, "solo yo lo leo");
  } finally {
    await orch.destroy(a.id, { force: true }).catch(() => {});
    await orch.destroy(b.id, { force: true }).catch(() => {});
  }
});
