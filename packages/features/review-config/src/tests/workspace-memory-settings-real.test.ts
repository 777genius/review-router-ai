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
import {
  PrismaReviewConfigurationRepository,
  PrismaReviewConfigurationTransactionRepository,
} from "../infrastructure/prisma/prisma-review-configuration-repository";
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
      // A generic workspace policy replacement must not silently reset the
      // separately managed memory confirmation setting.
      await saveWorkspaceMemorySettings(
        {
          workspaceId,
          actor: owner,
          requireConfirmation: true,
          expectedVersion: 3,
        },
        dependencies(),
      );
      await dependencies().configurations.saveNextVersions({
        workspaceId,
        writes: [
          {
            target: { scope: "workspace", workspaceId },
            policy: defaultWorkspaceReviewPolicy(),
            expectedVersion: 4,
          },
        ],
        selectionAuthority: providerSelectionAuthority({ actor: owner }),
      });
      await expect(reader.read(workspaceId)).resolves.toEqual({
        requireConfirmation: true,
        version: 5,
      });
    });
    it("holds an admission reader's workspace guard until its caller commits, then allows the real settings writer", async () => {
      await prisma.workspaceMember.create({
        data: {
          workspaceId: otherWorkspaceId,
          userId: owner.userId,
          role: "owner",
        },
      });
      const reader = new PrismaWorkspaceMemorySettings(prisma);
      const writerClient = createPrismaClient({
        databaseUrl: databaseUrl!,
        poolMax: 2,
      });
      let release!: () => void;
      const holdReader = new Promise<void>((resolve) => {
        release = resolve;
      });
      let ready!: () => void;
      const readerReady = new Promise<void>((resolve) => {
        ready = resolve;
      });
      let writerStarted!: (pid: number) => void;
      const writerReady = new Promise<number>((resolve) => {
        writerStarted = resolve;
      });
      const admission = prisma.$transaction(
        async (transaction) => {
          const settings = await reader.read(otherWorkspaceId, transaction);
          expect(settings).toEqual({
            requireConfirmation: false,
            version: null,
          });
          ready();
          await holdReader;
          return reader.read(otherWorkspaceId, transaction);
        },
        { timeout: 15_000 },
      );
      let write: ReturnType<typeof saveWorkspaceMemorySettings> | undefined;
      try {
        await Promise.race([
          readerReady,
          admission.then(() => {
            throw new Error("settings_reader_closed_before_barrier");
          }),
        ]);
        write = writerClient.$transaction(
          async (transaction) => {
            const [backend] = await transaction.$queryRaw<
              readonly { pid: number }[]
            >`SELECT pg_backend_pid() AS pid`;
            writerStarted(backend!.pid);
            return saveWorkspaceMemorySettings(
              {
                workspaceId: otherWorkspaceId,
                actor: owner,
                requireConfirmation: true,
                expectedVersion: null,
              },
              {
                configurations:
                  new PrismaReviewConfigurationTransactionRepository(
                    transaction,
                    undefined,
                    false,
                    owner.userId,
                  ),
                policyHeads: new PrismaReviewPolicyHeadReader(transaction),
              },
            );
          },
          { isolationLevel: "Serializable" },
        );
        // Attach immediately; preserve the actual result for the assertion below.
        void write.catch(() => {});
        const writerPid = await Promise.race([
          writerReady,
          write.then(() => {
            throw new Error("settings_writer_closed_before_barrier");
          }),
        ]);
        await expect
          .poll(
            async () =>
              (
                await prisma.$queryRaw<readonly { count: number }[]>`
            SELECT count(*)::int AS count FROM pg_stat_activity
            WHERE datname = current_database() AND pid = ${writerPid}
              AND wait_event_type = 'Lock' AND wait_event = 'advisory'`
              )[0]?.count,
            { timeout: 5_000, interval: 20 },
          )
          .toBe(1);
        await expect(reader.read(otherWorkspaceId)).resolves.toEqual({
          requireConfirmation: false,
          version: null,
        });
        release();
        await expect(admission).resolves.toEqual({
          requireConfirmation: false,
          version: null,
        });
        await expect(write).resolves.toMatchObject({ version: 1 });
        await expect(reader.read(otherWorkspaceId)).resolves.toEqual({
          requireConfirmation: true,
          version: 1,
        });
      } finally {
        release();
        await Promise.allSettled([admission, ...(write ? [write] : [])]);
        await writerClient.$disconnect();
      }
    });
  },
);
