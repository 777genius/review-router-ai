import { Prisma } from "@prisma/client";
import { UsageError, type UsageProjection } from "../domain/usage";
import type { UsageReportQuery } from "../application/ports";
import {
  classifyUsageContribution,
  type UsageContributionProfile,
} from "../application/usage-contribution";
import {
  buildUsagePeriodReportFromAggregates,
  type UsageReportAggregateBucket,
} from "../application/usage-report-aggregate";
import { checkedUsageInteger } from "../application/usage-totals";
import type { UsageReportObservation } from "../application/report-usage";
import {
  usageRequestedProviderJoinSql,
  usageRequestedProviderSql,
  usageBillingSql,
} from "./usage-requested-provider-sql";

type ProfileDecision = {
  profileKey: (string | null)[];
} & ReturnType<typeof classifyUsageContribution>;
type ReportScope = { query: UsageReportQuery; operator: boolean };
type FamilySelection = {
  partialChildCount: number;
  unboundedSummaryCount: number;
};
type AggregateBucket = UsageReportAggregateBucket & {
  hasDirectObservations: boolean;
  observationsWithoutRunId: string;
  latestPendingAt: string | null;
};

const jsonValues = (values: readonly string[]) =>
  Prisma.sql`SELECT jsonb_array_elements_text(${JSON.stringify(values)}::jsonb)`;

/** UTF-16 code-unit ordering, including supplementary characters and prefixes.
 * Surrogate-encoded bytes stay bytea; they are never interpreted as UTF-8 text. */
function jsOrder(value: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`CASE
    WHEN ${value} !~ U&'[\\+010000-\\+10FFFF]' THEN convert_to(${value}, 'UTF8')
    ELSE (SELECT decode(string_agg(CASE WHEN ascii(chars.ch)<=65535
      THEN encode(convert_to(chars.ch,'UTF8'),'hex')
      ELSE 'ed'||to_hex(160|((ascii(chars.ch)-65536)>>16))
        ||to_hex(128|(((ascii(chars.ch)-65536)>>10)&63))
        ||'ed'||to_hex(176|(((ascii(chars.ch)-65536)>>6)&15))
        ||to_hex(128|((ascii(chars.ch)-65536)&63)) END,
      '' ORDER BY chars.position),'hex')
      FROM regexp_split_to_table(${value},'') WITH ORDINALITY AS chars(ch,position)) END`;
}

