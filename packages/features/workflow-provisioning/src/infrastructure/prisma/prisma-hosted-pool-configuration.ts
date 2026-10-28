import { readPersonalAccountSharingEnabled } from "@reviewrouter/features-provider-accounts/composition";
import {
  acquireReviewConfigurationWriteScope,
  findReviewConfiguration,
  parseRepositoryReviewPolicy,
  PrismaReviewConfigurationTransactionRepository,
  STORED_REVIEW_POLICY_SCHEMA_VERSION,
  type ProviderProfileDraft,
} from "@reviewrouter/features-review-config";
import type { Prisma } from "@prisma/client";

/**
 * Hosted pool activation and the switch back to a repository-owned workflow
 * select a hosted-pool or rotating profile for the repository's Codex
 * subscription rows, keeping their model and review settings. A system
 * write: the profile has no creator and only owners and admins manage it.
 */
export async function switchRepositoryConfigurationAuthMode(input: {
  readonly transaction: Prisma.TransactionClient;
  readonly workspaceId: string;
  readonly repositoryId: string;
  readonly authMode:
    | "codex_subscription_oauth_hosted_pool"
    | "codex_subscription_oauth_rotating";
}): Promise<boolean> {
  // Hosted activation is a system write: no signed-in user.
  const configurations = new PrismaReviewConfigurationTransactionRepository(
    input.transaction,
    undefined,
    readPersonalAccountSharingEnabled(process.env),
    undefined,
  );
  const repositoryTarget = {
    scope: "repository" as const,
    workspaceId: input.workspaceId,
    repositoryId: input.repositoryId,
  };
  await acquireReviewConfigurationWriteScope(
    input.transaction,
    repositoryTarget,
  );
  const current = await findReviewConfiguration(repositoryTarget, {
    configurations,
  });
  if (!current) throw new Error("workspace_review_policy_not_configured");
  const drafts: ProviderProfileDraft[] = [];
  const selections = current.selections.map((selection, index) => {
    const provider = current.config.providers[index]!;
    // Explicit gateway selections do not participate in pool switching.
    if (
      provider.kind !== "codex" ||
      provider.authMode === "codex_account_gateway"
    )
      return selection;
    const draftId = `hosted-switch-${index}`;
    drafts.push({
      draftId,
      credential:
        input.authMode === "codex_subscription_oauth_hosted_pool"
          ? { kind: "hosted_pool" }
          : { kind: "repository_rotating", repositoryId: input.repositoryId },
      model: provider.model,
      label: null,
    });
    return { ...selection, profileId: draftId };
  });
  if (drafts.length === 0) return false;
  const repositoryPolicy =
    current.source === "repository"
      ? parseRepositoryReviewPolicy(current.policy)
      : parseRepositoryReviewPolicy({
          schemaVersion: STORED_REVIEW_POLICY_SCHEMA_VERSION,
        });
  await configurations.saveNextVersions({
    workspaceId: input.workspaceId,
    writes: [
      {
        target: repositoryTarget,
        policy: { ...repositoryPolicy, providers: selections },
        expectedVersion: current.repositoryVersion,
      },
    ],
    profileDrafts: drafts,
    profileCreatorUserId: null,
  });
  return true;
}
