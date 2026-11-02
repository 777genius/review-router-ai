import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createPrismaClient,
  type PrismaClient,
} from "../packages/platform/db/src/index";
import {
  OutboxHandlerError,
  safeOutboxErrorSummary,
} from "../packages/features/outbox/src/domain/outbox-event";
import {
  describeProblems,
  permissionDeadLetterQuery,
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

  it("matches DB privilege errors in the post-deploy probe", () => {
    const postgresError = Object.assign(
      new Error("permission denied for table RepositoryConnection: private"),
      { code: "42501" },
    );
    expect(safeOutboxErrorSummary(postgresError)).toEqual({
      code: "db_permission_denied",
      summary: "outbox_database_permission_denied",
      retryable: true,
    });
    expect(permissionDeadLetterQuery).toContain(
      `"deadLetteredAt" > now() - interval '7 days'`,
    );
    expect(permissionDeadLetterQuery).toContain(
      `"lastErrorCode" = 'db_permission_denied'`,
    );
    expect(permissionDeadLetterQuery).toContain(
      `"safeLastErrorSummary" ilike '%permission denied%'`,
    );
    expect(permissionDeadLetterQuery).toContain(
      `"safeLastErrorSummary" ilike '%42501%'`,
    );
    expect(JSON.stringify(safeOutboxErrorSummary(postgresError))).not.toContain(
      "RepositoryConnection",
    );
  });

  it.each([
    Object.assign(new Error("private"), {
      code: "P2010",
      meta: { code: "42501" },
    }),
    Object.assign(new Error("private"), {
      cause: { code: "42501" },
    }),
    new Error("permission denied for schema private_tenant"),
    new Error("Raw query failed. Code: `42501`. Message: secret"),
    new Error("SQLSTATE 42501: database operation denied"),
  ])("classifies DB grant failures without leaking details", (error) => {
    expect(safeOutboxErrorSummary(error)).toMatchObject({
      code: "db_permission_denied",
      summary: "outbox_database_permission_denied",
      retryable: true,
    });
  });

  it("preserves permanent failures and distinguishes provider denials", () => {
    const error = new OutboxHandlerError(
      "permission denied for relation ReviewEvidence",
      "denied",
      false,
    );
    expect(safeOutboxErrorSummary(error)).toEqual({
      code: "db_permission_denied",
      summary: "outbox_database_permission_denied",
      retryable: false,
    });
    expect(
      safeOutboxErrorSummary(new Error("GitHub permission denied")),
    ).toEqual({
      code: "handler_error",
      summary: "outbox_handler_failure",
      retryable: true,
    });
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

const databaseUrl = process.env.REVIEW_ROUTER_TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase("runtime PostgreSQL dead-letter privilege probe", () => {
  let prisma: PrismaClient;
  const prefix = `privilege-probe-${randomUUID()}`;

  beforeAll(() => {
    prisma = createPrismaClient({ databaseUrl: databaseUrl!, poolMax: 3 });
  });

  afterAll(async () => {
    await prisma?.outboxEvent.deleteMany({
      where: { idempotencyKey: { startsWith: prefix } },
    });
    await prisma?.$disconnect();
  });

  it("matches current and legacy persisted dead letters", async () => {
    const now = new Date();
    const expired = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1_000);
    const fixtures = [
      {
        kind: "current",
        code: "db_permission_denied",
        summary: "outbox_database_permission_denied",
        at: now,
      },
      {
        kind: "legacy-text",
        code: "handler_error",
        summary: "permission denied for relation legacy_table",
        at: now,
      },
      {
        kind: "legacy-sqlstate",
        code: "handler_error",
        summary: "PostgreSQL error 42501",
        at: now,
      },
      {
        kind: "expired",
        code: "db_permission_denied",
        summary: "outbox_database_permission_denied",
        at: expired,
      },
      {
        kind: "unrelated",
        code: "handler_error",
        summary: "outbox_handler_failure",
        at: now,
      },
    ];
    for (const fixture of fixtures) {
      await prisma.outboxEvent.create({
        data: {
          type: `${prefix}.${fixture.kind}`,
          version: 1,
          idempotencyKey: `${prefix}.${fixture.kind}`,
          payload: {},
          status: "dead_letter",
          occurredAt: now,
          deadLetteredAt: fixture.at,
          lastErrorCode: fixture.code,
          safeLastErrorSummary: fixture.summary,
        },
      });
    }

    // The production release query itself must match rows in real PostgreSQL.
    // The SQL is an exported, fixed literal; no user input is interpolated.
    const rows = await prisma.$queryRawUnsafe<
      { type: string; count: number; latest: string }[]
    >(permissionDeadLetterQuery);
    const matches = new Map(
      rows
        .filter((row) => row.type.startsWith(`${prefix}.`))
        .map((row) => [row.type, row.count]),
    );
    expect(matches).toEqual(
      new Map([
        [`${prefix}.current`, 1],
        [`${prefix}.legacy-text`, 1],
        [`${prefix}.legacy-sqlstate`, 1],
      ]),
    );
  });
});
