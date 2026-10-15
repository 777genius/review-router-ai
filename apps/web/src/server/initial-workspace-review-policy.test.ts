import { describe, expect, it } from "vitest";
import { initialWorkspaceReviewPolicyDraft } from "./initial-workspace-review-policy";
import type { AccountsPage, AccountsResult } from "./account-gateway-accounts";

const page: AccountsResult<AccountsPage> = {
  status: "ok",
  value: {
    accounts: [
      {
        connectionId: "connection",
        label: "Account",
        profileId: "responses",
        profileLabel: "Profile",
        state: "active",
        gatewayRevision: 1,
        mirrorRevision: 1,
        binding: {
          id: "binding",
          revision: 1,
          state: "active",
          fencePending: false,
        },
      },
    ],
    profiles: [
      {
        id: "responses",
        label: "Profile",
        protocol: "openai-responses",
        models: ["mimo-v2.6-pro"],
      },
    ],
    nextCursor: null,
  },
};

describe("initial workspace policy draft", () => {
  it("requires an active unfenced binding with an available model", () => {
    expect(initialWorkspaceReviewPolicyDraft(undefined)).toBeNull();
    if (page.status !== "ok") throw new Error("fixture");
    for (const binding of [
      null,
      { ...page.value.accounts[0]!.binding!, fencePending: true },
    ]) {
      expect(
        initialWorkspaceReviewPolicyDraft({
          ...page,
          value: {
            ...page.value,
            accounts: [{ ...page.value.accounts[0]!, binding }],
          },
        }),
      ).toBeNull();
    }
    expect(
      initialWorkspaceReviewPolicyDraft({
        ...page,
        value: { ...page.value, profiles: [] },
      }),
    ).toBeNull();
  });
  it("builds a full current policy draft from the selected ready connection without changing catalog data", () => {
    const before = JSON.stringify(page);
    const draft = initialWorkspaceReviewPolicyDraft(page);
    expect(draft?.schemaVersion).toBe(3);
    expect(draft?.providers[0]).toMatchObject({
      gatewayBindingId: "binding",
      gatewayProfileRef: "responses",
      model: "mimo-v2.6-pro",
    });
    expect(draft?.limits.inlineMaxComments).toBe(50);
    expect(draft?.reviewLanguage).toBeNull();
    expect(JSON.stringify(page)).toBe(before);
  });
});
