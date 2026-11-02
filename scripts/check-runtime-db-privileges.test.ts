import { describe, expect, it } from "vitest";
import {
  describeProblems,
  requiredPrivileges,
} from "./check-runtime-db-privileges.mjs";

describe("runtime database privilege check", () => {
  it("reports nothing when every known privilege is present", () => {
    expect(
      describeProblems({
        role: "reviewrouter_worker",
        missing: [],
        permissionDeadLetters: [],
      }),
    ).toEqual([]);
  });

  it("names the missing privilege and the dead-lettered events", () => {
    expect(
      describeProblems({
        role: "reviewrouter_worker",
        missing: [{ table: "RepositoryConnection", privilege: "UPDATE" }],
        permissionDeadLetters: [
          {
            type: "installation.sync_requested",
            count: 3,
            latest: "2026-10-29",
          },
        ],
      }),
    ).toEqual([
      "reviewrouter_worker lacks UPDATE on RepositoryConnection",
      "3 dead-lettered installation.sync_requested event(s) failed with a permission error, latest 2026-10-29",
    ]);
  });

  it("covers the grants whose absence broke repository sync in production", () => {
    expect(requiredPrivileges.reviewrouter_worker).toContainEqual({
      table: "RepositoryConnection",
      privilege: "UPDATE",
    });
  });
});
import { spawnSync } from "node:child_process";

describe("runtime database privilege CLI", () => {
  function runCheck({
    role = "reviewrouter",
    expectedRole = "",
    missing = false,
    missingIdentity = false,
    unreadableOutbox = false,
  } = {}) {
    return spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import pg from "pg";
const fixture = JSON.parse(process.env.RR_PRIVILEGE_FIXTURE);
let probes = 0, outbox = 0, closed = false;
pg.Client = class {
  async connect() {}
  async query(sql, params) {
    if (sql === "select current_user as role") return { rows: [{ role: fixture.role }] };
    if (sql.startsWith("select has_")) {
      probes++;
      return { rows: [{ ok: !(fixture.missing && params[0] === 'public."RepositoryConnection"' && params[1] === "UPDATE") && !(fixture.missingIdentity && params[1] === "scmRepositoryIdentityId" && params[2] === "UPDATE") }] };
    }
    if (sql.includes('from "OutboxEvent"')) {
      outbox++;
      if (fixture.unreadableOutbox) throw new Error("fixture_outbox_unreadable");
      return { rows: [] };
    }
    throw new Error("unexpected_fixture_query");
  }
  async end() { closed = true; }
};
process.on("exit", () => console.log(JSON.stringify({ probes, outbox, closed })));
process.argv[1] = "-";
await import(process.env.RR_CHECKER_URL);`,
      ],
      {
        env: {
          ...process.env,
          DATABASE_URL: "postgresql://fixture@localhost/fixture",
          REVIEW_ROUTER_EXPECT_DB_ROLE: expectedRole,
          RR_PRIVILEGE_FIXTURE: JSON.stringify({
            role,
            missing,
            missingIdentity,
            unreadableOutbox,
          }),
          RR_CHECKER_URL: new URL(
            "./check-runtime-db-privileges.mjs",
            import.meta.url,
          ).href,
        },
        encoding: "utf8",
        timeout: 10_000,
      },
    );
  }

  it("checks all known worker privileges for the default shared self-hosted role", () => {
    const result = runCheck();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(
      "role reviewrouter: checked 7 known privilege(s)",
    );
    expect(result.stdout).toContain('{"probes":7,"outbox":1,"closed":true}');
  });

  it("reports a missing worker privilege on the default shared role", () => {
    const result = runCheck({ missing: true });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "reviewrouter lacks UPDATE on RepositoryConnection",
    );
  });

  it("preserves the dedicated worker policy", () => {
    const result = runCheck({
      role: "reviewrouter_worker",
      expectedRole: "reviewrouter_worker",
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('{"probes":7,"outbox":1,"closed":true}');
  });

  it("rejects an expected-role mismatch before any privilege or outbox query", () => {
    const result = runCheck({ expectedRole: "reviewrouter_worker" });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "expected database role reviewrouter_worker, got reviewrouter",
    );
    expect(result.stdout).toContain('{"probes":0,"outbox":0,"closed":true}');
  });

  it("keeps unknown roles fail-closed", () => {
    const result = runCheck({ role: "unqualified_runtime" });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "no privilege requirements for role unqualified_runtime",
    );
    expect(result.stdout).toContain('{"probes":0,"outbox":0,"closed":true}');
  });

  it("detects a missing identity-binding column despite other writable columns", () => {
    const result = runCheck({ missingIdentity: true });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "reviewrouter lacks UPDATE on RepositoryConnection.scmRepositoryIdentityId",
    );
  });

  it("fails rather than ignoring an unreadable outbox", () => {
    const result = runCheck({ unreadableOutbox: true });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("fixture_outbox_unreadable");
    expect(result.stdout).toContain('{"probes":7,"outbox":1,"closed":true}');
  });
});
