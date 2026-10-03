import { describe, expect, it, vi } from "vitest";
import {
  ContextLeaseAuthorityKind,
  ContextGatewayV4OperationKind,
  ContextGatewayV4OutcomeKind,
  ContextProviderKind,
  GatewaySessionState,
  type ContextGatewayV4Manifest,
} from "@reviewrouter/features-review-context-attestation";
import {
  InvestigationOperationKind,
  InvestigationOperationRevision,
  ReviewInvestigationLeasePurpose,
} from "@reviewrouter/features-review-investigations";
import { hostedV4LogicalTurnKey } from "@reviewrouter/features-hosted-account-pool";
import { ProductionInvestigationTurnEvidence } from "./review-action-v2-investigation-composition.js";

const hash = (character: string) => character.repeat(64);

describe("ProductionInvestigationTurnEvidence", () => {
  it("preserves authenticated operation subjects, ranges and pagination", async () => {
    const attestation = acceptedAttestation(manifest());
    const evidence = new ProductionInvestigationTurnEvidence(
      {
        findAcceptedAttestation: async () => attestation,
        findSession: async () => acceptedSession(),
      } as never,
      () => new Date("2026-08-03T10:00:00.000Z"),
    );

    await expect(
      evidence.verify({
        acceptedAttestationId: "attestation-1",
        acceptedAttestationHash: hash("a"),
        sourceExecutionId: "execution-1",
        sourceWorkSlotId: "slot-1",
        sourceReviewRevisionHash: hash("b"),
        attemptId: "attempt-1",
        sourceLeaseId: "lease-1",
        sourceFencingToken: "1",
        actualModel: "gpt-test",
        terminalOutcomeHash: hash("c"),
      }),
    ).resolves.toMatchObject({
      actualProviderKind: "codex",
      operations: [
        {
          operationKind: InvestigationOperationKind.FileRead,
          operationInputHash: hash("d"),
          revision: InvestigationOperationRevision.Head,
          pathHash: hash("e"),
          startByte: 0,
          byteCount: 12,
          contentKind: "text",
          lineCount: 2,
          complete: true,
        },
        {
          operationKind: InvestigationOperationKind.TextSearch,
          operationInputHash: hash("f"),
          queryDigest: hash("1"),
          pageOrdinal: 0,
          aggregateItemCount: 2,
          complete: true,
        },
      ],
    });
  });

  it("fails closed when the trusted gateway session cannot be resolved", async () => {
    const attestation = acceptedAttestation(manifest());
    const evidence = new ProductionInvestigationTurnEvidence(
      {
        findAcceptedAttestation: async () => attestation,
        findSession: async () => null,
      } as never,
      () => new Date("2026-08-03T10:00:00.000Z"),
    );

    await expect(
      evidence.verify({
        acceptedAttestationId: "attestation-1",
        acceptedAttestationHash: hash("a"),
        sourceExecutionId: "execution-1",
        sourceWorkSlotId: "slot-1",
        sourceReviewRevisionHash: hash("b"),
        attemptId: "attempt-1",
        sourceLeaseId: "lease-1",
        sourceFencingToken: "1",
        actualModel: "gpt-test",
        terminalOutcomeHash: hash("c"),
      }),
    ).resolves.toBeNull();
  });

  it("rejects an accepted relay attestation after its paid effect becomes unknown", async () => {
    const relayAttestation = {
      ...(acceptedAttestation(manifest()) as object),
      sourceLeaseAuthorityKind: ContextLeaseAuthorityKind.InvestigationRelay,
    };
    const relaySession = {
      ...(acceptedSession() as object),
      sourceLeaseAuthorityKind: ContextLeaseAuthorityKind.InvestigationRelay,
    };
    const readStatus = vi.fn().mockResolvedValue({
      state: "terminal_unknown",
      grantId: "grant-1",
      requestId: "request-1",
      effectId: "effect-1",
      requestHash: hash("d"),
    });
    const evidence = new ProductionInvestigationTurnEvidence(
      {
        findAcceptedAttestation: async () => relayAttestation,
        findSession: async () => relaySession,
      } as never,
      () => new Date("2026-08-03T10:00:00.000Z"),
      {
        findLease: async () => ({
          leaseId: "lease-1",
          purpose: ReviewInvestigationLeasePurpose.RelayTurn,
          investigationId: "investigation-1",
          turnId: "turn-1",
        }),
      } as never,
      { readStatus },
    );
    const command = {
      acceptedAttestationId: "attestation-1",
      acceptedAttestationHash: hash("a"),
      sourceExecutionId: "execution-1",
      sourceWorkSlotId: "slot-1",
      sourceReviewRevisionHash: hash("b"),
      attemptId: "attempt-1",
      sourceLeaseId: "lease-1",
      sourceFencingToken: "1",
      actualModel: "gpt-test",
      terminalOutcomeHash: hash("c"),
    };
    await expect(evidence.verify(command)).resolves.toBeNull();
    expect(readStatus).toHaveBeenCalledWith(
      hostedV4LogicalTurnKey("investigation-1", "turn-1"),
    );
    readStatus.mockResolvedValue({
      state: "succeeded",
      grantId: "grant-1",
      requestId: "request-1",
      effectId: "effect-1",
      requestHash: hash("d"),
    });
    await expect(evidence.verify(command)).resolves.toMatchObject({
      actualProviderKind: "codex",
    });
  });
});

