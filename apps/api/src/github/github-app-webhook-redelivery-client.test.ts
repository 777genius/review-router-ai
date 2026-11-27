import { createHash } from "node:crypto";
import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { GitHubAppWebhookRedeliveryClient } from "./github-app-webhook-redelivery-client";

describe("GitHub App redelivery client with synthetic local server", () => {
  let scanMode = "normal";
  let nextLink: string | undefined;
  const requests: Array<{
    method: string | undefined;
    url: string | undefined;
    authorization: string | undefined;
  }> = [];
  const attemptedUrls: string[] = [];
  let unusedBody:
    | { response: ServerResponse; closed: Promise<void> }
    | undefined;
  const server = createServer((req, res) => {
    requests.push({
      method: req.method,
      url: req.url,
      authorization: req.headers.authorization,
    });
    if (scanMode.startsWith("unused-body-")) {
      const closed = new Promise<void>((resolve) => {
        res.once("close", resolve);
      });
      unusedBody = { response: res, closed };
      const status =
        scanMode === "unused-body-accepted" || scanMode === "unused-body-broken"
          ? 202
          : scanMode === "unused-body-rate"
            ? 429
            : 503;
      res.writeHead(status, { "content-type": "text/plain" });
      res.write("unused response body");
      return;
    }
    if (req.method === "GET") {
      if (scanMode === "pending-page") {
        const closed = new Promise<void>((resolve) => {
          res.once("close", resolve);
        });
        unusedBody = { response: res, closed };
        res.writeHead(200, {
          "content-type": "application/json",
          link: "<https://api.github.com/app/hook/deliveries?cursor=page2>; rel=next",
        });
        res.flushHeaders();
        return;
      }
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
      if (scanMode === "full-no-link" || scanMode === "full-no-link-match") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify(
            Array.from({ length: 100 }, (_, id) =>
              scanMode === "full-no-link-match" && id === 99
                ? {
                    id: 45,
                    guid: "synthetic-guid",
                    event: "push",
                    action: null,
                    redelivery: true,
                    installation_id: 123,
                    status_code: 200,
                  }
                : { guid: `other-${id}`, redelivery: false },
            ),
          ),
        );
        return;
      }
      if (
        scanMode === "rate" ||
        scanMode === "primary-rate" ||
        scanMode === "secondary-rate" ||
        scanMode === "forbidden"
      ) {
        res.writeHead(scanMode === "rate" ? 429 : 403, {
          "x-ratelimit-remaining": scanMode === "primary-rate" ? "0" : "100",
          ...(scanMode === "secondary-rate" ? { "retry-after": "60" } : {}),
        });
        res.end();
        return;
      }
      if (scanMode === "evil" || scanMode === "evil-unquoted") {
        res.writeHead(200, {
          "content-type": "application/json",
          link: `<https://attacker.invalid/app/hook/deliveries?cursor=secret>; rel=${scanMode === "evil" ? '"next"' : "next"}`,
        });
        res.end("[]");
        return;
      }
      if (
        (scanMode === "two" ||
          scanMode === "two-unquoted" ||
          nextLink !== undefined) &&
        !req.url?.includes("cursor=")
      ) {
        res.writeHead(200, {
          "content-type": "application/json",
          link:
            nextLink ??
            `<https://api.github.com/app/hook/deliveries?per_page=100&cursor=page2>; rel=${scanMode === "two" ? '"next"' : "next"}`,
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
  afterEach(() => {
    unusedBody?.response.destroy();
    unusedBody = undefined;
    scanMode = "normal";
    nextLink = undefined;
  });
  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });
  const sendToLocal: typeof fetch = async (resource, options) => {
    // Record attempts before assertions: the client catches transport failures.
    attemptedUrls.push(String(resource));
    const url = new URL(String(resource));
    expect(url.origin).toBe("https://api.github.com");
    return fetch(`${origin}${url.pathname}${url.search}`, options);
  };
  const client = () =>
    GitHubAppWebhookRedeliveryClient.forSyntheticTest(
      "123",
      async () => "synthetic-jwt",
      sendToLocal,
    );
  function identityFor(c: GitHubAppWebhookRedeliveryClient) {
    return {
      appIdentityHash: c.appIdentityHash,
      deliveryGuid: "synthetic-guid",
      githubDeliveryId: 42n,
      eventName: "push",
      action: null,
      installationId: 123n,
      payloadHash: "a".repeat(64),
    };
  }
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
  it.each(["two", "two-unquoted"])(
    "follows the next link from an empty page in %s mode",
    async (mode) => {
      scanMode = mode;
      const c = client();
      const identity = identityFor(c);
      const result = await c.scanAttempts(identity, 2);
      expect(result).toEqual({
        state: "observed",
        pages: 2,
        matchingAttempts: 1,
      });
      expect(requests.at(-1)?.url).toContain("cursor=page2");
    },
  );
  it("rejects an unquoted next link to a foreign origin", async () => {
    scanMode = "evil-unquoted";
    const c = client();
    const before = attemptedUrls.length;
    expect((await c.scanAttempts(identityFor(c), 5)).state).toBe("incomplete");
    expect(attemptedUrls.slice(before)).toEqual([
      "https://api.github.com/app/hook/deliveries?per_page=100",
    ]);
  });

  it.each([
    '<https://api.github.com/app/hook/deliveries?cursor=page2>; type="application/json"; rel="next"',
    '<https://api.github.com/app/hook/deliveries?cursor=page2>; type="application/json"; rel=next',
    '<https://api.github.com/app/hook/deliveries?cursor=page2>; title="a,b; rel=prev"; rel="last next"',
    '<https://api.github.com/app/hook/deliveries?cursor=page0>; rel="prev", <https://api.github.com/app/hook/deliveries?cursor=page2>; type="application/json"; rel="next"',
    '<https://api.github.com/app/hook/deliveries?cursor=page2>; rel=next,',
    ', , <https://api.github.com/app/hook/deliveries?cursor=page0>; rel=prev, , , <https://api.github.com/app/hook/deliveries?cursor=page2>; rel=next,',
    `${",".repeat(32)}<https://api.github.com/app/hook/deliveries?cursor=page2>; rel=next`,
    `<https://api.github.com/app/hook/deliveries?cursor=page2>; rel=next${",".repeat(32)}`,
  ])("follows reordered relation parameters and lists: %s", async (link) => {
    nextLink = link;
    const c = client();
    const before = attemptedUrls.length;
    expect(await c.scanAttempts(identityFor(c), 2)).toEqual({
      state: "observed",
      pages: 2,
      matchingAttempts: 1,
    });
    expect(attemptedUrls.slice(before)).toEqual([
      "https://api.github.com/app/hook/deliveries?per_page=100",
      "https://api.github.com/app/hook/deliveries?per_page=100&cursor=page2",
    ]);
  });

  it.each([
    '<https://api.github.com/app/hook/deliveries?cursor=page2>; title="x; rel=next',
    '<https://attacker.invalid/app/hook/deliveries?cursor=page2>; type="application/json"; rel="next"',
    '<https://api.github.com/app/hook/deliveries?cursor=page2>; rel="next"; anchor="https://attacker.invalid"',
    '<https://api.github.com/app/hook/deliveries?cursor=page2>; rel="next", <https://api.github.com/app/hook/deliveries?cursor=page3>; rel="next"',
    `${",".repeat(33)}<https://api.github.com/app/hook/deliveries?cursor=page2>; rel=next`,
    `${",".repeat(32)}<https://api.github.com/app/hook/deliveries?cursor=page2>; rel=next,`,
    '<https://api.github.com/app/hook/deliveries?cursor=page2>; rel=next, , invalid',
    '<https://api.github.com/app/hook/deliveries?cursor=page2>; rel=next, , <https://api.github.com/app/hook/deliveries?cursor=page3>; rel=next',
  ])("rejects unsafe or ambiguous reordered pagination: %s", async (link) => {
    nextLink = link;
    const c = client();
    const before = attemptedUrls.length;
    expect((await c.scanAttempts(identityFor(c), 5)).state).toBe("incomplete");
    expect(attemptedUrls.slice(before)).toHaveLength(1);
  });

  it("does not treat quoted metadata as a next relation", async () => {
    nextLink =
      '<https://api.github.com/app/hook/deliveries?cursor=page2>; title="a,b; rel=next"; rel="prev"';
    const c = client();
    const before = attemptedUrls.length;
    expect(await c.scanAttempts(identityFor(c), 5)).toEqual({
      state: "not_observed",
      pages: 1,
      matchingAttempts: 0,
    });
    expect(attemptedUrls.slice(before)).toHaveLength(1);
  });

  it.each(["before_scan", "during_auth"] as const)(
    "does not send a page when cancelled %s",
    async (phase) => {
      const controller = new AbortController();
      if (phase === "before_scan") controller.abort();
      const c = GitHubAppWebhookRedeliveryClient.forSyntheticTest(
        "123",
        async () => {
          controller.abort();
          return "synthetic-jwt";
        },
        sendToLocal,
      );
      const before = attemptedUrls.length;
      expect(
        await c.scanAttempts(identityFor(c), 5, controller.signal),
      ).toEqual({
        state: "incomplete",
        pages: 0,
        matchingAttempts: 0,
      });
      expect(attemptedUrls).toHaveLength(before);
    },
  );

  it("cancels an in-flight page body without requesting the next cursor", async () => {
    scanMode = "pending-page";
    const controller = new AbortController();
    let responseBody: Response["body"] = null;
    const c = GitHubAppWebhookRedeliveryClient.forSyntheticTest(
      "123",
      async () => "synthetic-jwt",
      async (resource, options) => {
        const response = await sendToLocal(resource, options);
        responseBody = response.body;
        return response;
      },
    );
    const before = attemptedUrls.length;
    const scan = c.scanAttempts(identityFor(c), 5, controller.signal);
    const settled = scan.then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error("scan_cancel_deadline")),
        2_000,
      );
    });
    try {
      // The server sends no body bytes and keeps the response open. Once the
      // real stream is locked, readBoundedText has reached its pending read.
      await Promise.race([
        expect.poll(() => responseBody?.locked, { timeout: 2_000 }).toBe(true),
        deadline,
      ]);
      controller.abort();
      expect(await Promise.race([settled, deadline])).toEqual({
        value: { state: "incomplete", pages: 0, matchingAttempts: 0 },
      });
      if (!unusedBody) throw new Error("pending_page_not_received");
      await Promise.race([unusedBody.closed, deadline]);
      expect(attemptedUrls.slice(before)).toHaveLength(1);
    } finally {
      controller.abort();
      unusedBody?.response.destroy();
      await settled;
      if (timer) clearTimeout(timer);
    }
  });
  it("fails closed on foreign pagination links, limits, and rate limits", async () => {
    const c = client();
    const identity = identityFor(c);
    scanMode = "evil";
    const before = requests.length;
    const beforeTransport = attemptedUrls.length;
    expect((await c.scanAttempts(identity, 5)).state).toBe("incomplete");
    expect(requests.length - before).toBe(1);
    expect(attemptedUrls.slice(beforeTransport)).toEqual([
      "https://api.github.com/app/hook/deliveries?per_page=100",
    ]);
    scanMode = "two";
    expect((await c.scanAttempts(identity, 1)).state).toBe("incomplete");
    scanMode = "rate";
    expect((await c.scanAttempts(identity, 2)).state).toBe("rate_limited");
    await expect(
      c.scanAttempts({ ...identity, appIdentityHash: "e".repeat(64) }, 2),
    ).rejects.toThrow("github_app_recovery_scan_invalid");
  });

  it.each([
    ["full-no-link", "not_observed", 0],
    ["full-no-link-match", "observed", 1],
  ] as const)(
    "finishes a full final page without a next link in %s mode",
    async (mode, state, matchingAttempts) => {
      scanMode = mode;
      const c = client();
      const before = attemptedUrls.length;
      expect(await c.scanAttempts(identityFor(c), 2)).toEqual({
        state,
        pages: 1,
        matchingAttempts,
      });
      expect(attemptedUrls.slice(before)).toHaveLength(1);
    },
  );

  it.each([
    ["primary-rate", "rate_limited"],
    ["secondary-rate", "rate_limited"],
    ["forbidden", "incomplete"],
  ] as const)(
    "classifies a 403 %s response without retrying",
    async (mode, state) => {
      scanMode = mode;
      const c = client();
      const before = attemptedUrls.length;
      expect(await c.scanAttempts(identityFor(c), 2)).toEqual({
        state,
        pages: 0,
        matchingAttempts: 0,
      });
      expect(attemptedUrls.slice(before)).toHaveLength(1);
    },
  );

  it.each([
    ["accepted", "post", 202],
    ["rejected", "post", 503],
    ["rejected", "detail", 503],
    ["rejected", "scan", 503],
    ["rate", "scan", 429],
  ] as const)(
    "cancels the unused %s %s response body",
    async (mode, operation, status) => {
      scanMode = `unused-body-${mode}`;
      const c = client();
      if (operation === "post") {
        expect(await c.redeliver(42n)).toEqual({ status });
      } else if (operation === "detail") {
        expect(
          await c.verifyOriginalDelivery(identityFor(c), "a".repeat(64)),
        ).toBe(false);
      } else {
        expect(await c.scanAttempts(identityFor(c), 2)).toEqual({
          state: mode === "rate" ? "rate_limited" : "incomplete",
          pages: 0,
          matchingAttempts: 0,
        });
      }
      const pending = unusedBody;
      if (!pending) throw new Error("unused_response_not_received");
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          pending.closed,
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error("unused_response_not_cancelled")),
              2000,
            );
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
  );

  it("preserves the received status when cancellation encounters a broken body", async () => {
    scanMode = "unused-body-broken";
    let bodyFailed = false;
    const c = GitHubAppWebhookRedeliveryClient.forSyntheticTest(
      "123",
      async () => "synthetic-jwt",
      async (resource, options) => {
        const response = await sendToLocal(resource, options);
        if (!response.body || !unusedBody)
          throw new Error("unused_response_not_received");
        const reader = response.body.getReader();
        unusedBody.response.destroy();
        try {
          await reader.closed;
        } catch {
          bodyFailed = true;
        } finally {
          reader.releaseLock();
        }
        return response;
      },
    );
    expect(await c.redeliver(42n)).toEqual({ status: 202 });
    expect(bodyFailed).toBe(true);
  });

  it("checks exact original App delivery without exposing its payload", async () => {
    const c = client();
    const identity = identityFor(c);
    scanMode = "normal";
    const signatureHash = createHash("sha256")
      .update(`sha256=${"a".repeat(64)}`)
      .digest("hex");
    expect(await c.verifyOriginalDelivery(identity, signatureHash)).toBe(true);
    expect(await c.verifyOriginalDelivery(identity, "e".repeat(64))).toBe(
      false,
    );
    expect(
      await c.verifyOriginalDelivery(
        { ...identity, deliveryGuid: "other" },
        signatureHash,
      ),
    ).toBe(false);
    const before = requests.length;
    expect(
      await c.verifyOriginalDelivery(
        {
          ...identity,
          appIdentityHash: "e".repeat(64),
        },
        signatureHash,
      ),
    ).toBe(false);
    expect(requests.length).toBe(before);
    scanMode = "redacted";
    expect(await c.verifyOriginalDelivery(identity, signatureHash)).toBe(false);
    scanMode = "duplicate";
    expect(await c.verifyOriginalDelivery(identity, signatureHash)).toBe(false);
  });
});
