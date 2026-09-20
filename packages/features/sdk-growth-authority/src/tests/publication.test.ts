import { describe, expect, it } from "vitest";
import type {
  AuthorityValidity,
  DeliveryClaim,
  EffectChange,
  EffectView,
  Observation,
  PublicationCheckGateway,
  PublicationEffectStore,
} from "../application/publication-ports";
import {
  buildPublicationSeed,
  runPublicationIntent,
  SDK_GROWTH_RECONCILIATION_LIMIT,
  validateEffectChange,
  validateEffectView,
  validatePublicationSeed,
} from "../application/publication";

const claim: DeliveryClaim = {
  eventId: "event-1",
  claimId: "claim-1",
  claimVersion: 1n,
  claimOwnerHash: "owner",
};

function seed(admitted = true) {
  return buildPublicationSeed({
    intentId: "intent-1",
    authority: {
      tenantId: "tenant-1",
      repositoryId: "authority-repository-1",
      pullRequest: 7,
      receiptFence: 1n,
      authorityEpoch: 2n,
      receiptDigest: "a".repeat(64),
    },
    repositoryId: "9007199254740991",
    installationId: "42",
    appId: "17",
    repositoryFullName: "owner/repo",
    headSha: "b".repeat(40),
    admitted,
    output: { title: "SDK authority", summary: "Receipt retained." },
    createdAt: 1_700_000_000_000,
  });
}

class FakeEffects implements PublicationEffectStore {
  effect: EffectView = {
    seed: seed(),
    state: "ready",
    attempt: null,
    lastObservation: null,
  };
  authority: AuthorityValidity = { kind: "current" };
  currentClaimId = claim.claimId;
  changes: EffectChange[] = [];

  async withClaim<T>(
    _intentId: string,
    incoming: DeliveryClaim,
    decide: Parameters<PublicationEffectStore["withClaim"]>[2],
  ): Promise<
    | { readonly kind: "committed"; readonly value: T }
    | { readonly kind: "stale-claim" }
  > {
    if (incoming.claimId !== this.currentClaimId) {
      return { kind: "stale-claim" };
    }
    const result = decide(this.effect, this.authority, 1_700_000_000_100) as {
      readonly change: EffectChange | null;
      readonly value: T;
    };
    if (result.change) {
      this.changes.push(result.change);
      this.apply(result.change);
    }
    return { kind: "committed", value: result.value };
  }

  private apply(change: EffectChange) {
    if (change.kind === "start") {
      this.effect = {
        ...this.effect,
        state: "sending",
        attempt: {
          id: change.attemptId,
          startedAt: 1_700_000_000_100,
          reconciliationCount: 0,
        },
      };
      return;
    }
    if (change.kind === "reconcile") {
      this.effect = {
        ...this.effect,
        state: "reconcile-required",
        attempt: {
          ...this.effect.attempt!,
          reconciliationCount: change.reconciliationCount,
        },
        lastObservation: change.observation,
      };
      return;
    }
    this.effect = {
      ...this.effect,
      state: change.outcome,
      attempt: this.effect.attempt
        ? {
            ...this.effect.attempt,
            reconciliationCount: change.reconciliationCount,
          }
        : null,
      lastObservation: change.evidence,
    };
  }
}

class FakeGateway implements PublicationCheckGateway {
  creates = 0;
  observations: Observation[] = [];
  onCreate: () => void = () => undefined;

  async create() {
    this.creates += 1;
    this.onCreate();
    return { kind: "acknowledged", checkRunId: "91" } as const;
  }

  async inspect() {
    return (
      this.observations.shift() ?? {
        kind: "absent",
        at: 1_700_000_000_200,
      }
    );
  }
}

