import {
  contextToolsSelectionSchema,
  type ContextToolsSelection,
} from "@reviewrouter/features-review-context-tools/selection";
import { repositoryPolicyFormFields } from "./review-policy-form-contract";
import type { ProviderSecretScope } from "@reviewrouter/features-provider-setup";
import type { ReviewRouterDiscussionMode } from "@reviewrouter/features-workflow-provisioning";
import {
  parseRepositoryReviewPolicy,
  parseWorkspaceReviewPolicy,
  STORED_REVIEW_POLICY_SCHEMA_VERSION,
  type RepositoryReviewSettings,
  type WorkspaceReviewSettings,
} from "@reviewrouter/features-review-config";
import type { MemoryScope } from "@reviewrouter/features-memory";
import {
  getProviderSecretNames,
  providerAuthModeBelongsToKind,
  providerAuthModeSchema,
  providerKindSchema,
  type ProviderAuthMode,
  type ProviderKind,
} from "@reviewrouter/features-review-providers";

/**
 * The workspace settings of the Models form. Providers are chosen in the
 * provider dialog and never travel with this form, so a form opened before a
 * provider change cannot revert it.
 */
export function readWorkspaceReviewSettingsForm(
  formData: FormData,
): WorkspaceReviewSettings {
  const updatePrDescription = readOptionalFormBoolean(
    formData,
    "updatePrDescription",
  );
  const { schemaVersion: _schemaVersion, ...settings } =
    parseWorkspaceReviewPolicy({
      schemaVersion: STORED_REVIEW_POLICY_SCHEMA_VERSION,
      ...(updatePrDescription === undefined ? {} : { updatePrDescription }),
      execution: {
        providerMaxParallel: readFormNumber(formData, "providerMaxParallel"),
        inlineMinAgreement: readFormNumber(formData, "inlineMinAgreement"),
      },
      blockingPolicy: {
        failOnSeverity: readFormString(formData, "failOnSeverity"),
      },
      limits: {
        inlineMaxComments: readFormNumber(formData, "inlineMaxComments"),
        targetTokensPerBatch: readFormNumber(formData, "targetTokensPerBatch"),
      },
      reviewLanguage:
        readOptionalFormString(formData, "reviewLanguage") ?? null,
      ...(readOptionalFormString(formData, "contextTools")
        ? { contextTools: readContextToolsSelection(formData) }
        : {}),
      investigationRollout: Object.fromEntries(
        investigationRolloutFields.map((name) => [
          name,
          readOptionalFormBoolean(formData, `investigationRollout.${name}`) ??
            false,
        ]),
      ),
    });
  void _schemaVersion;
  return settings;
}

const investigationRolloutFields = [
  "recordingEnabled",
  "shadowEnabled",
  "contextCriticEnabled",
  "verifiedCleanEnabled",
  "crossRevisionReplayEnabled",
  "productionEffectsEnabled",
] as const;

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
 * The repository overrides of its settings form; fields left to inherit are
 * absent. Its provider selection is changed only in the provider dialog.
 */
export function readRepositoryReviewSettingsForm(
  formData: FormData,
): RepositoryReviewSettings {
  const fields = repositoryPolicyFormFields.filter((field) => {
    const mode = readFormString(formData, `policyMode.${field.join(".")}`);
    if (mode !== "inherit" && mode !== "override")
      throw new Error("review_policy_override_mode_invalid");
    return mode === "override";
  });
  const policy: Record<string, unknown> = {
    schemaVersion: STORED_REVIEW_POLICY_SCHEMA_VERSION,
  };
  for (const [root, leaf] of fields) {
    if (root === "contextTools") {
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
  const { schemaVersion: _schemaVersion, ...settings } =
    parseRepositoryReviewPolicy(policy);
  void _schemaVersion;
  return settings;
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
