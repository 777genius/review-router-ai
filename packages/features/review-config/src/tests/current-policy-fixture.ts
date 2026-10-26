import {
  canonicalJson,
  parseReviewConfigurationStrict,
} from "../domain/review-configuration";
import {
  parseRepositoryReviewPolicy,
  parseWorkspaceReviewPolicy,
  reviewProviderSelectionFor,
  STORED_REVIEW_POLICY_SCHEMA_VERSION,
  type RepositoryReviewPolicy,
  type ReviewPolicyDocument,
  type ReviewProviderSelection,
  type WorkspaceReviewPolicy,
} from "../domain/review-policy-document";
import {
  providerCredentialRequestFor,
  type ProviderCredentialSource,
  type WorkspaceProviderProfile,
} from "../domain/workspace-provider-profile";
import type { ReviewConfigurationTarget } from "../domain/review-configuration-target";
import type { ProviderProfileDraft } from "../application/ports/review-configuration-repository-port";

export const workspaceProviderFixture = {
  kind: "codex",
  authMode: "codex_subscription_oauth_rotating",
  model: "gpt-5.5",
  reasoningEffort: "high",
  agenticContext: true,
  fastMode: false,
  requiredHealthy: true,
} as const;

/** A runtime configuration (schema 3) with one rotating Codex provider. */
export const workspacePolicyFixture = parseReviewConfigurationStrict({
  schemaVersion: 3,
  providers: [workspaceProviderFixture],
  execution: {
    providerLimit: 1,
    providerMaxParallel: 1,
    inlineMinAgreement: 1,
  },
  blockingPolicy: { failOnSeverity: "critical" },
  limits: { inlineMaxComments: 5, targetTokensPerBatch: 50000 },
  reviewLanguage: null,
  investigationRollout: {
    recordingEnabled: false,
    shadowEnabled: false,
    contextCriticEnabled: false,
    verifiedCleanEnabled: false,
    crossRevisionReplayEnabled: false,
    productionEffectsEnabled: false,
  },
});

/** A stored workspace profile of the given credential source. */
export function providerProfileFixture(input: {
  readonly id: string;
  readonly workspaceId?: string;
  readonly credential: ProviderCredentialSource;
  readonly model: string;
  readonly createdByUserId?: string | null;
}): WorkspaceProviderProfile {
  return {
    id: input.id,
    workspaceId: input.workspaceId ?? "workspace_1",
    createdByUserId: input.createdByUserId ?? null,
    credential: input.credential,
    model: input.model,
    label: input.id,
    archivedAt: null,
    createdAt: new Date("2026-10-24T00:00:00.000Z"),
    updatedAt: new Date("2026-10-24T00:00:00.000Z"),
  };
}

/** The stored row of a profile, as fake Prisma readers return it. */
export function providerProfileRowFixture(profile: WorkspaceProviderProfile) {
  const { credential } = profile;
  return {
    id: profile.id,
    workspaceId: profile.workspaceId,
    createdByUserId: profile.createdByUserId,
    credentialKind: credential.kind,
    authMode: credential.authMode,
    gatewayBindingId:
      credential.kind === "gateway_binding" ? credential.bindingId : null,
    gatewayProfileRef:
      credential.kind === "gateway_binding"
        ? credential.gatewayProfileRef
        : null,
    apiKeyConnectionId:
      credential.kind === "managed_api_key"
        ? credential.apiKeyConnectionId
        : null,
    repositoryId:
      credential.kind === "repository_rotating"
        ? credential.repositoryId
        : null,
    model: profile.model,
    label: profile.label,
    identityKey: profile.archivedAt ? null : `${profile.id}-identity`,
    archivedAt: profile.archivedAt,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  };
}

/**
 * The stored workspace document of a runtime configuration, selecting the
 * given profiles for its provider rows (none keeps the workspace without a
 * default).
 */
export function workspacePolicyDocumentFixture(
  config: ReturnType<typeof parseReviewConfigurationStrict>,
  profileIds: readonly string[] = [],
): WorkspaceReviewPolicy {
  return parseWorkspaceReviewPolicy({
    schemaVersion: STORED_REVIEW_POLICY_SCHEMA_VERSION,
    ...(profileIds.length
      ? { providers: selectionsFor(config, profileIds) }
      : {}),
    ...storedSettingsOf(config),
  });
}

/** Every stored setting of a runtime configuration except its providers. */
function storedSettingsOf(
  config: ReturnType<typeof parseReviewConfigurationStrict>,
) {
  return {
    execution: {
      providerMaxParallel: config.execution.providerMaxParallel,
      inlineMinAgreement: config.execution.inlineMinAgreement,
    },
    blockingPolicy: config.blockingPolicy,
    limits: config.limits,
    reviewLanguage: config.reviewLanguage,
    ...(config.updatePrDescription === undefined
      ? {}
      : { updatePrDescription: config.updatePrDescription }),
    investigationRollout: config.investigationRollout,
    ...(config.contextTools ? { contextTools: config.contextTools } : {}),
  };
}

/**
 * A system write storing exactly a runtime configuration for one target:
 * each provider row becomes a draft profile that the write finds or creates
 * by its identity, and the document selects it. A repository document names
 * every setting, so the result does not depend on the workspace document.
 * Managed API keys must exist in the workspace; MiMo uses one only when
 * `managedMimoKey` is set.
 */
