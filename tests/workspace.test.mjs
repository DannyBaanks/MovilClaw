/**
 * Tests for workspace packing, exclusions, unpacking, and git credential headers.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { packWorkspace, planTransfer, unpackInto } from "../server/workspace.mjs";
import { cloneWithToken } from "../server/credentials.mjs";

test("planTransfer detects secret-looking files and skips node_modules", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mc-ws-test-"));
  try {
    await writeFile(join(dir, ".env"), "SECRET=123\n");
    await writeFile(join(dir, "id_rsa"), "KEY\n");
    await mkdir(join(dir, "node_modules"));
    await writeFile(join(dir, "node_modules/pkg.js"), "module.exports = {};\n");
    await writeFile(join(dir, "index.js"), "console.log('hi');\n");

    const plan = await planTransfer(dir);
    assert.ok(plan.excludedExamples.some((e) => e.includes(".env")));
    assert.ok(plan.excludedExamples.some((e) => e.includes("id_rsa")));
    assert.ok(!plan.excludedExamples.some((e) => e.includes("index.js")));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("packWorkspace and unpackInto round-trip successfully", async () => {
  const src = await mkdtemp(join(tmpdir(), "mc-src-"));
  const dst = await mkdtemp(join(tmpdir(), "mc-dst-"));
  try {
    await writeFile(join(src, "hola.txt"), "saludos desde MovilClaw\n");
    await mkdir(join(src, "nested"));
    await writeFile(join(src, "nested/app.js"), "export const ok = true;\n");
    // Secrets must NOT be packed
    await writeFile(join(src, ".env"), "FORBIDDEN=1\n");

    const archive = await packWorkspace(src);
    assert.ok(archive.length > 0, "archive must contain bytes");

    await unpackInto(dst, archive);

    const hola = await readFile(join(dst, "hola.txt"), "utf8");
    assert.equal(hola, "saludos desde MovilClaw\n");
    const app = await readFile(join(dst, "nested/app.js"), "utf8");
    assert.equal(app, "export const ok = true;\n");

    // .env was excluded
    await assert.rejects(() => readFile(join(dst, ".env")), /ENOENT/);
  } finally {
    await rm(src, { recursive: true, force: true });
    await rm(dst, { recursive: true, force: true });
  }
});

test("cloneWithToken uses HTTP Basic auth with x-access-token", async () => {
  const calls = [];
  const fakeRun = async (_cmd, args) => {
    calls.push(args);
    return { stdout: "", stderr: "" };
  };

  await cloneWithToken(fakeRun, {
    url: "https://github.com/foo/bar.git",
    token: "ghp_secrettoken1234567890",
    into: "/tmp/into",
  });

  assert.equal(calls.length, 2, "must run clone then remote set-url");
  const cloneArgs = calls[0];
  const headerArg = cloneArgs.find((a) => String(a).startsWith("http.extraheader="));
  assert.ok(headerArg, "extraheader must be set");
  assert.ok(headerArg.includes("Authorization: Basic "), "must use Basic auth for git");
  const expectedBasic = Buffer.from("x-access-token:ghp_secrettoken1234567890", "utf8").toString("base64");
  assert.ok(headerArg.includes(expectedBasic), "must encode x-access-token:<token>");
});
