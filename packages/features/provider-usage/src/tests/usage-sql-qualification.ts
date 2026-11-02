import { deepStrictEqual, equal, ok } from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { Prisma, type PrismaClient } from "@prisma/client";
import type { UsageReportQuery } from "../application/ports";
import type { UsagePeriodReport } from "../application/report-usage";
import type { UsageProjection } from "../domain/usage";
import { PrismaUsageReportReader } from "../infrastructure/prisma-usage-store";
import { fact } from "./fixture";

// Opt-in qualification inside the existing fully migrated disposable PG suite.
// All records and query parameters are synthetic; no application URL is read.
const actorIndexProbe = process.env.USAGE_SQL_ACTOR_INDEX_PROBE === "1";
const output = actorIndexProbe
  ? "tmp/usage-sql-followthrough/actor-index-probe"
  : "tmp/usage-sql-followthrough/qualification";
const json = (value: unknown) =>
  JSON.stringify(value, (_, item: unknown) =>
    typeof item === "bigint" ? item.toString() : item,
  );
interface Statement {
  text: string;
  values: unknown[];
  rows: number;
  bytes: number;
  hydrated: number;
  elapsedMs: number;
  error?: string;
}
const usesScopedJitOff = (statements: readonly Statement[]) =>
  statements.some((statement) =>
    statement.text.includes(
      "/* usage-report:settings */ SELECT set_config('jit','off',true) AS jit",
    ),
  );
function capture(prisma: PrismaClient, statements: Statement[]): PrismaClient {
  return new Proxy(prisma, {
    get(target, property) {
      if (property !== "$transaction") return Reflect.get(target, property);
      return (
        operation: (tx: Prisma.TransactionClient) => Promise<unknown>,
        options: {
          isolationLevel?: Prisma.TransactionIsolationLevel;
          maxWait?: number;
          timeout?: number;
        },
      ) => {
        equal(options.isolationLevel, "RepeatableRead");
        return target.$transaction(
          (tx) =>
            operation(
              new Proxy(tx, {
                get(client, key) {
                  if (key !== "$queryRaw") return Reflect.get(client, key);
                  return async (
                    sql: Prisma.Sql | TemplateStringsArray,
                    ...parameters: unknown[]
                  ) => {
                    const start = performance.now();
                    const statement = Array.isArray(sql)
                      ? {
                          text: sql.reduce(
                            (text, part, index) =>
                              text + (index ? `$${index}` : "") + part,
                            "",
                          ),
                          values: parameters,
                        }
                      : (sql as Prisma.Sql);
                    const measured: Statement = {
                      text: statement.text,
                      values: statement.values,
                      rows: 0,
                      bytes: 0,
                      hydrated: 0,
                      elapsedMs: 0,
                    };
                    statements.push(measured);
                    try {
                      const rows = (await Reflect.apply(
                        client.$queryRaw,
                        client,
                        [sql, ...parameters],
                      )) as Record<string, unknown>[];
                      measured.rows = rows.length;
                      measured.bytes = Buffer.byteLength(json(rows));
                      measured.hydrated = rows.filter((row) =>
                        Object.hasOwn(row, "projection"),
                      ).length;
                      return rows;
                    } catch (error) {
                      measured.error =
                        error instanceof Error ? error.message : String(error);
                      throw error;
                    } finally {
                      measured.elapsedMs = performance.now() - start;
                    }
                  };
                },
              }),
            ),
          options,
        );
      };
    },
  });
}

