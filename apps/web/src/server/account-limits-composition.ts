import type {
  AccountLimitsReader,
  AccountLimitsSourceResult,
  SubscriptionLimitsProvider,
} from "@reviewrouter/features-provider-accounts";
import {
  createAccountLimitsClient,
  createAccountLimitsV2Client,
  createConsumerControlClient,
  createManagementClient,
  GatewayError,
  type ConsumerControlConfig,
} from "@agent-teams/account-gateway/http";
import {
  createAccountLimits,
  createGatewayAccountLimitsReader,
} from "@reviewrouter/features-provider-accounts/composition";
import type { AccountLimitsV2 } from "@agent-teams/account-gateway/contracts";
import { subscriptionProfileProviders } from "./account-connection-catalog";

const subscriptionProviders = new Set<string>([
  "kimi",
  "glm",
  "minimax",
  "grok",
]);
/** Translate the validated SDK wire into the feature's observation vocabulary. */
export function subscriptionLimitsObservation(
  result: AccountLimitsV2,
  expectedProvider: SubscriptionLimitsProvider,
): AccountLimitsSourceResult {
  if (result.status !== "snapshot") return result;
  if (
    result.windows.some(
      (window) =>
        !subscriptionProviders.has(window.provider) ||
        window.provider !== expectedProvider,
    )
  )
    return { status: "unavailable", reason: "invalid_snapshot" };
  return {
    status: "snapshot",
    physicalGeneration: result.physicalGeneration,
    principalVersion: result.principalVersion,
    revision: result.revision,
    scope: result.scope,
    windows: result.windows.map((window) => ({
      id: window.id,
      family: window.provider as SubscriptionLimitsProvider,
      dimension: window.dimension,
      unit: window.unit,
      basis:
        window.period.kind === "duration"
          ? "duration"
          : window.period.kind === "monthly_billing_cycle"
            ? "billing_cycle"
            : "unknown",
      durationSeconds:
        window.period.kind === "duration"
          ? window.period.durationSeconds
          : null,
      usedPercent: window.usedPercent,
      observedAt: window.observedAt,
      resetAt: window.resetAt,
    })),
  };
}

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
    const legacy = createGatewayAccountLimitsReader(
      createAccountLimitsClient({
        ...settings,
        timeoutMs: 3000,
        responseBytes: 262144,
      }),
    );
    const v2 = createAccountLimitsV2Client({
      ...settings,
      contract: "account-limits/v2",
      timeoutMs: 3000,
      responseBytes: 262144,
    });
    const subscriptions = createGatewayAccountLimitsReader(
      {
        getAccountLimitsCapabilities: () => v2.getAccountLimitsCapabilities(),
        readAccountLimits: async (target) => {
          const provider =
            subscriptionProfileProviders[
              target.profileId as keyof typeof subscriptionProfileProviders
            ];
          return provider
            ? subscriptionLimitsObservation(
                await v2.readAccountLimits(target),
                provider,
              )
            : { status: "unsupported", reason: "unsupported_profile" };
        },
      },
      "account-limits/v2",
    );
    const discovery =
      settings.role === "management"
        ? createManagementClient({
            ...settings,
            timeoutMs: 3000,
            responseBytes: 262144,
          })
        : createConsumerControlClient({
            ...settings,
            timeoutMs: 3000,
            responseBytes: 262144,
          });
    let contracts: Promise<ReadonlyMap<string, string>> | undefined;
    const reader: AccountLimitsReader = {
      async read(target) {
        // Old profiles keep their cached v1 path, including deployments without
        // the additive capability endpoint. New profiles cannot fall back to v1.
        if (!Object.hasOwn(subscriptionProfileProviders, target.profileId))
          return legacy.read(target);
        try {
          contracts ??= discovery
            .getProviderConnectionCapabilities()
            .then(
              (value) =>
                new Map(
                  value.capabilities
                    .filter((item) => item.availability === "enabled")
                    .map((item) => [item.profileId, item.limitsContract]),
                ),
            );
          if ((await contracts).get(target.profileId) !== "account-limits/v2")
            return { status: "unsupported", reason: "unsupported_profile" };
          return subscriptions.read(target);
        } catch (error) {
          if (
            error instanceof GatewayError &&
            error.diagnostic &&
            ["forbidden", "not_found", "conflict", "unauthenticated"].includes(
              error.diagnostic.code,
            )
          )
            return { status: "unknown", reason: "generation_changed" };
          return { status: "unavailable", reason: "source_unavailable" };
        }
      },
    };
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
