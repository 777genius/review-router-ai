import {
  ProducerReleaseAttestationStatus,
  ProducerReleaseState,
  selectModelDispatchReviewAgentProfile,
  type ProducerReleaseQueryPort,
  type ReviewAgentProfile,
} from "@reviewrouter/features-review-run-control";
import {
  ConfiguredProducerReleaseAttestationRegistry,
  readConfiguredProducerReleaseAttestations,
} from "@reviewrouter/features-review-run-control/composition";
import type { ReviewRuntimeCompatibility } from "@reviewrouter/features-provider-setup";
import {
  selectReviewModelRoutePolicy,
  type ReviewModelDispatchProfileV2,
} from "@reviewrouter/shared";

/** Exact registered releases for the new behavior, never the old admission overlap list. */
export type DashboardRuntimeRelease = Readonly<{
  modelDispatchProfile: ReviewModelDispatchProfileV2;
  agentProfiles: readonly ReviewAgentProfile[] | null;
}>;
export type DashboardRuntimeReleases = ReadonlyMap<
  string,
  DashboardRuntimeRelease
>;

export async function readDashboardRuntimeReleases(input: {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly releases: ProducerReleaseQueryPort;
}): Promise<DashboardRuntimeReleases | null> {
  try {
    const configured = readConfiguredProducerReleaseAttestations(input.env);
    const rows = await Promise.all(
      configured.map((entry) =>
        input.releases.findProducerReleaseById(entry.producerReleaseId),
      ),
    );
    const registered = new Map(
      rows
        .filter((row) => row !== null)
        .map((row) => [row.producerReleaseId, row]),
    );
    const registry = new ConfiguredProducerReleaseAttestationRegistry(
      configured,
      {
        async findProducerReleaseById(id) {
          return registered.get(id) ?? null;
        },
      },
    );
    const compatible = new Map<string, DashboardRuntimeRelease>();
    for (const entry of configured) {
      if (
        registered.get(entry.producerReleaseId)?.state !==
        ProducerReleaseState.Registered
      )
        continue;
      const attested = await registry.attest({
        actionCommitSha: entry.actionCommitSha,
        expectedSchemaDigest: entry.schemaDigest,
        expectedCanonicalizerDigest: entry.canonicalizerDigest,
      });
      if (
        attested.status !== ProducerReleaseAttestationStatus.Attested ||
        !attested.release.modelDispatchProfile
      )
        continue;
      compatible.set(attested.release.actionCommitSha.toLowerCase(), {
        modelDispatchProfile: attested.release.modelDispatchProfile,
        agentProfiles: attested.release.agentProfiles,
      });
    }
    return compatible;
  } catch {
    // A missing/malformed deployment registry is unknown, never installed support.
    return null;
  }
}

export function installedReviewRuntimeCompatibility(input: {
  readonly providers:
    | readonly Readonly<{
        authMode: string;
        model: string;
        agenticContext?: boolean;
        agentProfileRef?: string;
      }>[]
    | null;
  readonly provisioning: Readonly<{
    status: string;
    actionVersion: string;
  }> | null;
  readonly requirementMatches: boolean;
  readonly releases: DashboardRuntimeReleases | null;
  readonly gatewayAuthorizationReady: boolean;
}): ReviewRuntimeCompatibility {
  const { provisioning, releases } = input;
  if (
    !input.providers ||
    !provisioning ||
    provisioning.status !== "configured" ||
    !input.requirementMatches ||
    releases === null
  )
    return "unknown";
  const supported = new Map(
    [...releases].flatMap(([sha, release]) => {
      const selected = selectReviewModelRoutePolicy(
        release.modelDispatchProfile,
        input.providers!,
      );
      if (!selected) return [];
      const provider = input.providers![selected.providerIndex]!;
      try {
        selectModelDispatchReviewAgentProfile({
          agentProfiles: release.agentProfiles,
          modelTransport:
            selected.transport === "account_gateway"
              ? "account_gateway"
              : "provider_api",
          preparedRouteDefaultRef: selected.defaultAgentProfileRef,
          ...(provider.authMode === "codex_account_gateway" &&
          provider.agentProfileRef !== undefined
            ? { explicitAgentProfileRef: provider.agentProfileRef }
            : {}),
          agenticContext: provider.agenticContext !== false,
          reviewSkillsDelivery: selected.transport !== "account_gateway",
        });
        return [[sha, selected] as const];
      } catch {
        return [];
      }
    }),
  );
  // No deployed compatible target is available yet; do not offer an empty upgrade.
  if (!supported.size) return "unknown";
  if ([...supported.values()][0]!.transport === "account_gateway") {
    if (provisioning.actionVersion !== "workflow-v1") return "update_required";
    return input.gatewayAuthorizationReady ? "compatible" : "unknown";
  }
  const sha = /^(?:777genius\/review-router@)?([a-f0-9]{40})$/u.exec(
    provisioning.actionVersion,
  )?.[1];
  if (!sha) return "unknown";
  return supported.has(sha) ? "compatible" : "update_required";
}
