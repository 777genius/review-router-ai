import { createHash } from "node:crypto";
import { App } from "@octokit/app";
import {
  githubAppIdentityHash,
  type AppWebhookRedeliveryClient,
  type WebhookRecoveryIdentity,
} from "@reviewrouter/features-github-installations";

type Fetch = typeof fetch;
type AppJwt = () => Promise<string>;
const apiOrigin = "https://api.github.com";

/**
 * Uses App JWT, a fixed GitHub origin and one non-redirecting POST.
 * Called by the explicit operational recovery command after authorization.
 */
export class GitHubAppWebhookRedeliveryClient implements AppWebhookRedeliveryClient {
  readonly appIdentityHash: string;
  private constructor(
    appId: string,
    private readonly jwt: AppJwt,
    private readonly send: Fetch,
  ) {
    this.appIdentityHash = githubAppIdentityHash({
      appId,
      apiBaseUrl: apiOrigin,
    });
  }
  static fromTrustedConfig(
    config: Readonly<{ appId: string; privateKey: string }>,
  ): GitHubAppWebhookRedeliveryClient {
    // App ID is validated before the signing key reaches any network operation.
    githubAppIdentityHash({ appId: config.appId, apiBaseUrl: apiOrigin });
    if (!config.privateKey)
      throw new Error("github_app_recovery_config_invalid");
    const app = new App({ appId: config.appId, privateKey: config.privateKey });
    return new GitHubAppWebhookRedeliveryClient(
      config.appId,
      async () => {
        const auth = (await app.octokit.auth({ type: "app" })) as {
          token?: unknown;
        };
        if (typeof auth.token !== "string" || !auth.token)
          throw new Error("github_app_recovery_auth_invalid");
        return auth.token;
      },
      fetch,
    );
  }
  /** Test-only composition: both injected callbacks remain trusted code. */
  static forSyntheticTest(
    appId: string,
    jwt: AppJwt,
    send: Fetch,
  ): GitHubAppWebhookRedeliveryClient {
    return new GitHubAppWebhookRedeliveryClient(appId, jwt, send);
  }
  async redeliver(
    githubDeliveryId: bigint,
  ): Promise<Readonly<{ status: number }>> {
    if (
      typeof githubDeliveryId !== "bigint" ||
      githubDeliveryId < 1n ||
      githubDeliveryId > 9223372036854775807n
    )
      throw new Error("github_app_recovery_delivery_invalid");
    const token = await this.jwt();
    if (typeof token !== "string" || !token || /[\r\n]/.test(token))
      throw new Error("github_app_recovery_auth_invalid");
    const response = await this.send(
      `${apiOrigin}/app/hook/deliveries/${githubDeliveryId}/attempts`,
      {
        method: "POST",
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": "2022-11-28",
        },
      },
    );
    const status = response.status;
    await cancelUnusedResponseBody(response);
    return { status };
  }
  /** Fetch the exact App delivery from GitHub without retaining its payload. */
  async verifyOriginalDelivery(
    identity: WebhookRecoveryIdentity,
    expectedSignatureHash: string,
  ): Promise<boolean> {
    if (
      !/^[a-f0-9]{64}$/.test(expectedSignatureHash) ||
      identity.appIdentityHash !== this.appIdentityHash ||
      identity.githubDeliveryId < 1n ||
      identity.githubDeliveryId > BigInt(Number.MAX_SAFE_INTEGER)
    )
      return false;
    try {
      const token = await this.jwt();
      if (typeof token !== "string" || !token || /[\r\n]/.test(token))
        return false;
      const response = await this.send(
        `${apiOrigin}/app/hook/deliveries/${identity.githubDeliveryId}`,
        {
          method: "GET",
          redirect: "error",
          cache: "no-store",
          signal: AbortSignal.timeout(15_000),
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${token}`,
            "X-GitHub-Api-Version": "2022-11-28",
          },
        },
      );
      if (response.status !== 200) {
        await cancelUnusedResponseBody(response);
        return false;
      }
      const value: unknown = JSON.parse(
        await readBoundedText(response, 30_000_000),
      );
      if (!value || typeof value !== "object" || Array.isArray(value))
        return false;
      const row = value as Record<string, unknown>;
      if (
        !Number.isSafeInteger(row.id) ||
        BigInt(row.id as number) !== identity.githubDeliveryId ||
        row.guid !== identity.deliveryGuid ||
        row.event !== identity.eventName ||
        row.action !== githubDeliveryAction(identity)
      )
        return false;
      if (
        row.installation_id !== null &&
        (!Number.isSafeInteger(row.installation_id) ||
          (row.installation_id as number) < 1)
      )
        return false;
      const installation =
        row.installation_id === null
          ? null
          : BigInt(row.installation_id as number);
      return (
        installation === identity.installationId &&
        signatureDigest(row.request) === expectedSignatureHash
      );
    } catch {
      return false;
    }
  }
  /** Read-only bounded list of App webhook attempts, never a success proof. */
  async scanAttempts(
    identity: WebhookRecoveryIdentity,
    maxPages: number,
    signal?: AbortSignal,
  ): Promise<
    Readonly<{
      state: "observed" | "not_observed" | "incomplete" | "rate_limited";
      pages: number;
      matchingAttempts: number;
    }>
  > {
    if (
      identity.appIdentityHash !== this.appIdentityHash ||
      !Number.isInteger(maxPages) ||
      maxPages < 1 ||
      maxPages > 5
    )
      throw new Error("github_app_recovery_scan_invalid");
    let cursor: string | undefined;
    let pages = 0;
    let matchingAttempts = 0;
    const seen = new Set<string>();
    while (pages < maxPages) {
      if (signal?.aborted)
        return { state: "incomplete", pages, matchingAttempts };
      const query = new URLSearchParams({
        per_page: "100",
        ...(cursor ? { cursor } : {}),
      });
      let response: Response;
      try {
        const token = await this.jwt();
        if (typeof token !== "string" || !token || /[\r\n]/.test(token))
          throw new Error("invalid_auth");
        signal?.throwIfAborted();
        response = await this.send(
          `${apiOrigin}/app/hook/deliveries?${query}`,
          {
            method: "GET",
            redirect: "error",
            cache: "no-store",
            signal: signal
              ? AbortSignal.any([signal, AbortSignal.timeout(15_000)])
              : AbortSignal.timeout(15_000),
            headers: {
              Accept: "application/vnd.github+json",
              Authorization: `Bearer ${token}`,
              "X-GitHub-Api-Version": "2022-11-28",
            },
          },
        );
      } catch {
        return { state: "incomplete", pages, matchingAttempts };
      }
      if (response.status !== 200) {
        const rateLimited =
          response.status === 429 ||
          (response.status === 403 &&
            (response.headers.get("x-ratelimit-remaining") === "0" ||
              response.headers.has("retry-after")));
        await cancelUnusedResponseBody(response);
        return {
          state: rateLimited ? "rate_limited" : "incomplete",
          pages,
          matchingAttempts,
        };
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(await readBoundedText(response, 1_000_000));
      } catch {
        return { state: "incomplete", pages, matchingAttempts };
      }
      if (!Array.isArray(parsed) || parsed.length > 100)
        return { state: "incomplete", pages, matchingAttempts };
      pages++;
      for (const item of parsed) {
        if (!item || typeof item !== "object")
          return { state: "incomplete", pages, matchingAttempts };
        const row = item as Record<string, unknown>;
        if (typeof row.guid !== "string" || typeof row.redelivery !== "boolean")
          return { state: "incomplete", pages, matchingAttempts };
        if (row.guid !== identity.deliveryGuid) continue;
        if (
          row.event !== identity.eventName ||
          row.action !== githubDeliveryAction(identity)
        )
          return { state: "incomplete", pages, matchingAttempts };
        if (row.redelivery !== true) continue;
        if (
          row.installation_id !== null &&
          (!Number.isSafeInteger(row.installation_id) ||
            (row.installation_id as number) < 1)
        )
          return { state: "incomplete", pages, matchingAttempts };
        const installation =
          row.installation_id === null
            ? null
            : BigInt(row.installation_id as number);
        if (installation !== identity.installationId)
          return { state: "incomplete", pages, matchingAttempts };
        if (
          !Number.isSafeInteger(row.id) ||
          (row.id as number) < 1 ||
          !Number.isInteger(row.status_code)
        )
          return { state: "incomplete", pages, matchingAttempts };
        matchingAttempts++;
      }
      const next = nextDeliveryCursor(response.headers.get("link"));
      if (next === null)
        return {
          state: matchingAttempts ? "observed" : "not_observed",
          pages,
          matchingAttempts,
        };
      if (next === false || seen.has(next))
        return { state: "incomplete", pages, matchingAttempts };
      seen.add(next);
      cursor = next;
    }
    return { state: "incomplete", pages, matchingAttempts };
  }
}

async function cancelUnusedResponseBody(response: Response): Promise<void> {
  // A cleanup failure must not discard an already received HTTP status.
  await response.body?.cancel().catch(() => undefined);
}

async function readBoundedText(
  response: Response,
  limit: number,
): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > limit) throw new Error("response_too_large");
      text += decoder.decode(next.value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

function nextDeliveryCursor(link: string | null): string | null | false {
  if (!link) return null;
  let remaining = link.trim();
  let nextUrl: string | undefined;
  while (remaining) {
    const target = remaining.match(/^<([^<>]+)>\s*/);
    if (!target) return false;
    remaining = remaining.slice(target[0].length);
    let relation: string | undefined;
    let anchored = false;
    while (remaining.startsWith(";")) {
      // Consume whole quoted values so commas and semicolons inside metadata
      // cannot be mistaken for another link or relation parameter.
      const parameter = remaining.match(
        /^;\s*([-!#$%&'*+.^_`|~0-9A-Za-z]+)(?:\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([-!#$%&'*+.^_`|~0-9A-Za-z]+)))?\s*/,
      );
      if (!parameter) return false;
      remaining = remaining.slice(parameter[0].length);
      const name = parameter[1]!.toLowerCase();
      if (name === "rel" && relation === undefined)
        relation = (parameter[2] ?? parameter[3] ?? "").replace(/\\(.)/g, "$1");
      if (name === "anchor") anchored = true;
    }
    if (relation?.toLowerCase().split(/\s+/).includes("next")) {
      // A pagination cursor is unambiguous and belongs to this response context.
      if (anchored || nextUrl !== undefined) return false;
      nextUrl = target[1]!;
    }
    if (!remaining) break;
    if (!remaining.startsWith(",")) return false;
    remaining = remaining.slice(1).trimStart();
    if (!remaining) return false;
  }
  if (nextUrl === undefined) return null;
  try {
    const url = new URL(nextUrl);
    if (
      url.origin !== apiOrigin ||
      url.pathname !== "/app/hook/deliveries" ||
      url.username ||
      url.password ||
      url.hash
    )
      return false;
    if (
      [...url.searchParams.keys()].some(
        (key) => key !== "cursor" && key !== "per_page",
      )
    )
      return false;
    if (
      url.searchParams.getAll("cursor").length !== 1 ||
      url.searchParams.getAll("per_page").length > 1
    )
      return false;
    const cursor = url.searchParams.get("cursor");
    return cursor && cursor.length <= 512 ? cursor : false;
  } catch {
    return false;
  }
}

function signatureDigest(request: unknown): string | null {
  if (!request || typeof request !== "object" || !("headers" in request))
    return null;
  const headers = request.headers;
  if (!headers || typeof headers !== "object" || Array.isArray(headers))
    return null;
  const signatures = Object.entries(headers)
    .filter(([name]) => name.toLowerCase() === "x-hub-signature-256")
    .map(([, value]) => value);
  if (
    signatures.length !== 1 ||
    typeof signatures[0] !== "string" ||
    !/^sha256=[a-f0-9]{64}$/.test(signatures[0])
  )
    return null;
  return createHash("sha256").update(signatures[0]).digest("hex");
}

function githubDeliveryAction(
  identity: WebhookRecoveryIdentity,
): string | null {
  // The receiver historically records push as an action; GitHub returns null.
  return identity.eventName === "push" && identity.action === "push"
    ? null
    : identity.action;
}
