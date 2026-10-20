import {
  codexModelSupportsReasoningEffort,
  defaultProviderReasoningEffort,
  gatewayModelSchema,
  gatewayReferenceSchema,
  getProviderAuthModeMetadata,
  providerAuthModeBelongsToKind,
  providerAuthModeSchema,
  providerKindSchema,
} from "@reviewrouter/features-review-providers";
import { z } from "zod";

export const REVIEW_POLICY_SCHEMA_VERSION = 3 as const;

const reviewProviderSettingsSchema = z.object({
  kind: providerKindSchema,
  model: z.string().trim().min(1),
  reasoningEffort: z
    .enum(["low", "medium", "high", "xhigh", "max", "ultra"])
    .default(defaultProviderReasoningEffort),
  agenticContext: z.boolean().default(true),
  fastMode: z.boolean().default(false),
  requiredHealthy: z.boolean().default(false),
});

export const reviewProviderConfigurationSchema = z
  .discriminatedUnion("authMode", [
    reviewProviderSettingsSchema
      .extend({
        authMode: providerAuthModeSchema.exclude(["codex_account_gateway"]),
        gatewayBindingId: z.never().optional(),
        gatewayProfileRef: z.never().optional(),
        // Engine selection is only allowed on the Account Gateway row.
        agentProfileRef: z.never().optional(),
      })
      .strict(),
    reviewProviderSettingsSchema
      .extend({
        kind: z.literal("codex"),
        authMode: z.literal("codex_account_gateway"),
        model: gatewayModelSchema,
        gatewayBindingId: gatewayReferenceSchema,
        gatewayProfileRef: gatewayReferenceSchema,
        // Optional engine selection, separate from the model connection
        // selected by gatewayProfileRef. Absent keeps the configured default.
        agentProfileRef: gatewayReferenceSchema.optional(),
      })
      .strict(),
  ])
  .superRefine((provider, context) => {
    if (!providerAuthModeBelongsToKind(provider.authMode, provider.kind)) {
      context.addIssue({
        code: "custom",
        path: ["authMode"],
        message: "provider auth mode does not belong to provider kind",
      });
    }
    if (
      provider.authMode !== "codex_account_gateway" &&
      !codexModelSupportsReasoningEffort(
        provider.model,
        provider.reasoningEffort,
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["reasoningEffort"],
        message: "review reasoning effort is unsupported for model",
      });
    }
  });

/** Agent kinds of the approved toolchain profile an agentProfileRef selects. */
export type ReviewAgentProfileKind = "codex" | "claude" | "ocr";

/**
 * The per-kind save rule matching admission: only an OCR engine needs native
 * agentic context beside an explicit selection (its native context tools), so
 * only that combination is a configuration error. The policy document keeps
 * agentProfileRef opaque; save boundaries that know the resolved agent kind
 * apply this rule, and admission independently answers the incompatible OCR
 * selection with agent_profile_incompatible before any inference.
 */ export function reviewAgentProfileRequiresAgenticContext(
  agentKind: ReviewAgentProfileKind,
): boolean {
  return agentKind === "ocr";
}

/** Accurate machine message for the OCR native-context requirement above. */
export const agentProfileRequiresAgenticContextIssue =
  "agent_profile_requires_agentic_context";

/**
 * The operative save-time rule for an explicit engine selection beside
 * "supplied diff only". Returns the rejection message ONLY for an OCR-eligible
 * ref (the resolved agent kind whose native context tools cannot be promised
 * beside supplied-diff-only), matching admission, and null for codex/claude
 * selections which must save. Save boundaries that know the resolved agent
 * kind reject exactly the returned issue; the policy document itself stays
 * readable for every kind so admission can answer a saved incompatible
 * selection with its own actionable agent_profile_incompatible denial.
 */
export function reviewAgentProfileAgenticContextSaveIssue(
  provider: {
    readonly agentProfileRef?: string;
    readonly agenticContext: boolean;
  },
  agentKind: ReviewAgentProfileKind,
): string | null {
  if (provider.agentProfileRef === undefined || provider.agenticContext)
    return null;
  return reviewAgentProfileRequiresAgenticContext(agentKind)
    ? agentProfileRequiresAgenticContextIssue
    : null;
}

function sanitizeReviewLanguage(value: string): string | null {
  const firstLine = value.split(/[\r\n]/)[0] ?? "";
  const cleaned = firstLine
    .replace(/[^\p{L}\p{M}\s()\-/]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40);
  return cleaned.length > 0 ? cleaned : null;
}

export const reviewLanguageSchema = z
  .string()
  .transform(sanitizeReviewLanguage)
  .nullable();

export const blockingPolicySchema = z
  .object({
    failOnSeverity: z.enum(["off", "critical", "major"]),
  })
  .strict();

export const limitsSchema = z
  .object({
    inlineMaxComments: z.number().int().min(0).max(50),
    targetTokensPerBatch: z.number().int().min(4000).max(200000),
  })
  .strict();

export const reviewExecutionConfigurationSchema = z
  .object({
    providerLimit: z.number().int().min(1).max(16),
    providerMaxParallel: z.number().int().min(1).max(16),
    inlineMinAgreement: z.number().int().min(1).max(16),
  })
  .strict();

export const reviewInvestigationRolloutConfigurationSchema = z
  .object({
    recordingEnabled: z.boolean(),
    shadowEnabled: z.boolean(),
    contextCriticEnabled: z.boolean(),
    verifiedCleanEnabled: z.boolean(),
    crossRevisionReplayEnabled: z.boolean(),
    productionEffectsEnabled: z.boolean(),
  })
  .strict();

