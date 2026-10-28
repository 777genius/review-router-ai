import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
import {
  hindsightCleanupDigest,
  signHindsightCleanupReceipt,
  verifyHindsightCleanupReceipt,
  type HindsightCleanupProof,
} from "../../packages/features/memory/src/infrastructure/hindsight/hindsight-cleanup-receipt.ts";

const now = new Date("2026-10-23T12:10:00Z");
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const privatePem = privateKey
  .export({ type: "pkcs8", format: "pem" })
  .toString();
const publicPem = publicKey.export({ type: "spki", format: "pem" }).toString();
const binding = {
  namespace: "test",
  generation: "generation-2",
  scopeDigest: "a".repeat(64),
  bankIdDigest: "b".repeat(64),
  entryId: "entry-a",
  forgetCommandId: "778e12a2-40df-4f62-b9c5-27dbe5373924",
  imageDigest: `sha256:${"c".repeat(64)}`,
  pauseEpoch: "1",
};
const absence = (observedAt: string) => ({
  documentAbsent: true as const,
  sourceFactCount: 0 as const,
  evidenceSourceCount: 0 as const,
  operationPayloadCount: 0 as const,
  observedAt,
});
function proof(): HindsightCleanupProof {
  return {
    schema: "hindsight-cleanup-proof/v1",
    binding,
    profile: "docker-complete-inventory-v1",
    documentId: "entry-entry-a",
    deploymentInventoryDigest: "d".repeat(64),
    deploymentExecutorCount: 2,
    deploymentFence: {
      profile: "standalone-docker-flock-v1",
      heldAt: "2026-10-23T11:59:00Z",
      verifiedAt: "2026-10-23T12:06:30Z",
      swarmInactive: true,
      automaticRestartDisabled: true,
    },
    entryHistoryCoverage: {
      profile: "postgresql-trigger-ledger-v1",
      activationDigest: "1".repeat(64),
      definitionDigest: "2".repeat(64),
      sqlDigest: "3".repeat(64),
      installedAt: "2026-10-23T11:58:00Z",
      operationCount: 2,
      historicalObservationCount: 1,
    },
    sourceInventory: {
      operationCount: 2,
      digest: "a".repeat(64),
      sourceFactCount: 2,
      observationCount: 1,
      capturedAt: "2026-10-23T12:02:30Z",
    },
    pauseObservedAt: "2026-10-23T12:00:00Z",
    executors: ["e", "f"].map((character, index) => ({
      containerId: character.repeat(64),
      imageDigest: binding.imageDigest,
      databaseApplicationName: `native-worker-${index}`,
      pidBefore: 123 + index,
      pidAfter: 0,
      running: false,
      exitCode: 0,
      observedAt: "2026-10-23T12:01:00Z",
    })),
    sessionsClosedAt: "2026-10-23T12:02:00Z",
    openExecutorSessions: 0,
    cleanupApiImageDigest: binding.imageDigest,
    cleanupConfiguration: {
      workerEnabled: false,
      migrationsEnabled: false,
      consolidationReconcileSeconds: 0,
      mentalModelRefreshSeconds: 0,
      retentionSweepSeconds: 0,
      operationCleanupSeconds: 0,
    },
    queuedSentinel: {
      operationId: "38daf210-bf8d-42e5-a3d2-0ecfa518f11c",
      status: "pending",
      startedAt: "2026-10-23T12:03:00Z",
      endedAt: "2026-10-23T12:03:02Z",
      pollIntervalMs: 500,
      observedPolls: 3,
    },
    removedOperationIds: ["38daf210-bf8d-42e5-a3d2-0ecfa518f11c"],
    beforeRestart: absence("2026-10-23T12:04:00Z"),
    restartObservedAt: "2026-10-23T12:05:00Z",
    restartImageDigest: binding.imageDigest,
    afterRestart: absence("2026-10-23T12:06:00Z"),
    completedAt: "2026-10-23T12:07:00Z",
  };
}
const signed = (value = proof()) =>
  signHindsightCleanupReceipt(
    {
      ...value,
      deploymentInventoryDigest: hindsightCleanupDigest(
        value.executors
          .map((executor) => ({
            containerId: executor.containerId,
            imageDigest: executor.imageDigest,
            databaseApplicationName: executor.databaseApplicationName,
          }))
          .sort((a, b) => a.containerId.localeCompare(b.containerId)),
      ),
    },
    "operator-key-1",
    privatePem,
  );
const verify = (value: unknown, expected = binding, at = now) =>
  verifyHindsightCleanupReceipt(
    value,
    expected,
    { "operator-key-1": publicPem },
    at,
  );

