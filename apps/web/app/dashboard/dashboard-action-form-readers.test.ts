import { repositoryPolicyFormFields } from "./review-policy-form-contract";
import { describe, expect, it } from "vitest";
import {
  readProviderSetupSelection,
  readRepositoryReviewSettingsForm,
  readReviewDiscussionMode,
  readReviewPolicyExpectedVersion,
  readWorkspaceReviewSettingsForm,
} from "./dashboard-action-form-readers";

describe("dashboard action form readers", () => {
  it("reads repository overrides only and never a provider", () => {
    const form = inheritAll();
    form.set("policyMode.limits.inlineMaxComments", "override");
    form.set("inlineMaxComments", "0");
    form.set(
      "policyMode.investigationRollout.productionEffectsEnabled",
      "override",
    );
    form.set("investigationRollout.productionEffectsEnabled", "false");
    // Provider fields of an old page are ignored, not read as a selection.
    form.set("policyMode.providers", "override");
    form.set("providerCount", "1");
    form.set("providerAuthMode.0", "claude_code_oauth");
    expect(readRepositoryReviewSettingsForm(form)).toEqual({
      limits: { inlineMaxComments: 0 },
      investigationRollout: { productionEffectsEnabled: false },
    });
  });

  it("preserves optional context selection and an explicit repository off override", () => {
    const form = inheritAll();
    form.set("policyMode.contextTools", "override");
    expect(readRepositoryReviewSettingsForm(form)).toEqual({
      contextTools: { version: 1, builtinTools: [], mcp: [] },
    });
    const selection = {
      version: 1,
      builtinTools: ["github.issue.read"],
      mcp: [{ connection: "docs", tools: ["search_docs"] }],
    };
    form.set("contextTools", JSON.stringify(selection));
    expect(readRepositoryReviewSettingsForm(form).contextTools).toEqual(
      selection,
    );
    form.set(
      "contextTools",
      JSON.stringify({ ...selection, rawSecret: "must-not-echo" }),
    );
    expect(() => readRepositoryReviewSettingsForm(form)).toThrow(
      "context_connection_invalid",
    );
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

  it("keeps explicit zero, false and null without copying inherited values", () => {
    const form = inheritAll();
    for (const field of [
      "limits.inlineMaxComments",
      "investigationRollout.recordingEnabled",
      "reviewLanguage",
    ])
      form.set(`policyMode.${field}`, "override");
    form.set("inlineMaxComments", "0");
    form.set("investigationRollout.recordingEnabled", "false");
    form.set("reviewLanguage", "");
    expect(readRepositoryReviewSettingsForm(form)).toEqual({
      limits: { inlineMaxComments: 0 },
      investigationRollout: { recordingEnabled: false },
      reviewLanguage: null,
    });
  });

  it("refuses missing inheritance intent rather than guessing from values", () => {
    expect(() => readRepositoryReviewSettingsForm(new FormData())).toThrow();
    expect(readRepositoryReviewSettingsForm(inheritAll())).toEqual({});
  });

  it("reads the workspace settings without any provider field", () => {
    const form = workspaceSettingsFormData();
    form.set("providerCount", "1");
    form.set("providerAuthMode.0", "invalid-old-page-field");
    expect(readWorkspaceReviewSettingsForm(form)).toEqual({
      execution: { providerMaxParallel: 1, inlineMinAgreement: 1 },
      blockingPolicy: { failOnSeverity: "critical" },
      limits: { inlineMaxComments: 5, targetTokensPerBatch: 50000 },
      reviewLanguage: null,
      investigationRollout: {
        recordingEnabled: false,
        shadowEnabled: false,
        contextCriticEnabled: false,
        verifiedCleanEnabled: false,
        crossRevisionReplayEnabled: false,
        productionEffectsEnabled: false,
      },
    });
  });

  it("preserves explicitly enabled investigation rollout flags", () => {
    const form = workspaceSettingsFormData();
    for (const flag of [
      "recordingEnabled",
      "shadowEnabled",
      "contextCriticEnabled",
      "verifiedCleanEnabled",
      "crossRevisionReplayEnabled",
      "productionEffectsEnabled",
    ])
      form.set(`investigationRollout.${flag}`, "true");
    form.set("updatePrDescription", "false");

    const settings = readWorkspaceReviewSettingsForm(form);
    expect(settings.investigationRollout).toEqual({
      recordingEnabled: true,
      shadowEnabled: true,
      contextCriticEnabled: true,
      verifiedCleanEnabled: true,
      crossRevisionReplayEnabled: true,
      productionEffectsEnabled: true,
    });
    expect(settings.updatePrDescription).toBe(false);
  });

  it.each(["codex_subscription_oauth", "codex_openai_api_key"])(
    "rejects removed provider setup auth mode %s instead of converting it",
    (authMode) => {
      const formData = new FormData();
      formData.set("providerKind", "codex");
      formData.set("authMode", authMode);

      expect(() => readProviderSetupSelection(formData)).toThrow(
        "invalid_form_value:providerSetup",
      );
    },
  );

  it("defaults review discussion replies off unless setup explicitly opts in", () => {
    const formData = new FormData();

    expect(readReviewDiscussionMode(formData)).toBe("off");

    formData.set("reviewDiscussionMode", "suggest");

    expect(readReviewDiscussionMode(formData)).toBe("suggest");
  });
});

function inheritAll(): FormData {
  const form = new FormData();
  for (const field of repositoryPolicyFormFields)
    form.set(`policyMode.${field.join(".")}`, "inherit");
  return form;
}

function workspaceSettingsFormData(): FormData {
  const formData = new FormData();
  formData.set("providerMaxParallel", "1");
  formData.set("inlineMinAgreement", "1");
  formData.set("failOnSeverity", "critical");
  formData.set("inlineMaxComments", "5");
  formData.set("targetTokensPerBatch", "50000");
  return formData;
}
