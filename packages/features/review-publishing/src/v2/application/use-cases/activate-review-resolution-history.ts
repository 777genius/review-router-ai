import type { ReviewPublicationScope } from "../../domain/review-publication-attempt";
import { canonicalReviewPublicationJson } from "../../domain/canonical-review-publication-json";

/** Qualification comes from the actual managed deployment executor, never an HTTP socket or idle counter. */
export type ManagedResolutionWriterDrainQualification = Readonly<{
  writerDigest: string;
  qualificationSource: "managed_executor_handler_settlement.v1";
  executors: readonly Readonly<{
    executorId: string;
    binaryDigest: string;
    acceptsNewRequests: false;
    handlerSettlement: "terminal_or_exact_durable_pending";
  }>[];
}>;
/** This proves retirement and ingress removal, not terminal outcomes of old handler promises. */
export type RetiredLegacyWritersQuarantineQualification = Readonly<{
  qualificationSource: "retired_legacy_writers_quarantine.v1";
  writerDigest: string;
  scopeKind: "all_managed_legacy_resolution_writers";
  inventoryComplete: true;
  retiredAt: string;
  executorSetHash: string;
  proofHash: string;
  executors: readonly Readonly<{
    executorId: string;
    binaryDigest: string;
    retiredAt: string;
    acceptsNewRequests: false;
    restartable: false;
  }>[];
  ingress: Readonly<{ observedAt: string; oldExecutorIds: readonly string[] }>;
}>;
export type ResolutionWriterDrainQualification =
  | ManagedResolutionWriterDrainQualification
  | RetiredLegacyWritersQuarantineQualification;

export function retiredLegacyWriterExecutorSetHash(
  executors: RetiredLegacyWritersQuarantineQualification["executors"],
  digestUtf8: (value: string) => string,
): string {
  return digestUtf8(
    `rr.resolution_retired_writer_set.v1\0${canonicalReviewPublicationJson([...executors].sort((a, b) => (a.executorId < b.executorId ? -1 : a.executorId > b.executorId ? 1 : 0)))}`,
  );
}
export function retiredLegacyWriterQualificationProofHash(
  proof: Omit<RetiredLegacyWritersQuarantineQualification, "proofHash">,
  digestUtf8: (value: string) => string,
): string {
  return digestUtf8(
    `rr.resolution_retired_writer_proof.v1\0${canonicalReviewPublicationJson({ ...proof, executors: [...proof.executors].sort((a, b) => (a.executorId < b.executorId ? -1 : a.executorId > b.executorId ? 1 : 0)) })}`,
  );
}

/** The port first verifies actual complete deployment inventory and ingress against managed infrastructure. */
export function isQualifiedResolutionWriterProof(
  proof: ResolutionWriterDrainQualification,
  observedAt: Date,
  digestUtf8: (value: string) => string,
): boolean {
  const digest = (value: unknown) =>
    typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
  if (
    !proof ||
    !digest(proof.writerDigest) ||
    !Array.isArray(proof.executors) ||
    !proof.executors.length ||
    proof.executors.some((item) => !item || typeof item !== "object") ||
    new Set(proof.executors.map((item) => item.executorId)).size !==
      proof.executors.length
  )
    return false;
  if (proof.qualificationSource === "managed_executor_handler_settlement.v1")
    return proof.executors.every(
      (item) =>
        !!item.executorId &&
        digest(item.binaryDigest) &&
        item.acceptsNewRequests === false &&
        item.handlerSettlement === "terminal_or_exact_durable_pending",
    );
  if (
    proof.qualificationSource !== "retired_legacy_writers_quarantine.v1" ||
    proof.scopeKind !== "all_managed_legacy_resolution_writers" ||
    proof.inventoryComplete !== true ||
    !proof.ingress ||
    !Array.isArray(proof.ingress.oldExecutorIds) ||
    proof.ingress.oldExecutorIds.length !== 0 ||
    !digest(proof.executorSetHash) ||
    !digest(proof.proofHash)
  )
    return false;
  const retiredAt = Date.parse(proof.retiredAt);
  const ingressAt = Date.parse(proof.ingress.observedAt);
  if (
    !Number.isFinite(retiredAt) ||
    !Number.isFinite(ingressAt) ||
    retiredAt > ingressAt ||
    ingressAt > observedAt.getTime()
  )
    return false;
  if (
    proof.executors.some(
      (item) =>
        !item.executorId ||
        !digest(item.binaryDigest) ||
        item.acceptsNewRequests !== false ||
        item.restartable !== false ||
        !Number.isFinite(Date.parse(item.retiredAt)) ||
        Date.parse(item.retiredAt) > retiredAt,
    )
  )
    return false;
  if (
    retiredLegacyWriterExecutorSetHash(proof.executors, digestUtf8) !==
    proof.executorSetHash
  )
    return false;
  const { proofHash, ...facts } = proof;
  return (
    retiredLegacyWriterQualificationProofHash(facts, digestUtf8) === proofHash
  );
}

export interface ResolutionWriterDrainQualificationPort {
  qualify(scope: ReviewPublicationScope): Promise<
    | Readonly<{
        status: "qualified";
        proof: ResolutionWriterDrainQualification;
      }>
    | Readonly<{ status: "unqualified"; reasonCode: string }>
  >;
}
export interface ResolutionHistoryActivationPort {
  beginDrain(scope: ReviewPublicationScope): Promise<void>;
  activate(
    scope: ReviewPublicationScope,
    proof: ResolutionWriterDrainQualification,
  ): Promise<void>;
}

/** Without verified settlement or retired-writer quarantine, the connection stays draining. */
export async function activateReviewResolutionHistory(
  scope: ReviewPublicationScope,
  dependencies: Readonly<{
    activation: ResolutionHistoryActivationPort;
    writers: ResolutionWriterDrainQualificationPort;
  }>,
): Promise<
  | Readonly<{ status: "guarded" }>
  | Readonly<{ status: "draining"; reasonCode: string }>
> {
  await dependencies.activation.beginDrain(scope);
  const qualification = await dependencies.writers.qualify(scope);
  if (qualification.status !== "qualified")
    return { status: "draining", reasonCode: qualification.reasonCode };
  await dependencies.activation.activate(scope, qualification.proof);
  return { status: "guarded" };
}
