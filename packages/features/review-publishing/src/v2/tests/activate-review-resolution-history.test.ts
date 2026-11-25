import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  activateReviewResolutionHistory,
  isQualifiedResolutionWriterProof,
  type ResolutionWriterDrainQualification,
} from "../application/use-cases/activate-review-resolution-history";
import { controlledRetiredWriterProof } from "./resolution-history-fixtures";
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const scope = {
  workspaceId: "workspace",
  repositoryConnectionId: "connection",
  scmRepositoryIdentityId: "identity",
  pullRequestNumber: 1,
};
describe("distinct retired legacy writer quarantine qualification", () => {
  it("requires complete all-writer retirement, disabled restarts, and detached old ingress without claiming settled promises", () => {
    const proof = controlledRetiredWriterProof();
    expect(isQualifiedResolutionWriterProof(proof, new Date(), digest)).toBe(
      true,
    );
    for (const invalid of [
      {
        ...proof,
        qualificationSource: "managed_executor_handler_settlement.v1",
      },
      { ...proof, inventoryComplete: false },
      { ...proof, scopeKind: "this_repository_only" },
      { ...proof, proofHash: undefined },
      { ...proof, executorSetHash: "0".repeat(64) },
      {
        ...proof,
        ingress: {
          ...proof.ingress,
          oldExecutorIds: [proof.executors[0]!.executorId],
        },
      },
      {
        ...proof,
        executors: proof.executors.map((executor) => ({
          ...executor,
          restartable: true,
        })),
      },
    ])
      expect(
        isQualifiedResolutionWriterProof(
          invalid as unknown as ResolutionWriterDrainQualification,
          new Date(),
          digest,
        ),
      ).toBe(false);
  });
  it("keeps the connection draining when the source-owned infrastructure verifier cannot establish retirement", async () => {
    const activation = {
      beginDrain: vi.fn().mockResolvedValue(undefined),
      activate: vi.fn().mockResolvedValue(undefined),
    };
    const result = await activateReviewResolutionHistory(scope, {
      activation,
      writers: {
        async qualify() {
          return {
            status: "unqualified",
            reasonCode: "old_executor_restartability_unknown",
          };
        },
      },
    });
    expect(result).toEqual({
      status: "draining",
      reasonCode: "old_executor_restartability_unknown",
    });
    expect(activation.beginDrain).toHaveBeenCalledWith(scope);
    expect(activation.activate).not.toHaveBeenCalled();
  });
});
