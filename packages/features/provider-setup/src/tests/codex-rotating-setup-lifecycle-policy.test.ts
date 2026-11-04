import { describe, expect, it } from "vitest";
import {
  admitSetupClaimReplay,
  assertSetupDispatchAllocationOrdinal,
  classifyAttemptNamespaceState,
  planSetupDispatchOutcome,
  sameExactWorkflowAttestation,
  SetupDispatchOutcomeDecision,
  setupClaimReplayDeadline,
} from "../domain/codex-rotating-setup-lifecycle";
import {
  CodexRotatingSetupManifestStatus,
  evaluateSetupManifestRecoveryAuthority,
} from "../domain/codex-rotating-setup-manifest-policy";

const now = new Date("2026-08-10T12:00:00.000Z");
const future = new Date("2026-08-10T12:10:00.000Z");

function outcome(
  input: Partial<Parameters<typeof planSetupDispatchOutcome>[0]> = {},
) {
  return planSetupDispatchOutcome({
    attempt: {
      attemptId: "attempt-1",
      status: "dispatch_authorized",
      dispatchExpiresAt: future,
    },
    confirmedAttemptId: null,
    outcome: "definite_success",
    now,
    ...input,
  });
}

describe("setup dispatch outcome precedence", () => {
  it("keeps ambiguous retirement terminal even after expiry", () => {
    const attempt = {
      attemptId: "attempt-1",
      status: "retired_ambiguous" as const,
      dispatchExpiresAt: now,
    };
    expect(outcome({ attempt, outcome: "unknown" })).toBe(
      SetupDispatchOutcomeDecision.ReturnRetired,
    );
    expect(() => outcome({ attempt })).toThrow(
      "codex_rotating_setup_namespace_retired",
    );
  });

  it("expires a confirmed replay before accepting its definite acknowledgement", () => {
    expect(
      outcome({
        attempt: {
          attemptId: "attempt-1",
          status: "confirmed",
          dispatchExpiresAt: now,
        },
      }),
    ).toBe(SetupDispatchOutcomeDecision.Expire);
    expect(
      outcome({
        attempt: {
          attemptId: "attempt-1",
          status: "confirmed",
          dispatchExpiresAt: future,
        },
      }),
    ).toBe(SetupDispatchOutcomeDecision.ReturnConfirmed);
  });

  it("requires retirement before exposing expiry of an authorized write", () => {
    expect(
      outcome({
        attempt: {
          attemptId: "attempt-1",
          status: "dispatch_authorized",
          dispatchExpiresAt: now,
        },
      }),
    ).toBe(SetupDispatchOutcomeDecision.RetireExpired);
  });

  it("preserves uncertainty without allowing another effect", () => {
    expect(outcome({ outcome: "unknown" })).toBe(
      SetupDispatchOutcomeDecision.RetireUnknown,
    );
    expect(() =>
      outcome({
        attempt: {
          attemptId: "attempt-1",
          status: "confirmed",
          dispatchExpiresAt: future,
        },
        outcome: "unknown",
      }),
    ).toThrow("codex_rotating_setup_attempt_already_confirmed");
  });

  it("confirms only this claim's current attempt", () => {
    expect(outcome()).toBe(SetupDispatchOutcomeDecision.Confirm);
    expect(outcome({ confirmedAttemptId: "attempt-1" })).toBe(
      SetupDispatchOutcomeDecision.Confirm,
    );
    expect(() => outcome({ confirmedAttemptId: "attempt-2" })).toThrow(
      "codex_rotating_setup_confirmation_conflict",
    );
  });
});

