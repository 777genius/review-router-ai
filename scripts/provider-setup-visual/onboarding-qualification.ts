/** The bounded onboarding acceptance set; an exit code alone is insufficient. */
export const ONBOARDING_REQUIRED_SHOTS = {
  "flow-step3-create-attach": ["step3-dialog", "stepper-ready"],
  "flow-no-default": ["default-saved-next-step"],
  "flow-codex-repository-setup": [
    "codex-initial",
    "codex-issued",
    "codex-deadline-mobile",
    "codex-recovery-mobile",
    "codex-return-mobile",
  ],
} as const;

export type VisualSourceProvenance = Readonly<{
  revision: string;
  tree: string;
  sourceDeltaSha256: string;
  untrackedPaths: readonly string[];
}>;

export function onboardingQualificationProblems(
  input: Readonly<{
    flows: readonly Readonly<{
      flow: string;
      status: string;
      checks: readonly Readonly<{ pass: boolean }>[];
      screenshots: readonly string[];
      pageErrors: readonly string[];
    }>[];
    unavailableScreenshots: readonly string[];
    network: Readonly<{
      githubUnhandled: readonly string[];
      blocked: readonly string[];
    }>;
    sourceBefore: VisualSourceProvenance;
    sourceAfter: VisualSourceProvenance;
  }>,
): string[] {
  const problems: string[] = [];
  for (const [id, shots] of Object.entries(ONBOARDING_REQUIRED_SHOTS)) {
    const matches = input.flows.filter((flow) => flow.flow === id);
    if (matches.length !== 1) {
      problems.push(
        `${id}: expected one executed flow, found ${matches.length}`,
      );
      continue;
    }
    const flow = matches[0]!;
    if (flow.status !== "pass") problems.push(`${id}: ${flow.status}`);
    if (!flow.checks.length || flow.checks.some((check) => !check.pass))
      problems.push(`${id}: no passing checks or a failed check`);
    if (flow.pageErrors.length) problems.push(`${id}: browser runtime errors`);
    for (const shot of shots)
      if (!flow.screenshots.some((file) => file.endsWith(`-${shot}.png`)))
        problems.push(`${id}: missing screenshot ${shot}`);
  }
  for (const file of input.unavailableScreenshots)
    problems.push(`screenshot is missing or empty: ${file}`);
  if (input.network.githubUnhandled.length)
    problems.push("unhandled GitHub fixture requests");
  if (input.network.blocked.length)
    problems.push("unexpected external network requests");
  if (
    !/^[a-f0-9]{40}$/.test(input.sourceBefore.revision) ||
    !/^[a-f0-9]{40}$/.test(input.sourceBefore.tree) ||
    !/^[a-f0-9]{64}$/.test(input.sourceBefore.sourceDeltaSha256)
  )
    problems.push("source provenance is incomplete");
  if (JSON.stringify(input.sourceBefore) !== JSON.stringify(input.sourceAfter))
    problems.push("source changed while qualification was running");
  return problems;
}
