import { createHash } from "node:crypto";
import { z } from "zod";
import type { PrismaClient } from "@reviewrouter/platform-db";
import {
  canonicalJson,
  IngestUsage,
  UsageError,
} from "@reviewrouter/features-provider-usage";
import {
  PrismaUsageStore,
  PrismaUsageAttributionReader,
} from "@reviewrouter/features-provider-usage/composition";
import {
  createGatewayUsageSource,
  gatewayUsageCallId,
  type GatewayUsageObservation,
} from "./provider-usage-gateway-source";
const token = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER)
  .nullable();
const observation = z
  .object({
    schemaVersion: z.literal(1),
    eventId: z.string().max(256),
    revision: z.number().int().nonnegative(),
    executionRef: z.string().max(256),
    requestRef: z.string().max(256),
    invocationRef: z.string().max(256),
    attemptRef: z.string().max(256),
    accountRef: z.string().max(256),
    profileId: z.string().max(256),
    model: z.string().max(256),
    occurredAt: z.iso.datetime(),
    effect: z.enum([
      "not_dispatched",
      "dispatch_started",
      "response_started",
      "completed",
      "effect_unknown",
      "rejected_before_dispatch",
    ]),
    completeness: z.enum(["partial", "complete"]),
    inputTokens: token,
    outputTokens: token,
    cachedInputTokens: token,
    reasoningTokens: token,
    cost: z.null(),
  })
  .strict();
/** Only the allowlisted safe observation is retained; payload hashes are immutable. */
export async function quarantineGatewayObservation(
  prisma: PrismaClient,
  sourceInstance: string,
  input: GatewayUsageObservation,
  reason = "usage_unattributed",
) {
  const safe = observation.parse(input);
  const bytes = canonicalJson(safe);
  const hash = createHash("sha256").update(bytes).digest("hex");
  const selector = {
    sourceInstance_eventId_revision: {
      sourceInstance,
      eventId: safe.eventId,
      revision: safe.revision,
    },
  };
  const saved = await prisma.usageUnattributedObservation.upsert({
    where: selector,
    create: {
      sourceInstance,
      eventId: safe.eventId,
      revision: safe.revision,
      hash,
      payload: JSON.parse(bytes),
      observedAt: new Date(safe.occurredAt),
      receivedAt: new Date(),
      reason,
    },
    update: {},
  });
  if (saved.hash !== hash) throw new UsageError("usage_hash_conflict");
}
export async function selectGatewayQuarantineBatch(
  prisma: PrismaClient,
  deployment: string,
  now: Date,
) {
  const observedAfter = new Date(now.getTime() - 30 * 86400000);
  // Every workspace reads the gateway's shared feed. Events belonging to other
  // workspaces therefore enter quarantine even when their call identity already
  // exists. Reserve half the batch for these directly matchable events so an
  // old, repeatedly unmatched backlog cannot delay fresh usage indefinitely.
  // Matching only selects candidates: the replay below still verifies the
  // immutable tenant, invocation, attempt and payload hash before ingestion.
  const matchable = await prisma.$queryRaw<
    {
      sourceInstance: string;
      eventId: string;
      revision: number;
      hash: string;
      payload: unknown;
    }[]
  >`SELECT q."sourceInstance", q."eventId", q."revision", q."hash", q."payload"
    FROM "UsageUnattributedObservation" q
    JOIN "UsageCall" c ON c."callId" = 'gw-' || encode(sha256(
      convert_to(q."payload"->>'executionRef', 'UTF8') || decode('00', 'hex') ||
      convert_to(q."payload"->>'requestRef', 'UTF8')), 'hex')
    WHERE q."sourceInstance" = ${deployment} AND q."resolvedAt" IS NULL
      AND q."nextResolutionAt" <= ${now} AND q."observedAt" >= ${observedAfter}
    ORDER BY q."nextResolutionAt", q."receivedAt", q."eventId", q."revision"
    LIMIT 50`;
  const oldest = await prisma.usageUnattributedObservation.findMany({
    where: {
      sourceInstance: deployment,
      resolvedAt: null,
      nextResolutionAt: { lte: now },
      observedAt: { gte: observedAfter },
      NOT: matchable.map(({ eventId, revision }) => ({ eventId, revision })),
    },
    orderBy: [
      { nextResolutionAt: "asc" },
      { receivedAt: "asc" },
      { eventId: "asc" },
      { revision: "asc" },
    ],
    take: 100 - matchable.length,
  });
  return [...matchable, ...oldest];
}

/** Late attribution never guesses a tenant; replay only after a canonical lifecycle identity exists. */
export async function replayGatewayQuarantine(
  prisma: PrismaClient,
  deployment: string,
) {
  const rows = await selectGatewayQuarantineBatch(
    prisma,
    deployment,
    new Date(),
  );
  const ingest = new IngestUsage(new PrismaUsageStore(prisma));
  let resolved = 0;
  for (const row of rows) {
    await prisma.usageUnattributedObservation.updateMany({
      where: {
        sourceInstance: row.sourceInstance,
        eventId: row.eventId,
        revision: row.revision,
        resolvedAt: null,
      },
      data: { nextResolutionAt: new Date(Date.now() + 5 * 60_000) },
    });
    const parsed = observation.safeParse(row.payload);
    if (!parsed.success) continue;
    const native = parsed.data;
    const bytes = canonicalJson(native);
    if (createHash("sha256").update(bytes).digest("hex") !== row.hash)
      throw new UsageError("usage_hash_conflict");
    const call = await prisma.usageCall.findUnique({
      where: {
        callId: gatewayUsageCallId(native.executionRef, native.requestRef),
      },
      select: { workspaceId: true },
    });
    if (!call) continue;
    const source = createGatewayUsageSource({
      workspaceId: call.workspaceId,
      sourceInstance: deployment + "/" + call.workspaceId,
      attribution: new PrismaUsageAttributionReader(prisma),
      client: {
        listUsage: async () => ({
          observations: [native],
          nextCursor: "replay",
          highWaterCursor: "replay",
        }),
      },
      quarantine: async () => {},
    });
    const page = await source.listUsage({
      afterCursor: null,
      highWaterMark: null,
      limit: 1,
    });
    for (const fact of page.facts)
      await ingest.execute(fact, {
        workspaceId: call.workspaceId,
        invocationId: fact.identity.invocationId,
        source: "native",
        now: new Date(),
        replayUntil: new Date(Date.now() + 60_000),
      });
    if (page.facts.length) {
      await prisma.usageUnattributedObservation.updateMany({
        where: {
          sourceInstance: row.sourceInstance,
          eventId: row.eventId,
          revision: row.revision,
          hash: row.hash,
          resolvedAt: null,
        },
        data: { resolvedAt: new Date(), workspaceId: call.workspaceId },
      });
      resolved++;
    }
  }
  return resolved;
}
