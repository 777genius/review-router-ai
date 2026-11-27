import { generateKeyPairSync } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { OctokitGitHubRepositorySource } from "../infrastructure/github/octokit-github-repository-source";

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

describe("installation inventory actual HTTP faults", () => {
  it.each(["token", "page_body"] as const)(
    "aborts stalled %s IO and recovers with a complete snapshot",
    async (fault) => {
      let unhealthy = true;
      let closed = false;
      const pages: number[] = [];
      const transport = await githubServer((request, response) => {
        if (request.url === "/app/installations/42/access_tokens") {
          if (fault === "token" && unhealthy) {
            response.once("close", () => {
              closed = !response.writableFinished;
            });
            return;
          }
          return json(response, {
            token: "fixture-token",
            expires_at: new Date(Date.now() + 3_600_000).toISOString(),
          });
        }
        const page = Number(
          new URL(request.url!, "http://fixture").searchParams.get("page"),
        );
        pages.push(page);
        if (fault === "page_body" && unhealthy && page === 2) {
          response.writeHead(200, { "content-type": "application/json" });
          response.write('{"repositories":[');
          response.once("close", () => {
            closed = !response.writableFinished;
          });
          return;
        }
        json(response, {
          repositories: Array.from(
            { length: page === 1 ? 100 : 1 },
            (_, index) => repository(page * 100 + index),
          ),
        });
      });
      const source = new OctokitGitHubRepositorySource({
        appId: 1,
        privateKey,
        fetch: transport,
        requestTimeoutMs: 250,
        inventoryTimeoutMs: 2_000,
      });
      await expect(source.listInstallationRepositories("42")).rejects.toThrow();
      await vi.waitFor(() => expect(closed).toBe(true));
      expect(pages).toEqual(fault === "token" ? [] : [1, 2]);
      unhealthy = false;
      const result = await source.listInstallationRepositories("42");
      expect(result).toHaveLength(101);
      expect(result[100]?.githubRepositoryId).toBe("200");
      expect(pages.slice(-2)).toEqual([1, 2]);
    },
  );
});

function repository(id: number) {
  return {
    id,
    name: `repo-${id}`,
    full_name: `acme/repo-${id}`,
    owner: { login: "acme" },
    default_branch: "main",
    private: false,
    archived: false,
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
