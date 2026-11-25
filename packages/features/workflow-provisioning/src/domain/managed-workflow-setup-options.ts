import type {
  ReviewRouterDiscussionMode,
  ReviewRouterWorkflowStyle,
} from "./workflow-template.js";
import type { WorkflowTransport } from "./workflow-transport.js";

/**
 * Reject unsupported options before selecting a source or creating an external
 * workflow. The host supplies only its already-qualified runtime availability.
 * This policy never reads environment, secrets, GitHub or persistent state.
 */
export function assertManagedWorkflowSetupOptions(input: {
  readonly transport: WorkflowTransport;
  readonly workflowStyle: ReviewRouterWorkflowStyle;
  readonly discussionMode: ReviewRouterDiscussionMode;
  readonly gatewayInteractionRuntimeAvailable: boolean;
}): void {
  const accountGateway = input.transport === "gateway";
  const openRouterDirect = input.transport === "provider_api";
  const managedReview = accountGateway || openRouterDirect;
  if (
    managedReview &&
    (input.workflowStyle === "explicit" ||
      (input.discussionMode === "suggest" &&
        !(accountGateway && input.gatewayInteractionRuntimeAvailable)))
  ) {
    throw new Error(
      openRouterDirect
        ? "openrouter_direct_workflow_options_not_supported"
        : "account_gateway_workflow_options_not_supported",
    );
  }
}
