import type { AccountUsageView } from "../../src/server/account-usage";

function uniqueNames(values: readonly (string | null)[]): string[] {
  const names = new Set<string>();
  for (const value of values) if (value) names.add(value);
  return [...names];
}

function shortList(values: readonly string[], limit = 2): string {
  const shown = values.slice(0, limit).join(", ");
  const remaining = values.length - Math.min(values.length, limit);
  return remaining > 0 ? `${shown} +${remaining} more` : shown;
}

// The readable identity is the repository name: internal target keys are never
// shown. Several targets can point at one repository, so names are deduplicated.
function repositoryNames(entries: readonly (string | null)[]): string[] {
  return uniqueNames(entries.map((name) => name ?? "repository unavailable"));
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
            repositoryNames(
              usage.reviews.map((review) => review.repositoryName),
            ),
          )}
        </p>
      ) : null}
      {usage.secretRepositories.length ? (
        <p>
          CI secrets (shared across the profile):{" "}
          {shortList(
            repositoryNames(
              usage.secretRepositories.map((secret) => secret.repositoryName),
            ),
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
          {repositoryNames(
            usage.reviews.map((review) => review.repositoryName),
          ).join(", ")}
          .
        </p>
      ) : null}
      {usage.secretRepositories.length ? (
        <p>
          Repository secrets are shared across the profile and can be used in
          workflows:{" "}
          {repositoryNames(
            usage.secretRepositories.map((secret) => secret.repositoryName),
          ).join(", ")}
          .
        </p>
      ) : null}
    </div>
  );
}
