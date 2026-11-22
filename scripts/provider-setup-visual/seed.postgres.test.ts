import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createPrismaClient,
  type PrismaClient,
} from "../../packages/platform/db/src/index";
import {
  entriesOf,
  VISUAL_CONNECTIONS,
  VISUAL_PROFILES,
  VISUAL_REPOSITORIES,
  VISUAL_USERS,
  VISUAL_WORKSPACES,
} from "./fixture-contract";
import { resetFixtureRows, seedProviderSetupVisualFixtures } from "./seed";
import { VISUAL_NATIVE_PROFILE } from "./native-catalog-fixture";
import { prepareNativeVisibilityAccounts } from "./native-visibility-flow";

const databaseUrl = process.env.REVIEW_ROUTER_TEST_DATABASE_URL;
const databaseTests = databaseUrl ? describe : describe.skip;

// The screenshots are only as trustworthy as the data behind them: every
// repository must resolve as the contract says, through the production use
// cases, and a rerun after any earlier run must rebuild the same data set.
databaseTests("provider setup visual seed", () => {
  let prisma: PrismaClient;
  const workspaceIds = entriesOf(VISUAL_WORKSPACES).map(([, item]) => item.id);
  const where = { workspaceId: { in: workspaceIds } };

  /** The data set without generated IDs and timestamps. */
  async function snapshot() {
    const profileIds = new Map(
      (
        await prisma.workspaceProviderProfile.findMany({
          where,
          select: { id: true, label: true },
        })
      ).map((row) => [row.id, row.label]),
    );
    return {
      profiles: await prisma.workspaceProviderProfile.findMany({
        where,
        orderBy: { label: "asc" },
        select: {
          workspaceId: true,
          label: true,
          credentialKind: true,
          authMode: true,
          model: true,
          createdByUserId: true,
          archivedAt: true,
        },
      }),
      heads: (
        await prisma.reviewConfigurationVersion.findMany({
          where,
          orderBy: [{ workspaceId: "asc" }, { version: "asc" }],
          select: {
            workspaceId: true,
            version: true,
            schemaVersion: true,
            policyJson: true,
            configuration: { select: { targetKey: true } },
          },
        })
      ).map((row) => ({
        ...row,
        // Selections name profiles by generated ID; compare their labels.
        policyJson:
          row.policyJson?.replace(
            /"profileId":"([^"]+)"/g,
            (_match, id: string) => `"profile":"${profileIds.get(id) ?? id}"`,
          ) ?? null,
      })),
      provisioning: await prisma.workflowProvisioning.findMany({
        where,
        orderBy: { repositoryId: "asc" },
        select: {
          repositoryId: true,
          status: true,
          attemptWorkflowRequirement: true,
          installedWorkflowRequirement: true,
        },
      }),
      secrets: await prisma.providerSetupState.findMany({
        where,
        orderBy: { repositoryId: "asc" },
        select: { repositoryId: true, providerKind: true, state: true },
      }),
      accessRights: await prisma.workspace.findMany({
        where: { id: { in: workspaceIds } },
        orderBy: { id: "asc" },
        select: { id: true, providerManagementAdminOnly: true },
      }),
      audit: await prisma.auditEvent.groupBy({
        by: ["action"],
        where,
        orderBy: { action: "asc" },
        _count: { _all: true },
      }),
    };
  }

  beforeAll(() => {
    prisma = createPrismaClient({ databaseUrl: databaseUrl!, poolMax: 4 });
  });

  afterAll(async () => {
    if (!prisma) return;
    await resetFixtureRows(prisma);
    await prisma.$disconnect();
  });

  it("resolves every repository as the contract says and reruns identically", async () => {
    const flags = { rotating: true, personalSharing: true };
    const first = await seedProviderSetupVisualFixtures(prisma, flags);
    const before = await snapshot();
    const second = await seedProviderSetupVisualFixtures(prisma, flags);
    expect(await snapshot()).toEqual(before);
    expect(second.repositories).toEqual(first.repositories);

    expect(
      Object.fromEntries(
        second.repositories.map((item) => [
          item.key,
          item.configStatus === "ready"
            ? { status: item.configStatus, authMode: item.authMode }
            : { status: item.configStatus },
        ]),
      ),
    ).toEqual(
      Object.fromEntries(
        entriesOf(VISUAL_REPOSITORIES).map(([key, item]) => [
          key,
          item.expected.config,
        ]),
      ),
    );
    // Creator rules on screen depend on who created each provider.
    expect(
      Object.fromEntries(
        before.profiles.map((row) => [row.label, row.createdByUserId]),
      ),
    ).toEqual(
      Object.fromEntries(
        entriesOf(VISUAL_PROFILES).map(([, item]) => [
          item.label,
          VISUAL_USERS[item.createdBy].id,
        ]),
      ),
    );
    expect(before.accessRights).toEqual(
      entriesOf(VISUAL_WORKSPACES)
        .map(([, item]) => ({
          id: item.id,
          providerManagementAdminOnly: item.providerManagementAdminOnly,
        }))
        .sort((left, right) => left.id.localeCompare(right.id)),
    );
    // The workflow of this repository was rendered for the workspace default.
    const update = before.provisioning.find(
      (row) => row.repositoryId === VISUAL_REPOSITORIES.mainWorkflowUpdate.id,
    );
    expect(update?.installedWorkflowRequirement).not.toBe(
      update?.attemptWorkflowRequirement,
    );
  }, 120_000);

  it("leaves rotating Codex out of a run with the flag off", async () => {
    const result = await seedProviderSetupVisualFixtures(prisma, {
      rotating: false,
      personalSharing: true,
    });
    expect(result.profileIds.rotating).toBeUndefined();
    expect(
      await prisma.repositoryConnection.count({
        where: { id: VISUAL_REPOSITORIES.mainRotating.id },
      }),
    ).toBe(0);
  }, 120_000);

  it("prepares native visibility through the SQL revision guard without changing ownership or bindings", async () => {
    await seedProviderSetupVisualFixtures(prisma, {
      rotating: false,
      personalSharing: true,
    });
    const before = await prisma.providerAccountConnection.findMany({
      orderBy: { id: "asc" },
    });
    expect(
      before.filter(
        (row) =>
          row.id === VISUAL_CONNECTIONS.adminPersonal.id ||
          row.id === VISUAL_CONNECTIONS.mainOrg.id,
      ),
    ).toHaveLength(2);
    const bindings = await prisma.workspaceAccountBinding.findMany({
      orderBy: { id: "asc" },
    });
    await prepareNativeVisibilityAccounts(prisma);
    const after = await prisma.providerAccountConnection.findMany({
      orderBy: { id: "asc" },
    });
    expect(after).toEqual(
      before.map((row) => {
        const label =
          row.id === VISUAL_CONNECTIONS.adminPersonal.id
            ? "Native personal connection"
            : row.id === VISUAL_CONNECTIONS.mainOrg.id
              ? "Native workspace connection"
              : undefined;
        return label
          ? {
              ...row,
              profileRef: VISUAL_NATIVE_PROFILE,
              displayName: label,
              metadataRevision: row.metadataRevision + 1,
              updatedAt: expect.any(Date),
            }
          : row;
      }),
    );
    expect(
      await prisma.workspaceAccountBinding.findMany({
        orderBy: { id: "asc" },
      }),
    ).toEqual(bindings);
  }, 120_000);

  it("reruns after dynamic fixture-owned accounts without touching other owners", async () => {
    const flags = { rotating: false, personalSharing: true };
    await seedProviderSetupVisualFixtures(prisma, flags);
    const before = await snapshot();
    // Similar names and the same native profile do not make these fixture rows.
    const foreignUser = await prisma.user.create({
      data: { id: "rr-visual-user-foreign-reseed" },
    });
    const foreignWorkspace = await prisma.workspace.create({
      data: {
        id: "rr-visual-ws-foreign-reseed",
        slug: "rr-visual-foreign-reseed",
        name: "Foreign reseed control",
        personalOwnerUserId: foreignUser.id,
      },
    });
    const createdIds: string[] = [];
    try {
      for (const owner of [
        {
          ownerWorkspaceId: VISUAL_WORKSPACES.main.id,
          bindingWorkspaceId: VISUAL_WORKSPACES.main.id,
        },
        {
          ownerUserId: VISUAL_USERS.admin.id,
          bindingWorkspaceId: VISUAL_WORKSPACES.adminPersonal.id,
        },
        {
          ownerWorkspaceId: foreignWorkspace.id,
          bindingWorkspaceId: foreignWorkspace.id,
        },
        {
          ownerUserId: foreignUser.id,
          bindingWorkspaceId: foreignWorkspace.id,
        },
      ]) {
        // The browser creates generated connection IDs, outside VISUAL_CONNECTIONS.
        // No retained personal-operation journal is created or removed here.
        const connection = await prisma.providerAccountConnection.create({
          data: {
            ownerWorkspaceId: owner.ownerWorkspaceId ?? null,
            ownerUserId: owner.ownerUserId ?? null,
            gatewayAccountRef: `rr-visual-dynamic-reseed-${createdIds.length}`,
            profileRef: VISUAL_NATIVE_PROFILE,
            displayName: "Dynamic native connection",
            state: "active",
            bindings: {
              create: {
                workspaceId: owner.bindingWorkspaceId,
                state: "active",
              },
            },
          },
        });
        createdIds.push(connection.id);
      }
      const fixtureIds = createdIds.slice(0, 2);
      const foreignIds = createdIds.slice(2);
      const foreignConnections =
        await prisma.providerAccountConnection.findMany({
          where: { id: { in: foreignIds } },
          orderBy: { id: "asc" },
          include: { bindings: true },
        });
      for (let attempt = 0; attempt < 2; attempt += 1) {
        await seedProviderSetupVisualFixtures(prisma, flags);
        expect(await snapshot()).toEqual(before);
        expect(
          await prisma.providerAccountConnection.count({
            where: { id: { in: fixtureIds } },
          }),
        ).toBe(0);
        expect(
          await prisma.workspaceAccountBinding.count({
            where: { connectionId: { in: fixtureIds } },
          }),
        ).toBe(0);
        expect(
          await prisma.providerAccountConnection.findMany({
            where: { id: { in: foreignIds } },
            orderBy: { id: "asc" },
            include: { bindings: true },
          }),
        ).toEqual(foreignConnections);
        expect(
          await prisma.workspace.findUnique({
            where: { id: foreignWorkspace.id },
          }),
        ).toEqual(foreignWorkspace);
        expect(
          await prisma.user.findUnique({ where: { id: foreignUser.id } }),
        ).toEqual(foreignUser);
      }
    } finally {
      // Only this test's exact rows, including the red-path generated IDs.
      await prisma.workspaceAccountBinding.deleteMany({
        where: { connectionId: { in: createdIds } },
      });
      await prisma.providerAccountConnection.deleteMany({
        where: { id: { in: createdIds } },
      });
      await prisma.workspace.delete({ where: { id: foreignWorkspace.id } });
      await prisma.user.delete({ where: { id: foreignUser.id } });
    }
  }, 120_000);
});
