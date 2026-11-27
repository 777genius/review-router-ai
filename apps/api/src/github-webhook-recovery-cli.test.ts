import { describe, expect, it } from "vitest";
import { parseWebhookRecoveryArguments } from "./github-webhook-recovery-cli.js";

describe("known webhook recovery CLI arguments", () => {
  it.each(["inspect", "request", "reconcile"] as const)("parses explicit %s with one exact delivery", (mode) => {
    expect(parseWebhookRecoveryArguments([
      mode, "--delivery-guid", "synthetic-guid", "--github-delivery-id", "42",
    ])).toEqual({ mode, deliveryGuid: "synthetic-guid", githubDeliveryId: 42n });
  });
  it.each([
    ["replay", "--delivery-guid", "synthetic", "--github-delivery-id", "42"],
    ["request", "--delivery-guid", "synthetic"],
    ["request", "--delivery-guid", "synthetic", "--github-delivery-id", "0"],
    ["request", "--delivery-guid", "synthetic", "--github-delivery-id", "9007199254740992"],
    ["request", "--delivery-guid", "synthetic", "--github-delivery-id", "42", "--delivery-guid", "other"],
    ["request", "--delivery-guid", "synthetic", "--github-delivery-id", "42", "--all", "true"],
    ["request", "--delivery-guid", "bad\nvalue", "--github-delivery-id", "42"],
    ["request", "--delivery-guid", "synthetic", "--github-delivery-id", "1e3"],
  ])("rejects ambiguous, unsupported or unbounded arguments: %j", (...argv) => {
    expect(() => parseWebhookRecoveryArguments(argv)).toThrow(/webhook_recovery_/u);
  });
});
