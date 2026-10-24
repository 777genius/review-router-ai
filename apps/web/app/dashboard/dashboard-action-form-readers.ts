import {
  contextToolsSelectionSchema,
  type ContextToolsSelection,
} from "@reviewrouter/features-review-context-tools/selection";
import { repositoryPolicyFormFields } from "./review-policy-form-contract";
import type { ProviderSecretScope } from "@reviewrouter/features-provider-setup";
import type { ReviewRouterDiscussionMode } from "@reviewrouter/features-workflow-provisioning";
import {
  parseRepositoryReviewPolicy,
  parseReviewConfigurationStrict,
  parseWorkspaceReviewPolicy,
  reviewProviderConfigurationSchema,
  STORED_REVIEW_POLICY_SCHEMA_VERSION,
  type RepositoryReviewPolicy,
  type ReviewConfiguration,
  type ReviewProviderConfiguration,
  type ReviewProviderSelection,
  type WorkspaceReviewPolicy,
} from "@reviewrouter/features-review-config";
import type { MemoryScope } from "@reviewrouter/features-memory";
import {
  getProviderSecretNames,
  providerAuthModeBelongsToKind,
  providerAuthModeSchema,
  providerKindForAuthMode,
  providerKindSchema,
  type ProviderAuthMode,
  type ProviderKind,
} from "@reviewrouter/features-review-providers";

function readReviewProvidersForm(
  formData: FormData,
): ReviewConfiguration["providers"] {
  const providerCount = readFormNumber(formData, "providerCount");
  if (!Number.isInteger(providerCount) || providerCount < 1) {
    throw new Error("invalid_form_value:providerCount");
  }
  const providers = Array.from({ length: providerCount }, (_, index) => {
    const authMode = readProviderAuthMode(
      formData,
      `providerAuthMode.${index}`,
    );

    return reviewProviderConfigurationSchema.parse({
      kind: providerKindForAuthMode(authMode),
      authMode,
      model: readFormString(formData, `providerModel.${index}`),
      reasoningEffort: (authMode === "codex_account_gateway"
        ? (readOptionalFormString(
            formData,
            `providerReasoningEffort.${index}`,
          ) ?? undefined)
        : readFormString(
            formData,
            `providerReasoningEffort.${index}`,
          )) as ReviewConfiguration["providers"][number]["reasoningEffort"],
      agenticContext: readFormBoolean(
        formData,
        `providerAgenticContext.${index}`,
      ),
      fastMode: readFormBoolean(formData, `providerFastMode.${index}`),
      requiredHealthy:
        readOptionalFormBoolean(formData, `providerRequiredHealthy.${index}`) ??
        index === 0,

      gatewayBindingId:
        readOptionalFormString(formData, `providerGatewayBindingId.${index}`) ??
        undefined,
      gatewayProfileRef:
        readOptionalFormString(
          formData,
          `providerGatewayProfileRef.${index}`,
        ) ?? undefined,
      // Engine selection is serialized only from the Account Gateway row. The
      // shared schema keeps every explicit selection readable; the per-kind
      // save rule (agent_profile_requires_agentic_context) rejects only an
      // OCR-eligible selection beside agenticContext=false.
      ...readOptionalAgentProfileRef(formData, index),
    });
  });

  return providers;
}

function readOptionalAgentProfileRef(
  formData: FormData,
  index: number,
): { readonly agentProfileRef?: string } {
  const agentProfileRef = readOptionalFormString(
    formData,
    `providerAgentProfileRef.${index}`,
  );
  // Omit the key entirely when empty so legacy provider rows keep their
  // canonical JSON byte-identical (no materialized agentProfileRef field).
  return agentProfileRef === null ? {} : { agentProfileRef };
}

