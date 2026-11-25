import { accountModelDiscoverySource } from "@agent-teams/account-gateway/contracts";
import type {
  AccountProfileView,
  AccountsResult,
  AccountView,
} from "../../server/account-gateway-accounts";
import type { AccountModelCatalogView } from "../account-gateway/connection-capabilities";

type CatalogProfile = Pick<AccountProfileView, "id" | "protocol"> &
  Partial<Pick<AccountProfileView, "authKind" | "connection">>;

/**
 * NVIDIA admits a model only from this exact account's own fresh catalogue
 * snapshot: a public model name or another account's list is no proof.
 */
export function accountModelCatalogRequired(
  profile: Partial<Pick<AccountProfileView, "connection">> | undefined,
): boolean {
  return profile?.connection?.provider === "nvidia";
}

/**
 * A browser clock a little behind the server must not make a list that was
 * just read look like it comes from the future. Expiry is never stretched.
 * The server checks (Gateway read, setup readiness) keep no tolerance: they
 * use the server clock and stay the authority.
 */
const FETCHED_AT_CLOCK_TOLERANCE_MS = 30_000;

/**
 * A snapshot from the account's own discovery source, inside its validity
 * window at `now`. The Gateway contract is the one authority for which profile
 * may carry a discovered catalogue and from which source; never infer it from
 * vendor labels.
 */
export function accountModelCatalogFresh(
  profile: CatalogProfile | undefined,
  catalog: AccountModelCatalogView | undefined,
  now: number = Date.now(),
): catalog is AccountModelCatalogView & {
  status: "snapshot";
  fetchedAt: string;
  expiresAt: string;
} {
  const source =
    profile?.id && profile.protocol && profile.authKind
      ? accountModelDiscoverySource({
          profileId: profile.id,
          protocol: profile.protocol,
          authKind: profile.authKind,
        })
      : undefined;
  return (
    catalog?.status === "snapshot" &&
    source !== undefined &&
    catalog.source === source &&
    Date.parse(catalog.fetchedAt ?? "") <=
      now + FETCHED_AT_CLOCK_TOLERANCE_MS &&
    Date.parse(catalog.expiresAt ?? "") > now
  );
}

/** A required list that is missing, failed or past its validity window. */
export function accountModelCatalogOutOfDate(
  profile: CatalogProfile | undefined,
  catalog: AccountModelCatalogView | undefined,
  now: number = Date.now(),
): boolean {
  return (
    accountModelCatalogRequired(profile) &&
    !accountModelCatalogFresh(profile, catalog, now)
  );
}

/** How long an ordinary account read stays fresh (unchanged behaviour). */
export const ACCOUNT_READ_STALE_MS = 15_000;
/**
 * After a failed read, an automatic read waits this long. It matches native's
 * own backoff for a failed model list, so retrying sooner cannot help; the
 * user's "Try again" is never delayed.
 */
export const ACCOUNT_READ_FAILURE_COOLDOWN_MS = 60_000;
/** A required list is read again this long before it lapses, at most. */
const REFRESH_LEAD_MAX_MS = 5 * 60_000;
/** ... and never sooner than this after the previous read. */
const REFRESH_GAP_MIN_MS = 20_000;
/** ... and at least hourly, which also keeps browser timers in range. */
const REFRESH_DELAY_MAX_MS = 60 * 60_000;

type AccountRead =
  | AccountsResult<{ account: AccountView; profile: AccountProfileView }>
  | undefined;

/**
 * When one account read should happen again, measured from when it arrived.
 * A required list that arrived fresh is read again shortly before it lapses,
 * so the choice stays selectable while the user decides (`refreshAt`). A failed
 * or already lapsed one waits for the cooldown and is never retried in a loop;
 * every other read keeps the ordinary staleness.
 */
export function accountReadSchedule(
  read: AccountRead,
  receivedAt: number,
): { readonly staleTime: number; readonly refreshAt: number | null } {
  if (read === undefined)
    return { staleTime: ACCOUNT_READ_STALE_MS, refreshAt: null };
  if (read.status !== "ok")
    return { staleTime: ACCOUNT_READ_FAILURE_COOLDOWN_MS, refreshAt: null };
  const { account, profile } = read.value;
  const catalog = account.modelCatalog;
  if (!accountModelCatalogRequired(profile))
    return { staleTime: ACCOUNT_READ_STALE_MS, refreshAt: null };
  if (!accountModelCatalogFresh(profile, catalog, receivedAt))
    return { staleTime: ACCOUNT_READ_FAILURE_COOLDOWN_MS, refreshAt: null };
  const expiresAt = Date.parse(catalog.expiresAt);
  const lifetime = expiresAt - Date.parse(catalog.fetchedAt);
  const refreshAt = Math.min(
    receivedAt + REFRESH_DELAY_MAX_MS,
    Math.max(
      receivedAt + REFRESH_GAP_MIN_MS,
      expiresAt - Math.min(REFRESH_LEAD_MAX_MS, lifetime / 4),
    ),
  );
  return { staleTime: refreshAt - receivedAt, refreshAt };
}
