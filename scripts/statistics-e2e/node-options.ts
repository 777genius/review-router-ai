import { tokenizeArgs } from "next/dist/server/lib/utils.js";

/** Preserve qualification preloads while keeping the scenario's own heap cap. */
export function statisticsNodeOptions(
  inherited: string | undefined,
  oldSpaceLimitMiB: 1024 | 2048,
): string {
  // Percentage mode overrides absolute limits regardless of option order.
  // Reuse Next's NODE_OPTIONS tokenizer without rewriting accepted input.
  if (
    tokenizeArgs(inherited ?? "").some(
      (argument) =>
        argument.split("=", 1)[0]?.replaceAll("_", "-") ===
        "--max-old-space-size-percentage",
    )
  ) {
    throw new Error(
      "Statistics browser fixtures do not support percentage heap limits in NODE_OPTIONS",
    );
  }
  // The last absolute old-space option retains the scenario's fixed limit.
  return [inherited, `--max-old-space-size=${oldSpaceLimitMiB}`]
    .filter(Boolean)
    .join(" ");
}
