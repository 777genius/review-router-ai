import { describe, expect, it, vi } from "vitest";
import {
  ConfirmInstalledGatewayReviewRepository,
  InstalledGatewayReviewConfirmationError,
  type PreparedInstalledGatewayReviewConfirmation,
} from "../application/confirm-installed-gateway-review-repository";

function fixture() {
  const order: string[] = [];
  const facts: Record<string, unknown>[] = [];
  const command = {
    workspaceId: "workspace",
    repositoryId: "repository",
    actor: "reviewrouter-operator",
    operatorAudit: {
      operatorId: "reviewrouter-operator",
      ownerUserId: "real-owner",
    },
  };
  const prepared: PreparedInstalledGatewayReviewConfirmation = {
    repository: "owner/repo",
    sourceCommitSha: "a".repeat(40),
    callerBlobSha: "b".repeat(40),
    actionCommitSha: "c".repeat(40),
    workflowPath: ".github/workflows/reviewrouter-review.yml",
    auditFacts: {
      scmBindingVersion: 2,
      setupAttemptId: null,
      policyRevision: "revision",
    },
    assertCurrent: vi.fn(async () => {
      order.push("current");
    }),
    provision: vi.fn(async () => {
      order.push("provision");
      return {
        status: "ready",
        outcome: "created",
        scmRepositoryIdentityId: "scm",
        authorityVersion: 1,
        authorityEpoch: "1",
        actionCommitSha: "c".repeat(40),
      } as const;
    }),
    confirmConfigured: vi.fn(async () => {
      order.push("configure");
      return { attemptId: "setup-attempt", revision: 1 };
    }),
  };
  const dependencies = {
    assertAuthorized: vi.fn(async () => {
      order.push("authorized");
    }),
    prepare: vi.fn(async () => {
      order.push("prepare");
      return prepared;
    }),
    nextAttemptId: () => "audit-attempt",
    audit: vi.fn(
      async (input: {
        stage: string;
        facts: Readonly<Record<string, unknown>>;
      }) => {
        order.push(`audit:${input.stage}`);
        facts.push({ ...input.facts });
      },
    ),
  };
  return {
    command,
    prepared,
    dependencies,
    order,
    facts,
    service: new ConfirmInstalledGatewayReviewRepository(dependencies),
  };
}

