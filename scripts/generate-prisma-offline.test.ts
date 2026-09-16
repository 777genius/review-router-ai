import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertOfflinePrismaGenerateEnvironment,
  offlinePrismaGenerateInvocation,
} from "./generate-prisma-offline.mjs";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("offline Prisma generate", () => {
  function createFakeTools() {
    const directory = mkdtempSync(
      join(tmpdir(), "reviewrouter-prisma-generate-test-"),
    );
    temporaryDirectories.push(directory);
    const capturePath = join(directory, "capture.json");
    writeFileSync(
      join(directory, "unshare"),
      [
        "#!/usr/bin/env node",
        'const { spawnSync } = require("node:child_process");',
        'const { writeFileSync } = require("node:fs");',
        "const separator = process.argv.indexOf('--');",
        "writeFileSync(process.env.CAPTURE_PATH, JSON.stringify({",
        "  unshareArgs: process.argv.slice(2),",
        "  deployKeyPresent: 'SUBSCRIPTION_RUNTIME_DEPLOY_KEY_B64' in process.env,",
        "  gitSshCommand: process.env.GIT_SSH_COMMAND ?? null,",
        "}));",
        "if (separator < 0) process.exit(1);",
        "const child = spawnSync(process.argv[separator + 1], process.argv.slice(separator + 2), {",
        "  env: process.env,",
        "  stdio: 'inherit',",
        "});",
        "process.exit(child.status ?? 1);",
      ].join("\n"),
    );
    writeFileSync(
      join(directory, "pnpm"),
      [
        "#!/usr/bin/env node",
        'const { existsSync, readFileSync, writeFileSync } = require("node:fs");',
        "const path = process.env.CAPTURE_PATH;",
        "let captured = {};",
        "try {",
        "  if (existsSync(path)) captured = JSON.parse(readFileSync(path, 'utf8'));",
        "} catch {}",
        "captured.pnpmArgs = process.argv.slice(2);",
        "captured.pnpmDeployKeyPresent = 'SUBSCRIPTION_RUNTIME_DEPLOY_KEY_B64' in process.env;",
        "captured.pnpmGitSshCommand = process.env.GIT_SSH_COMMAND ?? null;",
        "writeFileSync(path, JSON.stringify(captured));",
      ].join("\n"),
    );
    chmodSync(join(directory, "unshare"), 0o700);
    chmodSync(join(directory, "pnpm"), 0o700);
    return { capturePath, directory };
  }

  function runGenerate(
    directory: string,
    env: Record<string, string | undefined>,
  ) {
    const childEnv: Record<string, string | undefined> = {
      ...process.env,
      CAPTURE_PATH: join(directory, "capture.json"),
      PATH: `${directory}:${process.env.PATH ?? ""}`,
      REVIEW_ROUTER_PRISMA_GENERATE_PLATFORM: "linux",
    };
    for (const name of [
      "SUBSCRIPTION_RUNTIME_DEPLOY_KEY_B64",
      "GIT_SSH_COMMAND",
      "GIT_SSH_VARIANT",
    ])
      delete childEnv[name];
    for (const [name, value] of Object.entries(env)) {
      if (value === undefined) delete childEnv[name];
      else childEnv[name] = value;
    }
    return spawnSync(
      process.execPath,
      [join(process.cwd(), "scripts/generate-prisma-offline.mjs")],
      {
        encoding: "utf8",
        env: childEnv,
      },
    );
  }

  it("refuses to generate while deploy-key material remains", () => {
    expect(() =>
      assertOfflinePrismaGenerateEnvironment({
        SUBSCRIPTION_RUNTIME_DEPLOY_KEY_B64: "abc",
      }),
    ).toThrow(/SUBSCRIPTION_RUNTIME_DEPLOY_KEY_B64 still present/u);
    expect(() =>
      assertOfflinePrismaGenerateEnvironment({
        GIT_SSH_COMMAND: "ssh -i /tmp/key",
      }),
    ).toThrow(/GIT_SSH_COMMAND still present/u);
  });

  it("isolates Linux Prisma generate from the network", () => {
    expect(
      offlinePrismaGenerateInvocation(
        {
          REVIEW_ROUTER_PRISMA_GENERATE_PLATFORM: "linux",
        },
        "unshare",
      ),
    ).toEqual({
      command: "unshare",
      args: [
        "--net",
        "--",
        "pnpm",
        "--filter",
        "@reviewrouter/platform-db",
        "db:generate",
      ],
    });
  });

  it("drops back to the caller after privileged network isolation", () => {
    const invocation = offlinePrismaGenerateInvocation(
      {
        REVIEW_ROUTER_PRISMA_GENERATE_PLATFORM: "linux",
        REVIEW_ROUTER_PRISMA_GENERATE_USER: "runner",
        PATH: "/opt/pnpm:/usr/bin",
        HOME: "/home/runner",
        SUBSCRIPTION_RUNTIME_DEPLOY_KEY_B64: "must-not-forward",
      },
      "sudo-unshare",
      "/opt/pnpm/pnpm",
    );
    expect(invocation.command).toBe("sudo");
    expect(invocation.args.slice(0, 10)).toEqual([
      "-n",
      "unshare",
      "--net",
      "--",
      "sudo",
      "-n",
      "-u",
      "runner",
      "--",
      "env",
    ]);
    expect(invocation.args).toContain("PATH=/opt/pnpm:/usr/bin");
    expect(invocation.args.join("\n")).not.toContain(
      "SUBSCRIPTION_RUNTIME_DEPLOY_KEY_B64",
    );
    expect(invocation.args.slice(-4)).toEqual([
      "/opt/pnpm/pnpm",
      "--filter",
      "@reviewrouter/platform-db",
      "db:generate",
    ]);
  });

  it("skips unshare when the caller already isolated the network", () => {
    expect(
      offlinePrismaGenerateInvocation(
        {
          REVIEW_ROUTER_PRISMA_NETWORK_ALREADY_ISOLATED: "1",
        },
        "none",
      ),
    ).toEqual({
      command: "pnpm",
      args: ["--filter", "@reviewrouter/platform-db", "db:generate"],
    });
  });

  it("fails closed on non-Linux when offline isolation is required", () => {
    const { directory } = createFakeTools();
    const result = runGenerate(directory, {
      REVIEW_ROUTER_PRISMA_GENERATE_PLATFORM: "darwin",
      REVIEW_ROUTER_REQUIRE_OFFLINE_PRISMA: "1",
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Linux network isolation");
  });

  it("runs unprivileged Prisma generate without deploy-key material", () => {
    const { capturePath, directory } = createFakeTools();
    const result = runGenerate(directory, {
      SUBSCRIPTION_RUNTIME_DEPLOY_KEY_B64: undefined,
      GIT_SSH_COMMAND: undefined,
      GIT_SSH_VARIANT: undefined,
    });

    expect(result.status).toBe(0);
    expect(JSON.parse(readFileSync(capturePath, "utf8"))).toEqual({
      unshareArgs: [
        "--net",
        "--",
        join(directory, "pnpm"),
        "--filter",
        "@reviewrouter/platform-db",
        "db:generate",
      ],
      deployKeyPresent: false,
      gitSshCommand: null,
      pnpmArgs: ["--filter", "@reviewrouter/platform-db", "db:generate"],
      pnpmDeployKeyPresent: false,
      pnpmGitSshCommand: null,
    });
  });

  it("uses an already-isolated network without calling unshare", () => {
    const { capturePath, directory } = createFakeTools();
    const result = runGenerate(directory, {
      REVIEW_ROUTER_PRISMA_NETWORK_ALREADY_ISOLATED: "1",
    });

    expect(result.status).toBe(0);
    expect(JSON.parse(readFileSync(capturePath, "utf8"))).toEqual({
      pnpmArgs: ["--filter", "@reviewrouter/platform-db", "db:generate"],
      pnpmDeployKeyPresent: false,
      pnpmGitSshCommand: null,
    });
  });

  it("does not spawn pnpm when a parent deploy key is still set", () => {
    const { capturePath, directory } = createFakeTools();
    const result = runGenerate(directory, {
      SUBSCRIPTION_RUNTIME_DEPLOY_KEY_B64: "not-a-real-key",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "prisma generate refused: SUBSCRIPTION_RUNTIME_DEPLOY_KEY_B64 still present",
    );
    expect(existsSync(capturePath)).toBe(false);
  });

  it("keeps private-install consumers on the offline generate helper", () => {
    const ci = readFileSync(".github/workflows/ci.yml", "utf8");
    const migration = readFileSync(
      ".github/workflows/codex-rotating-release-migration.yml",
      "utf8",
    );
    const blueprint = readFileSync("render.yaml", "utf8");
    const dockerfile = readFileSync("deploy/self-hosted/Dockerfile", "utf8");
    const helper = "node scripts/generate-prisma-offline.mjs";
    expect(ci.match(new RegExp(helper, "gu"))).toHaveLength(3);
    expect(ci).not.toMatch(/run: pnpm db:generate/u);
    expect(ci).toContain('REVIEW_ROUTER_REQUIRE_OFFLINE_PRISMA: "1"');
    expect(readFileSync("package.json", "utf8")).toContain(
      '"db:generate:offline": "REVIEW_ROUTER_REQUIRE_OFFLINE_PRISMA=1 node scripts/generate-prisma-offline.mjs"',
    );
    expect(migration.match(new RegExp(helper, "gu"))).toHaveLength(2);
    expect(blueprint.match(new RegExp(helper, "gu"))).toHaveLength(2);
    expect(blueprint).toContain(
      "env -u SUBSCRIPTION_RUNTIME_DEPLOY_KEY_B64 -u GIT_SSH_COMMAND -u GIT_SSH_VARIANT node scripts/generate-prisma-offline.mjs",
    );
    expect(dockerfile).toContain("RUN --network=none");
    expect(dockerfile).toContain(
      "REVIEW_ROUTER_PRISMA_NETWORK_ALREADY_ISOLATED=1",
    );
    expect(dockerfile).toContain(helper);
    expect(dockerfile).not.toContain(
      "pnpm --filter @reviewrouter/platform-db db:generate",
    );
  });
});
