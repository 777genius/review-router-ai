import type { ReviewPublicationScope } from "../../domain/review-publication-attempt";
import { canonicalReviewPublicationJson } from "../../domain/canonical-review-publication-json";
import type { ResolutionHistoryCut } from "../../domain/review-thread-resolution-history";

import type {
  RetiredLegacyWritersQuarantineQualification,
  ResolutionWriterDrainQualification,
} from "../../domain/resolution-writer-witness";
export type {
  ManagedResolutionWriterDrainQualification,
  RetiredLegacyWritersQuarantineQualification,
  ResolutionWriterDrainQualification,
} from "../../domain/resolution-writer-witness";

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

export interface ResolutionHistoryActivationStatePort extends ResolutionHistoryActivationPort {
  readActivation(
    scope: ReviewPublicationScope,
  ): Promise<ResolutionHistoryCut | null>;
}

export function resolutionWriterProofMatchesCut(
  proof: ResolutionWriterDrainQualification,
  cut: ResolutionHistoryCut,
): boolean {
  return (
    proof.writerDigest === cut.writerDigest &&
    (proof.qualificationSource === "retired_legacy_writers_quarantine.v1"
      ? cut.bootstrap?.proofHash === proof.proofHash
      : cut.bootstrap === undefined)
  );
}

/** Ordinary reviews may activate history; missing deployment evidence never starts a drain. */
export async function ensureResolutionHistoryActivated(
  scope: ReviewPublicationScope,
  dependencies: Readonly<{
    activation: ResolutionHistoryActivationStatePort;
    writers: ResolutionWriterDrainQualificationPort;
  }>,
): Promise<
  | Readonly<{ status: "guarded" }>
  | Readonly<{ status: "unavailable"; reasonCode: string }>
> {
  try {
    const existing = await dependencies.activation.readActivation(scope);
    const preflight = await dependencies.writers.qualify(scope);
    if (preflight.status !== "qualified")
      return { status: "unavailable", reasonCode: preflight.reasonCode };
    if (existing)
      return resolutionWriterProofMatchesCut(preflight.proof, existing)
        ? { status: "guarded" }
        : {
            status: "unavailable",
            reasonCode: "resolution_activation_writer_conflict",
          };
    const result = await activateReviewResolutionHistory(scope, {
      activation: dependencies.activation,
      writers: {
        async qualify(currentScope) {
          const current = await dependencies.writers.qualify(currentScope);
          if (current.status !== "qualified") return current;
          return canonicalReviewPublicationJson(current.proof) ===
            canonicalReviewPublicationJson(preflight.proof)
            ? current
            : {
                status: "unqualified",
                reasonCode: "resolution_writer_qualification_changed",
              };
        },
      },
    });
    return result.status === "guarded"
      ? result
      : { status: "unavailable", reasonCode: result.reasonCode };
  } catch {
    // Retain the cut, pending effects, and any drain already established under the lock.
    return {
      status: "unavailable",
      reasonCode: "resolution_history_activation_unavailable",
    };
  }
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
