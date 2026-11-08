import type { AccountLimitsSourceResult } from "../../domain/account-limits";
import type { AccountLimitsTarget } from "./account-limits-reader";

/** Explicit quota-only observation; never inference, repair or lifecycle mutation. */
export interface AccountLimitsRefresher {
  supports(profileId: string): Promise<boolean>;
  refresh(target: AccountLimitsTarget): Promise<AccountLimitsSourceResult>;
}
