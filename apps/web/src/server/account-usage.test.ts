import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { readWorkspaceAccountUsage } from "./account-usage";

// Usage rows name repositories, so a viewer without workspace-wide access must
// only read usage for repositories they can see. The visibility set is the
// filter: it applies to both review selection and profile-level secret rows.
function fakePrisma(): PrismaClient {
  return {
    reviewConfiguration: {
      findMany: vi.fn(async () => [
        {
          targetKey: "reviews/visible",
          repository: { id: "repo-visible", fullName: "acme/visible" },
          versions: [{ gatewayBindingId: "binding-1", providers: [] }],
        },
        {
          targetKey: "reviews/hidden",
          repository: { id: "repo-hidden", fullName: "acme/hidden" },
          versions: [{ gatewayBindingId: "binding-1", providers: [] }],
        },
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
      visibleRepositoryIds: new Set(["repo-visible"]),
    });

    expect(usage.get("row-oauth")).toEqual({
      reviews: [
        { targetKey: "reviews/visible", repositoryName: "acme/visible" },
      ],
      secretRepositories: [
        { repositoryName: "acme/visible", secretName: "ns-visible" },
      ],
      secretLevel: "profile",
    });
    expect(usage.get("row-mimo")).toEqual({
      reviews: [
        { targetKey: "reviews/visible", repositoryName: "acme/visible" },
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
      visibleRepositoryIds: new Set(["repo-hidden"]),
    });

    expect(usage.get("row-oauth")?.reviews).toEqual([
      { targetKey: "reviews/hidden", repositoryName: "acme/hidden" },
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
