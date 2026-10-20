import type { AccountUsageView } from "../../src/server/account-usage";

function shortList(values: readonly (string | null)[], limit = 2): string {
  const names = values.filter((value): value is string => !!value);
  const shown = names.slice(0, limit).join(", ");
  const remaining = names.length - Math.min(names.length, limit);
  return remaining > 0 ? `${shown} +${remaining}` : shown;
}

function reviewLabel(targetKey: string, repositoryName: string | null): string {
  return repositoryName ? `${targetKey} · ${repositoryName}` : targetKey;
}

// Display-only usage facts. Review selection is exact per binding; repository
// secrets follow the profile (secretLevel), never one account row.
export function AccountUsageLine({
  usage,
}: {
  usage?: AccountUsageView | undefined;
}) {
  if (!usage || (!usage.reviews.length && !usage.secretRepositories.length))
    return null;
  return (
    <div className="mt-2 space-y-1 text-xs text-slate-400">
      {usage.reviews.length ? (
        <p>
          Selected for reviews:{" "}
          {shortList(
            usage.reviews.map((review) =>
              reviewLabel(review.targetKey, review.repositoryName),
            ),
          )}
        </p>
      ) : null}
      {usage.secretRepositories.length ? (
        <p>
          CI secrets (shared across the profile):{" "}
          {shortList(
            usage.secretRepositories.map((secret) => secret.repositoryName),
          )}
        </p>
      ) : null}
    </div>
  );
}

export function AccountUsageWarning({
  usage,
}: {
  usage?: AccountUsageView | undefined;
}) {
  if (!usage || (!usage.reviews.length && !usage.secretRepositories.length))
    return null;
  return (
    <div className="mt-3 rounded-xl border border-amber-300/20 bg-amber-300/[0.06] px-3 py-2 text-sm leading-6 text-amber-100">
      <p className="font-medium">Removal may stop CI and reviews.</p>
      {usage.reviews.length ? (
        <p>
          Selected for reviews:{" "}
          {usage.reviews
            .map((review) =>
              reviewLabel(review.targetKey, review.repositoryName),
            )
            .join(", ")}
          .
        </p>
      ) : null}
      {usage.secretRepositories.length ? (
        <p>
          Repository secrets are shared across the profile and can be used in
          workflows:{" "}
          {usage.secretRepositories
            .map((secret) => secret.repositoryName ?? "repository unavailable")
            .join(", ")}
          .
        </p>
      ) : null}
    </div>
  );
}
