import { Badge } from "@reviewrouter/ui";
import type { ProviderApiKeyRepositoryResult } from "@reviewrouter/features-provider-setup";
import { managedKeyErrorText } from "./provider-credential-delivery";

export function ManagedKeyResults({
  results,
}: {
  readonly results: readonly ProviderApiKeyRepositoryResult[];
}): React.ReactElement {
  const applied = results.filter((result) => result.status === "applied");
  return (
    <div className="grid gap-2">
      <p role="status" className="text-sm text-slate-200">
        {applied.length === results.length
          ? `The key is installed in all ${results.length} ${results.length === 1 ? "repository" : "repositories"}.`
          : `The key is installed in ${applied.length} of ${results.length} repositories. Install it again later for the others.`}
      </p>
      <ul className="grid divide-y divide-cyan-200/10 border-y border-cyan-200/10">
        {results.map((result) => (
          <li key={result.repositoryId} className="grid gap-1 py-2 text-sm">
            <span className="flex flex-wrap items-center justify-between gap-2">
              <span className="min-w-0 break-words text-cyan-50">
                {result.repositoryFullName}
              </span>
              <ManagedKeyStatusBadge status={result.status} />
            </span>
            {result.status !== "applied" && result.errorReason ? (
              <span className="text-xs leading-5 text-slate-400">
                {managedKeyErrorText(result.errorReason)}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ManagedKeyStatusBadge({
  status,
}: {
  readonly status: ProviderApiKeyRepositoryResult["status"];
}): React.ReactElement {
  switch (status) {
    case "applied":
      return (
        <Badge tone="success" size="xs">
          Up to date
        </Badge>
      );
    case "stale":
      return (
        <Badge tone="warning" size="xs">
          Older key
        </Badge>
      );
    case "applying":
    case "pending":
      return (
        <Badge tone="neutral" size="xs">
          Installing
        </Badge>
      );
    case "reconciliation_needed":
      return (
        <Badge tone="warning" size="xs">
          Checking
        </Badge>
      );
    case "denied":
      return (
        <Badge tone="warning" size="xs">
          Not allowed
        </Badge>
      );
    case "failed":
      return (
        <Badge tone="danger" size="xs">
          Failed
        </Badge>
      );
  }
}
