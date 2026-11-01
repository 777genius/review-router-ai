import { z } from "zod";

const qualificationSchema = z.strictObject({
  profileVersion: z.literal(1),
  proofId: z.string().min(1).max(200),
  sourceProcessingProfile: z.literal("transient-checked-inline-v1"),
  runtimeSha: z.string().regex(/^[a-f0-9]{40}$/),
  repositories: z
    .array(
      z.strictObject({
        workspaceId: z.string().min(1),
        repositoryId: z.string().min(1),
      }),
    )
    .min(1)
    .max(1000),
  models: z
    .array(
      z.strictObject({
        profileId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/),
        model: z.string().min(1).max(128),
        contextWindowTokens: z.number().int().min(4096).max(2_000_000),
        tokensPerByteUpperBound: z.number().min(1).max(4),
      }),
    )
    .min(1)
    .max(128),
});
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
export function conversationScopeQualified(
  q: ConversationQualification | null,
  scope: { readonly workspaceId: string; readonly repositoryId: string },
) {
  return (
    q?.repositories.some(
      (repository) =>
        repository.workspaceId === scope.workspaceId &&
        repository.repositoryId === scope.repositoryId,
    ) === true
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
    conversationScopeQualified(qualification, scope) &&
    env.REVIEW_ROUTER_GATEWAY_INTERACTION_RUNTIME_SHA ===
      qualification.runtimeSha
    ? qualification.runtimeSha
    : undefined;
}
