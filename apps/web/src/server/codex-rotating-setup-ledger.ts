import {
  activateCodexRotatingSetup,
  authorizeCodexRotatingSetupDispatch,
  getCodexRotatingSetupStatus,
  prepareCodexRotatingSetup,
  reattestCodexRotatingWorkflow,
  recordCodexRotatingSetupDispatchOutcome,
  type CodexRotatingDefaultWorkflowSourcePort,
  type CodexRotatingWorkflowReattestationRequest,
} from "@reviewrouter/features-provider-setup";
import { requireReviewRouterDatabaseRecoveryWitness } from "@reviewrouter/platform-config";
import { getCodexEffectAuthorityPrisma, getPrisma } from "./prisma";
import { z } from "zod";
import { createGitHubAppInstallationOctokit } from "./dashboard-mutations";
import { PrismaCodexRotatingSetupPayloadClaim } from "./prisma-codex-rotating-setup-payload-claim";

const setupSecretDispatchSchema = z.object({
  claimId: z.string().min(1),
  idempotencyKey: z.string().min(1),
  encryptedValue: z
    .string()
    .regex(/^[A-Za-z0-9+/]+={0,2}$/u)
    .max(1_000_000),
  keyId: z.string().min(1).max(512),
});

function ledger() {
  return {
    claims: new PrismaCodexRotatingSetupPayloadClaim(
      getPrisma(),
      requireReviewRouterDatabaseRecoveryWitness(),
      undefined,
      process.env,
      getCodexEffectAuthorityPrisma(),
    ),
  };
}

export const codexRotatingSetupLedger = {
  prepare: (input: unknown) => prepareCodexRotatingSetup(input, ledger()),
  authorizeDispatch: (input: unknown) =>
    authorizeCodexRotatingSetupDispatch(input, ledger()),
  authorizeAndPutSecret: async (input: unknown) => {
    const parsed = setupSecretDispatchSchema.parse(input);
    const claims = ledger().claims;
    return claims.authorizeDispatch(
      { claimId: parsed.claimId, idempotencyKey: parsed.idempotencyKey },
      async (target) => {
        const octokit = await createGitHubAppInstallationOctokit(
          target.githubInstallationId,
        );
        const response = await octokit.request(
          "PUT /repos/{owner}/{repo}/actions/secrets/{secret_name}",
          {
            owner: target.owner,
            repo: target.repo,
            secret_name: target.secretName,
            encrypted_value: parsed.encryptedValue,
            key_id: parsed.keyId,
          },
        );
        if (response.status !== 201 && response.status !== 204) {
          throw new Error("codex_rotating_setup_secret_put_failed");
        }
        return { statusCode: response.status };
      },
    );
  },
  recordOutcome: (input: unknown) =>
    recordCodexRotatingSetupDispatchOutcome(input, ledger()),
  status: (input: unknown) => getCodexRotatingSetupStatus(input, ledger()),
  activate: (input: unknown) => activateCodexRotatingSetup(input, ledger()),
  replaceActiveWorkflowSource: (
    input: CodexRotatingWorkflowReattestationRequest,
    defaultWorkflowSource: CodexRotatingDefaultWorkflowSourcePort,
  ) => {
    const claims = ledger().claims;
    return reattestCodexRotatingWorkflow(input, {
      currentWorkflowAttestation: claims,
      defaultWorkflowSource,
      workflowReattestation: claims,
    });
  },
};

export function codexRotatingSetupLedgerHttpError(error: unknown): {
  readonly status: number;
  readonly error: string;
} {
  const message = error instanceof Error ? error.message : "unknown_error";
  const safe = [
    "codex_rotating_setup_payload_claim_conflict",
    "codex_rotating_setup_payload_claim_mismatch",
    "codex_rotating_setup_payload_claim_expired",
    "codex_rotating_setup_dispatch_expired",
    "codex_rotating_setup_manifest_digest_mismatch",
    "codex_rotating_setup_confirmation_stale_epoch",
    "codex_rotating_setup_manifest_not_found",
    "codex_rotating_setup_claim_not_found",
    "codex_rotating_setup_attempt_not_found",
    "codex_rotating_setup_attempt_limit",
    "codex_rotating_setup_already_confirmed",
    "codex_rotating_setup_namespace_retired",
    "codex_rotating_setup_attempt_already_confirmed",
    "codex_rotating_setup_secret_put_failed",
    "codex_rotating_setup_confirmation_conflict",
    "codex_rotating_setup_activation_mismatch",
    "codex_rotating_setup_activation_stale_epoch",
    "codex_rotating_account_switch_epoch_required",
    "codex_rotating_retryable_uncommitted",
  ].includes(message)
    ? message
    : "codex_rotating_setup_ledger_invalid";
  return {
    status:
      safe === "codex_rotating_retryable_uncommitted"
        ? 503
        : safe.endsWith("not_found")
          ? 404
          : safe.endsWith("expired")
            ? 410
            : safe === "codex_rotating_setup_attempt_limit"
              ? 429
              : safe === "codex_rotating_setup_ledger_invalid"
                ? 400
                : 409,
    error: safe,
  };
}