describe("setup replay and allocation policy", () => {
  it("checks active and terminal state before prepared-claim expiry", () => {
    expect(() =>
      admitSetupClaimReplay({
        status: "active",
        prepareReplayExpiresAt: now,
        now,
      }),
    ).toThrow("codex_rotating_setup_confirmation_stale_epoch");
    expect(() =>
      admitSetupClaimReplay({
        status: "retired_active",
        prepareReplayExpiresAt: now,
        now,
      }),
    ).toThrow("codex_rotating_setup_recovery_required");
    expect(() =>
      admitSetupClaimReplay({
        status: "prepared",
        prepareReplayExpiresAt: now,
        now,
      }),
    ).toThrow("codex_rotating_setup_payload_claim_expired");
    expect(() =>
      admitSetupClaimReplay({
        status: "confirmed_candidate",
        prepareReplayExpiresAt: now,
        now,
      }),
    ).not.toThrow();
  });

  it("bounds prepared replay by both the recovery deadline and fifteen minutes", () => {
    expect(setupClaimReplayDeadline(now, future).toISOString()).toBe(
      "2026-08-10T12:10:00.000Z",
    );
    expect(
      setupClaimReplayDeadline(
        now,
        new Date("2026-08-11T12:00:00.000Z"),
      ).toISOString(),
    ).toBe("2026-08-10T12:15:00.000Z");
  });

  it("rejects a fourth attempt before an inconsistent required ordinal", () => {
    expect(() => assertSetupDispatchAllocationOrdinal(4, 2)).toThrow(
      "codex_rotating_setup_attempt_limit",
    );
    expect(() => assertSetupDispatchAllocationOrdinal(3, 2)).toThrow(
      "codex_rotating_setup_retirement_conflict",
    );
    expect(() => assertSetupDispatchAllocationOrdinal(3, 3)).not.toThrow();
  });

  it("admits a retry only with the complete predispatch retirement pair", () => {
    const facts = {
      status: "retired_ambiguous" as const,
      namespaceStatus: "retired_predispatch",
      attemptRetiredAt: now,
      namespacePermanentlyRetired: true,
      namespaceRetiredAt: now,
    };
    expect(classifyAttemptNamespaceState(facts)).toBe("retired_predispatch");
    expect(() =>
      classifyAttemptNamespaceState({ ...facts, namespaceRetiredAt: null }),
    ).toThrow("codex_rotating_setup_retirement_conflict");
    expect(() =>
      classifyAttemptNamespaceState({
        ...facts,
        namespacePermanentlyRetired: false,
      }),
    ).toThrow("codex_rotating_setup_retirement_conflict");
  });
});

function recoveryFacts(): Parameters<
  typeof evaluateSetupManifestRecoveryAuthority
>[0] {
  return {
    recovery: { requestId: "recovery-request", epoch: 7n },
    provider: {
      mutationOwner: "recovery",
      mutationOwnerId: "setup-recovery:recovery-request",
      mutationEpoch: 7n,
    },
    active: null,
    recoveryRequest: {
      id: "recovery-row",
      mutationEpoch: 7n,
      databaseRecoveryWitness: "witness",
      mode: "forced_reseed",
      state: "active",
      latestManifestId: null,
    },
    activeRecoveryRequest: { id: "recovery-row" },
  };
}

function replayFacts(): Parameters<
  typeof evaluateSetupManifestRecoveryAuthority
>[0] {
  const facts = recoveryFacts();
  return {
    ...facts,
    provider: {
      mutationOwner: "setup",
      mutationOwnerId: "manifest-1",
      mutationEpoch: 8n,
    },
    active: {
      id: "manifest-1",
      status: CodexRotatingSetupManifestStatus.Issued,
      mutationEpoch: 8n,
      databaseRecoveryWitness: "witness",
    },
    recoveryRequest: {
      ...facts.recoveryRequest!,
      state: "manifest_issued",
      latestManifestId: "manifest-1",
    },
  };
}

