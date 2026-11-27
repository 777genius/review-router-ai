import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createPrismaClient,
  type PrismaClient,
} from "@reviewrouter/platform-db";
import { PrismaRepositoryConnectionRepository } from "../infrastructure/prisma/prisma-repository-connection-repository";
import type { GitHubRepositorySnapshot } from "../domain/repository-connection";

const databaseUrl = process.env.REVIEW_ROUTER_TEST_DATABASE_URL;
const withDatabase = databaseUrl ? describe : describe.skip;

withDatabase("atomic inventory admission on PostgreSQL", () => {
  let prisma: PrismaClient;
  let store: PrismaRepositoryConnectionRepository;
  const prefix = `inventory-${randomUUID()}`;

  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (
      !/test|e2e/.test(url.pathname) ||
      !["localhost", "127.0.0.1", "::1"].includes(url.hostname)
    ) {
      throw new Error("inventory_test_database_must_be_disposable");
    }
    prisma = createPrismaClient({ databaseUrl: databaseUrl!, poolMax: 4 });
    store = new PrismaRepositoryConnectionRepository(prisma);
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.workspace.deleteMany({
      where: { id: { startsWith: prefix } },
    });
    await prisma.$disconnect();
  });

  async function fixture() {
    const workspaceId = `${prefix}-${randomUUID()}`;
    const githubId = BigInt(
      `0x${randomUUID().replaceAll("-", "").slice(0, 12)}`,
    );
    await prisma.workspace.create({
      data: { id: workspaceId, slug: workspaceId, name: workspaceId },
    });
    const installation = await prisma.gitHubInstallation.create({
      data: {
        workspaceId,
        githubInstallationId: githubId,
        accountLogin: "inventory-test",
        accountType: "Organization",
        repositorySelection: "all",
      },
    });
    const repository = (
      offset: bigint,
      name: string,
    ): GitHubRepositorySnapshot => ({
      githubRepositoryId: (githubId + offset).toString(),
      owner: "inventory-test",
      name,
      fullName: `inventory-test/${name}`,
      defaultBranch: "main",
      visibility: "private",
      archived: false,
      stargazersCount: 0,
    });
    return {
      installation,
      repository,
      sync: async (
        repositories: readonly GitHubRepositorySnapshot[],
        generation?: bigint,
      ) =>
        store.syncInstallationRepositories({
          githubInstallationId: githubId.toString(),
          repositories,
          syncedAt: new Date(),
          inventoryGeneration:
            generation ?? (await store.beginInstallationInventory()),
          syncPolicy: { maxRepositories: 2 },
        }),
      selected: () =>
        prisma.repositoryConnection.findMany({
          where: { installationId: installation.id, selected: true },
          orderBy: { externalRepositoryId: "asc" },
        }),
    };
  }

  it("keeps admitted repositories and removes only identities absent from the full inventory", async () => {
    const f = await fixture();
    const beta = f.repository(2n, "beta");
    const zeta = f.repository(3n, "zeta");
    const alpha = f.repository(1n, "alpha");
    await f.sync([beta, zeta]);
    const retained = await f.sync([alpha, beta, zeta]);
    expect(retained.skippedDueToLimit).toBe(1);
    expect((await f.selected()).map((row) => row.externalRepositoryId)).toEqual(
      [beta.githubRepositoryId, zeta.githubRepositoryId],
    );
    expect(
      await prisma.repositoryConnection.findUnique({
        where: { githubRepositoryId: BigInt(alpha.githubRepositoryId) },
      }),
    ).toBeNull();

    await f.sync([alpha, zeta]);
    expect((await f.selected()).map((row) => row.externalRepositoryId)).toEqual(
      [alpha.githubRepositoryId, zeta.githubRepositoryId],
    );
    expect(
      await prisma.repositoryConnection.findUnique({
        where: { githubRepositoryId: BigInt(beta.githubRepositoryId) },
      }),
    ).toMatchObject({ selected: false });
  });

  it("rejects stale inventory inserts for repositories that were never persisted", async () => {
    const f = await fixture();
    const stale = await store.beginInstallationInventory();
    const current = await store.beginInstallationInventory();
    const alpha = f.repository(1n, "alpha");
    const unseen = f.repository(2n, "unseen");
    await f.sync([alpha], current);
    expect(await f.sync([alpha, unseen], stale)).toMatchObject({
      upserted: 0,
      synchronizedRepositories: [],
    });
    expect(
      await prisma.repositoryConnection.findUnique({
        where: { githubRepositoryId: BigInt(unseen.githubRepositoryId) },
      }),
    ).toBeNull();
    expect(
      await prisma.gitHubInstallation.findUnique({
        where: { id: f.installation.id },
      }),
    ).toMatchObject({ inventoryGeneration: current });
  });

  it("serializes two inventories competing for one remaining quota slot", async () => {
    const f = await fixture();
    const admitted = f.repository(1n, "admitted");
    await f.sync([admitted]);
    const older = await store.beginInstallationInventory();
    const newer = await store.beginInstallationInventory();
    await Promise.all([
      f.sync(
        [admitted, f.repository(2n, "alpha"), f.repository(3n, "zeta")],
        older,
      ),
      f.sync(
        [admitted, f.repository(2n, "zeta"), f.repository(3n, "alpha")],
        newer,
      ),
    ]);
    const selected = await f.selected();
    expect(selected).toHaveLength(2);
    expect(
      selected.some(
        (row) => row.externalRepositoryId === admitted.githubRepositoryId,
      ),
    ).toBe(true);
    expect(
      await prisma.gitHubInstallation.findUnique({
        where: { id: f.installation.id },
      }),
    ).toMatchObject({ inventoryGeneration: newer });
  });
});
