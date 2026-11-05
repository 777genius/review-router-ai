import { describe, expect, it } from "vitest";
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
import {
  mapFailedSealStatus,
  mapOpenStatus,
  mapReceiptReplayStatus,
  mapReplayStatus,
  mapSealStatus,
  receiptReplayDenied,
  replayDenied,
} from "./review-action-v2-context-result-mappers.js";

describe("Context attestation protocol results", () => {
  it("preserves open and seal idempotency without reclassifying denials", () => {
    expect(mapOpenStatus(OpenContextGatewaySessionStatus.Opened)).toBe(
      ReviewContextGatewayOpenResultStatus.Opened,
    );
    expect(mapOpenStatus(OpenContextGatewaySessionStatus.Idempotent)).toBe(
      ReviewContextGatewayOpenResultStatus.Idempotent,
    );
    expect(mapSealStatus(AcceptSealedContextAttestationStatus.Denied)).toBe(
      ReviewContextGatewaySealResultStatus.Denied,
    );
    expect(mapFailedSealStatus(AbandonContextGatewaySessionStatus.Expired)).toBe(
      ReviewContextGatewaySealResultStatus.Idempotent,
    );
    expect(mapFailedSealStatus(AbandonContextGatewaySessionStatus.Conflict)).toBe(
      ReviewContextGatewaySealResultStatus.Conflict,
    );
  });

  it("preserves receipt and ordinary replay status mapping", () => {
    expect(mapReplayStatus(ReplayContextAttestationStatus.Accepted)).toBe(
      ReviewContextReplayCommitResultStatus.Accepted,
    );
    expect(mapReplayStatus(ReplayContextAttestationStatus.Idempotent)).toBe(
      ReviewContextReplayCommitResultStatus.Idempotent,
    );
    expect(mapReceiptReplayStatus(ReplayContextAttestationStatus.Conflict)).toBe(
      ReviewContextReceiptReplayCommitResultStatus.Conflict,
    );
  });

  it("denies without issuing proof or attachment capabilities", () => {
    expect(replayDenied()).toEqual({
      statusCode: 200,
      result: {
        status: ReviewContextReplayCommitResultStatus.Denied,
        replayProofId: null,
        replayProofHash: null,
        attachmentCapability: null,
      },
    });
    expect(receiptReplayDenied()).toEqual({
      statusCode: 200,
      result: {
        status: ReviewContextReceiptReplayCommitResultStatus.Denied,
        replayProofId: null,
        replayProofHash: null,
      },
    });
  });
});
