import {
  assertCertifiedForkReviewBindingMatches,
  certifiedForkReviewWorkflowSchemaVersion,
  defaultActionOidcAudience,
  parseCertifiedForkReviewBinding,
  parseCertifiedForkReviewPromptPacket,
  prepareCurrentCertifiedForkReview,
  readExactRecord,
  type ActionControlPlaneRepositoryPort,
  type ActionOidcReplayNonceStorePort,
  type CertifiedForkReviewGatewayPort,
  type CodexRotatingOAuthRepositoryPort,
  type CodexRotatingWorkflowSourceVerifierPort,
  type GitHubActionsOidcTokenVerifierPort,
  type PreleaseCodexRotatingOAuthDependencies,
} from "@reviewrouter/features-action-control-plane";
import {
  canonicalCodexRotatingProviderId,
  codexRotatingOidcClaimsSchema,
  validateCodexRotatingPrelease,
} from "@reviewrouter/features-codex-oauth-rotating";
import type { Clock } from "@reviewrouter/shared";

/** Existing read ports and the replay nonce store are exposed. acquirePrelease,
 * ensureVerifiedProviderBinding, effect proofs and publication are NOT ports of
 * this smaller boundary. Supplying additional object methods cannot enable it.
 */
export interface CertifiedForkReviewCompositionDependencies {
  readonly oidcVerifier: GitHubActionsOidcTokenVerifierPort;
  readonly replayNonces: ActionOidcReplayNonceStorePort;
  readonly repositories: Pick<
    ActionControlPlaneRepositoryPort,
    "findSelectedRepositoryByGithubId"
  >;
  readonly oauth: Pick<CodexRotatingOAuthRepositoryPort, "findProviderBinding">;
  readonly workflowRuns: Required<
    Pick<
      CodexRotatingWorkflowSourceVerifierPort,
      "resolveWorkflowRunPullRequest"
    >
  >;
  readonly admission: PreleaseCodexRotatingOAuthDependencies["codexRotatingNewWorkAdmission"];
  readonly gateway: CertifiedForkReviewGatewayPort;
  readonly clock: Clock;
}

/** Diagnostic only, NOT a prepared capability, lease, publication/effect permit,
 * or proof of principal ownership. No packet or authenticated claims escape.
 */
export type CertifiedForkReviewUnavailable = Readonly<{
  status: "unavailable";
  code: "certified_fork_prepare_prelease_bridge_unavailable";
}>;

const methods = {
  oidcVerifier: ["verify"],
  replayNonces: ["tryConsumeNonce"],
  repositories: ["findSelectedRepositoryByGithubId"],
  oauth: ["findProviderBinding"],
  admission: ["assertAdmitted"],
  workflowRuns: ["resolveWorkflowRunPullRequest"],
  gateway: ["assertBindingCurrent", "prepareContext", "assertContextCurrent"],
  clock: ["now"],
} as const;

function validateDependencies(
  dependencies: CertifiedForkReviewCompositionDependencies,
): void {
  if (!dependencies || typeof dependencies !== "object") {
    throw new Error("certified_fork_composition_dependency_missing");
  }
  for (const key of Object.keys(methods) as (keyof typeof methods)[]) {
    const port = dependencies[key];
    for (const name of methods[key]) {
      if (
        !port ||
        typeof port !== "object" ||
        typeof (port as unknown as Record<string, unknown>)[name] !== "function"
      ) {
        throw new Error(
          `certified_fork_composition_dependency_missing:${key}.${name}`,
        );
      }
    }
  }
}

