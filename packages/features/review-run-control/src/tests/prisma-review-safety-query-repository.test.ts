import type { Prisma, PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { ResolveReviewSafetyPolicy } from "../application/use-cases/resolve-review-safety-policy";
import {
  PrismaReviewSafetyControlRepository,
  PrismaReviewSafetyQueryRepository,
} from "../infrastructure/prisma/prisma-review-safety-control-repository";
import {
  ReviewSafetyCapability,
  ReviewSafetyDecisionKind,
} from "../domain/review-run-control-types";

const now = new Date("2026-11-05T12:00:00.000Z");
const target = {
  workspaceId: "workspace-a",
  repositoryConnectionId: "repository-a",
  scmRepositoryIdentityId: "identity-a",
} as const;

function persistedRow() {
  return {
    policyScope: "global",
    workspaceId: null,
    repositoryConnectionId: null,
    scmRepositoryIdentityId: null,
    updatedAt: now,
    updatedBy: "operator-a",
  };
}

function transactionFixture(input: {
  policyReadFails?: boolean;
  emergencyReadFails?: boolean;
  emergencyStopped?: boolean;
} = {}) {
  const events: string[] = [];
  const policy = vi.fn(async () => {
    events.push("policy");
    if (input.policyReadFails) throw new Error("policy_read_unavailable");
    return [
      {
        ...persistedRow(),
        policyId: "policy-global",
        capability: "run_authorization_v2",
        version: 1,
        rolloutMode: "enabled",
      },
    ];
  });
  const selectors = vi.fn(async () => {
    events.push("selectors");
    return [];
  });
  const emergency = vi.fn(async () => {
    events.push("emergency");
    if (input.emergencyReadFails) throw new Error("emergency_read_unavailable");
    return [
      {
        ...persistedRow(),
        emergencyControlId: "emergency-global",
        version: 1,
        stopped: input.emergencyStopped ?? false,
        reason: "operator-control",
      },
    ];
  });
  const transaction = {
    reviewSafetyPolicy: { findMany: policy },
    reviewSafetyPolicySelector: { findMany: selectors },
    reviewSafetyEmergencyControl: { findMany: emergency },
  } as unknown as Pick<
    Prisma.TransactionClient,
    | "reviewSafetyPolicy"
    | "reviewSafetyPolicySelector"
    | "reviewSafetyEmergencyControl"
  >;
  const reader = new PrismaReviewSafetyQueryRepository(transaction);
  const resolver = new ResolveReviewSafetyPolicy({
    clock: { now: () => now },
    digest: {
      digestUtf8: async (value: string) =>
        createHash("sha256").update(value).digest("hex"),
    },
    policyQueries: reader,
    emergencyQueries: reader,
  });
  return { events, reader, resolver, policy, selectors, emergency };
}

describe("transaction-scoped review safety reader", () => {
  it("keeps the legacy Prisma constructor lazy", () => {
    const legacyRoot = new Proxy({} as PrismaClient, {
      get() {
        throw new Error("unexpected_prisma_delegate");
      },
    });
    expect(
      () => new PrismaReviewSafetyControlRepository(legacyRoot),
    ).not.toThrow();
  });

  it("reads safety using only the transaction delegates", async () => {
    const fixture = transactionFixture();
    const decision = await fixture.resolver.resolveReviewSafetyPolicy({
      decisionKind: ReviewSafetyDecisionKind.RunAuthorization,
      target,
    });

    expect(decision.effectAllowed).toBe(true);
    expect(decision.emergencyStopped).toBe(false);
    expect(decision.capabilityDecisions[0]?.capability).toBe(
      ReviewSafetyCapability.RunAuthorizationV2,
    );
    expect(fixture.policy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          capability: { in: ["run_authorization_v2"] },
          OR: expect.any(Array),
        }),
        orderBy: [{ policyScope: "asc" }, { policyId: "asc" }],
      }),
    );
    expect(fixture.selectors).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { policyId: { in: ["policy-global"] } },
        orderBy: [{ policyId: "asc" }, { selectorOrdinal: "asc" }],
      }),
    );
    expect(fixture.emergency).toHaveBeenCalledOnce();
    expect(fixture.events).toContain("policy");
    expect(fixture.events).toContain("emergency");

    // The new public object cannot grant a policy mutation by accident.
    expect("putReviewSafetyPolicy" in fixture.reader).toBe(false);
    expect("putReviewSafetyEmergencyControl" in fixture.reader).toBe(false);
    expect("$transaction" in fixture.reader).toBe(false);
  });

  it.each([
    ["policy", { policyReadFails: true }],
    ["emergency", { emergencyReadFails: true }],
  ] as const)("fails closed if the %s read fails", async (_label, input) => {
    const fixture = transactionFixture(input);
    const decision = await fixture.resolver.resolveReviewSafetyPolicy({
      decisionKind: ReviewSafetyDecisionKind.RunAuthorization,
      target,
    });
    expect(decision.effectAllowed).toBe(false);
    expect(decision.emergencyStopped).toBe(true);
    expect(decision.emergencyVersionVector).toContain("global:unreadable");
  });

  it("honors an emergency stop despite an allowed policy", async () => {
    const fixture = transactionFixture({ emergencyStopped: true });
    const decision = await fixture.resolver.resolveReviewSafetyPolicy({
      decisionKind: ReviewSafetyDecisionKind.RunAuthorization,
      target,
    });
    expect(decision.effectAllowed).toBe(false);
    expect(decision.emergencyStopped).toBe(true);
  });

  it("skips policy queries when there are no capabilities", async () => {
    const fixture = transactionFixture();
    await expect(
      fixture.reader.findApplicableReviewSafetyPolicies({
        target,
        capabilities: [],
      }),
    ).resolves.toEqual([]);
    expect(fixture.policy).not.toHaveBeenCalled();
    expect(fixture.selectors).not.toHaveBeenCalled();
  });
});
