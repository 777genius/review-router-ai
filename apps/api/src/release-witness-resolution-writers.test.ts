import { createHash, generateKeyPairSync } from "node:crypto";
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import {
  SignedResolutionWriterQualification,
  resolutionWriterWitnessDigest,
  verifyResolutionWriterWitness,
} from "@reviewrouter/features-review-publishing/v2/composition";
import {
  ensureResolutionHistoryActivated,
  type ResolutionHistoryCut,
  type ResolutionWriterWitnessBinding,
  type ManagedResolutionWriterDrainQualification,
} from "@reviewrouter/features-review-publishing/v2";
import { controlledRetiredWriterProof } from "../../../packages/features/review-publishing/src/v2/tests/resolution-history-fixtures";
import { Ed25519ReleaseWitnessSignerAdapter } from "./release-witness-adapters";
import { AttestResolutionWriterQualification } from "./release-witness-resolution-writers";
import { registerReleaseWitnessRoutes } from "./release-witness-routes";
import type { ObserveRunnerCleanup } from "./release-witness-application";
import { prepareReviewResolutionHistory } from "./review-resolution-history";

const scope = {
  workspaceId: "workspace",
  repositoryConnectionId: "repository",
  scmRepositoryIdentityId: "scm",
  pullRequestNumber: 1,
};
const keys = generateKeyPairSync("ed25519");
const trust = {
  keyId: "test-release-witness",
  publicKeyPem: keys.publicKey
    .export({ type: "spki", format: "pem" })
    .toString(),
  maximumAgeMilliseconds: 60_000,
};
const signer = new Ed25519ReleaseWitnessSignerAdapter(
  trust.keyId,
  keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
);
const binding: ResolutionWriterWitnessBinding = {
  environmentId: "isolated-test",
  deploymentRevision: "a".repeat(40),
  artifactDigest: `sha256:${"b".repeat(64)}`,
  fleetDigest: "c".repeat(64),
  database: {
    serverIdentity: "123456",
    databaseIdentity: "16384",
    databaseName: "unification_test",
    recoveryWitnessSha256: "d".repeat(64),
  },
};

async function fixture() {
  const now = new Date();
  const proof = controlledRetiredWriterProof();
  let current = true;
  const observation = vi.fn(async () => {
    if (!current) throw new Error("fleet_qualification_revoked");
    return { ...binding, proof, observedAt: now.toISOString() };
  });
  const attester = new AttestResolutionWriterQualification(
    { observe: observation },
    signer,
    { assertOrdinary: async () => {}, assertForceNew: async () => {} },
    () => now,
  );
  const app = Fastify();
  const token = "synthetic-witness-trigger";
  await registerReleaseWitnessRoutes(app, {
    observeCleanup: {} as ObserveRunnerCleanup,
    attestResolutionWriters: attester,
    triggerTokenSha256: createHash("sha256").update(token).digest("hex"),
  });
  const read = () =>
    app.inject({
      method: "GET",
      url: "/v1/resolution-writer-qualification",
      headers: { authorization: `Bearer ${token}` },
    });
  const writers = new SignedResolutionWriterQualification({
    trust,
    now: () => now,
    observeBinding: async () => binding,
    readWitness: async () => (await read()).json(),
  });
  return {
    now,
    proof,
    app,
    read,
    writers,
    revoke: () => {
      current = false;
    },
    observation,
  };
}

