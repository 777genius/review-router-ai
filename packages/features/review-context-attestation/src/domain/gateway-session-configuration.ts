/** Gateway operation limits are fail-closed before any lease or network I/O. */
export type ContextGatewaySessionConfiguration = Readonly<{
  sessionLifetimeMs: number;
  reuseTtlMs: number;
  replayProofLifetimeMs: number;
  replayCapabilityLifetimeMs: number;
  attachmentCapabilityLifetimeMs: number;
}>;

export function assertContextGatewaySessionConfiguration(
  config: ContextGatewaySessionConfiguration,
  sessionSecretKeyByteLength: number,
): void {
  if (
    sessionSecretKeyByteLength !== 32 ||
    [
      config.sessionLifetimeMs,
      config.reuseTtlMs,
      config.replayProofLifetimeMs,
      config.replayCapabilityLifetimeMs,
      config.attachmentCapabilityLifetimeMs,
    ].some((value) => !Number.isSafeInteger(value) || value <= 0)
  ) {
    throw new Error("review_context_attestation_config_invalid");
  }
}
