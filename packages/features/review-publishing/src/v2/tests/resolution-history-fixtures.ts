import { createHash } from "node:crypto";
import {
  retiredLegacyWriterExecutorSetHash,
  retiredLegacyWriterQualificationProofHash,
  type RetiredLegacyWritersQuarantineQualification,
} from "../application/use-cases/activate-review-resolution-history";
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
/** Controlled retirement observations for disposable tests, never evidence about installed executors. */
export function controlledRetiredWriterProof(): RetiredLegacyWritersQuarantineQualification {
  const retiredAt = new Date(Date.now() - 2_000).toISOString();
  const executors = [
    {
      executorId: "controlled-retired-executor",
      binaryDigest: digest("controlled-old-binary"),
      retiredAt,
      acceptsNewRequests: false as const,
      restartable: false as const,
    },
  ];
  const facts = {
    qualificationSource: "retired_legacy_writers_quarantine.v1" as const,
    writerDigest: digest("controlled-new-writer"),
    scopeKind: "all_managed_legacy_resolution_writers" as const,
    inventoryComplete: true as const,
    retiredAt,
    executors,
    executorSetHash: retiredLegacyWriterExecutorSetHash(executors, digest),
    ingress: {
      observedAt: new Date(Date.now() - 1_000).toISOString(),
      oldExecutorIds: [],
    },
  };
  return {
    ...facts,
    proofHash: retiredLegacyWriterQualificationProofHash(facts, digest),
  };
}
