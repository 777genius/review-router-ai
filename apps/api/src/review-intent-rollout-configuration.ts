export const reviewActionV2IntentAdmissionRequiredEnv =
  "REVIEW_ROUTER_REVIEW_V2_INTENT_ADMISSION_REQUIRED";
export const reviewActionV2IntentIngressEnabledEnv =
  "REVIEW_ROUTER_REVIEW_V2_INTENT_INGRESS_ENABLED";
export const reviewActionV2WorkflowDispatchReadyEnv =
  "REVIEW_ROUTER_REVIEW_V2_WORKFLOW_DISPATCH_READY";

export function assertReviewIntentRolloutConfiguration(
  env: Readonly<Record<string, string | undefined>>,
): void {
  const ingressEnabled = env[reviewActionV2IntentIngressEnabledEnv] === "1";
  const admissionRequired =
    env[reviewActionV2IntentAdmissionRequiredEnv] === "1";
  const dispatchReady = env[reviewActionV2WorkflowDispatchReadyEnv] === "1";
  const workerEnabled = env.REVIEW_ROUTER_REVIEW_V2_WORKER_ENABLED === "1";
  const outboxTakeoverEnabled =
    env.REVIEW_ROUTER_OUTBOX_FENCED_TAKEOVER_ENABLED === "1";
  if (
    ingressEnabled &&
    (!dispatchReady || !workerEnabled || !outboxTakeoverEnabled)
  ) {
    throw new Error("review_action_v2_intent_ingress_dependencies_unavailable");
  }
  if (admissionRequired && !ingressEnabled) {
    throw new Error("review_action_v2_intent_admission_without_ingress");
  }
}