describe("installed-only Gateway confirmation", () => {
  it("retains a durable attempt before any operational write and returns only selected readiness", async () => {
    const f = fixture();
    const result = await f.service.confirm(f.command);
    expect(result).toMatchObject({
      status: "ready",
      outcome: "created",
      repositoryId: "repository",
      repository: "owner/repo",
      authorityEpoch: "1",
      attemptId: "setup-attempt",
      revision: 1,
    });
    expect(f.order).toEqual([
      "authorized",
      "prepare",
      "current",
      "audit:started",
      "authorized",
      "current",
      "provision",
      "authorized",
      "current",
      "configure",
      "audit:completed",
    ]);
    expect(f.dependencies.audit.mock.calls[0]?.[0]).toMatchObject({
      command: f.command,
      attemptId: "audit-attempt",
      stage: "started",
      facts: { scmBindingVersion: 2 },
    });
  });

  it("does not prepare or write anything without genuine host authorization", async () => {
    const f = fixture();
    f.dependencies.assertAuthorized.mockRejectedValueOnce(
      new Error("forbidden"),
    );
    await expect(f.service.confirm(f.command)).rejects.toThrow("forbidden");
    expect(f.dependencies.prepare).not.toHaveBeenCalled();
    expect(f.dependencies.audit).not.toHaveBeenCalled();
  });

  it("refuses a source/SCM-version conflict before any attempt or operational mutation", async () => {
    const f = fixture();
    vi.mocked(f.prepared.assertCurrent).mockRejectedValueOnce(
      new InstalledGatewayReviewConfirmationError(
        "installed_gateway_scope_changed",
      ),
    );
    expect(await f.service.confirm(f.command)).toEqual({
      status: "conflict",
      issue: "installed_gateway_scope_changed",
    });
    expect(f.dependencies.audit).not.toHaveBeenCalled();
    expect(f.prepared.provision).not.toHaveBeenCalled();
  });

  it("fails closed when the pre-effect attempt audit cannot persist", async () => {
    const f = fixture();
    f.dependencies.audit.mockRejectedValueOnce(
      new Error("storage unavailable"),
    );
    expect(await f.service.confirm(f.command)).toEqual({
      status: "blocked",
      issue: "installed_gateway_audit_unavailable",
    });
    expect(f.prepared.provision).not.toHaveBeenCalled();
    expect(f.prepared.confirmConfigured).not.toHaveBeenCalled();
  });

  it("rechecks live authorization after async verification and preserves the recorded attempt on revocation", async () => {
    const f = fixture();
    f.dependencies.assertAuthorized
      .mockImplementationOnce(async () => {})
      .mockRejectedValueOnce(new Error("revoked"));
    expect(await f.service.confirm(f.command)).toEqual({
      status: "blocked",
      issue: "installed_gateway_confirmation_failed",
    });
    expect(f.prepared.provision).not.toHaveBeenCalled();
    expect(f.order).toContain("audit:started");
    expect(f.facts.at(-1)).toMatchObject({
      phase: "preflight",
      mayHavePartialEffects: false,
    });
  });

  it("keeps disabled safety/legacy authority outcomes blocked without marking setup configured", async () => {
    const f = fixture();
    vi.mocked(f.prepared.provision).mockResolvedValueOnce({
      status: "blocked",
      issue: "gateway_review_v2_safety_blocked",
    });
    expect(await f.service.confirm(f.command)).toEqual({
      status: "blocked",
      issue: "gateway_review_v2_safety_blocked",
    });
    expect(f.prepared.confirmConfigured).not.toHaveBeenCalled();
    expect(f.facts.at(-1)).toMatchObject({
      phase: "provisioning",
      mayHavePartialEffects: true,
    });
  });

  it("reports a setup CAS failure honestly after authority provisioning and retains both audits", async () => {
    const f = fixture();
    vi.mocked(f.prepared.confirmConfigured).mockRejectedValueOnce(
      new InstalledGatewayReviewConfirmationError(
        "installed_gateway_scope_changed",
      ),
    );
    expect(await f.service.confirm(f.command)).toEqual({
      status: "conflict",
      issue: "installed_gateway_scope_changed",
    });
    expect(f.prepared.provision).toHaveBeenCalledOnce();
    expect(f.facts.at(-1)).toMatchObject({
      phase: "setup",
      mayHavePartialEffects: true,
    });
    expect(f.order.at(-1)).toBe("audit:failed");
  });

  it("does not reflect arbitrary provider/GitHub errors into response or audit", async () => {
    const f = fixture();
    vi.mocked(f.prepared.provision).mockRejectedValueOnce(
      new Error("secret raw upstream body"),
    );
    const result = await f.service.confirm(f.command);
    expect(result).toEqual({
      status: "blocked",
      issue: "installed_gateway_confirmation_failed",
    });
    expect(JSON.stringify([result, f.facts])).not.toContain(
      "secret raw upstream body",
    );
  });

  it("retains the existing restored authority result for idempotent installed confirmation", async () => {
    const f = fixture();
    vi.mocked(f.prepared.provision).mockResolvedValueOnce({
      status: "ready",
      outcome: "restored",
      scmRepositoryIdentityId: "scm",
      authorityVersion: 2,
      authorityEpoch: "1",
      actionCommitSha: "c".repeat(40),
    });
    expect(await f.service.confirm(f.command)).toMatchObject({
      status: "ready",
      outcome: "restored",
      authorityVersion: 2,
    });
  });
});
