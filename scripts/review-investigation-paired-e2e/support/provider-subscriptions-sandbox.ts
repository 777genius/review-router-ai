// Test-only qualification of the pinned CLI's documented read-only backend.
// The caller verifies the CLI/archive and supplies the Action's own safe env.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import { createConnection, createServer, type Socket } from "node:net";
import path from "node:path";
const childProof = Object.freeze({
  contract: "codex-read-only-sandbox/v1" as const,
  childExecuted: true as const,
  readSucceeded: true as const,
  workspaceWriteDenied: true as const,
  outsideWriteDenied: true as const,
  loopbackTCPDenied: true as const,
  noNewPrivileges: true as const,
});
export type SandboxQualification = Readonly<
  typeof childProof & { backend: "bubblewrap" }
>;
type SandboxFailureReason =
  | "positive_controls"
  | "child_spawn"
  | "child_timeout"
  | "child_output_limit"
  | "policy_refused"
  | "child_usage_exit"
  | "child_panic_exit"
  | "child_namespace_refused"
  | "child_nonzero_exit"
  | "proof"
  | "postconditions"
  | "cleanup";

// A closed synthetic reason is safe to include in CI evidence. Never attach
// child output, paths, environment, configuration or the original exception.
export class SandboxQualificationError extends Error {
  constructor(readonly reason: SandboxFailureReason) {
    super("codex_read_only_sandbox_unqualified");
  }
}

export function requireSandboxProof(stdout: string): SandboxQualification {
  try {
    assert.ok(Buffer.byteLength(stdout) <= 4096);
    assert.deepEqual(JSON.parse(stdout) as unknown, childProof);
    return Object.freeze({ ...childProof, backend: "bubblewrap" });
  } catch {
    throw new Error("codex_read_only_sandbox_unqualified");
  }
}

// No command/provider output is reflected in the receipt. Startup errors,
// missing files, connection refusal and timeouts cannot count as denials.
const probe = `
import { readFileSync, writeFileSync } from "node:fs";
import { createConnection } from "node:net";
const input = JSON.parse(process.argv[1]);
const deniedWrite = (file) => {
  try { writeFileSync(file, "must-be-denied", { flag: "wx" }); return false; }
  catch (error) { return ["EACCES", "EPERM", "EROFS"].includes(error.code); }
};
const result = {
  contract: "codex-read-only-sandbox/v1",
  childExecuted: true,
  readSucceeded: readFileSync(input.canary, "utf8") === "sandbox-read-control",
  workspaceWriteDenied: deniedWrite(input.workspaceWrite),
  outsideWriteDenied: deniedWrite(input.outsideWrite),
  loopbackTCPDenied: await new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port: input.port });
    socket.setTimeout(750, () => { socket.destroy(); resolve(false); });
    socket.once("connect", () => { socket.destroy(); resolve(false); });
    socket.once("error", (error) => resolve(["EACCES", "EPERM"].includes(error.code)));
  }),
  noNewPrivileges: /^NoNewPrivs:\\s+1$/m.test(readFileSync("/proc/self/status", "utf8")),
};
process.stdout.write(JSON.stringify(result) + "\\n");
if (Object.entries(result).some(([key, value]) => key !== "contract" && value !== true)) process.exitCode = 1;
`;