/** INTERNAL, unused, disabled. Construction performs no I/O.
 *
 * Exact-head limitation: the existing OAuth prelease accepts only a
 * VersionedSecretWorkflowSourceAttestation (schema 4 | 5). Its lease input has no
 * fork binding/context hash/principal/durable admission proof. The reviewed
 * durable-proof composition explicitly excludes initial admission production.
 * Therefore this boundary implements only authenticated current-context
 * preflight and ALWAYS returns unavailable. It must not manufacture a schema-6
 * attestation, treat OIDC actor/sub as a durable principal, or acquire a generic
 * OAuth lease and label it a certified fork lease.
 *
 * A future bridge needs current repository/provider admission and principal
 * ownership, schema-6 source attestation, and a current OAuth lease durably bound
 * to installation/provider/workflow/run/attempt plus the full fork tuple and
 * context hash. That bridge cannot be supplied as request data or a boolean.
 *
 * The request's binding is an UNTRUSTED locator. Existing gateway validation
 * proves public fork ancestry and the exact PR/base/head tuple on both reads.
 * The second read is a prelease-context check, not a prelease acquisition.
 * No caller audience, provider, principal, proof, packet or schema is accepted.
 */
export function composeCertifiedForkReview(
  dependencies: CertifiedForkReviewCompositionDependencies,
): Readonly<{
  preparePrelease(input: unknown): Promise<CertifiedForkReviewUnavailable>;
}> {
  validateDependencies(dependencies);
  return Object.freeze({
    async preparePrelease(
      input: unknown,
    ): Promise<CertifiedForkReviewUnavailable> {
      // Revalidate ALL ports before parsing or performing I/O on every operation.
      validateDependencies(dependencies);
      // Capture method/receiver pairs before the first await. Reconfiguration
      // cannot switch trust adapters halfway through an operation.
      const verify = dependencies.oidcVerifier.verify.bind(
        dependencies.oidcVerifier,
      );
      const consume = dependencies.replayNonces.tryConsumeNonce.bind(
        dependencies.replayNonces,
      );
      const findRepository =
        dependencies.repositories.findSelectedRepositoryByGithubId.bind(
          dependencies.repositories,
        );
      const findProvider = dependencies.oauth.findProviderBinding.bind(
        dependencies.oauth,
      );
      const admit = dependencies.admission.assertAdmitted.bind(
        dependencies.admission,
      );
      const resolveRun =
        dependencies.workflowRuns.resolveWorkflowRunPullRequest.bind(
          dependencies.workflowRuns,
        );
      const now = dependencies.clock.now.bind(dependencies.clock);
      const gateway: CertifiedForkReviewGatewayPort = Object.freeze({
        assertBindingCurrent: dependencies.gateway.assertBindingCurrent.bind(
          dependencies.gateway,
        ),
        prepareContext: dependencies.gateway.prepareContext.bind(
          dependencies.gateway,
        ),
        assertContextCurrent: dependencies.gateway.assertContextCurrent.bind(
          dependencies.gateway,
        ),
      });
      const request = readExactRecord(
        input,
        ["oidcToken", "binding"],
        "certified_fork_composition_input_invalid",
      );
      if (
        typeof request.oidcToken !== "string" ||
        request.oidcToken.length === 0
      ) {
        throw new Error("certified_fork_composition_token_invalid");
      }
      const binding = parseCertifiedForkReviewBinding(request.binding);
      const claims = codexRotatingOidcClaimsSchema.parse(
        await verify({
          token: request.oidcToken,
          audience: defaultActionOidcAudience,
        }),
      );
      const audiences =
        typeof claims.aud === "string" ? [claims.aud] : claims.aud;
      if (!audiences.includes(defaultActionOidcAudience))
        throw new Error("oidc_audience_mismatch");
      if (claims.event_name !== "pull_request_target")
        throw new Error("certified_fork_event_invalid");
      if (
        !/^[1-9][0-9]*$/.test(claims.run_id) ||
        !/^[1-9][0-9]*$/.test(claims.run_attempt)
      ) {
        throw new Error("certified_fork_run_invalid");
      }
      if (
        claims.repository !== binding.baseRepository ||
        claims.repository_id !== binding.baseRepositoryId
      ) {
        throw new Error("certified_fork_oidc_repository_mismatch");
      }
      const repositoryValue = await findRepository(claims.repository_id);
      if (
        !repositoryValue ||
        !repositoryValue.selected ||
        repositoryValue.installationStatus !== "active"
      ) {
        throw new Error("repository_not_selected");
      }
      const repository = Object.freeze({ ...repositoryValue });
      if (
        repository.githubRepositoryId !== claims.repository_id ||
        repository.fullName !== claims.repository ||
        !/^[1-9][0-9]*$/.test(repository.githubInstallationId) ||
        !Number.isSafeInteger(Number(repository.githubInstallationId))
      ) {
        throw new Error("certified_fork_repository_mismatch");
      }
      // A rollout allowlist is only a restriction. It never substitutes for the
      // missing durable admission/principal/lease bridge described above.
      const admissionResult: unknown = admit({
        repositoryFullName: repository.fullName,
      });
      if (admissionResult !== undefined) {
        // Observe async failures without awaiting or accepting an async guard.
        void Promise.resolve(admissionResult).catch(() => {});
        throw new Error("certified_fork_admission_guard_invalid");
      }
      const providerInstanceId = canonicalCodexRotatingProviderId(
        repository.githubRepositoryId,
      );
      const provider = await findProvider({
        repository,
        providerInstanceId,
        workflowSha: claims.workflow_sha,
        workflowSchemaVersion: certifiedForkReviewWorkflowSchemaVersion,
      });
      if (!provider)
        throw new Error("codex_rotating_provider_binding_not_found");
      const at = now();
      if (!(at instanceof Date) || !Number.isFinite(at.getTime()))
        throw new Error("certified_fork_clock_invalid");
      validateCodexRotatingPrelease({
        claims,
        binding: provider,
        requestedProviderInstanceId: providerInstanceId,
        requestedWorkflowSchemaVersion:
          certifiedForkReviewWorkflowSchemaVersion,
        now: at,
      });
      if (claims.iat > at.getTime() / 1000 || claims.nbf > at.getTime() / 1000)
        throw new Error("oidc_token_not_yet_valid");
      const source = provider.activeWorkflowSource;
      if (
        !source ||
        source.repositoryId !== repository.githubRepositoryId ||
        source.workflowPath !== provider.workflowPath ||
        source.workflowSourceCommitSha !== claims.workflow_sha ||
        source.sourceTrust !== "trusted_default_branch_revision" ||
        !claims.workflow_ref.startsWith(
          `${repository.fullName}/${provider.workflowPath}@refs/heads/`,
        )
      ) {
        throw new Error("certified_fork_workflow_mismatch");
      }
      if (
        !(await consume({
          key: `${claims.iss}:${claims.jti}`,
          expiresAt: new Date(claims.exp * 1000),
          now: at,
        }))
      ) {
        throw new Error("oidc_replay_detected");
      }
      const pullRequestNumber = await resolveRun({
        repository,
        githubRunId: claims.run_id,
        githubRunAttempt: claims.run_attempt,
        eventName: "pull_request_target",
      });
      if (pullRequestNumber !== binding.pullRequestNumber) {
        throw new Error("certified_fork_run_pull_request_mismatch");
      }
      const currentInput = Object.freeze({
        githubInstallationId: repository.githubInstallationId,
        binding,
      });
      await gateway.assertBindingCurrent(currentInput);
      const prepared = await prepareCurrentCertifiedForkReview(currentInput, {
        gateway,
      });
      // Reuse the current-context port and packet parser directly. The existing
      // validateCurrentCertifiedForkReviewOutput use case requires model output;
      // inventing a model result here would cross the prepare-only boundary.
      const context = readExactRecord(
        await gateway.assertContextCurrent(
          Object.freeze({
            ...currentInput,
            expectedContextHash: prepared.contextHash,
          }),
        ),
        ["promptPacket"],
        "certified_fork_review_context_invalid",
      );
      const current = parseCertifiedForkReviewPromptPacket(
        context.promptPacket,
      );
      assertCertifiedForkReviewBindingMatches(
        prepared.binding,
        current.binding,
      );
      if (prepared.contextHash !== current.contextHash)
        throw new Error("certified_fork_review_context_hash_mismatch");
      // Do not expose an unauthenticated principal or a generic OAuth lease as a
      // certified capability. Even a matching pair of packets is not authority.
      return Object.freeze({
        status: "unavailable",
        code: "certified_fork_prepare_prelease_bridge_unavailable",
      });
    },
  });
}
