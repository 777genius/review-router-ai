import type {
  AccountLimitsReader,
  AccountLimitsTarget,
} from "../../application/ports/account-limits-reader";
import type { AccountLimitsSourceResult } from "../../domain/account-limits";

/** Structural consumer boundary implemented by the qualified Gateway SDK client. */
export type GatewayAccountLimitsClient = {
  getAccountLimitsCapabilities(options?: {
    readonly signal?: AbortSignal;
  }): Promise<{
    contract: string;
    cachedRead: boolean;
    quotaOnlyRefresh: boolean;
  }>;
  readAccountLimits(
    target: AccountLimitsTarget,
    options?: { readonly signal?: AbortSignal },
  ): Promise<AccountLimitsSourceResult>;
};

/** Only canonical SDK observations enter this adapter; never admin /usage or raw extra. */
export function createGatewayAccountLimitsReader(
  client: GatewayAccountLimitsClient,
  contract:
    | "account-limits/v1"
    | "account-limits/v2"
    | "account-limits/v3" = "account-limits/v1",
): AccountLimitsReader {
  let capability: Promise<boolean> | undefined;
  return {
    async read(target, options) {
      try {
        if (options?.signal?.aborted)
          return { status: "unavailable", reason: "source_unavailable" };
        capability ??= client
          .getAccountLimitsCapabilities(options)
          .then(
            (value) => value.contract === contract && value.cachedRead === true,
          )
          .catch(() => {
            // A canceled page or failed transport cannot disable the reused
            // reader. Ownership is released only when this attempt settles.
            capability = undefined;
            return false;
          });
        if (!(await capability) || options?.signal?.aborted)
          return { status: "unavailable", reason: "source_unavailable" };
        // The SDK owns transport size/deadline and strict canonical DTO validation.
        // Domain projection independently validates fields and strips source identity.
        return await client.readAccountLimits(target, options);
      } catch (error) {
        // The SDK exposes only its validated safe diagnostic here. An authority
        // or identity refusal must clear a previous display, rather than look
        // like a transient outage for which the browser keeps the old snapshot.
        const diagnostic =
          error && typeof error === "object" && "diagnostic" in error
            ? error.diagnostic
            : null;
        if (
          diagnostic &&
          typeof diagnostic === "object" &&
          "code" in diagnostic &&
          typeof diagnostic.code === "string" &&
          ["forbidden", "not_found", "conflict", "unauthenticated"].includes(
            diagnostic.code,
          )
        )
          return { status: "unknown", reason: "generation_changed" };
        return { status: "unavailable", reason: "source_unavailable" };
      }
    },
  };
}
