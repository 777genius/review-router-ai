import { createHash } from "node:crypto";

/** Trusted server configuration only; never use request headers as App identity. */
export function githubAppIdentityHash(
  config: Readonly<{ appId: string; apiBaseUrl: string }>,
): string {
  if (!/^[1-9][0-9]*$/.test(config.appId))
    throw new Error("github_app_webhook_config_invalid");
  let url: URL;
  try {
    url = new URL(config.apiBaseUrl);
  } catch {
    throw new Error("github_app_webhook_config_invalid");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error("github_app_webhook_config_invalid");
  const canonicalBase = url.href.replace(/\/+$/, "");
  return createHash("sha256")
    .update("reviewrouter-github-app-v1\0")
    .update(canonicalBase)
    .update("\0")
    .update(config.appId)
    .digest("hex");
}
