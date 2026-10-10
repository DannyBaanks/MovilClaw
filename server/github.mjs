/**
 * GitHub work done by the host, so the sandbox never holds a credential.
 *
 * The invariant this file exists to protect: **a token never enters a sandbox**. It goes
 * into a git header on the host, the code is cloned here, the remote is rewritten without
 * credentials, and only then is the result handed over. Pushing works the same way in
 * reverse: the host pushes on the agent's behalf, to a branch, never to `main`.
 *
 * Every operation here is one of the allowed ones. The destructive ones are absent from
 * the code (see server/policy.mjs), not merely discouraged.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PolicyError, assertPushableBranch, defaultBranchProtection } from "./policy.mjs";

const run = promisify(execFile);

export class GithubError extends Error {}

/**
 * Run git with the token in a header, so it never lands in .git/config.
 *
 * The header is **Basic**, not `Bearer`. That was measured, not guessed: with `Bearer`,
 * git answers `remote: invalid credentials` for an OAuth token, because git speaks HTTP
 * Basic auth and expects the token as the password. `x-access-token` is the conventional
 * username for a token, and GitHub ignores it.
 *
 * `GIT_TERMINAL_PROMPT=0` is set so a bad token fails immediately instead of hanging
 * forever waiting for a password nobody is there to type.
 */
async function gitWithToken(args, token, options = {}) {
  const basic = Buffer.from(`x-access-token:${token}`, "utf8").toString("base64");
  return run("git", ["-c", `http.extraheader=Authorization: Basic ${basic}`, ...args], {
    maxBuffer: 32 * 1024 * 1024,
    timeout: options.timeoutMs ?? 120_000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
}

function parse(remoteUrl) {
  const match = /github\.com[/:]([^/]+)\/([^/.]+?)(?:\.git)?$/.exec(String(remoteUrl ?? "").trim());
  if (!match) throw new GithubError("la URL no es un repositorio de github.com");
  return { owner: match[1], repo: match[2] };
}

/** Who is this token? Used to show the account before doing anything with it. */
export async function whoami(token) {
  // The REST API does want `Bearer`; only git wants Basic. Two different protocols,
  // and mixing them up is exactly the bug that was found here.
  const { stdout } = await run("curl", [
    "-s", "--max-time", "20",
    "-H", `Authorization: Bearer ${token}`,
    "-H", "Accept: application/vnd.github+json",
    "https://api.github.com/user",
  ]);
  let data;
  try {
    data = JSON.parse(stdout);
  } catch {
    throw new GithubError("github no respondio como se esperaba");
  }
  if (!data.login) throw new GithubError("el token no es valido o ha caducado");
  const scopes = /scopes?:\s*(.*)/i.exec(stdout)?.[1] ?? "";
  return { login: data.login, name: data.name ?? null, scopes: scopes.split(",").map((s) => s.trim()).filter(Boolean) };
}

/**
 * Clone a repository — public or private — on the host, returning a directory with the code
 * and **no credentials anywhere in it**.
 *
 * The caller packs this directory into the sandbox. That is the whole trick: the sandbox
 * gets the files, and never the means to act as the account.
 */
export async function cloneOnHost({ remoteUrl, token, branch = null }) {
  const { owner, repo } = parse(remoteUrl);
  const url = `https://github.com/${owner}/${repo}.git`;
  const dir = await mkdtemp(join(tmpdir(), "mc-clone-"));
  try {
    await gitWithToken(["clone", "--depth", "1", ...(branch ? ["--branch", branch] : []), url, dir], token, {
      timeoutMs: 300_000,
    });
  } catch (error) {
    await rm(dir, { recursive: true, force: true });
    const message = String(error.stderr ?? error.message);
    if (/not found|could not read|repository not found/i.test(message)) {
      throw new GithubError("no se encontro el repositorio, o el token no tiene acceso a el");
    }
    throw new GithubError(`no se pudo clonar: ${message.slice(0, 200)}`);
  }

  // Belt and braces: whatever git wrote, the remote must not carry the token.
  await run("git", ["-C", dir, "remote", "set-url", "origin", url]);
  const { stdout: head } = await run("git", ["-C", dir, "log", "-1", "--format=%H %s"]);
  const { stdout: currentBranch } = await run("git", ["-C", dir, "rev-parse", "--abbrev-ref", "HEAD"]);
  return { dir, url, owner, repo, commit: head.trim(), branch: currentBranch.trim() };
}

/**
 * Push a working directory to `movilclaw/<...>` and open a pull request.
 *
 * Three refusals happen here, and each one is a real way this could go wrong:
 *  - pushing to a shared branch is refused (branch policy),
 *  - there must be something to push (no empty pull requests),
 *  - the pull request is opened, never merged.
 */
export async function pushBranchAndOpenPr({
  workDir,
  token,
  branch,
  baseBranch = "main",
  title,
  body = "",
}) {
  // Note what is deliberately absent: no merge call, no force push, no branch delete.
  const safeBranch = assertPushableBranch(branch);
  const { stdout: remote } = await run("git", ["-C", workDir, "remote", "get-url", "origin"]);
  const { owner, repo } = parse(remote.trim());

  // Something to push? An empty branch means an empty pull request, which helps nobody.
  const { stdout: status } = await run("git", ["-C", workDir, "status", "--porcelain"]);
  const { stdout: ahead } = await run("git", ["-C", workDir, "rev-list", "--count", `${baseBranch}..HEAD`]).catch(
    () => ({ stdout: "0" }),
  );
  if (!status.trim() && Number(ahead) === 0) {
    throw new GithubError("no hay ningun cambio que empujar");
  }

  await run("git", ["-C", workDir, "add", "-A"]);
  const { stdout: committed } = await run("git", ["-C", workDir, "diff", "--cached", "--name-only"]);
  if (committed.trim()) {
    // Commit anything not yet committed; the agent's own commits are left untouched.
    await run("git", ["-C", workDir, "commit", "-m", title ?? "movilclaw: cambios del agente"]);
  }

  // Create (or move to) the branch, then push it. Never the base branch.
  await run("git", ["-C", workDir, "checkout", "-B", safeBranch]);
  const { stdout: current } = await run("git", ["-C", workDir, "rev-parse", "--abbrev-ref", "HEAD"]);
  if (current.trim() === baseBranch) {
    throw new PolicyError("se iba a empujar a la rama base; se cancela");
  }
  await gitWithToken(["push", "--set-upstream", "origin", safeBranch], token, { timeoutMs: 300_000 });

  // Open the pull request through the API, with the token, on the host.
  const payload = JSON.stringify({
    title: title ?? "movilclaw: cambios del agente",
    head: safeBranch,
    base: baseBranch,
    body: body || "Abrimos este PR desde MovilClaw. El trabajo va en una rama aparte; **fusionar es decision tuya**.",
  });
  const { stdout: created } = await run("curl", [
    "-s", "--max-time", "30", "-X", "POST",
    "-H", `Authorization: Bearer ${token}`,
    "-H", "Accept: application/vnd.github+json",
    "-d", payload,
    `https://api.github.com/repos/${owner}/${repo}/pulls`,
  ]);
  let pr;
  try {
    pr = JSON.parse(created);
  } catch {
    throw new GithubError("github no devolvio un PR legible");
  }
  if (!pr.html_url) {
    throw new GithubError(`no se pudo abrir el PR: ${String(pr.message ?? created).slice(0, 200)}`);
  }
  return { branch: safeBranch, pullRequest: pr.html_url, number: pr.number, base: baseBranch, merged: false };
}

export { defaultBranchProtection };
