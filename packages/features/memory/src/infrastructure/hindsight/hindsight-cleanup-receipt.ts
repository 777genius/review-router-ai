import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
} from "node:crypto";

export interface HindsightCleanupBinding {
  readonly namespace: string;
  readonly generation: string;
  readonly scopeDigest: string;
  readonly bankIdDigest: string;
  readonly entryId: string;
  readonly forgetCommandId: string;
  readonly imageDigest: string;
  readonly pauseEpoch: string;
}

export interface HindsightCleanupAbsence {
  readonly documentAbsent: true;
  readonly sourceFactCount: 0;
  readonly evidenceSourceCount: 0;
  readonly operationPayloadCount: 0;
  readonly observedAt: string;
}

export interface HindsightCleanupProof {
  readonly schema: "hindsight-cleanup-proof/v1";
  readonly binding: HindsightCleanupBinding;
  readonly profile: "docker-complete-inventory-v1";
  readonly documentId: string;
  readonly deploymentInventoryDigest: string;
  readonly deploymentExecutorCount: number;
  readonly deploymentFence: {
    readonly profile: "standalone-docker-flock-v1";
    readonly heldAt: string;
    readonly verifiedAt: string;
    readonly swarmInactive: true;
    readonly automaticRestartDisabled: true;
  };
  readonly sourceInventory: {
    readonly digest: string;
    readonly sourceFactCount: number;
    readonly observationCount: number;
    readonly capturedAt: string;
  };
  readonly pauseObservedAt: string;
  readonly executors: readonly {
    readonly containerId: string;
    readonly imageDigest: string;
    readonly databaseApplicationName: string;
    readonly pidBefore: number;
    readonly pidAfter: 0;
    readonly running: false;
    readonly exitCode: number;
    readonly observedAt: string;
  }[];
  readonly sessionsClosedAt: string;
  readonly openExecutorSessions: 0;
  readonly cleanupApiImageDigest: string;
  readonly cleanupConfiguration: {
    readonly workerEnabled: false;
    readonly migrationsEnabled: false;
    readonly consolidationReconcileSeconds: 0;
    readonly mentalModelRefreshSeconds: 0;
    readonly retentionSweepSeconds: 0;
    readonly operationCleanupSeconds: 0;
  };
  readonly queuedSentinel: {
    readonly operationId: string;
    readonly status: "pending";
    readonly startedAt: string;
    readonly endedAt: string;
    readonly pollIntervalMs: number;
    readonly observedPolls: number;
  };
  readonly removedOperationIds: readonly string[];
  readonly beforeRestart: HindsightCleanupAbsence;
  readonly restartObservedAt: string;
  readonly restartImageDigest: string;
  readonly afterRestart: HindsightCleanupAbsence;
  readonly completedAt: string;
}

export interface SignedHindsightCleanupReceipt {
  readonly keyId: string;
  readonly proof: HindsightCleanupProof;
  readonly signature: string;
}

/** One deterministic encoding shared by the private signer and verifier. */
export function canonicalHindsightCleanup(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value))
    return JSON.stringify(value);
  if (Array.isArray(value))
    return `[${value.map(canonicalHindsightCleanup).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(
        ([key, item]) =>
          `${JSON.stringify(key)}:${canonicalHindsightCleanup(item)}`,
      )
      .join(",")}}`;
  throw new Error("Invalid cleanup receipt value");
}

export const hindsightCleanupDigest = (value: unknown): string =>
  createHash("sha256").update(canonicalHindsightCleanup(value)).digest("hex");
export const hindsightCleanupBankDigest = (bankId: string): string =>
  createHash("sha256").update(bankId).digest("hex");
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const digest = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const image = (value: unknown): value is string =>
  typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
const uuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const time = (value: unknown): number =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)
    ? Date.parse(value)
    : NaN;
const text = (value: unknown): value is string =>
  typeof value === "string" && /^[a-zA-Z0-9_.:-]{1,200}$/.test(value);
