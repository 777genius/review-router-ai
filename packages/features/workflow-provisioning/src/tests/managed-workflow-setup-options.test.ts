import { describe, expect, it } from "vitest";
import {
  assertManagedWorkflowSetupOptions,
} from "../domain/managed-workflow-setup-options.js";
import type { WorkflowTransport } from "../domain/workflow-transport.js";
import type {
  ReviewRouterDiscussionMode,
  ReviewRouterWorkflowStyle,
} from "../domain/workflow-template.js";

describe("managed workflow setup option admission", () => {
  it.each([
    ["gateway", "reusable", "off", false, null],
    ["gateway", "reusable", "off", true, null],
    ["gateway", "reusable", "suggest", true, null],
    [
      "gateway",
      "reusable",
      "suggest",
      false,
      "account_gateway_workflow_options_not_supported",
    ],
    [
      "gateway",
      "explicit",
      "off",
      true,
      "account_gateway_workflow_options_not_supported",
    ],
    [
      "gateway",
      "explicit",
      "suggest",
      true,
      "account_gateway_workflow_options_not_supported",
    ],
    ["provider_api", "reusable", "off", false, null],
    [
      "provider_api",
      "reusable",
      "suggest",
      true,
      "openrouter_direct_workflow_options_not_supported",
    ],
    [
      "provider_api",
      "explicit",
      "off",
      true,
      "openrouter_direct_workflow_options_not_supported",
    ],
    ["rotating", "explicit", "suggest", false, null],
    ["hosted_pool", "explicit", "suggest", false, null],
    ["ci_secrets", "explicit", "suggest", false, null],
  ] as const)(
    "selects %s / %s / %s (gateway available: %s)",
    (transport, workflowStyle, discussionMode, available, expectedError) => {
      const request: {
        transport: WorkflowTransport;
        workflowStyle: ReviewRouterWorkflowStyle;
        discussionMode: ReviewRouterDiscussionMode;
        gatewayInteractionRuntimeAvailable: boolean;
      } = {
        transport,
        workflowStyle,
        discussionMode,
        gatewayInteractionRuntimeAvailable: available,
      };
      if (expectedError) {
        expect(() => assertManagedWorkflowSetupOptions(request)).toThrow(
          expectedError,
        );
      } else {
        expect(() => assertManagedWorkflowSetupOptions(request)).not.toThrow();
      }
    },
  );
});
