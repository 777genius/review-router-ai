import { describe, expect, it } from "vitest";
import * as canonical from "../packages/features/provider-usage/src/domain/usage";
import * as wire from "../packages/protocol-review-action-v2/src/generated/usage-v1";
import { fact } from "../packages/features/provider-usage/src/tests/fixture";

describe("managed usage v1 consumer compatibility", () => {
  it("preserves canonical acceptance, rejection and content hashing across the handoff", () => {
    const valid = fact({ serviceTier: "standard" });
    const inputs: unknown[] = [
      valid,
      { ...valid, secret: "must not cross boundary" },
      { ...valid, tokens: { ...valid.tokens, total: 131 } },
      { ...valid, priceSnapshot: { provider: "openai" } },
      { ...valid, identity: { ...valid.identity, occurredAt: "invalid" } },
    ];
    for (const input of inputs) {
      const accepts = (validate: typeof canonical.validateUsageFact) => {
        try {
          validate(input as canonical.UsageFact);
          return true;
        } catch {
          return false;
        }
      };
      expect(accepts(wire.validateUsageFact)).toBe(
        accepts(canonical.validateUsageFact),
      );
    }
    expect(() => wire.validateUsageFact(valid)).not.toThrow();
    expect(wire.canonicalJson(valid)).toBe(canonical.canonicalJson(valid));
  });
  it("carries exact signed partial coverage without permitting unsafe or unknown fields", () => {
    const valid = {
      schemaVersion: 1,
      revision: 1,
      state: "partial",
      reason: "spool_overflow",
      droppedEvents: 0,
      occurredAt: "2026-10-21T00:00:00.000Z",
    };
    expect(() => wire.validateUsageProducerCoverage(valid)).not.toThrow();
    for (const invalid of [
      { ...valid, revision: 0 },
      { ...valid, droppedEvents: -1 },
      { ...valid, reason: "provider_error" },
      { ...valid, secret: "bad" },
      { ...valid, occurredAt: "2026-10-21T00:00:00+00:00" },
    ]) {
      expect(() => wire.validateUsageProducerCoverage(invalid)).toThrow();
      expect(() => canonical.validateUsageProducerCoverage(invalid)).toThrow();
    }
  });
});
