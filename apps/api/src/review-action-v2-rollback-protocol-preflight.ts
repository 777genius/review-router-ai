import {
  reviewActionV2SupportedContracts,
  type ReviewActionV2ContractDescriptor,
} from "@reviewrouter/protocol-review-action-v2";
import { ReviewProtocolVersion } from "@reviewrouter/features-review-run-control";

const WELL_FORMED_DIGEST = /^[a-f0-9]{64}$/;
const WELL_FORMED_PROTOCOL_VERSION = /^[0-9A-Za-z._-]{1,16}$/;

export interface RollbackInventoryContract {
  readonly source: "workflow_channel" | "authorization" | "producer_release";
  readonly consumer: string;
  readonly protocolVersion: string | null;
  readonly schemaDigest: string;
  readonly canonicalizerDigest: string;
}

export interface RollbackActiveAuthorizationRecord {
  readonly authorizationId: string;
  readonly producerReleaseId: string;
  readonly selectedProtocolVersion: string;
  readonly schemaDigest: string;
}

export interface RollbackRetainedProducerReleaseRecord {
  readonly producerReleaseId: string;
  readonly schemaDigest: string;
}

export interface RollbackProducerAttestationRecord {
  readonly producerReleaseId: string;
  readonly schemaDigest: string;
  readonly canonicalizerDigest: string;
}

export type RollbackProtocolPreflightResult =
  | {
      readonly code: "rollback_protocol_preflight_passed";
      readonly status: "compatible";
      readonly targetContracts: readonly ReviewActionV2ContractDescriptor[];
      readonly requiredContracts: readonly RollbackInventoryContract[];
    }
  | {
      readonly code: "rollback_protocol_preflight_not_proven";
      readonly status: "inventory_incomplete";
      readonly missing: readonly string[];
    }
  | {
      readonly code: "rollback_protocol_preflight_rejected";
      readonly status: "protocol_incompatible";
      readonly targetContracts: readonly ReviewActionV2ContractDescriptor[];
      readonly requiredContracts: readonly RollbackInventoryContract[];
      readonly unsupported: readonly RollbackInventoryContract[];
    };

export function parseWorkflowChannelContract(
  manifestSource: string | null | undefined,
): ReviewActionV2ContractDescriptor | null {
  if (typeof manifestSource !== "string") return null;
  let manifest: unknown;
  try {
    manifest = JSON.parse(manifestSource);
  } catch {
    return null;
  }
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    return null;
  }
  const record = manifest as Record<string, unknown>;
  const protocolVersion =
    typeof record.protocolVersion === "string" ||
    typeof record.protocolVersion === "number"
      ? String(record.protocolVersion)
      : "";
  const { schemaDigest, canonicalizerDigest } = record;
  if (!WELL_FORMED_PROTOCOL_VERSION.test(protocolVersion)) return null;
  if (
    typeof schemaDigest !== "string" ||
    !WELL_FORMED_DIGEST.test(schemaDigest)
  )
    return null;
  if (
    typeof canonicalizerDigest !== "string" ||
    !WELL_FORMED_DIGEST.test(canonicalizerDigest)
  ) {
    return null;
  }
  return { protocolVersion, schemaDigest, canonicalizerDigest };
}

function supportedBy(
  targetContracts: readonly ReviewActionV2ContractDescriptor[],
  contract: RollbackInventoryContract,
): boolean {
  return targetContracts.some(
    (target) =>
      target.schemaDigest === contract.schemaDigest &&
      target.canonicalizerDigest === contract.canonicalizerDigest &&
      (contract.protocolVersion === null ||
        target.protocolVersion === contract.protocolVersion),
  );
}

/**
 * Verifies that a target API build supports every contract of the current
 * workflow channel, active authorizations and retained producer releases.
 * An incomplete inventory is never proven safe and stops the rollback.
 */
