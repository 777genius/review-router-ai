import { z } from "zod";
import { versionedProviderSecretNamePattern } from "./provider-secret-namespace";

export const codexRuntimeMigrationWorkflowPath =
  ".github/workflows/reviewrouter-runtime-migration.yml" as const;
export const codexRuntimeMigrationAudience =
  "reviewrouter.codex-runtime-migration.v1" as const;
export const codexRuntimeMigrationReusableWorkflowPath =
  "777genius/review-router/.github/workflows/reviewrouter-runtime-migration.yml" as const;

const opaqueId = z.string().regex(/^[A-Za-z0-9_.:-]{8,180}$/u);
const positiveInteger = z.string().regex(/^[1-9][0-9]*$/u);
const sha = z.string().regex(/^[a-f0-9]{40}$/u);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
const saltedDigest = z.string().regex(/^[A-Za-z0-9_-]{32,128}$/u);
const salt = z.string().regex(/^[A-Za-z0-9_-]{22,128}$/u);
const actionRef = z.string().regex(/^777genius\/review-router@[a-f0-9]{40}$/u);

export const codexRuntimeMigrationIdSchema = z
  .string()
  .regex(/^codex_migration_[a-f0-9-]{36}$/u);

export const codexRuntimeMigrationSourceProofSchema = z
  .object({
    namespaceId: opaqueId,
    namespaceEpoch: positiveInteger,
    canonicalizationVersion: z.literal(1),
    generationHash: saltedDigest,
    accountIdentityHash: saltedDigest,
  })
  .strict();

/**
 * Non-secret admission facts persisted with the existing immutable setup
 * manifest. This does not grant setup authority: only its separate nonce does.
 * Salts currently belong to the provider and are preserved across namespaces;
 * recording the original domain keeps that fact explicit and verifiable.
 */
export const codexRuntimeMigrationBindingSchema = z
  .object({
    version: z.literal(1),
    migrationId: codexRuntimeMigrationIdSchema,
    source: codexRuntimeMigrationSourceProofSchema.extend({
      secretName: z.string().regex(versionedProviderSecretNamePattern),
      mutationEpoch: z.string().regex(/^[0-9]+$/u),
      generation: z.number().int().positive(),
      generationHashSalt: salt,
      accountFingerprintSalt: salt,
      actionRef,
      workflowPath: z.literal(".github/workflows/reviewrouter-codex.yml"),
      workflowSourceCommitSha: sha,
      workflowSourceBlobSha: sha,
      workflowSourceSha256: sha256,
      workflowSemanticSha256: sha256,
      workflowSchemaVersion: z.union([z.literal(4), z.literal(5)]),
    }),
    targetActionRef: actionRef,
    defaultBranch: z.string().min(1).max(255),
    bootstrap: z
      .object({
        workflowId: positiveInteger,
        sourceCommitSha: sha,
        sourceBlobSha: sha,
        sourceSha256: sha256,
      })
      .strict(),
    ingress: z
      .array(
        z
          .object({
            workflowId: positiveInteger,
            workflowPath: z.enum([
              ".github/workflows/reviewrouter-codex.yml",
              ".github/workflows/reviewrouter-interaction.yml",
            ]),
            sourceBlobSha: sha,
            sourceSha256: sha256,
          })
          .strict(),
      )
      .min(1)
      .max(2),
  })
  .strict()
  .superRefine((binding, context) => {
    const ids = new Set(binding.ingress.map((entry) => entry.workflowId));
    const paths = new Set(binding.ingress.map((entry) => entry.workflowPath));
    if (
      ids.size !== binding.ingress.length ||
      paths.size !== binding.ingress.length ||
      ids.has(binding.bootstrap.workflowId) ||
      !paths.has(binding.source.workflowPath) ||
      binding.source.actionRef === binding.targetActionRef ||
      /[\s~^:?*\[\\]|\.\.|@\{|\/\/|^\/|\/$/u.test(binding.defaultBranch)
    ) {
      context.addIssue({
        code: "custom",
        message: "runtime migration requires distinct exact source and target",
      });
    }
    const source = binding.ingress.find(
      (entry) => entry.workflowPath === binding.source.workflowPath,
    );
    if (
      source?.sourceBlobSha !== binding.source.workflowSourceBlobSha ||
      source.sourceSha256 !== binding.source.workflowSourceSha256
    ) {
      context.addIssue({
        code: "custom",
        path: ["ingress"],
        message: "runtime migration ingress must match the active source",
      });
    }
  });

export type CodexRuntimeMigrationBinding = z.infer<
  typeof codexRuntimeMigrationBindingSchema
>;
export type CodexRuntimeMigrationSourceProof = z.infer<
  typeof codexRuntimeMigrationSourceProofSchema
>;

/** Only an OIDC-authorized bootstrap runner receives this capability response. */
export type CodexRuntimeMigrationExchange = Readonly<{
  version: 1;
  migrationId: string;
  manifestBase64: string;
  recoveryEpoch: string;
  expiresAt: string;
  recoveryExpiresAt: string;
  payloadClaimed: boolean;
  githubPublicKey: Readonly<{ keyId: string; key: string }>;
  setup: Readonly<{
    prepareUrl: string;
    dispatchUrl: string;
    dispatchOutcomeUrl: string;
    statusUrl: string;
  }>;
}>;

export function codexRuntimeMigrationRunName(migrationId: string): string {
  return `ReviewRouter runtime migration ${codexRuntimeMigrationIdSchema.parse(migrationId)}`;
}

export function codexRuntimeMigrationDispatchKey(migrationId: string): string {
  return `runtime-migration:${codexRuntimeMigrationIdSchema.parse(migrationId)}`;
}

export function assertCodexRuntimeMigrationSourceProof(input: {
  readonly binding: CodexRuntimeMigrationBinding;
  readonly sourceProof: CodexRuntimeMigrationSourceProof | undefined;
  readonly generationHash: string;
  readonly accountIdentityHash: string;
  readonly generationHashSalt: string;
  readonly accountFingerprintSalt: string;
}): void {
  const source = input.binding.source;
  const proof = input.sourceProof;
  if (
    !proof ||
    proof.namespaceId !== source.namespaceId ||
    proof.namespaceEpoch !== source.namespaceEpoch ||
    proof.canonicalizationVersion !== source.canonicalizationVersion ||
    proof.generationHash !== source.generationHash ||
    proof.accountIdentityHash !== source.accountIdentityHash ||
    input.generationHashSalt !== source.generationHashSalt ||
    input.accountFingerprintSalt !== source.accountFingerprintSalt ||
    // Current setup preserves these provider salts. The copied, compacted
    // bytes must therefore produce the exact same digest in both domains.
    input.generationHash !== source.generationHash ||
    input.accountIdentityHash !== source.accountIdentityHash
  ) {
    throw new Error("codex_runtime_migration_source_mismatch");
  }
}
