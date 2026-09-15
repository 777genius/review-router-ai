import { request as httpsRequest } from "node:https";
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
import { mintFreshGitHubAppRepositorySecretWriteToken } from "./dashboard-mutations";
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

type OneShotSetupSecretPutInput = Readonly<{
  owner: string;
  repo: string;
  secretName: string;
  encryptedValue: string;
  keyId: string;
  token: string;
  timeoutMs: number;
}>;

/**
 * Constructs exactly one non-reused HTTPS request. Node's native transport
 * does not follow redirects or retry, and the response must finish completely
 * before GitHub's status is accepted.
 */
async function putGitHubSetupSecretExactlyOnce(
  input: OneShotSetupSecretPutInput,
): Promise<{ readonly status: number }> {
  if (!Number.isSafeInteger(input.timeoutMs) || input.timeoutMs <= 0) {
    throw new Error("setup_secret_put_timeout_invalid");
  }
  const path = [
    "repos",
    input.owner,
    input.repo,
    "actions",
    "secrets",
    input.secretName,
  ]
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const url = new URL(path, "https://api.github.com/");
  const body = Buffer.from(
    JSON.stringify({
      encrypted_value: input.encryptedValue,
      key_id: input.keyId,
    }),
    "utf8",
  );

  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (
      outcome:
        | { readonly status: "resolved"; readonly statusCode: number }
        | { readonly status: "rejected"; readonly error: Error },
    ) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (outcome.status === "resolved") {
        resolve({ status: outcome.statusCode });
      } else {
        reject(outcome.error);
      }
    };
    let request: ReturnType<typeof httpsRequest>;
    try {
      request = httpsRequest(
        url,
        {
          method: "PUT",
          agent: false,
          headers: {
            accept: "application/vnd.github+json",
            authorization: `Bearer ${input.token}`,
            "content-length": body.byteLength,
            "content-type": "application/json",
            "user-agent": "ReviewRouter-Codex-Rotating-Setup/1",
            "x-github-api-version": "2022-11-28",
          },
        },
        (response) => {
          response.once("aborted", () =>
            settle({
              status: "rejected",
              error: new Error("setup_secret_put_response_incomplete"),
            }),
          );
          response.once("error", () =>
            settle({
              status: "rejected",
              error: new Error("setup_secret_put_response_incomplete"),
            }),
          );
          response.on("data", () => undefined);
          response.once("end", () => {
            if (!response.complete || response.statusCode === undefined) {
              settle({
                status: "rejected",
                error: new Error("setup_secret_put_response_incomplete"),
              });
              return;
            }
            settle({ status: "resolved", statusCode: response.statusCode });
          });
        },
      );
    } catch (cause) {
      reject(new Error("setup_secret_put_construction_failed", { cause }));
      return;
    }
    request.once("error", (cause) =>
      settle({
        status: "rejected",
        error: new Error("setup_secret_put_transport_unknown", { cause }),
      }),
    );
    const timeout = setTimeout(() => {
      request.destroy(new Error("setup_secret_put_timeout"));
    }, input.timeoutMs);
    try {
      request.end(body);
    } catch (cause) {
      settle({
        status: "rejected",
        error: new Error("setup_secret_put_transport_unknown", { cause }),
      });
    }
  });
}

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
        const token = await mintFreshGitHubAppRepositorySecretWriteToken({
          githubInstallationId: target.githubInstallationId,
          githubRepositoryId: target.githubRepositoryId,
        });
        // PUT /repos/{owner}/{repo}/actions/secrets/{secret_name} is issued by
        // the no-retry, no-redirect native transport below.
        const response = await putGitHubSetupSecretExactlyOnce({
          owner: target.owner,
          repo: target.repo,
          secretName: target.secretName,
          encryptedValue: parsed.encryptedValue,
          keyId: parsed.keyId,
          token,
          timeoutMs: 30_000,
        });
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
