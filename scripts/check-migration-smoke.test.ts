import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const fixtureDirectories: string[] = [];
const invariantPrefix =
  "1|1|1|1|1|1|1|1|1|1|1|1|1|1|1|1|1|4|1|1|1|1|1|27|6|4|5|1|43|4|2|1|5|6|3|2|1|3|3|6|1|1|1|";

afterEach(() => {
  for (const directory of fixtureDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function runSmoke(
  roleCount: number,
  options: {
    invariant?: string;
    rollbackInvariant?: string;
    failDeploy?: boolean;
  } = {},
) {
  const directory = mkdtempSync(join(tmpdir(), "rr-migration-smoke-contract-"));
  fixtureDirectories.push(directory);
  const log = join(directory, "calls.jsonl");
  const invariant =
    options.invariant ??
    invariantPrefix + (roleCount === 2 ? "0|5" : "1|0");
  const rollbackInvariant =
    options.rollbackInvariant ??
    "pending_dispatch,dispatching,awaiting_authorization,dispatched,superseded|4|0|0|1";
  const stub = `#!${process.execPath}
const fs = require("node:fs");
const sql = fs.readFileSync(0, "utf8");
const binary = require("node:path").basename(process.argv[1]);
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ binary, args, sql, hasCredentialFile: !!process.env.REVIEW_ROUTER_DATABASE_URL_FILE && fs.existsSync(process.env.REVIEW_ROUTER_DATABASE_URL_FILE) }) + "\\n");
if (binary === "psql") {
  if (sql.includes("SELECT count(*) FROM pg_catalog.pg_roles WHERE rolname IN")) process.stdout.write(${JSON.stringify(String(roleCount))} + "\\n");
  else if (sql.includes("provider_scope_concurrency_operator_routines")) process.stdout.write(${JSON.stringify(invariant)} + "\\n");
  else if (sql.includes("AS leaked_types")) process.stdout.write(${JSON.stringify(rollbackInvariant)} + "\\n");
  if (args.join(" ").includes("000034_review_request_dispatch_reconciliation/migration.sql")) {
    process.stderr.write("review_requested_dispatching_migration_preflight\\n");
    process.exitCode = 1;
  }
}
if (binary === "pnpm" && args.includes("db:migrate:deploy") && ${options.failDeploy === true}) {
  process.stderr.write("raw-credential-must-not-appear\\n");
  process.exitCode = 1;
}
`;
  for (const binary of ["psql", "pnpm"]) {
    const path = join(directory, binary);
    writeFileSync(path, stub);
    chmodSync(path, 0o755);
  }
  const result = spawnSync(
    process.execPath,
    ["scripts/check-migration-smoke.mjs"],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PATH: `${directory}:${process.env.PATH ?? ""}`,
        DATABASE_URL:
          "postgresql://smoke:disposable@127.0.0.1:1/fixture?schema=public",
      },
      encoding: "utf8",
      timeout: 30_000,
    },
  );
  const calls = readdirSync(directory).includes("calls.jsonl")
    ? readFileSync(log, "utf8")
        .trim()
        .split("\n")
        .map(
          (line) =>
            JSON.parse(line) as {
              binary: string;
              args: string[];
              sql: string;
              hasCredentialFile: boolean;
            },
        )
    : [];
  return { result, calls };
}

describe("migration smoke release owner handoff", () => {
  it("uses the checked-in before-87 handoff when the CI release pair exists", () => {
    const { result, calls } = runSmoke(2);
    expect(result.status, result.stderr).toBe(0);
    const sql = calls
      .filter((call) => call.binary === "psql")
      .map((call) => call.sql);
    const pnpm = calls.filter((call) => call.binary === "pnpm");
    expect(
      sql.some((command) =>
        command.includes("disposable_fresh_database_catalog_invalid"),
      ),
    ).toBe(true);
    expect(
      sql.some((command) =>
        command.includes(
          "ALTER SCHEMA public OWNER TO reviewrouter_release_schema_owner",
        ),
      ),
    ).toBe(true);
    expect(
      sql.some((command) =>
        command.includes("disposable_full_chain_verification_failed"),
      ),
    ).toBe(true);
    expect(pnpm).toHaveLength(2);
    expect(pnpm[0]?.args).toContain("--config");
    expect(pnpm[1]?.args).toContain("db:migrate:deploy");
    expect(pnpm.every((call) => call.hasCredentialFile)).toBe(true);
    const before87 = calls.findIndex(
      (call) => call.binary === "pnpm" && call.args.includes("--config"),
    );
    const handoff = calls.findIndex((call) =>
      call.sql.includes(
        "ALTER SCHEMA public OWNER TO reviewrouter_release_schema_owner",
      ),
    );
    const fullDeploy = calls.findIndex(
      (call) => call.binary === "pnpm" && call.args.includes("db:migrate:deploy"),
    );
    expect(before87 < handoff && handoff < fullDeploy).toBe(true);
    expect(
      calls.some((call) =>
        call.args
          .join(" ")
          .includes("000034_review_request_dispatch_reconciliation/migration.sql"),
      ),
    ).toBe(true);
    expect(
      sql.filter((command) => command.startsWith("DROP DATABASE IF EXISTS")),
    ).toHaveLength(2);
  });

  it("keeps the direct dev path when the release pair is absent", () => {
    const { result, calls } = runSmoke(0);
    expect(result.status, result.stderr).toBe(0);
    expect(calls.filter((call) => call.binary === "pnpm")).toHaveLength(1);
    expect(
      calls.some((call) => call.sql.includes("ALTER SCHEMA public OWNER TO")),
    ).toBe(false);
  });

  it("rejects an incomplete cluster role pair and still drops the smoke database", () => {
    const { result, calls } = runSmoke(1);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("migration_smoke_release_role_catalog_incomplete");
    expect(calls.filter((call) => call.binary === "pnpm")).toHaveLength(0);
    expect(
      calls.some((call) => call.sql.startsWith("DROP DATABASE IF EXISTS")),
    ).toBe(true);
  });

  it("rejects the dev invariant on the release-pair path and drops the smoke database", () => {
    const { result, calls } = runSmoke(2, {
      invariant: `${invariantPrefix}1|0`,
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Migrated schema invariants failed");
    expect(result.stderr).not.toContain("disposable@127.0.0.1");
    expect(
      calls.filter((call) => call.sql.startsWith("DROP DATABASE IF EXISTS")),
    ).toHaveLength(1);
  });

  it("drops both databases after rollback invariant failure", () => {
    const { result, calls } = runSmoke(2, { rollbackInvariant: "invalid" });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "Dispatch migration preflight did not roll back atomically",
    );
    expect(
      calls.filter((call) => call.sql.startsWith("DROP DATABASE IF EXISTS")),
    ).toHaveLength(2);
  });

  it("sanitizes a deploy failure and drops the smoke database", () => {
    const { result, calls } = runSmoke(2, { failDeploy: true });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("release_migration_step_failed");
    expect(result.stderr).not.toContain("raw-credential-must-not-appear");
    expect(
      calls.filter((call) => call.sql.startsWith("DROP DATABASE IF EXISTS")),
    ).toHaveLength(1);
  });
});
