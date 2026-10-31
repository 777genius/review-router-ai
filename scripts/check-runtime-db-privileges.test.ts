import { describe, expect, it } from "vitest";
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
      '"lastErrorCode" = \'db_permission_denied\'',
    );
    expect(permissionDeadLetterQuery).toContain(
      '"safeLastErrorSummary" ilike \'%permission denied%\'',
    );
    expect(permissionDeadLetterQuery).toContain(
      '"safeLastErrorSummary" ilike \'%42501%\'',
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
