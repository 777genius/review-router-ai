import { realpathSync } from "node:fs";
import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import {
  BASELINE_REVISION,
  LOOPBACK_HOSTNAMES,
  TEST_DATABASE_NAME,
  type CliOptions,
} from "./contracts.ts";

function argumentValue(
  args: readonly string[],
  name: string,
): string | undefined {
  const prefix = `${name}=`;
  const match = args.find((value) => value.startsWith(prefix));
  if (match) return match.slice(prefix.length);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function hasFlag(args: readonly string[], name: string): boolean {
  return args.includes(name);
}

export function parseCliOptions(
  argv: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): CliOptions {
  const args = argv.slice(2);
  const repoRoot = realpathSync(
    resolve(argumentValue(args, "--repo-root") ?? findRepoRoot(process.cwd())),
  );
  const runRoot = join(repoRoot, "tmp", "accounts-reference-e2e");
  const rawWorkDir =
    argumentValue(args, "--work-dir") ??
    join(
      runRoot,
      "runs",
      `run-${new Date().toISOString().replaceAll(":", "-")}`,
    );
  const workDir = resolve(repoRoot, rawWorkDir);
  const runRootResolved = resolve(runRoot);
  if (
    workDir !== runRootResolved &&
    !workDir.startsWith(`${runRootResolved}/`)
  ) {
    throw new Error(
      "accounts_reference_e2e_work_dir_must_be_under_repo_tmp_accounts_reference_e2e",
    );
  }

  const databaseUrl =
    argumentValue(args, "--database-url") ??
    env.ACCOUNTS_REFERENCE_E2E_TEST_DATABASE_URL ??
    null;
  const isolatedPglite = hasFlag(args, "--isolated-pglite");
  if (
    hasFlag(args, "--skill-catalog-fixture") &&
    (!hasFlag(args, "--skills-fixture") || isolatedPglite)
  ) {
    throw new Error(
      "skill_catalog_fixture_requires_skills_fixture_and_real_postgres",
    );
  }
  if (isolatedPglite && databaseUrl) {
    throw new Error("accounts_reference_e2e_choose_one_database_mode_not_both");
  }
  if (!isolatedPglite && !databaseUrl) {
    throw new Error(
      "accounts_reference_e2e_requires_explicit_test_database_url_or_isolated_pglite",
    );
  }
  if (databaseUrl) assertExplicitTestDatabaseUrl(databaseUrl);

  return {
    repoRoot,
    workDir,
    databaseUrl,
    isolatedPglite,
    keepFixtures: hasFlag(args, "--keep-fixtures"),
    runBrowserTests: !hasFlag(args, "--bootstrap-only"),
    expectedRevision:
      argumentValue(args, "--expected-revision") ?? BASELINE_REVISION,
    browserExecutable: argumentValue(args, "--browser-executable") ?? null,
  };
}

function findRepoRoot(start: string): string {
  let current = resolve(start);
  while (true) {
    if (existsSync(join(current, "pnpm-workspace.yaml"))) return current;
    const parent = dirname(current);
    if (parent === current) {
      throw new Error("accounts_reference_e2e_repo_root_not_found");
    }
    current = parent;
  }
}

export function assertExplicitTestDatabaseUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("accounts_reference_e2e_test_database_url_invalid");
  }
  if (!["postgresql:", "postgres:"].includes(url.protocol)) {
    throw new Error(
      "accounts_reference_e2e_test_database_url_protocol_invalid",
    );
  }
  if (!LOOPBACK_HOSTNAMES.has(url.hostname)) {
    throw new Error(
      "accounts_reference_e2e_test_database_url_must_be_loopback",
    );
  }
  if (url.pathname !== `/${TEST_DATABASE_NAME}`) {
    throw new Error(
      `accounts_reference_e2e_test_database_name_must_be_${TEST_DATABASE_NAME}`,
    );
  }
  if (url.username || url.password || url.search || url.hash) {
    const schemaOnly = url.searchParams.get("schema");
    if (
      !url.username ||
      url.searchParams.size !== 1 ||
      schemaOnly !== "public" ||
      url.hash
    ) {
      throw new Error("accounts_reference_e2e_test_database_url_shape_invalid");
    }
  }
  return url;
}

export function parsePositivePort(value: string | undefined): number | null {
  if (!value || !/^\d+$/u.test(value)) return null;
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port < 65_536 ? port : null;
}

export function isLoopbackUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      ["http:", "https:"].includes(url.protocol) &&
      LOOPBACK_HOSTNAMES.has(url.hostname)
    );
  } catch {
    return false;
  }
}

export function displaySafePath(value: string): string {
  return isAbsolute(value) ? value : resolve(value);
}
