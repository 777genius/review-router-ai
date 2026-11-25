// Exact context identity, transcript cryptography and key admission for the API adapter.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import {
  ContextLeaseAuthorityKind,
  type ContextReplayMaterialCipherPort,
  type GatewaySession,
  type TargetReplayProof,
} from "@reviewrouter/features-review-context-attestation";
import { AesGcmContextReplayMaterialCipher } from "@reviewrouter/features-review-context-attestation/composition";
import {
  canonicalJson,
  type ReviewRunAuthorization,
} from "@reviewrouter/features-review-run-control";
import type {
  ReviewActionV2ContextAttestationHandlerDependencies,
  ReviewActionV2ContextDigestPort,
} from "./review-action-v2-context-attestation-types.js";

const gatewaySeedDomain = "rr.context-gateway-seed.v1";
const gatewaySecretDomain = "rr.context-gateway-session-secret.v1";
export const reviewActionV2ContextSessionSecretEnv =
  "REVIEW_ROUTER_REVIEW_V2_CONTEXT_SESSION_SECRET_BASE64";
export const reviewActionV2ContextReplayActiveKeyIdEnv =
  "REVIEW_ROUTER_REVIEW_V2_CONTEXT_REPLAY_ACTIVE_KEY_ID";
export const reviewActionV2ContextReplayKeysEnv =
  "REVIEW_ROUTER_REVIEW_V2_CONTEXT_REPLAY_KEYS_JSON";
export function readReviewActionV2ContextCrypto(
  env: Readonly<Record<string, string | undefined>>,
): Readonly<{
  sessionSecretKey: Uint8Array;
  cipher: ContextReplayMaterialCipherPort;
}> {
  const sessionSecretKey = readBase64Key(
    requiredEnv(env, reviewActionV2ContextSessionSecretEnv),
    "review_context_session_secret_invalid",
  );
  const activeKeyId = requiredEnv(
    env,
    reviewActionV2ContextReplayActiveKeyIdEnv,
  );
  let parsed: unknown;
  try {
    parsed = JSON.parse(requiredEnv(env, reviewActionV2ContextReplayKeysEnv));
  } catch {
    throw new Error("review_context_replay_keys_invalid");
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > 16) {
    throw new Error("review_context_replay_keys_invalid");
  }
  const keys = new Map<string, Uint8Array>();
  for (const candidate of parsed) {
    const row = exactConfigRecord(candidate, ["keyId", "secretBase64"]);
    if (
      typeof row.keyId !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/.test(row.keyId) ||
      typeof row.secretBase64 !== "string" ||
      keys.has(row.keyId)
    ) {
      throw new Error("review_context_replay_keys_invalid");
    }
    keys.set(
      row.keyId,
      readBase64Key(row.secretBase64, "review_context_replay_keys_invalid"),
    );
  }
  return Object.freeze({
    sessionSecretKey,
    cipher: new AesGcmContextReplayMaterialCipher(activeKeyId, keys),
  });
}

export function gatewaySecretIdentity(
  facts: Pick<
    GatewaySession,
    | "attemptId"
    | "openingIntentHash"
    | "sourceLeaseAuthorityKind"
    | "sourceLeaseId"
    | "sourceFencingToken"
    | "sourceExecutionId"
    | "sourceWorkSlotId"
    | "sourceRevision"
    | "gatewayPolicyVersion"
    | "gatewayBinaryHash"
    | "confinementProofHash"
  >,
) {
  if (
    facts.sourceLeaseAuthorityKind ===
    ContextLeaseAuthorityKind.StandardExecution
  ) {
    return canonicalJson({
      attemptId: facts.attemptId,
      openingIntentHash: facts.openingIntentHash,
      sourceLeaseId: facts.sourceLeaseId,
      sourceFencingToken: facts.sourceFencingToken,
      sourceExecutionId: facts.sourceExecutionId,
      sourceWorkSlotId: facts.sourceWorkSlotId,
      sourceReviewRevisionHash: facts.sourceRevision.reviewRevisionHash,
      checkoutTreeOid: facts.sourceRevision.checkoutTreeOid,
      gatewayPolicyVersion: facts.gatewayPolicyVersion,
      gatewayBinaryHash: facts.gatewayBinaryHash,
      confinementProofHash: facts.confinementProofHash,
    });
  }
  return canonicalJson({
    identityVersion: 2,
    attemptId: facts.attemptId,
    openingIntentHash: facts.openingIntentHash,
    sourceLeaseAuthorityKind: facts.sourceLeaseAuthorityKind,
    sourceLeaseId: facts.sourceLeaseId,
    sourceFencingToken: facts.sourceFencingToken,
    sourceExecutionId: facts.sourceExecutionId,
    sourceWorkSlotId: facts.sourceWorkSlotId,
    sourceReviewRevisionHash: facts.sourceRevision.reviewRevisionHash,
    checkoutTreeOid: facts.sourceRevision.checkoutTreeOid,
    gatewayPolicyVersion: facts.gatewayPolicyVersion,
    gatewayBinaryHash: facts.gatewayBinaryHash,
    confinementProofHash: facts.confinementProofHash,
  });
}

