/**
 * The rules that keep an agent from doing damage, each as a test that can fail.
 *
 * These matter more than the features: a sandbox that works but pushes to `main` or deletes
 * a repository is worse than no sandbox at all.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  BRANCH_PREFIX, FORBIDDEN, PROTECTED_BRANCHES, PolicyError,
  assertAllowed, assertPushableBranch, branchFor,
} from "../server/policy.mjs";
import { parseRepoUrl, safePathForTests } from "../server/orchestrator.mjs";

test("main is never a push target, in any of its names", () => {
  for (const branch of PROTECTED_BRANCHES) {
    assert.throws(() => assertPushableBranch(branch), PolicyError, `${branch} debe rechazarse`);
    assert.throws(() => assertPushableBranch(branch.toUpperCase()), PolicyError);
  }
});

test("work goes to movilclaw/<task>, and the prefix is required", () => {
  assert.equal(assertPushableBranch("movilclaw/fix-header"), "movilclaw/fix-header");
  // A branch without the prefix is refused: the name is how the work is attributed.
  assert.throws(() => assertPushableBranch("fix-header"), /debe empezar por/);
  assert.throws(() => assertPushableBranch("feature/algo"), /debe empezar por/);
});

test("a branch name cannot smuggle git syntax", () => {
  for (const bad of ["movilclaw/a b", "movilclaw/a..b", "movilclaw/a~1", "movilclaw/a^", "movilclaw/a:b"]) {
    assert.throws(() => assertPushableBranch(bad), PolicyError, `deberia rechazar ${bad}`);
  }
  assert.throws(() => assertPushableBranch(""), /nombre de la rama/);
});

test("the generated branch says what it is and when it happened", () => {
  const branch = branchFor("Integración con el host", new Date("2026-10-10T00:00:00Z"));
  assert.equal(branch, "movilclaw/integracion-con-el-host-2026-10-10");
  assert.match(branchFor(null, new Date("2026-10-10T00:00:00Z")), /^movilclaw\/cambios-2026-10-10$/);
});

test("every destructive operation is refused with a reason", () => {
  const destructive = ["repo.delete", "repo.visibility", "push.force", "pr.merge", "branch.delete", "secrets.write"];
  for (const op of destructive) {
    assert.throws(() => assertAllowed(op), PolicyError, `${op} debe estar prohibido`);
    assert.ok(FORBIDDEN[op], `${op} debe tener un motivo escrito`);
  }
  // A harmless operation passes: the function is not just "always throw".
  assert.doesNotThrow(() => assertAllowed("git.status"));
});

test("a repository URL cannot point at a private address", () => {
  // A sandbox must not be usable to reach into the host's own network.
  for (const bad of ["https://127.0.0.1/a/b", "https://169.254.169.254/a/b", "https://localhost/a/b"]) {
    assert.throws(() => parseRepoUrl(bad), /github\.com/);
  }
});

test("a repo path cannot escape the working directory", () => {
  for (const bad of ["../../etc/passwd", "/etc/passwd", "a/../../../b", "a\nb", "a\rb"]) {
    assert.throws(() => safePathForTests(bad), /relativa|dentro del repositorio/);
  }
  assert.equal(safePathForTests("src/app.ts"), "src/app.ts");
  assert.equal(safePathForTests("./src/app.ts"), "src/app.ts");
});

test("a git command with a token refuses to run without an explicit directory", async () => {
  // This is the bug that almost pushed the agent's branch into the project's own repository:
  // `git push` ran in whatever directory the server happened to start from. The fix makes
  // the working directory mandatory, so there is no "wherever I am" any more.
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../server/github.mjs", import.meta.url), "utf8");

  // Every git command that carries the credential must name its directory.
  // Counted by the calls themselves, not by a greedy regex over the whole file.
  const calls = (source.match(/gitWithToken\(\[/g) ?? []).length;
  const withCwd = (source.match(/gitWithToken\(\[[\s\S]{0,300}?cwd:/g) ?? []).length;
  assert.ok(calls >= 2, `deberia haber al menos un clone y un push (encontre ${calls})`);
  assert.equal(withCwd, calls, "cada gitWithToken debe llevar cwd");
  // And the guard itself must exist, not just the convention.
  assert.match(source, /gitWithToken necesita un directorio de trabajo explicito/);
});

test("the push compares against origin/<base>, not the local branch", async () => {
  // The second half of the same story: after unpacking a sandbox's .git over a --depth 1
  // clone, the local base ref and HEAD can be the same commit, so `main..HEAD` answered 0
  // while the work was sitting right there. The remote-tracking ref still knows.
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../server/github.mjs", import.meta.url), "utf8");
  assert.match(source, /origin\/\$\{baseBranch\}/, "debe comparar con origin/<base>");
  assert.doesNotMatch(
    source,
    /rev-list", "--count", `\$\{baseBranch\}\.\.HEAD`/,
    "no debe comparar con la rama local a secas",
  );
});

test("the branch rule is checked before any git command runs", async () => {
  // Order matters: assertPushableBranch must run before the push, so an invalid branch
  // is refused before a single byte leaves the machine.
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../server/github.mjs", import.meta.url), "utf8");
  const pushAt = source.indexOf('"push", "--set-upstream"');
  const checkAt = source.indexOf("assertPushableBranch(branch)");
  assert.ok(checkAt > 0, "debe comprobar la rama");
  assert.ok(pushAt > 0, "debe haber un push");
  assert.ok(pushAt > checkAt, "la regla de ramas debe comprobarse antes del push");
});