function fromScope(scope: ReportScope): Prisma.Sql {
  return scope.operator
    ? Prisma.sql`FROM "UsageCall" u JOIN "Workspace" w ON w."id"=u."workspaceId" ${usageRequestedProviderJoinSql()}`
    : Prisma.sql`FROM "UsageCall" u ${usageRequestedProviderJoinSql()}`;
}
function scopePredicate({ query: q, operator }: ReportScope): Prisma.Sql {
  const filters = [
    operator
      ? Prisma.sql`w."deletionState"='active'`
      : Prisma.sql`u."workspaceId"=${q.workspaceId}`,
    Prisma.sql`u."occurredAt">=${q.from}`,
    Prisma.sql`u."occurredAt"<${q.to}`,
  ];
  if (!operator && q.access === "member")
    filters.push(Prisma.sql`u."actorId"=${q.actorId}`);
  if (q.route) filters.push(Prisma.sql`u."route"=${q.route}`);
  if (q.bindingId) filters.push(Prisma.sql`u."bindingId"=${q.bindingId}`);
  if (q.runId) filters.push(Prisma.sql`u."runId"=${q.runId}`);
  if (q.purpose) filters.push(Prisma.sql`u."purpose"=${q.purpose}`);
  return Prisma.join(filters, " AND ");
}
function dimensions(q: UsageReportQuery): Prisma.Sql {
  const filters: Prisma.Sql[] = [];
  if (q.provider !== undefined)
    filters.push(Prisma.sql`${usageRequestedProviderSql()}=${q.provider}`);
  if (q.model !== undefined)
    filters.push(
      Prisma.sql`u."projection"#>>'{identity,requestedModel}'=${q.model}`,
    );
  return filters.length
    ? Prisma.sql`AND ${Prisma.join(filters, " AND ")}`
    : Prisma.empty;
}
function profileSql(): Prisma.Sql {
  return Prisma.sql`jsonb_build_object(
    'granularity',u."projection"#>'{identity,granularity}',
    'purpose',u."projection"#>'{identity,purpose}',
    'usage',CASE WHEN u."projection"->'usage' IS NULL OR u."projection"->'usage'='null'::jsonb
      THEN NULL ELSE jsonb_build_object('state',u."projection"#>'{usage,state}',
        'dispatchEffect',u."projection"#>'{usage,dispatchEffect}',
        'completeness',u."projection"#>'{usage,completeness}') END,
    'lifecycle',CASE WHEN u."projection"->'lifecycle' IS NULL OR u."projection"->'lifecycle'='null'::jsonb
      THEN NULL ELSE jsonb_build_object('state',u."projection"#>'{lifecycle,state}',
        'dispatchEffect',u."projection"#>'{lifecycle,dispatchEffect}') END)`;
}
function profileKeySql(): Prisma.Sql {
  // A fixed tuple contains the complete validated profile, without rebuilding
  // its nested objects for every observation in the aggregate/page joins.
  return Prisma.sql`jsonb_build_array(
    u."projection"#>'{identity,granularity}',u."projection"#>'{identity,purpose}',
    u."projection"#>'{usage,state}',u."projection"#>'{usage,dispatchEffect}',
    u."projection"#>'{usage,completeness}',u."projection"#>'{lifecycle,state}',
    u."projection"#>'{lifecycle,dispatchEffect}')`;
}
function decisionRelation(decisions: readonly ProfileDecision[]): Prisma.Sql {
  return Prisma.sql`profile_decisions AS (
    SELECT * FROM jsonb_to_recordset(${JSON.stringify(decisions)}::jsonb) AS p(
      "profileKey" jsonb,"includeSpend" boolean,"providerAttempt" boolean,
      "partialWeight" integer,"unknownWeight" integer,"diagnosticWeight" integer,"summaryWeight" integer))`;
}
/** Keep row-level family metadata inside PostgreSQL, before dimension filters. */
function familyRelation(scope: ReportScope): Prisma.Sql {
  return Prisma.sql`family_summaries AS MATERIALIZED (
    SELECT u."callId" AS "summaryId",
      u."projection"#>>'{identity,parentScope}' AS "parentScope",
      u."projection"#>>'{identity,invocationId}' AS "invocationId",
      ${usageRequestedProviderSql()} AS provider,
      u."projection"#>>'{identity,requestedModel}' AS model,
      NULLIF(u."projection"#>'{usage,childCallIds}','null'::jsonb) AS manifest
    ${fromScope(scope)} WHERE ${scopePredicate(scope)}
      AND u."projection"#>>'{identity,granularity}'='turn'
  ), family_members AS MATERIALIZED (
    SELECT s."summaryId",s."parentScope",s."invocationId",m."childId"
    FROM family_summaries s
    CROSS JOIN LATERAL jsonb_array_elements_text(s.manifest) AS m("childId")
  ), family_children AS MATERIALIZED (
    SELECT u."callId",u."projection"#>>'{identity,parentScope}' AS "parentScope",
      u."projection"#>>'{identity,invocationId}' AS "invocationId",
      u."projection"#>>'{usage,completeness}' AS completeness,
      ${usageRequestedProviderSql()} AS provider,
      u."projection"#>>'{identity,requestedModel}' AS model
    ${fromScope(scope)} WHERE ${scopePredicate(scope)}
      AND u."projection"#>>'{identity,granularity}'='call'
      AND EXISTS (SELECT 1 FROM family_members m WHERE m."childId"=u."callId")
  ), family_matches AS MATERIALIZED (
    SELECT m."summaryId",c."callId",c.completeness,c.provider,c.model
    FROM family_members m JOIN family_children c ON c."callId"=m."childId"
      AND c."parentScope" IS NOT DISTINCT FROM m."parentScope"
      AND c."invocationId"=m."invocationId"
  ), family_states AS MATERIALIZED (
    SELECT s."summaryId",s.provider,s.model,s.manifest,
      s.manifest IS NOT NULL AND
        COUNT(m."callId") FILTER (WHERE m.completeness='complete') <> jsonb_array_length(s.manifest)
        AS selected
    FROM family_summaries s LEFT JOIN family_matches m USING ("summaryId")
    GROUP BY s."summaryId",s.provider,s.model,s.manifest
  ), suppressed_children AS MATERIALIZED (
    SELECT m."callId",m.provider,m.model FROM family_matches m
      JOIN family_states s USING ("summaryId") WHERE s.selected
  )`;
}
function selectedCandidate(): Prisma.Sql {
  return Prisma.sql`CASE WHEN u."projection"#>>'{identity,granularity}'='call'
    THEN NOT EXISTS (SELECT 1 FROM suppressed_children c WHERE c."callId"=u."callId")
    ELSE EXISTS (SELECT 1 FROM family_states s WHERE s."summaryId"=u."callId" AND s.selected) END`;
}

