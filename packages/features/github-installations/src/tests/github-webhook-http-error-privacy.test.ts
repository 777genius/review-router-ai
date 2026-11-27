import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { registerGitHubWebhookRoutes } from "../interface/http/register-github-webhook-routes";
import { signGitHubWebhookPayload } from "../infrastructure/crypto/github-webhook-signature";
import { PrismaWebhookDeliveryRepository } from "../infrastructure/prisma/prisma-webhook-delivery-repository";

const secret = "webhook-signed-test-secret";
const leaked = "github_pat_privateSuperSecret123";

describe("signed GitHub webhook HTTP failure privacy", () => {
  it("does not acknowledge a concurrent or abandoned processing delivery", async () => {
    const app = Fastify({ logger: false });
    const deliveries = new PrismaWebhookDeliveryRepository({
      gitHubWebhookDelivery: {
        create: vi.fn(async () => {
          throw { code: "P2002" };
        }),
        updateMany: vi.fn(async () => ({ count: 0 })),
        findFirst: vi.fn(async () => ({ status: "processing" })),
      },
    } as never);
    const handle = vi.fn(async () => ({ processed: true }));
    try {
      await registerGitHubWebhookRoutes(app, {
        webhookSecret: secret,
        installations: {} as never,
        deliveries,
        appAuthorizations: { handleGitHubAppAuthorizationWebhook: handle },
        clock: { now: () => new Date("2026-10-31T10:00:00.000Z") },
      });
      const payload = JSON.stringify({
        action: "revoked",
        sender: { id: 123, login: "actor" },
      });
      const response = await app.inject({
        method: "POST",
        url: "/webhooks/github",
        payload,
        headers: {
          "x-github-event": "github_app_authorization",
          "x-github-delivery": "delivery-1",
          "x-hub-signature-256": signGitHubWebhookPayload(payload, secret),
          "content-type": "application/json",
        },
      });
      expect(response.statusCode).toBe(500);
      expect(response.json()).toEqual({
        error: "github_webhook_processing_failed",
      });
      expect(handle).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
  it.each([
    {
      scenario: "handler rejection",
      rejectMarkFailed: false,
      rejectCallback: false,
    },
    {
      scenario: "delivery failure persistence rejection",
      rejectMarkFailed: true,
      rejectCallback: false,
    },
    {
      scenario: "processing callback failure",
      rejectMarkFailed: false,
      rejectCallback: true,
    },
  ])("keeps $scenario errors opaque", async (scenario) => {
    const { rejectMarkFailed, rejectCallback } = scenario;
    const app = Fastify({ logger: false });
    const onProcessingError = vi.fn(() => {
      if (rejectCallback) throw new Error(`observer failure: ${leaked}`);
    });
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
