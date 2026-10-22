import type { AccountLimitsReader } from "@reviewrouter/features-provider-accounts";
import {
  createAccountLimitsClient,
  type ConsumerControlConfig,
} from "@agent-teams/account-gateway/http";
import {
  createAccountLimits,
  createGatewayAccountLimitsReader,
} from "@reviewrouter/features-provider-accounts/composition";

/** Capability negotiation fails closed; this client never invokes legacy quota handlers. */
export async function accountLimitsReader(
  settings:
    | ConsumerControlConfig
    | {
        role: "management";
        origin: string;
        token: string;
      },
): Promise<AccountLimitsReader> {
  try {
    const reader = createGatewayAccountLimitsReader(
      createAccountLimitsClient({
        ...settings,
        timeoutMs: 3000,
        responseBytes: 262144,
      }),
    );
    return (await createAccountLimits({ reader })).reader;
  } catch {
    // Optional quota support cannot hide authorized inventory if configuration,
    // SDK capability construction or composition is unavailable.
    return {
      read: async () => ({
        status: "unavailable",
        reason: "source_unavailable",
      }),
    };
  }
}