export function assessRollbackProtocolCompatibility(input: {
  readonly targetContracts?: readonly ReviewActionV2ContractDescriptor[];
  readonly channelManifestSource: string | null;
  readonly attestations: readonly RollbackProducerAttestationRecord[] | null;
  readonly activeAuthorizations: readonly RollbackActiveAuthorizationRecord[];
  readonly retainedProducerReleases: readonly RollbackRetainedProducerReleaseRecord[];
}): RollbackProtocolPreflightResult {
  const targetContracts =
    input.targetContracts ?? reviewActionV2SupportedContracts();
  const missing: string[] = [];
  const requiredContracts: RollbackInventoryContract[] = [];

  const channelContract = parseWorkflowChannelContract(
    input.channelManifestSource,
  );
  if (!channelContract) {
    missing.push("workflow_channel_manifest");
  } else {
    requiredContracts.push({
      source: "workflow_channel",
      consumer: "workflow-v1",
      protocolVersion: channelContract.protocolVersion,
      schemaDigest: channelContract.schemaDigest,
      canonicalizerDigest: channelContract.canonicalizerDigest,
    });
  }

  const attestationsByRelease = new Map<
    string,
    RollbackProducerAttestationRecord
  >();
  if (input.attestations === null) {
    missing.push("producer_release_attestations");
  } else {
    for (const attestation of input.attestations) {
      const existing = attestationsByRelease.get(attestation.producerReleaseId);
      if (
        existing &&
        (existing.schemaDigest !== attestation.schemaDigest ||
          existing.canonicalizerDigest !== attestation.canonicalizerDigest)
      ) {
        missing.push(
          `producer_release_attestation_ambiguous:${attestation.producerReleaseId}`,
        );
        continue;
      }
      attestationsByRelease.set(attestation.producerReleaseId, attestation);
    }
  }

  const attestationFor = (producerReleaseId: string) =>
    attestationsByRelease.get(producerReleaseId) ?? null;

  for (const authorization of input.activeAuthorizations) {
    const attestation = attestationFor(authorization.producerReleaseId);
    if (!attestation) {
      missing.push(`authorization:${authorization.authorizationId}`);
      continue;
    }
    if (attestation.schemaDigest !== authorization.schemaDigest) {
      missing.push(
        `authorization_attestation_mismatch:${authorization.authorizationId}`,
      );
      continue;
    }
    requiredContracts.push({
      source: "authorization",
      consumer: authorization.authorizationId,
      // Authorizations persist the domain enum; descriptors use the wire version.
      protocolVersion:
        authorization.selectedProtocolVersion === ReviewProtocolVersion.V2
          ? "2"
          : authorization.selectedProtocolVersion,
      schemaDigest: authorization.schemaDigest,
      canonicalizerDigest: attestation.canonicalizerDigest,
    });
  }

  for (const release of input.retainedProducerReleases) {
    const attestation = attestationFor(release.producerReleaseId);
    if (!attestation) {
      missing.push(`producer_release:${release.producerReleaseId}`);
      continue;
    }
    if (attestation.schemaDigest !== release.schemaDigest) {
      missing.push(
        `producer_release_attestation_mismatch:${release.producerReleaseId}`,
      );
      continue;
    }
    requiredContracts.push({
      source: "producer_release",
      consumer: release.producerReleaseId,
      protocolVersion: null,
      schemaDigest: release.schemaDigest,
      canonicalizerDigest: attestation.canonicalizerDigest,
    });
  }

  if (missing.length > 0) {
    return {
      code: "rollback_protocol_preflight_not_proven",
      status: "inventory_incomplete",
      missing,
    };
  }

  const unsupported = requiredContracts.filter(
    (contract) => !supportedBy(targetContracts, contract),
  );
  if (unsupported.length > 0) {
    return {
      code: "rollback_protocol_preflight_rejected",
      status: "protocol_incompatible",
      targetContracts,
      requiredContracts,
      unsupported,
    };
  }

  return {
    code: "rollback_protocol_preflight_passed",
    status: "compatible",
    targetContracts,
    requiredContracts,
  };
}
