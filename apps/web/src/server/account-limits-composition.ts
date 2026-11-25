import { AccountDiagnosisError } from "../features/account-gateway/account-diagnosis";
import { diagnoseAccountGatewayFailure } from "./account-gateway-diagnosis";
import type {
  AccountLimitsReader,
  AccountLimitsRefresher,
  AccountLimitsSourceResult,
  SubscriptionLimitsProvider,
} from "@reviewrouter/features-provider-accounts";
import {
  createAccountLimitsClient,
  createAccountLimitsRefreshClient,
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
            )
            .catch((error) => {
              // A transient discovery outage must not poison subsequent reads.
              contracts = undefined;
              throw error;
            });
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

/** How long a Gateway refresh capability answer is reused before rechecking. */
export const REFRESH_DISCOVERY_TTL_MS = 600_000;
type RefreshDiscovery = {
  checkedAt: number;
  profiles?: ReadonlySet<string>;
  pending?: Promise<ReadonlySet<string>> | undefined;
};
// Shared by every request of this process. Cached reads give discovery only
// 250 ms, so a cold per-request call could silently drop the refresh action.
const refreshDiscoveries = new Map<string, RefreshDiscovery>();

function discoverRefreshProfiles(
  key: string,
  load: () => Promise<ReadonlySet<string>>,
  now = Date.now(),
): Promise<ReadonlySet<string>> {
  let entry = refreshDiscoveries.get(key);
  if (!entry) refreshDiscoveries.set(key, (entry = { checkedAt: 0 }));
  if (!entry.pending && now - entry.checkedAt >= REFRESH_DISCOVERY_TTL_MS) {
    const current = entry;
    current.checkedAt = now;
    // A synchronous throw (e.g. invalid settings) must reject, not escape.
    current.pending = Promise.resolve()
      .then(load)
      .then((profiles) => (current.profiles = profiles))
      .catch((error) => {
        // Failed discovery is not evidence of an unsupported profile: never
        // cache it, so the next read asks again.
        current.checkedAt = 0;
        throw error;
      })
      .finally(() => {
        current.pending = undefined;
      });
    // A known answer keeps serving while it is rechecked in the background.
    current.pending.catch(() => undefined);
  }
  return entry.profiles ? Promise.resolve(entry.profiles) : entry.pending!;
}

/** Separate explicit effect; cached readers never gain refresh side effects. */
export function accountLimitsRefresher(
  settings:
    | ConsumerControlConfig
    | { role: "management"; origin: string; token: string },
): AccountLimitsRefresher {
  let client: ReturnType<typeof createAccountLimitsRefreshClient> | undefined;
  const getClient = () =>
    (client ??= createAccountLimitsRefreshClient({
      ...settings,
      timeoutMs: 10000,
      responseBytes: 262144,
    }));
  return {
    async supports(profileId) {
      const profiles = await discoverRefreshProfiles(
        `${settings.role}\0${settings.origin}`,
        () =>
          getClient()
            .getAccountLimitsRefreshCapabilities()
            .then(
              (value) =>
                new Set(
                  value.contract === "account-limits-refresh/v1" &&
                    value.quotaOnlyRefresh
                    ? value.profileIds
                    : [],
                ),
            ),
      );
      return profiles.has(profileId);
    },
    async refresh(target) {
      try {
        return await getClient().refreshAccountLimits(target);
      } catch (error) {
        if (
          error instanceof GatewayError &&
          error.diagnostic &&
          ["forbidden", "not_found", "conflict", "unauthenticated"].includes(
            error.diagnostic.code,
          )
        )
          return { status: "unknown", reason: "generation_changed" };
        throw new AccountDiagnosisError(diagnoseAccountGatewayFailure(error));
      }
    },
  };
}
