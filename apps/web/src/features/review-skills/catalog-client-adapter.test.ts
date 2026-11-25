import { beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.hoisted(() => vi.fn());
vi.mock("../../../app/dashboard/skill-catalog-actions", () => ({
  executeSkillCatalog: execute,
}));
import { requestSkillCatalog } from "./catalog-client-adapter";
import { skillCatalogKeys } from "./catalog-query-keys";

describe("catalog client transport", () => {
  beforeEach(() => vi.clearAllMocks());

  it("forwards the exact immutable command once; a lost reply stays uncertain", async () => {
    execute.mockRejectedValue(new TypeError("transport with secret details"));
    const command = {
      workspaceId: "workspace",
      candidateId: "candidate",
      operationId: "operation",
      mode: "ai" as const,
    };
    await expect(
      requestSkillCatalog("requestScan", command),
    ).rejects.toMatchObject({
      code: "unknown",
      message: expect.not.stringContaining("secret"),
    });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith({
      method: "requestScan",
      input: command,
    });
  });

  it("preserves a server rate-limit response for understandable retry feedback", async () => {
    execute.mockResolvedValue({
      status: "error",
      code: "rate_limited",
      message: "Try again in 10 seconds.",
      retryAfterSeconds: 10,
    });
    await expect(
      requestSkillCatalog("search", { workspaceId: "workspace" }),
    ).rejects.toMatchObject({ code: "rate_limited", retryAfterSeconds: 10 });
  });

  it("isolates scan results by account, workspace, candidate and selected analysis", () => {
    const original = skillCatalogKeys.scan(
      "viewer",
      "workspace",
      "candidate",
      "static",
      "job",
    );
    expect(
      skillCatalogKeys.scan("other", "workspace", "candidate", "static", "job"),
    ).not.toEqual(original);
    expect(
      skillCatalogKeys.scan("viewer", "other", "candidate", "static", "job"),
    ).not.toEqual(original);
    expect(
      skillCatalogKeys.scan("viewer", "workspace", "other", "static", "job"),
    ).not.toEqual(original);
    expect(
      skillCatalogKeys.scan("viewer", "workspace", "candidate", "ai", "job"),
    ).not.toEqual(original);
  });
});
