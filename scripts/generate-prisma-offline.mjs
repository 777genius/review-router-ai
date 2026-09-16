#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { userInfo } from "node:os";
import { fileURLToPath } from "node:url";

export const forbiddenCredentialNames = [
  "SUBSCRIPTION_RUNTIME_DEPLOY_KEY_B64",
  "GIT_SSH_COMMAND",
  "GIT_SSH_VARIANT",
];

export function presentPrivateDependencyCredentials(env = process.env) {
  return forbiddenCredentialNames.filter(
    (name) => env[name] !== undefined && String(env[name]).trim() !== "",
  );
}

export function prismaGenerateArgs() {
  return ["--filter", "@reviewrouter/platform-db", "db:generate"];
}

function probe(command, args) {
  const result = spawnSync(command, args, { stdio: "ignore" });
  return !result.error && result.status === 0;
}

function isolationProbeArgs() {
  return ["--net", "--", process.execPath, "-e", "process.exit(0)"];
}

export function selectNetworkIsolator(env = process.env) {
  const platform =
    env.REVIEW_ROUTER_PRISMA_GENERATE_PLATFORM || process.platform;
  if (env.REVIEW_ROUTER_PRISMA_NETWORK_ALREADY_ISOLATED === "1") return "none";
  if (platform !== "linux") {
    if (env.REVIEW_ROUTER_REQUIRE_OFFLINE_PRISMA === "1")
      throw new Error(
        "offline Prisma generate requires Linux network isolation",
      );
    return "none";
  }

  const probeArgs = isolationProbeArgs();
  if (probe("unshare", probeArgs)) return "unshare";
  if (probe("sudo", ["-n", "unshare", ...probeArgs])) return "sudo-unshare";
  if (env.REVIEW_ROUTER_REQUIRE_OFFLINE_PRISMA === "1")
    throw new Error("offline Prisma generate could not isolate the network");
  console.error("warning: generating Prisma client without network isolation");
  return "none";
}

export function offlinePrismaGenerateInvocation(
  env = process.env,
  isolator = "unshare",
) {
  const pnpmArgs = prismaGenerateArgs();
  if (isolator === "none") return { command: "pnpm", args: pnpmArgs };
  if (isolator === "unshare")
    return {
      command: "unshare",
      args: ["--net", "--", "pnpm", ...pnpmArgs],
    };
  if (isolator === "sudo-unshare") {
    const username =
      env.REVIEW_ROUTER_PRISMA_GENERATE_USER || userInfo().username;
    return {
      command: "sudo",
      args: [
        "-n",
        "unshare",
        "--net",
        "--",
        "sudo",
        "-n",
        "-u",
        username,
        "-E",
        "--",
        "pnpm",
        ...pnpmArgs,
      ],
    };
  }
  throw new Error(`unknown Prisma generate isolator: ${isolator}`);
}

export function assertOfflinePrismaGenerateEnvironment(env = process.env) {
  const present = presentPrivateDependencyCredentials(env);
  if (present.length > 0)
    throw new Error(
      `prisma generate refused: ${present.join(", ")} still present`,
    );
}

function run() {
  try {
    assertOfflinePrismaGenerateEnvironment();
    const isolator = selectNetworkIsolator();
    const invocation = offlinePrismaGenerateInvocation(process.env, isolator);
    const childEnv = { ...process.env };
    for (const name of forbiddenCredentialNames) delete childEnv[name];
    const result = spawnSync(invocation.command, invocation.args, {
      env: childEnv,
      stdio: "inherit",
    });
    if (result.error) {
      console.error(result.error.message);
      process.exit(1);
    }
    if (result.signal) {
      console.error(`${invocation.command} terminated by ${result.signal}`);
      process.exit(1);
    }
    process.exit(result.status ?? 1);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
  run();
