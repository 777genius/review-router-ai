export function hostedCodexAuthJsonFromDeviceTokens(input: {
  readonly idToken: string;
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly lastRefresh: Date;
}): Uint8Array {
  if (
    !input.idToken.trim() ||
    !input.accessToken.trim() ||
    !input.refreshToken.trim()
  ) {
    throw new Error("hosted_pool_device_login_artifact_invalid");
  }
  return new TextEncoder().encode(
    JSON.stringify({
      auth_mode: "chatgpt",
      tokens: {
        id_token: input.idToken,
        access_token: input.accessToken,
        refresh_token: input.refreshToken,
      },
      last_refresh: input.lastRefresh.toISOString(),
    }),
  );
}
