/** Preserve qualification preloads while keeping the scenario's own heap cap. */
export function statisticsNodeOptions(
  inherited: string | undefined,
  oldSpaceLimitMiB: 1024 | 2048,
): string {
  // The last V8 option wins, so inherited budgets cannot enlarge this fixture.
  return [inherited, `--max-old-space-size=${oldSpaceLimitMiB}`]
    .filter(Boolean)
    .join(" ");
}
