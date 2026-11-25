import { createHash, createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  ContextGatewayV4OperationKind,
  ContextGatewayV4OutcomeKind,
  ContextLeaseAuthorityKind,
  ContextProviderKind,
  activateGatewaySession,
  createContextGatewayV4Manifest,
  decideContextGatewayV4Replay,
  openGatewaySession,
  type ContextGatewayV4Event,
} from "@reviewrouter/features-review-context-attestation";
import { stableJson } from "@reviewrouter/features-review-evidence";
import {
  canonicalizeReviewContextReplayChainSeed,
  canonicalizeReviewContextReplayEvent,
} from "@reviewrouter/protocol-review-action-v2";
import {
  parseReplayMaterial,
  selectGatewayV4ReplayOperations,
  targetManifestMatchesGatewayV4Plan,
  verifyGatewayTranscript,
  verifySyntheticGatewayV4ReplayChain,
} from "./review-action-v2-context-attestation-replay-material.js";

const sessionSecret = Buffer.alloc(32, 7);
const sourceTree = "a".repeat(40);
const targetTree = "b".repeat(40);
const planHash = hash("plan");
const attestationId = "attestation-replay-order";
const targetRevisionHash = hash("target-revision");
const session = activateGatewaySession(
  openGatewaySession({
    sessionId: "session-replay-order",
    scope: {
      workspaceId: "workspace-1",
      repositoryConnectionId: "connection-1",
      scmRepositoryIdentityId: "repository-1",
      pullRequestNumber: 42,
    },
    sourceRevision: {
      baseSha: sourceTree,
      mergeBaseSha: sourceTree,
      headSha: sourceTree,
      reviewRevisionHash: hash("source-revision"),
      checkoutTreeOid: sourceTree,
    },
    sourceExecutionId: "execution-source",
    sourceWorkSlotId: "slot-1",
    attemptId: "attempt-1",
    openingIntentHash: hash("opening"),
    sourceLeaseAuthorityKind: ContextLeaseAuthorityKind.InvestigationShadow,
    sourceLeaseId: "lease-1",
    sourceFencingToken: "1",
    providerKind: ContextProviderKind.Codex,
    requestedModel: "test-model",
    trustedCapabilityProfile: "context-gateway-v4",
    gatewayBinaryHash: hash("binary"),
    gatewayPolicyVersion: "context-gateway-v4",
    producerReleaseId: "release-1",
    selectedProtocolVersion: "2.1",
    confinementProofHash: hash("confinement"),
    eventChainSeedHash: hash("source-seed"),
    openedAtMs: 1_000,
    expiresAtMs: 61_000,
  }),
  1_000,
);

type ReplaySpec = Readonly<{
  operationKind: ContextGatewayV4OperationKind;
  replayInput: Readonly<Record<string, unknown>>;
  result: Readonly<Record<string, unknown>>;
}>;