export async function qualifyReadonlySandbox(input: {
  readonly binary: string;
  readonly workspace: string;
  readonly outsideRoot: string;
  readonly environment: NodeJS.ProcessEnv;
}): Promise<SandboxQualification> {
  const name = ".sandbox-probe-" + randomUUID();
  const canary = path.join(input.workspace, name + "-read");
  const workspaceWrite = path.join(input.workspace, name + "-write");
  const outsideWrite = path.join(input.outsideRoot, name + "-outside");
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    socket.end();
  });
  let phase: SandboxFailureReason = "positive_controls";
  try {
    try {
      assert.ok(path.isAbsolute(input.binary));
      assert.ok(path.isAbsolute(input.workspace));
      assert.ok(path.isAbsolute(input.outsideRoot));
      assert.ok(path.relative(input.workspace, outsideWrite).startsWith("../"));
      await writeFile(canary, "sandbox-read-control", { flag: "wx" });
      assert.equal(await readFile(canary, "utf8"), "sandbox-read-control");
      for (const file of [workspaceWrite, outsideWrite]) {
        await writeFile(file, "parent-write-control", { flag: "wx" });
        assert.equal(await readFile(file, "utf8"), "parent-write-control");
        await rm(file);
      }
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });
      const address = server.address();
      assert.ok(address && typeof address === "object");
      await new Promise<void>((resolve, reject) => {
        const socket = createConnection({
          host: "127.0.0.1",
          port: address.port,
        });
        socket.setTimeout(1000, () => {
          socket.destroy();
          reject(new Error("sandbox_positive_control_unavailable"));
        });
        socket.once("error", reject);
        socket.once("connect", () => {
          socket.destroy();
          resolve();
        });
      });
      // An invocation without a named profile includes managed requirements.
      // Match the Action's default backend, read-only policy and cwd exactly.
      phase = "child_spawn";
      const child = spawn(
        input.binary,
        [
          "sandbox",
          "linux",
          "-c",
          "features.use_legacy_landlock=false",
          "-c",
          'sandbox_mode="read-only"',
          "--",
          process.execPath,
          "--input-type=module",
          "--eval",
          probe,
          JSON.stringify({
            canary,
            workspaceWrite,
            outsideWrite,
            port: address.port,
          }),
        ],
        {
          cwd: input.workspace,
          env: input.environment,
          detached: true,
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      const stdout = await new Promise<string>((resolve, reject) => {
        let output = "";
        let diagnostic = "";
        let size = 0;
        let settled = false;
        const fail = (reason: SandboxFailureReason) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          // Only the process group created immediately above is terminated.
          // The CLI's helper must not keep inherited pipes alive after timeout.
          if (child.pid !== undefined) {
            try {
              process.kill(-child.pid, "SIGKILL");
            } catch {
              /* Cleanup failure cannot qualify. */
            }
          }
          child.stdout.destroy();
          child.stderr.destroy();
          reject(new SandboxQualificationError(reason));
        };
        const timer = setTimeout(() => fail("child_timeout"), 5000);
        child.stdout.on("data", (bytes: Buffer) => {
          size += bytes.byteLength;
          if (size > 8192) fail("child_output_limit");
          else output += bytes.toString("utf8");
        });
        child.stderr.on("data", (bytes: Buffer) => {
          size += bytes.byteLength;
          if (size > 8192) fail("child_output_limit");
          else diagnostic += bytes.toString("utf8");
        });
        child.once("error", () => fail("child_spawn"));
        child.once("close", (code) => {
          if (settled) return;
          if (code !== 0) {
            const policyRefused = diagnostic.includes(
              "permission profiles requiring direct runtime enforcement are incompatible with --use-legacy-landlock",
            );
            const namespaceRefused =
              /^bwrap: (?:Creating new namespace failed(?::|$)|No permissions to create a new namespace(?:,|$))/m.test(
                diagnostic,
              );
            fail(
              policyRefused
                ? "policy_refused"
                : namespaceRefused
                  ? "child_namespace_refused"
                  : code === 2
                    ? "child_usage_exit"
                    : code === 101
                      ? "child_panic_exit"
                      : "child_nonzero_exit",
            );
            return;
          }
          settled = true;
          clearTimeout(timer);
          resolve(output);
        });
      });
      phase = "proof";
      const proof = requireSandboxProof(stdout);
      phase = "postconditions";
      for (const file of [workspaceWrite, outsideWrite]) {
        await assert.rejects(readFile(file), { code: "ENOENT" });
      }
      assert.equal(await readFile(canary, "utf8"), "sandbox-read-control");
      return proof;
    } catch (error) {
      throw error instanceof SandboxQualificationError
        ? error
        : new SandboxQualificationError(phase);
    } finally {
      for (const socket of sockets) socket.destroy();
      if (server.listening)
        await new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        });
      await Promise.all(
        [canary, workspaceWrite, outsideWrite].map((file) =>
          rm(file, { force: true }),
        ),
      );
    }
  } catch (error) {
    throw error instanceof SandboxQualificationError
      ? error
      : new SandboxQualificationError("cleanup");
  }
}
