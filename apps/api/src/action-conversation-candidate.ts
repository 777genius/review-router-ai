import { createConsumerControlClient } from "@agent-teams/account-gateway/http";
import { executionConnector } from "@agent-teams/account-gateway/llm";
import { ConversationError } from "@reviewrouter/features-conversations";
import { createConversationMemoryPreview } from "./action-conversation-memory-preview.js";

/** API owns its SDK dependency and transport wiring; the evaluation owner supplies
 * only its explicit candidate capture and synthetic source authority. */
export function createConversationCandidateMemoryPreview(
  input: Omit<
    Parameters<typeof createConversationMemoryPreview>[0],
    "control" | "connectExecution"
  > & {
    readonly env: Readonly<Record<string, string | undefined>>;
  },
) {
  const { env, ...preview } = input;
  const origin = env.REVIEW_ROUTER_ACCOUNT_GATEWAY_ORIGIN;
  const token = env.REVIEW_ROUTER_ACCOUNT_GATEWAY_RUN_CONTROL_BEARER;
  if (
    !origin ||
    !token ||
    typeof input.captured.policy.bindingManifest.candidateEvaluationRunId !==
      "string"
  )
    throw new ConversationError("unavailable");
  return createConversationMemoryPreview({
    ...preview,
    control: createConsumerControlClient({
      role: "consumer-control",
      origin: env.REVIEW_ROUTER_ACCOUNT_GATEWAY_CONTROL_ORIGIN ?? origin,
      token,
      timeoutMs: 10_000,
    }),
    connectExecution: executionConnector({ origin }),
  });
}
