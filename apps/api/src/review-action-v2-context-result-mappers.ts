import {
  AbandonContextGatewaySessionStatus,
  AcceptSealedContextAttestationStatus,
  OpenContextGatewaySessionStatus,
  ReplayContextAttestationStatus,
} from "@reviewrouter/features-review-context-attestation";
import {
  ReviewContextGatewayOpenResultStatus,
  ReviewContextGatewaySealResultStatus,
  ReviewContextReceiptReplayCommitResultStatus,
  ReviewContextReplayCommitResultStatus,
} from "@reviewrouter/protocol-review-action-v2";

// Pure gateway/replay domain-to-protocol projections. Lease authority,
// canonical crypto and external effects stay with their existing owners.
export function mapOpenStatus(status: OpenContextGatewaySessionStatus) {
  switch (status) {
    case OpenContextGatewaySessionStatus.Opened:
      return ReviewContextGatewayOpenResultStatus.Opened;
    case OpenContextGatewaySessionStatus.Idempotent:
      return ReviewContextGatewayOpenResultStatus.Idempotent;
    case OpenContextGatewaySessionStatus.Denied:
      return ReviewContextGatewayOpenResultStatus.Denied;
    case OpenContextGatewaySessionStatus.Conflict:
      return ReviewContextGatewayOpenResultStatus.Conflict;
  }
}

export function mapSealStatus(status: AcceptSealedContextAttestationStatus) {
  switch (status) {
    case AcceptSealedContextAttestationStatus.Accepted:
      return ReviewContextGatewaySealResultStatus.Accepted;
    case AcceptSealedContextAttestationStatus.Idempotent:
      return ReviewContextGatewaySealResultStatus.Idempotent;
    case AcceptSealedContextAttestationStatus.Denied:
      return ReviewContextGatewaySealResultStatus.Denied;
    case AcceptSealedContextAttestationStatus.Conflict:
      return ReviewContextGatewaySealResultStatus.Conflict;
  }
}

export function mapFailedSealStatus(status: AbandonContextGatewaySessionStatus) {
  switch (status) {
    case AbandonContextGatewaySessionStatus.Abandoned:
      return ReviewContextGatewaySealResultStatus.Accepted;
    case AbandonContextGatewaySessionStatus.Idempotent:
    case AbandonContextGatewaySessionStatus.AlreadyTerminal:
    case AbandonContextGatewaySessionStatus.Expired:
      return ReviewContextGatewaySealResultStatus.Idempotent;
    case AbandonContextGatewaySessionStatus.Denied:
      return ReviewContextGatewaySealResultStatus.Denied;
    case AbandonContextGatewaySessionStatus.Conflict:
      return ReviewContextGatewaySealResultStatus.Conflict;
  }
}

export function mapReplayStatus(status: ReplayContextAttestationStatus) {
  switch (status) {
    case ReplayContextAttestationStatus.Accepted:
      return ReviewContextReplayCommitResultStatus.Accepted;
    case ReplayContextAttestationStatus.Idempotent:
      return ReviewContextReplayCommitResultStatus.Idempotent;
    case ReplayContextAttestationStatus.Denied:
      return ReviewContextReplayCommitResultStatus.Denied;
    case ReplayContextAttestationStatus.Conflict:
      return ReviewContextReplayCommitResultStatus.Conflict;
  }
}

export function replayDenied() {
  return {
    statusCode: 200 as const,
    result: {
      status: ReviewContextReplayCommitResultStatus.Denied,
      replayProofId: null,
      replayProofHash: null,
      attachmentCapability: null,
    },
  };
}

export function mapReceiptReplayStatus(status: ReplayContextAttestationStatus) {
  switch (status) {
    case ReplayContextAttestationStatus.Accepted:
      return ReviewContextReceiptReplayCommitResultStatus.Accepted;
    case ReplayContextAttestationStatus.Idempotent:
      return ReviewContextReceiptReplayCommitResultStatus.Idempotent;
    case ReplayContextAttestationStatus.Denied:
      return ReviewContextReceiptReplayCommitResultStatus.Denied;
    case ReplayContextAttestationStatus.Conflict:
      return ReviewContextReceiptReplayCommitResultStatus.Conflict;
  }
}

export function receiptReplayDenied() {
  return {
    statusCode: 200 as const,
    result: {
      status: ReviewContextReceiptReplayCommitResultStatus.Denied,
      replayProofId: null,
      replayProofHash: null,
    },
  };
}

