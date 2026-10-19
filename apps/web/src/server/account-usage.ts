import type { PrismaClient } from "@prisma/client";

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
  },
): Promise<Map<string, AccountUsageView>> {
  const byKey = new Map<string, AccountUsageView>();
  if (!input.rows.length) return byKey;
  const bindingIds = [
    ...new Set(
      input.rows.flatMap((row) => (row.bindingId ? [row.bindingId] : [])),
    ),
  ];
  const profileIds = [...new Set(input.rows.map((row) => row.profileId))];
  const profiles = input.profiles.filter((profile) =>
    profileIds.includes(profile.id),
  );
  const [configurations, secretsByProfile] = await Promise.all([
    bindingIds.length
      ? prisma.reviewConfiguration.findMany({
          where: { workspaceId: input.workspaceId, active: true },
          select: {
            targetKey: true,
            repository: { select: { fullName: true } },
            versions: {
              orderBy: { version: "desc" },
              take: 1,
              select: {
                gatewayBindingId: true,
                providers: { select: { gatewayBindingId: true } },
              },
            },
          },
        })
      : Promise.resolve([]),
    Promise.all(
      profiles.map(
        async (
          profile,
        ): Promise<
          readonly [string, readonly AccountUsageSecretRepository[]]
        > => {
          if (profile.authKind === "oauth") {
            const instances = await prisma.codexOAuthProviderInstance.findMany({
              where: {
                workspaceId: input.workspaceId,
                activeSecretNamespaceId: { not: null },
              },
              select: {
                secretName: true,
                activeSecretNamespaceName: true,
                repository: { select: { fullName: true } },
              },
            });
            return [
              profile.id,
              instances.map((instance) => ({
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
                select: { repository: { select: { fullName: true } } },
              },
            },
          });
          return [
            profile.id,
            connections.flatMap((connection) =>
              connection.repositoryLinks.map((link) => ({
                repositoryName: link.repository.fullName,
                secretName: null,
              })),
            ),
          ] as const;
        },
      ),
    ),
  ]);
  const reviewsForBinding = new Map<string, AccountUsageReview[]>();
  for (const configuration of configurations) {
    const version = configuration.versions[0];
    if (!version) continue;
    const selected = [
      version.gatewayBindingId,
      ...version.providers.map((provider) => provider.gatewayBindingId),
    ];
    for (const bindingId of selected) {
      if (!bindingId) continue;
      const entry = reviewsForBinding.get(bindingId) ?? [];
      entry.push({
        targetKey: configuration.targetKey,
        repositoryName: configuration.repository?.fullName ?? null,
      });
      reviewsForBinding.set(bindingId, entry);
    }
  }
  const secrets = new Map(secretsByProfile);
  for (const row of input.rows) {
    byKey.set(row.key, {
      reviews: row.bindingId
        ? (reviewsForBinding.get(row.bindingId) ?? [])
        : [],
      secretRepositories: secrets.get(row.profileId) ?? [],
      secretLevel: "profile",
    });
  }
  return byKey;
}
