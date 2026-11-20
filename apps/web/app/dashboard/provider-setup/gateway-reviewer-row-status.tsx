"use client";

import type { ReviewProviderSelection } from "@reviewrouter/features-review-config/review-policy-document";
import type {
  AccountProfileView,
  AccountView,
} from "../../../src/server/account-gateway-accounts";
import type { useGatewayModelAccounts } from "../gateway-model-account-options";
import { hasDailyRequestLimit } from "../../../src/features/provider-setup/daily-request-limit";
import { providerSelectionSettingsNeedCorrection } from "./provider-model-fields";

/**
 * What a reviewer row in the roster says about its account, model and
 * settings. The daily limit line is for a roster with several reviewers; a
 * single one gets the roster's DailyLimitNotice instead.
 */
export function GatewayReviewerRowStatus({
  bindingId,
  model,
  account,
  profile,
  accounts,
  settings,
  showDailyLimit,
}: {
  bindingId: string;
  model: string;
  account: AccountView | undefined;
  profile: AccountProfileView | undefined;
  accounts: Pick<
    ReturnType<typeof useGatewayModelAccounts>,
    "loading" | "listFailed"
  >;
  settings: Omit<ReviewProviderSelection, "profileId">;
  showDailyLimit: boolean;
}): React.ReactElement {
  return (
    <>
      {bindingId && !account && !accounts.loading && !accounts.listFailed ? (
        <p className="text-xs leading-5 text-amber-100">
          This account is unavailable. Edit this reviewer to choose another
          account.
        </p>
      ) : profile && model && !profile.models.includes(model) ? (
        <p className="text-xs leading-5 text-amber-100">
          {account?.modelCatalog?.status === "snapshot"
            ? "This model is unavailable for this account. Edit this reviewer to choose another model."
            : account?.modelCatalog?.status === "unknown" ||
                account?.modelCatalog?.status === "unavailable"
              ? "Model availability could not be checked. Edit this reviewer to try again. Your saved selection is unchanged."
              : "This model is not in the configured choices for this account. Edit this reviewer to check its connection."}
        </p>
      ) : profile &&
        providerSelectionSettingsNeedCorrection({
          authMode: "codex_account_gateway",
          model,
          settings,
          connection: profile.connection,
          gatewayProfileRef: profile.id,
        }) ? (
        <p className="text-xs leading-5 text-amber-100">
          Review settings need updating for this model.
        </p>
      ) : null}
      {showDailyLimit &&
      hasDailyRequestLimit({
        provider: profile?.connection?.provider,
        model,
      }) ? (
        <p className="text-xs leading-5 text-slate-400">
          Free OpenRouter models have a daily request limit. When it runs out,
          this reviewer stops until the limit resets.
        </p>
      ) : null}
    </>
  );
}
