import { fork, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

type Message = { type: string; closeCalls?: number; signal?: string };
function child(mode: "success" | "fail") {
  const process = fork(
    fileURLToPath(
      new URL("./test-support/api-graceful-shutdown-child.ts", import.meta.url),
    ),
    [mode],
    {
      execArgv: ["--import", "tsx"],
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    },
  );
  const events: Message[] = [];
  const listeners = new Set<() => void>();
  let stderr = "";
  process.stderr!.on("data", (bytes: Buffer) => {
    stderr += bytes.toString();
  });
  process.on("message", (message: Message) => {
    events.push(message);
    for (const notify of listeners) notify();
  });
  const exit = new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>((resolve, reject) => {
    process.once("error", reject);
    process.once("close", (code, signal) => resolve({ code, signal }));
  });
  function observed(type: string, count = 1): Promise<Message[]> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        listeners.delete(check);
        reject(new Error(`fixture_missing_${type}`));
      }, 8000);
      function check() {
        const matches = events.filter((event) => event.type === type);
        if (matches.length < count) return;
        clearTimeout(timer);
        listeners.delete(check);
        resolve(matches);
      }
      listeners.add(check);
      check();
    });
  }
  return { process, events, exit, observed, stderr: () => stderr };
}
function stopOwnedChild(process: ChildProcess) {
  if (process.exitCode === null && process.signalCode === null)
    process.kill("SIGKILL");
}

it.each(["SIGTERM", "SIGINT"] as const)(
  "awaits real Fastify cleanup after %s and ignores duplicate signals while draining",
  async (first) => {
    const fixture = child("success");
    try {
      await fixture.observed("ready");
      fixture.process.kill(first);
      await fixture.observed("pre-close");
      fixture.process.kill(first === "SIGTERM" ? "SIGINT" : "SIGTERM");
      const signals = await fixture.observed("signal", 2);
      expect(signals.map((event) => event.closeCalls)).toEqual([1, 1]);
      expect(
        fixture.events.filter((event) => event.type === "close-called"),
      ).toHaveLength(1);
      expect(fixture.events.some((event) => event.type === "drained")).toBe(
        false,
      );
      expect(fixture.process.exitCode).toBeNull();
      expect(fixture.process.signalCode).toBeNull();
      fixture.process.send("release");
      await expect(fixture.exit).resolves.toEqual({ code: 0, signal: null });
      expect(
        fixture.events.filter((event) => event.type === "drained"),
      ).toHaveLength(1);
      expect(
        fixture.events.filter((event) => event.type === "closed"),
      ).toHaveLength(1);
    } finally {
      stopOwnedChild(fixture.process);
    }
  },
  15000,
);

it("exits unsuccessfully with a safe message if shutdown rejects", async () => {
  const fixture = child("fail");
  try {
    await fixture.observed("ready");
    fixture.process.kill("SIGTERM");
    await fixture.observed("pre-close");
    fixture.process.send("release");
    await expect(fixture.exit).resolves.toEqual({ code: 1, signal: null });
    expect(fixture.stderr()).toContain(
      "ReviewRouter API shutdown failed; cleanup is unconfirmed.",
    );
    expect(fixture.stderr()).not.toContain("fixture-secret");
  } finally {
    stopOwnedChild(fixture.process);
  }
}, 15000);