test("real Ed25519 operator receipt binds complete native cleanup proof", () => {
  assert(verify(signed()));
});
test("receipt cannot cross scope, bank, generation, entry, image, command or pause", () => {
  const receipt = signed();
  for (const field of Object.keys(binding))
    assert(
      !verify(receipt, {
        ...binding,
        [field]: `${binding[field as keyof typeof binding]}changed`,
      }),
    );
});
test("receipt mutation and untrusted signing keys fail", () => {
  const receipt = signed();
  assert(
    !verify({
      ...receipt,
      proof: { ...receipt.proof, openExecutorSessions: 1 },
    }),
  );
  assert(!verify({ ...receipt, signature: "a".repeat(86) }));
  assert(!verify({ ...receipt, keyId: "untrusted" }));
});
test("signed but incomplete exit, session, maintenance or absence proof fails", () => {
  const variants = [
    { ...proof(), deploymentExecutorCount: 3 },
    {
      ...proof(),
      deploymentFence: {
        ...proof().deploymentFence,
        automaticRestartDisabled: false,
      },
    },
    {
      ...proof(),
      sourceInventory: { ...proof().sourceInventory, sourceFactCount: -1 },
    },
    {
      ...proof(),
      executors: proof().executors.map((executor) => ({
        ...executor,
        running: true,
      })),
    },
    { ...proof(), openExecutorSessions: 1 },
    {
      ...proof(),
      cleanupConfiguration: {
        ...proof().cleanupConfiguration,
        workerEnabled: true,
      },
    },
    {
      ...proof(),
      afterRestart: { ...proof().afterRestart, operationPayloadCount: 1 },
    },
    { ...proof(), removedOperationIds: [] },
    {
      ...proof(),
      queuedSentinel: { ...proof().queuedSentinel, status: "cancelled" },
    },
    {
      ...proof(),
      queuedSentinel: { ...proof().queuedSentinel, observedPolls: 1 },
    },
  ];
  for (const value of variants)
    assert(!verify(signed(value as HindsightCleanupProof)));
});
test("expired, future and wrongly ordered host proof fails", () => {
  assert(!verify(signed(), binding, new Date("2026-10-23T12:30:00Z")));
  assert(!verify(signed(), binding, new Date("2026-10-23T12:00:00Z")));
  assert(
    !verify(signed({ ...proof(), restartObservedAt: "2026-10-23T12:03:00Z" })),
  );
  assert(
    !verify(signed({ ...proof(), sessionsClosedAt: "2026-10-23T12:00:30Z" })),
  );
});
test("non-Ed25519 keys cannot sign cleanup receipts", () => {
  const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
  assert.throws(() =>
    signHindsightCleanupReceipt(
      proof(),
      "wrong-key",
      rsa.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    ),
  );
});

test("fresh ledger coverage is mandatory even when current native source facts are gone", () => {
  const value = proof();
  const empty = {
    ...value,
    sourceInventory: { ...value.sourceInventory, sourceFactCount: 0 },
  };
  assert(verify(signed(empty)));
  const legacy = Object.fromEntries(
    Object.entries(empty).filter(([key]) => key !== "entryHistoryCoverage"),
  );
  assert(!verify(signed(legacy as HindsightCleanupProof)));
});

test("signed ledger coverage must predate pause and bind valid complete inventory counts", () => {
  const value = proof();
  const coverage = value.entryHistoryCoverage;
  for (const entryHistoryCoverage of [
    { ...coverage, profile: "unverified-ledger" },
    { ...coverage, activationDigest: "1".repeat(64) + "\n" },
    { ...coverage, definitionDigest: "invalid" },
    { ...coverage, sqlDigest: "invalid" },
    { ...coverage, installedAt: "2026-10-23T12:00:01Z" },
    { ...coverage, installedAt: "invalid" },
    { ...coverage, operationCount: 1 },
    { ...coverage, operationCount: -1 },
    { ...coverage, operationCount: 1025 },
    { ...coverage, historicalObservationCount: 2 },
    { ...coverage, historicalObservationCount: -1 },
    { ...coverage, historicalObservationCount: 10001 },
    { ...coverage, historicalObservationCount: 0.5 },
  ])
    assert(
      !verify(
        signed({ ...value, entryHistoryCoverage } as HindsightCleanupProof),
      ),
    );
});

test("historical observation coverage counts distinct observations rather than history rows", () => {
  const value = proof();
  assert(
    verify(
      signed({
        ...value,
        entryHistoryCoverage: {
          ...value.entryHistoryCoverage,
          operationCount: 0,
          historicalObservationCount: 0,
        },
        sourceInventory: {
          ...value.sourceInventory,
          operationCount: 0,
          sourceFactCount: 0,
          observationCount: 0,
        },
      }),
    ),
  );
  assert(
    !verify(
      signed({
        ...value,
        sourceInventory: { ...value.sourceInventory, operationCount: 3 },
      }),
    ),
  );
  assert(
    !verify(
      signed({
        ...value,
        sourceInventory: { ...value.sourceInventory, observationCount: 0 },
      }),
    ),
  );
});
