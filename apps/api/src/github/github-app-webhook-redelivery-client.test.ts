import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GitHubAppWebhookRedeliveryClient } from "./github-app-webhook-redelivery-client";

describe("GitHub App redelivery client with synthetic local server", () => {
  let scanMode = "normal";
  const requests: Array<{
    method?: string;
    url?: string;
    authorization?: string;
  }> = [];
  const server = createServer((req, res) => {
    requests.push({
      method: req.method,
      url: req.url,
      authorization: req.headers.authorization,
    });
    if (req.method === "GET") {
      if (req.url === "/app/hook/deliveries/42") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            id: 42,
            guid: "synthetic-guid",
            event: "push",
            action: null,
            installation_id: 123,
            status_code: scanMode === "success-detail" ? 200 : 500,
            request: {
              headers:
                scanMode === "redacted"
                  ? null
                  : scanMode === "duplicate"
                    ? {
                        "X-Hub-Signature-256": `sha256=${"a".repeat(64)}`,
                        "x-hub-signature-256": `sha256=${"b".repeat(64)}`,
                      }
                    : { "X-Hub-Signature-256": `sha256=${"a".repeat(64)}` },
              payload: { synthetic: "never-return-this" },
            },
          }),
        );
        return;
      }
      if (scanMode === "full-no-link") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify(
            Array.from({ length: 100 }, (_, id) => ({
              guid: `other-${id}`,
              redelivery: false,
            })),
          ),
        );
        return;
      }
      if (scanMode === "rate") {
        res.writeHead(429);
        res.end();
        return;
      }
      if (scanMode === "evil") {
        res.writeHead(200, {
          "content-type": "application/json",
          link: '<https://attacker.invalid/app/hook/deliveries?cursor=secret>; rel="next"',
        });
        res.end("[]");
        return;
      }
      if (scanMode === "two" && !req.url?.includes("cursor=")) {
        res.writeHead(200, {
          "content-type": "application/json",
          link: '<https://api.github.com/app/hook/deliveries?per_page=100&cursor=page2>; rel="next"',
        });
        res.end("[]");
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify([
          {
            id: 45,
            guid: "synthetic-guid",
            event: "push",
            action: null,
            redelivery: true,
            installation_id: 123,
            status_code: 200,
          },
        ]),
      );
      return;
    }
    if (req.url?.includes("/77/")) {
      req.socket.destroy();
      return;
    }
    if (req.url?.includes("/88/")) {
      res.writeHead(302, { location: "/followed" });
      res.end();
      return;
    }
    res.writeHead(202);
    res.end();
  });
  let origin = "";
  beforeAll(async () => {
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });
  const client = () =>
    GitHubAppWebhookRedeliveryClient.forSyntheticTest(
      "123",
      async () => "synthetic-jwt",
      async (resource, options) => {
        const url = new URL(String(resource));
        expect(url.origin).toBe("https://api.github.com");
        return fetch(`${origin}${url.pathname}${url.search}`, options);
      },
    );
  it("sends one App-authenticated POST to the exact scoped endpoint", async () => {
    const before = requests.length;
    expect(await client().redeliver(42n)).toEqual({ status: 202 });
    expect(requests.slice(before)).toEqual([
      {
        method: "POST",
        url: "/app/hook/deliveries/42/attempts",
        authorization: "Bearer synthetic-jwt",
      },
    ]);
  });
  it("does not follow redirects or retry a lost response", async () => {
    let before = requests.length;
    await expect(client().redeliver(88n)).rejects.toThrow();
    expect(requests.slice(before)).toHaveLength(1);
    expect(requests.at(-1)?.url).toBe("/app/hook/deliveries/88/attempts");
    before = requests.length;
    await expect(client().redeliver(77n)).rejects.toThrow();
    expect(requests.slice(before)).toHaveLength(1);
  });
  it("rejects invalid delivery IDs and invalid configured App before sending", async () => {
    const before = requests.length;
    await expect(client().redeliver(0n)).rejects.toThrow(
      "github_app_recovery_delivery_invalid",
    );
    expect(() =>
      GitHubAppWebhookRedeliveryClient.forSyntheticTest(
        "0",
        async () => "synthetic-jwt",
        fetch,
      ),
    ).toThrow();
    expect(requests).toHaveLength(before);
  });
  it("scans only bounded App delivery pages and reports remote observation, not completion", async () => {
    scanMode = "two";
    const c = client();
    const identity = {
      appIdentityHash: c.appIdentityHash,
      deliveryGuid: "synthetic-guid",
      githubDeliveryId: 42n,
      eventName: "push",
      action: null,
      installationId: 123n,
      payloadHash: "a".repeat(64),
    };
    const result = await c.scanAttempts(identity, 2);
    expect(result).toEqual({
      state: "observed",
      pages: 2,
      matchingAttempts: 1,
    });
    expect(requests.at(-1)?.url).toContain("cursor=page2");
  });
  it("fails closed on foreign pagination links, limits, and rate limits", async () => {
    const c = client();
    const identity = {
      appIdentityHash: c.appIdentityHash,
      deliveryGuid: "synthetic-guid",
      githubDeliveryId: 42n,
      eventName: "push",
      action: null,
      installationId: 123n,
      payloadHash: "a".repeat(64),
    };
    scanMode = "evil";
    const before = requests.length;
    expect((await c.scanAttempts(identity, 5)).state).toBe("incomplete");
    expect(requests.length - before).toBe(1);
    scanMode = "two";
    expect((await c.scanAttempts(identity, 1)).state).toBe("incomplete");
    scanMode = "full-no-link";
    expect((await c.scanAttempts(identity, 2)).state).toBe("incomplete");
    scanMode = "rate";
    expect((await c.scanAttempts(identity, 2)).state).toBe("rate_limited");
    await expect(
      c.scanAttempts({ ...identity, appIdentityHash: "e".repeat(64) }, 2),
    ).rejects.toThrow("github_app_recovery_scan_invalid");
  });

  it("checks exact original App delivery without exposing its payload", async () => {
    const c = client();
    const identity = {
      appIdentityHash: c.appIdentityHash,
      deliveryGuid: "synthetic-guid",
      githubDeliveryId: 42n,
      eventName: "push",
      action: null,
      installationId: 123n,
      payloadHash: "a".repeat(64),
    };
    expect(await c.verifyOriginalDelivery(identity)).toBe(true);
    expect(
      await c.verifyOriginalDelivery({ ...identity, deliveryGuid: "other" }),
    ).toBe(false);
    const before = requests.length;
    expect(
      await c.verifyOriginalDelivery({
        ...identity,
        appIdentityHash: "e".repeat(64),
      }),
    ).toBe(false);
    expect(requests.length).toBe(before);
  });
  it("extracts only a failed delivery signature digest and refuses missing or ambiguous headers", async () => {
    const c = client();
    scanMode = "normal";
    const evidence = await c.inspectUnreceivedDelivery(42n);
    expect(evidence).toMatchObject({
      appIdentityHash: c.appIdentityHash,
      deliveryGuid: "synthetic-guid",
      githubDeliveryId: 42n,
      signatureHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(
      JSON.stringify(evidence, (_key, value) =>
        typeof value === "bigint" ? String(value) : value,
      ),
    ).not.toContain("never-return-this");
    scanMode = "redacted";
    expect(await c.inspectUnreceivedDelivery(42n)).toBeNull();
    scanMode = "duplicate";
    expect(await c.inspectUnreceivedDelivery(42n)).toBeNull();
    scanMode = "success-detail";
    expect(await c.inspectUnreceivedDelivery(42n)).toBeNull();
  });
});
