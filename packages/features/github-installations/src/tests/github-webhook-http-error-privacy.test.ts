import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { registerGitHubWebhookRoutes } from "../interface/http/register-github-webhook-routes";
import { signGitHubWebhookPayload } from "../infrastructure/crypto/github-webhook-signature";

const secret = "webhook-signed-test-secret";
const leaked = "github_pat_privateSuperSecret123";

describe("signed GitHub webhook HTTP failure privacy", () => {
  it.each([
    { scenario: "handler rejection", rejectMarkFailed: false },
    {
      scenario: "delivery failure persistence rejection",
      rejectMarkFailed: true,
    },
  ])("keeps $scenario errors opaque", async ({ rejectMarkFailed }) => {
    const app = Fastify({ logger: false });
    const onProcessingError = vi.fn();
    const deliveries = {
      tryStartProcessing: vi.fn(async () => true),
      markProcessed: vi.fn(async () => {}),
      markFailed: vi.fn(async () => {}),
    };
    if (rejectMarkFailed) {
      deliveries.markFailed.mockRejectedValueOnce(
        new Error(`storage rejected: ${leaked}`),
      );
    }

    try {
      await registerGitHubWebhookRoutes(app, {
        webhookSecret: secret,
        installations: {} as never,
        deliveries,
        onProcessingError,
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
      const signature = signGitHubWebhookPayload(payload, secret);

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
      expect(onProcessingError).toHaveBeenCalledExactlyOnceWith();
      expect(deliveries.markFailed).toHaveBeenCalledExactlyOnceWith({
        deliveryId: "private-delivery-1",
        errorSummary: "github_webhook_processing_failed",
      });
    } finally {
      await app.close();
    }
  });
});
