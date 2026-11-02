import { z } from "zod";

const modelBounds = z
  .array(
    z.strictObject({
      profileId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/),
      model: z.string().min(1).max(128),
      contextWindowTokens: z.number().int().min(4096).max(2_000_000),
      tokensPerByteUpperBound: z.number().min(1).max(4),
    }),
  )
  .min(1)
  .max(128);
const evidence = {
  proofId: z.string().min(1).max(200),
  runtimeSha: z.string().regex(/^[a-f0-9]{40}$/),
  models: modelBounds,
};
const repositoryQualification = z.strictObject({
  ...evidence,
  profileVersion: z.literal(1),
  sourceProcessingProfile: z.enum([
    "transient-checked-inline-v1",
    "transient-checked-inline-gateway-v1",
    "transient-checked-inline-gateway-full-thread-v1",
  ]),
  repositories: z
    .array(
      z.strictObject({
        workspaceId: z.string().min(1),
        repositoryId: z.string().min(1),
      }),
    )
    .min(1)
    .max(1000),
});
const sourceDigest = z.string().regex(/^[a-f0-9]{64}$/);
const deploymentCapability = z.strictObject({
  ...evidence,
  profileVersion: z.literal(2),
  sourceProcessingProfile: z.literal(
    "transient-checked-inline-gateway-full-thread-v1",
  ),
  coverage: z.literal("normal-current-product-admission"),
  sourceProfile: z.strictObject({
    commonPromptSourceDigest: sourceDigest,
    gatewayPreviewSourceDigest: sourceDigest,
    accountPolicySourceDigest: sourceDigest,
    gatewaySdkProvenanceDigest: sourceDigest,
  }),
});
const qualificationSchema = z.discriminatedUnion("profileVersion", [
  repositoryQualification,
  deploymentCapability,
]);
export type ConversationQualification = z.infer<typeof qualificationSchema>;
/** Deployment evidence/bounds only. User learning authority stays with the existing memory policy. */
export function readConversationQualification(
  raw: string | undefined,
): ConversationQualification | null {
  if (!raw) return null;
  try {
    if (Buffer.byteLength(raw) > 131_072) throw new Error();
    return qualificationSchema.parse(JSON.parse(raw));
  } catch {
    throw new Error("conversation_qualification_invalid");
  }
}
/** Mechanism evidence applicability only. This never grants repository, source or account authority. */
export function conversationCapabilityAppliesToScope(
  q: ConversationQualification | null,
  scope: { readonly workspaceId: string; readonly repositoryId: string },
) {
  if (!q) return false;
  if (q.profileVersion === 2)
    return Boolean(scope.workspaceId && scope.repositoryId);
  return q.repositories.some(
    (repository) =>
      repository.workspaceId === scope.workspaceId &&
      repository.repositoryId === scope.repositoryId,
  );
}
export function qualifiedGatewayInteractionRuntimeSha(
  env: Readonly<Record<string, string | undefined>>,
  scope: { readonly workspaceId: string; readonly repositoryId: string },
): string | undefined {
  const qualification = readConversationQualification(
    env.REVIEW_ROUTER_CONVERSATION_QUALIFICATION,
  );
  return qualification &&
    conversationCapabilityAppliesToScope(qualification, scope) &&
    env.REVIEW_ROUTER_GATEWAY_INTERACTION_RUNTIME_SHA ===
      qualification.runtimeSha
    ? qualification.runtimeSha
    : undefined;
}
