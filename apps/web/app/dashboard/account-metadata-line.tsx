import type {
  AccountMetadataFact,
  AccountMetadataSubscription,
  AccountMetadataView,
} from "@reviewrouter/features-provider-accounts/account-metadata";

function observed(
  fact: Extract<AccountMetadataFact<unknown>, { status: "known" }>,
): string {
  return `Last reported ${instant(fact.observedAt)}${fact.freshness === "stale" ? "; may be out of date" : ""}`;
}
function instant(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "at an unknown time"
    : `${date.toLocaleString("en-US", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "UTC",
      })} UTC`;
}
function subscriptionEnd(
  value: NonNullable<AccountMetadataSubscription["endsAt"]>,
): string {
  // A provider calendar date has no timezone; never interpret it as midnight UTC.
  return value.kind === "date" ? value.value : instant(value.value);
}

/** Displays the server-authorized native facts; does not infer a plan or identity. */
export function AccountMetadataLine({
  metadata,
}: {
  metadata?: AccountMetadataView | undefined;
}) {
  if (!metadata || metadata.status === "restricted") return null;
  if (metadata.status !== "available")
    return (
      <p className="mt-1 text-xs text-slate-400">
        {metadata.status === "unavailable"
          ? "Account details temporarily unavailable"
          : metadata.status === "unsupported"
            ? "Account details are not provided for this connection"
            : "Account details not reported yet"}
      </p>
    );
  const {
    email,
    accountLabel,
    subscription,
    credentialExpiresAt,
    privacyMode,
  } = metadata.fields;
  const identity =
    email.status === "known"
      ? email
      : accountLabel.status === "known"
        ? accountLabel
        : null;
  const hasFacts =
    identity ||
    subscription.status === "known" ||
    credentialExpiresAt.status === "known" ||
    privacyMode.status === "known";
  const hasStaleFacts = [
    identity,
    subscription,
    credentialExpiresAt,
    privacyMode,
  ].some((fact) => fact?.status === "known" && fact.freshness === "stale");
  if (!hasFacts)
    return (
      <p className="mt-1 text-xs text-slate-400">
        Account details not reported yet
      </p>
    );
  return (
    <div className="mt-1 min-w-0 space-y-1 text-xs text-slate-400">
      {identity && (
        <p
          className="break-words [overflow-wrap:anywhere]"
          title={observed(identity)}
        >
          {identity.value}
        </p>
      )}
      {(subscription.status === "known" || privacyMode.status === "known") && (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {subscription.status === "known" && (
            <span
              className="break-words text-cyan-100"
              title={observed(subscription)}
            >
              {subscription.value.label}
            </span>
          )}
          {privacyMode.status === "known" && (
            <span title={observed(privacyMode)}>
              {privacyMode.value === "private" ? "Private" : "Public"}
            </span>
          )}
        </p>
      )}
      {subscription.status === "known" && subscription.value.endsAt && (
        <p>Subscription ends {subscriptionEnd(subscription.value.endsAt)}</p>
      )}
      {credentialExpiresAt.status === "known" && (
        <p title={observed(credentialExpiresAt)}>
          Credential expires {instant(credentialExpiresAt.value)}
        </p>
      )}
      {hasStaleFacts && <p>Some account details may be out of date</p>}
    </div>
  );
}
