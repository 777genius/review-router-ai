import type { WorkspaceProviderProfile } from "@reviewrouter/features-review-config";
import { describe, expect, it, vi } from "vitest";
import {
  savedProfileBindingIds,
  savedProviderProfileFacts,
} from "./saved-provider-profiles";

vi.mock("./account-gateway-accounts", () => ({
  accountGatewayProfilesConfiguration: () => ({ apiKeyProfiles: new Map() }),
}));

const at = new Date("2026-11-18T00:00:00Z");
const profile = (
  id: string,
  credential: WorkspaceProviderProfile["credential"],
): WorkspaceProviderProfile => ({
  id,
  workspaceId: "w1",
  createdByUserId: "u1",
  credential,
  model: "m",
  label: id,
  archivedAt: null,
  createdAt: at,
  updatedAt: at,
});

const personal = profile("personal", {
  kind: "gateway_binding",
  authMode: "codex_account_gateway",
  bindingId: "b-personal",
  gatewayProfileRef: "openai-codex-oauth-responses-v1",
});
const shared = profile("shared", {
  kind: "gateway_binding",
  authMode: "codex_account_gateway",
  bindingId: "b-shared",
  gatewayProfileRef: "openai-codex-oauth-responses-v1",
});
const rotating = profile("rotating", {
  kind: "repository_rotating",
  authMode: "codex_subscription_oauth_rotating",
  repositoryId: "r1",
});
const managed = profile("managed", {
  kind: "managed_api_key",
  authMode: "openrouter_api_key",
  apiKeyConnectionId: "k1",
});

// Personal binding drives the management hints of both provider screens.
describe("saved provider rows", () => {
  it("marks only the viewer's own Gateway binding as personal", () => {
    const personalIds = new Set(["b-personal"]);
    const rows = [personal, shared, rotating, managed].map((row) =>
      savedProviderProfileFacts(row, personalIds),
    );
    expect(
      rows.map((row) => [
        row.id,
        row.providerId,
        row.credentialKind,
        row.gatewayBindingId,
        row.gatewayProfileRef,
        row.personalBinding,
        row.rotatingRepositoryId,
      ]),
    ).toEqual([
      [
        "personal",
        "openai",
        "gateway_binding",
        "b-personal",
        "openai-codex-oauth-responses-v1",
        true,
        null,
      ],
      [
        "shared",
        "openai",
        "gateway_binding",
        "b-shared",
        "openai-codex-oauth-responses-v1",
        false,
        null,
      ],
      ["rotating", "openai", "repository_rotating", null, null, false, "r1"],
      ["managed", "openrouter", "managed_api_key", null, null, false, null],
    ]);
  });

  it("reads binding facts only for Gateway providers", () => {
    expect(
      savedProfileBindingIds([personal, rotating, shared, managed]),
    ).toEqual(["b-personal", "b-shared"]);
  });
});