describe("purpose-bound resolution writer witness", () => {
  it("revalidates an existing managed-settlement cut without replacing it with retirement history", async () => {
    const now = new Date();
    const proof: ManagedResolutionWriterDrainQualification = {
      qualificationSource: "managed_executor_handler_settlement.v1",
      writerDigest: "e".repeat(64),
      executors: [
        {
          executorId: "settled-managed-handler",
          binaryDigest: "f".repeat(64),
          acceptsNewRequests: false,
          handlerSettlement: "terminal_or_exact_durable_pending",
        },
      ],
    };
    const attester = new AttestResolutionWriterQualification(
      { observe: async () => ({ ...binding, proof, observedAt: now.toISOString() }) },
      signer,
      { assertOrdinary: async () => {}, assertForceNew: async () => {} },
      () => now,
    );
    const receipt = await attester.execute();
    expect(verifyResolutionWriterWitness(receipt, binding, trust, now)?.proof)
      .toEqual(proof);
    const cut: ResolutionHistoryCut = {
      activatedAt: new Date(now.getTime() - 60_000).toISOString(),
      activationVersion: 1,
      writerDigest: proof.writerDigest,
    };
    const activation = {
      readActivation: async () => cut,
      beginDrain: vi.fn(),
      activate: vi.fn(),
    };
    const writers = new SignedResolutionWriterQualification({
      readWitness: async () => receipt,
      observeBinding: async () => binding,
      trust,
      now: () => now,
    });
    await expect(ensureResolutionHistoryActivated(scope, { activation, writers }))
      .resolves.toEqual({ status: "guarded" });
    const retired = controlledRetiredWriterProof();
    await expect(ensureResolutionHistoryActivated(scope, {
      activation,
      writers: { qualify: async () => ({ status: "qualified", proof: retired }) },
    })).resolves.toMatchObject({
      status: "unavailable",
      reasonCode: "resolution_activation_writer_conflict",
    });
    expect(activation.beginDrain).not.toHaveBeenCalled();
    expect(activation.activate).not.toHaveBeenCalled();
    expect(await activation.readActivation()).toBe(cut);

    // A valid signature cannot turn an idle counter or an accepting executor
    // into positive handler settlement evidence.
    for (const executor of [
      { ...proof.executors[0], handlerSettlement: "idle" },
      { ...proof.executors[0], acceptsNewRequests: true },
    ]) {
      const unsigned = {
        ...binding,
        purpose: receipt.purpose,
        observedAt: receipt.observedAt,
        expiresAt: receipt.expiresAt,
        proof: { ...proof, executors: [executor] } as ManagedResolutionWriterDrainQualification,
      };
      const bindingSha256 = resolutionWriterWitnessDigest(unsigned);
      expect(verifyResolutionWriterWitness({
        ...unsigned, bindingSha256, signature: signer.sign(bindingSha256),
      }, binding, trust, now)).toBeNull();
      await expect(new AttestResolutionWriterQualification(
        { observe: async () => ({ ...binding, proof: unsigned.proof, observedAt: now.toISOString() }) },
        signer,
        { assertOrdinary: async () => {}, assertForceNew: async () => {} },
        () => now,
      ).execute()).rejects.toThrow("resolution_writer_observation_unqualified");
    }
  });

  it("signs independent observations through the existing witness route and rejects request-supplied selectors", async () => {
    const f = await fixture();
    try {
      const response = await f.read();
      expect(response.statusCode).toBe(200);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(
        verifyResolutionWriterWitness(response.json(), binding, trust, f.now)
          ?.proof,
      ).toEqual(f.proof);
      await expect(f.writers.qualify(scope)).resolves.toMatchObject({
        status: "qualified",
        proof: f.proof,
      });
      const before = f.observation.mock.calls.length;
      expect(
        (
          await f.app.inject({
            method: "GET",
            url: "/v1/resolution-writer-qualification?proof=forged",
            headers: { authorization: "Bearer synthetic-witness-trigger" },
          })
        ).statusCode,
      ).toBe(400);
      expect(
        (
          await f.app.inject({
            method: "GET",
            url: "/v1/resolution-writer-qualification",
          })
        ).statusCode,
      ).toBe(401);
      expect(f.observation.mock.calls.length).toBe(before);
    } finally {
      await f.app.close();
    }
  });

  it("rejects other purpose, signature tampering, expiry, wrong fleet and physical database generation", async () => {
    const f = await fixture();
    try {
      const receipt = (await f.read()).json();
      for (const value of [
        { ...receipt, purpose: "release-binding.v3" },
        { ...receipt, proof: { ...receipt.proof, inventoryComplete: false } },
        { ...receipt, signature: { ...receipt.signature, keyId: "other-key" } },
        { ...receipt, extra: true },
      ])
        expect(
          verifyResolutionWriterWitness(value, binding, trust, f.now),
        ).toBeNull();
      expect(
        verifyResolutionWriterWitness(
          receipt,
          { ...binding, fleetDigest: "e".repeat(64) },
          trust,
          f.now,
        ),
      ).toBeNull();
      expect(
        verifyResolutionWriterWitness(
          receipt,
          {
            ...binding,
            database: {
              ...binding.database,
              recoveryWitnessSha256: "e".repeat(64),
            },
          },
          trust,
          f.now,
        ),
      ).toBeNull();
      expect(
        verifyResolutionWriterWitness(
          receipt,
          {
            ...binding,
            database: { ...binding.database, serverIdentity: "789" },
          },
          trust,
          f.now,
        ),
      ).toBeNull();
      expect(
        verifyResolutionWriterWitness(
          receipt,
          binding,
          trust,
          new Date(f.now.getTime() + 60_000),
        ),
      ).toBeNull();
    } finally {
      await f.app.close();
    }
  });

  it("prequalifies before drain, rechecks guarded history, and preserves discovery-only publication after revocation", async () => {
    const f = await fixture();
    let cut: ResolutionHistoryCut | null = null;
    const history = {
      readActivation: async () => cut,
      beginDrain: vi.fn(async () => {}),
      activate: vi.fn(async () => {
        cut ??= {
          activatedAt: f.now.toISOString(),
          activationVersion: 1,
          writerDigest: f.proof.writerDigest,
          bootstrap: {
            qualificationSource: f.proof.qualificationSource,
            proofHash: f.proof.proofHash,
            executorSetHash: f.proof.executorSetHash,
            retiredAt: f.proof.retiredAt,
            activationCut: f.now.toISOString(),
          },
        };
      }),
      read: vi.fn(async () => []),
    };
    try {
      const prepared = prepareReviewResolutionHistory({
        history,
        writers: f.writers,
      });
      await expect(prepared.ensure(scope)).resolves.toEqual({
        status: "guarded",
      });
      await expect(prepared.ensure(scope)).resolves.toEqual({
        status: "guarded",
      });
      expect(history.activate).toHaveBeenCalledTimes(1);
      const originalCut = cut;
      f.revoke();
      await expect(
        prepared.history.read(scope, ["fresh-resolution-target"]),
      ).rejects.toThrow("resolution_history_unavailable");
      await expect(prepared.history.read(scope, [])).resolves.toEqual([]);
      await expect(prepared.ensure(scope)).resolves.toMatchObject({
        status: "unavailable",
      });
      expect(cut).toBe(originalCut);
      expect(history.beginDrain).toHaveBeenCalledTimes(1);
      const unactivated = {
        ...history,
        readActivation: async () => null,
        beginDrain: vi.fn(),
        activate: vi.fn(),
      };
      await expect(
        ensureResolutionHistoryActivated(scope, {
          activation: unactivated,
          writers: f.writers,
        }),
      ).resolves.toMatchObject({ status: "unavailable" });
      expect(unactivated.beginDrain).not.toHaveBeenCalled();
    } finally {
      await f.app.close();
    }
  });
});