describe("Gateway v4 replay operation order", () => {
  it("replays interleaved partial file reads in their authenticated order", () => {
    const specs = [file("A.ts", 0), file("B.ts", 0), file("A.ts", 8)];
    const source = sourceTranscript(specs);
    const receiptIds = source.manifest.events.slice(0, 2).map(receiptId);
    const operations = selectGatewayV4ReplayOperations(
      source.manifest,
      source.material,
      receiptIds,
    );

    expect(operations?.map((operation) => operation.replayInput)).toEqual(
      specs.map((spec) => spec.replayInput),
    );
    const target = replayManifest(source.manifest.events);
    expect(targetManifestMatchesGatewayV4Plan(target, operations!)).toBe(true);
    expect(
      decideContextGatewayV4Replay(source.manifest, target, receiptIds),
    ).toMatchObject({ status: "matched" });

    const reordered = replayManifest([
      source.manifest.events[0]!,
      source.manifest.events[2]!,
      source.manifest.events[1]!,
    ]);
    expect(targetManifestMatchesGatewayV4Plan(reordered, operations!)).toBe(
      false,
    );
    expect(
      decideContextGatewayV4Replay(source.manifest, reordered, receiptIds),
    ).toMatchObject({ status: "denied", reason: "operation_mismatch" });
  });

  it.each([
    ContextGatewayV4OperationKind.DirectoryList,
    ContextGatewayV4OperationKind.TextSearch,
    ContextGatewayV4OperationKind.CanonicalInventory,
  ])("preserves repeated complete %s sequences around a file read", (kind) => {
    const first = page(kind, 0, false);
    const last = page(kind, 1, true);
    const middle = file("A.ts", 0);
    const source = sourceTranscript([first, last, middle, first, last]);
    const receiptIds = [
      receiptId(source.manifest.events[0]!),
      receiptId(source.manifest.events[2]!),
    ];
    const operations = selectGatewayV4ReplayOperations(
      source.manifest,
      source.material,
      receiptIds,
    );
    const { cursor, ...firstInput } = first.replayInput;
    void cursor;
    expect(operations?.map((operation) => operation.replayInput)).toEqual([
      firstInput,
      middle.replayInput,
      firstInput,
    ]);
    const target = replayManifest(source.manifest.events);
    expect(targetManifestMatchesGatewayV4Plan(target, operations!)).toBe(true);
    expect(
      decideContextGatewayV4Replay(source.manifest, target, receiptIds),
    ).toMatchObject({ status: "matched" });

    const collapsed = replayManifest(source.manifest.events.slice(0, 3));
    expect(targetManifestMatchesGatewayV4Plan(collapsed, operations!)).toBe(
      false,
    );
    expect(
      decideContextGatewayV4Replay(source.manifest, collapsed, receiptIds),
    ).toMatchObject({ status: "denied", reason: "dependency_set_mismatch" });
  });

  it("declines a selected page chain interleaved with another selected operation", () => {
    const source = sourceTranscript([
      page(ContextGatewayV4OperationKind.TextSearch, 0, false),
      file("A.ts", 0),
      page(ContextGatewayV4OperationKind.TextSearch, 1, true),
    ]);
    const receiptIds = source.manifest.events.map(receiptId);
    expect(
      selectGatewayV4ReplayOperations(
        source.manifest,
        source.material,
        receiptIds,
      ),
    ).toBeNull();
    expect(
      decideContextGatewayV4Replay(
        source.manifest,
        replayManifest(source.manifest.events),
        receiptIds,
      ),
    ).toMatchObject({ status: "matched" });
  });

  it("ignores unselected operations between selected pages", () => {
    const source = sourceTranscript([
      page(ContextGatewayV4OperationKind.TextSearch, 0, false),
      file("A.ts", 0),
      page(ContextGatewayV4OperationKind.TextSearch, 1, true),
    ]);
    const receiptIds = [receiptId(source.manifest.events[0]!)];
    const operations = selectGatewayV4ReplayOperations(
      source.manifest,
      source.material,
      receiptIds,
    );
    expect(operations).toHaveLength(1);
    const target = replayManifest([
      source.manifest.events[0]!,
      source.manifest.events[2]!,
    ]);
    expect(targetManifestMatchesGatewayV4Plan(target, operations!)).toBe(true);
    expect(
      decideContextGatewayV4Replay(source.manifest, target, receiptIds),
    ).toMatchObject({ status: "matched" });
  });

  it("rejects missing replay input and a receipt outside the source transcript", () => {
    const source = sourceTranscript([file("A.ts", 0)]);
    expect(
      selectGatewayV4ReplayOperations(source.manifest, source.material, [
        hash("unknown"),
      ]),
    ).toBeNull();
    expect(
      selectGatewayV4ReplayOperations(
        source.manifest,
        { ...source.material, entries: [] },
        source.manifest.events.map(receiptId),
      ),
    ).toBeNull();
  });

  it("keeps HMAC, replay-chain, and result tampering rejected", () => {
    const source = sourceTranscript([file("A.ts", 0)]);
    const event = source.manifest.events[0]!;
    const changed = {
      ...event,
      result: { ...event.result!, contentHash: hash("changed-content") },
    };
    expect(() =>
      verifyGatewayTranscript(
        { ...session },
        { ...source.manifest, events: [changed] },
        sessionSecret,
      ),
    ).toThrow();
    const target = replayManifest([event]);
    expect(() =>
      verifySyntheticGatewayV4ReplayChain(
        {
          ...target,
          events: [{ ...target.events[0]!, result: changed.result }],
        },
        planHash,
        attestationId,
        targetRevisionHash,
        targetTree,
      ),
    ).toThrow();
    expect(
      decideContextGatewayV4Replay(source.manifest, replayManifest([changed]), [
        receiptId(event),
      ]),
    ).toMatchObject({ status: "denied", reason: "result_mismatch" });
  });
});

function file(path: string, startByte: number): ReplaySpec {
  return {
    operationKind: ContextGatewayV4OperationKind.FileRead,
    replayInput: { path, revision: "head", startByte, maxBytes: 4 },
    result: {
      revision: "head",
      treeOid: sourceTree,
      pathHash: hash(path),
      mode: "100644",
      blobOid: hash(path).slice(0, 40),
      contentHash: hash(`${path}:${startByte}`),
      byteCount: 4,
      startByte,
      eof: false,
      complete: false,
    },
  };
}