export function systemPolicyWriteFixture(
  config: ReturnType<typeof parseReviewConfigurationStrict>,
  target: ReviewConfigurationTarget,
  options: { readonly managedMimoKey?: boolean } = {},
): {
  policy: ReviewPolicyDocument;
  profileDrafts: ProviderProfileDraft[];
} {
  const repositoryId =
    target.scope === "repository" ? target.repositoryId : null;
  const profileDrafts = config.providers.map((provider, index) => ({
    draftId: `draft-${index}`,
    credential: providerCredentialRequestFor(provider, {
      repositoryId,
      // Only the request's credential kind matters here; the write resolves
      // the stored key itself.
      managedApiKeys: {
        keyIds: new Map([
          ["openrouter", "fixture-openrouter-key"],
          ...(options.managedMimoKey === true
            ? [["mimo", "fixture-mimo-key"] as const]
            : []),
        ]),
        applied: () => true,
      },
    }),
    model: provider.model,
    label: null,
  }));
  const document = {
    schemaVersion: STORED_REVIEW_POLICY_SCHEMA_VERSION,
    providers: selectionsFor(
      config,
      profileDrafts.map((draft) => draft.draftId),
    ),
    ...storedSettingsOf(config),
  };
  return {
    policy:
      target.scope === "workspace"
        ? parseWorkspaceReviewPolicy(document)
        : parseRepositoryReviewPolicy(document),
    profileDrafts,
  };
}

/** A repository document selecting the profiles for the configuration's rows. */
export function repositoryPolicyDocumentFixture(
  config: ReturnType<typeof parseReviewConfigurationStrict>,
  profileIds: readonly string[],
  overrides: Omit<RepositoryReviewPolicy, "schemaVersion" | "providers"> = {},
): RepositoryReviewPolicy {
  return parseRepositoryReviewPolicy({
    schemaVersion: STORED_REVIEW_POLICY_SCHEMA_VERSION,
    providers: selectionsFor(config, profileIds),
    ...overrides,
  });
}

export function selectionsFor(
  config: ReturnType<typeof parseReviewConfigurationStrict>,
  profileIds: readonly string[],
): ReviewProviderSelection[] {
  return config.providers.map((provider, index) =>
    reviewProviderSelectionFor(provider, profileIds[index]!),
  );
}

/** A stored head of a document, as a policy head reader returns it. */
export function storedPolicyHeadFixture(
  policy: ReviewPolicyDocument,
  version = 1,
) {
  return {
    version,
    schemaVersion: STORED_REVIEW_POLICY_SCHEMA_VERSION,
    policyJson: canonicalJson(policy),
  };
}

/** The credential source a runtime provider row stands for in fixtures. */
export function credentialSourceFixture(
  provider: ReturnType<
    typeof parseReviewConfigurationStrict
  >["providers"][number],
  repositoryId: string,
): ProviderCredentialSource {
  switch (provider.authMode) {
    case "codex_account_gateway":
      return {
        kind: "gateway_binding",
        authMode: provider.authMode,
        bindingId: provider.gatewayBindingId,
        gatewayProfileRef: provider.gatewayProfileRef,
      };
    case "codex_subscription_oauth_hosted_pool":
      return { kind: "hosted_pool", authMode: provider.authMode };
    case "codex_subscription_oauth_rotating":
      return {
        kind: "repository_rotating",
        authMode: provider.authMode,
        repositoryId,
      };
    case "openrouter_api_key":
      return {
        kind: "managed_api_key",
        authMode: provider.authMode,
        apiKeyConnectionId: "key_openrouter",
      };
    case "kimi_code_api_key":
    case "mimo_token_plan_api_key":
    case "claude_code_oauth":
      return { kind: "user_ci_secret", authMode: provider.authMode };
  }
}

/**
 * Stored documents and profiles that materialize exactly the given runtime
 * configuration for one repository: the workspace default selects the
 * providers, or the repository does when one of them is rotating (never a
 * default).
 */
export function storedPolicyForConfiguration(
  config: ReturnType<typeof parseReviewConfigurationStrict>,
  input: { readonly workspaceId?: string; readonly repositoryId?: string } = {},
) {
  const workspaceId = input.workspaceId ?? "workspace_1";
  const repositoryId = input.repositoryId ?? "repository_1";
  const profiles = config.providers.map((provider, index) =>
    providerProfileFixture({
      id: `profile_${index}_${provider.authMode}`,
      workspaceId,
      credential: credentialSourceFixture(provider, repositoryId),
      model: provider.model,
    }),
  );
  const ids = profiles.map((profile) => profile.id);
  const rotating = config.providers.some(
    (provider) => provider.authMode === "codex_subscription_oauth_rotating",
  );
  return {
    profiles,
    profileRows: profiles.map(providerProfileRowFixture),
    workspaceHead: storedPolicyHeadFixture(
      workspacePolicyDocumentFixture(config, rotating ? [] : ids),
    ),
    repositoryHead: rotating
      ? storedPolicyHeadFixture(repositoryPolicyDocumentFixture(config, ids))
      : null,
  };
}
