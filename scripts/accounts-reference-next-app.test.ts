import { getParsedNodeOptions } from "next/dist/server/lib/utils.js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { startNextApp } from "./accounts-reference-e2e/src/app.ts";

const { child, spawnMock } = vi.hoisted(() => {
  const child = {
    exitCode: null as number | null,
    signalCode: null as NodeJS.Signals | null,
    stdout: { pipe: vi.fn() },
    stderr: { pipe: vi.fn() },
    once: vi.fn(),
  };
  return {
    child,
    spawnMock: vi.fn<
      (
        executable: string,
        args: readonly string[],
        options: { env: NodeJS.ProcessEnv; cwd: string },
      ) => typeof child
    >(() => child),
  };
});

vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  spawn: spawnMock,
}));
vi.mock("node:fs/promises", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs/promises")>()),
  access: vi.fn().mockRejectedValue(new Error("no fixture dotenv files")),
  mkdir: vi.fn().mockResolvedValue(undefined),
  open: vi.fn().mockResolvedValue({
    createWriteStream: () => ({}),
    close: async () => undefined,
  }),
}));
vi.mock("node:net", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:net")>()),
  createServer: () => ({
    once: vi.fn(),
    listen: (_port: number, _host: string, ready: () => void) => ready(),
    address: () => ({ port: 3100 }),
    close: (closed: () => void) => closed(),
  }),
}));

const inheritedOptions =
  "--import=file:///fixture/native-guard.ts --import=file:///fixture/observer.mjs --max-old-space-size=3584 --max-semi-space-size=8";
const input = {
  repoRoot: "/fixture/repository",
  workDir: "/fixture/repository/tmp/accounts-reference-e2e/run",
  databaseUrl:
    "postgresql://fixture:password@127.0.0.1:5432/review_router_accounts_reference_e2e_test?schema=public",
  gatewayUrl: "http://127.0.0.1:3101",
  secrets: {
    authSecret: "fixture-auth",
    gatewayAccountsContextSecret: "fixture-context",
    githubClientId: "fixture-client",
    githubClientSecret: "fixture-client-secret",
    managementToken: "fixture-management",
    personalControlToken: "fixture-personal-control",
  },
  browserExecutable: null,
};

beforeEach(() => {
  child.exitCode = null;
  spawnMock.mockClear();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
  vi.stubEnv("NODE_OPTIONS", inheritedOptions);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("keeps the ordinary Next CLI and inherited guards unchanged by default", async () => {
  const app = await startNextApp(input);
  try {
    const [, args, options] = spawnMock.mock.calls[0]!;
    expect(args).toEqual([
      "/fixture/repository/node_modules/next/dist/bin/next",
      "dev",
      "--webpack",
      "-H",
      "127.0.0.1",
      "-p",
      "3100",
    ]);
    expect(options.env.NODE_OPTIONS).toBe(inheritedOptions);
  } finally {
    child.exitCode = 0;
    await app.stop();
  }
});

it("carries the explicit compiler preload and existing guards into Next's own fork options", async () => {
  const app = await startNextApp({ ...input, lowMemoryWebpack: true });
  try {
    const [, args, options] = spawnMock.mock.calls[0]!;
    expect(args.slice(0, 3)).toEqual([
      "/fixture/repository/node_modules/next/dist/bin/next",
      "dev",
      "--webpack",
    ]);
    expect(args).toContain("--disable-source-maps");
    expect(options.env.NODE_OPTIONS).toBe(
      `${inheritedOptions} --import=file:///fixture/repository/scripts/accounts-reference-e2e/src/low-memory-webpack.ts`,
    );
    vi.stubEnv("NODE_OPTIONS", options.env.NODE_OPTIONS);
    const parsed = getParsedNodeOptions();
    expect(parsed["import"]).toEqual(
      expect.arrayContaining([
        "file:///fixture/native-guard.ts",
        "file:///fixture/observer.mjs",
        "file:///fixture/repository/scripts/accounts-reference-e2e/src/low-memory-webpack.ts",
      ]),
    );
    expect(parsed["max-old-space-size"]).toBe("3584");
    expect(parsed["max-semi-space-size"]).toBe("8");
    expect(options.env.NODE_ENV).toBe("development");
  } finally {
    child.exitCode = 0;
    await app.stop();
  }
});
