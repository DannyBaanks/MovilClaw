/**
 * The local .env loader.
 *
 * Why this deserves tests: a configuration loader is a place where a mistake is quiet and
 * far-reaching. If it overrode the real environment, a systemd unit's setting would be
 * silently ignored. If it read anything it found, a file in a checkout could set variables
 * nobody intended. Both are checked here.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SUPPORTED_KEYS, describeClientId, loadEnvFile, parseEnvFile } from "../server/env.mjs";

async function withEnvFile(text, fn) {
  const dir = await mkdtemp(join(tmpdir(), "mc-env-"));
  try {
    await writeFile(join(dir, ".env"), text, "utf8");
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("parses the usual shapes and ignores the rest", () => {
  const parsed = parseEnvFile([
    "# un comentario",
    "",
    "MOVILCLAW_GITHUB_CLIENT_ID=Ov23liGP4T0acjcvCpFV",
    "export PORT=9000",
    'CON_ESPACIOS = "valor con espacios"',
    "CON_COMILLAS_SIMPLES='otro valor'",
    "minusculas=se ignora",
    "SIN_IGUAL",
  ].join("\n"));
  assert.equal(parsed.MOVILCLAW_GITHUB_CLIENT_ID, "Ov23liGP4T0acjcvCpFV");
  assert.equal(parsed.PORT, "9000"); // `export` tolerated
  assert.equal(parsed.CON_ESPACIOS, "valor con espacios");
  assert.equal(parsed.CON_COMILLAS_SIMPLES, "otro valor");
  assert.equal(parsed.minusculas, undefined, "una clave en minusculas se ignora");
  assert.equal(parsed.SIN_IGUAL, undefined);
});

test("reads the file and reports what it set", async () => {
  await withEnvFile("MOVILCLAW_GITHUB_CLIENT_ID=Ov123\nPORT=9001\n", async (dir) => {
    const env = {};
    const result = loadEnvFile({ directory: dir, env });
    assert.equal(result.found, true);
    assert.deepEqual(result.loaded.sort(), ["MOVILCLAW_GITHUB_CLIENT_ID", "PORT"]);
    assert.equal(env.MOVILCLAW_GITHUB_CLIENT_ID, "Ov123");
  });
});

test("the real environment always wins over the file", async () => {
  await withEnvFile("PORT=9001\nMOVILCLAW_GITHUB_CLIENT_ID=del-archivo\n", async (dir) => {
    const env = { PORT: "ya-estaba" };
    loadEnvFile({ directory: dir, env });
    assert.equal(env.PORT, "ya-estaba", "no debe pisar una variable ya definida");
    assert.equal(env.MOVILCLAW_GITHUB_CLIENT_ID, "del-archivo", "solo rellena lo que falta");
  });
});

test("only the known keys are read: the file is not a back door", async () => {
  await withEnvFile("PATH=/algo/malicioso\nLD_PRELOAD=/tmp/evil.so\nMOVILCLAW_GITHUB_CLIENT_ID=Ov123\n", async (dir) => {
    const env = {};
    const result = loadEnvFile({ directory: dir, env });
    assert.deepEqual(result.loaded, ["MOVILCLAW_GITHUB_CLIENT_ID"]);
    assert.equal(env.PATH, undefined, "PATH no se toca");
    assert.equal(env.LD_PRELOAD, undefined, "LD_PRELOAD no se toca");
  });
});

test("a missing file is not an error", () => {
  const env = {};
  const result = loadEnvFile({ directory: "/tmp/no-existe-esta-carpeta-mc", env });
  assert.equal(result.found, false);
  assert.deepEqual(result.loaded, []);
  assert.deepEqual(env, {});
});

test("the keys it accepts are a closed list", () => {
  assert.ok(SUPPORTED_KEYS.includes("MOVILCLAW_GITHUB_CLIENT_ID"));
  assert.ok(SUPPORTED_KEYS.includes("MOVILCLAW_STATE"));
  // Nothing that could hijack a process: no PATH, no NODE_OPTIONS.
  assert.ok(!SUPPORTED_KEYS.includes("PATH"));
  assert.ok(!SUPPORTED_KEYS.includes("NODE_OPTIONS"));
});

test("the client_id is described, not dumped", () => {
  const described = describeClientId("Ov23liGP4T0acjcvCpFV");
  assert.equal(described.present, true);
  assert.equal(described.length, 20);
  // Enough to recognise the app, not enough to be a full echo of the value.
  assert.match(described.preview, /^Ov23liGP…$/);
  assert.equal(describeClientId(""), null);
  assert.equal(describeClientId(undefined), null);
});

test("a loader never logs values, only key names", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../server/env.mjs", import.meta.url), "utf8");
  // No console call anywhere in this module: it must not print what it reads.
  assert.doesNotMatch(source, /console\.(log|info|warn|error)/);
});
