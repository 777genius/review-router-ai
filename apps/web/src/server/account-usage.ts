import type { PrismaClient } from "@prisma/client";
import {
  listWorkspaceProviderProfiles,
  listWorkspaceProviderProfileUsage,
  reviewConfigurationTargetKey,
  type WorkspaceProviderProfileRepositoryPort,
} from "@reviewrouter/features-review-config";
import { dashboardProviderProfiles } from "./dashboard-provider-selections";

// Usage facts are read-only projections for the Accounts UI. Review selection is
// exact per binding; repository secrets are workspace+profile level because the
// secret payload identity is computed on the GitHub side and never returned to
// ReviewRouter. This reader must never claim a secret points at one account.
export type AccountUsageReview = {
  readonly targetKey: string;
  readonly repositoryName: string | null;
};
export type AccountUsageSecretRepository = {
  readonly repositoryName: string | null;
  readonly secretName: string | null;
};
export type AccountUsageView = {
  readonly reviews: readonly AccountUsageReview[];
  readonly secretRepositories: readonly AccountUsageSecretRepository[];
  // "profile" marks the honest scope: secrets follow the profile, not one row.
  readonly secretLevel: "profile";
};

type UsageProfile = {
  readonly id: string;
  readonly label: string;
  readonly authKind?: "api_key" | "oauth" | undefined;
};

// Internal usage rows keep the repository id so the visibility filter can
// decide; the public view keeps its exact shape.
type UsageReviewEntry = AccountUsageReview & {
  readonly repositoryId: string | null;
};
type UsageSecretEntry = AccountUsageSecretRepository & {
  readonly repositoryId: string | null;
};

function providerTypeFor(label: string): "mimo" | "openrouter" | null {
  const value = label.toLowerCase();
  return value === "mimo" || value === "openrouter" ? value : null;
}

export async function readWorkspaceAccountUsage(
  prisma: PrismaClient,
  input: {
    readonly workspaceId: string;
    readonly profiles: readonly UsageProfile[];
    // Rows keyed by the UI connection id, each carrying its exact binding and
    // profile. The binding may be absent for an owned but unbound source.
    readonly rows: readonly {
      readonly key: string;
      readonly bindingId: string | null;
      readonly profileId: string;
    }[];
    // Repository visibility for this viewer. A set limits both review and
    // secret usage to those repositories (rows without a repository are
    // dropped too); null keeps the workspace-wide unfiltered read.
    readonly visibleRepositoryIds?: ReadonlySet<string> | null;
    /** The provider registry; the dashboard's own adapter by default. */
    readonly providerProfiles?: WorkspaceProviderProfileRepositoryPort;
  },
): Promise<Map<string, AccountUsageView>> {
  const byKey = new Map<string, AccountUsageView>();
  if (!input.rows.length) return byKey;
  const visibleRepositoryIds = input.visibleRepositoryIds ?? null;
  const bindingIds = [
    ...new Set(
      input.rows.flatMap((row) => (row.bindingId ? [row.bindingId] : [])),
    ),
  ];
  const profileIds = [...new Set(input.rows.map((row) => row.profileId))];
  const profiles = input.profiles.filter((profile) =>
    profileIds.includes(profile.id),
  );
  const [reviewsForBinding, secretsByProfile] = await Promise.all([
    bindingIds.length
      ? readBindingReviewUsage(prisma, {
          workspaceId: input.workspaceId,
          bindingIds,
          providerProfiles:
            input.providerProfiles ?? dashboardProviderProfiles(prisma),
        })
      : Promise.resolve(new Map<string, UsageReviewEntry[]>()),
    Promise.all(
      profiles.map(
        async (
          profile,
        ): Promise<readonly [string, readonly UsageSecretEntry[]]> => {
          if (profile.authKind === "oauth") {
            const instances = await prisma.codexOAuthProviderInstance.findMany({
              where: {
                workspaceId: input.workspaceId,
                activeSecretNamespaceId: { not: null },
              },
              select: {
                secretName: true,
                activeSecretNamespaceName: true,
                repository: { select: { id: true, fullName: true } },
              },
            });
            return [
              profile.id,
              instances.map((instance) => ({
                repositoryId: instance.repository.id,
                repositoryName: instance.repository.fullName,
                secretName:
                  instance.activeSecretNamespaceName ?? instance.secretName,
              })),
            ] as const;
          }
          const providerType = providerTypeFor(profile.label);
          if (!providerType) return [profile.id, []] as const;
          const connections = await prisma.providerApiKeyConnection.findMany({
            where: { workspaceId: input.workspaceId, providerType },
            select: {
              repositoryLinks: {
                where: { appliedKeyVersion: { not: null } },
                select: {
                  repository: { select: { id: true, fullName: true } },
                },
              },
            },
          });
          return [
            profile.id,
            connections.flatMap((connection) =>
              connection.repositoryLinks.map((link) => ({
                repositoryId: link.repository.id,
                repositoryName: link.repository.fullName,
                secretName: null,
              })),
            ),
          ] as const;
        },
      ),
    ),
  ]);
  const secrets = new Map<string, readonly UsageSecretEntry[]>(
    secretsByProfile,
  );
  const keepVisible = <T extends { readonly repositoryId: string | null }>(
    entries: readonly T[],
  ): readonly T[] =>
    !visibleRepositoryIds
      ? entries
      : entries.filter(
          (entry) =>
            entry.repositoryId !== null &&
            visibleRepositoryIds.has(entry.repositoryId),
        );
  for (const row of input.rows) {
    const reviews = row.bindingId
      ? (reviewsForBinding.get(row.bindingId) ?? [])
      : [];
    const secretRepositories = secrets.get(row.profileId) ?? [];
    byKey.set(row.key, {
      reviews: keepVisible(reviews).map((entry) => ({
        targetKey: entry.targetKey,
        repositoryName: entry.repositoryName,
      })),
      secretRepositories: keepVisible(secretRepositories).map((entry) => ({
        repositoryName: entry.repositoryName,
        secretName: entry.secretName,
      })),
      secretLevel: "profile",
    });
  }
  return byKey;
}

