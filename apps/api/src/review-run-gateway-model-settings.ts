import { effectiveGatewayReasoningEffort } from "@reviewrouter/features-review-providers";
import { createHash } from "node:crypto";
import { z } from "zod";
import * as c from "@agent-teams/account-gateway/contracts";
import type { ConsumerControlClient } from "@agent-teams/account-gateway/http";
import {
  selectBinding,
  type PrismaProviderAccountRepository,
} from "@reviewrouter/features-provider-accounts";
import {
  canonicalJson,
  getReviewRunGatewayAllocation,
  getReviewRunReviewer,
  parseReviewRunRuntimeSnapshot,
  type ReviewRunAuthorization,
} from "@reviewrouter/features-review-run-control";
import { parseReviewConfigurationStrict } from "@reviewrouter/features-review-config/review-configuration";

export const gatewayModelSettingsRuntimeEnvKey =
  "REVIEW_ROUTER_GATEWAY_MODEL_SETTINGS_JSON";
export const codexOAuthModelSettingsProfile = "openai-codex-oauth-responses-v1";
const efforts = [
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
] as const;
const effort = z.enum(efforts);
const settingsSchema = z.strictObject({
  model: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/),
  reasoning: z
    .strictObject({ allowed: z.array(effort).min(1).max(7), default: effort })
    .nullable(),
});
export type SelectedGatewayModelSettings = z.infer<typeof settingsSchema>;
export type ReadSelectedGatewayModelSettings = (request: {
  readonly authorization: ReviewRunAuthorization;
  readonly signal: AbortSignal;
  readonly executionAuthorizationEpoch?: number;
  readonly reviewerId?: string;
}) => Promise<{
  readonly authorizationEpoch: number;
  readonly settings: SelectedGatewayModelSettings | undefined;
}>;
/** Deterministic, bounded, selected-only public projection. */
export function serializeSelectedGatewayModelSettings(
  raw: SelectedGatewayModelSettings,
  model: string,
  profileRef = codexOAuthModelSettingsProfile,
): string {
  const value = settingsSchema.parse(raw);
  if (value.model !== model)
    throw new Error("gateway_model_settings_unavailable");
  const reasoning = value.reasoning;
  const effectiveEffort = (effort: string) =>
    effectiveGatewayReasoningEffort(profileRef, effort)!;
  if (
    reasoning &&
    (new Set(reasoning.allowed).size !== reasoning.allowed.length ||
      !reasoning.allowed.some(
        (allowed) =>
          effectiveEffort(allowed) === effectiveEffort(reasoning.default),
      ))
  )
    throw new Error("invalid_model_reasoning");
  const allowed = reasoning
    ? new Set(reasoning.allowed.map(effectiveEffort))
    : null;
  const result = canonicalJson({
    model,
    reasoning: reasoning
      ? {
          allowed: efforts.filter((value) => allowed!.has(value)),
          default: effectiveEffort(reasoning.default),
        }
      : null,
  });
  if (Buffer.byteLength(result) > 2048)
    throw new Error("gateway_model_settings_unavailable");
  return result;
}

