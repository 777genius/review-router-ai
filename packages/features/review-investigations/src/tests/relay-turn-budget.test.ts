import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalJson } from "../domain/canonicalization";
import {
  relayTurnBudgetCeilings,
  verifyRelayTurnBudget,
} from "../domain/relay-turn-budget";

const now = new Date("2026-09-28T10:00:00.000Z");
const expiresAt = new Date("2026-09-28T10:05:00.000Z");
const budget = {
  version: 1,
  ...relayTurnBudgetCeilings,
  deadline: "2026-09-28T10:04:00.000Z",
};
const digestUtf8 = async (value: string) =>
  createHash("sha256").update(value).digest("hex");

async function verify(value: unknown, hashOverride?: string) {
  const text = canonicalJson(value);
  return verifyRelayTurnBudget({
    canonicalJson: text,
    hash: hashOverride ?? (await digestUtf8(text)),
    digestUtf8,
    now,
    turnExpiresAt: expiresAt,
  });
}

describe("immutable relay turn budget admission", () => {
  it("accepts a bounded canonical budget", async () => {
    await expect(verify(budget)).resolves.toEqual(budget);
  });

  it("rejects a changed budget under the old hash", async () => {
    const originalHash = await digestUtf8(canonicalJson(budget));
    await expect(
      verify({ ...budget, maxRequests: 0 }, originalHash),
    ).rejects.toThrow("relay_turn_budget_limit_invalid");
    await expect(
      verify({ ...budget, maxOutputTokens: budget.maxOutputTokens - 1 }, originalHash),
    ).rejects.toThrow("relay_turn_budget_hash_mismatch");
  });

  it("rejects noncanonical, extra, late and excessive envelopes", async () => {
    const canonical = canonicalJson(budget);
    await expect(
      verifyRelayTurnBudget({
        canonicalJson: JSON.stringify(budget),
        hash: await digestUtf8(JSON.stringify(budget)),
        digestUtf8,
        now,
        turnExpiresAt: expiresAt,
      }),
    ).rejects.toThrow("relay_turn_budget_not_canonical");
    await expect(verify({ ...budget, model: "override" })).rejects.toThrow(
      "relay_turn_budget_invalid",
    );
    await expect(verify({ ...budget, maxRequests: 2 })).rejects.toThrow(
      "relay_turn_budget_limit_invalid",
    );
    await expect(
      verify({ ...budget, deadline: "2026-09-28T10:06:00.000Z" }),
    ).rejects.toThrow("relay_turn_budget_deadline_invalid");
    expect(canonical.length).toBeLessThan(2_048);
  });
});