const integer = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" &&
  Number.isSafeInteger(value) &&
  value >= min &&
  value <= max;

/**
 * This verifies signed host evidence, never customer assertions. The application
 * must derive expected binding from its stored forget command and atomically
 * recheck the live global pause/fence before settling the command.
 */
export function verifyHindsightCleanupReceipt(
  input: unknown,
  expected: HindsightCleanupBinding,
  publicKeys: Readonly<Record<string, string>>,
  now: Date,
): input is SignedHindsightCleanupReceipt {
  try {
    if (
      !object(input) ||
      !text(input.keyId) ||
      !/^[a-zA-Z0-9_-]{1,64}$/.test(input.keyId) ||
      typeof input.signature !== "string" ||
      !/^[A-Za-z0-9_-]{86}$/.test(input.signature) ||
      !object(input.proof)
    )
      return false;
    const proof = input.proof;
    const encoded = canonicalHindsightCleanup(proof);
    if (
      encoded.length > 65_536 ||
      proof.schema !== "hindsight-cleanup-proof/v1" ||
      proof.profile !== "docker-complete-inventory-v1" ||
      !object(proof.binding)
    )
      return false;
    if (
      canonicalHindsightCleanup(proof.binding) !==
        canonicalHindsightCleanup(expected) ||
      !text(expected.namespace) ||
      !text(expected.generation) ||
      !text(expected.entryId) ||
      !/^(0|[1-9][0-9]*)$/.test(expected.pauseEpoch) ||
      !uuid(expected.forgetCommandId) ||
      !digest(expected.scopeDigest) ||
      !digest(expected.bankIdDigest) ||
      !image(expected.imageDigest)
    )
      return false;
    const publicKeyPem = publicKeys[input.keyId];
    if (!publicKeyPem) return false;
    const key = createPublicKey(publicKeyPem);
    if (
      key.asymmetricKeyType !== "ed25519" ||
      !verify(
        null,
        Buffer.from(encoded),
        key,
        Buffer.from(input.signature, "base64url"),
      )
    )
      return false;
    if (
      proof.documentId !== `entry-${expected.entryId}` ||
      !digest(proof.deploymentInventoryDigest) ||
      !integer(proof.deploymentExecutorCount, 1, 64) ||
      !Array.isArray(proof.executors) ||
      proof.executors.length !== proof.deploymentExecutorCount
    )
      return false;
    const paused = time(proof.pauseObservedAt);
    const sessions = time(proof.sessionsClosedAt);
    const completed = time(proof.completedAt);
    const current = now.getTime();
    if (
      ![paused, sessions, completed, current].every(Number.isFinite) ||
      current - completed > 15 * 60_000 ||
      completed > current + 30_000 ||
      completed < paused ||
      paused > sessions ||
      proof.openExecutorSessions !== 0
    )
      return false;
    const ids = new Set<string>();
    const applications = new Set<string>();
    for (const executor of proof.executors) {
      if (
        !object(executor) ||
        !digest(executor.containerId) ||
        ids.has(executor.containerId) ||
        executor.imageDigest !== expected.imageDigest ||
        !text(executor.databaseApplicationName) ||
        applications.has(executor.databaseApplicationName) ||
        !integer(executor.pidBefore, 0, 2 ** 31 - 1) ||
        executor.pidAfter !== 0 ||
        executor.running !== false ||
        !integer(executor.exitCode, 0, 255)
      )
        return false;
      const observed = time(executor.observedAt);
      if (
        !Number.isFinite(observed) ||
        observed < paused ||
        observed > sessions
      )
        return false;
      ids.add(executor.containerId);
      applications.add(executor.databaseApplicationName);
    }
    const inventory = proof.executors
      .map((executor) => ({
        containerId: executor.containerId,
        imageDigest: executor.imageDigest,
        databaseApplicationName: executor.databaseApplicationName,
      }))
      .sort((a, b) =>
        String(a.containerId).localeCompare(String(b.containerId)),
      );
    if (hindsightCleanupDigest(inventory) !== proof.deploymentInventoryDigest)
      return false;
    const config = proof.cleanupConfiguration;
    if (
      proof.cleanupApiImageDigest !== expected.imageDigest ||
      proof.restartImageDigest !== expected.imageDigest ||
      !object(config) ||
      config.workerEnabled !== false ||
      config.migrationsEnabled !== false ||
      config.consolidationReconcileSeconds !== 0 ||
      config.mentalModelRefreshSeconds !== 0 ||
      config.retentionSweepSeconds !== 0 ||
      config.operationCleanupSeconds !== 0
    )
      return false;
    const sentinel = proof.queuedSentinel;
    if (
      !object(sentinel) ||
      !uuid(sentinel.operationId) ||
      sentinel.status !== "pending" ||
      !integer(sentinel.pollIntervalMs, 100, 10_000) ||
      !integer(sentinel.observedPolls, 3, 100)
    )
      return false;
    const sentinelStart = time(sentinel.startedAt);
    const sentinelEnd = time(sentinel.endedAt);
    if (
      !Number.isFinite(sentinelStart) ||
      !Number.isFinite(sentinelEnd) ||
      sentinelStart < sessions ||
      sentinelEnd - sentinelStart <
        sentinel.pollIntervalMs * sentinel.observedPolls
    )
      return false;
    if (
      !Array.isArray(proof.removedOperationIds) ||
      proof.removedOperationIds.length > 4096 ||
      !proof.removedOperationIds.every(uuid) ||
      new Set(proof.removedOperationIds).size !==
        proof.removedOperationIds.length ||
      !proof.removedOperationIds.includes(sentinel.operationId)
    )
      return false;
    const absence = (value: unknown): value is HindsightCleanupAbsence =>
      object(value) &&
      value.documentAbsent === true &&
      value.sourceFactCount === 0 &&
      value.evidenceSourceCount === 0 &&
      value.operationPayloadCount === 0 &&
      Number.isFinite(time(value.observedAt));
    if (!absence(proof.beforeRestart) || !absence(proof.afterRestart))
      return false;
    const before = time(proof.beforeRestart.observedAt);
    const restarted = time(proof.restartObservedAt);
    const after = time(proof.afterRestart.observedAt);
    const fence = proof.deploymentFence;
    const sources = proof.sourceInventory;
    if (
      !object(fence) ||
      fence.profile !== "standalone-docker-flock-v1" ||
      fence.swarmInactive !== true ||
      fence.automaticRestartDisabled !== true ||
      !object(sources) ||
      !digest(sources.digest) ||
      !integer(sources.sourceFactCount, 1, 10_000) ||
      !integer(sources.observationCount, 0, 10_000)
    )
      return false;
    const held = time(fence.heldAt);
    const verified = time(fence.verifiedAt);
    const captured = time(sources.capturedAt);
    return (
      [held, verified, captured, restarted].every(Number.isFinite) &&
      held <= paused &&
      after <= verified &&
      verified <= completed &&
      captured <= before &&
      sentinelEnd <= before &&
      before <= restarted &&
      restarted + 3 * sentinel.pollIntervalMs <= after &&
      after <= completed
    );
  } catch {
    return false;
  }
}

/** Private operator tooling only; the native API key is never a signing key. */
export function signHindsightCleanupReceipt(
  proof: HindsightCleanupProof,
  keyId: string,
  privateKeyPem: string,
): SignedHindsightCleanupReceipt {
  const key = createPrivateKey(privateKeyPem);
  if (key.asymmetricKeyType !== "ed25519")
    throw new Error("Cleanup signing requires Ed25519");
  return {
    keyId,
    proof,
    signature: sign(
      null,
      Buffer.from(canonicalHindsightCleanup(proof)),
      key,
    ).toString("base64url"),
  };
}