export const reviewConfigurationSchema = z
  .object({
    schemaVersion: z.literal(REVIEW_POLICY_SCHEMA_VERSION),
    providers: z.array(reviewProviderConfigurationSchema).min(1).max(16),
    execution: reviewExecutionConfigurationSchema,
    blockingPolicy: blockingPolicySchema,
    limits: limitsSchema,
    reviewLanguage: reviewLanguageSchema,
    investigationRollout: reviewInvestigationRolloutConfigurationSchema,
  })
  .strict()
  .superRefine((configuration, context) => {
    assertProviderRowsAreExplicitAndUnique(configuration.providers, context);
    if (
      configuration.execution.providerLimit !==
        configuration.providers.length ||
      configuration.execution.providerMaxParallel >
        configuration.providers.length ||
      configuration.execution.inlineMinAgreement >
        configuration.providers.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["execution"],
        message: "review execution limits do not match providers",
      });
    }
  });

export const reviewRepositoryPolicyOverrideSchema = z
  .object({
    schemaVersion: z.literal(REVIEW_POLICY_SCHEMA_VERSION),
    providers: z
      .array(reviewProviderConfigurationSchema)
      .min(1)
      .max(16)
      .optional(),
    execution: reviewExecutionConfigurationSchema.partial().optional(),
    blockingPolicy: blockingPolicySchema.partial().optional(),
    limits: limitsSchema.partial().optional(),
    reviewLanguage: reviewLanguageSchema.optional(),
    investigationRollout: reviewInvestigationRolloutConfigurationSchema
      .partial()
      .optional(),
  })
  .strict()
  .superRefine((override, context) => {
    if (override.providers) {
      assertProviderRowsAreExplicitAndUnique(override.providers, context);
      if (
        override.execution?.providerLimit !== undefined &&
        override.execution.providerLimit !== override.providers.length
      ) {
        context.addIssue({
          code: "custom",
          path: ["execution", "providerLimit"],
          message: "repository provider limit must match its provider array",
        });
      }
    }
  });

export type ReviewProviderConfiguration = z.infer<
  typeof reviewProviderConfigurationSchema
>;
export type ReviewExecutionConfiguration = z.infer<
  typeof reviewExecutionConfigurationSchema
>;
export type ReviewInvestigationRolloutConfiguration = z.infer<
  typeof reviewInvestigationRolloutConfigurationSchema
>;
export type ReviewConfiguration = z.infer<typeof reviewConfigurationSchema>;
export type WorkspaceReviewPolicy = ReviewConfiguration;
export type RepositoryReviewPolicyOverride = z.infer<
  typeof reviewRepositoryPolicyOverrideSchema
>;
export type ReviewPolicyDocument =
  | WorkspaceReviewPolicy
  | RepositoryReviewPolicyOverride;

export function parseReviewConfiguration(input: unknown): ReviewConfiguration {
  return reviewConfigurationSchema.parse(input);
}

export function parseReviewConfigurationStrict(
  input: unknown,
): ReviewConfiguration {
  return parseReviewConfiguration(input);
}

export function parseRepositoryReviewPolicyOverride(
  input: unknown,
): RepositoryReviewPolicyOverride {
  return reviewRepositoryPolicyOverrideSchema.parse(input);
}

export function resolveReviewPolicy(
  workspace: ReviewConfiguration,
  override?: RepositoryReviewPolicyOverride | null,
): ReviewConfiguration {
  const parsedWorkspace = parseReviewConfiguration(workspace);
  const parsedOverride = override
    ? parseRepositoryReviewPolicyOverride(override)
    : null;
  if (!parsedOverride) return parsedWorkspace;

  return parseReviewConfiguration({
    schemaVersion: REVIEW_POLICY_SCHEMA_VERSION,
    providers: parsedOverride.providers ?? parsedWorkspace.providers,
    execution: {
      ...parsedWorkspace.execution,
      ...definedOnly(parsedOverride.execution),
    },
    blockingPolicy: {
      ...parsedWorkspace.blockingPolicy,
      ...definedOnly(parsedOverride.blockingPolicy),
    },
    limits: {
      ...parsedWorkspace.limits,
      ...definedOnly(parsedOverride.limits),
    },
    reviewLanguage:
      parsedOverride.reviewLanguage !== undefined
        ? parsedOverride.reviewLanguage
        : parsedWorkspace.reviewLanguage,
    investigationRollout: {
      ...parsedWorkspace.investigationRollout,
      ...definedOnly(parsedOverride.investigationRollout),
    },
  });
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("review_policy_json_invalid");
  return encoded;
}

function definedOnly<T extends object>(value: T | undefined): Partial<T> {
  return Object.fromEntries(
    Object.entries(value ?? {}).filter(([, child]) => child !== undefined),
  ) as Partial<T>;
}

function assertProviderRowsAreExplicitAndUnique(
  providers: readonly ReviewProviderConfiguration[],
  context: z.RefinementCtx,
): void {
  const seen = new Set<string>();
  providers.forEach((provider, index) => {
    const key = JSON.stringify([
      provider.kind,
      provider.authMode,
      provider.model.trim(),
      provider.gatewayBindingId ?? null,
      provider.gatewayProfileRef ?? null,
      provider.agentProfileRef ?? null,
    ]);
    if (seen.has(key)) {
      context.addIssue({
        code: "custom",
        path: ["providers", index],
        message: "duplicate review provider",
      });
    }
    seen.add(key);
  });
}

export function providerRuntimeAuthMode(
  provider: ReviewProviderConfiguration,
): ReturnType<typeof getProviderAuthModeMetadata>["runtimeAuthMode"] {
  return getProviderAuthModeMetadata(provider.authMode).runtimeAuthMode;
}
