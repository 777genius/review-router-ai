import type { ReviewConfiguration } from "@reviewrouter/features-review-config";
import { selectModelDispatchReviewAgentProfile } from "@reviewrouter/features-review-run-control";
import {
  isClaudeSubscriptionConfiguration,
  readCanonicalWorkflowDocument,
} from "@reviewrouter/features-workflow-provisioning";
import { selectReviewModelRoutePolicy } from "@reviewrouter/shared";
import type { DashboardRuntimeReleases } from "../review-runtime-readiness";

/** A registered overlap release is not an installation target. The same exact
 * configured producer must qualify the native model, OCR profile and caller. */
export async function resolveApprovedClaudeSubscriptionActionRef(
  input: {
    readonly actionRef: string;
    readonly configuration: ReviewConfiguration;
    readonly releases: DashboardRuntimeReleases | null;
  },
  dependencies: {
    readExecutionWorkflow(commitSha: string): Promise<string | null>;
  },
): Promise<string | undefined> {
  if (!isClaudeSubscriptionConfiguration(input.configuration)) return undefined;
  const sha = /^777genius\/review-router@([a-f0-9]{40})$/.exec(
    input.actionRef,
  )?.[1];
  if (!sha) return undefined;
  const release = input.releases?.get(sha);
  if (!release?.provisioningTransports.includes("runner_local_anthropic"))
    return undefined;
  let routeQualified = false;
  try {
    const selected = selectReviewModelRoutePolicy(
      release.modelDispatchProfile,
      input.configuration.providers,
    );
    if (selected?.transport !== "runner_local_anthropic") return undefined;
    const agent = selectModelDispatchReviewAgentProfile({
      agentProfiles: release.agentProfiles,
      modelTransport: "provider_api",
      preparedRouteDefaultRef: selected.defaultAgentProfileRef,
      agenticContext:
        input.configuration.providers[0]!.agenticContext !== false,
      reviewSkillsDelivery: true,
    });
    if (agent.agentKind !== "ocr") return undefined;
    routeQualified = true;
    const source = await dependencies.readExecutionWorkflow(sha);
    if (!source) throw new Error("claude_subscription_runtime_not_ready");
    const workflow = readCanonicalWorkflowDocument(source) as {
      on?: {
        workflow_call?: {
          inputs?: Record<string, { type?: unknown; default?: unknown }>;
        };
      };
      jobs?: {
        review?: { steps?: readonly { env?: Record<string, unknown> }[] };
      };
    };
    const mode = workflow.on?.workflow_call?.inputs?.subscription_auth_mode;
    const nativeStep = workflow.jobs?.review?.steps?.some(
      (step) =>
        step.env?.REVIEW_ROUTER_MODE === "prepared-subscription" &&
        step.env.REVIEWROUTER_ACTION_V2_MODE === "t0" &&
        step.env.REVIEWROUTER_PREPARED_MODEL_TRANSPORT ===
          "runner_local_anthropic" &&
        step.env.INPUT_CLAUDE_CODE_OAUTH_TOKEN ===
          "${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}",
    );
    if (mode?.type !== "string" || mode.default !== "" || !nativeStep)
      throw new Error("claude_subscription_runtime_not_ready");
    return input.actionRef;
  } catch {
    if (routeQualified)
      throw new Error("claude_subscription_runtime_not_ready");
    return undefined;
  }
}
