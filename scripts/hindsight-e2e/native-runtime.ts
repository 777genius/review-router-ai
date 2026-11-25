import { spawn } from "node:child_process";
import { createServer } from "node:net";

export const pause = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));
export async function dockerCommand(
  args: string[],
  allowFailure = false,
  input?: string,
): Promise<string> {
  return await new Promise((resolve, reject) => {
    const child = spawn("docker", args, {
      stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });
    if (input !== undefined) {
      // An early Docker/psql failure can close stdin before the bounded input.
      // The process exit below remains the authority and suppresses diagnostics.
      child.stdin?.on("error", () => {});
      child.stdin?.end(input);
    }
    let stdout = "";
    let stderr = "";
    child.stdout!.on("data", (data) => {
      if (stdout.length < 10_000_000) stdout += data;
    });
    child.stderr!.on("data", (data) => {
      if (stderr.length < 10_000_000) stderr += data;
    });
    child.on("error", () => reject(new Error("Docker runtime is unavailable")));
    child.on("close", (code) =>
      code === 0 || allowFailure
        ? resolve(stdout + (allowFailure ? stderr : ""))
        : reject(
            new Error(
              `Docker ${args[0]} failed (${code}); diagnostic payload suppressed`,
            ),
          ),
    );
  });
}
export async function freePort() {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Cannot allocate loopback port");
  const port = address.port;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}
export async function eventually<T>(
  action: () => Promise<T | undefined>,
  label: string,
  timeout = 60_000,
): Promise<T> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await action();
    if (result !== undefined) return result;
    await pause(200);
  }
  throw new Error(`Native operation timed out: ${label}`);
}
