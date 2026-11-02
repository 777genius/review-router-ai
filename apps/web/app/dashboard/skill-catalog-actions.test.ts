import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ReviewSkillsError,
  ReviewSkillsErrorCode,
} from "@reviewrouter/features-review-skills";
import { RateLimitExceededError } from "@reviewrouter/features-rate-limits";

const h = vi.hoisted(() => ({
  actor: vi.fn(),
  operation: vi.fn(),
  factory: vi.fn(),
  revalidate: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: h.revalidate }));
vi.mock("../../src/server/dashboard-mutations", () => ({
  getDashboardSignedInActor: h.actor,
}));
vi.mock("../../src/server/skill-catalog-composition", () => ({
  productionSkillCatalog: h.factory,
}));
import { executeSkillCatalog } from "./skill-catalog-actions";

describe("Skills catalog action authority and error boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.actor.mockResolvedValue({ userId: "session-user" });
    h.factory.mockResolvedValue({
      search: h.operation,
      importCandidate: h.operation,
      requestScan: h.operation,
    });
    h.operation.mockResolvedValue({
      items: [],
      page: 0,
      hasMore: false,
      limited: false,
      stale: false,
    });
  });

  it("injects the authenticated actor after client input and does not revalidate reads", async () => {
    const input = {
      workspaceId: "workspace",
      query: "review",
      actor: { userId: "forged-user" },
    };
    expect(
      await executeSkillCatalog({ method: "search", input }),
    ).toMatchObject({ status: "ok" });
    expect(h.operation).toHaveBeenCalledWith({
      workspaceId: "workspace",
      query: "review",
      actor: { userId: "session-user" },
    });
    expect(h.revalidate).not.toHaveBeenCalled();
  });

  it("refuses anonymous requests before composition or upstream calls", async () => {
    h.actor.mockResolvedValue(null);
    expect(
      await executeSkillCatalog({
        method: "search",
        input: { workspaceId: "workspace" },
      }),
    ).toMatchObject({ status: "error", code: "forbidden" });
    expect(h.factory).not.toHaveBeenCalled();
  });

  it("projects known rate rejection with retry timing without exposing quota identities", async () => {
    h.operation.mockRejectedValue(
      new RateLimitExceededError({
        allowed: false,
        key: "private-user-quota-key",
        limit: 3,
        remaining: 0,
        resetAt: new Date(Date.now() + 15_000),
      }),
    );
    const result = await executeSkillCatalog({
      method: "search",
      input: { workspaceId: "workspace" },
    });
    expect(result).toMatchObject({
      status: "error",
      code: "rate_limited",
      retryAfterSeconds: 15,
    });
    expect(JSON.stringify(result)).not.toContain("private-user-quota-key");
  });

  it("preserves an unknown outcome after a possible write and hides internal errors", async () => {
    h.operation.mockRejectedValue(
      new Error("database secret and internal stack"),
    );
    const result = await executeSkillCatalog({
      method: "requestScan",
      input: {
        workspaceId: "workspace",
        candidateId: "candidate",
        mode: "static",
        operationId: "operation",
      },
    });
    expect(result).toMatchObject({ status: "error", code: "unknown" });
    expect(JSON.stringify(result)).not.toContain("database secret");
  });

  it("keeps a known eligibility rejection distinct from an uncertain write", async () => {
    h.operation.mockRejectedValue(
      new ReviewSkillsError(ReviewSkillsErrorCode.Incomplete),
    );
    expect(
      await executeSkillCatalog({
        method: "requestScan",
        input: {
          workspaceId: "workspace",
          candidateId: "candidate",
          mode: "static",
          operationId: "operation",
        },
      }),
    ).toMatchObject({ status: "error", code: "incomplete" });
  });

  it("refreshes the library after an acknowledged import", async () => {
    h.operation.mockResolvedValue({ skillId: "imported-skill" });
    expect(
      await executeSkillCatalog({
        method: "importCandidate",
        input: {
          workspaceId: "workspace",
          candidateId: "candidate",
          scanId: "scan",
          mode: "static",
          acknowledgeWarnings: false,
          acknowledgeOmissions: false,
        },
      }),
    ).toMatchObject({ status: "ok", value: { skillId: "imported-skill" } });
    expect(h.revalidate).toHaveBeenCalledWith("/dashboard");
  });
});
