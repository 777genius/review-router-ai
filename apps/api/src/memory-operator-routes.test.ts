import { createHash, generateKeyPairSync } from "node:crypto";
import Fastify from "fastify";
import type { PrismaClient } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MemoryKnowledgeRuntime } from "@reviewrouter/features-memory/composition";
import type { MemoryStoredCommand } from "../../../packages/features/memory/src/application/ports/memory-knowledge-store-port";
import {
  MemoryKnowledgeError,
  memoryKnowledgeDigest,
  memoryKnowledgeScopeKey,
  type MemoryKnowledgeScope,
} from "../../../packages/features/memory/src/domain/memory-knowledge";
import {
  createHindsightCleanupProofAdapter,
  HindsightCleanupProofAdapter,
} from "../../../packages/features/memory/src/infrastructure/hindsight/hindsight-cleanup-proof-adapter";
import {
  hindsightCleanupDigest,
  signHindsightCleanupReceipt,
  type HindsightCleanupBinding,
  type HindsightCleanupProof,
} from "../../../packages/features/memory/src/infrastructure/hindsight/hindsight-cleanup-receipt";
import { hindsightMemoryBankId } from "../../../packages/features/memory/src/infrastructure/hindsight/hindsight-scope";
import { validateMemoryOperatorCredentials } from "../../../packages/features/memory/src/infrastructure/config/memory-operator-config";
import { registerMemoryOperatorRoutes } from "./memory-operator-routes";

const now = new Date("2026-10-23T12:10:00Z");
const namespace = "operator-test";
const generation = "generation-1";
const imageDigest = `sha256:${"c".repeat(64)}`;
const commandId = "778e12a2-40df-4f62-b9c5-27dbe5373924";
const token = "separate-private-router-operator-token-123456789";
const keyId = "operator-test-key";
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const privatePem = privateKey
  .export({ type: "pkcs8", format: "pem" })
  .toString();
const publicPem = publicKey.export({ type: "spki", format: "pem" }).toString();
const scope: MemoryKnowledgeScope = {
  kind: "repository",
  workspaceId: "workspace-1",
  repositoryId: "repository-1",
};
const maintenance = { generation, epoch: "1", paused: true };
const adapter = () =>
  new HindsightCleanupProofAdapter({
    namespace,
    generation,
    imageDigest,
    publicKeys: { [keyId]: publicPem },
  });
function command(
  selectedScope: MemoryKnowledgeScope = scope,
): MemoryStoredCommand {
  return {
    operation: {
      id: commandId,
      ref: { type: "entry", scope: selectedScope, entryId: "entry-1" },
      revision: "3",
      state: "cleanup_pending",
    },
    digest: "a".repeat(64),
    envelope: null,
    contentApprovalRevision: "2",
    originalStatementAt: null,
    deliveryExpiresAt: "2026-10-23T13:00:00Z",
    resubmitUntil: "2026-10-23T13:00:00Z",
    approval: {
      actor: {
        kind: "system",
        id: "operator:test",
        githubUserId: null,
        login: null,
      },
      approvedAt: "2026-10-23T11:00:00Z",
      authorityRevision: "1",
    },
  };
}
function signed(binding: HindsightCleanupBinding) {
  const executors: HindsightCleanupProof["executors"] = ["e", "f"].map(
    (character, index) => ({
      containerId: character.repeat(64),
      imageDigest,
      databaseApplicationName: `native-${index}`,
      pidBefore: 100 + index,
      pidAfter: 0,
      running: false,
      exitCode: 0,
      observedAt: "2026-10-23T12:01:00Z",
    }),
  );
  const absence = (observedAt: string) => ({
    documentAbsent: true as const,
    sourceFactCount: 0 as const,
    evidenceSourceCount: 0 as const,
    operationPayloadCount: 0 as const,
    observedAt,
  });
  const proof: HindsightCleanupProof = {
    schema: "hindsight-cleanup-proof/v1",
    binding,
    profile: "docker-complete-inventory-v1",
    documentId: `entry-${binding.entryId}`,
    deploymentInventoryDigest: hindsightCleanupDigest(
      executors.map(
        ({ containerId, imageDigest, databaseApplicationName }) => ({
          containerId,
          imageDigest,
          databaseApplicationName,
        }),
      ),
    ),
    deploymentExecutorCount: 2,
    deploymentFence: {
      profile: "standalone-docker-flock-v1",
      heldAt: "2026-10-23T11:59:00Z",
      verifiedAt: "2026-10-23T12:06:30Z",
      swarmInactive: true,
      automaticRestartDisabled: true,
    },
    sourceInventory: {
      digest: "b".repeat(64),
      sourceFactCount: 2,
      observationCount: 1,
      capturedAt: "2026-10-23T12:02:30Z",
    },
    pauseObservedAt: "2026-10-23T12:00:00Z",
    executors,
    sessionsClosedAt: "2026-10-23T12:02:00Z",
    openExecutorSessions: 0,
    cleanupApiImageDigest: imageDigest,
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
    restartImageDigest: imageDigest,
    afterRestart: absence("2026-10-23T12:06:00Z"),
    completedAt: "2026-10-23T12:07:00Z",
  };
  return signHindsightCleanupReceipt(proof, keyId, privatePem);
}