async function readSelection(
  tx: Prisma.TransactionClient,
  scope: ReportScope,
): Promise<FamilySelection> {
  const filters: Prisma.Sql[] = [];
  if (scope.query.provider !== undefined)
    filters.push(Prisma.sql`provider=${scope.query.provider}`);
  if (scope.query.model !== undefined)
    filters.push(Prisma.sql`model=${scope.query.model}`);
  const matching = filters.length
    ? Prisma.sql`AND ${Prisma.join(filters, " AND ")}`
    : Prisma.empty;
  const [row] = await tx.$queryRaw<
    {
      conflict: boolean;
      partialChildCount: string;
      unboundedSummaryCount: string;
    }[]
  >(Prisma.sql`/* usage-report:families */ WITH ${familyRelation(scope)}
    SELECT EXISTS(SELECT 1 FROM family_members GROUP BY "childId" HAVING COUNT(*)>1) AS conflict,
      (SELECT COUNT(*)::text FROM suppressed_children WHERE true ${matching}) AS "partialChildCount",
      (SELECT COUNT(*)::text FROM family_states WHERE manifest IS NULL ${matching}) AS "unboundedSummaryCount"`);
  if (row?.conflict) throw new UsageError("usage_authority_conflict");
  return {
    partialChildCount: checkedUsageInteger(row?.partialChildCount ?? "0"),
    unboundedSummaryCount: checkedUsageInteger(
      row?.unboundedSummaryCount ?? "0",
    ),
  };
}

async function readProjectionPage(
  tx: Prisma.TransactionClient,
  scope: ReportScope,
  decisions: readonly ProfileDecision[],
): Promise<{ rows: UsageReportObservation[]; nextCursor: string | null }> {
  const { query: q } = scope;
  const limit = q.limit ?? 100;
  const ids = await tx.$queryRaw<{ callId: string }[]>(
    Prisma.sql`/* usage-report:observation-page */ WITH ${familyRelation(scope)}, ${decisionRelation(decisions)}
      SELECT u."callId" ${fromScope(scope)}
      JOIN profile_decisions p ON p."profileKey"=${profileKeySql()}
      WHERE ${scopePredicate(scope)} ${dimensions(q)} AND p."includeSpend"
      AND (${selectedCandidate()})
      ${q.after ? Prisma.sql`AND ${jsOrder(Prisma.sql`u."callId"`)}>${jsOrder(Prisma.sql`${q.after}::text`)}` : Prisma.empty}
      ORDER BY ${jsOrder(Prisma.sql`u."callId"`)} LIMIT ${limit + 1}`,
  );
  const page = ids.slice(0, limit).map((r) => r.callId);
  const rows = page.length
    ? await tx.$queryRaw<
        {
          projection: UsageProjection;
          requestedProvider: string;
          billing: NonNullable<UsageReportObservation["billing"]>;
        }[]
      >(
        Prisma.sql`/* usage-report:projection-page */ SELECT u."projection",${usageRequestedProviderSql()} AS "requestedProvider",${usageBillingSql()} AS billing
          ${fromScope(scope)} WHERE ${scopePredicate(scope)}
          AND u."callId" IN (${jsonValues(page)})
          ORDER BY ${jsOrder(Prisma.sql`u."callId"`)} LIMIT ${limit}`,
      )
    : [];
  return {
    rows: rows.map((r) => ({
      ...r.projection,
      billing: r.billing,
      ...(r.requestedProvider === r.projection.identity.provider
        ? {}
        : { requestedProvider: r.requestedProvider }),
    })),
    nextCursor: ids.length > limit ? page.at(-1)! : null,
  };
}

