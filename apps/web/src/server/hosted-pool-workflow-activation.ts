import {
  activateConfirmedHostedPoolBindingAfterWorkflowMerge as activateHostedBinding,
} from "@reviewrouter/features-workflow-provisioning/composition";
import { resolveReviewRouterCodexRotatingTrustedActionRefs } from "@reviewrouter/platform-config";
import { switchRepositoryConfigurationAuthMode } from "./prisma-hosted-pool-mutations";

export type {
  VerifiedHostedPoolWorkflow,
  HostedPoolWorkflowActivationResult,
} from "@reviewrouter/features-workflow-provisioning/composition";

export function activateConfirmedHostedPoolBindingAfterWorkflowMerge(
  input: Omit<
    Parameters<typeof activateHostedBinding>[0],
    "trustedActionRefs" | "switchConfiguration"
  >,
) {
  return activateHostedBinding({
    ...input,
    trustedActionRefs: resolveReviewRouterCodexRotatingTrustedActionRefs(),
    switchConfiguration: switchRepositoryConfigurationAuthMode,
  });
}