/** HTTP/crypto contract tests: Prisma/store are controlled peers, not a PostgreSQL E2E. */
describe("private memory cleanup proof and operator HTTP contracts", () => {
  const apps: ReturnType<typeof Fastify>[] = [];
  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });
  async function fixture(
    options: {
      readonly verification?: boolean;
      readonly operatorToken?: string;
      readonly rowKind?: string;
      readonly rowGeneration?: string;
      readonly paused?: boolean;
      readonly state?: MemoryStoredCommand["operation"]["state"];
      readonly pendingCommandId?: string;
      readonly predecessorEntryId?: string;
      readonly predecessorRevision?: string;
      readonly revocationCommandId?: string;
      readonly entryRevision?: number;
    } = {},
  ) {
    const original = command();
    const stored = {
      ...original,
      operation: {
        ...original.operation,
        state: options.state ?? original.operation.state,
      },
    };
    const predecessor: MemoryStoredCommand = {
      ...stored,
      operation: {
        ...stored.operation,
        id: options.pendingCommandId ?? commandId,
        ref: {
          ...stored.operation.ref,
          entryId: options.predecessorEntryId ?? stored.operation.ref.entryId,
        },
        revision: options.predecessorRevision ?? "2",
        state: "unknown",
      },
    };
    const store = {
      maintenanceState: vi.fn(async () => ({
        ...maintenance,
        paused: options.paused ?? true,
      })),
      findCommand: vi.fn(async (input: { commandId: string }) =>
        input.commandId === commandId ? stored : predecessor,
      ),
      setMaintenancePaused: vi.fn(async () => maintenance),
      completeCleanup: vi.fn(async () => ({
        ...stored.operation,
        state: "completed" as const,
      })),
    };
    const prisma = {
      memoryKnowledgeCommand: {
        findUnique: vi.fn(async () => ({
          id: commandId,
          generation: options.rowGeneration ?? generation,
          commandKind: options.rowKind ?? "forget",
          scopeKey: memoryKnowledgeScopeKey(scope),
          entryId: "entry-1",
          revision: 3,
        })),
      },
      memoryKnowledgeEntry: {
        findUnique: vi.fn(async () => ({
          metadata: { ref: stored.operation.ref },
          lifecycle: "forget_pending",
          revision: options.entryRevision ?? 3,
          pendingCommandId: options.pendingCommandId ?? commandId,
          revocationCommandId: options.revocationCommandId ?? commandId,
        })),
      },
    };
    const proof = options.verification === false ? null : adapter();
    const runtime = {
      enabled: true,
      generation,
      store,
      cleanupProof: proof,
    } as unknown as MemoryKnowledgeRuntime;
    const app = Fastify({ logger: false });
    apps.push(app);
    await registerMemoryOperatorRoutes(app, {
      prisma: prisma as unknown as PrismaClient,
      runtime,
      operatorToken: options.operatorToken ?? token,
      now: () => now,
    });
    return { app, store, prisma, proof, stored };
  }
  const auth = { authorization: `Bearer ${token}` };

  it("derives exact CLI scope/bank bindings from the server command and translates real Ed25519 evidence to a neutral receipt", () => {
    const selected = adapter();
    const stored = command();
    const binding = selected.describe({ command: stored, maintenance });
    expect(binding.scopeDigest).toBe(
      memoryKnowledgeDigest(memoryKnowledgeScopeKey(scope)),
    );
    const bank = hindsightMemoryBankId({ namespace, generation }, scope);
    expect(binding.bankIdDigest).toBe(
      createHash("sha256").update(bank).digest("hex"),
    );
    const proof = signed(binding);
    const verified = selected.verify({
      command: stored,
      maintenance,
      proof,
      now,
    });
    expect(verified).toEqual({
      id: hindsightCleanupDigest(proof.proof),
      commandId,
      commandDigest: stored.digest,
      generation,
      ref: stored.operation.ref,
      verifiedAt: now.toISOString(),
      verifiedBy: `memory-cleanup:${keyId}`,
      maintenanceEpoch: "1",
    });
    for (const alternate of [
      { ...scope, workspaceId: "another-workspace" },
      {
        kind: "repository" as const,
        workspaceId: scope.workspaceId,
        repositoryId: "another-repository",
      },
      {
        kind: "user_preference" as const,
        workspaceId: scope.workspaceId,
        userId: "another-user",
      },
    ])
      expect(
        selected.verify({
          command: command(alternate),
          maintenance,
          proof,
          now,
        }),
      ).toBeNull();
    expect(
      selected.verify({
        command: stored,
        maintenance: { ...maintenance, epoch: "3" },
        proof,
        now,
      }),
    ).toBeNull();
    expect(() =>
      selected.describe({
        command: stored,
        maintenance: { ...maintenance, paused: false },
      }),
    ).toThrow(MemoryKnowledgeError);
  });

  it("missing configuration leaves receipt settlement disabled and malformed key/image maps fail local configuration", () => {
    expect(
      createHindsightCleanupProofAdapter({ namespace, generation }, {}),
    ).toBeNull();
    for (const env of [
      { REVIEW_ROUTER_MEMORY_HINDSIGHT_IMAGE_DIGEST: imageDigest },
      {
        REVIEW_ROUTER_MEMORY_HINDSIGHT_IMAGE_DIGEST: "mutable:latest",
        REVIEW_ROUTER_MEMORY_CLEANUP_PUBLIC_KEYS: JSON.stringify({
          [keyId]: publicPem,
        }),
      },
      {
        REVIEW_ROUTER_MEMORY_HINDSIGHT_IMAGE_DIGEST: imageDigest,
        REVIEW_ROUTER_MEMORY_CLEANUP_PUBLIC_KEYS: "{}",
      },
    ])
      expect(() =>
        createHindsightCleanupProofAdapter({ namespace, generation }, env),
      ).toThrow("memory_cleanup_configuration_invalid");
  });

  it("operator ingress is optional but a configured credential must be bounded and separate from the native key", () => {
    expect(() =>
      validateMemoryOperatorCredentials({
        operatorToken: undefined,
        nativeServiceKey: token,
      }),
    ).not.toThrow();
    expect(() =>
      validateMemoryOperatorCredentials({
        operatorToken: token,
        nativeServiceKey: "another-native-key",
      }),
    ).not.toThrow();
    for (const operatorToken of [token, "too-short", "x".repeat(8_193)])
      expect(() =>
        validateMemoryOperatorCredentials({
          operatorToken,
          nativeServiceKey: token,
        }),
      ).toThrow("memory_operator_configuration_invalid");
  });

  it("rejects missing, wrong and short operator credentials before any metadata or maintenance read", async () => {
    const { app, prisma, store } = await fixture();
    for (const headers of [
      {},
      { authorization: "Bearer untrusted" },
      { authorization: `Bearer ${token}trailing` },
    ]) {
      const response = await app.inject({
        method: "GET",
        url: `/api/internal/memory/cleanup/${commandId}`,
        headers,
      });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({ code: "memory_forbidden" });
      expect(response.headers["cache-control"]).toBe("private, no-store");
    }
    expect(prisma.memoryKnowledgeCommand.findUnique).not.toHaveBeenCalled();
    expect(store.maintenanceState).not.toHaveBeenCalled();
    const short = await fixture({ operatorToken: "short" });
    expect(
      (
        await short.app.inject({
          method: "GET",
          url: "/api/internal/memory/maintenance",
          headers: { authorization: "Bearer short" },
        })
      ).statusCode,
    ).toBe(403);
  });

  it("returns live server-derived binding/maintenance and rejects other generation, command kind or resumed state", async () => {
    const { app, proof, stored } = await fixture();
    const response = await app.inject({
      method: "GET",
      url: `/api/internal/memory/cleanup/${commandId}`,
      headers: auth,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      binding: proof!.describe({ command: stored, maintenance }),
      submissionsPaused: true,
      maintenance,
    });
    for (const [options, expected] of [
      [{ rowGeneration: "old-generation" }, 404],
      [{ rowKind: "save" }, 404],
      [{ paused: false }, 409],
      [{ state: "queued", revocationCommandId: "another-command" }, 409],
      [{ state: "queued", entryRevision: 4 }, 409],
      [
        {
          state: "queued",
          pendingCommandId: "prior-command",
          predecessorEntryId: "another-entry",
        },
        409,
      ],
      [
        {
          state: "queued",
          pendingCommandId: "prior-command",
          predecessorRevision: "1",
        },
        409,
      ],
    ] as const) {
      const item = await fixture(options);
      expect(
        (
          await item.app.inject({
            method: "GET",
            url: `/api/internal/memory/cleanup/${commandId}`,
            headers: auth,
          })
        ).statusCode,
      ).toBe(expected);
    }
  });

  it.each(["cleanup_pending", "queued"] as const)(
    "accepts only actual signed evidence for %s Forget and forwards its server digest/current epoch to atomic settlement",
    async (state) => {
      const { app, proof, stored, store } = await fixture({
        state,
        ...(state === "queued" ? { pendingCommandId: "prior-command" } : {}),
      });
      const binding = await app.inject({
        method: "GET",
        url: `/api/internal/memory/cleanup/${commandId}`,
        headers: auth,
      });
      expect(binding.statusCode).toBe(200);
      const receipt = signed(proof!.describe({ command: stored, maintenance }));
      const result = await app.inject({
        method: "POST",
        url: `/api/internal/memory/cleanup/${commandId}/receipt`,
        headers: auth,
        payload: receipt,
      });
      expect(result.statusCode).toBe(200);
      expect(result.json()).toEqual({
        operationId: commandId,
        state: "completed",
      });
      expect(store.completeCleanup).toHaveBeenCalledWith({
        receipt: expect.objectContaining({
          commandDigest: stored.digest,
          maintenanceEpoch: "1",
          generation,
          ref: stored.operation.ref,
        }),
        now,
      });
      store.completeCleanup.mockClear();
      for (const payload of [
        { completed: true, privateBody: "operator-private-sentinel" },
        {
          ...receipt,
          proof: {
            ...receipt.proof,
            binding: { ...receipt.proof.binding, pauseEpoch: "3" },
          },
        },
        signed({ ...receipt.proof.binding, entryId: "different-entry" }),
      ]) {
        const response = await app.inject({
          method: "POST",
          url: `/api/internal/memory/cleanup/${commandId}/receipt`,
          headers: auth,
          payload,
        });
        expect(response.statusCode).toBe(400);
        expect(response.json()).toEqual({ code: "memory_invalid_input" });
        expect(response.body).not.toContain("operator-private-sentinel");
      }
      expect(store.completeCleanup).not.toHaveBeenCalled();
    },
  );

  it("awaits the real store pause/drain contract before responding and uses CAS/deadline arguments", async () => {
    const { app, store } = await fixture();
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    store.setMaintenancePaused.mockImplementation(async () => {
      await barrier;
      return maintenance;
    });
    let completed = false;
    const pending = app
      .inject({
        method: "POST",
        url: "/api/internal/memory/maintenance",
        headers: auth,
        payload: { paused: true, expectedEpoch: "0" },
      })
      .then((response) => {
        completed = true;
        return response;
      });
    await vi.waitFor(() =>
      expect(store.setMaintenancePaused).toHaveBeenCalled(),
    );
    expect(completed).toBe(false);
    release();
    expect((await pending).statusCode).toBe(200);
    expect(store.setMaintenancePaused).toHaveBeenCalledWith({
      paused: true,
      expectedEpoch: "0",
      generation,
      actor: "memory-cleanup-operator",
      now,
      deadlineAt: new Date(now.getTime() + 30_000),
    });
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/internal/memory/maintenance",
          headers: auth,
          payload: {
            paused: true,
            expectedEpoch: "0",
            callerClaimsDrained: true,
          },
        })
      ).statusCode,
    ).toBe(400);
  });

  it("normalizes store failures, stale settlement fences and missing verifier without leaking private diagnostics", async () => {
    const { app, store, proof, stored } = await fixture();
    store.maintenanceState.mockRejectedValueOnce(
      new Error("operator-private-sentinel postgres://private"),
    );
    const failed = await app.inject({
      method: "GET",
      url: "/api/internal/memory/maintenance",
      headers: auth,
    });
    expect(failed.statusCode).toBe(503);
    expect(failed.json()).toEqual({ code: "memory_unavailable" });
    expect(failed.body).not.toContain("operator-private-sentinel");
    store.completeCleanup.mockRejectedValueOnce(
      new MemoryKnowledgeError("conflict"),
    );
    const stale = await app.inject({
      method: "POST",
      url: `/api/internal/memory/cleanup/${commandId}/receipt`,
      headers: auth,
      payload: signed(proof!.describe({ command: stored, maintenance })),
    });
    expect(stale.statusCode).toBe(409);
    const disabled = await fixture({ verification: false });
    expect(
      (
        await disabled.app.inject({
          method: "GET",
          url: `/api/internal/memory/cleanup/${commandId}`,
          headers: auth,
        })
      ).statusCode,
    ).toBe(503);
    expect(disabled.store.completeCleanup).not.toHaveBeenCalled();
  });
});
