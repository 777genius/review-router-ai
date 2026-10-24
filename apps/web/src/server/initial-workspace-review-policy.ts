import {
  defaultWorkspaceReviewPolicy,
  parseReviewConfiguration,
  REVIEW_POLICY_SCHEMA_VERSION,
  type ReviewConfiguration,
} from "@reviewrouter/features-review-config";
import {
  gatewayModelDefaultReasoningEffort,
  gatewayModelSupportsReasoningEffort,
} from "../features/account-gateway/review-reasoning-capabilities";
import type { AccountsPage, AccountsResult } from "./account-gateway-accounts";
import { getReadyGatewayAccounts } from "./dashboard-provider-setup-readiness";

/**
 * Form draft only: the first ready Gateway account as the default provider,
 * with the built-in workspace settings. The writer revalidates authority.
 */
export function initialWorkspaceReviewPolicyDraft(
  accounts: AccountsResult<AccountsPage> | undefined,
): ReviewConfiguration | null {
  if (accounts?.status !== "ok") return null;
  for (const account of getReadyGatewayAccounts(accounts)) {
    const profile = accounts.value.profiles.find(
      (item) => item.id === account.profileId,
    );
    for (const model of profile?.models ?? []) {
      const reasoningEffort = profile?.connection
        ? gatewayModelDefaultReasoningEffort(model, profile.connection)
        : (["medium", "high", "low"] as const).find((effort) =>
            gatewayModelSupportsReasoningEffort(model, effort),
          );
      if (
        !gatewayModelSupportsReasoningEffort(
          model,
          reasoningEffort,
          profile?.connection,
        )
      )
        continue;
      const defaults = defaultWorkspaceReviewPolicy();
      return parseReviewConfiguration({
        schemaVersion: REVIEW_POLICY_SCHEMA_VERSION,
        providers: [
          {
            kind: "codex",
            authMode: "codex_account_gateway",
            model,
            reasoningEffort,
            agenticContext: true,
            fastMode: false,
            requiredHealthy: true,
            gatewayBindingId: account.binding!.id,
            gatewayProfileRef: account.profileId,
          },
        ],
        execution: { providerLimit: 1, ...defaults.execution },
        blockingPolicy: defaults.blockingPolicy,
        limits: defaults.limits,
        reviewLanguage: defaults.reviewLanguage,
        investigationRollout: defaults.investigationRollout,
      });
    }
  }
  return null;
}
