#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const githubKnownHost =
  "github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl\n";

const requireDeployKeyFlag = "--require-deploy-key";
const installArguments = process.argv.slice(2);
const requireDeployKey = installArguments.includes(requireDeployKeyFlag);
const forwardedInstallArguments = installArguments.filter(
  (argument) => argument !== requireDeployKeyFlag,
);

const forbiddenCredentialNames = [
  "SUBSCRIPTION_RUNTIME_DEPLOY_KEY_B64",
  "GIT_SSH_COMMAND",
  "GIT_SSH_VARIANT",
];

const forbiddenPnpmConfigBasename =
  /^(?:\.npmrc|\.pnpmfile(?:\..*)?|pnpmfile\.(?:c?js|mjs|ts))$/iu;

const reviewedMinimumReleaseAgeExclusions = new Set([
  "@agent-teams/document-authoring@0.3.4",
  "@agent-teams/engineering-foundation@2.1.0",
  "@agent-teams/repository-mutation@0.4.0",
  "@get-modular/assembly@0.7.0",
  "@get-modular/conformance@0.5.0",
  "@get-modular/core@0.7.0",
  "@get-modular/resources@0.2.1",
]);

function validateDeployKeyInstallConfiguration() {
  const tracked = spawnSync("git", ["ls-files", "-z"], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (tracked.signal || tracked.status !== 0 || tracked.error)
    throw new Error("cannot validate tracked pnpm configuration");
  const paths = tracked.stdout.split("\0").filter(Boolean);
  if (
    paths.some((path) =>
      forbiddenPnpmConfigBasename.test(path.split("/").at(-1) ?? ""),
    )
  )
    throw new Error("tracked executable pnpm configuration is forbidden");
  if (!paths.includes("pnpm-workspace.yaml"))
    throw new Error("tracked pnpm-workspace.yaml is required");

  // This deliberately accepts only the repository's data-only workspace
  // grammar. Any new mapping, inline object, tag, anchor, interpolation, or
  // scalar setting must be reviewed before a deploy key may be exposed to
  // pnpm. In particular, pnpm hooks/configDependencies cannot be redirected.
  const workspaceLines = readFileSync("pnpm-workspace.yaml", "utf8").split(
    /\r?\n/u,
  );
  let section;
  let sawPackages = false;
  let sawAllowBuilds = false;
  for (const line of workspaceLines) {
    if (!line.trim() || /^\s*#/u.test(line)) continue;
    if (line === "verifyDepsBeforeRun: false") {
      section = undefined;
      continue;
    }
    const heading = /^([A-Za-z][A-Za-z0-9]*):\s*$/u.exec(line);
    if (heading) {
      section = heading[1];
      if (section === "packages") sawPackages = true;
      else if (section === "minimumReleaseAgeExclude") {
        // Only explicitly reviewed registry artifacts may bypass the age gate.
      } else if (section === "overrides") {
        // pnpm 11 moved overrides out of package.json. Only exact data-only
        // registry version pins are accepted while the deploy key is present.
      } else if (section === "allowBuilds") sawAllowBuilds = true;
      else throw new Error("pnpm-workspace executable configuration denied");
      continue;
    }
    if (section === "allowBuilds") {
      const match = /^ {2}"([^"]+)": true\s*$/u.exec(line);
      const reviewedBuilds = new Set([
        "@prisma/engines@7.8.0",
        "esbuild@0.28.1",
        "prisma@7.8.0",
        "@vioxen/subscription-runtime@https://codeload.github.com/777genius/ar/tar.gz/83a7329f4383b05ac5c39356b79f82f029182d42",
      ]);
      if (!match || !reviewedBuilds.has(match[1]))
        throw new Error("pnpm-workspace executable configuration denied");
      continue;
    }
    if (section === "minimumReleaseAgeExclude") {
      const match = /^ {2}- (["'])([^"']+)\1\s*$/u.exec(line);
      if (!match || !reviewedMinimumReleaseAgeExclusions.has(match[2]))
        throw new Error("pnpm-workspace executable configuration denied");
      continue;
    }
    if (section === "overrides") {
      if (
        !/^ {2}"[A-Za-z0-9@._/ >=<*-]+": "[0-9]+\.[0-9]+\.[0-9]+"\s*$/u.test(
          line,
        )
      )
        throw new Error("pnpm-workspace executable configuration denied");
      continue;
    }
    if (
      !section ||
      !/^ {2}- (?:"[A-Za-z0-9@._/*-]+"|[A-Za-z0-9@._/*-]+)\s*$/u.test(line)
    )
      throw new Error("pnpm-workspace executable configuration denied");
  }
  if (!sawPackages || !sawAllowBuilds)
    throw new Error("pnpm-workspace configuration is incomplete");
}

function runPnpm(args, env = process.env) {
  const result = spawnSync("pnpm", args, {
    env: { ...env, NODE_ENV: "development" },
    stdio: "inherit",
  });
  if (result.signal) {
    console.error(`pnpm ${args[0]} terminated by ${result.signal}`);
    return 1;
  }
  return result.status ?? 1;
}

function runPnpmInstall(env = process.env, disableScripts = false) {
  const args = ["install", ...forwardedInstallArguments];
  if (disableScripts) {
    for (const argument of ["--ignore-scripts", "--ignore-pnpmfile"])
      if (!args.includes(argument)) args.push(argument);
  }
  return runPnpm(args, env);
}

function clearPrivateDependencyCredentials(env) {
  for (const name of forbiddenCredentialNames) delete env[name];
}

const encodedKey = process.env.SUBSCRIPTION_RUNTIME_DEPLOY_KEY_B64?.trim();
if (!encodedKey) {
  if (requireDeployKey) {
    console.error("SUBSCRIPTION_RUNTIME_DEPLOY_KEY_B64 is required");
    process.exit(1);
  }
  process.exit(runPnpmInstall());
}

// Do not retain the encoded credential in this process environment after it
// has been copied into process-private memory for validation.
delete process.env.SUBSCRIPTION_RUNTIME_DEPLOY_KEY_B64;

const normalizedEncodedKey = encodedKey.replace(/\s+/gu, "");
if (
  normalizedEncodedKey.length % 4 !== 0 ||
  !/^[A-Za-z0-9+/]+={0,2}$/u.test(normalizedEncodedKey)
) {
  console.error("SUBSCRIPTION_RUNTIME_DEPLOY_KEY_B64 is not valid base64");
  process.exit(1);
}

const privateKey = Buffer.from(normalizedEncodedKey, "base64")
  .toString("utf8")
  .trim();
if (
  !privateKey.startsWith("-----BEGIN OPENSSH PRIVATE KEY-----") ||
  !privateKey.endsWith("-----END OPENSSH PRIVATE KEY-----")
) {
  console.error("SUBSCRIPTION_RUNTIME_DEPLOY_KEY_B64 is not an OpenSSH key");
  process.exit(1);
}

const sshDir = mkdtempSync(join(tmpdir(), "reviewrouter-private-dependency-"));
const keyPath = join(sshDir, "id_ed25519");
const knownHostsPath = join(sshDir, "known_hosts");
let teardownFailure;
let rebuildAfterTeardown = false;

try {
  validateDeployKeyInstallConfiguration();
  writeFileSync(keyPath, `${privateKey}\n`, { mode: 0o600 });
  writeFileSync(knownHostsPath, githubKnownHost, { mode: 0o600 });

  const keyValidation = spawnSync("ssh-keygen", ["-y", "-f", keyPath], {
    stdio: "ignore",
  });
  if (keyValidation.signal || keyValidation.status !== 0) {
    console.error(
      "SUBSCRIPTION_RUNTIME_DEPLOY_KEY_B64 is not a valid OpenSSH private key",
    );
    process.exitCode = 1;
  } else {
    const childEnv = { ...process.env };
    clearPrivateDependencyCredentials(childEnv);
    childEnv.GIT_SSH_COMMAND = [
      "ssh",
      `-i ${keyPath}`,
      "-o IdentitiesOnly=yes",
      `-o UserKnownHostsFile=${knownHostsPath}`,
      "-o StrictHostKeyChecking=yes",
    ].join(" ");

    // Fetch/link only. Arbitrary package lifecycle code must never execute in
    // the environment that carries the deploy-key-backed SSH command.
    process.exitCode = runPnpmInstall(childEnv, true);
    rebuildAfterTeardown = process.exitCode === 0;
  }
} finally {
  rmSync(sshDir, { force: true, recursive: true });
  clearPrivateDependencyCredentials(process.env);
  if (existsSync(sshDir) || existsSync(keyPath) || existsSync(knownHostsPath))
    teardownFailure = new Error(
      "private dependency credential teardown failed",
    );
  else if (
    forbiddenCredentialNames.some((name) => process.env[name] !== undefined)
  )
    teardownFailure = new Error(
      "private dependency credential environment survived",
    );
  else console.error("private dependency credential teardown verified");
}

if (teardownFailure) throw teardownFailure;

if (rebuildAfterTeardown) {
  // Reviewed native engines and allowBuilds may run now that the deploy key
  // and SSH material are gone.
  process.exitCode = runPnpm(["rebuild", "--ignore-pnpmfile"]);
}