function acceptedAttestation(operationManifest: ContextGatewayV4Manifest) {
  return {
    attestationId: "attestation-1",
    sessionId: "session-1",
    attestationHash: hash("a"),
    sourceExecutionId: "execution-1",
    sourceWorkSlotId: "slot-1",
    sourceReviewRevisionHash: hash("b"),
    attemptId: "attempt-1",
    sourceLeaseId: "lease-1",
    sourceLeaseAuthorityKind: ContextLeaseAuthorityKind.InvestigationShadow,
    sourceFencingToken: "1",
    actualModel: "gpt-test",
    terminalOutcomeHash: hash("c"),
    reuseExpiresAtMs: new Date("2026-08-03T11:00:00.000Z").getTime(),
    manifest: operationManifest,
  } as never;
}

function acceptedSession() {
  return {
    sessionId: "session-1",
    sourceExecutionId: "execution-1",
    sourceWorkSlotId: "slot-1",
    sourceRevision: { reviewRevisionHash: hash("b") },
    attemptId: "attempt-1",
    sourceLeaseId: "lease-1",
    sourceLeaseAuthorityKind: ContextLeaseAuthorityKind.InvestigationShadow,
    sourceFencingToken: "1",
    providerKind: ContextProviderKind.Codex,
    state: GatewaySessionState.Accepted,
  } as never;
}

function manifest(): ContextGatewayV4Manifest {
  return {
    manifestVersion: 3,
    gatewayPolicyVersion: "context-gateway-v4",
    gatewayBinaryHash: hash("9"),
    checkoutTreeOid: "1".repeat(40),
    eventChainSeedHash: hash("8"),
    authenticatedChainHash: hash("7"),
    complete: true,
    confinementTainted: false,
    terminalFailureClass: null,
    events: [
      {
        sequence: 1,
        previousEventHash: hash("8"),
        eventHash: hash("6"),
        operationKey: hash("5"),
        operationKind: ContextGatewayV4OperationKind.FileRead,
        outcome: ContextGatewayV4OutcomeKind.Succeeded,
        failureClass: null,
        operation: {
          kind: ContextGatewayV4OperationKind.FileRead,
          inputHash: hash("d"),
        },
        result: {
          revision: "head",
          treeOid: "1".repeat(40),
          pathHash: hash("e"),
          mode: "100644",
          blobOid: "2".repeat(40),
          contentHash: hash("4"),
          contentKind: "text",
          lineCount: 2,
          byteCount: 12,
          startByte: 0,
          eof: true,
          complete: true,
        },
        operationReceiptId: hash("3"),
        sanitizedReason: null,
      },
      {
        sequence: 2,
        previousEventHash: hash("6"),
        eventHash: hash("7"),
        operationKey: hash("2"),
        operationKind: ContextGatewayV4OperationKind.TextSearch,
        outcome: ContextGatewayV4OutcomeKind.Succeeded,
        failureClass: null,
        operation: {
          kind: ContextGatewayV4OperationKind.TextSearch,
          inputHash: hash("f"),
        },
        result: {
          treeOid: "1".repeat(40),
          queryDigest: hash("1"),
          cursorInputHash: null,
          pageOrdinal: 0,
          pageItemCount: 2,
          pageItemsHash: hash("0"),
          pagePathHashes: [hash("e")],
          aggregatePathCount: 1,
          aggregatePathSetHash: hash("f"),
          aggregateItemCount: 2,
          aggregateHash: hash("a"),
          complete: true,
          nextCursorHash: null,
        },
        operationReceiptId: hash("b"),
        sanitizedReason: null,
      },
    ],
  };
}