export function gatewaySeedIdentity(
  facts: Pick<
    GatewaySession,
    | "attemptId"
    | "openingIntentHash"
    | "sourceLeaseAuthorityKind"
    | "sourceLeaseId"
    | "sourceFencingToken"
  >,
): string {
  if (
    facts.sourceLeaseAuthorityKind ===
    ContextLeaseAuthorityKind.StandardExecution
  ) {
    return canonicalJson({
      domain: gatewaySeedDomain,
      attemptId: facts.attemptId,
      openingIntentHash: facts.openingIntentHash,
      sourceLeaseId: facts.sourceLeaseId,
      sourceFencingToken: facts.sourceFencingToken,
    });
  }
  return canonicalJson({
    domain: "rr.investigation-context-gateway-seed.v1",
    sourceLeaseAuthorityKind: facts.sourceLeaseAuthorityKind,
    attemptId: facts.attemptId,
    openingIntentHash: facts.openingIntentHash,
    sourceLeaseId: facts.sourceLeaseId,
    sourceFencingToken: facts.sourceFencingToken,
  });
}

export function openingIntentIdentity(
  authorityKind: ContextLeaseAuthorityKind,
  idempotencyKey: string,
): string {
  if (authorityKind === ContextLeaseAuthorityKind.StandardExecution) {
    return canonicalJson({
      domain: "rr.context-gateway-opening-intent.v1",
      idempotencyKey,
    });
  }
  return canonicalJson({
    domain: "rr.investigation-context-gateway-opening-intent.v1",
    sourceLeaseAuthorityKind: authorityKind,
    idempotencyKey,
  });
}

export function deriveGatewaySessionSecret(
  masterKey: Uint8Array,
  identity: string,
): Buffer {
  return createHmac("sha256", masterKey)
    .update(gatewaySecretDomain)
    .update("\0")
    .update(identity)
    .digest();
}

export function replayMaterialAssociatedData(session: GatewaySession): string {
  if (
    session.sourceLeaseAuthorityKind ===
    ContextLeaseAuthorityKind.StandardExecution
  ) {
    return canonicalJson({
      associatedDataVersion: 1,
      sessionId: session.sessionId,
      sourceExecutionId: session.sourceExecutionId,
      sourceWorkSlotId: session.sourceWorkSlotId,
      sourceReviewRevisionHash: session.sourceRevision.reviewRevisionHash,
      checkoutTreeOid: session.sourceRevision.checkoutTreeOid,
      gatewayPolicyVersion: session.gatewayPolicyVersion,
      gatewayBinaryHash: session.gatewayBinaryHash,
      confinementProofHash: session.confinementProofHash,
    });
  }
  return canonicalJson({
    associatedDataVersion: 2,
    sessionId: session.sessionId,
    sourceExecutionId: session.sourceExecutionId,
    sourceLeaseAuthorityKind: session.sourceLeaseAuthorityKind,
    sourceWorkSlotId: session.sourceWorkSlotId,
    sourceReviewRevisionHash: session.sourceRevision.reviewRevisionHash,
    checkoutTreeOid: session.sourceRevision.checkoutTreeOid,
    gatewayPolicyVersion: session.gatewayPolicyVersion,
    gatewayBinaryHash: session.gatewayBinaryHash,
    confinementProofHash: session.confinementProofHash,
  });
}

export async function authorizationScopeHash(
  authorization: ReviewRunAuthorization,
  digest: ReviewActionV2ContextDigestPort,
) {
  return digest.digestUtf8(
    canonicalJson({
      workspaceId: authorization.workspaceId,
      repositoryConnectionId: authorization.repositoryConnectionId,
      scmRepositoryIdentityId: authorization.scmRepositoryIdentityId,
      pullRequestNumber: authorization.pullRequestNumber,
    }),
  );
}

export async function hashReplayProof(
  proof: TargetReplayProof,
  digest: ReviewActionV2ContextDigestPort,
) {
  return digest.digestUtf8(
    canonicalJson({
      replayProofId: proof.replayProofId,
      sourceAttestationId: proof.sourceAttestationId,
      sourceAttestationHash: proof.sourceAttestationHash,
      sourceOperationReceiptIdsHash: proof.sourceOperationReceiptIdsHash,
      targetExecutionId: proof.targetExecutionId,
      targetWorkSlotId: proof.targetWorkSlotId,
      targetReviewRevisionHash: proof.targetReviewRevisionHash,
      targetCheckoutTreeOid: proof.targetCheckoutTreeOid,
      replayBinaryHash: proof.replayBinaryHash,
      replayPolicyVersion: proof.replayPolicyVersion,
      reusePolicyVectorHash: proof.reusePolicyVectorHash,
      createdAtMs: proof.createdAtMs,
      expiresAtMs: proof.expiresAtMs,
    }),
  );
}

export function contextIdentities(
  d: ReviewActionV2ContextAttestationHandlerDependencies,
) {
  return {
    nextGatewaySessionId: () => d.nextId("gateway_session"),
    nextAttestationId: () => d.nextId("attestation"),
    nextReplayProofId: () => d.nextId("replay_proof"),
  };
}

export function hmacHex(key: Uint8Array, value: string): string {
  return createHmac("sha256", key).update(value, "utf8").digest("hex");
}

export function sha256Utf8(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function sameHex(left: string, right: string): boolean {
  return (
    /^[a-f0-9]{64}$/.test(left) &&
    /^[a-f0-9]{64}$/.test(right) &&
    timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"))
  );
}

function requiredEnv(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
): string {
  const value = env[name];
  if (!value) throw new Error(`review_context_config_missing:${name}`);
  return value;
}

function readBase64Key(value: string, issue: string): Uint8Array {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error(issue);
  const decoded = Buffer.from(value, "base64");
  if (
    decoded.byteLength !== 32 ||
    decoded.toString("base64").replace(/=+$/u, "") !== value.replace(/=+$/u, "")
  ) {
    throw new Error(issue);
  }
  return new Uint8Array(decoded);
}

function exactConfigRecord(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("review_context_replay_keys_invalid");
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new Error("review_context_replay_keys_invalid");
  }
  return value as Record<string, unknown>;
}