async function readRunPage(tx: Prisma.TransactionClient, scope: ReportScope) {
  const { query: q } = scope;
  const limit = q.limit ?? 100;
  const rows = await tx.$queryRaw<{ runId: string }[]>(
    Prisma.sql`/* usage-report:run-page */ WITH run_ids AS MATERIALIZED (
      SELECT DISTINCT u."runId"
      ${fromScope(scope)} WHERE ${scopePredicate(scope)} ${dimensions(q)}
      AND u."runId" IS NOT NULL
    ) SELECT r."runId" FROM run_ids r
      ${q.runAfter ? Prisma.sql`WHERE ${jsOrder(Prisma.sql`r."runId"`)}>${jsOrder(Prisma.sql`${q.runAfter}::text`)}` : Prisma.empty}
      ORDER BY ${jsOrder(Prisma.sql`r."runId"`)} LIMIT ${limit + 1}`,
  );
  return {
    runIds: rows.slice(0, limit).map((r) => r.runId),
    nextRunCursor: rows.length > limit ? rows[limit - 1]!.runId : null,
  };
}

const tokenKeys = [
  "inputTotal",
  "outputTotal",
  "cacheRead",
  "cacheWrite",
  "reasoning",
  "total",
] as const;

async function readAggregates(
  tx: Prisma.TransactionClient,
  scope: ReportScope,
  decisions: readonly ProfileDecision[],
  runIds: readonly string[],
): Promise<AggregateBucket[]> {
  const tokenColumns = tokenKeys.map(
    (key) =>
      Prisma.sql`(u."projection"#>>${`{usage,tokens,${key}}`}::text[])::numeric AS ${Prisma.raw(`"${key}"`)}`,
  );
  const tokenSums = tokenKeys.flatMap((key) => [
    Prisma.sql`${key}::text`,
    Prisma.sql`SUM(${Prisma.raw(`"${key}"`)}) FILTER (WHERE spend)::text`,
  ]);
  const missingTokens = Prisma.join(
    tokenKeys.map(
      (key) =>
        Prisma.sql`CASE WHEN ${Prisma.raw(`"${key}"`)} IS NULL THEN 1 ELSE 0 END`,
    ),
    "+",
  );
  // Group native dimensions before constructing JSON keys. Expanding every
  // observation into JSON-keyed buckets forced wide external sorts on PG17.
  const buckets = [
    { kind: "totals", fields: [] },
    { kind: "groups", fields: ["observedProvider", "observedModel", "day"] },
    { kind: "daily", fields: ["requestedProvider", "day"] },
    {
      kind: "modelRoute",
      fields: ["requestedProvider", "requestedModel", "observationRoute"],
    },
    { kind: "modelRank", fields: ["requestedProvider", "requestedModel"] },
    { kind: "run", fields: ["observationRunId"] },
  ] as const;
  const metricQueries: Prisma.Sql[] = [];
  const costQueries: Prisma.Sql[] = [];
  for (const bucket of buckets) {
    const column = (name: string) => Prisma.raw(`"${name}"`);
    const fields = bucket.fields.map(column);
    const value = (name: string) =>
      bucket.fields.some((field: string) => field === name)
        ? column(name)
        : Prisma.sql`NULL::text`;
    const key = Prisma.sql`jsonb_build_array(${bucket.kind}::text,
      ${value(bucket.kind === "groups" ? "observedProvider" : "requestedProvider")},
      ${value(bucket.kind === "groups" ? "observedModel" : "requestedModel")},
      ${value("observationRoute")},${value("day")},${value("observationRunId")})`;
    const filter =
      bucket.kind === "groups"
        ? Prisma.sql`AND spend`
        : bucket.kind === "run"
          ? Prisma.sql`AND "observationRunId" IN (${jsonValues(runIds)})`
          : Prisma.empty;
    const group = fields.length
      ? Prisma.sql`GROUP BY ${Prisma.join(fields)}`
      : Prisma.empty;
    const annotated = ["modelRoute", "modelRank", "run"].includes(bucket.kind);
    metricQueries.push(Prisma.sql`SELECT ${key} AS "bucketKey",jsonb_build_object(
        'tokens',jsonb_build_object(${Prisma.join(tokenSums)}),
        'unknownTokenValues',COALESCE(SUM(CASE WHEN spend THEN (${missingTokens}) ELSE 0 END),0)::text,
        'unknownTotalTokenCount',COUNT(*) FILTER (WHERE spend AND total IS NULL)::text,
        'partialCount',COALESCE(SUM("partialWeight") FILTER (WHERE spend),0)::text,
        'unknownCount',COALESCE(SUM("unknownWeight") FILTER (WHERE spend),0)::text,
        'providerAttempts',COUNT(*) FILTER (WHERE "providerAttempt")::text,
        'logicalRuns',COUNT(DISTINCT "observationRunId")::text,
        'reportedSummaries',COALESCE(SUM("summaryWeight") FILTER (WHERE spend),0)::text,
        'diagnosticCount',COALESCE(SUM("diagnosticWeight") FILTER (WHERE spend),0)::text,
        'unknownCostCount',COUNT(*) FILTER (WHERE spend AND amount IS NULL)::text
      ) AS totals,
      ${annotated ? Prisma.sql`COALESCE(array_agg(DISTINCT "observedModel") FILTER (WHERE "observedModel" IS NOT NULL),'{}'::text[])` : Prisma.sql`'{}'::text[]`} AS "observedModels",
      bool_or("observedModel" IS NULL) AS "hasUnknownObservedModel",
      ${bucket.kind === "run" ? Prisma.sql`(array_agg("rawOccurredAt" ORDER BY "occurredAt","rawOccurredAt" COLLATE "C"))[1]` : Prisma.sql`NULL::text`} AS "firstOccurredAt",
      ${bucket.kind === "run" ? Prisma.sql`(array_agg("rawOccurredAt" ORDER BY "occurredAt" DESC,"rawOccurredAt" COLLATE "C" DESC))[1]` : Prisma.sql`NULL::text`} AS "lastOccurredAt",
      ${bucket.kind === "totals" ? Prisma.sql`(array_agg("rawOccurredAt" ORDER BY "occurredAt" DESC,"rawOccurredAt" COLLATE "C" DESC) FILTER (WHERE spend AND ("unknownWeight"=1 OR "partialWeight"=1)))[1]` : Prisma.sql`NULL::text`} AS "latestPendingAt",
      ${bucket.kind === "run" ? Prisma.sql`jsonb_agg(DISTINCT jsonb_build_object('provider',"requestedProvider",'requestedModel',"requestedModel",'billing',billing))` : Prisma.sql`'[]'::jsonb`} AS identities,
      COALESCE(jsonb_agg(DISTINCT billing),'[]'::jsonb) AS billings,
      ${bucket.kind === "run" ? Prisma.sql`array_agg(DISTINCT "observationRoute")` : Prisma.sql`'{}'::text[]`} AS routes,
      bool_or("observationRoute"='direct') AS "hasDirectObservations",
      COUNT(*) FILTER (WHERE "observationRunId" IS NULL)::text AS "observationsWithoutRunId",
      MIN("callId") FILTER (WHERE spend AND "granularityRank"=0) AS "firstCall",
      MIN("callId") FILTER (WHERE spend AND "granularityRank"=1) AS "firstSummary"
      FROM raw WHERE true ${filter} ${group}`);
    costQueries.push(Prisma.sql`SELECT ${key} AS "bucketKey",currency,basis,SUM(amount)::text AS amount,
      MIN("callId") FILTER (WHERE "granularityRank"=0) AS "firstCall",
      MIN("callId") FILTER (WHERE "granularityRank"=1) AS "firstSummary"
      FROM raw WHERE spend AND amount IS NOT NULL ${filter}
      GROUP BY ${Prisma.join([...fields, Prisma.sql`currency`, Prisma.sql`basis`])}`);
  }
  return tx.$queryRaw<
    AggregateBucket[]
  >(Prisma.sql`/* usage-report:aggregates */ WITH
    ${familyRelation(scope)}, ${decisionRelation(decisions)},
    raw AS MATERIALIZED (
      SELECT u."callId",u."runId" AS "observationRunId",u."route" AS "observationRoute",
        ${usageRequestedProviderSql()} AS "requestedProvider",u."projection"#>>'{identity,requestedModel}' AS "requestedModel",
        ${usageBillingSql()} AS billing,
        COALESCE(u."projection"#>>'{usage,actualProvider}',${usageRequestedProviderSql()}) AS "observedProvider",
        u."projection"#>>'{usage,actualModel}' AS "observedModel",
        left(u."projection"#>>'{identity,occurredAt}',10) AS day,
        u."occurredAt",u."projection"#>>'{identity,occurredAt}' AS "rawOccurredAt",
        CASE WHEN u."projection"#>>'{identity,granularity}'='call' THEN 0 ELSE 1 END AS "granularityRank",
        (${selectedCandidate()}) AND p."includeSpend" AS spend,
        p."providerAttempt",p."partialWeight",p."unknownWeight",p."diagnosticWeight",p."summaryWeight",
        ${Prisma.join(tokenColumns)},
        u."projection"#>>'{usage,cost,currency}' AS currency,
        u."projection"#>>'{usage,cost,basis}' AS basis,
        (u."projection"#>>'{usage,cost,amount}')::numeric AS amount
      ${fromScope(scope)} JOIN profile_decisions p ON p."profileKey"=${profileKeySql()}
      WHERE ${scopePredicate(scope)} ${dimensions(scope.query)}
    ), metrics AS MATERIALIZED (
      ${Prisma.join(metricQueries, " UNION ALL ")}
    ), costs AS MATERIALIZED (
      ${Prisma.join(costQueries, " UNION ALL ")}
    ), cost_arrays AS (
      SELECT "bucketKey",jsonb_agg(jsonb_build_object('currency',currency,'basis',basis,'amount',amount)
        ORDER BY CASE WHEN "firstCall" IS NOT NULL THEN 0 ELSE 1 END,COALESCE("firstCall","firstSummary")) AS costs
      FROM costs GROUP BY "bucketKey"
    )
    SELECT m."bucketKey"->>0 AS kind,m."bucketKey"->>1 AS provider,m."bucketKey"->>2 AS model,
      m."bucketKey"->>3 AS route,m."bucketKey"->>4 AS day,m."bucketKey"->>5 AS "runId",
      m.totals||jsonb_build_object('costs',COALESCE(c.costs,'[]'::jsonb)) AS totals,
      m."observedModels",m."hasUnknownObservedModel",m."firstOccurredAt",m."lastOccurredAt",m."latestPendingAt",m.identities,m.billings,m.routes,
      m."hasDirectObservations",m."observationsWithoutRunId"
    FROM metrics m LEFT JOIN cost_arrays c USING ("bucketKey")
    ORDER BY m."bucketKey"->>0,
      CASE WHEN m."firstCall" IS NOT NULL THEN 0 WHEN m."firstSummary" IS NOT NULL THEN 1 ELSE 2 END,
      COALESCE(m."firstCall",m."firstSummary")`);
}