export function readReviewConfigurationForm(
  formData: FormData,
): ReviewConfiguration {
  const providers = readReviewProvidersForm(formData);
  const updatePrDescription = readOptionalFormBoolean(
    formData,
    "updatePrDescription",
  );

  return parseReviewConfigurationStrict({
    ...(updatePrDescription === undefined ? {} : { updatePrDescription }),
    schemaVersion: 3,
    providers,
    execution: {
      providerLimit: providers.length,
      providerMaxParallel: readFormNumber(formData, "providerMaxParallel"),
      inlineMinAgreement: readFormNumber(formData, "inlineMinAgreement"),
    },
    blockingPolicy: {
      failOnSeverity: readFormString(
        formData,
        "failOnSeverity",
      ) as ReviewConfiguration["blockingPolicy"]["failOnSeverity"],
    },
    limits: {
      inlineMaxComments: readFormNumber(formData, "inlineMaxComments"),
      targetTokensPerBatch: readFormNumber(formData, "targetTokensPerBatch"),
    },
    reviewLanguage: readOptionalFormString(formData, "reviewLanguage") ?? null,
    ...(readOptionalFormString(formData, "contextTools")
      ? { contextTools: readContextToolsSelection(formData) }
      : {}),
    investigationRollout: {
      recordingEnabled:
        readOptionalFormBoolean(
          formData,
          "investigationRollout.recordingEnabled",
        ) ?? false,
      shadowEnabled:
        readOptionalFormBoolean(
          formData,
          "investigationRollout.shadowEnabled",
        ) ?? false,
      contextCriticEnabled:
        readOptionalFormBoolean(
          formData,
          "investigationRollout.contextCriticEnabled",
        ) ?? false,
      verifiedCleanEnabled:
        readOptionalFormBoolean(
          formData,
          "investigationRollout.verifiedCleanEnabled",
        ) ?? false,
      crossRevisionReplayEnabled:
        readOptionalFormBoolean(
          formData,
          "investigationRollout.crossRevisionReplayEnabled",
        ) ?? false,
      productionEffectsEnabled:
        readOptionalFormBoolean(
          formData,
          "investigationRollout.productionEffectsEnabled",
        ) ?? false,
    },
  });
}

export function readFormString(formData: FormData, key: string): string {
  const value = formData.get(key);
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`missing_form_value:${key}`);
  }
  return value;
}

export function readOptionalFormString(
  formData: FormData,
  key: string,
): string | null {
  const value = formData.get(key);
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

export function readOptionalPositiveInteger(
  formData: FormData,
  key: string,
): number | undefined {
  const value = readOptionalFormString(formData, key);
  if (value === null) return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`invalid_form_value:${key}`);
  }
  return parsed;
}

export function readMemoryScope(formData: FormData): MemoryScope {
  const value = readFormString(formData, "scope");
  if (
    value === "repository" ||
    value === "workspace" ||
    value === "user_prefs"
  ) {
    return value;
  }
  throw new Error("invalid_form_value:memoryScope");
}

export function readOptionalEditedMemory(formData: FormData): {
  readonly optionalEditedBody?: string;
  readonly optionalScope?: MemoryScope;
} {
  const body = readOptionalFormString(formData, "body");
  const rawScope = readOptionalFormString(formData, "scope");
  const optionalScope =
    rawScope === null ? undefined : readMemoryScopeValue(rawScope);
  return {
    ...(body === null ? {} : { optionalEditedBody: body }),
    ...(optionalScope === undefined ? {} : { optionalScope }),
  };
}

export function readWorkflowStyle(formData: FormData): "reusable" | "explicit" {
  const value = formData.get("workflowStyle");
  return value === "explicit" ? "explicit" : "reusable";
}

export function readReviewDiscussionMode(
  formData: FormData,
): ReviewRouterDiscussionMode {
  const value = formData.get("reviewDiscussionMode");
  return value === "suggest" ? "suggest" : "off";
}

export function readProviderSetupSelection(formData: FormData): {
  readonly providerKind: ProviderKind;
  readonly authMode: ProviderAuthMode;
} {
  const providerKind = providerKindSchema.safeParse(
    readFormString(formData, "providerKind"),
  );
  const authMode = providerAuthModeSchema.safeParse(
    readFormString(formData, "authMode"),
  );

  if (
    providerKind.success &&
    authMode.success &&
    providerAuthModeBelongsToKind(authMode.data, providerKind.data)
  ) {
    return { providerKind: providerKind.data, authMode: authMode.data };
  }

  throw new Error("invalid_form_value:providerSetup");
}

export function readProviderSecretScope(
  formData: FormData,
): ProviderSecretScope {
  const value = readFormString(formData, "secretScope");
  if (
    value === "repository" ||
    value === "organization_selected_repositories" ||
    value === "organization_private_repositories" ||
    value === "organization_all_repositories"
  ) {
    return value;
  }

  throw new Error("invalid_form_value:secretScope");
}

export function readProviderSetupConfirmationMode(
  formData: FormData,
): "verified" | "manual" {
  const value = formData.get("confirmationMode");
  if (value === null) return "verified";
  if (value === "verified" || value === "manual") return value;

  throw new Error("invalid_form_value:confirmationMode");
}

export function providerSecretNamesForAuthMode(
  authMode: ProviderAuthMode,
): readonly string[] {
  return getProviderSecretNames(authMode);
}

export function providerSetupStateForSecretCheckError(
  error: unknown,
): "missing" | "stale_or_invalid" | "unknown" | null {
  if (!(error instanceof Error)) return null;

  switch (error.message) {
    case "provider_secret_not_found":
      return "missing";
    case "provider_secret_not_available_to_repository":
      return "stale_or_invalid";
    case "provider_secret_check_permission_required":
      return "unknown";
    case "repository_not_visible_to_github_app":
      return "unknown";
    default:
      return null;
  }
}

