import type {
  ReviewConfigurationRepositoryPort,
  ReviewPolicyHeadReaderPort,
  SavedReviewPolicy,
} from "../ports/review-configuration-repository-port";
import type { ProviderProfileActor } from "../ports/workspace-provider-profile-repository-port";
import { defaultWorkspaceReviewPolicy } from "../../domain/review-policy-document";
import { parseStoredReviewPolicy } from "./resolve-effective-review-configuration";
import { providerSelectionAuthority } from "./manage-provider-selections";

export type WorkspaceMemorySettings = Readonly<{
  requireConfirmation: boolean;
  /** Workspace policy version for stale forms and in-flight write admission. */
  version: number | null;
}>;

/** Changes only memory behavior; provider selections and other settings survive. */
export async function saveWorkspaceMemorySettings(
  input: Readonly<{
    workspaceId: string;
    actor: ProviderProfileActor;
    requireConfirmation: boolean;
    expectedVersion: number | null;
  }>,
  dependencies: Readonly<{
    configurations: ReviewConfigurationRepositoryPort;
    policyHeads: ReviewPolicyHeadReaderPort;
  }>,
): Promise<SavedReviewPolicy> {
  const target = {
    scope: "workspace" as const,
    workspaceId: input.workspaceId,
  };
  const { workspace: head } =
    await dependencies.policyHeads.readPolicyHeads(target);
  const current = head ? parseStoredReviewPolicy("workspace", head) : null;
  if (head && !current) throw new Error("review_policy_resave_required");
  const [saved] = await dependencies.configurations.saveNextVersions({
    workspaceId: input.workspaceId,
    writes: [
      {
        target,
        policy: {
          ...(current ?? defaultWorkspaceReviewPolicy()),
          memory: { requireConfirmation: input.requireConfirmation },
        },
        expectedVersion: input.expectedVersion,
      },
    ],
    selectionAuthority: providerSelectionAuthority({ actor: input.actor }),
    audit: {
      actor: input.actor.auditActor,
      action: "workspace.memory_settings_saved",
      metadata: { requireConfirmation: input.requireConfirmation },
    },
  });
  if (!saved) throw new Error("review_configuration_write_conflict");
  return saved;
}
