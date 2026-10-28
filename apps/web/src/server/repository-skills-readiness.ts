import type { PrismaClient } from "@prisma/client";
import { supportsContextToolsV1 } from "@reviewrouter/features-review-context-tools";
import {
  PrismaReviewPolicyHeadReader,
  resolveEffectiveReviewConfigurations,
  type EffectiveReviewConfiguration,
  type ReviewConfiguration,
} from "@reviewrouter/features-review-config";
import {
  ProducerReleaseAttestationStatus,
  readImplicitReviewAgentSelection,
  selectReviewRunAgentProfile,
  type ProducerRelease,
} from "@reviewrouter/features-review-run-control";
import {
  ConfiguredProducerReleaseAttestationRegistry,
  producerReleaseToDomain,
  readConfiguredProducerReleaseAttestations,
} from "@reviewrouter/features-review-run-control/composition";
import {
  requiredWorkflowRequirement,
  requiredWorkflowTransport,
} from "@reviewrouter/features-workflow-provisioning";
import { reviewActionV2SupportedContracts } from "@reviewrouter/protocol-review-action-v2";
import type { RepositorySkillsReadiness } from "../features/review-skills/contracts";
import { getPrisma } from "./prisma";

type Candidate = ProducerRelease | null;
type CandidateSupport = "supported" | "unsupported" | "unavailable" | "unknown";
type ImplicitSelection = ReturnType<typeof readImplicitReviewAgentSelection>;

/** Call only after a Skills operation has authorized these exact repositories.
 * Reads are local and advisory: admission still verifies the actual workflow,
 * producer, configuration, permissions and Git content when a review starts. */
export async function readRepositorySkillsReadiness(
  input: Readonly<{ workspaceId: string; repositoryIds: readonly string[] }>,
  dependencies: Readonly<{
    prisma?: PrismaClient;
    env?: Readonly<Record<string, string | undefined>>;
  }> = {},
): Promise<readonly RepositorySkillsReadiness[]> {
  const repositoryIds = [...new Set(input.repositoryIds)];
  if (!repositoryIds.length) return [];
  const names = new Map(repositoryIds.map((id) => [id, id]));
  const unknown = () =>
    repositoryIds.map((repositoryId) => ({
      repositoryId,
      name: names.get(repositoryId)!,
      status: "unknown" as const,
      reason: "runtime_unconfirmed" as const,
    }));
  try {
    const prisma = dependencies.prisma ?? getPrisma();
    const env = dependencies.env ?? process.env;
    const repositories = await prisma.repositoryConnection.findMany({
      where: { workspaceId: input.workspaceId, id: { in: repositoryIds } },
      select: { id: true, fullName: true },
    });
    for (const repository of repositories)
      names.set(repository.id, repository.fullName);
    const [policies, provisioning] = await Promise.all([
      resolveEffectiveReviewConfigurations(
        { workspaceId: input.workspaceId, repositoryIds },
        { policyHeads: PrismaReviewPolicyHeadReader.snapshot(prisma) },
      ),
      prisma.workflowProvisioning.findMany({
        where: {
          workspaceId: input.workspaceId,
          repositoryId: { in: repositoryIds },
        },
        select: { repositoryId: true, installedWorkflowRequirement: true },
      }),
    ]);
    let implicit: ImplicitSelection | null = null;
    let candidates: readonly Candidate[] = [];
    try {
      implicit = readImplicitReviewAgentSelection(
        env.REVIEW_ROUTER_AGENT_PROFILE,
      );
      const attestations = readConfiguredProducerReleaseAttestations(env);
      const rows = await prisma.producerRelease.findMany({
        where: {
          producerReleaseId: {
            in: attestations.map((item) => item.producerReleaseId),
          },
        },
      });
      const byId = new Map(
        rows.map((row) => [
          row.producerReleaseId,
          producerReleaseToDomain(row),
        ]),
      );
      const registry = new ConfiguredProducerReleaseAttestationRegistry(
        attestations,
        {
          async findProducerReleaseById(id) {
            return byId.get(id) ?? null;
          },
        },
      );
      // No configured candidate is silently discarded. The next producer SHA
      // is not stored on a repository; mixed or invalid evidence stays unknown.
      candidates = await Promise.all(
        attestations.map(async (attestation) => {
          const supported = reviewActionV2SupportedContracts().find(
            (contract) =>
              contract.schemaDigest === attestation.schemaDigest &&
              contract.canonicalizerDigest === attestation.canonicalizerDigest,
          );
          if (!supported) return null;
          const result = await registry.attest({
            actionCommitSha: attestation.actionCommitSha,
            expectedSchemaDigest: supported.schemaDigest,
            expectedCanonicalizerDigest: supported.canonicalizerDigest,
          });
          return result.status === ProducerReleaseAttestationStatus.Attested
            ? result.release
            : null;
        }),
      );
      // Repository release overrides may change only protocol-limit identity;
      // admission requires an otherwise identical immutable producer key, so
      // they cannot change the Skills capability inspected here.
    } catch {
      candidates = [];
    }
    const installed = new Map(
      provisioning.map((row) => [
        row.repositoryId,
        row.installedWorkflowRequirement,
      ]),
    );
    const visible = new Set(repositories.map((repository) => repository.id));
    return repositoryIds.map((repositoryId) => ({
      repositoryId,
      name: names.get(repositoryId)!,
      ...(visible.has(repositoryId)
        ? repositorySupport(
            policies.repositories.get(repositoryId),
            installed.get(repositoryId),
            candidates,
            implicit,
          )
        : {
            status: "unknown" as const,
            reason: "runtime_unconfirmed" as const,
          }),
    }));
  } catch {
    // Never turn unavailable read evidence into either a positive capability
    // assertion or a failed library/assignment operation.
    return unknown();
  }
}

