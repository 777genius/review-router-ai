import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import {
  assertFixtureNodeRuns,
  ensurePg17FixtureImage,
  managedPg17Fixture,
  pg17BaseImage,
  pg17FixtureImage,
} from "./render-managed-pg17-fixture";
import { assertSafeProcessBoundary } from "../../packages/features/release-rollout/src/adapters/process-command";
import {
  decomposePostgresConnection,
  PostgreSqlGenerationAdapter,
} from "../../packages/features/release-rollout/src/adapters/postgres-generation";

vi.mock("node:child_process", async (original) => ({
  ...(await original<typeof import("node:child_process")>()),
  spawnSync: vi.fn(),
}));
const spawnMock = vi.mocked(spawnSync);
const secret = "postgresql://user:password@private/db token=never-print";
const args = [
  "--host",
  "dpg-source",
  "--port",
  "5432",
  "--username",
  "postgres",
  "--dbname",
  "fixture",
  "--command",
  "SELECT 1",
];
const inventory = {
  version: 1,
  database: "fixture",
  sessionPrincipal: "postgres",
  roles: [],
  memberships: [],
  grants: [],
};
const success = (stdout: string) => ({
  pid: 1,
  status: 0,
  signal: null,
  output: [],
  stdout,
  stderr: secret,
});

beforeEach(() => {
  vi.stubEnv("PATH", "/usr/local/bin:/usr/bin:/bin");
  spawnMock.mockReset();
  spawnMock.mockImplementation((_binary, argv) => {
    if (argv?.[2] === "inspect") {
      const name = argv.at(-1)!;
      return success(`${name.replace("rr-retained-", "")}|none`);
    }
    return success(JSON.stringify(inventory));
  });
});
afterEach(() => vi.unstubAllEnvs());

function execute() {
  return managedPg17Fixture()
    .recoveryCommands("dpg-source")
    .execute("psql", args);
}

