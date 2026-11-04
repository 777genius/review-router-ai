/** Child-process lifetime, process-tree termination and bounded redacted output. */
import { execFileSync, spawn } from "node:child_process";

const maxCapturedProcessOutputBytes = 256_000;
const processTerminationGracePeriodMs = 5_000;

type ProcessOutputIO = {
  readonly stdout: Pick<NodeJS.WriteStream, "write">;
  readonly stderr: Pick<NodeJS.WriteStream, "write">;
};

export class ProcessExecutionError extends Error {
  constructor(
    message: string,
    readonly output: string,
  ) {
    super(message);
  }
}


type KillableChildProcess = Pick<ReturnType<typeof spawn>, "pid" | "kill">;

type UnixProcessEntry = {
  readonly pid: number;
  readonly parentPid: number;
  readonly processGroupId: number;
};

type CapturedUnixProcessTree = {
  readonly rootPid: number;
  readonly processGroupIds: readonly number[];
};

function captureUnixProcessTree(
  rootPid: number,
): CapturedUnixProcessTree | null {
  if (process.platform === "win32") return null;
  try {
    const output = execFileSync("/bin/ps", ["-A", "-o", "pid=,ppid=,pgid="], {
      encoding: "utf8",
      env: { LANG: "C", LC_ALL: "C", PATH: "/usr/bin:/bin" },
      timeout: 2_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    const entries = output
      .split("\n")
      .map((line): UnixProcessEntry | null => {
        const [pid, parentPid, processGroupId] = line
          .trim()
          .split(/\s+/)
          .map(Number);
        if (
          !Number.isSafeInteger(pid) ||
          !Number.isSafeInteger(parentPid) ||
          !Number.isSafeInteger(processGroupId)
        ) {
          return null;
        }
        return {
          pid: pid!,
          parentPid: parentPid!,
          processGroupId: processGroupId!,
        };
      })
      .filter((entry): entry is UnixProcessEntry => entry !== null);
    const descendants = new Set<number>([rootPid]);
    let foundNewDescendant = true;
    while (foundNewDescendant) {
      foundNewDescendant = false;
      for (const entry of entries) {
        if (descendants.has(entry.parentPid) && !descendants.has(entry.pid)) {
          descendants.add(entry.pid);
          foundNewDescendant = true;
        }
      }
    }
    const ownProcessGroupId = entries.find(
      (entry) => entry.pid === process.pid,
    )?.processGroupId;
    const processGroupIds = new Set<number>();
    for (const entry of entries) {
      if (
        descendants.has(entry.pid) &&
        entry.processGroupId > 0 &&
        entry.processGroupId !== ownProcessGroupId
      ) {
        processGroupIds.add(entry.processGroupId);
      }
    }
    if (processGroupIds.size === 0 && rootPid > 0) {
      processGroupIds.add(rootPid);
    }
    return {
      rootPid,
      processGroupIds: [...processGroupIds].sort((left, right) => {
        if (left === rootPid) return 1;
        if (right === rootPid) return -1;
        return left - right;
      }),
    };
  } catch {
    return null;
  }
}

function signalCapturedUnixProcessTree(
  tree: CapturedUnixProcessTree,
  signal: NodeJS.Signals,
): boolean {
  let signaled = false;
  for (const processGroupId of tree.processGroupIds) {
    try {
      process.kill(-processGroupId, signal);
      signaled = true;
    } catch {
      // Continue signaling the remaining captured groups; termination is best effort.
    }
  }
  return signaled;
}

export function signalProcessTree(
  child: KillableChildProcess,
  signal: NodeJS.Signals,
  options: {
    readonly platform?: NodeJS.Platform;
    readonly killProcessGroup?: typeof process.kill;
  } = {},
): boolean {
  const platform = options.platform ?? process.platform;
  if (platform !== "win32" && child.pid !== undefined) {
    try {
      (options.killProcessGroup ?? process.kill)(-child.pid, signal);
      return true;
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ESRCH") {
        return false;
      }
    }
  }
  return child.kill(signal);
}

export function runProcess(input: {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd?: string;
  readonly env: Record<string, string>;
  readonly stdin?: string;
  readonly streamOutput?: ProcessOutputIO;
  readonly timeoutMs: number;
  readonly terminationGracePeriodMs?: number;
  readonly abortSignal?: AbortSignal | undefined;
}): Promise<void> {
  if (input.abortSignal?.aborted) {
    return Promise.reject(processAbortError(input.abortSignal));
  }
  return new Promise((resolve, reject) => {
    const outputChunks: Buffer[] = [];
    let outputBytes = 0;
    let settled = false;
    let terminationError: unknown;
    let terminationProcessTree: CapturedUnixProcessTree | null = null;
    let forceKillTimer: ReturnType<typeof setTimeout> | undefined;
    const child = spawn(input.command, input.args, {
      cwd: input.cwd,
      env: input.env,
      stdio: ["pipe", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    const settle = (result: { readonly error?: unknown }): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      input.abortSignal?.removeEventListener("abort", onAbort);
      if (result.error !== undefined) {
        reject(result.error);
      } else {
        resolve();
      }
    };
    const requestTermination = (error: unknown): void => {
      if (settled || terminationError !== undefined) return;
      terminationError = error;
      terminationProcessTree =
        child.pid === undefined ? null : captureUnixProcessTree(child.pid);
      if (terminationProcessTree) {
        signalCapturedUnixProcessTree(terminationProcessTree, "SIGTERM");
      } else {
        signalProcessTree(child, "SIGTERM");
      }
      forceKillTimer = setTimeout(() => {
        if (terminationProcessTree) {
          signalCapturedUnixProcessTree(terminationProcessTree, "SIGKILL");
        } else {
          signalProcessTree(child, "SIGKILL");
        }
        settle({ error: terminationError });
      }, input.terminationGracePeriodMs ?? processTerminationGracePeriodMs);
    };
    const onAbort = (): void => {
      requestTermination(processAbortError(input.abortSignal!));
    };
    const timer = setTimeout(
      () => requestTermination(new Error("process_timeout")),
      input.timeoutMs,
    );
    child.stdout.on("data", (chunk) => {
      writeProcessLogChunk(input.streamOutput?.stdout, chunk);
      outputBytes = appendCapturedChunk(
        outputChunks,
        outputBytes,
        Buffer.from(chunk),
      );
    });
    child.stderr.on("data", (chunk) => {
      writeProcessLogChunk(input.streamOutput?.stderr, chunk);
      outputBytes = appendCapturedChunk(
        outputChunks,
        outputBytes,
        Buffer.from(chunk),
      );
    });
    child.on("error", (error) => {
      if (terminationError !== undefined && process.platform !== "win32") {
        return;
      }
      settle({ error: terminationError ?? error });
    });
    child.on("close", (code) => {
      if (terminationError !== undefined) {
        if (process.platform === "win32") {
          settle({ error: terminationError });
        }
        return;
      }
      if (code === 0) {
        settle({});
      } else {
        settle({
          error: new ProcessExecutionError(
            `process_failed:${input.command}:${code ?? "signal"}`,
            Buffer.concat(outputChunks).toString("utf8"),
          ),
        });
      }
    });
    input.abortSignal?.addEventListener("abort", onAbort, { once: true });
    if (input.abortSignal?.aborted) {
      onAbort();
    }
    child.stdin.on("error", () => undefined);
    child.stdin.end(input.stdin ?? "");
  });
}

function processAbortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error("process_aborted");
}

function writeProcessLogChunk(
  stream: Pick<NodeJS.WriteStream, "write"> | undefined,
  chunk: unknown,
): void {
  if (!stream) return;
  const text = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
  stream.write(sanitizeProcessLogChunk(text));
}

function appendCapturedChunk(
  chunks: Buffer[],
  currentBytes: number,
  chunk: Buffer,
): number {
  const remaining = maxCapturedProcessOutputBytes - currentBytes;
  if (remaining <= 0) {
    return currentBytes;
  }
  const nextChunk =
    chunk.byteLength > remaining ? chunk.subarray(0, remaining) : chunk;
  chunks.push(nextChunk);
  return currentBytes + nextChunk.byteLength;
}


function sanitizeProcessLogChunk(output: string): string {
  return output
    .replace(/auth\.json["'\s:=]+[^\s"'`]+/gi, "auth.json: [redacted]")
    .replace(
      /\b(refresh_token|access_token|id_token)\b["'\s:=]+[A-Za-z0-9._~+/=-]+/gi,
      "$1: [redacted]",
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/[A-Za-z0-9._~+/=-]{120,}/g, "[redacted]");
}

