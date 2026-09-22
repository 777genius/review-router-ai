import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const path = resolve(
  import.meta.dirname,
  "../prisma/migrations/000105_sdk_growth_publication_effect/migration.sql",
);
const sql = readFileSync(path, "utf8");
const schema = readFileSync(
  resolve(import.meta.dirname, "../prisma/schema.prisma"),
  "utf8",
);

describe("000105 SDK growth publication effect migration", () => {
  it("pins the admitted migration bytes", () => {
    expect(createHash("sha256").update(sql).digest("hex")).toBe(
      "d92d4368cc20c5217cdeaf18f1abbeec7c98efd873fc91110c6178eb1739848f",
    );
  });

  it("adds durable immutable envelope, reconciliation and terminal evidence", () => {
    for (const field of [
      "envelopeDigest",
      "intent",
      "attemptStartedAt",
      "reconciliationCount",
      "lastEvidence",
      "outboxEventId",
      "completedAt",
    ]) {
      expect(sql).toContain(`"${field}"`);
      expect(schema).toMatch(new RegExp(`\\s${field}\\s`, "u"));
    }
    expect(sql).toContain("SdkGrowthPublicationEffect_shape_check");
    expect(sql).toContain(
      "publication identity or terminal evidence is immutable",
    );
    expect(sql).toContain(
      "legacy publication effects require operator reconciliation",
    );
  });
});
