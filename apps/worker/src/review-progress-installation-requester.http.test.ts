import { generateKeyPairSync } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createProgressInstallationRequester } from "./review-progress-installation-requester";
import {
  createReviewProgressMarker,
  ReviewProgressGitHubGateway,
} from "./review-progress-github-gateway";

let privateKey: string;
const cleanups: Array<() => Promise<void>> = [];
beforeAll(() => {
  privateKey = generateKeyPairSync("rsa", { modulusLength: 2048 })
    .privateKey.export({ type: "pkcs8", format: "pem" })
    .toString();
});
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

describe("progress requester real Octokit HTTP deadlines", () => {
  it("aborts a stalled App identity lookup and discovers the identity after recovery", async () => {
    let unhealthy = true;
    let attempts = 0;
    let closed = false;
    const transport = await githubServer((request, response) => {
      expect(request.url).toBe("/app");
      attempts += 1;
      if (unhealthy) {
        response.once("close", () => {
          closed = !response.writableFinished;
        });
        return;
      }
      json(response, { slug: "reviewrouter" });
    });
    const factory = requester(transport, 250);
    await expect(factory(1n)).rejects.toThrow();
    await vi.waitFor(() => expect(closed).toBe(true));
    unhealthy = false;
    await expect(factory(1n)).resolves.toMatchObject({
      botLogin: "reviewrouter[bot]",
    });
    expect(attempts).toBe(2);
  });

  it("bounds the hidden installation-token POST, then retries only on a fresh caller", async () => {
    let unhealthy = true;
    let tokens = 0;
    let routes = 0;
    let closed = false;
    const transport = await githubServer((request, response) => {
      if (request.url === "/app")
        return json(response, { slug: "reviewrouter" });
      if (request.url === "/app/installations/1/access_tokens") {
        tokens += 1;
        expect(request.method).toBe("POST");
        if (unhealthy) {
          response.once("close", () => {
            closed = !response.writableFinished;
          });
          return;
        }
        return json(response, installationToken());
      }
      routes += 1;
      json(response, { id: 42 });
    });
    const installation = await requester(transport, 250)(1n);
    await expect(
      installation.request("GET /repos/acme/rocket"),
    ).rejects.toThrow();
    await vi.waitFor(() => expect(closed).toBe(true));
    expect(tokens).toBe(1);
    expect(routes).toBe(0);
    unhealthy = false;
    await expect(
      installation.request("GET /repos/acme/rocket"),
    ).resolves.toMatchObject({ data: { id: 42 } });
    expect(tokens).toBe(2);
    expect(routes).toBe(1);
  });

  it("rejects a stalled JSON body instead of exposing a successful empty response", async () => {
    let unhealthy = true;
    let closed = false;
    const transport = await githubServer((request, response) => {
      if (request.url === "/app")
        return json(response, { slug: "reviewrouter" });
      if (request.url === "/app/installations/1/access_tokens")
        return json(response, installationToken());
      if (unhealthy) {
        response.writeHead(200, { "content-type": "application/json" });
        response.write('{"id":');
        response.once("close", () => {
          closed = !response.writableFinished;
        });
        return;
      }
      json(response, { id: 42 });
    });
    const installation = await requester(transport, 250)(1n);
    await expect(
      installation.request("GET /repos/acme/rocket"),
    ).rejects.toThrow();
    await vi.waitFor(() => expect(closed).toBe(true));
    unhealthy = false;
    await expect(
      installation.request("GET /repos/acme/rocket"),
    ).resolves.toMatchObject({ data: { id: 42 } });
  });

  it("reconciles an accepted POST with a stalled reply without a second comment", async () => {
    const marker = createReviewProgressMarker("http-fault");
    const head = "a".repeat(40);
    let comment: Record<string, unknown> | undefined;
    let posts = 0;
    const transport = await githubServer((request, response) => {
      const path = new URL(request.url!, "http://fixture").pathname;
      if (path === "/app") return json(response, { slug: "reviewrouter" });
      if (path === "/app/installations/1/access_tokens")
        return json(response, installationToken());
      if (path === "/repos/acme/rocket/pulls/42")
        return json(response, {
          number: 42,
          state: "open",
          head: { sha: head },
          base: { repo: { id: 91, full_name: "acme/rocket" } },
        });
      if (request.method === "POST") {
        posts += 1;
        let body = "";
        request.on("data", (data: Buffer) => {
          body += data.toString();
        });
        request.on("end", () => {
          comment = {
            id: 7,
            body: (JSON.parse(body) as { body: string }).body,
            user: { login: "reviewrouter[bot]" },
            issue_url: "https://api.github.com/repos/acme/rocket/issues/42",
          };
          response.writeHead(201, { "content-type": "application/json" });
          response.write('{"id":7');
        });
        return;
      }
      if (path === "/repos/acme/rocket/issues/comments/7")
        return json(response, comment);
      if (path === "/repos/acme/rocket/issues/42/comments")
        return json(response, comment ? [comment] : []);
      response.writeHead(404).end();
    });
    const installation = await requester(transport, 250)(1n);
    const gateway = new ReviewProgressGitHubGateway(installation.request);
    const input = {
      owner: "acme",
      repo: "rocket",
      pullNumber: 42,
      expectedHeadSha: head,
      expectedBotLogin: installation.botLogin,
      marker,
      body: "working",
    };
    await expect(gateway.upsert(input)).resolves.toMatchObject({
      commentId: 7,
      operation: "reconciled",
    });
    await expect(gateway.upsert(input)).resolves.toMatchObject({
      commentId: 7,
      operation: "unchanged",
    });
    expect(posts).toBe(1);
    expect(comment?.user).toEqual({ login: "reviewrouter[bot]" });
  });

  it("qualifies the pinned auth hook's existing fresh-token 401 retry", async () => {
    let mutations = 0;
    const transport = await githubServer((request, response) => {
      if (request.url === "/app")
        return json(response, { slug: "reviewrouter" });
      if (request.url === "/app/installations/1/access_tokens")
        return json(response, installationToken());
      mutations += 1;
      if (mutations === 1) {
        response.writeHead(401, { "content-type": "application/json" });
        response.end(JSON.stringify({ message: "fresh installation token" }));
        return;
      }
      json(response, { id: 9 });
    });
    const installation = await requester(transport, 4_000)(1n);
    await expect(
      installation.request("POST /repos/acme/rocket/issues/42/comments", {
        body: "working",
      }),
    ).resolves.toMatchObject({ data: { id: 9 } });
    // This retry already belongs to auth-app. The timeout wrapper adds none.
    expect(mutations).toBe(2);
  });
});

function requester(transport: typeof fetch, requestTimeoutMs: number) {
  return createProgressInstallationRequester({
    githubAppId: "1",
    githubPrivateKey: privateKey,
    fetch: transport,
    requestTimeoutMs,
  });
}

function installationToken() {
  return {
    token: "installation-fixture-token",
    expires_at: new Date(Date.now() + 3_600_000).toISOString(),
  };
}

function json(response: ServerResponse, value: unknown) {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}

async function githubServer(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<typeof fetch> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("fixture_address_missing");
  cleanups.push(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  );
  return (input, init) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    );
    return fetch(
      `http://127.0.0.1:${address.port}${url.pathname}${url.search}`,
      init,
    );
  };
}