export function providerSecretAvailabilityStatusForError(
  error: unknown,
): "not_available_to_repository" | "missing" | "permission_required" | null {
  if (!(error instanceof Error)) return null;

  switch (error.message) {
    case "provider_secret_not_found":
      return "missing";
    case "provider_secret_not_available_to_repository":
      return "not_available_to_repository";
    case "provider_secret_check_permission_required":
    case "repository_not_visible_to_github_app":
      return "permission_required";
    default:
      return null;
  }
}

function readMemoryScopeValue(value: string): MemoryScope {
  if (
    value === "repository" ||
    value === "workspace" ||
    value === "user_prefs"
  ) {
    return value;
  }
  throw new Error("invalid_form_value:memoryScope");
}

function readProviderAuthMode(
  formData: FormData,
  key: string,
): ProviderAuthMode {
  const authMode = providerAuthModeSchema.safeParse(
    readFormString(formData, key),
  );
  if (!authMode.success) {
    throw new Error(`invalid_form_value:${key}`);
  }
  return authMode.data;
}

function readFormNumber(formData: FormData, key: string): number {
  const value = Number(readFormString(formData, key));
  if (!Number.isFinite(value)) {
    throw new Error(`invalid_form_number:${key}`);
  }
  return value;
}

function readFormBoolean(formData: FormData, key: string): boolean {
  const value = readFormString(formData, key);
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  throw new Error(`invalid_form_boolean:${key}`);
}

function readOptionalFormBoolean(
  formData: FormData,
  key: string,
): boolean | undefined {
  const value = readOptionalFormString(formData, key);
  if (value === null) return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`invalid_form_boolean:${key}`);
}

/**
 * The stored workspace document of a submitted workspace form, with the
 * selections its provider rows resolved to. The provider limit is the
 * selection count and is not stored.
 */
export function workspaceReviewPolicyFromConfiguration(
  config: ReviewConfiguration,
  selections: readonly ReviewProviderSelection[],
): WorkspaceReviewPolicy {
  return parseWorkspaceReviewPolicy({
    schemaVersion: STORED_REVIEW_POLICY_SCHEMA_VERSION,
    providers: selections,
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
    ...(config.contextTools === undefined
      ? {}
      : { contextTools: config.contextTools }),
  });
}

/**
 * A submitted repository form: the explicitly overridden settings as a stored
 * document without providers, and the provider rows when providers are
 * overridden (null inherits the workspace default).
 */
export function readRepositoryReviewPolicyForm(formData: FormData): Readonly<{
  policy: RepositoryReviewPolicy;
  providers: readonly ReviewProviderConfiguration[] | null;
}> {
  const fields = repositoryPolicyFormFields.filter((field) => {
    const mode = readFormString(formData, `policyMode.${field.join(".")}`);
    if (mode !== "inherit" && mode !== "override")
      throw new Error("review_policy_override_mode_invalid");
    return mode === "override";
  });
  const policy: Record<string, unknown> = {
    schemaVersion: STORED_REVIEW_POLICY_SCHEMA_VERSION,
  };
  let providers: readonly ReviewProviderConfiguration[] | null = null;
  for (const [root, leaf] of fields) {
    if (root === "providers") {
      providers = readReviewProvidersForm(formData);
    } else if (root === "contextTools") {
      policy.contextTools = readContextToolsSelection(formData);
    } else if (root === "updatePrDescription") {
      policy.updatePrDescription = readFormBoolean(formData, root);
    } else if (root === "reviewLanguage") {
      policy.reviewLanguage =
        readOptionalFormString(formData, "reviewLanguage") ?? null;
    } else {
      const name = leaf!;
      const value =
        root === "investigationRollout"
          ? (readOptionalFormBoolean(formData, `${root}.${name}`) ?? false)
          : root === "blockingPolicy"
            ? readFormString(formData, name)
            : readFormNumber(formData, name);
      const target = (policy[root] ??= {}) as Record<string, unknown>;
      target[name] = value;
    }
  }
  return { policy: parseRepositoryReviewPolicy(policy), providers };
}

export function readReviewPolicyExpectedVersion(
  formData: FormData,
): number | null {
  const value = readFormString(formData, "policyExpectedVersion");
  if (value === "none") return null;
  if (!/^[1-9][0-9]*$/.test(value) || !Number.isSafeInteger(Number(value)))
    throw new Error("review_policy_expected_version_invalid");
  return Number(value);
}

function readContextToolsSelection(formData: FormData): ContextToolsSelection {
  const raw = readOptionalFormString(formData, "contextTools");
  try {
    return contextToolsSelectionSchema.parse(
      raw ? JSON.parse(raw) : { version: 1, builtinTools: [], mcp: [] },
    );
  } catch {
    throw new Error("context_connection_invalid");
  }
}
