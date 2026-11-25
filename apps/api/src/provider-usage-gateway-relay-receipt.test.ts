import { expect, it } from "vitest";
import { gatewayUsageCallId } from "./provider-usage-gateway-source";
import { gatewayUsageReceipt } from "./provider-usage-gateway-relay-receipt";
import type { UsageIdentity } from "@reviewrouter/features-provider-usage";
it("safe Gateway receipt carries exact persisted scope and hides native correlation identifiers", () => {
  const identity: UsageIdentity = {
    callId: gatewayUsageCallId("native-execution", "native-request"),
    workspaceId: "workspace",
    repositoryId: "123",
    actorId: "actor",
    runId: "456",
    runAttempt: 1,
    invocationId: "invocation",
    attemptId: "attempt",
    bindingId: "binding",
    authorizationId: "authorization",
    route: "gateway",
    purpose: "review",
    provider: "openai",
    requestedModel: "model",
    runtimeType: "codex",
    parentScope: null,
    granularity: "call",
    occurredAt: "2026-10-21T00:00:00Z",
  };
  const decoded = Buffer.from(
    gatewayUsageReceipt(identity),
    "base64url",
  ).toString();
  expect(JSON.parse(decoded)).toEqual({ schemaVersion: 1, identity });
  expect(decoded).not.toContain("native-execution");
  expect(decoded).not.toContain("native-request");
  expect(() =>
    gatewayUsageReceipt({
      ...identity,
      callId: "native-execution:native-request",
    }),
  ).toThrow("usage_receipt_invalid");
});
