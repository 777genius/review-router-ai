import type { AccountLimitsSourceResult } from "../../domain/account-limits";

/** Derived exclusively from the current server-side connection and authority. */
export type AccountLimitsTarget = {
  readonly ownerRef: string;
  readonly accountRef: string;
  readonly profileId: string;
  readonly expectedAuthorizationEpoch: number;
};
export type AccountLimitsCapability = {
  readonly contract: "account-limits/v1" | "account-limits/v2";
  readonly cachedRead: boolean;
  readonly quotaOnlyRefresh: boolean;
};
export interface AccountLimitsReader {
  /** No upstream requests, inference, credential repair or lifecycle mutations. */
  read(target: AccountLimitsTarget): Promise<AccountLimitsSourceResult>;
}
