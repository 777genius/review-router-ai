"use client";

import {
  getSetupProvider,
  setupProviderForGatewayProfile,
} from "../../../src/features/provider-setup/setup-provider";
import { GatewayAccountLoadMore } from "./gateway-account-load-more";
import { Button } from "@reviewrouter/ui";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import type {
  AccountsPage,
  AccountsResult,
} from "../../../src/server/account-gateway-accounts";
import { getReadyGatewayAccounts } from "../../../src/server/dashboard-provider-setup-readiness";
import {
  apiKeySetupHref,
  type ApiKeySetupIntent,
} from "../../../src/features/provider-setup/api-key-storage";
import {
  useGatewayModelAccounts,
  useCurrentGatewayModelAccountsCache,
} from "../gateway-model-account-options";

export function ApiKeySetupReturn({
  intent,
  accounts,
}: {
  readonly intent: ApiKeySetupIntent;
  readonly accounts: AccountsResult<AccountsPage> | undefined;
}): React.ReactElement {
  const options = useGatewayModelAccounts(accounts, []);
  const cache = useCurrentGatewayModelAccountsCache();
  const router = useRouter();
  const [refreshing, startTransition] = useTransition();
  const page =
    options.accounts?.status === "ok" ? options.accounts.value : null;
  const ready = getReadyGatewayAccounts(options.accounts).some(
    (account) =>
      setupProviderForGatewayProfile(
        page?.profiles.find((profile) => profile.id === account.profileId),
      ) === intent.provider,
  );
  return (
    <section
      className="grid gap-2 border-b border-cyan-200/10 pb-4 text-sm text-slate-300"
      aria-label="Continue provider setup"
    >
      <p>
        {getSetupProvider(intent.provider).label}:{" "}
        {ready
          ? "An account is ready in this workspace."
          : "Connect an account, then use Access to give this workspace access."}
      </p>
      {ready ? (
        <a
          className="w-fit font-semibold text-cyan-200 underline"
          href={apiKeySetupHref("providers", intent)}
        >
          Back to provider setup
        </a>
      ) : (
        <div className="grid gap-2">
          <p className="text-xs text-slate-400">
            Provider setup will be available here when a matching account is
            ready.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="w-fit"
            disabled={refreshing || options.loading}
            onClick={() =>
              startTransition(async () => {
                await cache?.refresh();
                router.refresh();
              })
            }
          >
            Check availability
          </Button>
        </div>
      )}
      {!ready ? (
        <GatewayAccountLoadMore
          canLoadMore={options.canLoadMore}
          loading={options.loading}
          onLoadMore={options.loadMore}
        />
      ) : null}
    </section>
  );
}
