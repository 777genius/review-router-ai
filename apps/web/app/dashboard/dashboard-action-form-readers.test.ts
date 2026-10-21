import { repositoryPolicyFormFields } from "./review-policy-form-contract";
import { describe, expect, it } from "vitest";
import {
  readProviderSetupSelection,
  readReviewConfigurationForm,
  readRepositoryReviewPolicyForm,
  readReviewPolicyExpectedVersion,
  readReviewDiscussionMode,
} from "./dashboard-action-form-readers";

describe("dashboard action form readers", () => {
  it("does not validate unused provider drafts when saving sparse inherited providers", () => {
    const form = new FormData();
    for (const field of repositoryPolicyFormFields)
      form.set(`policyMode.${field.join(".")}`, "inherit");
    form.set("policyMode.limits.inlineMaxComments", "override");
    form.set("inlineMaxComments", "0");
    form.set(
      "policyMode.investigationRollout.productionEffectsEnabled",
      "override",
    );
    form.set("investigationRollout.productionEffectsEnabled", "false");
    form.set("providerCount", "1");
    form.set("providerAuthMode.0", "invalid-unused-provider");
    expect(readRepositoryReviewPolicyForm(form)).toEqual({
      schemaVersion: 3,
      limits: { inlineMaxComments: 0 },
      investigationRollout: { productionEffectsEnabled: false },
    });
    form.set("policyMode.providers", "override");
    expect(() => readRepositoryReviewPolicyForm(form)).toThrow(
      "invalid_form_value:providerAuthMode.0",
    );
  });

  it("preserves optional context selection and an explicit repository off override", () => {
    const form = new FormData();
    for (const field of repositoryPolicyFormFields)
      form.set(`policyMode.${field.join(".")}`, "inherit");
    form.set("policyMode.contextTools", "override");
    expect(readRepositoryReviewPolicyForm(form)).toEqual({ schemaVersion: 3, contextTools: { version: 1, builtinTools: [], mcp: [] } });
    const selection = { version: 1, builtinTools: ["github.issue.read"], mcp: [{ connection: "docs", tools: ["search_docs"] }] };
    form.set("contextTools", JSON.stringify(selection));
    expect(readRepositoryReviewPolicyForm(form).contextTools).toEqual(selection);
    form.set("contextTools", JSON.stringify({ ...selection, rawSecret: "must-not-echo" }));
    expect(() => readRepositoryReviewPolicyForm(form)).toThrow("context_connection_invalid");
  });

  it("requires an explicit CAS version or create-only intent", () => {
    const form = new FormData();
    expect(() => readReviewPolicyExpectedVersion(form)).toThrow();
    form.set("policyExpectedVersion", "none");
    expect(readReviewPolicyExpectedVersion(form)).toBeNull();
    form.set("policyExpectedVersion", "7");
    expect(readReviewPolicyExpectedVersion(form)).toBe(7);
    for (const value of ["0", "-1", "1.5", "9007199254740992"]) {
      form.set("policyExpectedVersion", value);
      expect(() => readReviewPolicyExpectedVersion(form)).toThrow();
    }
  });

  it("resets all repository fields by removing overrides", () => {
    const form = new FormData();
    for (const field of repositoryPolicyFormFields)
      form.set(`policyMode.${field.join(".")}`, "inherit");
    expect(readRepositoryReviewPolicyForm(form)).toEqual({ schemaVersion: 3 });
  });
  it("keeps explicit zero, false and null without copying inherited values", () => {
    const form = reviewConfigFormData([
      {
        authMode: "codex_subscription_oauth_rotating",
        model: "gpt-5.5",
        reasoningEffort: "high",
      },
    ]);
    for (const field of repositoryPolicyFormFields)
      form.set(`policyMode.${field.join(".")}`, "inherit");
    for (const field of [
      "limits.inlineMaxComments",
      "investigationRollout.recordingEnabled",
      "reviewLanguage",
    ])
      form.set(`policyMode.${field}`, "override");
    form.set("inlineMaxComments", "0");
    form.set("investigationRollout.recordingEnabled", "false");
    form.set("reviewLanguage", "");
    expect(readRepositoryReviewPolicyForm(form)).toEqual({
      schemaVersion: 3,
      limits: { inlineMaxComments: 0 },
      investigationRollout: { recordingEnabled: false },
      reviewLanguage: null,
    });
  });
  it("refuses missing inheritance intent rather than guessing from values", () => {
    expect(() => readRepositoryReviewPolicyForm(new FormData())).toThrow();
  });

  it("preserves explicit gateway binding and profile references in policy submissions", () => {
    const formData = reviewConfigFormData([
      {
        authMode: "codex_account_gateway",
        model: "mimo-v2-pro",
        reasoningEffort: "xhigh",
      },
    ]);
    formData.set("providerGatewayBindingId.0", "binding-mimo");
    formData.set("providerGatewayProfileRef.0", "profile-mimo");
    expect(readReviewConfigurationForm(formData).providers[0]).toMatchObject({
      kind: "codex",
      authMode: "codex_account_gateway",
      model: "mimo-v2-pro",
      gatewayBindingId: "binding-mimo",
      gatewayProfileRef: "profile-mimo",
    });
    formData.delete("providerGatewayBindingId.0");
    expect(() => readReviewConfigurationForm(formData)).toThrow();
  });

  it("never materializes an agentProfileRef key without an explicit engine selection", () => {
    const formData = reviewConfigFormData([
      {
        authMode: "codex_account_gateway",
        model: "mimo-v2-pro",
        reasoningEffort: "xhigh",
      },
    ]);
    formData.set("providerGatewayBindingId.0", "binding-mimo");
    formData.set("providerGatewayProfileRef.0", "profile-mimo");
    // readOptionalFormString omits the key entirely when absent or blank so
    // legacy provider rows keep their canonical JSON byte-identical.
    for (const submitted of [undefined, "   "]) {
      if (submitted !== undefined)
        formData.set("providerAgentProfileRef.0", submitted);
      const provider = readReviewConfigurationForm(formData).providers[0]!;
      expect(Object.hasOwn(provider, "agentProfileRef")).toBe(false);
      expect(JSON.stringify(provider)).not.toContain("agentProfileRef");
    }
    formData.set("providerAgentProfileRef.0", "approved-codex");
    expect(
      readReviewConfigurationForm(formData).providers[0]?.agentProfileRef,
    ).toBe("approved-codex");
  });

  it("rejects stale legacy auth instead of silently converting policy", () => {
    const formData = reviewConfigFormData([
      {
        authMode: "codex_subscription_oauth",
        model: "gpt-5.5",
        reasoningEffort: "high",
      },
      {
        authMode: "openrouter_api_key",
        model: "openai/gpt-5.3-codex",
        reasoningEffort: "medium",
      },
    ]);

    expect(() => readReviewConfigurationForm(formData)).toThrow(
      "review_auth_mode_requires_reconnect",
    );
  });

  it("preserves explicitly enabled investigation rollout flags", () => {
    const formData = reviewConfigFormData([
      {
        authMode: "openrouter_api_key",
        model: "openai/gpt-5.3-codex",
        reasoningEffort: "medium",
      },
    ]);
    for (const flag of [
      "recordingEnabled",
      "shadowEnabled",
      "contextCriticEnabled",
      "verifiedCleanEnabled",
      "crossRevisionReplayEnabled",
      "productionEffectsEnabled",
    ]) {
      formData.set(`investigationRollout.${flag}`, "true");
    }

    expect(readReviewConfigurationForm(formData).investigationRollout).toEqual({
      recordingEnabled: true,
      shadowEnabled: true,
      contextCriticEnabled: true,
      verifiedCleanEnabled: true,
      crossRevisionReplayEnabled: true,
      productionEffectsEnabled: true,
    });
  });

  it.each(["codex_subscription_oauth", "codex_openai_api_key"] as const)(
    "normalizes stale provider setup auth mode %s to rotating Codex",
    (authMode) => {
      const formData = new FormData();
      formData.set("providerKind", "codex");
      formData.set("authMode", authMode);

      expect(readProviderSetupSelection(formData)).toEqual({
        providerKind: "codex",
        authMode: "codex_subscription_oauth_rotating",
      });
    },
  );

  it("rejects duplicate provider rows from policy submissions", () => {
    const formData = reviewConfigFormData([
      {
        authMode: "openrouter_api_key",
        model: "openai/gpt-5.3-codex",
        reasoningEffort: "medium",
      },
      {
        authMode: "openrouter_api_key",
        model: "openai/gpt-5.3-codex",
        reasoningEffort: "high",
      },
    ]);

    expect(() => readReviewConfigurationForm(formData)).toThrow(
      "duplicate review provider",
    );
  });

  it("defaults review discussion replies off unless setup explicitly opts in", () => {
    const formData = new FormData();

    expect(readReviewDiscussionMode(formData)).toBe("off");

    formData.set("reviewDiscussionMode", "suggest");

    expect(readReviewDiscussionMode(formData)).toBe("suggest");
  });
});

function reviewConfigFormData(
  providers: readonly {
    readonly authMode: string;
    readonly model: string;
    readonly reasoningEffort: string;
  }[],
): FormData {
  const formData = new FormData();
  formData.set("providerCount", String(providers.length));
  formData.set("providerMaxParallel", String(providers.length));
  formData.set("inlineMinAgreement", String(providers.length));
  formData.set("failOnSeverity", "critical");
  formData.set("inlineMaxComments", "5");
  formData.set("targetTokensPerBatch", "50000");

  providers.forEach((provider, index) => {
    formData.set(`providerAuthMode.${index}`, provider.authMode);
    formData.set(`providerModel.${index}`, provider.model);
    formData.set(`providerReasoningEffort.${index}`, provider.reasoningEffort);
    formData.set(`providerAgenticContext.${index}`, "true");
    formData.set(`providerFastMode.${index}`, "false");
    formData.set(`providerRequiredHealthy.${index}`, String(index === 0));
  });

  return formData;
}