describe("forced setup manifest recovery authority", () => {
  it("binds allocation to the recovery owner and its unchanged epoch", () => {
    expect(evaluateSetupManifestRecoveryAuthority(recoveryFacts())).toEqual({
      kind: "allocation",
      requestId: "recovery-request",
      epoch: 7n,
      databaseRecoveryWitness: "witness",
      manifestDatabaseRecoveryWitness: null,
    });
  });

  it("binds replay to the manifest's epoch exactly one above the recovery epoch", () => {
    expect(evaluateSetupManifestRecoveryAuthority(replayFacts())).toEqual({
      kind: "replay",
      requestId: "recovery-request",
      epoch: 7n,
      databaseRecoveryWitness: "witness",
      manifestDatabaseRecoveryWitness: "witness",
    });
    const facts = replayFacts();
    expect(() =>
      evaluateSetupManifestRecoveryAuthority({
        ...facts,
        active: { ...facts.active!, mutationEpoch: 7n },
      }),
    ).toThrow("codex_rotating_setup_recovery_required");
    expect(() =>
      evaluateSetupManifestRecoveryAuthority({
        ...facts,
        provider: { ...facts.provider, mutationEpoch: 7n },
        active: { ...facts.active!, mutationEpoch: 7n },
      }),
    ).toThrow("codex_rotating_setup_recovery_required");
  });

  it("reports a competing request before other invalid provider facts", () => {
    const facts = {
      ...recoveryFacts(),
      activeRecoveryRequest: { id: "foreign" },
      provider: {
        mutationOwner: "runtime",
        mutationOwnerId: "foreign",
        mutationEpoch: 99n,
      },
    };
    expect(() => evaluateSetupManifestRecoveryAuthority(facts)).toThrow(
      "codex_rotating_setup_recovery_request_conflict",
    );
    expect(() =>
      evaluateSetupManifestRecoveryAuthority({ ...facts, recovery: null }),
    ).toThrow("codex_rotating_setup_recovery_required");
  });

  it("does not replay a fetched manifest or reuse already consumed recovery authority", () => {
    const facts = replayFacts();
    expect(() =>
      evaluateSetupManifestRecoveryAuthority({
        ...facts,
        active: {
          ...facts.active!,
          status: CodexRotatingSetupManifestStatus.Fetched,
        },
      }),
    ).toThrow("codex_rotating_setup_recovery_required");
    expect(() =>
      evaluateSetupManifestRecoveryAuthority({
        ...facts,
        recoveryRequest: { ...facts.recoveryRequest!, state: "completed" },
      }),
    ).toThrow("codex_rotating_setup_recovery_already_used");
  });
});

it("requires every attestation identity field, including nested namespace scope", () => {
  const attestation = {
    repositoryId: "900001",
    workflowPath: ".github/workflows/reviewrouter-codex.yml",
    workflowSourceCommitSha: "a".repeat(40),
    workflowSourceBlobSha: "b".repeat(40),
    workflowSourceSha256: "c".repeat(64),
    workflowSemanticSha256: "d".repeat(64),
    workflowSchemaVersion: 5,
    sourceTrust: "trusted_default_branch_revision",
    secretNamespace: {
      namespaceId: "namespace-1",
      epoch: 8n,
      name: "SECRET_E8",
      scope: {
        repositoryId: "900001",
        providerInstanceId: "codex-rotating:900001",
      },
    },
  };
  expect(
    sameExactWorkflowAttestation(attestation, structuredClone(attestation)),
  ).toBe(true);
  expect(
    sameExactWorkflowAttestation(attestation, {
      ...attestation,
      workflowSourceBlobSha: "e".repeat(40),
    }),
  ).toBe(false);
  expect(
    sameExactWorkflowAttestation(attestation, {
      ...attestation,
      secretNamespace: { ...attestation.secretNamespace, epoch: 9n },
    }),
  ).toBe(false);
  expect(
    sameExactWorkflowAttestation(attestation, {
      ...attestation,
      secretNamespace: {
        ...attestation.secretNamespace,
        scope: {
          ...attestation.secretNamespace.scope,
          providerInstanceId: "codex-rotating:900002",
        },
      },
    }),
  ).toBe(false);
});
