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
  resolveHostedPoolActionRelease,
  resolveReviewRouterActionRef,
  resolveReviewRouterCodexRotatingActionRef,
} from "@reviewrouter/platform-config";
import {
  reviewModelTransports,
  selectReviewModelRoutePolicy,
  type ReviewModelDispatchProfileV2,
  type ReviewModelTransport,
} from "@reviewrouter/shared";

/** Exact registered releases for the new behavior, never the old admission overlap list. */
export type DashboardRuntimeRelease = Readonly<{
  modelDispatchProfile: ReviewModelDispatchProfileV2;
  agentProfiles: readonly ReviewAgentProfile[] | null;
  /** Routes whose actual provisioning/default-producer config selects this SHA. */
  provisioningTransports: readonly ReviewModelTransport[];
  credentialMigrationSupported?: boolean;
}>;
export type DashboardRuntimeReleases = ReadonlyMap<
  string,
  DashboardRuntimeRelease
>;

export async function readDashboardRuntimeReleases(input: {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly releases: ProducerReleaseQueryPort;
  readonly inspectRuntimeMigrationTarget?: (sha: string) => Promise<boolean>;
}): Promise<DashboardRuntimeReleases | null> {
  try {
    const configured = readConfiguredProducerReleaseAttestations(input.env);
    const targets = configuredReviewRuntimeTargets(input.env);
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
        provisioningTransports: reviewModelTransports.filter(
          (transport) =>
            targets[transport] === attested.release.actionCommitSha,
        ),
        ...(targets.runner_local_responses ===
          attested.release.actionCommitSha &&
        input.inspectRuntimeMigrationTarget
          ? {
              credentialMigrationSupported:
                await input.inspectRuntimeMigrationTarget(
                  attested.release.actionCommitSha,
                ),
            }
          : {}),
      });
    }
    return compatible;
  } catch {
    // A missing/malformed deployment registry is unknown, never installed support.
    return null;
  }
}

/** Reuse exactly the selectors used by setup and producer admission. An overlap
 * release is not an upgrade target until its complete configured tuple moves. */
function configuredReviewRuntimeTargets(
  env: Readonly<Record<string, string | undefined>>,
): Partial<Record<ReviewModelTransport, string>> {
  const targets: Partial<Record<ReviewModelTransport, string>> = {};
  const add = (
    transports: readonly ReviewModelTransport[],
    resolve: () => string,
  ) => {
    try {
      const sha = /^777genius\/review-router@([a-f0-9]{40})$/u.exec(
        resolve(),
      )?.[1];
      if (sha) for (const transport of transports) targets[transport] = sha;
    } catch {
      // A partial tuple does not make another route's candidate a target.
    }
  };
  add(["account_gateway", "runner_local_responses"], () =>
    resolveReviewRouterCodexRotatingActionRef(env),
  );
  add(["runner_local_anthropic"], () => resolveReviewRouterActionRef(env));
  add(["hosted_pool"], () => resolveHostedPoolActionRelease(env).actionRef);
  return targets;
}

export function installedReviewRuntimeCompatibility(input: {
  readonly providers:
    | readonly Readonly<{
        authMode: string;
        model: string;
        gatewayProfileRef?: string | undefined;
        agenticContext?: boolean | undefined;
        agentProfileRef?: string | undefined;
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
        return [
          [
            sha,
            {
              ...selected,
              provisioningTarget: release.provisioningTransports.includes(
                selected.transport,
              ),
              credentialMigrationSupported:
                release.credentialMigrationSupported === true,
            },
          ] as const,
        ];
      } catch {
        return [];
      }
    }),
  );
  if (!supported.size) return "unknown";
  const target = [...supported.values()].find(
    (release) => release.provisioningTarget,
  );
  if ([...supported.values()][0]!.transport === "account_gateway") {
    if (!target) return "unknown";
    if (provisioning.actionVersion !== "workflow-v1") return "update_required";
    return input.gatewayAuthorizationReady ? "compatible" : "unknown";
  }
  const sha = /^(?:777genius\/review-router@)?([a-f0-9]{40})$/u.exec(
    provisioning.actionVersion,
  )?.[1];
  if (!sha) return "unknown";
  // Keep compatible immutable callers valid during a configured A -> B overlap.
  if (supported.has(sha)) return "compatible";
  // The actual setup action must install a qualified target, not the same old
  // pin merely because another compatible release appears in the overlap list.
  if (!target) return "unknown";
  // A rotating caller advances only through the qualified credential-preserving
  // bootstrap. An overlap release or ordinary setup PR alone cannot upgrade it.
  if (input.providers[0]?.authMode === "codex_subscription_oauth_rotating")
    return target.credentialMigrationSupported ? "update_required" : "unknown";
  return "update_required";
}
