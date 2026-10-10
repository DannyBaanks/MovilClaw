/**
 * The sealing promises, each one as a test that can fail.
 *
 * The rule this file enforces: the server must not be able to read what it stores, and a
 * passphrase or a clock is the only thing that changes that.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspect, open, seal } from "../web/seal.mjs";
import { createSealedStore, SealedError } from "../server/sealed.mjs";
import { GrantError, issueGrant, verifyGrant } from "../server/grant.mjs";

const SECRET = "secreto-de-prueba-suficientemente-largo";
const PHRASE = "mi frase secreta de verdad";
const PLAIN = "contenido confidencial del repositorio";

async function withStore(fn) {
  const root = await mkdtemp(join(tmpdir(), "mc-seal-"));
  try {
    return await fn(createSealedStore(root), root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("sealing hides the content: the plaintext is not in the blob", async () => {
  const blob = await seal(new TextEncoder().encode(PLAIN), PHRASE);
  assert.ok(!blob.includes(PLAIN), "the plaintext must never appear in the sealed output");
  assert.ok(!blob.includes(PHRASE), "the passphrase must never appear either");
  const info = inspect(blob);
  assert.equal(info.cipher, "AES-256-GCM");
  assert.equal(info.iterations, 600_000);
});

test("the right passphrase opens it", async () => {
  const blob = await seal(new TextEncoder().encode(PLAIN), PHRASE);
  const plain = await open(blob, PHRASE);
  assert.equal(new TextDecoder().decode(plain), PLAIN);
});

test("a wrong passphrase fails, and says nothing useful", async () => {
  const blob = await seal(new TextEncoder().encode(PLAIN), PHRASE);
  await assert.rejects(() => open(blob, "otra frase distinta"), /no se pudo abrir/);
});

test("a tampered blob fails: AES-GCM authenticates it", async () => {
  const blob = await seal(new TextEncoder().encode(PLAIN), PHRASE);
  const envelope = JSON.parse(blob);
  // flip one byte of the ciphertext
  const data = Buffer.from(envelope.data, "base64");
  data[0] ^= 0x01;
  envelope.data = data.toString("base64");
  await assert.rejects(() => open(JSON.stringify(envelope), PHRASE), /alterado|no se pudo abrir/);
});

test("the salt and IV are different every time, so two seals are not comparable", async () => {
  const a = JSON.parse(await seal(new TextEncoder().encode(PLAIN), PHRASE));
  const b = JSON.parse(await seal(new TextEncoder().encode(PLAIN), PHRASE));
  assert.notEqual(a.kdf.salt, b.kdf.salt);
  assert.notEqual(a.cipher.iv, b.cipher.iv);
  assert.notEqual(a.data, b.data);
});

test("a very short passphrase is refused instead of silently weak", async () => {
  await assert.rejects(() => seal(new TextEncoder().encode(PLAIN), "corta"), /al menos 8 caracteres/);
});

test("the host stores ciphertext only: it cannot read what it keeps", async () => {
  await withStore(async (store, root) => {
    const blob = await seal(new TextEncoder().encode(PLAIN), PHRASE);
    const manifest = await store.put("mc-abc123", blob);

    assert.equal(manifest.hostCanRead, false);
    // The bytes on disk are the sealed envelope, and the plaintext is not in them.
    const onDisk = await readFile(join(root, "sealed", "mc-abc123.sealed.json"), "utf8");
    assert.ok(!onDisk.includes(PLAIN), "the plaintext must not be written to disk");
    // And the file is private to the owner.
    const { mode } = await import("node:fs").then((fs) => fs.promises.stat(join(root, "sealed", "mc-abc123.sealed.json")));
    assert.equal(mode & 0o077, 0, "a sealed file must not be readable by other accounts");
  });
});

test("the store refuses anything that is not a sealed envelope", async () => {
  await withStore(async (store) => {
    await assert.rejects(() => store.put("mc-abc123", "{\"soy\":\"otra cosa\"}"), SealedError);
    await assert.rejects(() => store.put("mc-abc123", "no soy json"), SealedError);
    await assert.rejects(() => store.put("id-invalido", "{}"), SealedError);
  });
});

test("destroying the seal removes the data irreversibly", async () => {
  await withStore(async (store) => {
    const blob = await seal(new TextEncoder().encode(PLAIN), PHRASE);
    await store.put("mc-abc123", blob);
    assert.equal((await store.list()).length, 1);
    await store.destroy("mc-abc123");
    assert.equal((await store.list()).length, 0);
    await assert.rejects(() => store.get("mc-abc123"), /no hay ningun sello/);
  });
});

test("the grant is valid until its moment, and dead after", () => {
  const { token, expiresAt } = issueGrant("mc-abc123", 60_000, { secret: SECRET, now: 1_000 });
  assert.equal(expiresAt, 61_000);

  assert.equal(verifyGrant(token, "mc-abc123", { secret: SECRET, now: 30_000 }).ok, true);
  const expired = verifyGrant(token, "mc-abc123", { secret: SECRET, now: 61_001 });
  assert.equal(expired.ok, false);
  assert.match(expired.reason, /caducado/);
});

test("a grant cannot be moved to another sandbox or forged", () => {
  const { token } = issueGrant("mc-abc123", 60_000, { secret: SECRET, now: 1_000 });
  assert.match(verifyGrant(token, "mc-otro", { secret: SECRET, now: 2_000 }).reason, /otro sandbox/);
  assert.match(verifyGrant(token + "x", "mc-abc123", { secret: SECRET, now: 2_000 }).reason, /firma/);
  assert.match(verifyGrant(token, "mc-abc123", { secret: "otro-secreto-distinto", now: 2_000 }).reason, /firma/);
});

test("a grant cannot be asked to last forever", () => {
  const { expiresAt } = issueGrant("mc-abc123", Number.MAX_SAFE_INTEGER, { secret: SECRET, now: 0 });
  assert.equal(expiresAt, 24 * 60 * 60 * 1000, "the cap must be 24 hours");
  assert.throws(() => issueGrant("mc-abc123", -1, { secret: SECRET, now: 0 }), GrantError);
});

test("a grant says who may unseal, never the passphrase itself", () => {
  const { token } = issueGrant("mc-abc123", 60_000, { secret: SECRET, now: 1_000 });
  const payload = JSON.parse(Buffer.from(token.split(".")[0], "base64url").toString("utf8"));
  // The token carries the scope and the deadline, and nothing that opens data.
  assert.deepEqual(Object.keys(payload).sort(), ["expiresAt", "format", "issuedAt", "sandboxId"]);
  assert.ok(!token.includes(PHRASE));
});
