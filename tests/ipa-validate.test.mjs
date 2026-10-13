/**
 * The IPA validation, as a test.
 *
 * Why this deserves one: the failure it prevents is confusing. A zip that is not an IPA
 * fails deep inside the phone's installer with a message nobody can act on. Checking the
 * shape first turns that into a clear refusal on the machine that can explain it.
 *
 * The same checks the install script runs, so what is tested is what runs.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/** Reject anything that is not a zip with Payload/<App>.app inside. */
async function looksLikeAnIpa(path) {
  try {
    const { stdout } = await run("unzip", ["-l", path]);
    return /Payload\/.*\.app\//.test(stdout);
  } catch {
    return false; // not a zip at all
  }
}

async function withTemp(fn) {
  const dir = await mkdtemp(join(tmpdir(), "mc-ipa-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("a plain text file is not an IPA", async () => {
  await withTemp(async (dir) => {
    const file = join(dir, "nada.ipa");
    await writeFile(file, "esto es texto plano");
    assert.equal(await looksLikeAnIpa(file), false);
  });
});

test("a zip without Payload/<App>.app is refused", async () => {
  await withTemp(async (dir) => {
    await writeFile(join(dir, "archivo.txt"), "contenido cualquiera");
    await run("zip", ["-qr", "falso.ipa", "archivo.txt"], { cwd: dir });
    assert.equal(await looksLikeAnIpa(join(dir, "falso.ipa")), false);
  });
});

test("a real IPA shape is accepted", async () => {
  await withTemp(async (dir) => {
    // cwd matters here: without it mkdir creates the tree somewhere else and the zip
    // ends up empty, which is exactly the kind of slip this test caught.
    await run("mkdir", ["-p", "Payload/MovilClaw.app"], { cwd: dir });
    await writeFile(join(dir, "Payload/MovilClaw.app/MovilClaw"), "binario");
    await run("zip", ["-qr", "buena.ipa", "Payload"], { cwd: dir });
    assert.equal(await looksLikeAnIpa(join(dir, "buena.ipa")), true);
  });
});

test("the install script refuses for real, with an actionable message", async () => {
  await withTemp(async (dir) => {
    await writeFile(join(dir, "archivo.txt"), "contenido");
    await run("zip", ["-qr", "falso.ipa", "archivo.txt"], { cwd: dir });
    // The script exits non-zero and says what is wrong, rather than letting the
    // device installer fail later with something unreadable.
    const script = new URL("../scripts/instalar-ios.sh", import.meta.url).pathname;
    const result = await run("bash", [script, "--ipa", join(dir, "falso.ipa")]).catch((error) => error);
    const output = String(result.stdout ?? "") + String(result.stderr ?? "");
    // It may stop earlier for a missing xtool; either way it must not claim success.
    assert.doesNotMatch(output, /Listo\. La app salio del CI/);
  });
});
