import { createServer } from "node:http";
import { once } from "node:events";
import { afterEach, expect, it } from "vitest";
import { GatewayError } from "@agent-teams/account-gateway/http";
import {
  gatewayProbeId,
  gatewayProbeLimits,
} from "@reviewrouter/features-provider-accounts/gateway-probe";
import { gatewayProbeAccessClient } from "./gateway-probe-access-client";
import { AccountDiagnosisError } from "../features/account-gateway/account-diagnosis";
const stops: (() => void)[] = [];
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
});
it.each([
  "matching",
  "foreign",
  "malformed",
  "denied",
  "opaque",
  "success_malformed",
] as const)(
  "keeps the private %s response bounded and origin-safe",
  async (mode) => {
    const input = {
      userId: "fixture-user",
      workspaceId: "fixture-workspace",
      bindingId: "fixture-binding",
      model: "fixture-model",
      nonce: "3900013a-6276-4606-9a46-ce40b595242c",
    };
    const operationId = gatewayProbeId("prepare", input.bindingId, input.nonce);
    let calls = 0;
    const server = createServer((req, res) => {
      calls++;
      req.resume();
      res.setHeader("content-type", "application/json");
      res.statusCode =
        mode === "denied" ? 403 : mode === "success_malformed" ? 200 : 503;
      res.end(
        JSON.stringify(
          mode === "denied"
            ? { error: "denied" }
            : mode === "success_malformed"
              ? { bearer: "private-secret", operation: {} }
              : mode === "opaque"
              ? { error: "private-secret", claimedProviderStatus: 429 }
              : {
                  code: "admission_limited",
                  traceRef: "fixture",
                  operationRef:
                    mode === "foreign" ? "foreign-operation" : operationId,
                  effect: "not_dispatched",
                  retry: { kind: "after", milliseconds: 1000 },
                  ...(mode === "malformed"
                    ? { rawProviderError: "private-secret" }
                    : {}),
                },
        ),
      );
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    stops.push(() => {
      server.closeAllConnections();
      server.close();
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("fixture");
    const client = gatewayProbeAccessClient(
      {
        origin: `http://127.0.0.1:${address.port}`,
        secret: "fixture-purpose-secret-123456",
      },
      input,
    );
    const intent = {
      operationId,
      invocationRef: "invocation",
      attemptRef: "attempt",
      accountRefs: ["account"],
      subjectRef: "subject",
      policyRevision: 1,
      bindingRevision: 1,
      profileId: "profile",
      limits: gatewayProbeLimits,
      deadline: new Date(Date.now() + 60000).toISOString(),
    };
    await expect(client.runAccess(intent)).rejects.toSatisfy(
      (error: unknown) => {
        if (mode === "denied")
          return (
            error instanceof AccountDiagnosisError &&
            error.diagnosis.code === "access_denied"
          );
        return (
          error instanceof GatewayError &&
          error.code ===
            (mode === "matching" ? "safe_error" : "invalid_response") &&
          error.effect ===
            (mode === "matching" ? "not_dispatched" : "effect_unknown") &&
          (mode !== "matching" ||
            (error.httpStatus === 503 &&
              error.diagnostic?.operationRef === operationId)) &&
          !JSON.stringify(error).includes("private-secret")
        );
      },
    );
    expect(calls).toBe(1);
  },
);
