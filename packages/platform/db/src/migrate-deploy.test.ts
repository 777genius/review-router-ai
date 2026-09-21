import { describe, expect, it, vi } from "vitest";

// The production entrypoint remains plain ESM so migrations do not depend on a
// TypeScript runtime in deploy images.
import {
  assertSupportedPostgresVersion,
  migrateDeploy,
  postgresMajor,
} from "../scripts/migrate-deploy.mjs";

describe("migration deploy PostgreSQL preflight", () => {
  it("accepts PostgreSQL 17 and newer version numbers", () => {
    expect(postgresMajor("170010")).toBe(17);
    expect(assertSupportedPostgresVersion("170010")).toBe(17);
    expect(assertSupportedPostgresVersion("180000")).toBe(18);
  });

  it("rejects unsupported and malformed versions", () => {
    expect(() => assertSupportedPostgresVersion("150013")).toThrow(
      "reviewrouter_migrate_postgres_version_unsupported: required>=17 actual=15",
    );
    expect(() => postgresMajor("unknown")).toThrow(
      "reviewrouter_migrate_postgres_version_invalid",
    );
  });

  it("does not invoke Prisma when the target server is unsupported", async () => {
    const runMigration = vi.fn();

    await expect(
      migrateDeploy({
        databaseUrl: "postgresql://example.invalid/reviewrouter",
        inspectVersion: vi.fn().mockResolvedValue("150013"),
        runMigration,
      }),
    ).rejects.toThrow(
      "reviewrouter_migrate_postgres_version_unsupported: required>=17 actual=15",
    );
    expect(runMigration).not.toHaveBeenCalled();
  });

  it("runs Prisma only after a supported server is proven", async () => {
    const runMigration = vi.fn().mockResolvedValue(undefined);

    await migrateDeploy({
      databaseUrl: "postgresql://example.invalid/reviewrouter",
      inspectVersion: vi.fn().mockResolvedValue("170010"),
      runMigration,
    });

    expect(runMigration).toHaveBeenCalledOnce();
  });
});
