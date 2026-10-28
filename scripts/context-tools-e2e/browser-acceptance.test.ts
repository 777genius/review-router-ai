import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "playwright-core";
import { expect, test } from "vitest";
import { runContextToolsBrowserAcceptance } from "./browser-acceptance";

test("a crashed page preserves evidence and the original failure", async () => {
  const outputDirectory = await mkdtemp(join(tmpdir(), "rr-mcp-evidence-"));
  const originalFailure = new Error("original browser failure");
  const restoreCalls: string[] = [];
  let evaluateCalls = 0;
  let viewportCalls = 0;
  let evidenceBeforeRestore: unknown;
  const page = {
    viewportSize: () => ({ width: 1440, height: 1100 }),
    goto: async () => undefined,
    getByRole: () => ({ waitFor: async () => undefined }),
    evaluate: async () => {
      if (++evaluateCalls === 1) return null;
      evidenceBeforeRestore = JSON.parse(
        await readFile(join(outputDirectory, "acceptance.public.json"), "utf8"),
      );
      restoreCalls.push("theme");
      throw new Error("page closed");
    },
    setViewportSize: async () => {
      if (++viewportCalls === 1) throw originalFailure;
      restoreCalls.push("viewport");
      throw new Error("page closed");
    },
    reload: async () => {
      restoreCalls.push("reload");
      throw new Error("page closed");
    },
  } as unknown as Page;
  try {
    await expect(
      runContextToolsBrowserAcceptance({
        page,
        origin: "https://reviewrouter.test",
        workspaceId: "test-workspace",
        connectionPrefix: "e2e_crash_test",
        outputDirectory,
        presets: [
          {
            label: "Test",
            endpoint: "https://mcp.test/mcp",
            tool: "test_tool",
          },
        ],
      }),
    ).rejects.toBe(originalFailure);
    expect(evidenceBeforeRestore).toMatchObject({
      status: "INCOMPLETE",
      cleanupErrors: [],
    });
    expect(restoreCalls).toEqual(["theme", "viewport", "reload"]);
    const evidence = JSON.parse(
      await readFile(join(outputDirectory, "acceptance.public.json"), "utf8"),
    );
    expect(evidence).toMatchObject({
      status: "INCOMPLETE",
      restoreErrors: ["theme", "viewport", "reload"],
      modelCalls: 0,
      toolCalls: 0,
    });
  } finally {
    await rm(outputDirectory, { recursive: true, force: true });
  }
});
