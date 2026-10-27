import { getMaxOldSpaceSize } from "next/dist/server/lib/utils.js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { startNextApp } from "./next-app.js";

const { child, spawnMock } = vi.hoisted(() => {
  const child = {
    exitCode: null as number | null,
    signalCode: null,
    pid: undefined,
  };
  return {
    child,
    spawnMock: vi.fn<
      (
        executable: string,
        args: readonly string[],
        options: { env: NodeJS.ProcessEnv },
      ) => typeof child
    >(() => child),
  };
});

vi.mock("node:child_process", () => ({ spawn: spawnMock }));
vi.mock("node:fs/promises", () => ({
  access: vi.fn().mockRejectedValue(new Error("fixture has no dotenv files")),
  open: vi.fn().mockResolvedValue({ fd: 42, close: async () => undefined }),
}));

beforeEach(() => {
  child.exitCode = null;
  spawnMock.mockClear();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
  vi.stubEnv("NODE_OPTIONS", "--max-old-space-size=8192 --trace-warnings");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const input = {
  repoRoot: "/fixture/repository",
  port: 3100,
  environment: { PROVIDER_VISUAL_GITHUB_FIXTURE: "/fixture/github.json" },
  preload: "/fixture/preload.ts",
  logPath: "/fixture/next.log",
};

it("passes the requested heap limit where the installed Next fork actually reads it", async () => {
  const app = await startNextApp({ ...input, maxOldSpaceSizeMb: 1024 });
  try {
    const [, args, options] = spawnMock.mock.calls[0]!;
    expect(args).toContain("--max-old-space-size=1024");
    expect(options.env.NODE_OPTIONS).toBe("--max-old-space-size=1024");
    vi.stubEnv("NODE_OPTIONS", options.env.NODE_OPTIONS);
    // This is Next's actual override predicate, which ignores CLI execArgv.
    expect(getMaxOldSpaceSize()).toBe(1024);
  } finally {
    child.exitCode = 0;
    await app.stop();
  }
});

it("does not inherit parent NODE_OPTIONS when no controlled heap limit was requested", async () => {
  const app = await startNextApp(input);
  try {
    const [, args, options] = spawnMock.mock.calls[0]!;
    expect(args.some((arg) => arg.startsWith("--max-old-space-size="))).toBe(
      false,
    );
    expect(options.env.NODE_OPTIONS).toBeUndefined();
    vi.stubEnv("NODE_OPTIONS", options.env.NODE_OPTIONS);
    expect(getMaxOldSpaceSize()).toBeUndefined();
  } finally {
    child.exitCode = 0;
    await app.stop();
  }
});
