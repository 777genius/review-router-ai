import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import type { WorkspaceProviderProfileRepositoryPort } from "@reviewrouter/features-review-config";
import { readWorkspaceAccountUsage } from "./account-usage";

// Review usage of a binding comes from the stored provider selections of the
// registry: two repositories select a provider over binding-1.
const providerProfiles = {
  list: vi.fn(async () => [
    {
      id: "provider-1",
      workspaceId: "workspace-1",
      createdByUserId: null,
      credential: {
        kind: "gateway_binding",
        authMode: "codex_account_gateway",
        bindingId: "binding-1",
        gatewayProfileRef: "profile-ref",
      },
      model: "gpt-5.6-sol",
      label: "Team account",
      archivedAt: null,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    },
  ]),
  listUsage: vi.fn(async () => [
    {
      profileId: "provider-1",
      workspaceDefault: false,
      repositoryIds: ["repo-hidden", "repo-visible"],
    },
  ]),
} as unknown as WorkspaceProviderProfileRepositoryPort;

// Usage rows name repositories, so a viewer without workspace-wide access must
// only read usage for repositories they can see. The visibility set is the
// filter: it applies to both review selection and profile-level secret rows.
function fakePrisma(): PrismaClient {
  return {
    repositoryConnection: {
      findMany: vi.fn(async () => [
        { id: "repo-visible", fullName: "acme/visible" },
        { id: "repo-hidden", fullName: "acme/hidden" },
      ]),
    },
    codexOAuthProviderInstance: {
      findMany: vi.fn(async () => [
        {
          secretName: "codex-secret-hidden",
          activeSecretNamespaceName: "ns-hidden",
          repository: { id: "repo-hidden", fullName: "acme/hidden" },
        },
        {
          secretName: "codex-secret-visible",
          activeSecretNamespaceName: "ns-visible",
          repository: { id: "repo-visible", fullName: "acme/visible" },
        },
      ]),
    },
    providerApiKeyConnection: {
      findMany: vi.fn(async () => [
        {
          repositoryLinks: [
            { repository: { id: "repo-visible", fullName: "acme/visible" } },
            { repository: { id: "repo-hidden", fullName: "acme/hidden" } },
          ],
        },
      ]),
    },
  } as unknown as PrismaClient;
}

const rows = [
  { key: "row-oauth", bindingId: "binding-1", profileId: "profile-oauth" },
  { key: "row-mimo", bindingId: "binding-1", profileId: "profile-mimo" },
] as const;

const profiles = [
  { id: "profile-oauth", label: "Codex", authKind: "oauth" as const },
  { id: "profile-mimo", label: "MiMo", authKind: "api_key" as const },
];

describe("readWorkspaceAccountUsage repository visibility", () => {
  it("keeps usage rows only for visible repositories", async () => {
    const usage = await readWorkspaceAccountUsage(fakePrisma(), {
      workspaceId: "workspace-1",
      profiles,
      rows,
      providerProfiles,
      visibleRepositoryIds: new Set(["repo-visible"]),
    });

    expect(usage.get("row-oauth")).toEqual({
      reviews: [
        { targetKey: "repo:repo-visible", repositoryName: "acme/visible" },
      ],
      secretRepositories: [
        { repositoryName: "acme/visible", secretName: "ns-visible" },
      ],
      secretLevel: "profile",
    });
    expect(usage.get("row-mimo")).toEqual({
      reviews: [
        { targetKey: "repo:repo-visible", repositoryName: "acme/visible" },
      ],
      secretRepositories: [
        { repositoryName: "acme/visible", secretName: null },
      ],
      secretLevel: "profile",
    });
  });

  it("keeps the other repository when only it is visible", async () => {
    const usage = await readWorkspaceAccountUsage(fakePrisma(), {
      workspaceId: "workspace-1",
      profiles,
      rows,
      providerProfiles,
      visibleRepositoryIds: new Set(["repo-hidden"]),
    });

    expect(usage.get("row-oauth")?.reviews).toEqual([
      { targetKey: "repo:repo-hidden", repositoryName: "acme/hidden" },
    ]);
    expect(usage.get("row-oauth")?.secretRepositories).toEqual([
      { repositoryName: "acme/hidden", secretName: "ns-hidden" },
    ]);
    expect(usage.get("row-mimo")?.secretRepositories).toEqual([
      { repositoryName: "acme/hidden", secretName: null },
    ]);
  });

  it("hides all usage when the visible set is empty", async () => {
    const usage = await readWorkspaceAccountUsage(fakePrisma(), {
      workspaceId: "workspace-1",
      profiles,
      rows,
      providerProfiles,
      visibleRepositoryIds: new Set<string>(),
    });

    for (const key of ["row-oauth", "row-mimo"]) {
      expect(usage.get(key)).toEqual({
        reviews: [],
        secretRepositories: [],
        secretLevel: "profile",
      });
    }
  });

  it("keeps the unfiltered workspace-wide read on null visibility", async () => {
    const usage = await readWorkspaceAccountUsage(fakePrisma(), {
      workspaceId: "workspace-1",
      profiles,
      rows,
      providerProfiles,
      visibleRepositoryIds: null,
    });

    expect(usage.get("row-oauth")?.reviews).toHaveLength(2);
    expect(usage.get("row-oauth")?.secretRepositories).toEqual([
      { repositoryName: "acme/hidden", secretName: "ns-hidden" },
      { repositoryName: "acme/visible", secretName: "ns-visible" },
    ]);
    expect(usage.get("row-mimo")?.secretRepositories).toHaveLength(2);
  });
});