describe("recovery fixture bounded diagnostics", () => {
  it("runs the real inventory adapter with ambient CI secrets excluded", () => {
    vi.stubEnv("CI", "true");
    vi.stubEnv("PGPASSWORD", secret);
    vi.stubEnv("DATABASE_URL", secret);
    const fixture = managedPg17Fixture();
    expect(
      new PostgreSqlGenerationAdapter(
        fixture.recoveryCommands("dpg-source"),
      ).inventoryEffectivePrincipals(
        "postgresql://postgres:disposable@dpg-source/fixture",
      ),
    ).toMatchObject(inventory);
    const [binary, argv, options] = spawnMock.mock.calls[1]!;
    expect(binary).toBe("docker");
    expect(argv).toEqual([
      "--host",
      "unix:///var/run/docker.sock",
      "exec",
      "--env",
      "PGSSLMODE=disable",
      "--env",
      "PGGSSENCMODE=disable",
      "-i",
      expect.stringMatching(/^rr-retained-/),
      "psql",
      "-h",
      "127.0.0.1",
      "-p",
      "5432",
      "-U",
      "postgres",
      "-d",
      "fixture",
      "-XqAt",
      "-v",
      "ON_ERROR_STOP=1",
    ]);
    expect(options).toMatchObject({
      env: { PATH: "/usr/local/bin:/usr/bin:/bin", LANG: "C.UTF-8" },
      timeout: 30_000,
      maxBuffer: 16 * 1024 * 1024,
    });
    expect(Object.keys(options!.env!).sort()).toEqual(["LANG", "PATH"]);
  });

  it("identifies only PATH in CI-like decomposition and isolates the test before adapter calls", () => {
    vi.stubEnv(
      "PATH",
      "/work/node_modules/.pnpm/vitest@3.2.0/node_modules/.bin:/usr/bin",
    );
    vi.stubEnv("LANG", "unsafe fixture locale");
    const fixture = managedPg17Fixture();
    const adapter = new PostgreSqlGenerationAdapter(
      fixture.recoveryCommands("dpg-source"),
    );
    const url = "postgresql://postgres:disposable@dpg-source/fixture";
    const connection = decomposePostgresConnection(url);
    try {
      // Field-name-only diagnosis; no values, SQL or credentials in failures.
      const rejected = Object.entries(connection.env).flatMap(
        ([name, value]) => {
          try {
            assertSafeProcessBoundary("psql", [], { [name]: value });
            return [];
          } catch {
            return [name];
          }
        },
      );
      expect(rejected).toEqual(["PATH"]);
      expect(() =>
        assertSafeProcessBoundary("psql", connection.args),
      ).not.toThrow();
    } finally {
      connection.cleanup();
    }
    expect(() => adapter.inventoryEffectivePrincipals(url)).toThrow(
      "fixture_recovery_execute_failed:boundary:rejected",
    );
    expect(spawnMock).not.toHaveBeenCalled();
    // Same already-imported adapter and already-created fixture: decomposition
    // reads current PATH, not an import-time snapshot. Docker is independently fixed.
    vi.stubEnv("PATH", "/usr/local/bin:/usr/bin:/bin");
    expect(adapter.inventoryEffectivePrincipals(url)).toMatchObject(inventory);
    for (const call of spawnMock.mock.calls)
      expect(call[2]?.env).toEqual({
        PATH: "/usr/local/bin:/usr/bin:/bin",
        LANG: "C.UTF-8",
      });
    expect(spawnMock.mock.calls[1]![2]).toMatchObject({
      input: expect.any(String),
      timeout: 30_000,
      maxBuffer: 16 * 1024 * 1024,
    });
  });

  it("retains rejection of inherited PATH outside the safe grammar", () => {
    vi.stubEnv("PATH", "/tmp/unsafe path:/usr/bin");
    expect(() =>
      new PostgreSqlGenerationAdapter(
        managedPg17Fixture().recoveryCommands("dpg-source"),
      ).inventoryEffectivePrincipals(
        "postgresql://postgres:disposable@dpg-source/fixture",
      ),
    ).toThrow("fixture_recovery_execute_failed:boundary:rejected");
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("rejects explicit credentials and SQL secrets before Docker", async () => {
    for (const run of [
      () =>
        managedPg17Fixture()
          .recoveryCommands("dpg-source")
          .execute("psql", args, { env: { PGPASSWORD: secret } }),
      () =>
        managedPg17Fixture()
          .recoveryCommands("dpg-source")
          .execute("psql", [...args.slice(0, -1), secret]),
    ])
      expect(run).toThrow("fixture_recovery_execute_failed:boundary:rejected");
    const commands = managedPg17Fixture().recoveryCommands("dpg-source");
    for (const env of [
      { PATH: "/tmp/fixture@unsafe/bin" },
      { LANG: "C;fixture" },
      { PGPASSWORD: "fixture-only" },
    ]) {
      expect(() => commands.execute("psql", args, { env })).toThrow(
        "fixture_recovery_execute_failed:boundary:rejected",
      );
      await expect(
        commands.hashStdout("psql", args, { env }),
      ).rejects.toThrow();
    }
    await expect(
      commands.hashStdout("psql", [...args.slice(0, -1), secret]),
    ).rejects.toThrow();
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it.each([
    ["ETIMEDOUT", "timeout"],
    ["ENOBUFS", "output_limit"],
    ["ENOENT", "binary_missing"],
    ["EACCES", "permission_denied"],
    ["EPERM", "permission_denied"],
    [secret, "spawn_failed"],
  ])(
    "classifies bounded query failures without exposing child data",
    (code, category) => {
      spawnMock.mockImplementationOnce((_binary, argv) =>
        success(`${argv!.at(-1)!.replace("rr-retained-", "")}|none`),
      );
      spawnMock.mockImplementationOnce(() => ({
        ...success(secret),
        status: null,
        error: Object.assign(new Error(secret), { code }),
      }));
      try {
        execute();
        expect.fail("expected failure");
      } catch (error) {
        expect((error as Error).message).toBe(
          `fixture_recovery_execute_failed:query:${category}`,
        );
        expect((error as Error).cause).toBeUndefined();
        expect((error as Error).stack).not.toContain(secret);
      }
    },
  );

  it.each([
    [null, "SIGKILL", "signalled"],
    [1, null, "nonzero_exit"],
  ] as const)(
    "classifies process termination %s %s",
    (status, signal, category) => {
      spawnMock.mockImplementationOnce(() => ({
        ...success(secret),
        status,
        signal,
      }));
      expect(execute).toThrow(
        `fixture_recovery_execute_failed:identity:${category}`,
      );
    },
  );

  it.each(["wrong|none", "wrong|bridge"])(
    "rejects unowned or networked identity %s",
    (facts) => {
      spawnMock.mockReturnValueOnce(success(facts));
      expect(execute).toThrow(
        "fixture_recovery_execute_failed:identity:rejected",
      );
      expect(spawnMock).toHaveBeenCalledTimes(1);
    },
  );

  it("isolates seven fixture identities", () => {
    for (let i = 0; i < 7; i++) execute();
    const names = spawnMock.mock.calls
      .filter((call) => call[1]?.[2] === "inspect")
      .map((call) => call[1]!.at(-1));
    expect(new Set(names).size).toBe(7);
  });

  it("qualifies a libatomic1 fixture image on the pinned base before any offline container", () => {
    const calls: string[][] = [];
    let built = false;
    let buildInput = "";
    const run = (args: string[], input?: string | Buffer) => {
      calls.push(args);
      if (args[0] === "build") {
        built = true;
        buildInput = String(input);
        return { status: 0, stdout: "", stderr: "" };
      }
      if (args[0] === "image" && args[2] === pg17FixtureImage && !built)
        return { status: 1, stdout: "", stderr: "" };
      if (args[0] === "image" && args[2] === "--format")
        return {
          status: 0,
          stdout: `${/FROM (\S+)/.exec(buildInput)![1]}\n`,
          stderr: "",
        };
      return { status: 0, stdout: "ii", stderr: "" };
    };
    ensurePg17FixtureImage(run);
    expect(buildInput).toMatch(
      /^FROM postgres:17\.10@sha256:[a-f0-9]{64}\n[\s\S]*install -y --no-install-recommends libatomic1/u,
    );
    expect(calls.map((call) => call[0])).not.toContain("create");
    const proof = calls.find((call) => call[0] === "run")!;
    expect(proof).toEqual(
      expect.arrayContaining([
        "--network",
        "none",
        "--read-only",
        "libatomic1",
      ]),
    );
    expect(proof).toContain(pg17FixtureImage);
    expect(calls.findIndex((call) => call[0] === "build")).toBeLessThan(
      calls.findIndex((call) => call[0] === "run"),
    );
  });

  it.each(["valid", "wrong-base", "missing-libatomic"] as const)(
    "qualifies a parallel build winner (%s)",
    (outcome) => {
      const calls: string[][] = [];
      let buildAttempted = false;
      const run = (args: string[]) => {
        calls.push(args);
        if (args[0] === "build") {
          buildAttempted = true;
          return { status: 1, stdout: "", stderr: "image already exists" };
        }
        if (args[0] === "image" && args[2] === pg17FixtureImage)
          return { status: buildAttempted ? 0 : 1, stdout: "", stderr: "" };
        if (args[0] === "image" && args[2] === "--format")
          return {
            status: 0,
            stdout: outcome === "wrong-base" ? "wrong-base" : pg17BaseImage,
            stderr: "",
          };
        if (args[0] === "run" && outcome === "missing-libatomic")
          return { status: 1, stdout: "", stderr: "libatomic1 missing" };
        return { status: 0, stdout: "ii", stderr: "" };
      };
      if (outcome === "valid")
        expect(() => ensurePg17FixtureImage(run)).not.toThrow();
      else
        expect(() => ensurePg17FixtureImage(run)).toThrow(
          outcome === "wrong-base"
            ? "managed_pg17_fixture_image:base_label"
            : "managed_pg17_fixture_image:libatomic1",
        );
      expect(calls.filter((args) => args[0] === "build")).toHaveLength(1);
      expect(calls).toContainEqual([
        "image",
        "inspect",
        "--format",
        '{{ index .Config.Labels "reviewrouter.fixture.base" }}',
        pg17FixtureImage,
      ]);
      if (outcome !== "wrong-base")
        expect(calls.find((args) => args[0] === "run")).toContain("libatomic1");
    },
  );

  it("rejects a fixture image without libatomic1 with a bounded diagnostic", () => {
    const run = (args: string[]) =>
      args[0] === "run"
        ? {
            status: 1,
            stdout: "",
            stderr: "dpkg-query: no packages found matching libatomic1",
          }
        : { status: 0, stdout: pg17BaseImage, stderr: "" };
    expect(() => ensurePg17FixtureImage(run)).toThrow(
      /^managed_pg17_fixture_image:libatomic1:1:dpkg-query: no packages/u,
    );
  });

  it("reports a failed base inspection before building anything without claiming image absence", () => {
    const calls: string[][] = [];
    const run = (args: string[]) => {
      calls.push(args);
      return { status: 1, stdout: secret, stderr: secret };
    };
    expect(() => ensurePg17FixtureImage(run)).toThrow(
      /^managed_pg17_fixture_image:base_inspect:status=1:code=none:signal=none$/u,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual(["image", "inspect", pg17BaseImage]);
  });

  it.each(["ENOENT", "EACCES", "EAGAIN"])(
    "distinguishes base-inspect spawn failure %s without child output or cause text",
    (code) => {
      const run = vi.fn(() => ({
        status: null,
        signal: null,
        stdout: secret,
        stderr: secret,
        error: Object.assign(new Error(secret), { code }),
      }));
      expect(() => ensurePg17FixtureImage(run)).toThrow(
        new RegExp(
          `^managed_pg17_fixture_image:base_inspect:status=none:code=${code}:signal=none$`,
          "u",
        ),
      );
      expect(run).toHaveBeenCalledExactlyOnceWith([
        "image",
        "inspect",
        pg17BaseImage,
      ]);
    },
  );

  it("distinguishes a signalled base inspector without treating it as a missing image", () => {
    const run = vi.fn(() => ({
      status: null,
      signal: "SIGKILL" as const,
      stdout: secret,
      stderr: secret,
    }));
    expect(() => ensurePg17FixtureImage(run)).toThrow(
      /^managed_pg17_fixture_image:base_inspect:status=none:code=none:signal=SIGKILL$/u,
    );
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("rejects a contradictory successful status with a spawn error", () => {
    const run = vi.fn(() => ({
      status: 0,
      stdout: secret,
      stderr: secret,
      error: Object.assign(new Error(secret), { code: "EPERM" }),
    }));
    expect(() => ensurePg17FixtureImage(run)).toThrow(
      /^managed_pg17_fixture_image:base_inspect:status=0:code=EPERM:signal=none$/u,
    );
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("bounds unknown process facts without echoing arbitrary codes or signals", () => {
    const run = vi.fn(() => ({
      status: 1000,
      signal: secret as NodeJS.Signals,
      stdout: secret,
      stderr: secret,
      error: Object.assign(new Error(secret), { code: secret }),
    }));
    expect(() => ensurePg17FixtureImage(run)).toThrow(
      /^managed_pg17_fixture_image:base_inspect:status=other:code=other:signal=other$/u,
    );
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("rejects a cached fixture tag whose base label is wrong", () => {
    const run = (args: string[]) => ({
      status: 0,
      stdout: args[2] === "--format" ? "postgres:17.10@sha256:wrong" : "",
      stderr: "",
    });
    expect(() => ensurePg17FixtureImage(run)).toThrow(
      "managed_pg17_fixture_image:base_label",
    );
  });

  it("reports a failed build with a finite diagnostic", () => {
    const noisy = `${"x".repeat(5000)} E: Unable to locate package libatomic1`;
    const run = (args: string[]) =>
      args[0] === "build"
        ? { status: 100, stdout: "", stderr: noisy }
        : {
            status: args[2] === pg17FixtureImage ? 1 : 0,
            stdout: "",
            stderr: "",
          };
    let message = "";
    try {
      ensurePg17FixtureImage(run);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(
      /^managed_pg17_fixture_image:build:100:.*Unable to locate package libatomic1$/u,
    );
    expect(message.length).toBeLessThan(260);
  });

  it("surfaces a missing shared library of the copied Node as itself, not a timeout", () => {
    const loader =
      "node: error while loading shared libraries: libatomic.so.1: cannot open shared object file: No such file or directory";
    expect(() =>
      assertFixtureNodeRuns({ status: 127, stdout: "", stderr: loader }),
    ).toThrow(/^managed_pg17_node_runtime:127:.*libatomic\.so\.1/u);
    expect(() =>
      assertFixtureNodeRuns({ status: 127, stdout: "", stderr: loader }),
    ).not.toThrow(/timeout|wire_closed/u);
    expect(() =>
      assertFixtureNodeRuns({ status: 0, stdout: "v26.11.1", stderr: "" }),
    ).not.toThrow();
  });

  it("distinguishes connection and command validation", () => {
    const commands = managedPg17Fixture().recoveryCommands("dpg-source");
    expect(() =>
      commands.execute("psql", [
        ...args.slice(0, 1),
        "dpg-target",
        ...args.slice(2),
      ]),
    ).toThrow("fixture_recovery_execute_failed:connection:rejected");
    expect(() => commands.execute("psql", args.slice(0, -2))).toThrow(
      "fixture_recovery_execute_failed:command_form:rejected",
    );
  });
});
