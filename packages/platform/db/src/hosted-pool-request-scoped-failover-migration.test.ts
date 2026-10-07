import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(
    import.meta.dirname,
    "../prisma/migrations/000104_hosted_pool_request_scoped_failover/migration.sql",
  ),
  "utf8",
);

describe("000104 hosted pool request-scoped failover migration", () => {
  it("binds the one-time account switch to an unfinished request without a success fence", () => {
    expect(sql).toContain('ADD COLUMN "failoverRequestId" TEXT');
    expect(sql).toContain(
      'FOREIGN KEY ("failoverRequestId") REFERENCES "HostedCodexRelayRequest"("id")',
    );
    expect(sql).toContain('request."grantId" = OLD."id"');
    expect(sql).toContain("request.\"status\" IN ('received', 'processing')");
    expect(sql).toContain('request."successfulResponseStartedAt" IS NULL');
    expect(sql).not.toContain(
      'OLD."firstSuccessfulResponseAt" IS NOT NULL OR NEW."firstSuccessfulResponseAt" IS NOT NULL',
    );
  });

  it("keeps provenance null on issue and immutable outside the account switch", () => {
    expect(sql).toContain('NEW."failoverRequestId" IS NOT NULL');
    expect(sql).toContain(
      'NEW."failoverRequestId" IS DISTINCT FROM OLD."failoverRequestId"',
    );
    expect(sql).toContain("hosted_codex_grant_failover_evidence_invalid");
  });
});
