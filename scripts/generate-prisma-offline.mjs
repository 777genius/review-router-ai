#!/usr/bin/env node
import { spawnSync } from "node:child_process";
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

export function offlinePrismaGenerateInvocation(env = process.env) {
  const platform =
    env.REVIEW_ROUTER_PRISMA_GENERATE_PLATFORM || process.platform;
  const pnpmArgs = prismaGenerateArgs();
  if (platform !== "linux") {
    if (env.REVIEW_ROUTER_REQUIRE_OFFLINE_PRISMA === "1")
      throw new Error(
        "offline Prisma generate requires Linux network isolation",
      );
    return { command: "pnpm", args: pnpmArgs };
  }
  return {
    command: "unshare",
    args: ["--net", "--", "pnpm", ...pnpmArgs],
  };
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
    const invocation = offlinePrismaGenerateInvocation();
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
