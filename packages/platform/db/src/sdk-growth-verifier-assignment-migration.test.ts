import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(
    import.meta.dirname,
    "../prisma/migrations/000107_sdk_growth_verifier_assignment/migration.sql",
  ),
  "utf8",
);
const schema = readFileSync(
  resolve(import.meta.dirname, "../prisma/schema.prisma"),
  "utf8",
);

describe("000107 protected verifier assignment", () => {
  it("persists the exact execution and permits only revocation after creation", () => {
    expect(schema).toContain("model SdkGrowthVerifierAssignment {");
    expect(sql).toContain('"execution" JSONB NOT NULL');
    expect(sql).toContain(
      'ON "SdkGrowthVerifierAssignment" ("jobKey") WHERE "revokedAt" IS NULL',
    );
    expect(sql).toContain('"expiresAt" TIMESTAMPTZ(3) NOT NULL');
    expect(sql).toContain("INTERVAL '24 hours'");
    expect(sql).toContain('"revokedAt" TIMESTAMPTZ(3)');
    expect(sql).toContain('NEW."execution" IS DISTINCT FROM OLD."execution"');
    expect(sql).toContain('NEW."jobKey" IS DISTINCT FROM OLD."jobKey"');
    expect(sql).toContain('OLD."revokedAt" IS NOT NULL');
    expect(sql).toContain('BEFORE TRUNCATE ON "SdkGrowthVerifierAssignment"');
  });
});
