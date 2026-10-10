import { strict as assert } from "node:assert";
import { test } from "node:test";
import { PHASES, advance, describe, newLifecycle, remainingMs, touch } from "../server/lifecycle.mjs";

const T0 = 1_000_000;
const MIN = 60_000;

test("a new sandbox is active with the countdown running", () => {
  const s = newLifecycle("mc-aabbcc", 30, T0);
  assert.equal(s.phase, PHASES.ACTIVE);
  assert.equal(remainingMs(s, T0), 30 * MIN);
});

test("refuses a ttl outside the closed list", () => {
  assert.throws(() => newLifecycle("mc-aabbcc", 45, T0), /ttl must be one of/);
});

test("going idle suspends the compute; it does not destroy the data", () => {
  const s = newLifecycle("mc-aabbcc", 30, T0);
  const later = advance(s, T0 + 31 * MIN);
  assert.equal(later.phase, PHASES.SUSPENDED);
  // the data is still there: nothing was destroyed
  assert.notEqual(later.phase, PHASES.DESTROYED);
});

test("a suspended sandbox with no snapshot delivered is never destroyed", () => {
  const s = newLifecycle("mc-aabbcc", 30, T0);
  let state = advance(s, T0 + 31 * MIN);
  assert.equal(state.phase, PHASES.SUSPENDED);
  // even much later, without the snapshot it stays
  state = advance(state, T0 + 500 * MIN);
  assert.equal(state.phase, PHASES.SUSPENDED);
});

test("only after the snapshot is delivered does it get destroyed", () => {
  const s = newLifecycle("mc-aabbcc", 30, T0);
  const suspended = advance(s, T0 + 31 * MIN);
  const delivered = { ...suspended, snapshotDelivered: true };
  const destroyed = advance(delivered, T0 + 32 * MIN);
  assert.equal(destroyed.phase, PHASES.DESTROYED);
});

test("real use resets the countdown, so working never loses the sandbox", () => {
  const s = newLifecycle("mc-aabbcc", 30, T0);
  const usedLate = touch(s, T0 + 29 * MIN);
  assert.equal(remainingMs(usedLate, T0 + 29 * MIN), 30 * MIN);
  // and it is not considered idle at the original deadline
  assert.equal(advance(usedLate, T0 + 31 * MIN).phase, PHASES.ACTIVE);
});

test("destroyed is final: nothing revives it", () => {
  const dead = { ...newLifecycle("mc-aabbcc", 30, T0), phase: PHASES.DESTROYED };
  assert.equal(advance(dead, T0 + 999 * MIN).phase, PHASES.DESTROYED);
  assert.equal(touch(dead, T0 + 999 * MIN).phase, PHASES.DESTROYED);
  assert.equal(remainingMs(dead, T0), 0);
});

test("advance does not mutate the state it is given", () => {
  const s = newLifecycle("mc-aabbcc", 30, T0);
  const snapshot = JSON.stringify(s);
  advance(s, T0 + 31 * MIN);
  assert.equal(JSON.stringify(s), snapshot);
});

test("every phase explains itself in words", () => {
  const active = newLifecycle("mc-aabbcc", 30, T0);
  assert.match(describe(active, T0), /Activo/);
  const suspended = advance(active, T0 + 31 * MIN);
  assert.match(describe(suspended, T0 + 31 * MIN), /no se destruye/i);
  const delivered = { ...suspended, snapshotDelivered: true };
  assert.match(describe(delivered, T0 + 31 * MIN), /guardado/i);
  const destroyed = advance(delivered, T0 + 32 * MIN);
  assert.match(describe(destroyed, T0 + 32 * MIN), /Irreversible/);
});
