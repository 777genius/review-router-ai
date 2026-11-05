import { ReviewInvestigationStateV1 as PrismaInvestigationState } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  assertPruneLimit,
  ExpiredPrivateMaterialCursorRange,
  groupPrivateMaterialCandidates,
  isTerminalPrismaInvestigationState,
  parseCanonicalCutoff,
  type ExpiredPrivateMaterialCandidate,
} from "../infrastructure/prisma/prisma-investigation-private-material-prune";

const cutoff = new Date("2026-11-05T12:00:00.000Z");

describe("investigation private-material prune helper parity", () => {
  it("groups candidates deterministically without duplicate obligations", () => {
    const candidates: readonly ExpiredPrivateMaterialCandidate[] = [
      {
        privateMaterialId: "material-b",
        investigationId: "investigation-a",
        obligationId: "obligation-z",
        expiresAt: cutoff,
        investigationState: PrismaInvestigationState.awaiting_turn,
      },
      {
        privateMaterialId: "material-a",
        investigationId: "investigation-a",
        obligationId: "obligation-z",
        expiresAt: cutoff,
        investigationState: PrismaInvestigationState.awaiting_turn,
      },
      {
        privateMaterialId: "material-d",
        investigationId: "investigation-b",
        obligationId: null,
        expiresAt: cutoff,
        investigationState: PrismaInvestigationState.concluded,
      },
      {
        privateMaterialId: "material-c",
        investigationId: "investigation-a",
        obligationId: "obligation-a",
        expiresAt: cutoff,
        investigationState: PrismaInvestigationState.awaiting_turn,
      },
    ];

    expect(groupPrivateMaterialCandidates(candidates)).toEqual([
      {
        investigationId: "investigation-a",
        investigationState: PrismaInvestigationState.awaiting_turn,
        privateMaterialIds: ["material-a", "material-b", "material-c"],
        obligationIds: ["obligation-a", "obligation-z"],
      },
      {
        investigationId: "investigation-b",
        investigationState: PrismaInvestigationState.concluded,
        privateMaterialIds: ["material-d"],
        obligationIds: [],
      },
    ]);
    expect(candidates[0]?.privateMaterialId).toBe("material-b");
  });

  it.each([
    PrismaInvestigationState.concluded,
    PrismaInvestigationState.inconclusive,
    PrismaInvestigationState.superseded,
    PrismaInvestigationState.expired,
  ])("allows safe terminal cleanup for %s", (state) => {
    expect(isTerminalPrismaInvestigationState(state)).toBe(true);
  });

  it.each([
    PrismaInvestigationState.provisional,
    PrismaInvestigationState.awaiting_turn,
    PrismaInvestigationState.turn_leased,
    PrismaInvestigationState.awaiting_critic,
  ])("requires aggregate reconciliation for %s", (state) => {
    expect(isTerminalPrismaInvestigationState(state)).toBe(false);
  });

  it("preserves the bounded batch admission and canonical UTC cutoff", () => {
    expect(() => assertPruneLimit(1)).not.toThrow();
    expect(() => assertPruneLimit(1000)).not.toThrow();
    for (const value of [0, -1, 1001, 1.5, NaN, Infinity]) {
      expect(() => assertPruneLimit(value)).toThrow(
        "investigation_prune_limit_invalid",
      );
    }
    expect(parseCanonicalCutoff(cutoff.toISOString(), "bad_cutoff")).toEqual(
      cutoff,
    );
    for (const value of [
      "2026-11-05",
      "2026-11-05T14:00:00+02:00",
      "invalid",
    ]) {
      expect(() => parseCanonicalCutoff(value, "bad_cutoff")).toThrow(
        "bad_cutoff",
      );
    }
    expect(ExpiredPrivateMaterialCursorRange.After).toBe("after");
    expect(ExpiredPrivateMaterialCursorRange.Through).toBe("through");
  });
});