/** The caller owns one RepeatableRead snapshot, including authorization/auxiliary reads. */
export async function readPrismaUsagePeriodReport(
  tx: Prisma.TransactionClient,
  query: UsageReportQuery,
  operator = false,
) {
  // PG17's cost estimate for the Unicode cursor expression triggers expensive
  // JIT compilation even when its character-split branch never runs. Keep this
  // online report interpreted within its existing snapshot/timeout only.
  await tx.$queryRaw(
    Prisma.sql`/* usage-report:settings */ SELECT set_config('jit','off',true) AS jit`,
  );
  const scope = { query, operator };
  const selection = await readSelection(tx, scope);
  const profiles = await tx.$queryRaw<{ profile: UsageContributionProfile }[]>(
    Prisma.sql`/* usage-report:profiles */ SELECT DISTINCT ${profileSql()} AS profile
      ${fromScope(scope)} WHERE ${scopePredicate(scope)}`,
  );
  const decisions = profiles.map(({ profile }) => ({
    profileKey: [
      profile.granularity,
      profile.purpose,
      profile.usage?.state ?? null,
      profile.usage?.dispatchEffect ?? null,
      profile.usage?.completeness ?? null,
      profile.lifecycle?.state ?? null,
      profile.lifecycle?.dispatchEffect ?? null,
    ],
    ...classifyUsageContribution(profile),
  }));
  const facets = await tx.$queryRaw<
    { provider: string; requestedModel: string | null }[]
  >(
    Prisma.sql`/* usage-report:facets */ SELECT DISTINCT ${usageRequestedProviderSql()} AS provider,u."projection"#>>'{identity,requestedModel}' AS "requestedModel"
      ${fromScope(scope)} WHERE ${scopePredicate(scope)}`,
  );
  const page = await readProjectionPage(tx, scope, decisions);
  const runs = await readRunPage(tx, scope);
  const buckets = profiles.length
    ? await readAggregates(tx, scope, decisions, runs.runIds)
    : [];
  const totals = buckets.find((b) => b.kind === "totals");
  return buildUsagePeriodReportFromAggregates({
    query,
    buckets,
    facets,
    ...page,
    nextRunCursor: runs.nextRunCursor,
    partialChildCount: selection.partialChildCount,
    unboundedSummaryCount: selection.unboundedSummaryCount,
    hasDirectObservations: totals?.hasDirectObservations ?? false,
    observationsWithoutRunId: checkedUsageInteger(
      totals?.observationsWithoutRunId ?? "0",
    ),
    latestPendingAt: totals?.latestPendingAt ?? null,
  });
}
