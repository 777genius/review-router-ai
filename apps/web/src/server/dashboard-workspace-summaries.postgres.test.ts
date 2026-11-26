import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createPrismaClient,
  type PrismaClient,
} from "@reviewrouter/platform-db";
import { createDashboardWorkspaceSummaryLoader } from "./dashboard-workspace-summaries";
import { selectDashboardWorkspace } from "./dashboard-workspace-model";

const databaseUrl = process.env.REVIEW_ROUTER_TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)(
  "explicit workspace selection on PostgreSQL",
  () => {
    const prefix = `workspace-selection-${randomUUID()}`;
    const ids = Array.from({ length: 11 }, (_, index) => `${prefix}-${index}`);
    const scope = { kind: "workspace_ids" as const, workspaceIds: ids };
    const access = {
      status: "ready" as const,
      workspaceIds: [],
      repositoryIds: new Set<string>(),
      directConfigRepositoryIds: new Set<string>(),
      checkedAt: null,
    };
    let prisma: PrismaClient;
    let load: ReturnType<typeof createDashboardWorkspaceSummaryLoader>;
    beforeAll(async () => {
      const url = new URL(databaseUrl!);
      if (
        !/test|e2e/u.test(url.pathname) ||
        !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
      )
        throw new Error("workspace_selection_test_database_must_be_disposable");
      prisma = createPrismaClient({ databaseUrl: databaseUrl!, poolMax: 2 });
      load = createDashboardWorkspaceSummaryLoader({ getPrisma: () => prisma });
      await prisma.workspace.createMany({
        data: [...ids, `${prefix}-foreign`].map((id, index) => ({
          id,
          slug: id,
          name: `Workspace ${index}`,
          createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)),
        })),
      });
    });
    afterAll(async () => {
      await prisma?.workspace.deleteMany({
        where: { id: { startsWith: prefix } },
      });
      await prisma?.$disconnect();
    });

    it("opens the authorized old workspace beyond ten summaries and denies an existing foreign ID", async () => {
      const recent = await load(scope, access);
      expect(recent).toHaveLength(10);
      expect(recent.some((item) => item.workspace.id === ids[0])).toBe(false);
      const requested = await load(scope, access, { workspaceKey: ids[0]! });
      expect(
        selectDashboardWorkspace([...recent, ...requested], ids[0]!)?.workspace
          .id,
      ).toBe(ids[0]);
      const forbidden = await load(scope, access, {
        workspaceKey: `${prefix}-foreign`,
      });
      expect(forbidden).toEqual([]);
      expect(
        selectDashboardWorkspace(
          [...recent, ...forbidden],
          `${prefix}-foreign`,
        ),
      ).toBeNull();
      expect(selectDashboardWorkspace(recent, "")).not.toBeNull();
    });

    it("resolves an old installation URL while keeping installation projection bounded", async () => {
      const baseId = BigInt(
        `0x${randomUUID().replaceAll("-", "").slice(0, 12)}`,
      );
      await prisma.gitHubInstallation.createMany({
        data: Array.from({ length: 4 }, (_, index) => ({
          id: `${prefix}-installation-${index}`,
          workspaceId: ids[0]!,
          githubInstallationId: baseId + BigInt(index),
          accountLogin: `${prefix}-account-${index}`,
          accountType: "Organization",
          repositorySelection: "all",
          updatedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)),
        })),
      });
      const requested = await load(scope, access, {
        installationId: baseId.toString(),
      });
      expect(
        selectDashboardWorkspace(requested, "", baseId.toString())?.workspace
          .id,
      ).toBe(ids[0]);
      expect(requested[0]?.workspace.installations).toHaveLength(4);
      const byAccount = await load(scope, access, {
        workspaceKey: `${prefix}-account-0`,
      });
      expect(
        selectDashboardWorkspace(byAccount, `${prefix}-account-0`)?.workspace
          .id,
      ).toBe(ids[0]);
    });
  },
);
