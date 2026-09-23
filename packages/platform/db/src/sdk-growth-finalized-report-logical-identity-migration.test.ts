import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(
    import.meta.dirname,
    "../prisma/migrations/000106_sdk_growth_finalized_report_logical_identity/migration.sql",
  ),
  "utf8",
);
const schema = readFileSync(
  resolve(import.meta.dirname, "../prisma/schema.prisma"),
  "utf8",
);

function model(name: string): string {
  return schema.split(`model ${name} {`)[1]!.split("\n}")[0]!;
}

describe("000106 SDK growth finalized report logical identity", () => {
  it("retires digest identity in favor of the logical report primary key", () => {
    expect(sql).toContain(
      'DROP CONSTRAINT "SdkGrowthFinalizedReportEvidence_digest_key"',
    );
    expect(sql).not.toContain("ADD CONSTRAINT");
    expect(model("SdkGrowthFinalizedReportEvidence")).not.toContain(
      "@@unique([evidenceId, reportDigest]",
    );
    expect(model("SdkGrowthFinalizedReportEvidence")).toMatch(
      /reportEvidenceId\s+String\s+@id/u,
    );
  });
});