async function seedRows(prisma: PrismaClient, rows: Prisma.Sql) {
  const base = fact();
  await prisma.$executeRaw(Prisma.sql`
    WITH fixture AS (${rows}), identities AS (
      SELECT fixture.*, ${json(base.identity)}::jsonb || jsonb_build_object(
        'callId', id, 'workspaceId', workspace, 'actorId', actor,
        'provider', provider, 'requestedModel', model, 'runId', run,
        'occurredAt', occurred, 'parentScope', parent,
        'invocationId', COALESCE(parent, 'volume-invocation'),
        'granularity', CASE WHEN summary THEN 'turn' ELSE 'call' END
      ) AS identity FROM fixture
    ), projections AS (
      SELECT identities.*, jsonb_build_object('identity', identity,
        'lifecycle', NULL, 'usage', ${json(base)}::jsonb || jsonb_build_object(
          'identity', identity, 'actualProvider', provider, 'actualModel', model,
          'childCallIds', manifest,
          'tokens', jsonb_build_object('inputTotal', CASE WHEN summary THEN 100 ELSE 1 END,
            'outputTotal', CASE WHEN summary THEN 0 ELSE 2 END,
            'total', CASE WHEN summary THEN 100 ELSE 3 END,
            'cacheRead', 0, 'cacheWrite', 0, 'reasoning', 0),
          'cost', ${json({ ...base.cost!, amount: "0.000000000001" })}::jsonb
        )) AS projection FROM identities
    ) INSERT INTO "UsageCall" ("callId", "workspaceId", "actorId", provider,
      "actualModel", route, "runId", purpose, "occurredAt", "identityHash", projection, "updatedAt")
    SELECT id, workspace, actor, provider, model, 'gateway', run, 'review',
      occurred::timestamptz, 'synthetic-sql-qualification', projection, CURRENT_TIMESTAMP
    FROM projections
  `);
}
async function seedOrdinary(
  prisma: PrismaClient,
  workspace: string,
  count: number,
  old = false,
) {
  await seedRows(
    prisma,
    Prisma.sql`
    SELECT ${workspace + (old ? "-old" : "") + "-call-"} || lpad(n::text, 8, '0') AS id,
      ${workspace}::text AS workspace, 'volume-member-' || (n % 1000)::text AS actor,
      CASE WHEN n % 10000 = 0 THEN 'rare' ELSE 'provider-' || (n % 5)::text END AS provider,
      CASE WHEN n % 10000 = 0 THEN 'rare-model' ELSE 'model-' || (n % 7)::text END AS model,
      'volume-run-' || lpad((n % 1000)::text, 4, '0') AS run,
      ${old ? "2025-10-" : "2026-10-"} || lpad((1 + n % 28)::text, 2, '0') || 'T10:00:00.000Z' AS occurred,
      NULL::text AS parent, false AS summary, NULL::jsonb AS manifest
    FROM generate_series(1, ${count}::integer) n
  `,
  );
}
async function seedFamilies(
  prisma: PrismaClient,
  workspace: string,
  count: number,
) {
  await seedRows(
    prisma,
    Prisma.sql`
    SELECT ${workspace + "-family-"} || f::text || '-' || child::text AS id,
      ${workspace}::text AS workspace, 'family-member'::text AS actor,
      'families'::text AS provider, 'family-model'::text AS model,
      ${workspace + "-family-run-"} || f::text AS run,
      '2026-10-21T10:00:00.000Z'::text AS occurred,
      ${workspace + "-scope-"} || f::text AS parent, child = 10 AS summary,
      CASE WHEN child = 10 THEN (
        SELECT jsonb_agg(${workspace + "-family-"} || f::text || '-' || member::text ORDER BY member)
        FROM generate_series(0, 9) member
      ) ELSE NULL END AS manifest
    FROM generate_series(0, ${count - 1}::integer) f
    CROSS JOIN generate_series(0, 10) child
    WHERE child <> 9 OR f % 2 <> 0
  `,
  );
}