/** Read-only private adapter. Enrollment anchors and saved policy stay immutable. */
export function createReviewRunGatewayModelSettingsReader(input: {
  readonly accounts: Pick<PrismaProviderAccountRepository, "findBinding">;
  readonly control: Pick<ConsumerControlClient, "get" | "readAccountModels">;
  readonly profiles: readonly c.Profile[];
  readonly operatorWorkspaceId?: string;
}): ReadSelectedGatewayModelSettings {
  const { accounts, control, operatorWorkspaceId } = input;
  const profiles = new Map(
    input.profiles.map((profile) => [
      profile.profileId,
      c.profile.parse(profile),
    ]),
  );
  return async ({
    authorization,
    signal,
    executionAuthorizationEpoch,
    reviewerId,
  }) => {
    const workspaceId = authorization.workspaceId;
    const snapshot = parseReviewRunRuntimeSnapshot(
      authorization.runtimeSnapshotCanonicalJson,
    );
    const reviewer =
      snapshot?.snapshotVersion === 4 && reviewerId !== undefined
        ? getReviewRunReviewer(snapshot, reviewerId)
        : null;
    const gateway =
      snapshot?.snapshotVersion === 4
        ? reviewer &&
          getReviewRunGatewayAllocation(
            snapshot,
            reviewer.transport.allocationId,
          )
        : snapshot?.gateway;
    if (
      !snapshot ||
      !gateway ||
      (snapshot.snapshotVersion === 3 && reviewerId !== undefined) ||
      snapshot.deadline !== authorization.maxExpiresAt.toISOString()
    )
      throw new Error("gateway_model_settings_unavailable");
    const config = parseReviewConfigurationStrict(
      JSON.parse(snapshot.configurationCanonicalJson),
    );
    const providerIndex =
      snapshot.snapshotVersion === 4
        ? reviewer!.providerIndex
        : snapshot.gateway!.providerIndex;
    const provider = config.providers[providerIndex];
    const profile = profiles.get(gateway.profileRef);
    const discoverySource = profile?.authKinds
      .map((authKind) =>
        c.accountModelDiscoverySource({
          profileId: profile.profileId,
          protocol: profile.protocol,
          authKind,
        }),
      )
      .find((source) => source !== undefined);
    if (
      provider?.authMode !== "codex_account_gateway" ||
      provider.gatewayBindingId !== gateway.bindingId ||
      provider.gatewayProfileRef !== gateway.profileRef ||
      !profile ||
      profile.protocol !== "openai-responses" ||
      !discoverySource
    )
      throw new Error("gateway_model_settings_unavailable");
    async function selected() {
      if (signal.aborted) throw new Error("gateway_model_settings_unavailable");
      const row = await accounts.findBinding({
        workspaceId,
        bindingId: gateway!.bindingId,
      });
      const tuple = selectBinding(
        workspaceId,
        gateway!.bindingId,
        row,
        operatorWorkspaceId,
      );
      if (
        !row ||
        tuple.connectionId !== gateway!.connectionId ||
        tuple.gatewayAccountRef !== gateway!.permittedAccountRef ||
        tuple.profileRef !== gateway!.profileRef ||
        tuple.bindingRevision !== gateway!.bindingRevision ||
        tuple.policySubject !== gateway!.policySubject ||
        tuple.policyRevision !== gateway!.policyRevision ||
        tuple.expectedAuthorizationEpoch !== gateway!.expectedAuthorizationEpoch
      )
        throw new Error("gateway_model_settings_unavailable");
      const localCanonical = canonicalJson(row);
      const owner = row.connection.owner;
      const ownerRef = `${owner.kind === "user" ? "rru" : "rrw"}_${createHash(
        "sha256",
      )
        .update(
          owner.kind === "user"
            ? `rr-user-owner-v1\0${owner.userId}`
            : `rr-workspace-owner-v1\0${owner.workspaceId}`,
        )
        .digest("hex")}`;
      const account = c.account.parse(
        await control.get(tuple.gatewayAccountRef, { signal }),
      );
      if (
        account.accountRef !== tuple.gatewayAccountRef ||
        account.profileId !== gateway!.profileRef ||
        account.ownerRef !== ownerRef ||
        account.state !== "active" ||
        (gateway!.expectedAuthorizationEpoch !== undefined &&
          account.authorizationEpoch !== gateway!.expectedAuthorizationEpoch) ||
        (executionAuthorizationEpoch !== undefined &&
          account.authorizationEpoch !== executionAuthorizationEpoch)
      )
        throw new Error("gateway_model_settings_unavailable");
      const after = await accounts.findBinding({
        workspaceId,
        bindingId: gateway!.bindingId,
      });
      if (canonicalJson(after) !== localCanonical || signal.aborted)
        throw new Error("gateway_model_settings_unavailable");
      return {
        tuple,
        ownerRef,
        authorizationEpoch: account.authorizationEpoch,
        metadataRevision: row.connection.metadataRevision,
        gatewayRevision: account.metadataRevision,
      };
    }
    const before = await selected();
    const models = c.accountModels.parse(
      await control.readAccountModels(
        {
          ownerRef: before.ownerRef,
          accountRef: gateway.permittedAccountRef,
          profileId: gateway.profileRef,
          expectedAuthorizationEpoch: before.authorizationEpoch,
        },
        { signal },
      ),
    );
    if (
      canonicalJson(before) !== canonicalJson(await selected()) ||
      signal.aborted
    )
      throw new Error("gateway_model_settings_unavailable");
    if (
      models.status === "unavailable" &&
      profile.modelIds.includes(provider.model)
    )
      return {
        authorizationEpoch: before.authorizationEpoch,
        settings: undefined,
      };
    if (
      models.status !== "snapshot" ||
      models.source !== discoverySource ||
      Date.parse(models.fetchedAt) > Date.now() ||
      Date.parse(models.expiresAt) <= Date.now()
    )
      throw new Error("gateway_model_settings_unavailable");
    const selectedModel = models.models.find(
      (row) => row.modelId === provider.model,
    );
    if (!selectedModel) throw new Error("gateway_model_settings_unavailable");
    const settings = JSON.parse(
      serializeSelectedGatewayModelSettings(
        { model: provider.model, reasoning: selectedModel.reasoning },
        provider.model,
        gateway.profileRef,
      ),
    ) as SelectedGatewayModelSettings;
    const savedEffort = provider.reasoningEffort;
    if (
      settings.reasoning === null
        ? savedEffort !== undefined
        : savedEffort !== undefined &&
          !settings.reasoning.allowed.includes(
            effectiveGatewayReasoningEffort(
              gateway.profileRef,
              savedEffort,
            ) as (typeof efforts)[number],
          )
    )
      throw new Error("gateway_model_settings_unavailable");
    return { authorizationEpoch: before.authorizationEpoch, settings };
  };
}
