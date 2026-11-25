export function RepositoryNameLink({
  fullName,
  repositoryUrl,
  className,
}: {
  readonly fullName: string;
  readonly repositoryUrl: string | null;
  readonly className: string;
}): React.ReactElement {
  const displayName = repositoryDisplayName(fullName);
  const classes = [
    className,
    repositoryUrl
      ? "transition hover:text-cyan-100 hover:underline hover:decoration-cyan-300/50 hover:underline-offset-4"
      : "",
  ].join(" ");

  if (!repositoryUrl) {
    return (
      <p className={classes} title={fullName}>
        {displayName}
      </p>
    );
  }

  return (
    <a
      href={repositoryUrl}
      target="_blank"
      rel="noreferrer"
      className={classes}
      title={fullName}
      aria-label={fullName}
    >
      {displayName}
    </a>
  );
}

export function repositoryDisplayName(fullName: string): string {
  const [, repo] = fullName.split("/");
  return repo || fullName;
}

export function RepositoryStarsBadge({
  stargazersCount,
}: {
  readonly stargazersCount: number;
}): React.ReactElement {
  const safeCount = Math.max(0, stargazersCount);

  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5 font-mono text-xs font-semibold leading-none text-amber-100/90"
      title={`${safeCount} GitHub stars`}
      aria-label={`${safeCount} GitHub stars`}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 16 16"
        className="h-3.5 w-3.5 shrink-0 translate-y-px fill-amber-300 text-amber-300"
      >
        <path d="M8 1.6 9.9 5.5l4.3.6-3.1 3 0.7 4.3L8 11.4l-3.8 2 0.7-4.3-3.1-3 4.3-.6L8 1.6Z" />
      </svg>
      <span className="leading-none">{formatRepositoryStars(safeCount)}</span>
    </span>
  );
}

function formatRepositoryStars(count: number): string {
  if (count < 1000) return String(count);

  return new Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(count);
}