/**
 * Policy scopes whose stored selection uses a provider over each binding,
 * through the same usage read as the Providers list: the workspace default
 * (which also covers the repositories inheriting it) and every repository
 * selecting such a provider itself.
 */
async function readBindingReviewUsage(
  prisma: PrismaClient,
  input: {
    readonly workspaceId: string;
    readonly bindingIds: readonly string[];
    readonly providerProfiles: WorkspaceProviderProfileRepositoryPort;
  },
): Promise<Map<string, UsageReviewEntry[]>> {
  const dependencies = { profiles: input.providerProfiles };
  const [profiles, usage] = await Promise.all([
    listWorkspaceProviderProfiles(input.workspaceId, dependencies),
    listWorkspaceProviderProfileUsage(input.workspaceId, dependencies),
  ]);
  const bindingByProfile = new Map(
    profiles.flatMap((profile) =>
      profile.credential.kind === "gateway_binding" &&
      input.bindingIds.includes(profile.credential.bindingId)
        ? [[profile.id, profile.credential.bindingId] as const]
        : [],
    ),
  );
  const repositoryIds = [
    ...new Set(
      usage.flatMap((item) =>
        bindingByProfile.has(item.profileId) ? item.repositoryIds : [],
      ),
    ),
  ];
  const repositories = repositoryIds.length
    ? await prisma.repositoryConnection.findMany({
        where: { workspaceId: input.workspaceId, id: { in: repositoryIds } },
        select: { id: true, fullName: true },
      })
    : [];
  const fullNames = new Map(
    repositories.map((repository) => [repository.id, repository.fullName]),
  );
  const reviewsForBinding = new Map<string, UsageReviewEntry[]>();
  for (const item of usage) {
    const bindingId = bindingByProfile.get(item.profileId);
    if (!bindingId) continue;
    const entries = reviewsForBinding.get(bindingId) ?? [];
    if (item.workspaceDefault)
      entries.push({
        targetKey: reviewConfigurationTargetKey({
          scope: "workspace",
          workspaceId: input.workspaceId,
        }),
        repositoryName: null,
        repositoryId: null,
      });
    for (const repositoryId of item.repositoryIds)
      entries.push({
        targetKey: reviewConfigurationTargetKey({
          scope: "repository",
          workspaceId: input.workspaceId,
          repositoryId,
        }),
        repositoryName: fullNames.get(repositoryId) ?? null,
        repositoryId,
      });
    reviewsForBinding.set(bindingId, entries);
  }
  return reviewsForBinding;
}
