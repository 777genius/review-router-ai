import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaRepositoryHealthRepository } from "@reviewrouter/features-repo-health";
import { PrismaSupportDiagnosticsRepository } from "@reviewrouter/features-support-diagnostics";
import { PrismaReviewPolicyHeadReader } from "@reviewrouter/features-review-config/composition";
import { createPrismaClient } from "@reviewrouter/platform-db";
import { createMigratedTestDatabase } from "../../../../packages/platform/db/src/postgres-test-fixture";
import {
  createObservedPrismaClient,
  type ObservedPostgresQuery,
} from "../../../../packages/platform/db/src/postgres-query-observer";

const adminUrl = process.env.RELIABILITY_TEST_POSTGRES_ADMIN_URL;

describe.skipIf(!adminUrl)("dashboard reads over real historical data", () => {
  let database: Awaited<ReturnType<typeof createMigratedTestDatabase>>;
  let observed: ReturnType<typeof createObservedPrismaClient>;
  const prefix = `dashboard-read-${randomUUID()}`;
  const workspaceId = `${prefix}-owned`;
  const otherWorkspaceId = `${prefix}-other`;
  const repositoryIds = Array.from(
    { length: 22 },
    (_, i) => `${prefix}-repo-${String(i).padStart(2, "0")}`,
  );
  const otherRepositoryIds = Array.from(
    { length: 10 },
    (_, i) => `${prefix}-foreign-${i}`,
  );
  const baseTime = new Date("2026-11-27T12:00:00.000Z");
  const headTime = new Date(baseTime.getTime() + 199);
  const tiedTime = new Date(baseTime.getTime() + 200);
  const futurePolicy = '{"future":[],"nullable":null}';

  beforeAll(async () => {
    database = await createMigratedTestDatabase(adminUrl!);
    observed = createObservedPrismaClient(database.databaseUrl);
    const { prisma } = observed;
    for (const [i, id] of [workspaceId, otherWorkspaceId].entries()) {
      await prisma.workspace.create({ data: { id, slug: id, name: id } });
      await prisma.gitHubInstallation.create({
        data: {
          id: `${id}-installation`,
          workspaceId: id,
          githubInstallationId: BigInt(80000 + i),
          accountLogin: id,
          accountType: "Organization",
          repositorySelection: "all",
        },
      });
    }
    const repositories = [
      ...repositoryIds.map((id, i) => ({
        id,
        workspaceId,
        installationId: i === 21 ? null : `${workspaceId}-installation`,
      })),
      ...otherRepositoryIds.map((id) => ({
        id,
        workspaceId: otherWorkspaceId,
        installationId: `${otherWorkspaceId}-installation`,
      })),
    ];
    await prisma.repositoryConnection.createMany({
      data: repositories.map((repository) => ({
        ...repository,
        externalRepositoryId: repository.id,
        owner: "fixture",
        name: repository.id,
        fullName: `fixture/${repository.id}`,
        defaultBranch: "main",
        visibility: "private",
      })),
    });
    const withHistory = repositories.filter(
      (repository) => !repositoryIds.slice(20).includes(repository.id),
    );
    for (const repository of withHistory) {
      await prisma.actionRunHealthReport.createMany({
        data: Array.from({ length: 200 }, (_, i) => ({
          id: `${repository.id}-health-${i}`,
          workspaceId: repository.workspaceId,
          repositoryId: repository.id,
          githubRunId: String(i),
          githubRunAttempt: "1",
          eventName: "pull_request",
          actionVersion: "fixture",
          configVersion: 1,
          configSource: "fixture",
          providerSetupState: "configured" as const,
          providerHealth: i === 199 ? ("degraded" as const) : ("ok" as const),
          safeErrorCategory: "none",
          findingCriticalCount: i,
          findingMajorCount: 2,
          findingMinorCount: 3,
          findingInfoCount: 4,
          inlineCommentCount: 5,
          summaryCommentCount: 1,
          receivedAt: new Date(baseTime.getTime() + i),
        })),
      });
    }
    const extraHealth = {
      workspaceId,
      repositoryId: repositoryIds[0]!,
      githubRunAttempt: "1",
      eventName: "pull_request",
      actionVersion: "fixture",
      configVersion: 1,
      configSource: "tied",
      providerSetupState: "stale_or_invalid" as const,
      providerHealth: "failed" as const,
      safeErrorCategory: "fixture",
      findingCriticalCount: 999,
      findingMajorCount: 2,
      findingMinorCount: 3,
      findingInfoCount: 4,
      inlineCommentCount: 5,
      summaryCommentCount: 1,
      receivedAt: tiedTime,
    };
    await prisma.actionRunHealthReport.createMany({
      data: [
        {
          ...extraHealth,
          id: `${prefix}-tie-a`,
          githubRunId: "tie-a",
          findingCriticalCount: 666,
        },
        { ...extraHealth, id: `${prefix}-tie-z`, githubRunId: "tie-z" },
        // Independent workspace/repository FKs permit this inconsistent stored row.
        // The read must keep both scopes inside SQL rather than leak its telemetry.
        {
          ...extraHealth,
          id: `${prefix}-foreign-health`,
          workspaceId: otherWorkspaceId,
          repositoryId: repositoryIds[1]!,
          githubRunId: "foreign",
          findingCriticalCount: 4242,
          receivedAt: new Date(baseTime.getTime() + 100_000),
        },
      ],
    });
    await prisma.workflowProvisioning.create({
      data: {
        workspaceId,
        repositoryId: repositoryIds[3]!,
        status: "configured",
        branch: "main",
        workflowPath: ".github/workflows/review.yml",
        actionVersion: "fixture",
      },
    });
    await prisma.auditEvent.createMany({
      data: Array.from({ length: 15 }, (_, i) => ({
        workspaceId,
        actor: "fixture",
        action: `fixture-${i}`,
        targetType: "repository",
        targetId: repositoryIds[0]!,
        metadata: {},
        createdAt: new Date(baseTime.getTime() + i),
      })),
    });
    const configurations = [
      {
        id: `${workspaceId}-configuration`,
        workspaceId,
        repositoryId: null,
        targetKey: "workspace:default",
        active: true,
      },
      ...withHistory.map((repository) => ({
        id: `${repository.id}-configuration`,
        workspaceId: repository.workspaceId,
        repositoryId: repository.id,
        targetKey: `repo:${repository.id}`,
        active: repository.id !== repositoryIds[19],
      })),
    ];
    await prisma.reviewConfiguration.createMany({ data: configurations });
    for (const configuration of configurations) {
      await prisma.reviewConfigurationVersion.createMany({
        data: Array.from({ length: 100 }, (_, i) => ({
          configurationId: configuration.id,
          workspaceId: configuration.workspaceId,
          version: i + 1,
          schemaVersion: 1,
          policyJson: null,
        })),
      });
    }
    await prisma.reviewConfiguration.create({
      data: {
        id: `${repositoryIds[20]}-configuration`,
        workspaceId,
        repositoryId: repositoryIds[20]!,
        targetKey: `repo:${repositoryIds[20]}`,
      },
    });
    await prisma.reviewConfigurationVersion.update({
      where: {
        configurationId_version: {
          configurationId: `${repositoryIds[2]}-configuration`,
          version: 100,
        },
      },
      data: { schemaVersion: 99, policyJson: futurePolicy },
    });
    await prisma.$executeRaw`ANALYZE "ActionRunHealthReport"`;
    await prisma.$executeRaw`ANALYZE "ReviewConfigurationVersion"`;
  }, 120_000);

  afterAll(async () => {
    await observed?.prisma.$disconnect();
    await database?.cleanup();
  });

  it("returns only the latest scoped health rows and preserves missing-report semantics", async () => {
    const { value, queries } = await observed.capture(() =>
      new PrismaRepositoryHealthRepository(
        observed.prisma,
      ).listWorkspaceHealthInputs(workspaceId),
    );
    expect(value.map((repository) => repository.repositoryId)).toEqual(
      repositoryIds.slice(0, 21),
    );
    for (const [i, repository] of value.entries()) {
      expect(repository).toMatchObject({
        githubInstallationId: "80000",
        setupStatus: i === 3 ? "configured" : "not_configured",
        latestProviderHealth: i === 20 ? null : i === 0 ? "failed" : "degraded",
        latestProviderSetupState:
          i === 20 ? null : i === 0 ? "stale_or_invalid" : "configured",
        latestActionHealthReceivedAt:
          i === 20 ? null : i === 0 ? tiedTime : headTime,
        latestActionHealthTelemetry:
          i === 20
            ? null
            : {
                configSource: i === 0 ? "tied" : "fixture",
                findingCounts: {
                  critical: i === 0 ? 999 : 199,
                  major: 2,
                  minor: 3,
                  info: 4,
                },
                commentCounts: { inline: 5, summary: 1 },
                skippedReasonCategory: null,
              },
      });
    }
    const historyReads = queries.filter((query) =>
      query.sql.includes('"ActionRunHealthReport"'),
    );
    expect(historyReads).toHaveLength(1);
    expect(historyReads[0]?.rows).toBe(20);
    expect(queries).toHaveLength(4);
    await expectIndexedRead(
      historyReads[0]!,
      "ActionRunHealthReport_workspace_repository_latest_idx",
    );
  });

  it("keeps support counters and recent audit actions while transferring one health row per repository", async () => {
    const { value, queries } = await observed.capture(() =>
      new PrismaSupportDiagnosticsRepository(
        observed.prisma,
      ).getWorkspaceDiagnosticsInput(workspaceId),
    );
    expect(value?.repositories).toHaveLength(22);
    for (const repository of value!.repositories) {
      const index = repositoryIds.indexOf(repository.id);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(repository.latestFindingCounts).toEqual(
        index >= 20
          ? null
          : {
              critical: index === 0 ? 999 : 199,
              major: 2,
              minor: 3,
              info: 4,
            },
      );
      expect(repository.latestCommentCounts).toEqual(
        index >= 20 ? null : { inline: 5, summary: 1 },
      );
    }
    expect(value?.recentAuditActions).toEqual(
      Array.from({ length: 10 }, (_, i) => `fixture-${14 - i}`),
    );
    expect(value?.workflowProvisioning).toEqual([{ status: "configured" }]);
    expect(value?.outboxStatusCounts).toEqual({});
    const historyReads = queries.filter((query) =>
      query.sql.includes('"ActionRunHealthReport"'),
    );
    expect(historyReads).toHaveLength(1);
    expect(historyReads[0]?.rows).toBe(20);
    expect(queries).toHaveLength(13);
  });

  it("loads scoped active policy heads with bounded rows and keeps unknown stored formats intact", async () => {
    const { value, queries } = await observed.capture(() =>
      PrismaReviewPolicyHeadReader.snapshot(
        observed.prisma,
      ).readWorkspacePolicyHeads(workspaceId),
    );
    expect(value.workspace).toEqual({
      version: 100,
      schemaVersion: 1,
      policyJson: null,
    });
    expect([...value.repositories.keys()]).toEqual(repositoryIds.slice(0, 19));
    for (const [id, head] of value.repositories) {
      expect(head).toEqual({
        version: 100,
        schemaVersion: id === repositoryIds[2] ? 99 : 1,
        policyJson: id === repositoryIds[2] ? futurePolicy : null,
      });
    }
    const versionReads = queries.filter((query) =>
      query.sql.includes('"ReviewConfigurationVersion"'),
    );
    expect(versionReads.map((query) => query.rows)).toEqual([1, 19]);
    expect(queries).toHaveLength(3);
    await expectIndexedRead(
      versionReads[1]!,
      "ReviewConfigurationVersion_configurationId_version_key",
    );
  });

  it("ignores foreign, missing and repeated requested repository IDs without losing valid heads", async () => {
    const heads = PrismaReviewPolicyHeadReader.snapshot(observed.prisma);
    const result = await heads.readRepositoryPolicyHeads({
      workspaceId,
      repositoryIds: [
        repositoryIds[0]!,
        otherRepositoryIds[0]!,
        repositoryIds[20]!,
        repositoryIds[0]!,
      ],
    });
    expect([...result.repositories]).toEqual([
      [repositoryIds[0], { version: 100, schemaVersion: 1, policyJson: null }],
    ]);
    const empty = await observed.capture(() =>
      heads.readRepositoryPolicyHeads({ workspaceId, repositoryIds: [] }),
    );
    expect(empty.value.repositories.size).toBe(0);
    expect(empty.queries).toHaveLength(2);
    expect(empty.queries.some((query) => query.sql.includes("LATERAL"))).toBe(
      false,
    );
  });

  it("does not broaden an absent workspace into a health-history read", async () => {
    const health = await observed.capture(() =>
      new PrismaRepositoryHealthRepository(
        observed.prisma,
      ).listWorkspaceHealthInputs(`${prefix}-absent`),
    );
    expect(health.value).toEqual([]);
    expect(health.queries.length).toBeLessThanOrEqual(3);
    expect(health.queries.every((query) => query.rows === 0)).toBe(true);
    expect(
      health.queries.some((query) =>
        query.sql.includes('"ActionRunHealthReport"'),
      ),
    ).toBe(false);
    const diagnostics = await observed.capture(() =>
      new PrismaSupportDiagnosticsRepository(
        observed.prisma,
      ).getWorkspaceDiagnosticsInput(`${prefix}-absent`),
    );
    expect(diagnostics.value).toBeNull();
    expect(diagnostics.queries.length).toBeLessThanOrEqual(6);
    expect(diagnostics.queries.every((query) => query.rows === 0)).toBe(true);
    expect(
      diagnostics.queries.some((query) =>
        query.sql.includes('"ActionRunHealthReport"'),
      ),
    ).toBe(false);
  });

  it("keeps raw latest-head reads in the caller's RepeatableRead snapshot during a concurrent append", async () => {
    const writer = createPrismaClient({
      databaseUrl: database.databaseUrl,
      poolMax: 1,
    });
    try {
      const heads = await observed.prisma.$transaction(
        async (transaction) => {
          await transaction.$queryRaw`SELECT "id" FROM "Workspace" WHERE "id" = ${workspaceId}`;
          await writer.reviewConfigurationVersion.createMany({
            data: [
              {
                configurationId: `${workspaceId}-configuration`,
                workspaceId,
                version: 101,
                schemaVersion: 1,
              },
              {
                configurationId: `${repositoryIds[0]}-configuration`,
                workspaceId,
                version: 101,
                schemaVersion: 1,
              },
            ],
          });
          return new PrismaReviewPolicyHeadReader(
            transaction,
          ).readRepositoryPolicyHeads({
            workspaceId,
            repositoryIds: [repositoryIds[0]!],
          });
        },
        { isolationLevel: "RepeatableRead" },
      );
      expect(heads.workspace?.version).toBe(100);
      expect(heads.repositories.get(repositoryIds[0]!)?.version).toBe(100);
      const current = await PrismaReviewPolicyHeadReader.snapshot(
        observed.prisma,
      ).readRepositoryPolicyHeads({
        workspaceId,
        repositoryIds: [repositoryIds[0]!],
      });
      expect(current.workspace?.version).toBe(101);
      expect(current.repositories.get(repositoryIds[0]!)?.version).toBe(101);
    } finally {
      await writer.$disconnect();
    }
  });

  async function expectIndexedRead(
    query: ObservedPostgresQuery,
    index: string,
  ) {
    const plan = await observed.prisma.$queryRawUnsafe<
      { "QUERY PLAN": { Plan: PlanNode }[] }[]
    >(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query.sql}`, ...query.args);
    expect(planIndexes(plan[0]!["QUERY PLAN"][0]!.Plan)).toContain(index);
  }
});

type PlanNode = {
  readonly "Index Name"?: string;
  readonly Plans?: readonly PlanNode[];
};
function planIndexes(plan: PlanNode): string[] {
  return [
    ...(plan["Index Name"] ? [plan["Index Name"]] : []),
    ...(plan.Plans ?? []).flatMap(planIndexes),
  ];
}
