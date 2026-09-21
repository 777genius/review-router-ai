import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(
    import.meta.dirname,
    "../prisma/migrations/000103_sdk_growth_authority_custody/migration.sql",
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

function table(name: string): string {
  return sql.split(`CREATE TABLE "${name}" (`)[1]!.split("\n);")[0]!;
}

describe("000103 SDK growth authority custody migration parity", () => {
  it("keeps all six timestamps aligned with TIMESTAMPTZ(3) and SQL defaults", () => {
    const fields = [
      ["SdkGrowthAuthorityCustody", "createdAt", true],
      ["SdkGrowthAuthorityCustody", "completedAt", false],
      ["SdkGrowthPublicationEffect", "createdAt", true],
      ["SdkGrowthPublicationEffect", "updatedAt", true],
      ["SdkGrowthVerifierEvidence", "createdAt", true],
      ["SdkGrowthFinalizedReportEvidence", "createdAt", true],
    ] as const;
    for (const [modelName, field, hasDefault] of fields) {
      const declaration = model(modelName)
        .split("\n")
        .find((line) => new RegExp(`^\\s*${field}\\s`, "u").test(line));
      const sqlDeclaration = table(modelName)
        .split("\n")
        .find((line) => new RegExp(`^\\s*"${field}"\\s`, "u").test(line));
      expect(declaration, `${modelName}.${field}`).toContain(
        "@db.Timestamptz(3)",
      );
      expect(
        declaration?.includes("@default(now())"),
        `${modelName}.${field}`,
      ).toBe(hasDefault);
      expect(
        sqlDeclaration?.trim().replace(/,$/u, ""),
        `${modelName}.${field} SQL`,
      ).toBe(
        hasDefault
          ? `"${field}" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP`
          : `"${field}" TIMESTAMPTZ(3)`,
      );
    }
    expect(sql.match(/TIMESTAMPTZ\(3\)/gu)).toHaveLength(6);
    expect(
      sql.match(/TIMESTAMPTZ\(3\) NOT NULL DEFAULT CURRENT_TIMESTAMP/gu),
    ).toHaveLength(5);
  });

  it("matches SQL referential actions and publication update defaults", () => {
    expect(model("SdkGrowthPublicationEffect")).toContain(
      "onDelete: Restrict, onUpdate: Restrict",
    );
    expect(model("SdkGrowthFinalizedReportEvidence")).toContain(
      "onDelete: Restrict, onUpdate: Restrict",
    );
    expect(model("SdkGrowthPublicationEffect")).toMatch(
      /updatedAt\s+DateTime\s+@default\(now\(\)\) @updatedAt @db\.Timestamptz\(3\)/u,
    );
    expect(table("SdkGrowthPublicationEffect")).toContain(
      '"custodyId" TEXT PRIMARY KEY REFERENCES "SdkGrowthAuthorityCustody"("custodyId") ON DELETE RESTRICT ON UPDATE RESTRICT',
    );
    expect(table("SdkGrowthFinalizedReportEvidence")).toContain(
      '"evidenceId" TEXT NOT NULL REFERENCES "SdkGrowthVerifierEvidence"("evidenceId") ON DELETE RESTRICT ON UPDATE RESTRICT',
    );
  });

  it("persists pull request scope in verifier evidence and its execution index", () => {
    expect(model("SdkGrowthVerifierEvidence")).toMatch(/pullRequest\s+BigInt/u);
    expect(sql).toContain(
      '"pullRequest" BIGINT NOT NULL CHECK ("pullRequest" BETWEEN 1 AND 9007199254740991)',
    );
    expect(sql).toContain(
      'ON "SdkGrowthVerifierEvidence" ("tenantId", "repositoryId", "pullRequest", "runId", "runAttempt")',
    );
  });
});