function page(
  operationKind: ContextGatewayV4OperationKind,
  pageOrdinal: number,
  complete: boolean,
): ReplaySpec {
  return {
    operationKind,
    replayInput: {
      ...(operationKind === ContextGatewayV4OperationKind.TextSearch
        ? { query: "needle", paths: [], revision: "head" }
        : operationKind === ContextGatewayV4OperationKind.DirectoryList
          ? { path: "src", revision: "head" }
          : {}),
      cursor: pageOrdinal === 0 ? null : "page-cursor",
      pageSize: 10,
    },
    result: {
      treeOid: sourceTree,
      queryDigest: hash(`query:${operationKind}`),
      pageItemsHash: hash(`items:${pageOrdinal}`),
      aggregateHash: hash(`aggregate:${pageOrdinal}`),
      aggregatePathSetHash: hash(`paths:${pageOrdinal}`),
      cursorInputHash: pageOrdinal === 0 ? null : hash("page-cursor"),
      nextCursorHash: complete ? null : hash("page-cursor"),
      pagePathHashes: [hash(`path:${pageOrdinal}`)],
      pageOrdinal,
      pageItemCount: 1,
      aggregateItemCount: pageOrdinal + 1,
      aggregatePathCount: pageOrdinal + 1,
      complete,
    },
  };
}

function sourceTranscript(specs: readonly ReplaySpec[]) {
  let previous = session.eventChainSeedHash;
  const events = specs.map((spec, index): ContextGatewayV4Event => {
    const normalizedInput =
      spec.operationKind === ContextGatewayV4OperationKind.FileRead
        ? spec.replayInput
        : {
            ...spec.replayInput,
            ...(spec.operationKind === ContextGatewayV4OperationKind.TextSearch
              ? { query: hash(String(spec.replayInput.query)) }
              : {}),
            cursor:
              typeof spec.replayInput.cursor === "string"
                ? hash(spec.replayInput.cursor)
                : null,
          };
    const operation = {
      kind: spec.operationKind,
      inputHash: hash(stableJson(normalizedInput as never)),
    };
    const identity = {
      sessionId: session.sessionId,
      sequence: index + 1,
      previousEventHash: previous,
      operationKey: hash(stableJson(operation)),
      outcome: ContextGatewayV4OutcomeKind.Succeeded,
      failureClass: null,
      operation,
      result: spec.result,
      operationReceiptId: hash(`receipt:${index}`),
      sanitizedReason: null,
    };
    const eventHash = createHmac("sha256", sessionSecret)
      .update(stableJson(identity as never))
      .digest("hex");
    previous = eventHash;
    const { sessionId, ...event } = identity;
    void sessionId;
    return { ...event, operationKind: spec.operationKind, eventHash };
  });
  const manifest = createContextGatewayV4Manifest({
    manifestVersion: 3,
    gatewayPolicyVersion: "context-gateway-v4",
    gatewayBinaryHash: session.gatewayBinaryHash,
    checkoutTreeOid: sourceTree,
    eventChainSeedHash: session.eventChainSeedHash,
    authenticatedChainHash: previous,
    complete: true,
    confinementTainted: false,
    terminalFailureClass: null,
    events,
  });
  verifyGatewayTranscript(session, manifest, sessionSecret);
  const material = parseReplayMaterial(
    stableJson({
      replayMaterialVersion: 2,
      sessionId: session.sessionId,
      entries: events.map((event, index) => ({
        sequence: event.sequence,
        operationReceiptId: event.operationReceiptId,
        operationKey: event.operationKey,
        operationKind: event.operationKind,
        replayInput: specs[index]!.replayInput,
      })),
    } as never),
    manifest,
    session,
    sessionSecret,
  );
  if (!("entries" in material)) throw new Error("v4_material_missing");
  return { manifest, material };
}

function replayManifest(sourceEvents: readonly ContextGatewayV4Event[]) {
  const seed = hash(
    canonicalizeReviewContextReplayChainSeed({
      planHash,
      attestationId,
      targetReviewRevisionHash: targetRevisionHash,
      targetCheckoutTreeOid: targetTree,
    }),
  );
  let previous = seed;
  const events = sourceEvents.map((source, index): ContextGatewayV4Event => {
    const event = {
      sequence: index + 1,
      previousEventHash: previous,
      operationKey: source.operationKey,
      operation: source.operation,
      result: { ...source.result!, treeOid: targetTree },
    };
    const eventHash = hash(canonicalizeReviewContextReplayEvent(event));
    previous = eventHash;
    return {
      ...source,
      ...event,
      eventHash,
      operationReceiptId: hash(`target-receipt:${index}`),
    };
  });
  const manifest = createContextGatewayV4Manifest({
    manifestVersion: 3,
    gatewayPolicyVersion: "context-gateway-v4",
    gatewayBinaryHash: session.gatewayBinaryHash,
    checkoutTreeOid: targetTree,
    eventChainSeedHash: seed,
    authenticatedChainHash: previous,
    complete: true,
    confinementTainted: false,
    terminalFailureClass: null,
    events,
  });
  verifySyntheticGatewayV4ReplayChain(
    manifest,
    planHash,
    attestationId,
    targetRevisionHash,
    targetTree,
  );
  return manifest;
}

function receiptId(event: ContextGatewayV4Event): string {
  if (event.operationReceiptId === null) throw new Error("receipt_missing");
  return event.operationReceiptId;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