interface PlanNode {
  [key: string]: unknown;
  Plans?: PlanNode[];
}
function planSummary(node: PlanNode) {
  const scans: Record<string, unknown>[] = [];
  const operators: Record<string, unknown>[] = [];
  const visit = (current: PlanNode) => {
    const loops = Number(current["Actual Loops"] ?? 0);
    const measured = {
      node: current["Node Type"],
      loops,
      rowsTimesLoops: Number(current["Actual Rows"] ?? 0) * loops,
      removedTimesLoops: Number(current["Rows Removed by Filter"] ?? 0) * loops,
      joinRemovedTimesLoops:
        Number(current["Rows Removed by Join Filter"] ?? 0) * loops,
      recheckRemovedTimesLoops:
        Number(current["Rows Removed by Index Recheck"] ?? 0) * loops,
      sharedHit: current["Shared Hit Blocks"] ?? 0,
      sharedRead: current["Shared Read Blocks"] ?? 0,
      tempRead: current["Temp Read Blocks"] ?? 0,
      tempWritten: current["Temp Written Blocks"] ?? 0,
      sortMethod: current["Sort Method"],
      sortSpaceType: current["Sort Space Type"],
      sortSpaceKb: current["Sort Space Used"],
      hashBatches: current["HashAgg Batches"] ?? current["Hash Batches"],
      diskUsageKb: current["Disk Usage"],
    };
    operators.push(measured);
    if (String(current["Node Type"]).includes("Scan")) {
      scans.push({
        ...measured,
        relation: current["Relation Name"],
        index: current["Index Name"],
      });
    }
    current.Plans?.forEach(visit);
  };
  visit(node);
  return {
    rootRows: node["Actual Rows"],
    scans,
    operators,
    sharedHit: node["Shared Hit Blocks"] ?? 0,
    sharedRead: node["Shared Read Blocks"] ?? 0,
    tempRead: node["Temp Read Blocks"] ?? 0,
    tempWritten: node["Temp Written Blocks"] ?? 0,
  };
}
async function explainStatement(
  prisma: PrismaClient,
  statement: { text: string; values: unknown[]; label: string },
  caseName: string,
  reportJitOff = false,
) {
  const execute = (client: PrismaClient | Prisma.TransactionClient) =>
    client.$queryRawUnsafe<
      {
        "QUERY PLAN": {
          Plan: PlanNode;
          "Execution Time": number;
          "Planning Time": number;
          JIT?: unknown;
        }[];
      }[]
    >(
      `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${statement.text}`,
      ...statement.values,
    );
  const explained = reportJitOff
    ? await prisma.$transaction(
        async (tx) => {
          // Match the actual captured production setup, scoped to this replay.
          await tx.$queryRaw`SELECT set_config('jit','off',true) AS jit`;
          return execute(tx);
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
      )
    : await execute(prisma);
  const plan = explained[0]!["QUERY PLAN"][0]!;
  writeFileSync(`${output}/${caseName}-${statement.label}.json`, json(plan));
  return {
    label: statement.label,
    sql: statement.text,
    parameters: statement.values,
    ...planSummary(plan.Plan),
    executionMs: plan["Execution Time"],
    planningMs: plan["Planning Time"],
    jit: plan.JIT,
    reportJitOff,
  };
}
async function diagnoseFailedReport(
  prisma: PrismaClient,
  statements: readonly Statement[],
  caseName: string,
) {
  const plans: Record<string, unknown>[] = [];
  for (const [index, statement] of statements.entries()) {
    if (!/usage-report:(aggregates|observation-page)/.test(statement.text))
      continue;
    try {
      plans.push(
        await explainStatement(
          prisma,
          { ...statement, label: `failed-stage-${index}` },
          caseName,
          usesScopedJitOff(statements),
        ),
      );
    } catch (error) {
      plans.push({
        label: `failed-stage-${index}`,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return plans;
}

export async function qualifyUsageSqlReport(
  prisma: PrismaClient,
): Promise<void> {
  mkdirSync(output, { recursive: true });
  const source = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  const delta = execFileSync(
    "git",
    [
      "diff",
      "HEAD",
      "--",
      "packages/features/provider-usage",
      "packages/platform/db/prisma",
    ],
    {
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
    },
  );
  // A tracked diff omits new modules/migrations. Hash their actual contents too.
  const sourceFiles = [
    ...new Set(
      execFileSync(
        "git",
        [
          "ls-files",
          "-co",
          "--exclude-standard",
          "-z",
          "--",
          "packages/features/provider-usage",
          "packages/platform/db/prisma",
        ],
        { encoding: "utf8" },
      )
        .split("\0")
        .filter(Boolean),
    ),
  ]
    .sort()
    .map((path) => {
      const bytes = readFileSync(path);
      return {
        path,
        bytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      };
    });
  const evidence: Record<string, unknown> = {
    source,
    sourceDeltaSha256: createHash("sha256").update(delta).digest("hex"),
    sourceContentSha256: createHash("sha256")
      .update(json(sourceFiles))
      .digest("hex"),
    sourceFiles,
    node: process.version,
    status: "running",
    cases: [],
    boundary:
      "Synthetic migrated PostgreSQL data; exact totals still scan period rows. Family metadata, facets/groups and grant coverage can grow. Bytes are JSON re-encoding measurements, excluding transport framing. Baseline timing includes full-projection SQL read, driver decoding and JSON byte accounting, but excludes the previous JS selection/aggregation. New report runs with the production transaction timeout unchanged. No latency gate or production capacity claim.",
  };
  try {
    evidence.postgres =
      await prisma.$queryRaw`SELECT version() AS version, current_setting('work_mem') AS work_mem, current_setting('jit') AS jit`;
    const database = await prisma.$queryRaw<
      { name: string }[]
    >`SELECT current_database() AS name`;
    ok(
      /^TEST_usage_[0-9a-f]{32}$/.test(database[0]?.name ?? ""),
      "Usage SQL qualification may alter only the suite-owned disposable database",
    );
    evidence.database = database[0]!.name;
    await prisma.workspace.createMany({
      data: ["volume", "volume-noise", "volume-families"].map((id) => ({
        id,
        slug: id,
        name: id,
      })),
    });
    await seedOrdinary(prisma, "volume", 100000);
    await seedOrdinary(prisma, "volume-noise", 50000);
    await seedOrdinary(prisma, "volume", 50000, true);
    await seedFamilies(prisma, "volume", 100);
    await seedFamilies(prisma, "volume-families", 1000);
    await prisma.$executeRaw`ANALYZE "UsageCall"`;
    if (actorIndexProbe) {
      // Fresh migrations now install this index. Remove only its exact name for
      // the opt-in before/after comparison, then recreate it below in this DB.
      await prisma.$executeRaw`DROP INDEX IF EXISTS "UsageCall_workspaceId_actorId_occurredAt_idx"`;
      evidence.actorIndexProbeFixture = {
        database: database[0]!.name,
        droppedExactIndexIfPresent:
          "UsageCall_workspaceId_actorId_occurredAt_idx",
      };
    }
    const base: UsageReportQuery = {
      workspaceId: "volume",
      actorId: null,
      access: "admin",
      from: new Date("2026-10-01"),
      to: new Date("2026-11-01"),
      limit: 25,
    };
    const cases: {
      name: string;
      query: UsageReportQuery;
      attempts: number;
      runs: number;
      tokens: number;
    }[] = [
      {
        name: "full",
        query: base,
        attempts: 100950,
        runs: 1100,
        tokens: 306500,
      },
      {
        name: "member",
        query: { ...base, access: "member", actorId: "volume-member-0" },
        attempts: 100,
        runs: 1,
        tokens: 300,
      },
      {
        name: "run",
        query: { ...base, runId: "volume-run-0007" },
        attempts: 100,
        runs: 1,
        tokens: 300,
      },
      {
        name: "provider",
        query: { ...base, provider: "rare" },
        attempts: 10,
        runs: 1,
        tokens: 30,
      },
      {
        name: "model",
        query: { ...base, model: "rare-model" },
        attempts: 10,
        runs: 1,
        tokens: 30,
      },
      {
        name: "families",
        query: { ...base, workspaceId: "volume-families" },
        attempts: 9500,
        runs: 1000,
        tokens: 65000,
      },
    ];
    const memberCase = cases.find((sample) => sample.name === "member")!;
    const measuredCases = actorIndexProbe
      ? [
          { ...memberCase, name: "member-before-index" },
          { ...memberCase, name: "member-after-index" },
        ]
      : cases;
    let memberBefore:
      | { report: UsagePeriodReport; statements: Statement[] }
      | undefined;
    for (const sample of measuredCases) {
      if (sample.name === "member-after-index") {
        const buildStart = performance.now();
        await prisma.$executeRaw`CREATE INDEX "UsageCall_workspaceId_actorId_occurredAt_idx" ON "UsageCall" ("workspaceId","actorId","occurredAt")`;
        const buildMs = performance.now() - buildStart;
        await prisma.$executeRaw`ANALYZE "UsageCall"`;
        evidence.actorIndexProbe = {
          buildMs,
          size: await prisma.$queryRaw`SELECT pg_relation_size('"UsageCall_workspaceId_actorId_occurredAt_idx"'::regclass)::text AS bytes`,
          boundary:
            "Comparison drops/recreates only the exact actor index inside the suite-owned disposable database. The same member SQL, parameters, report and transaction-local JIT setup are compared before/after.",
        };
      }
      evidence.activeCase = sample.name;
      const filters = [
        Prisma.sql`"workspaceId"=${sample.query.workspaceId}`,
        Prisma.sql`"occurredAt">=${base.from}`,
        Prisma.sql`"occurredAt"<${base.to}`,
      ];
      if (sample.query.access === "member")
        filters.push(Prisma.sql`"actorId"=${sample.query.actorId}`);
      if (sample.query.runId)
        filters.push(Prisma.sql`"runId"=${sample.query.runId}`);
      const baselineSql = Prisma.sql`SELECT projection FROM "UsageCall" WHERE ${Prisma.join(filters, " AND ")} ORDER BY "callId"`;
      const baselineStart = performance.now();
      const oldRows =
        await prisma.$queryRaw<{ projection: UsageProjection }[]>(baselineSql);
      const baseline = {
        rows: oldRows.length,
        bytes: Buffer.byteLength(json(oldRows)),
        elapsedMs: performance.now() - baselineStart,
        timingScope:
          "SQL read, driver decoding and JSON byte accounting; excludes old JS selection/aggregation",
      };
      oldRows.length = 0;
      const statements: Statement[] = [];
      evidence.activeStatements = statements;
      evidence.activeBaseline = baseline;
      const started = performance.now();
      let report: UsagePeriodReport;
      try {
        report = await new PrismaUsageReportReader(
          capture(prisma, statements),
        ).report(sample.query);
      } catch (error) {
        // The production budget is unchanged. Diagnose the already failed read
        // outside its expired transaction while disposable fixtures still exist.
        evidence.failedPlans = await diagnoseFailedReport(
          prisma,
          statements,
          sample.name,
        );
        throw error;
      }
      const elapsedMs = performance.now() - started;
      equal(
        usesScopedJitOff(statements),
        true,
        "Plan replay must match the actual transaction-local JIT setup",
      );
      if (sample.name === "member-before-index")
        memberBefore = { report, statements };
      if (sample.name === "member-after-index") {
        ok(memberBefore);
        deepStrictEqual(report, memberBefore.report);
        const sqlParameters = (items: readonly Statement[]) =>
          items.map(({ text, values }) => ({ text, values }));
        deepStrictEqual(
          sqlParameters(statements),
          sqlParameters(memberBefore.statements),
        );
        equal(usesScopedJitOff(statements), true);
        equal(usesScopedJitOff(memberBefore.statements), true);
      }
      equal(report.totals.providerAttempts, sample.attempts);
      equal(report.totals.logicalRuns, sample.runs);
      equal(report.totals.tokens.total, sample.tokens);
      equal(report.totals.unknownTokenValues, 0);
      if (sample.name === "families") {
        equal(report.partialChildCount, 4500);
        equal(report.totals.reportedSummaries, 500);
        equal(report.totals.costs[0]?.amount, "0.0000000055");
      }
      const hydrated = statements.reduce(
        (count, statement) => count + statement.hydrated,
        0,
      );
      equal(hydrated, report.rows.length);
      ok(hydrated <= 25);
      if (sample.name === "full") {
        equal(report.partialChildCount, 450);
        equal(report.totals.reportedSummaries, 50);
        equal(report.totals.costs[0]?.amount, "0.00000010055");
        evidence.completedFirstReport = {
          elapsedMs,
          hydrated,
          totals: report.totals,
        };
        const cursorStatements: Statement[] = [];
        evidence.cursorStatements = cursorStatements;
        let next: UsagePeriodReport;
        try {
          next = await new PrismaUsageReportReader(
            capture(prisma, cursorStatements),
          ).report({
            ...base,
            limit: 1,
            after: report.nextCursor!,
            runAfter: report.overview.nextRunCursor!,
          });
        } catch (error) {
          evidence.failedRequest = "full-cursor";
          evidence.failedPlans = await diagnoseFailedReport(
            prisma,
            cursorStatements,
            "full-cursor",
          );
          throw error;
        }
        deepStrictEqual(next.totals, report.totals);
        deepStrictEqual(next.overview.daily, report.overview.daily);
        deepStrictEqual(next.overview.models, report.overview.models);
        deepStrictEqual(next.overview.topModels, report.overview.topModels);
        delete evidence.completedFirstReport;
        delete evidence.cursorStatements;
      }
      const measured = {
        name: sample.name,
        baseline,
        elapsedMs,
        hydrated,
        returnedRows: statements.reduce(
          (n, statement) => n + statement.rows,
          0,
        ),
        returnedBytes: statements.reduce(
          (n, statement) => n + statement.bytes,
          0,
        ),
        totals: report.totals,
        reportJitOff: usesScopedJitOff(statements),
        statements: [] as Record<string, unknown>[],
      };
      (evidence.cases as unknown[]).push(measured);
      const explainStatements = [
        {
          ...baselineSql,
          text: baselineSql.text,
          values: baselineSql.values,
          label: "baseline",
        },
        ...statements.map((statement, index) => ({
          ...statement,
          label: `stage-${index}`,
        })),
      ];
      for (const statement of explainStatements) {
        measured.statements.push(
          await explainStatement(
            prisma,
            statement,
            sample.name,
            statement.label !== "baseline" && measured.reportJitOff,
          ),
        );
      }
      writeFileSync(`${output}/result.json`, json(evidence));
      delete evidence.activeStatements;
      delete evidence.activeBaseline;
    }
    delete evidence.activeCase;
    evidence.status = "passed";
  } catch (error) {
    evidence.status = "failed";
    evidence.error = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    writeFileSync(`${output}/result.json`, json(evidence));
  }
}
