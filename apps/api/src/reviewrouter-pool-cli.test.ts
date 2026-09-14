import { randomBytes } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  CODEX_DEVICE_AUTH_URL,
  executePoolCli,
  parseCodexDeviceAuthOutput,
  poolCliOptions,
  readPoolAuthFile,
  resolvePoolLoginAuthHome,
  type PoolLoginProcess,
} from "./reviewrouter-pool-cli";
import { executeReviewRouterOperatorCli } from "./reviewrouter-operator-cli";

const deviceAuthOutput = [
  `Visit ${CODEX_DEVICE_AUTH_URL} and enter the code:\n`,
  "ABCD-EFGHI\n",
].join("");

function fakeLoginProcess(
  chunks: string[] = [deviceAuthOutput],
  wait: () => Promise<number> = () => new Promise(() => {}),
): PoolLoginProcess {
  return {
    chunks: [...chunks],
    wait,
    kill: vi.fn(),
  };
}

describe("pool operator CLI", () => {
  it("uses existing profile credential and redirect-error transport", async () => {
    const credential = randomBytes(24).toString("base64url");
    const fetchImpl = vi.fn(async (_url, init) => {
      expect(init.redirect).toBe("error");
      expect(init.headers.authorization).toBe(`Bearer ${credential}`);
      return new Response(JSON.stringify({ result: { pool: null } }), {
        status: 200,
      });
    });
    expect(
      await executeReviewRouterOperatorCli(
        ["pool", "status", "--workspace", "my-workspace"],
        {
          REVIEW_ROUTER_API_URL: "https://operator.invalid",
          REVIEW_ROUTER_REVIEW_CONFIG_OPERATOR_CREDENTIAL: credential,
        },
        { fetchImpl: fetchImpl as typeof fetch },
      ),
    ).toEqual({ pool: null });
  });
  it("preserves partial bulk results and proceeds sequentially after failure", async () => {
    const events: string[] = [];
    const request = vi.fn(async (method, _path, body) => {
      if (method === "GET")
        return {
          repositories: ["a", "b", "c"].map((name) => ({
            fullName: `owner/${name}`,
            eligible: true,
            bindingRevision: 7,
          })),
        };
      events.push(body.repository);
      if (body.repository === "owner/b")
        throw new Error("fake-secret-never-reflect");
      return { status: "already_active" };
    });
    const result = await executePoolCli({
      command: "pool repositories connect",
      options: { workspace: "a", all: true },
      request,
    });
    expect(events).toEqual(["owner/a", "owner/b", "owner/c"]);
    expect(result).toMatchObject({ status: "partial_failure" });
    expect(JSON.stringify(result)).not.toContain("fake-secret");
  });
  it("distinguishes binding conflicts from partial bulk failures", async () => {
    const result = await executePoolCli({
      command: "pool repositories connect",
      options: { workspace: "a", all: true },
      request: async (method) => {
        if (method === "GET")
          return {
            repositories: [
              { fullName: "owner/a", eligible: true, bindingRevision: 1 },
            ],
          };
        throw new Error("hosted_pool_conflict");
      },
    });
    expect(result).toMatchObject({
      status: "partial_failure",
      results: [
        {
          repository: "owner/a",
          status: "conflict",
          code: "hosted_pool_conflict",
        },
      ],
    });
  });
  it("rereads after uncertain import without retry and wipes the source buffer", async () => {
    const bytes = Buffer.from("temporary-fake-auth");
    const request = vi.fn(async (method) => {
      if (method === "POST") throw new Error("temporary-fake-auth");
      return { accounts: [{ id: "account", generation: 4 }] };
    });
    const result = await executePoolCli({
      command: "pool accounts import",
      options: { workspace: "a", label: "primary", "auth-file": "fake" },
      request,
      readAuthFile: async () => bytes,
    });
    expect(result).toMatchObject({ status: "reconcile_required" });
    expect(request).toHaveBeenCalledTimes(2);
    expect(bytes.every((byte) => byte === 0)).toBe(true);
    expect(JSON.stringify(result)).not.toContain("temporary-fake-auth");
  });
  it("bounds local reads and returns safe errors", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "rr-pool-cli-"));
    try {
      const file = path.join(directory, "fake-auth.json");
      await writeFile(file, Buffer.alloc(1024 * 1024 + 1, 1));
      await expect(readPoolAuthFile(file)).rejects.toThrow(
        "hosted_pool_auth_file_invalid",
      );
      await writeFile(file, "fake-small-auth");
      expect((await readPoolAuthFile(file)).toString()).toBe("fake-small-auth");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it("dry run never mutates", async () => {
    const request = vi.fn(async () => ({
      repositories: [
        { fullName: "owner/a", eligible: true, bindingRevision: null },
      ],
    }));
    await executePoolCli({
      command: "pool repositories connect",
      options: { workspace: "a", all: true, "dry-run": true },
      request,
    });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith("GET", expect.any(String));
  });
  it("accepts login options and isolates the default Codex home", () => {
    expect(poolCliOptions("pool accounts login")).toEqual([
      "workspace",
      "profile",
      "api-url",
      "label",
      "auth-home",
    ]);
    const home = "/home/operator";
    const isolated = resolvePoolLoginAuthHome(undefined, home);
    expect(
      isolated.startsWith(`${home}/.reviewrouter/codex-homes/login-`),
    ).toBe(true);
    expect(isolated).not.toBe(`${home}/.codex`);
    expect(() => resolvePoolLoginAuthHome(`${home}/.codex`, home)).toThrow(
      "hosted_pool_auth_home_invalid",
    );
    expect(parseCodexDeviceAuthOutput(deviceAuthOutput)).toEqual({
      url: CODEX_DEVICE_AUTH_URL,
      code: "ABCD-EFGHI",
    });
  });
  it("prints the device URL and code, then imports only safe fields", async () => {
    const bytes = Buffer.from("temporary-fake-auth");
    const writes: string[] = [];
    const opened: string[] = [];
    const spawned: string[] = [];
    let ready = false;
    const request = vi.fn(async (_method, pathname, body) => {
      expect(pathname).toBe("/api/operator/v1/hosted-pool/accounts/import");
      expect(body).toEqual({
        workspace: "padelapp",
        label: "padel-oct",
        authBase64: Buffer.from("temporary-fake-auth").toString("base64"),
      });
      return {
        status: "imported",
        accountId: "account-1",
        generation: 1,
        refreshToken: "never-print",
      };
    });
    const process = fakeLoginProcess();
    const result = await executePoolCli({
      command: "pool accounts login",
      options: {
        workspace: "padelapp",
        label: "padel-oct",
        "auth-home": "/tmp/rr-isolated-codex",
      },
      request,
      readAuthFile: async (filename) => {
        expect(filename).toBe("/tmp/rr-isolated-codex/auth.json");
        return bytes;
      },
      homeDirectory: "/home/operator",
      login: {
        spawnCodexLogin: (authHome) => {
          spawned.push(authHome);
          return process;
        },
        openBrowser: async (url) => {
          opened.push(url);
        },
        sleep: async () => {
          ready = true;
        },
        now: () => 0,
        write: (text) => writes.push(text),
        ensureAuthHome: async () => {},
        isAuthReady: async () => ready,
        timeoutMs: 15 * 60 * 1000,
        pollIntervalMs: 3_000,
      },
    });
    expect(spawned).toEqual(["/tmp/rr-isolated-codex"]);
    expect(opened).toEqual([CODEX_DEVICE_AUTH_URL]);
    expect(writes.join("")).toContain(CODEX_DEVICE_AUTH_URL);
    expect(writes.join("")).toContain("ABCD-EFGHI");
    expect(writes.join("")).not.toContain("temporary-fake-auth");
    expect(result).toEqual({
      status: "imported",
      accountId: "account-1",
      generation: 1,
    });
    expect(JSON.stringify(result)).not.toContain("never-print");
    expect(JSON.stringify(result)).not.toContain("temporary-fake-auth");
    expect(bytes.every((byte) => byte === 0)).toBe(true);
    expect(process.kill).toHaveBeenCalled();
  });
  it("rejects a pre-existing auth.json before spawning Codex login", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "rr-pool-login-"));
    const spawnCodexLogin = vi.fn(() => fakeLoginProcess());
    const request = vi.fn();
    try {
      await writeFile(path.join(directory, "auth.json"), "stale-fake-auth");
      await expect(
        executePoolCli({
          command: "pool accounts login",
          options: {
            workspace: "a",
            label: "new-label",
            "auth-home": directory,
          },
          request,
          homeDirectory: "/home/operator",
          login: { spawnCodexLogin },
        }),
      ).rejects.toThrow("hosted_pool_auth_file_already_exists");
      expect(spawnCodexLogin).not.toHaveBeenCalled();
      expect(request).not.toHaveBeenCalled();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it("continues when the browser cannot open", async () => {
    const request = vi.fn(async () => ({
      status: "already_imported",
      accountId: "account-2",
      generation: 3,
    }));
    await expect(
      executePoolCli({
        command: "pool accounts login",
        options: { workspace: "a", label: "e2e-public-20260912" },
        request,
        readAuthFile: async () => Buffer.from("fake-small-auth"),
        homeDirectory: "/home/operator",
        login: {
          spawnCodexLogin: () => fakeLoginProcess(),
          openBrowser: async () => {
            throw new Error("xdg-open missing");
          },
          sleep: async () => {},
          now: () => 0,
          write: () => {},
          ensureAuthHome: async () => {},
          isAuthReady: async () => true,
        },
      }),
    ).resolves.toEqual({
      status: "already_imported",
      accountId: "account-2",
      generation: 3,
    });
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("times out without importing when auth.json never appears", async () => {
    let now = 0;
    const request = vi.fn();
    await expect(
      executePoolCli({
        command: "pool accounts login",
        options: { workspace: "a", label: "primary" },
        request,
        readAuthFile: async () => Buffer.from("never-read"),
        homeDirectory: "/home/operator",
        login: {
          spawnCodexLogin: () => fakeLoginProcess(),
          openBrowser: async () => {},
          sleep: async (ms) => {
            now += ms;
          },
          now: () => now,
          write: () => {},
          ensureAuthHome: async () => {},
          isAuthReady: async () => false,
          timeoutMs: 15 * 60 * 1000,
          pollIntervalMs: 3_000,
        },
      }),
    ).rejects.toThrow("hosted_pool_login_timeout");
    expect(request).not.toHaveBeenCalled();
    expect(now).toBeGreaterThanOrEqual(15 * 60 * 1000);
  });
  it("fails without importing when the login process exits nonzero", async () => {
    const request = vi.fn();
    await expect(
      executePoolCli({
        command: "pool accounts login",
        options: { workspace: "a", label: "primary" },
        request,
        readAuthFile: async () => Buffer.from("never-read"),
        homeDirectory: "/home/operator",
        login: {
          spawnCodexLogin: () => fakeLoginProcess([], async () => 1),
          openBrowser: async () => {},
          sleep: async () => {},
          now: () => 0,
          write: () => {},
          ensureAuthHome: async () => {},
          isAuthReady: async () => false,
        },
      }),
    ).rejects.toThrow("hosted_pool_login_failed");
    expect(request).not.toHaveBeenCalled();
  });
  it("imports after the login process exits 0 with a ready auth file", async () => {
    const request = vi.fn(async () => ({
      status: "imported",
      accountId: "account-3",
      generation: 1,
    }));
    await expect(
      executePoolCli({
        command: "pool accounts login",
        options: { workspace: "a", label: "primary" },
        request,
        readAuthFile: async () => Buffer.from("fake-small-auth"),
        homeDirectory: "/home/operator",
        login: {
          spawnCodexLogin: () => fakeLoginProcess([], async () => 0),
          openBrowser: async () => {},
          sleep: async () => {},
          now: () => 0,
          write: () => {},
          ensureAuthHome: async () => {},
          isAuthReady: async () => true,
        },
      }),
    ).resolves.toMatchObject({ status: "imported", accountId: "account-3" });
    expect(request).toHaveBeenCalledTimes(1);
  });
});
