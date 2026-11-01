import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { committedLifecycleProducerRelease } from "./support/committed-producer-release.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

it.each(["tracked", "untracked"] as const)(
  "rejects %s Action source changes before registering a clean clone's identity",
  (kind) => {
    const root = mkdtempSync(path.join(tmpdir(), "paired-dirty-action-"));
    roots.push(root);
    const git = (...args: string[]) =>
      execFileSync("git", ["-C", root, ...args], { stdio: "ignore" });
    git("init", "-b", "main");
    writeFileSync(path.join(root, "runtime.ts"), "export const version = 1;\n");
    git("add", "runtime.ts");
    git(
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.test",
      "commit",
      "-m",
      "fixture source",
    );
    writeFileSync(
      path.join(root, kind === "tracked" ? "runtime.ts" : "extra.ts"),
      "export const version = 2;\n",
    );
    expect(() => committedLifecycleProducerRelease(root)).toThrow(
      /paired Action source.*clean|paired Action source.*dirty/i,
    );
  },
);