describe("SDK growth publication application", () => {
  it("builds immutable deterministic success and failure envelopes", () => {
    const success = seed(true);
    const replay = seed(true);
    const failure = seed(false);

    expect(success).toEqual(replay);
    expect(success.check.conclusion).toBe("success");
    expect(failure.check.conclusion).toBe("failure");
    expect(success.check.externalId).toMatch(/^rr-sdk-growth-v1:[a-f0-9]{64}$/);
    expect(Object.isFrozen(success)).toBe(true);
    expect(Object.isFrozen(success.check.output)).toBe(true);
  });

  it.each(["0", "-1", "01", "1.5", "9007199254740992"])(
    "rejects unsafe or noncanonical numeric provider id %s",
    (appId) => {
      expect(() =>
        buildPublicationSeed({
          ...baseInput(),
          appId,
        }),
      ).toThrow();
    },
  );

  it("rejects an unknown persisted conclusion before rebuilding the envelope", () => {
    const valid = seed(false);
    const invalid = {
      ...valid,
      check: { ...valid.check, conclusion: "garbage" },
    } as unknown as typeof valid;

    expect(() => validatePublicationSeed(invalid)).toThrow(
      "check_conclusion_invalid",
    );
  });

  it("does not reopen terminal states", () => {
    const exact = {
      kind: "exact",
      checkRunId: "91",
      observedDigest: "c".repeat(64),
      at: 1,
    } as const;
    const terminal: EffectView = {
      seed: seed(),
      state: "applied",
      attempt: { id: "attempt-1", startedAt: 1, reconciliationCount: 1 },
      lastObservation: exact,
    };
    expect(() =>
      validateEffectChange(terminal, {
        kind: "reconcile",
        attemptId: "attempt-1",
        reconciliationCount: 2,
        observation: { kind: "absent", at: 2 },
      }),
    ).toThrow("terminal_state_cannot_reopen");
  });

  it("enforces exact terminal evidence pairings", () => {
    const sending: EffectView = {
      seed: seed(),
      state: "sending",
      attempt: { id: "attempt-1", startedAt: 1, reconciliationCount: 0 },
      lastObservation: null,
    };
    expect(() =>
      validateEffectChange(sending, {
        kind: "finish",
        attemptId: "attempt-1",
        reconciliationCount: 1,
        outcome: "applied",
        evidence: { kind: "absent", at: 2 },
      }),
    ).toThrow("applied_requires_exact");
    expect(() =>
      validateEffectChange(sending, {
        kind: "finish",
        attemptId: "attempt-1",
        reconciliationCount: 1,
        outcome: "not-applied",
        evidence: { kind: "unknown", reason: "transport", at: 2 },
      }),
    ).toThrow("not_applied_requires_no_effect");
    expect(() =>
      validateEffectChange(
        { ...sending, state: "ready", attempt: null },
        {
          kind: "finish",
          attemptId: null,
          reconciliationCount: 0,
          outcome: "superseded",
          evidence: { kind: "absent", at: 2 },
        },
      ),
    ).toThrow("superseded_requires_not_started");

    expect(() =>
      validateEffectChange(sending, {
        kind: "finish",
        attemptId: "attempt-1",
        reconciliationCount: 0,
        outcome: "superseded",
        evidence: { kind: "not-started", reason: "revoked", at: 2 },
      }),
    ).toThrow("superseded_requires_not_started");

    expect(() =>
      validateEffectChange(sending, {
        kind: "finish",
        attemptId: "attempt-1",
        reconciliationCount: 1,
        outcome: "invented",
        evidence: { kind: "unknown", reason: "transport", at: 2 },
      } as never),
    ).toThrow("terminal_outcome_invalid");
  });

  it("validates persisted state, attempt and evidence invariants", () => {
    expect(() =>
      validateEffectView({
        seed: seed(),
        state: "superseded",
        attempt: { id: "attempt-1", startedAt: 1, reconciliationCount: 0 },
        lastObservation: { kind: "not-started", reason: "revoked", at: 2 },
      }),
    ).toThrow("superseded_has_attempt");
    expect(() =>
      validateEffectView({
        seed: seed(),
        state: "reconcile-required",
        attempt: { id: "attempt-1", startedAt: 1, reconciliationCount: 1 },
        lastObservation: {
          kind: "exact",
          checkRunId: "91",
          observedDigest: "d".repeat(64),
          at: 2,
        },
      }),
    ).toThrow("reconcile_requires_uncertainty");
    expect(() =>
      validateEffectView({
        seed: seed(),
        state: "recovery-required",
        attempt: { id: "attempt-1", startedAt: 1, reconciliationCount: 1 },
        lastObservation: { kind: "absent", at: 2 },
      }),
    ).toThrow("reconciliation_budget_not_exhausted");
  });

  it("rejects open-ended persisted states and evidence", () => {
    expect(() =>
      validateEffectView({
        seed: seed(),
        state: "paused" as EffectView["state"],
        attempt: null,
        lastObservation: null,
      }),
    ).toThrow("effect_state_invalid");
    expect(() =>
      validateEffectView({
        seed: seed(),
        state: "reconcile-required",
        attempt: { id: "attempt-1", startedAt: 1, reconciliationCount: 1 },
        lastObservation: {
          kind: "unknown",
          reason: "elapsed" as "transport",
          at: 2,
        },
      }),
    ).toThrow("observation_reason_invalid");
  });

  it("persists one attempt, treats empty readback as uncertainty, then finds a late POST", async () => {
    const effects = new FakeEffects();
    const gateway = new FakeGateway();
    gateway.observations.push(
      { kind: "absent", at: 2 },
      {
        kind: "exact",
        checkRunId: "91",
        observedDigest: "d".repeat(64),
        at: 3,
      },
    );

    await expect(run(effects, gateway)).resolves.toBe("retry");
    expect(effects.effect.state).toBe("reconcile-required");
    expect(gateway.creates).toBe(1);

    await expect(run(effects, gateway)).resolves.toBe("applied");
    expect(gateway.creates).toBe(1);
    expect(effects.effect.state).toBe("applied");
  });

  it.each(["absent", "unknown"] as const)(
    "terminates unresolved %s reconciliation at the persisted budget",
    async (kind) => {
      const effects = new FakeEffects();
      const gateway = new FakeGateway();
      gateway.observations = Array.from(
        { length: SDK_GROWTH_RECONCILIATION_LIMIT },
        (_, index) =>
          kind === "absent"
            ? ({ kind, at: index + 2 } as const)
            : ({ kind, reason: "transport", at: index + 2 } as const),
      );

      for (let turn = 1; turn < SDK_GROWTH_RECONCILIATION_LIMIT; turn += 1) {
        await expect(run(effects, gateway)).resolves.toBe("retry");
      }
      await expect(run(effects, gateway)).resolves.toBe("recovery-required");

      expect(gateway.creates).toBe(1);
      expect(effects.effect).toMatchObject({
        state: "recovery-required",
        attempt: {
          id: "attempt-1",
          reconciliationCount: SDK_GROWTH_RECONCILIATION_LIMIT,
        },
        lastObservation: { kind },
      });
      expect(
        effects.changes
          .filter((change) => change.kind !== "start")
          .map((change) => change.reconciliationCount),
      ).toEqual(
        Array.from(
          { length: SDK_GROWTH_RECONCILIATION_LIMIT },
          (_, index) => index + 1,
        ),
      );
      await expect(run(effects, gateway)).resolves.toBe("recovery-required");
      expect(gateway.creates).toBe(1);
    },
  );

  it.each([{ status: 408 }, new Error("connection reset")])(
    "reconciles ambiguous dispatch without another POST",
    async (error) => {
      const effects = new FakeEffects();
      const gateway = new FakeGateway();
      gateway.onCreate = () => {
        throw error;
      };
      gateway.observations = [
        { kind: "unknown", reason: "transport", at: 2 },
        {
          kind: "exact",
          checkRunId: "91",
          observedDigest: "e".repeat(64),
          at: 3,
        },
      ];
      await expect(run(effects, gateway)).resolves.toBe("retry");
      await expect(run(effects, gateway)).resolves.toBe("applied");
      expect(gateway.creates).toBe(1);
    },
  );

  it("does not apply a stale worker response after claim replacement", async () => {
    const effects = new FakeEffects();
    const gateway = new FakeGateway();
    gateway.observations.push({
      kind: "exact",
      checkRunId: "91",
      observedDigest: "e".repeat(64),
      at: 3,
    });
    gateway.onCreate = () => {
      effects.currentClaimId = "replacement-claim";
    };

    await expect(run(effects, gateway)).resolves.toBe("stale-claim");
    expect(effects.effect.state).toBe("sending");
    expect(gateway.creates).toBe(1);
  });

  it("supersedes stale authority only before an attempt starts", async () => {
    const effects = new FakeEffects();
    effects.authority = { kind: "stale", reason: "revoked" };
    const gateway = new FakeGateway();

    await expect(run(effects, gateway)).resolves.toBe("superseded");
    expect(gateway.creates).toBe(0);
    expect(effects.effect.lastObservation).toMatchObject({
      kind: "not-started",
      reason: "revoked",
    });
  });
});

function baseInput() {
  return {
    intentId: "intent-1",
    authority: {
      tenantId: "tenant-1",
      repositoryId: "authority-repository-1",
      pullRequest: 7,
      receiptFence: 1n,
      authorityEpoch: 2n,
      receiptDigest: "a".repeat(64),
    },
    repositoryId: "1",
    installationId: "2",
    appId: "3",
    repositoryFullName: "owner/repo",
    headSha: "b".repeat(40),
    admitted: true,
    output: { title: "SDK authority", summary: "Receipt retained." },
    createdAt: 1_700_000_000_000,
  } as const;
}

function run(effects: FakeEffects, gateway: FakeGateway) {
  return runPublicationIntent({
    intentId: "intent-1",
    claim,
    effects,
    gateway,
    newAttemptId: () => "attempt-1",
    signal: new AbortController().signal,
  });
}
