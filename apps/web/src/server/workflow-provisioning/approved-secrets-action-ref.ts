/** Setup selects only a registered immutable producer that ships the new profile.
 * Usage admission independently verifies its exact workflow/job source. */
export async function resolveApprovedSecretsRuntimeActionRef(
  actionRef: string,
  dependencies: {
    isRegistered(commitSha: string): Promise<boolean>;
    hasSecretsRuntime(commitSha: string): Promise<boolean>;
  },
): Promise<string | undefined> {
  const match = /^777genius\/review-router@([a-f0-9]{40})$/.exec(actionRef);
  if (!match) return undefined;
  try {
    if (!(await dependencies.isRegistered(match[1]!))) return undefined;
    return (await dependencies.hasSecretsRuntime(match[1]!))
      ? actionRef
      : undefined;
  } catch {
    // Optional telemetry adoption must not interrupt existing workflow setup.
    return undefined;
  }
}
