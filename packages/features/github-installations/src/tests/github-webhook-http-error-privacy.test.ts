import { createHmac } from "node:crypto";
import Fastify from "fastify";
import { afterAll, describe, expect, it, vi } from "vitest";
import { registerGitHubWebhookRoutes } from "../interface/http/register-github-webhook-routes";

const secret = "webhook-signed-test-secret";
const leaked = "github_pat_privateSuperSecret123";

describe("signed GitHub webhook HTTP failure privacy", () => {
  const app = Fastify({ logger: false });
  const deliveries = {
    tryStartProcessing: vi.fn(async () => true),
    markProcessed: vi.fn(async () => {}),
    markFailed: vi.fn(async () => {}),
  };

  afterAll(async () => {
    await app.close();
  });

  it("records an opaque failure and does not echo private handler messages", async () => {
    await registerGitHubWebhookRoutes(app, {
      webhookSecret: secret,
      installations: {} as never,
      deliveries,
      appAuthorizations: {
        async handleGitHubAppAuthorizationWebhook() {
          throw new Error(`authorization rejected: ${leaked}`);
        },
      },
      clock: { now: () => new Date("2026-10-31T10:00:00.000Z") },
    });
    const payload = JSON.stringify({
      action: "revoked",
      sender: { id: 123, login: "private-actor" },
    });
    const signature = `sha256=${createHmac("sha256", secret)
      .update(payload)
      .digest("hex")}`;

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      headers: {
        "x-github-event": "github_app_authorization",
        "x-github-delivery": "private-delivery-1",
        "x-hub-signature-256": signature,
        "content-type": "application/json",
      },
      payload,
    });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      error: "github_webhook_processing_failed",
    });
    expect(response.body).not.toContain(leaked);
    expect(deliveries.markFailed).toHaveBeenCalledExactlyOnceWith({
      deliveryId: "private-delivery-1",
      errorSummary: "github_webhook_processing_failed",
    });
  });
});
