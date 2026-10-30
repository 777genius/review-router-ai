import { randomUUID } from "node:crypto";
import {
  createPrismaClient,
  type PrismaClient,
} from "@reviewrouter/platform-db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { saveWorkspaceMemorySettings } from "../application/use-cases/manage-workspace-memory-settings";
import {
  saveWorkspaceReviewSettings,
  providerSelectionAuthority,
} from "../application/use-cases/manage-provider-selections";
import {
  defaultWorkspaceReviewPolicy,
  effectiveReviewSettings,
} from "../domain/review-policy-document";
import { PrismaReviewConfigurationRepository } from "../infrastructure/prisma/prisma-review-configuration-repository";
import { PrismaReviewPolicyHeadReader } from "../infrastructure/prisma/prisma-review-policy-head-reader";
import { PrismaWorkspaceMemorySettings } from "../infrastructure/prisma/prisma-workspace-memory-settings";

const databaseUrl = process.env.REVIEW_ROUTER_TEST_DATABASE_URL;
(databaseUrl ? describe : describe.skip)(
  "workspace memory settings PostgreSQL authority",
  () => {
    let prisma: PrismaClient;
    const prefix = `memory-settings-${randomUUID()}`;
    const workspaceId = `${prefix}-workspace`;
    const otherWorkspaceId = `${prefix}-other`;
    const owner = {
      userId: `${prefix}-owner`,
      auditActor: "user:memory-owner",
    };
    const member = {
      userId: `${prefix}-member`,
      auditActor: "user:memory-member",
    };
    const dependencies = () => ({
      configurations: new PrismaReviewConfigurationRepository(
        prisma,
        undefined,
        false,
        owner.userId,
      ),
      policyHeads: new PrismaReviewPolicyHeadReader(prisma),
      validator: { validate: async () => {} },
    });
    beforeAll(async () => {
      prisma = createPrismaClient({ databaseUrl: databaseUrl! });
      for (const id of [workspaceId, otherWorkspaceId])
        await prisma.workspace.create({ data: { id, slug: id, name: id } });
      for (const actor of [owner, member])
        await prisma.user.create({ data: { id: actor.userId } });
      await prisma.workspaceMember.createMany({
        data: [
          { workspaceId, userId: owner.userId, role: "owner" },
          { workspaceId, userId: member.userId, role: "member" },
        ],
      });
    });
    afterAll(async () => {
      await prisma.workspace.deleteMany({
        where: { id: { in: [workspaceId, otherWorkspaceId] } },
      });
      await prisma.user.deleteMany({
        where: { id: { in: [owner.userId, member.userId] } },
      });
      await prisma.$disconnect();
    });
    it("persists only this workspace, rejects a current non-admin and stale CAS, and preserves the setting during other saves", async () => {
      const reader = new PrismaWorkspaceMemorySettings(prisma);
      await expect(reader.read(workspaceId)).resolves.toEqual({
        requireConfirmation: false,
        version: null,
      });
      await saveWorkspaceMemorySettings(
        {
          workspaceId,
          actor: owner,
          requireConfirmation: true,
          expectedVersion: null,
        },
        dependencies(),
      );
      await expect(reader.read(workspaceId)).resolves.toEqual({
        requireConfirmation: true,
        version: 1,
      });
      await expect(reader.read(otherWorkspaceId)).resolves.toEqual({
        requireConfirmation: false,
        version: null,
      });
      await expect(
        saveWorkspaceMemorySettings(
          {
            workspaceId,
            actor: member,
            requireConfirmation: false,
            expectedVersion: 1,
          },
          dependencies(),
        ),
      ).rejects.toThrow("workspace_admin_required");
      // Omitting the field must not let a member reset it to automatic either.
      await expect(
        dependencies().configurations.saveNextVersions({
          workspaceId,
          writes: [
            {
              target: { scope: "workspace", workspaceId },
              policy: defaultWorkspaceReviewPolicy(),
              expectedVersion: 1,
            },
          ],
          selectionAuthority: providerSelectionAuthority({ actor: member }),
        }),
      ).rejects.toThrow("workspace_admin_required");
      await expect(
        saveWorkspaceMemorySettings(
          {
            workspaceId,
            actor: owner,
            requireConfirmation: false,
            expectedVersion: null,
          },
          dependencies(),
        ),
      ).rejects.toThrow("review_configuration_write_conflict");
      // An actor read as owner earlier is checked again against the locked member row.
      await prisma.workspaceMember.update({
        where: { workspaceId_userId: { workspaceId, userId: owner.userId } },
        data: { role: "member" },
      });
      await expect(
        saveWorkspaceMemorySettings(
          {
            workspaceId,
            actor: owner,
            requireConfirmation: false,
            expectedVersion: 1,
          },
          dependencies(),
        ),
      ).rejects.toThrow("workspace_admin_required");
      await prisma.workspaceMember.update({
        where: { workspaceId_userId: { workspaceId, userId: owner.userId } },
        data: { role: "owner" },
      });
      await saveWorkspaceReviewSettings(
        {
          workspaceId,
          actor: owner,
          settings: {
            ...effectiveReviewSettings(defaultWorkspaceReviewPolicy(), null),
            reviewLanguage: "fr",
          },
          expectedVersion: 1,
        },
        dependencies(),
      );
      await expect(reader.read(workspaceId)).resolves.toEqual({
        requireConfirmation: true,
        version: 2,
      });
      expect(
        await prisma.auditEvent.count({
          where: { workspaceId, action: "workspace.memory_settings_saved" },
        }),
      ).toBe(1);
      await saveWorkspaceMemorySettings(
        {
          workspaceId,
          actor: owner,
          requireConfirmation: false,
          expectedVersion: 2,
        },
        dependencies(),
      );
      await expect(reader.read(workspaceId)).resolves.toEqual({
        requireConfirmation: false,
        version: 3,
      });
      expect(
        (
          await dependencies().policyHeads.readPolicyHeads({
            scope: "workspace",
            workspaceId,
          })
        ).workspace?.policyJson,
      ).toContain('"reviewLanguage":"fr"');
    });
  },
);
