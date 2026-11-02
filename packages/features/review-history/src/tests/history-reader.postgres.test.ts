import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaHistoryReader } from "../adapters/outbound/prisma-history-reader.js";
import {
  HistoryAccessError,
  HistoryStatus,
  HistoryValidationError,
  type HistoryFilters,
} from "../domain/history.js";
import { createHistoryDatabase } from "./history-postgres-fixture.js";

const adminUrl = process.env.HISTORY_TEST_POSTGRES_ADMIN_URL;
if (process.env.HISTORY_REQUIRE_POSTGRES === "1" && !adminUrl)
  throw new Error(
    "HISTORY_TEST_POSTGRES_ADMIN_URL is required for history qualification",
  );
const filters: HistoryFilters = {
  q: "",
  repositoryId: null,
  status: "all",
  days: null,
};
describe.skipIf(!adminUrl)("History actual reader SQL and isolation", () => {
  let prisma: PrismaClient,
    connectionString: string,
    cleanup: () => Promise<void>;
  const queries: { query: string; params: string }[] = [];
  let record = false;
  beforeAll(async () => {
    ({ prisma, connectionString, cleanup } = await createHistoryDatabase(
      adminUrl!,
      {
        onQuery: (event) => {
          if (record) queries.push(event);
        },
      },
    ));
    await prisma.reviewHistoryCoverage.create({
      data: {
        id: "capture_v1",
        coverageSince: new Date("2026-10-28T00:00:00Z"),
      },
    });
  }, 120_000);
  afterAll(async () => {
    await cleanup?.();
  });
  async function fixture(personal = false) {
    const workspaceId = randomUUID(),
      actorId = randomUUID(),
      outsider = randomUUID();
    await prisma.user.createMany({ data: [{ id: actorId }, { id: outsider }] });
    await prisma.workspace.create({
      data: {
        id: workspaceId,
        slug: workspaceId,
        name: "History fixture",
        ...(personal ? { personalOwnerUserId: actorId } : {}),
      },
    });
    await prisma.workspaceMember.create({
      data: {
        workspaceId,
        userId: personal ? outsider : actorId,
        role: "member",
      },
    });
    return { workspaceId, actorId, outsider };
  }
  async function pr(
    workspaceId: string,
    number: number,
    options: {
      scm?: string;
      name?: string;
      title?: string;
      status?: HistoryStatus;
      at?: Date;
      projected?: boolean;
    } = {},
  ) {
    const id = randomUUID(),
      root = randomUUID(),
      at = options.at ?? new Date("2026-10-28T10:00:00Z");
    const row = await prisma.reviewHistoryPullRequest.create({
      data: {
        id,
        workspaceId,
        scmRepositoryIdentityId: options.scm ?? `scm-${number}`,
        pullRequestNumber: number,
        lastAllocatedRunSequence: 1n,
        ...(options.projected === false
          ? {}
          : {
              latestRootRequestId: root,
              latestRunSequence: 1n,
              latestRequestedAt: at,
              latestStatus: options.status ?? HistoryStatus.Completed,
              repositoryFullName: options.name ?? "org/history",
              pullRequestTitle: options.title ?? `Security review ${number}`,
              sourceBaseUrl: "https://github.com",
              projectedAt: at,
            }),
      },
    });
    return { ...row, root, at };
  }
  it("resolves only captured readable identities in the authorized workspace with bounded raw inputs", async () => {
    const scope = await fixture(),
      other = await fixture(),
      reader = createPrismaHistoryReader(prisma);
    const first = await pr(scope.workspaceId, 777, {
      scm: "stable-original",
      name: "renamed/repository",
      status: HistoryStatus.Failed,
    });
    await pr(other.workspaceId, 777, { scm: "foreign-scm" });
    await pr(scope.workspaceId, 777, {
      scm: "unprojected-scm",
      projected: false,
    });
    const incomplete = await pr(scope.workspaceId, 777, {
      scm: "incomplete-scm",
    });
    await prisma.reviewHistoryPullRequest.update({
      where: { id: incomplete.id },
      data: { latestStatus: null },
    });
    const identities = [
      "stable-original",
      "foreign-scm",
      "unprojected-scm",
      "incomplete-scm",
      "missing-scm",
    ].map((scmRepositoryIdentityId) => ({
      scmRepositoryIdentityId,
      pullRequestNumber: 777,
    }));
    await expect(
      reader.resolvePullRequests({
        ...scope,
        pullRequests: [...identities, identities[0]!],
      }),
    ).resolves.toEqual({
      state: "available",
      items: [
        {
          id: first.id,
          scmRepositoryIdentityId: "stable-original",
          pullRequestNumber: 777,
        },
      ],
    });
    await expect(
      reader.resolvePullRequests({
        ...scope,
        actorId: scope.outsider,
        pullRequests: [],
      }),
    ).rejects.toBeInstanceOf(HistoryAccessError);
    await expect(
      reader.resolvePullRequests({
        ...scope,
        pullRequests: Array.from({ length: 26 }, () => identities[0]!),
      }),
    ).rejects.toBeInstanceOf(HistoryValidationError);
    for (const pullRequestNumber of [0, -1, 1.5, 2_147_483_648])
      await expect(
        reader.resolvePullRequests({
          ...scope,
          pullRequests: [
            { scmRepositoryIdentityId: "stable-original", pullRequestNumber },
          ],
        }),
      ).rejects.toBeInstanceOf(HistoryValidationError);
    const coverage = await prisma.reviewHistoryCoverage.findUniqueOrThrow({
      where: { id: "capture_v1" },
    });
    await prisma.reviewHistoryCoverage.delete({ where: { id: "capture_v1" } });
    try {
      await expect(
        reader.resolvePullRequests({ ...scope, pullRequests: identities }),
      ).resolves.toEqual({ state: "available", items: [] });
      await expect(
        reader.resolvePullRequests({
          ...scope,
          actorId: scope.outsider,
          pullRequests: identities,
        }),
      ).rejects.toBeInstanceOf(HistoryAccessError);
    } finally {
      await prisma.reviewHistoryCoverage.create({ data: coverage });
    }
  });
  it("degrades a real post-authorization projection timeout only after rolling back the owned transaction", async () => {
    const scope = await fixture(),
      target = await pr(scope.workspaceId, 778);
    const readerQueries: string[] = [];
    const timed = new PrismaClient({
      adapter: new PrismaPg({
        connectionString,
        options: "-c statement_timeout=500",
        max: 1,
      }),
      log: [{ emit: "event", level: "query" }],
    });
    timed.$on("query", (event) => readerQueries.push(event.query));
    let release!: () => void, ready!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const locked = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const holder = prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`LOCK TABLE "ReviewHistoryPullRequest" IN ACCESS EXCLUSIVE MODE`;
        ready();
        await released;
      },
      { timeout: 10_000 },
    );
    try {
      await locked;
      await expect(
        createPrismaHistoryReader(timed).resolvePullRequests({
          ...scope,
          pullRequests: [
            {
              scmRepositoryIdentityId: target.scmRepositoryIdentityId,
              pullRequestNumber: 778,
            },
          ],
        }),
      ).resolves.toEqual({ state: "unavailable" });
      expect(readerQueries.some((query) => query.includes('"Workspace"'))).toBe(
        true,
      );
      expect(readerQueries.some((query) => /^ROLLBACK\b/u.test(query))).toBe(
        true,
      );
      await expect(timed.$queryRaw`SELECT 1 AS value`).resolves.toEqual([
        { value: 1 },
      ]);
    } finally {
      release();
      await holder;
      await timed.$disconnect();
    }
  }, 15_000);
  it("uses strict shared/personal ownership and current active-workspace authorization on every read before cursor validation", async () => {
    const shared = await fixture(),
      personal = await fixture(true),
      reader = createPrismaHistoryReader(prisma);
    for (const scope of [shared, personal]) {
      const row = await pr(scope.workspaceId, 1);
      await prisma.reviewHistoryCoverage.upsert({
        where: { id: "capture_v1" },
        create: { id: "capture_v1", coverageSince: new Date() },
        update: {},
      });
      const operations = (actorId: string, cursor?: string) => [
        () =>
          reader.listPullRequests({
            actorId,
            workspaceId: scope.workspaceId,
            filters,
            ...(cursor ? { cursor } : {}),
          }),
        () =>
          reader.listRuns({
            actorId,
            workspaceId: scope.workspaceId,
            pullRequestId: row.id,
            ...(cursor ? { cursor } : {}),
          }),
        () =>
          reader.listRepositories({
            actorId,
            workspaceId: scope.workspaceId,
            ...(cursor ? { cursor } : {}),
          }),
      ];
      for (const operation of operations(scope.actorId))
        await expect(operation()).resolves.toBeDefined();
      for (const operation of operations(scope.outsider, "malformed"))
        await expect(operation()).rejects.toBeInstanceOf(HistoryAccessError);
      for (const deletionState of ["delete_pending", "deleted"] as const) {
        await prisma.workspace.update({
          where: { id: scope.workspaceId },
          data: { deletionState },
        });
        for (const operation of operations(scope.actorId, "malformed"))
          await expect(operation()).rejects.toBeInstanceOf(HistoryAccessError);
      }
      await prisma.workspace.update({
        where: { id: scope.workspaceId },
        data: { deletionState: "active" },
      });
      if (scope === shared) {
        await prisma.workspaceMember.deleteMany({
          where: { workspaceId: scope.workspaceId },
        });
        for (const operation of operations(scope.actorId))
          await expect(operation()).rejects.toBeInstanceOf(HistoryAccessError);
      }
    }
  });
  it("pages only projected latest PRs, binds cursor scope, and preserves a UTC window through Previous/refetch after midnight", async () => {
    const scope = await fixture(),
      other = await fixture();
    let now = new Date("2026-10-28T23:59:59Z");
    const reader = createPrismaHistoryReader(prisma, { now: () => now });
    for (let n = 1; n <= 28; n++) await pr(scope.workspaceId, n);
    await pr(scope.workspaceId, 29, { projected: false });
    await pr(other.workspaceId, 99, { title: "Tenant secret" });
    const first = await reader.listPullRequests({
      ...scope,
      filters: { ...filters, days: 7 },
    });
    expect(first.items).toHaveLength(25);
    expect(first.nextCursor).not.toBeNull();
    now = new Date("2026-10-29T00:00:01Z");
    await pr(scope.workspaceId, 30, { at: new Date("2026-10-29T00:00:00Z") });
    const next = await reader.listPullRequests({
      ...scope,
      filters: { ...filters, days: 7 },
      cursor: first.nextCursor!,
    });
    expect(next.items).toHaveLength(3);
    const previous = await reader.listPullRequests({
      ...scope,
      filters: { ...filters, days: 7 },
      cursor: first.windowToken,
    });
    expect(previous.items).toEqual(first.items);
    expect(previous.windowToken).toBe(first.windowToken);
    const fresh = await reader.listPullRequests({
      ...scope,
      filters: { ...filters, days: 7 },
    });
    expect(fresh.windowToken).not.toBe(first.windowToken);
    expect(fresh.items[0]?.pullRequestNumber).toBe(30);
    expect(
      new Set([...first.items, ...next.items].map((row) => row.id)).size,
    ).toBe(28);
    await expect(
      reader.listPullRequests({ ...scope, filters, cursor: first.nextCursor! }),
    ).rejects.toBeInstanceOf(HistoryValidationError);
    await expect(
      reader.listPullRequests({
        actorId: other.actorId,
        workspaceId: other.workspaceId,
        filters: { ...filters, days: 7 },
        cursor: first.nextCursor!,
      }),
    ).rejects.toBeInstanceOf(HistoryValidationError);
  });
  it("uses latest metadata/status for search and keeps canonical historical options and selected labels without a connection", async () => {
    const scope = await fixture(),
      reader = createPrismaHistoryReader(prisma);
    const row = await pr(scope.workspaceId, 123, {
      scm: "renamed",
      name: "old/repository",
      title: "Old title",
      status: HistoryStatus.Completed,
      at: new Date("2026-10-27T12:00:00Z"),
    });
    await pr(scope.workspaceId, 124, {
      scm: "renamed",
      name: "new/repository",
      title: "Newest security review",
      status: HistoryStatus.Running,
    });
    for (let n = 1; n <= 27; n++)
      await pr(scope.workspaceId, 200 + n, {
        scm: `repo-${n}`,
        name:
          n === 27
            ? "İSTANBUL/Unicode"
            : `org/repository-${String(n).padStart(2, "0")}`,
      });
    const first = await reader.listRepositories({
      ...scope,
      selectedRepositoryId: "repo-27",
    });
    expect(first.items).toHaveLength(25);
    expect(first.selected?.id).toBe("repo-27");
    const next = await reader.listRepositories({
      ...scope,
      selectedRepositoryId: "repo-27",
      cursor: first.nextCursor!,
    });
    const options = [...first.items, ...next.items];
    expect(options).toHaveLength(28);
    expect(new Set(options.map((option) => option.id)).size).toBe(28);
    expect(options.find((option) => option.id === "renamed")?.fullName).toBe(
      "new/repository",
    );
    const searched = await reader.listRepositories({
      ...scope,
      q: "new",
      selectedRepositoryId: "repo-27",
    });
    expect(searched.items.map((option) => option.id)).toEqual(["renamed"]);
    expect(searched.selected?.id).toBe("repo-27");
    expect(
      (
        await reader.listPullRequests({
          ...scope,
          filters: { ...filters, q: "#123" },
        })
      ).items.map((item) => item.id),
    ).toEqual([row.id]);
    expect(
      (
        await reader.listPullRequests({
          ...scope,
          filters: { ...filters, q: "new sec", status: "active" },
        })
      ).items,
    ).toHaveLength(1);
    expect(
      (
        await reader.listPullRequests({
          ...scope,
          filters: { ...filters, q: "new sec", status: "completed" },
        })
      ).items,
    ).toHaveLength(0);
    // Facts survive without an operational repository connection or identity binding.
    const foreign = await fixture();
    await pr(foreign.workspaceId, 125, {
      scm: "renamed",
      name: "private/new-owner",
      title: "New owner secret",
    });
    expect(
      (await reader.listRepositories({ ...scope, q: "private" })).items,
    ).toHaveLength(0);
    expect(
      (
        await reader.listPullRequests({
          ...scope,
          filters: { ...filters, q: "secret" },
        })
      ).items,
    ).toHaveLength(0);
  });
  it("loads five projected logical reviews and scopes continuation to the PR and workspace", async () => {
    const scope = await fixture(),
      other = await fixture(),
      reader = createPrismaHistoryReader(prisma);
    const row = await pr(scope.workspaceId, 1),
      second = await pr(scope.workspaceId, 2);
    for (let n = 1; n <= 8; n++)
      await prisma.reviewHistoryRun.create({
        data: {
          rootRequestId: randomUUID(),
          pullRequestId: row.id,
          workspaceId: scope.workspaceId,
          scmRepositoryIdentityId: row.scmRepositoryIdentityId,
          pullRequestNumber: 1,
          originalRepositoryConnectionId: "disconnected",
          runSequence: BigInt(n),
          requestedAt: row.at,
          triggerKind: "manual_rerun",
          headSha: "a".repeat(40),
          reviewRevisionHash: "b".repeat(64),
          sourceBaseUrl: "https://github.com",
          updatedAt: row.at,
          ...(n === 8
            ? {}
            : { status: HistoryStatus.Completed, projectedAt: row.at }),
        },
      });
    const first = await reader.listRuns({ ...scope, pullRequestId: row.id });
    const next = await reader.listRuns({
      ...scope,
      pullRequestId: row.id,
      cursor: first.nextCursor!,
    });
    expect(first.items).toHaveLength(5);
    expect(next.items).toHaveLength(2);
    expect(
      new Set([...first.items, ...next.items].map((item) => item.id)).size,
    ).toBe(7);
    await expect(
      reader.listRuns({
        ...scope,
        pullRequestId: second.id,
        cursor: first.nextCursor!,
      }),
    ).rejects.toBeInstanceOf(HistoryValidationError);
    expect(
      (
        await reader.listRuns({
          actorId: other.actorId,
          workspaceId: other.workspaceId,
          pullRequestId: row.id,
        })
      ).items,
    ).toEqual([]);
  });
  it.skipIf(process.env.HISTORY_TEST_VOLUME !== "1")(
    "records exact production query plans for 100000 PRs and unrelated tenant data",
    async () => {
      const scope = await fixture(),
        other = await fixture();
      for (const target of [scope.workspaceId, other.workspaceId])
        await prisma.$executeRaw`INSERT INTO "ReviewHistoryPullRequest" (id,"workspaceId","scmRepositoryIdentityId","pullRequestNumber","lastAllocatedRunSequence","latestRootRequestId","latestRunSequence","latestRequestedAt","latestStatus","repositoryFullName","pullRequestTitle","sourceBaseUrl","projectedAt") SELECT ${target}||'-pr-'||n,${target},'volume-repo-'||(n%40),n,1,${target}||'-run-'||n,1,timestamp '2026-10-28 10:00:00'+(n%100)*interval '1 millisecond',(ARRAY['completed','running','failed'])[n%3+1],'volume/repository-'||(n%40),CASE WHEN n=54321 THEN 'Selective needle' ELSE 'Common review title' END,'https://github.com',timestamp '2026-10-28' FROM generate_series(1,100000) n`;
      await prisma.$executeRaw`ANALYZE "ReviewHistoryPullRequest"`;
      await prisma.$executeRaw`INSERT INTO "ReviewHistoryRun" ("rootRequestId","pullRequestId","workspaceId","scmRepositoryIdentityId","pullRequestNumber","originalRepositoryConnectionId","runSequence","requestedAt","triggerKind","headSha","reviewRevisionHash","sourceBaseUrl",status,"projectedAt","updatedAt") SELECT ${scope.workspaceId}||'-history-'||n,${scope.workspaceId}||'-pr-1',${scope.workspaceId},'volume-repo-1',1,'disconnected',n,timestamp '2026-10-28','manual_rerun',repeat('a',40),repeat('b',64),'https://github.com','completed',timestamp '2026-10-28',timestamp '2026-10-28' FROM generate_series(1,100000) n`;
      await prisma.$executeRaw`ANALYZE "ReviewHistoryRun"`;
      const reader = createPrismaHistoryReader(prisma),
        start = performance.now();
      record = true;
      try {
        const first = await reader.listPullRequests({ ...scope, filters });
        await reader.listPullRequests({
          ...scope,
          filters,
          cursor: first.nextCursor!,
        });
        for (const q of ["select nee", "common", "missingneedle", "#54321"])
          await reader.listPullRequests({
            ...scope,
            filters: { ...filters, q },
          });
        await reader.listPullRequests({
          ...scope,
          filters: {
            ...filters,
            repositoryId: "volume-repo-1",
            status: "active",
          },
        });
        await reader.listRepositories({
          ...scope,
          q: "repo",
          selectedRepositoryId: "volume-repo-1",
        });
        const runs = await reader.listRuns({
          ...scope,
          pullRequestId: `${scope.workspaceId}-pr-1`,
        });
        await reader.listRuns({
          ...scope,
          pullRequestId: `${scope.workspaceId}-pr-1`,
          cursor: runs.nextCursor!,
        });
      } finally {
        record = false;
      }
      const elapsedMs = performance.now() - start,
        plans: unknown[] = [];
      for (const query of queries.filter(
        (query) =>
          /^(SELECT|WITH)\b/u.test(query.query.trim()) &&
          /"ReviewHistory(?:PullRequest|Run)"/u.test(query.query),
      )) {
        const parameters: unknown[] = JSON.parse(query.params);
        const plan = await prisma.$queryRawUnsafe(
          "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) " + query.query,
          ...parameters,
        );
        plans.push({ query: query.query, plan });
      }
      expect(plans.length).toBeGreaterThanOrEqual(9);
      await mkdir("tmp/review-history", { recursive: true });
      await writeFile(
        "tmp/review-history/reader-volume.json",
        JSON.stringify(
          {
            tenantPrs: 100000,
            otherTenantPrs: 100000,
            historyRuns: 100000,
            elapsedMs,
            plans,
          },
          null,
          2,
        ),
      );
    },
    120_000,
  );
});
