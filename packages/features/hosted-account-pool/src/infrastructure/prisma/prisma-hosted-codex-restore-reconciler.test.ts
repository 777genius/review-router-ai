import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import type { CredentialEnvelopeVault } from "../crypto/credential-envelope-vault.js";
import { PrismaHostedCodexRestoreReconciler } from "./prisma-hosted-codex-restore-reconciler.js";

const sourceKeyArn =
  "arn:aws:kms:eu-west-1:123456789012:key/11111111-1111-4111-8111-111111111111";

describe("PrismaHostedCodexRestoreReconciler custody bounds", () => {
  it("settles a hung restore decrypt and zeroes a plaintext that arrives late", async () => {
    let resolveDecrypt!: (plaintext: Uint8Array) => void;
    const decrypt = vi.fn(
      () =>
        new Promise<Uint8Array>((resolve) => {
          resolveDecrypt = resolve;
        }),
    );
    const release = vi.fn(async () => undefined);
    const prisma = {
      hostedCodexRestoreOperation: {
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      hostedCodexRestoreItem: {
        findMany: vi.fn(async () => [restoreItem]),
      },
    } as unknown as PrismaClient;
    const vault = {
      currentKeyId:
        "arn:aws:kms:eu-west-1:123456789012:key/22222222-2222-4222-8222-222222222222",
      decrypt,
      encrypt: vi.fn(),
    } as unknown as CredentialEnvelopeVault;
    const reconciler = new PrismaHostedCodexRestoreReconciler(
      prisma,
      vault,
      "database-resource-identity-target",
      "database-incarnation-target",
      { verify: vi.fn() },
      undefined,
      () => new Date("2026-08-26T00:00:00.000Z"),
      10,
    );
    Object.assign(reconciler, {
      requireOperation: vi.fn(async () => restoreOperation),
      loadSource: vi.fn(async () => restoreSource),
      fences: {
        acquire: vi.fn(async () => ({
          status: "granted",
          leaseId: `hcmf1.YWNjb3VudC0x.1.${"A".repeat(43)}`,
        })),
        release,
      },
    });

    const reconcile = reconciler.reconcile("restore-1");
    await expect(reconcile).rejects.toThrow("hosted_codex_custody_timeout");
    expect(release).toHaveBeenCalledOnce();

    const latePlaintext = Uint8Array.from([1, 2, 3, 4]);
    resolveDecrypt(latePlaintext);
    await Promise.resolve();
    await Promise.resolve();
    expect(latePlaintext).toEqual(Uint8Array.from([0, 0, 0, 0]));
  });
});

const restoreOperation = {
  state: "reconciling",
  targetKmsKeyArn:
    "arn:aws:kms:eu-west-1:123456789012:key/22222222-2222-4222-8222-222222222222",
  sourceIncarnation: "database-incarnation-source",
  databaseResourceIdentity: "database-resource-identity-target",
  actorIdHash: "actor-hash",
  itemCount: 1,
};

const restoreItem = {
  id: "restore-item-1",
  accountId: "account-1",
  workspaceId: "workspace-1",
  poolId: "pool-1",
  generation: 1n,
  attemptCount: 0,
  sourceRevision: 1n,
};

const restoreSource = {
  databaseResourceIdentity: "database-resource-identity-source",
  generationHash: "generation-hash",
  envelope: {
    schemaVersion: 1,
    encryptionAlgorithm: "aes-256-gcm",
    keyId: sourceKeyArn,
    nonce: "AA==",
    ciphertext: "AA==",
    authenticationTag: "AA==",
    wrappedDataEncryptionKey: {
      keyId: sourceKeyArn,
      nonce: "",
      ciphertext: "AA==",
      authenticationTag: "",
    },
    associatedDataHash: "aad-hash",
    ciphertextHash: "ciphertext-hash",
  },
};

describe("PrismaHostedCodexRestoreReconciler local_env relay ready", () => {
  const identity = "database-resource-identity";
  const incarnation = "database-incarnation";
  const localInventory = [
    {
      id: "account-local",
      workspaceId: "workspace-1",
      poolId: "pool-1",
      activeGeneration: 1n,
      credentialVersions: [
        {
          id: "credential-1",
          generation: 1n,
          envelopeRevisions: [
            {
              revision: 1n,
              custodyMode: "local_test",
              kmsKeyArn: null,
              databaseResourceIdentity: identity,
              databaseIncarnation: incarnation,
              aadHash: "aad",
              ciphertextHash: "cipher",
            },
          ],
        },
      ],
    },
  ];

  function reconciler(accepted: readonly string[]) {
    const prisma = {
      hostedCodexAccount: {
        findMany: vi.fn(async () => localInventory),
        count: vi.fn(async () => 0),
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
      hostedCodexInvocationGrant: {
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
    } as unknown as PrismaClient;
    return new PrismaHostedCodexRestoreReconciler(
      prisma,
      { currentKeyId: "local-env" } as unknown as CredentialEnvelopeVault,
      identity,
      incarnation,
      { verify: vi.fn() },
      undefined,
      undefined,
      undefined,
      accepted,
    );
  }

  it("accepts imported local_test envelopes when local_env keyring is allowed", async () => {
    await expect(
      reconciler(["aws_kms", "local_env", "local_test"]).assertRelayReady(),
    ).resolves.toBeUndefined();
  });
});
