import {
  parseReviewConfiguration,
  type ReviewConfiguration,
} from "@reviewrouter/features-review-config";
import { gatewayModelSupportsReasoningEffort } from "../features/account-gateway/review-reasoning-capabilities";
import type { AccountsPage, AccountsResult } from "./account-gateway-accounts";
import { getReadyGatewayAccounts } from "./dashboard-provider-setup-readiness";

/** Form draft only. The existing writer revalidates authority before persistence. */
export function initialWorkspaceReviewPolicyDraft(
  accounts: AccountsResult<AccountsPage> | undefined,
): ReviewConfiguration | null {
  if (accounts?.status !== "ok") return null;
  for (const account of getReadyGatewayAccounts(accounts)) {
    const profile = accounts.value.profiles.find(
      (item) => item.id === account.profileId,
    );
    for (const model of profile?.models ?? []) {
      const reasoningEffort = (["medium", "high", "low"] as const).find(
        (effort) => gatewayModelSupportsReasoningEffort(model, effort),
      );
      if (!reasoningEffort) continue;
      return parseReviewConfiguration({
        schemaVersion: 3,
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
        execution: {
          providerLimit: 1,
          providerMaxParallel: 1,
          inlineMinAgreement: 1,
        },
        blockingPolicy: { failOnSeverity: "critical" },
        limits: { inlineMaxComments: 50, targetTokensPerBatch: 50000 },
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
    }
  }
  return null;
}
