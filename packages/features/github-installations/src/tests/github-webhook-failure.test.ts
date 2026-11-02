import { describe, expect, it } from "vitest";
import { safeGitHubWebhookFailureSummary } from "../domain/github-webhook-failure";

describe("durable GitHub webhook failure privacy", () => {
  it.each([
    new Error("github_pat_secretExample12345"),
    new Error("request failed Authorization: Bearer ghp_privateExample12345"),
    new Error("postgresql://root:secret@localhost/db"),
    new Error("private customer@example.test repo payload: confidential"),
    new Error('{"token":"secret","workspace":"private-team"}'),
    { message: "secret", code: "PRIVATE_CODE" },
    "secret",
    null,
  ])("never persists untrusted error messages or payloads", (error) => {
    expect(safeGitHubWebhookFailureSummary(error)).toBe(
      "github_webhook_processing_failed",
    );
  });

  it.each([
    "installation_not_found_for_owner_grant",
    "installation_owner_grant_identity_ambiguous",
    "repository_identity_epoch_time_missing",
  ])("preserves reviewed internal diagnostic code %s", (code) => {
    expect(safeGitHubWebhookFailureSummary(new Error(code))).toBe(code);
  });

  it("does not trust a safe-looking prefix with attached arbitrary details", () => {
    const error = new Error(
      "installation_not_found_for_owner_grant: github_pat_secretExample12345",
    );
    expect(safeGitHubWebhookFailureSummary(error)).toBe(
      "github_webhook_processing_failed",
    );
  });
});
