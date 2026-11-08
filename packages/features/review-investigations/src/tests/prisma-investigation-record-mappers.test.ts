import { describe, expect, it } from "vitest";
import {
  ReviewInvestigationRuntimeProfile,
  ReviewInvestigationState,
  ReviewInvestigationTurnPurpose,
  InvestigationTurnProviderKind,
} from "../domain/review-investigation-types";
import { ReviewInvestigationLeaseState } from "../domain/investigation-lease";
import {
  fromPrismaInvestigationState,
  fromPrismaRuntimeProfile,
  fromPrismaTurnPurpose,
  parseTerminalProviderKind,
  safeNumber,
  toPrismaInvestigationState,
  toPrismaRuntimeProfile,
  toPrismaTurnPurpose,
  toPrismaLeaseState,
} from "../infrastructure/prisma/prisma-investigation-record-mappers";

describe("investigation persistence projection parity", () => {
  it.each(Object.values(ReviewInvestigationState))(
    "round trips investigation state %s",
    (state) => {
      expect(
        fromPrismaInvestigationState(toPrismaInvestigationState(state)),
      ).toBe(state);
    },
  );

  it.each(Object.values(ReviewInvestigationRuntimeProfile))(
    "round trips immutable runtime profile %s",
    (profile) => {
      expect(fromPrismaRuntimeProfile(toPrismaRuntimeProfile(profile))).toBe(
        profile,
      );
    },
  );

  it.each(Object.values(ReviewInvestigationTurnPurpose))(
    "round trips turn purpose %s",
    (purpose) => {
      expect(fromPrismaTurnPurpose(toPrismaTurnPurpose(purpose))).toBe(purpose);
    },
  );

  it("maps revoked leases to their canonical persistence enum", () => {
    expect(toPrismaLeaseState(ReviewInvestigationLeaseState.Revoked)).toBe(
      "revoked",
    );
  });

  it("admits only known terminal provider identities", () => {
    expect(parseTerminalProviderKind(InvestigationTurnProviderKind.Codex)).toBe(
      InvestigationTurnProviderKind.Codex,
    );
    expect(
      parseTerminalProviderKind(InvestigationTurnProviderKind.ClaudeCode),
    ).toBe(InvestigationTurnProviderKind.ClaudeCode);
    expect(() => parseTerminalProviderKind("unknown")).toThrow(
      "investigation_terminal_provider_kind_invalid",
    );
  });

  it("rejects bigint projections outside the safe integer range", () => {
    expect(safeNumber(1n, "field")).toBe(1);
    expect(() => safeNumber(9007199254740992n, "field")).toThrow(
      "field_unsafe",
    );
  });
});
