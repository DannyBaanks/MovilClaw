/**
 * Real isolation tests. They need Docker and are skipped without it, because a
 * simulated container would prove nothing about the promises in docs/AISLAMIENTO.md.
 *
 * Build the sandbox image first:  docker build -t movilclaw/sandbox:latest server/
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { spawnSync } from "node:child_process";

function dockerAvailable() {
  const r = spawnSync("docker", ["info", "--format", "{{.ServerVersion}}"], { encoding: "utf8" });
  return r.status === 0;
}

function imageAvailable() {
  const r = spawnSync("docker", ["image", "inspect", "movilclaw/sandbox:latest"], { encoding: "utf8" });
  return r.status === 0;
}

const hasDocker = dockerAvailable();
const hasImage = hasDocker && imageAvailable();
const skip = !hasImage
  ? "needs Docker and `docker build -t movilclaw/sandbox:latest server/`"
  : false;

function run(args, timeout = 120_000) {
  const r = spawnSync("docker", args, { encoding: "utf8", timeout });
  return { code: r.status, out: (r.stdout ?? "").trim(), err: (r.stderr ?? "").trim() };
}

function withSandbox(name, fn) {
  run(["rm", "--force", "--volumes", name]);
  const started = run([
    "run", "--detach", "--name", name,
    "--network", "none",
    "--security-opt", "no-new-privileges",
    "--user", "1000:1000",
    "--memory", "256m", "--cpus", "1", "--pids-limit", "64",
    "--volume", name + "-work:/work", "--workdir", "/work",
    "--entrypoint", "/bin/sh",
    "movilclaw/sandbox:latest", "-c", "sleep infinity",
  ]);
  assert.equal(started.code, 0, `could not start sandbox: ${started.err}`);
  try {
    return fn();
  } finally {
    run(["rm", "--force", name]);
    // a NAMED volume survives `docker rm --volumes`; it must be removed explicitly
    run(["volume", "rm", "--force", name + "-work"]);
  }
}

test("no network: a socket cannot leave the sandbox", { skip }, () => {
  withSandbox("mc-iso-net", () => {
    // Python is in the image; try to reach out and expect the OS to refuse.
    const r = run(["exec", "mc-iso-net", "python3", "-c",
      "import socket;s=socket.socket();s.settimeout(3);s.connect(('1.1.1.1',443))"]);
    assert.notEqual(r.code, 0, "the sandbox must not reach the network");
    assert.match(r.err + r.out, /Network is unreachable|Network unreachable|timed out|OSError/i);
  });
});

test("no host filesystem: the sandbox only sees its own volume", { skip }, () => {
  withSandbox("mc-iso-fs", () => {
    // What matters is not which directory names exist (a base image ships its own
    // /home, /mnt, /media); it is that none of them carries the host's content.
    const home = run(["exec", "mc-iso-fs", "ls", "/home"]);
    assert.ok(!/danny/.test(home.out), "the host user must not appear under /home");

    // The host project directory must not be reachable by any of its paths.
    for (const hostPath of ["/home/danny", "/home/danny/Development"]) {
      const probe = run(["exec", "mc-iso-fs", "sh", "-c", `test -e ${hostPath} && echo VISIBLE || echo absent`]);
      assert.equal(probe.out, "absent", `${hostPath} must not exist inside the sandbox`);
    }

    // And its own workspace is mounted where promised.
    const work = run(["exec", "mc-iso-fs", "sh", "-c", "test -d /work && echo ok"]);
    assert.equal(work.out, "ok", "its own volume must be mounted at /work");
  });
});

test("it does not run as root, and cannot gain privileges", { skip }, () => {
  withSandbox("mc-iso-user", () => {
    const who = run(["exec", "mc-iso-user", "id", "-u"]);
    assert.notEqual(who.out, "0", "the sandbox must not be root");
    assert.equal(who.out, "1000");
  });
});

test("memory is really capped, and the cap is visible from inside", { skip }, () => {
  withSandbox("mc-iso-mem", () => {
    // This test used to assert that `bytearray(1GiB)` failed under a 256m cap. It passed
    // locally and failed on the CI runner, and the reason is worth keeping: `bytearray`
    // reserves *virtual* memory, which the kernel does not charge until pages are written.
    // So the old assertion measured the kernel's overcommit mood, not the sandbox's limit.
    //
    // What is actually testable is the limit itself: the container's own cgroup says what
    // it is allowed to use, and that number is set by the flag the orchestrator passes.
    const limitFile = "/sys/fs/cgroup/memory.max"; // cgroup v2
    const legacy = "/sys/fs/cgroup/memory/memory.limit_in_bytes"; // cgroup v1
    const r = run(["exec", "mc-iso-mem", "sh", "-c",
      `cat ${limitFile} 2>/dev/null || cat ${legacy} 2>/dev/null || echo sin-limite`]);
    const value = r.out.trim();
    assert.notEqual(value, "sin-limite", "el sandbox debe tener un limite de memoria puesto");

    // Either an exact byte count, or the literal "max" when Docker chose the host's default.
    if (value !== "max") {
      const bytes = Number(value);
      assert.ok(Number.isFinite(bytes), `el limite debe ser un numero, y llego: ${value}`);
      assert.ok(bytes <= 256 * 1024 * 1024,
        `el limite debe ser de 256m o menos, y es ${Math.round(bytes / 1024 / 1024)}m`);
    }

    // And writing past the cap must not be survivable: the process is killed by the kernel
    // (OOM), which is why the old test looked for the wrong kind of failure.
    const hog = run(["exec", "mc-iso-mem", "python3", "-c",
      "b=bytearray(1024*1024*1024)\nfor i in range(0,len(b),4096): b[i]=1\nprint('sobrevivio')"]);
    assert.notEqual(hog.code, 0, "escribir 1 GiB bajo un tope de 256m no debe sobrevivir");
    assert.doesNotMatch(hog.out, /sobrevivio/);
  });
});

test("destroying removes the container AND the named volume with its data", { skip }, () => {
  const name = "mc-iso-gone";
  withSandbox(name, () => {
    const inside = run(["exec", name, "sh", "-c", "echo hola > /work/proof.txt && cat /work/proof.txt"]);
    assert.equal(inside.out, "hola");
  });
  // after withSandbox returns, the container and its volume must be gone
  const inspect = run(["inspect", name]);
  assert.notEqual(inspect.code, 0, "the container must no longer exist");
  const volumes = run(["volume", "ls", "--format", "{{.Name}}"]);
  assert.ok(!volumes.out.split("\n").includes(name + "-work"), "the volume must be removed too");
});
