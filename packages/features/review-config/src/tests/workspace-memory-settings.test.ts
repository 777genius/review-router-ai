import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { saveWorkspaceMemorySettings } from "../application/use-cases/manage-workspace-memory-settings";
import { saveWorkspaceReviewSettings } from "../application/use-cases/manage-provider-selections";
import type { ReviewConfigurationRepositoryPort } from "../application/ports/review-configuration-repository-port";
import {
  defaultWorkspaceReviewPolicy,
  effectiveReviewSettings,
  parseRepositoryReviewPolicy,
} from "../domain/review-policy-document";
import { PrismaWorkspaceMemorySettings } from "../infrastructure/prisma/prisma-workspace-memory-settings";
import { InMemoryReviewConfigurationRepository } from "./in-memory-review-configuration";

const actor = { userId: "owner", auditActor: "user:owner" };
function fixture() {
  const store = new InMemoryReviewConfigurationRepository();
  const save = vi.fn(
    async (
      input: Parameters<
        ReviewConfigurationRepositoryPort["saveNextVersions"]
      >[0],
    ) =>
      store.saveNextVersions({
        workspaceId: input.workspaceId,
        writes: input.writes,
      }),
  );
  return {
    store,
    save,
    dependencies: {
      policyHeads: store,
      configurations: {
        saveNextVersions: save,
      } as unknown as ReviewConfigurationRepositoryPort,
      validator: { validate: vi.fn() },
    },
  };
}

describe("workspace-wide memory confirmation settings", () => {
  it("creates a provider-free workspace document and rejects stale updates", async () => {
    const f = fixture();
    await saveWorkspaceMemorySettings(
      {
        workspaceId: "w",
        actor,
        requireConfirmation: true,
        expectedVersion: null,
      },
      f.dependencies,
    );
    expect(
      (await f.store.readPolicyHeads({ scope: "workspace", workspaceId: "w" }))
        .workspace?.policyJson,
    ).toContain('"requireConfirmation":true');
    await expect(
      saveWorkspaceMemorySettings(
        {
          workspaceId: "w",
          actor,
          requireConfirmation: false,
          expectedVersion: null,
        },
        f.dependencies,
      ),
    ).rejects.toThrow("review_configuration_write_conflict");
    const authority = f.save.mock.calls[0]![0].selectionAuthority!;
    expect(() =>
      authority.authorize({
        actor: { userId: "member", role: "member" },
        workspace: {
          personalOwnerUserId: null,
          providerManagementAdminOnly: false,
        },
        target: { scope: "workspace", workspaceId: "w" },
        profiles: [],
      }),
    ).toThrow("provider_management_forbidden:workspace_admin_required");
  });

  it("preserves other settings on toggle and preserves the toggle on normal settings saves", async () => {
    const f = fixture();
    await f.store.saveNextVersions({
      workspaceId: "w",
      writes: [
        {
          target: { scope: "workspace", workspaceId: "w" },
          policy: { ...defaultWorkspaceReviewPolicy(), reviewLanguage: "fr" },
        },
      ],
    });
    await saveWorkspaceMemorySettings(
      {
        workspaceId: "w",
        actor,
        requireConfirmation: true,
        expectedVersion: 1,
      },
      f.dependencies,
    );
    const head = (
      await f.store.readPolicyHeads({ scope: "workspace", workspaceId: "w" })
    ).workspace!;
    expect(JSON.parse(head.policyJson!)).toMatchObject({
      reviewLanguage: "fr",
      memory: { requireConfirmation: true },
    });
    const settings = {
      ...effectiveReviewSettings(defaultWorkspaceReviewPolicy(), null),
      reviewLanguage: "de" as const,
    };
    await saveWorkspaceReviewSettings(
      { workspaceId: "w", actor, settings, expectedVersion: 2 },
      f.dependencies,
    );
    const next = (
      await f.store.readPolicyHeads({ scope: "workspace", workspaceId: "w" })
    ).workspace!;
    expect(JSON.parse(next.policyJson!)).toMatchObject({
      reviewLanguage: "de",
      memory: { requireConfirmation: true },
    });
    // Memory behavior stays workspace-owned, outside materialized review DTOs.
    expect(
      effectiveReviewSettings(JSON.parse(next.policyJson!), null),
    ).not.toHaveProperty("memory");
    expect(() =>
      parseRepositoryReviewPolicy({
        schemaVersion: 4,
        memory: { requireConfirmation: false },
      }),
    ).toThrow();
  });

  it("reads fresh workspace heads with automatic defaults and fails closed on unreadable settings", async () => {
    const findUnique = vi.fn();
    const reader = new PrismaWorkspaceMemorySettings({
      reviewConfiguration: { findUnique },
    } as unknown as PrismaClient);
    findUnique.mockResolvedValueOnce(null);
    await expect(reader.read("w")).resolves.toEqual({
      requireConfirmation: false,
      version: null,
    });
    findUnique.mockResolvedValueOnce({
      versions: [
        {
          version: 3,
          schemaVersion: 4,
          policyJson: JSON.stringify(defaultWorkspaceReviewPolicy()),
        },
      ],
    });
    await expect(reader.read("w")).resolves.toEqual({
      requireConfirmation: false,
      version: 3,
    });
    findUnique.mockResolvedValueOnce({
      versions: [
        {
          version: 4,
          schemaVersion: 4,
          policyJson: JSON.stringify({
            ...defaultWorkspaceReviewPolicy(),
            memory: { requireConfirmation: true },
          }),
        },
      ],
    });
    await expect(reader.read("w")).resolves.toEqual({
      requireConfirmation: true,
      version: 4,
    });
    findUnique.mockResolvedValueOnce({
      versions: [
        {
          version: 5,
          schemaVersion: 4,
          policyJson: '{"memory":{"requireConfirmation":"false"}}',
        },
      ],
    });
    await expect(reader.read("w")).rejects.toThrow(
      "review_policy_resave_required",
    );
    expect(findUnique).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: {
          workspaceId_targetKey: {
            workspaceId: "w",
            targetKey: "workspace:default",
          },
          active: true,
        },
      }),
    );
  });
});