function repositorySupport(
  effective: EffectiveReviewConfiguration | undefined,
  installed: string | null | undefined,
  candidates: readonly Candidate[],
  implicit: ImplicitSelection | null,
): Pick<RepositorySkillsReadiness, "status" | "reason"> {
  if (!effective || effective.status === "provider_selection_required")
    return { status: "blocked", reason: "configuration_required" };
  if (effective.status === "resave_required")
    return { status: "blocked", reason: "configuration_resave_required" };
  try {
    const transport = requiredWorkflowTransport(effective.config);
    if (transport !== "gateway" && transport !== "provider_api")
      return { status: "blocked", reason: "unsupported_workflow" };
    if (!installed)
      return { status: "unknown", reason: "workflow_unconfirmed" };
    if (installed !== requiredWorkflowRequirement(effective.config))
      return { status: "blocked", reason: "workflow_update_required" };
    if (!implicit || !candidates.length)
      return { status: "unknown", reason: "runtime_unconfirmed" };
    const support = candidates.map((candidate) =>
      candidateSupport(candidate, effective.config, transport, implicit),
    );
    if (support.every((state) => state === "supported"))
      return { status: "ready", reason: "supported" };
    if (support.every((state) => state === "unsupported"))
      return { status: "blocked", reason: "engine_unsupported" };
    if (support.every((state) => state === "unavailable"))
      return { status: "blocked", reason: "engine_unavailable" };
  } catch {
    // Invalid/mixed transport or producer selection is never a positive signal.
  }
  return { status: "unknown", reason: "runtime_unconfirmed" };
}

function candidateSupport(
  release: Candidate,
  configuration: ReviewConfiguration,
  transport: "gateway" | "provider_api",
  implicit: ImplicitSelection,
): CandidateSupport {
  if (!release?.agentProfiles?.length) return "unknown";
  const gateway = configuration.providers.find(
    (provider) => provider.authMode === "codex_account_gateway",
  );
  const explicitProfileRef =
    gateway?.authMode === "codex_account_gateway"
      ? gateway.agentProfileRef
      : undefined;
  try {
    const selected = selectReviewRunAgentProfile({
      profiles: release.agentProfiles,
      modelTransport:
        transport === "gateway" ? "account_gateway" : "provider_api",
      ...(explicitProfileRef !== undefined ? { explicitProfileRef } : {}),
      suppliedDiffOnly: gateway?.agenticContext === false,
      defaultProfileRef: implicit.profileRef,
      preferSkillsProfile: implicit.preferSkillsProfile,
      // requiredWorkflowTransport returns provider_api only for an approved
      // direct provider API configuration. The saved installed seam
      // must also match; live source/OIDC verification remains admission-owned.
      reviewSkillsDelivery: transport === "provider_api",
    });
    const contextTools = configuration.contextTools;
    if (
      contextTools &&
      contextTools.builtinTools.length + contextTools.mcp.length > 0 &&
      (selected.agentKind !== "ocr" ||
        !supportsContextToolsV1(release.contextToolsProfile))
    )
      return "unknown";
    if (selected.agentKind === "ocr" && gateway?.agenticContext === false)
      return "unavailable";
    return selected.reviewSkillsVersion === 1 ? "supported" : "unsupported";
  } catch {
    return explicitProfileRef !== undefined ? "unavailable" : "unknown";
  }
}
