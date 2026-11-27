import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { registerGitHubWebhookRoutes } from "../interface/http/register-github-webhook-routes";
import { signGitHubWebhookPayload } from "../infrastructure/crypto/github-webhook-signature";

const secret = "webhook-signed-test-secret";
const leaked = "github_pat_privateSuperSecret123";

describe("signed GitHub webhook HTTP failure privacy", () => {
  it.each([
    "handler rejection",
    "commit rejection",
    "processing callback failure",
  ])("keeps %s errors opaque", async (scenario) => {
    const app = Fastify({ logger: false });
    const onProcessingError = vi.fn(() => {
      if (scenario === "processing callback failure")
        throw new Error(`observer failure: ${leaked}`);
    });
    const deliveries = {
      tryStartProcessing: vi.fn(async () => true),
      markProcessed: vi.fn(async () => {}),
      markFailed: vi.fn(async () => {}),
    };
    try {
      await registerGitHubWebhookRoutes(app, {
        webhookSecret: secret,
        onProcessingError,
        transactions: {
          async run(_eventName, work) {
            const result = await work({
              installations: {} as never,
              deliveries,
              appAuthorizations: {
                async handleGitHubAppAuthorizationWebhook() {
                  if (scenario !== "commit rejection")
                    throw new Error(`authorization rejected: ${leaked}`);
                  return { processed: true };
                },
              },
              clock: { now: () => new Date("2026-10-31T10:00:00.000Z") },
            });
            if (scenario === "commit rejection")
              throw new Error(`commit rejected: ${leaked}`);
            return result;
          },
        },
      });
      const payload = JSON.stringify({
        action: "revoked",
        sender: { id: 123, login: "private-actor" },
      });
      const response = await app.inject({
        method: "POST",
        url: "/webhooks/github",
        headers: {
          "x-github-event": "github_app_authorization",
          "x-github-delivery": "private-delivery-1",
          "x-hub-signature-256": signGitHubWebhookPayload(payload, secret),
          "content-type": "application/json",
        },
        payload,
      });
      expect(response.statusCode).toBe(500);
      expect(response.json()).toEqual({
        error: "github_webhook_processing_failed",
      });
      expect(response.body).not.toContain(leaked);
      expect(onProcessingError).toHaveBeenCalledExactlyOnceWith();
      expect(deliveries.markFailed).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});
