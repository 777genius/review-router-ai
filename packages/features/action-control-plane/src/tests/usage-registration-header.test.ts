import { generateKeyPairSync } from "node:crypto";
import Fastify from "fastify";
import { expect, it, vi } from "vitest";
const calls = vi.hoisted(() => ({ exchange: vi.fn(), prelease: vi.fn() }));
vi.mock("../application/use-cases/exchange-github-oidc-token", () => ({
  exchangeGitHubOidcToken: calls.exchange,
}));
vi.mock("../application/use-cases/prelease-codex-rotating-oauth", () => ({
  preleaseCodexRotatingOAuth: calls.prelease,
  PreleaseVerifiedClaimsValidationError: class extends Error {},
}));
import { registerActionControlPlaneRoutes } from "../interface/http/register-action-control-plane-routes";
const publicKey = generateKeyPairSync("ed25519")
  .publicKey.export({ type: "spki", format: "pem" })
  .toString();
const encoded = Buffer.from(publicKey).toString("base64url");
const noncanonical = [
  ..."ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_",
]
  .map((last) => encoded.slice(0, -1) + last)
  .find(
    (value) =>
      value !== encoded &&
      Buffer.from(value, "base64url").equals(Buffer.from(publicKey)),
  )!;
const routes = [
  ["/api/action/v1/session/exchange", { oidcToken: "oidc" }, calls.exchange],
  [
    "/api/action/v1/codex-oauth/prelease",
    {
      oidcToken: "oidc",
      providerInstanceId: "codex-rotating:123",
      workflowSchemaVersion: 1,
    },
    calls.prelease,
  ],
] as const;
async function fixture() {
  calls.exchange.mockReset().mockResolvedValue({ protocolVersion: 1 });
  calls.prelease.mockReset().mockResolvedValue({ protocolVersion: 1 });
  const app = Fastify();
  await registerActionControlPlaneRoutes(app, {
    codexRotatingOAuth: {},
    codexRotatingWorkflowSourceVerifier: {},
    replayNonces: {},
  } as never);
  return app;
}
it.each(routes)(
  "%s accepts optional header without changing strict legacy body",
  async (url, payload, call) => {
    const app = await fixture();
    try {
      const result = await app.inject({
        method: "POST",
        url,
        payload,
        headers: { "x-reviewrouter-usage-public-key": encoded },
      });
      expect(result.statusCode).toBe(200);
      expect(call.mock.calls[0]?.[0]).toMatchObject({
        usagePublicKey: publicKey,
      });
      const legacy = await app.inject({ method: "POST", url, payload });
      expect(legacy.statusCode).toBe(200);
      expect(call.mock.calls[1]?.[0]).not.toHaveProperty("usagePublicKey");
      const same = await app.inject({
        method: "POST",
        url,
        payload: { ...payload, usagePublicKey: publicKey },
        headers: { "x-reviewrouter-usage-public-key": encoded },
      });
      expect(same.statusCode).toBe(200);
      const bodyOnly = await app.inject({
        method: "POST",
        url,
        payload: { ...payload, usagePublicKey: publicKey },
      });
      expect(bodyOnly.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  },
);
it.each(routes)(
  "%s rejects malformed, oversized and conflicting keys before admission",
  async (url, payload, call) => {
    const app = await fixture();
    try {
      for (const header of [
        encoded + "=",
        noncanonical,
        "a".repeat(2732),
        Buffer.from([255]).toString("base64url"),
        Buffer.from("x".repeat(100)).toString("base64url"),
      ]) {
        const result = await app.inject({
          method: "POST",
          url,
          payload,
          headers: { "x-reviewrouter-usage-public-key": header },
        });
        expect(result.statusCode).toBe(400);
      }
      const conflict = await app.inject({
        method: "POST",
        url,
        payload: { ...payload, usagePublicKey: publicKey + "\n" },
        headers: { "x-reviewrouter-usage-public-key": encoded },
      });
      expect(conflict.statusCode).toBe(400);
      const hidden = await app.inject({
        method: "POST",
        url,
        payload: { ...payload, arbitrary: true },
        headers: { "x-reviewrouter-usage-public-key": encoded },
      });
      expect(hidden.statusCode).toBe(400);
      expect(call).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  },
);
