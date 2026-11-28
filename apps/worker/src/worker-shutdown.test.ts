import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { registerWorkerShutdown } from "./worker-shutdown";

type Message = { type: string; claims?: number; processed?: number };

it.each(["SIGTERM", "SIGINT"] as const)(
  "drains a retained owner through repeated %s without taking new work",
  async (signal) => {
    const child = fork(
      fileURLToPath(
        new URL("./test-support/worker-shutdown-child.ts", import.meta.url),
      ),
      [],
      {
        execArgv: ["--import", "tsx"],
        stdio: ["ignore", "pipe", "pipe", "ipc"],
      },
    );
    const messages: Message[] = [];
    const watchers = new Set<() => void>();
    child.on("message", (message: Message) => {
      messages.push(message);
      for (const watcher of watchers) watcher();
    });
    let stderr = "";
    child.stderr!.on("data", (bytes: Buffer) => {
      stderr += bytes.toString();
    });
    const exited = new Promise<{
      code: number | null;
      signal: NodeJS.Signals | null;
    }>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, stoppedBy) =>
        resolve({ code, signal: stoppedBy }),
      );
    });
    const observed = (type: string) =>
      new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          watchers.delete(check);
          reject(new Error(`missing ${type}: ${stderr}`));
        }, 8_000);
        function check() {
          if (!messages.some((message) => message.type === type)) return;
          clearTimeout(timer);
          watchers.delete(check);
          resolve();
        }
        watchers.add(check);
        check();
      });
    try {
      await observed("claimed");
      child.kill(signal);
      await observed("stopping");
      child.kill(signal);
      child.send("probe");
      await observed("alive");
      expect(child.signalCode).toBeNull();
      expect(
        messages.filter((message) => message.type === "stopping"),
      ).toHaveLength(1);
      expect(messages.some((message) => message.type === "disconnected")).toBe(
        false,
      );
      child.send("release");
      expect(await exited).toEqual({ code: 0, signal: null });
      expect(
        messages.filter((message) => message.type === "claimed"),
      ).toHaveLength(1);
      expect(
        messages.filter((message) => message.type === "disconnected"),
      ).toEqual([{ type: "disconnected", claims: 1, processed: 1 }]);
      expect(
        messages.findIndex((message) => message.type === "settled"),
      ).toBeLessThan(
        messages.findIndex((message) => message.type === "disconnected"),
      );
    } finally {
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGKILL");
    }
  },
  15_000,
);

it("removes only its own signal listeners after drain", () => {
  const interrupts = process.listeners("SIGINT");
  const terminations = process.listeners("SIGTERM");
  const shutdown = registerWorkerShutdown(() => undefined);
  expect(process.listeners("SIGINT")).toHaveLength(interrupts.length + 1);
  expect(process.listeners("SIGTERM")).toHaveLength(terminations.length + 1);
  shutdown.dispose();
  shutdown.dispose();
  expect(process.listeners("SIGINT")).toEqual(interrupts);
  expect(process.listeners("SIGTERM")).toEqual(terminations);
});
