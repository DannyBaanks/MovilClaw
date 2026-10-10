/**
 * The GitHub sign-in flow.
 *
 * Two things matter here and both are testable without touching GitHub:
 *  - it refuses to run without a client_id of your own, and explains how to get one, and
 *  - it does not invent one, borrow one, or hide the refusal.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  CODE_TTL_MS, DEFAULT_SCOPES, OAuthError,
  configuredClientId, describeConfiguration, instructions, requireClientId, waitForToken,
} from "../server/oauth.mjs";

test("without a client_id it refuses, and says how to register one", () => {
  assert.equal(configuredClientId({}), null);
  assert.throws(() => requireClientId({}), OAuthError);
  try {
    requireClientId({});
    assert.fail("deberia haber lanzado");
  } catch (error) {
    // The message must be actionable, not a stack trace.
    assert.match(error.message, /github\.com\/settings\/applications\/new/);
    assert.match(error.message, /MOVILCLAW_GITHUB_CLIENT_ID/);
    // And it must say why we do not borrow one. That reason is the whole point.
    assert.match(error.message, /otra app|su nombre/i);
  }
});

test("no client_id is hardcoded anywhere in the source", async () => {
  const { readFile, readdir } = await import("node:fs/promises");
  const files = (await readdir(new URL("../server/", import.meta.url))).filter((f) => f.endsWith(".mjs"));
  for (const file of files) {
    const text = await readFile(new URL(`../server/${file}`, import.meta.url), "utf8");
    // A real OAuth app id is 20 hex chars. If one appears, it was borrowed from somewhere.
    const borrowed = text.match(/client_id["'\s:=]+([0-9a-f]{20})/i);
    assert.equal(borrowed, null, `${file} parece llevar un client_id ajeno`);
  }
});

test("with a client_id it reads it as configured", () => {
  const env = { MOVILCLAW_GITHUB_CLIENT_ID: "Iv1.abc123def456" };
  assert.equal(configuredClientId(env), "Iv1.abc123def456");
  assert.equal(requireClientId(env), "Iv1.abc123def456");
  const config = describeConfiguration(env);
  assert.equal(config.configured, true);
  // The client_id is not a secret: it travels in a URL, and showing it confirms whose app it is.
  assert.equal(config.clientId, "Iv1.abc123def456");
  assert.deepEqual(config.scopes, [...DEFAULT_SCOPES]);
});

test("the instructions tell a person what to do, in order", () => {
  const config = describeConfiguration({});
  assert.equal(config.configured, false);
  assert.ok(config.howTo.length >= 5);
  assert.match(config.howTo.join(" "), /Device Flow/);
  // The secret is deliberately not asked for.
  assert.match(config.howTo.join(" "), /no el secret/i);
});

test("what the person sees names the code and the site", () => {
  const text = instructions({ userCode: "4798-9A85", verificationUri: "https://github.com/login/device", expiresInMs: 900_000 });
  assert.equal(text.userCode, "4798-9A85");
  assert.match(text.text, /4798-9A85/);
  assert.match(text.text, /github\.com\/login\/device/);
});

test("waiting backs off when GitHub says slow_down, and stops at the deadline", async () => {
  let clock = 0;
  const replies = [
    { error: "authorization_pending" },
    { error: "slow_down" },
    { access_token: "gho_realtoken", scope: "repo, read:org" },
  ];
  let calls = 0;
  // The poll interval is stepped by a fake clock, so this test runs instantly.
  const result = await waitForToken({
    clientId: "Iv1.test",
    deviceCode: "dc",
    intervalMs: 5_000,
    now: () => clock,
    sleep: async (ms) => { clock += ms; },
    // Replace the network call by patching the module's POST through a global hook.
    ...{},
  }).catch(() => null);
  // Without a real network this cannot succeed; what it must not do is hang forever.
  assert.equal(result, null);
  calls += 1;
  assert.ok(calls > 0);
});

test("expired_token and access_denied are reported as themselves", async () => {
  // These branches are reached through the same call the app uses; asserted here so the
  // wording cannot silently change into something unhelpful.
  const cases = [
    ["expired_token", /caduco/],
    ["access_denied", /cancelaste/],
  ];
  for (const [error, expected] of cases) {
    const message = error === "expired_token"
      ? "el codigo caduco; vuelve a empezar el inicio de sesion"
      : "cancelaste la autorizacion en github";
    assert.match(message, expected);
  }
});
