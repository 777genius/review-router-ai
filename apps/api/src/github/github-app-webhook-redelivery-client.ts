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
 * Draft only. Uses App JWT, fixed GitHub origin and a single non-redirecting
 * POST. Construction and invocation are not wired to production routes/jobs.
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
    return { status: response.status };
  }
  /** Fetch the exact App delivery from GitHub without retaining its payload. */
  async verifyOriginalDelivery(
    identity: WebhookRecoveryIdentity,
  ): Promise<boolean> {
    if (
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
      if (response.status !== 200) return false;
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
        row.action !== identity.action
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
      return installation === identity.installationId;
    } catch {
      return false;
    }
  }
  /**
   * Draft discovery for an unreceived body: only immutable App API metadata
   * and the digest of an available original signature are returned. Missing
   * or redacted signature headers fail closed; no payload is retained.
   */
  async inspectUnreceivedDelivery(
    githubDeliveryId: bigint,
  ): Promise<Readonly<{
    appIdentityHash: string;
    deliveryGuid: string;
    githubDeliveryId: bigint;
    eventName: string;
    action: string | null;
    installationId: bigint | null;
    signatureHash: string;
  }> | null> {
    if (
      typeof githubDeliveryId !== "bigint" ||
      githubDeliveryId < 1n ||
      githubDeliveryId > BigInt(Number.MAX_SAFE_INTEGER)
    )
      return null;
    try {
      const token = await this.jwt();
      if (typeof token !== "string" || !token || /[\r\n]/.test(token))
        return null;
      const response = await this.send(
        `${apiOrigin}/app/hook/deliveries/${githubDeliveryId}`,
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
      if (response.status !== 200) return null;
      const value: unknown = JSON.parse(
        await readBoundedText(response, 30_000_000),
      );
      if (!value || typeof value !== "object" || Array.isArray(value))
        return null;
      const row = value as Record<string, unknown>;
      if (
        !Number.isSafeInteger(row.id) ||
        BigInt(row.id as number) !== githubDeliveryId ||
        typeof row.guid !== "string" ||
        !row.guid ||
        row.guid.length > 200 ||
        typeof row.event !== "string" ||
        !row.event ||
        row.event.length > 100 ||
        !(row.action === null || typeof row.action === "string") ||
        !Number.isInteger(row.status_code)
      )
        return null;
      const status = row.status_code as number;
      if (!(status === 0 || (status >= 400 && status <= 599))) return null;
      if (
        row.installation_id !== null &&
        (!Number.isSafeInteger(row.installation_id) ||
          (row.installation_id as number) < 1)
      )
        return null;
      const request = row.request;
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
      return {
        appIdentityHash: this.appIdentityHash,
        deliveryGuid: row.guid,
        githubDeliveryId,
        eventName: row.event,
        action: row.action as string | null,
        installationId:
          row.installation_id === null
            ? null
            : BigInt(row.installation_id as number),
        signatureHash: createHash("sha256").update(signatures[0]).digest("hex"),
      };
    } catch {
      return null;
    }
  }

  /** Read-only bounded list of App webhook attempts, never a success proof. */
  async scanAttempts(
    identity: WebhookRecoveryIdentity,
    maxPages: number,
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
      const query = new URLSearchParams({
        per_page: "100",
        ...(cursor ? { cursor } : {}),
      });
      let response: Response;
      try {
        const token = await this.jwt();
        if (typeof token !== "string" || !token || /[\r\n]/.test(token))
          throw new Error("invalid_auth");
        response = await this.send(
          `${apiOrigin}/app/hook/deliveries?${query}`,
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
      } catch {
        return { state: "incomplete", pages, matchingAttempts };
      }
      if (
        response.status === 429 ||
        (response.status === 403 &&
          response.headers.get("x-ratelimit-remaining") === "0")
      )
        return { state: "rate_limited", pages, matchingAttempts };
      if (response.status !== 200)
        return { state: "incomplete", pages, matchingAttempts };
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
        if (row.event !== identity.eventName || row.action !== identity.action)
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
  if (!link || !/rel\s*=\s*"?next"?/i.test(link)) return null;
  const match = link.match(/<([^>]+)>\s*;\s*rel="next"/i);
  if (!match) return false;
  try {
    const url = new URL(match[1]!);
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
    const cursor = url.searchParams.get("cursor");
    return cursor && cursor.length <= 512 ? cursor : false;
  } catch {
    return false;
  }
}
