import { createHmac } from "node:crypto";
import Fastify from "fastify";
import rawBody from "fastify-raw-body";
import { describe, expect, it } from "vitest";
import { createGitHubAppWebhookVerifier } from "../infrastructure/crypto/github-app-webhook-verifier";
import { verifyGitHubAppWebhookRequest } from "../interface/http/verify-github-app-webhook-request";

describe("experimental signed GitHub App HTTP boundary", () => {
  it("uses the verified raw body and trusted app config, not request identity headers", async () => {
    const app = Fastify();
    const secret = "synthetic-secret";
    const verify = createGitHubAppWebhookVerifier({
      appId: "123",
      apiBaseUrl: "https://api.github.com",
      webhookSecret: secret,
    });
    await app.register(rawBody, {
      field: "rawBody",
      global: false,
      encoding: false,
      runFirst: true,
      routes: ["/synthetic"],
    });
    app.post("/synthetic", async (request, reply) => {
      const context = verifyGitHubAppWebhookRequest(request, verify);
      return context
        ? {
            appIdentityHash: context.appIdentityHash,
            payloadHash: context.payloadHash,
          }
        : reply.code(401).send({ error: "invalid_signature" });
    });
    try {
      const payload = '{"action":"opened"}';
      const signature = `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`;
      const request = (extra: Record<string, string>, body = payload) =>
        app.inject({
          method: "POST",
          url: "/synthetic",
          headers: {
            "content-type": "application/json",
            "x-hub-signature-256": signature,
            ...extra,
          },
          payload: body,
        });
      const first = await request({ "x-github-app-id": "123" });
      const spoof = await request({ "x-github-app-id": "999" });
      expect(first.statusCode).toBe(200);
      expect(spoof.statusCode).toBe(200);
      expect(first.json()).toEqual(spoof.json());
      expect((await request({}, '{"action":"closed"}')).statusCode).toBe(401);
      expect(
        (await request({ "x-hub-signature-256": "sha256=bad" })).statusCode,
      ).toBe(401);
    } finally {
      await app.close();
    }
  });
});
