/** Loopback-only Codex Responses proxy and its upstream boundaries. */
import { randomBytes } from "node:crypto";
import http from "node:http";
import type { UsageDelivery } from "./provider-usage-delivery.js";
import {
  createResponsesUsageObserver,
  createResponsesUsageStreamObserver,
} from "./provider-usage-responses.js";

type FetchLike = typeof fetch;
const defaultChatGptCodexResponsesUrl =
  "https://chatgpt.com/backend-api/codex/responses";
const maxProxyRequestBodyBytes = 2_000_000;
const maxProxyRequestsPerReview = 16;
const codexProxyForwardHeaderNames = new Set([
  "chatgpt-account-id",
  "openai-beta",
  "openai-organization",
  "openai-project",
  "originator",
  "session-id",
  "thread-id",
  "user-agent",
  "x-client-request-id",
  "x-oai-attestation",
  "x-openai-internal-codex-responses-lite",
  "x-responsesapi-include-timing-metrics",
]);

export type LocalProviderProxy = {
  readonly baseUrl: string;
  readonly close: () => Promise<void>;
};

export function routeCodexLocalProviderRequest(input: {
  readonly method: string;
  readonly path: string;
  readonly nonce: string;
  readonly bodyBytes: number;
}): "responses" | "deny" {
  if (input.method !== "POST") return "deny";
  if (input.bodyBytes > maxProxyRequestBodyBytes) return "deny";
  if (input.path !== `/${input.nonce}/v1/responses`) return "deny";
  return "responses";
}

export async function startCodexLocalProviderProxy(input: {
  readonly fetchImpl: FetchLike;
  readonly accessToken: string;
  readonly upstreamResponsesUrl: string;
  readonly usageDelivery?: UsageDelivery;
}): Promise<LocalProviderProxy> {
  const nonce = randomBytes(24).toString("base64url");
  let requestCount = 0;
  let closing = false;
  const activeUpstreamRequests = new Set<AbortController>();
  const requests = new Set<Promise<void>>();
  const server = http.createServer((req, res) => {
    const request = (async () => {
      try {
        const body = await readProxyRequestBody(req);
        const path = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
        const route = routeCodexLocalProviderRequest({
          method: req.method ?? "GET",
          path,
          nonce,
          bodyBytes: body.byteLength,
        });
        if (route !== "responses") {
          writeProxyDeny(res);
          return;
        }
        requestCount += 1;
        if (requestCount > maxProxyRequestsPerReview) {
          writeProxyError(res, 429, "proxy_request_budget_exceeded");
          return;
        }
        if (closing) {
          writeProxyError(res, 503, "proxy_closing");
          return;
        }
        const upstreamController = new AbortController();
        activeUpstreamRequests.add(upstreamController);
        const usage = input.usageDelivery
          ? createResponsesUsageObserver(input.usageDelivery, "", "codex")
          : undefined;
        let failed = false;
        try {
          usage?.dispatched();
          const upstream = await input.fetchImpl(input.upstreamResponsesUrl, {
            method: "POST",
            headers: buildCodexProxyUpstreamHeaders({
              requestHeaders: req.headers,
              fallbackAccessToken: input.accessToken,
            }),
            body: new Uint8Array(body),
            signal: upstreamController.signal,
          });
          usage?.responseReceived();
          failed = !upstream.ok;
          await writeProxyUpstreamResponse(res, upstream, usage);
        } catch (error) {
          failed = true;
          throw error;
        } finally {
          usage?.finish(failed, upstreamController.signal.aborted);
          activeUpstreamRequests.delete(upstreamController);
        }
      } catch {
        writeProxyError(res, 502, "proxy_upstream_failed");
      }
    })();
    requests.add(request);
    void request.finally(() => requests.delete(request));
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    await closeHttpServer(server);
    throw new Error("proxy_listener_invalid_address");
  }
  let closingPromise: Promise<void> | undefined;
  return {
    baseUrl: `http://127.0.0.1:${address.port}/${nonce}/v1`,
    close: () =>
      (closingPromise ??= (async () => {
        closing = true;
        for (const controller of activeUpstreamRequests)
          controller.abort(new Error("proxy_closing"));
        const closePromise = closeHttpServer(server);
        server.closeAllConnections();
        await closePromise;
        await Promise.all([...requests]);
      })()),
  };
}

export function resolveCodexProxyUpstreamResponsesUrl(
  env: NodeJS.ProcessEnv,
): string {
  return (
    env.REVIEWROUTER_CODEX_RESPONSES_URL ??
    env.REVIEWROUTER_OPENAI_RESPONSES_URL ??
    defaultChatGptCodexResponsesUrl
  );
}

function buildCodexProxyUpstreamHeaders(input: {
  readonly requestHeaders: http.IncomingHttpHeaders;
  readonly fallbackAccessToken: string;
}): Record<string, string> {
  const headers: Record<string, string> = {
    accept:
      getJoinedRequestHeader(input.requestHeaders, "accept") ??
      "text/event-stream",
    "content-type":
      getJoinedRequestHeader(input.requestHeaders, "content-type") ??
      "application/json",
  };
  const authorization = getJoinedRequestHeader(
    input.requestHeaders,
    "authorization",
  );
  headers.authorization =
    authorization && /^Bearer\s+\S+/i.test(authorization)
      ? authorization
      : `Bearer ${input.fallbackAccessToken}`;

  for (const name of Object.keys(input.requestHeaders)) {
    if (!shouldForwardCodexProxyHeader(name)) continue;
    const value = getJoinedRequestHeader(input.requestHeaders, name);
    if (value) {
      headers[name] = value;
    }
  }
  return headers;
}

function shouldForwardCodexProxyHeader(name: string): boolean {
  const lowerName = name.toLowerCase();
  return (
    codexProxyForwardHeaderNames.has(lowerName) ||
    lowerName.startsWith("x-codex-")
  );
}

function getJoinedRequestHeader(
  headers: http.IncomingHttpHeaders,
  name: string,
): string | undefined {
  const value = headers[name.toLowerCase()];
  if (Array.isArray(value)) return value.join(", ");
  return value;
}

function readProxyRequestBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    req.on("data", (chunk) => {
      const buffer = Buffer.from(chunk);
      bytes += buffer.byteLength;
      if (bytes > maxProxyRequestBodyBytes) {
        req.destroy(new Error("proxy_request_body_too_large"));
        return;
      }
      chunks.push(buffer);
    });
    req.on("error", reject);
    req.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

async function writeProxyUpstreamResponse(
  res: http.ServerResponse,
  upstream: Response,
  usage?: ReturnType<typeof createResponsesUsageObserver>,
): Promise<void> {
  const headers: Record<string, string> = {};
  const contentType = upstream.headers.get("content-type");
  if (contentType) {
    headers["content-type"] = contentType;
  }
  res.writeHead(upstream.status, headers);
  if (!upstream.body) {
    res.end();
    return;
  }
  const reader = upstream.body.getReader();
  const usageStream = usage
    ? createResponsesUsageStreamObserver(usage, contentType)
    : undefined;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      usageStream?.chunk(value);
      res.write(Buffer.from(value));
    }
    usageStream?.end();
    res.end();
  } finally {
    reader.releaseLock();
  }
}

function writeProxyDeny(res: http.ServerResponse): void {
  writeProxyError(res, 404, "proxy_route_denied");
}

function writeProxyError(
  res: http.ServerResponse,
  status: number,
  code: string,
): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: code }));
}

function closeHttpServer(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
