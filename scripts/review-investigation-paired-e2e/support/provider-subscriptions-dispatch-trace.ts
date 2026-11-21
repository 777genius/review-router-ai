/** Private fixture attribution captured before the real execution ingress. */
export type JoinedDispatchTrace = Readonly<{
  runOperationId: string;
  policySubjectRef: string;
  invocationRef: string;
  attemptRef: string;
  executionRef: string;
  requestRef: string;
  accountRef: string;
  profileId: string;
  modelId: string;
  occurredAt: string;
  serviceTier: "default";
}>;
