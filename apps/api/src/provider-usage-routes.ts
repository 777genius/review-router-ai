import { providerUsageConfiguredProvider } from "./provider-usage-provider.js";
import type { UsageRunScope } from "./provider-usage-run-completion.js";
import type { Prisma } from "@prisma/client";
import { providerUsagePriceSnapshots } from "./provider-usage-price-snapshot.js";
import {
  createHash,
  createPublicKey,
  randomBytes,
  randomUUID,
  verify,
} from "node:crypto";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { parseReviewConfigurationStrict } from "@reviewrouter/features-review-config";
import type { PrismaClient } from "@reviewrouter/platform-db";
import {
  canonicalJson,
  UsageError,
  validateUsagePriceSnapshot,
  type UsagePriceSnapshot,
  type UsagePriceSnapshotReader,
  type UsageFact,
} from "@reviewrouter/features-provider-usage";
import {
  PrismaUsageStore,
  PrismaUsageReportReader,
  createProviderUsage,
} from "@reviewrouter/features-provider-usage/composition";
import {
  parseReviewRunRuntimeSnapshot,
  type ManageReviewRunAuthorizations,
  type ReviewRunAuthorization,
} from "@reviewrouter/features-review-run-control";
const day = 86400000;
const text = z.string().min(1).max(256);
const nullableText = text.nullable();
const quantity = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER)
  .nullable();
const factSchema = z
  .object({
    schemaVersion: z.literal(1),
    sourceInstance: text,
    eventId: text,
    revision: z.number().int().positive(),
    authority: z.enum(["lifecycle", "native", "runtime", "runner"]),
    identity: z
      .object({
        callId: text,
        workspaceId: text,
        repositoryId: nullableText,
        actorId: nullableText,
        runId: nullableText,
        runAttempt: z.number().int().positive().nullable(),
        invocationId: text,
        attemptId: text,
        bindingId: nullableText,
        authorizationId: text,
        route: z.enum(["gateway", "direct"]),
        purpose: z.enum(["review", "diagnostic"]),
        provider: text,
        requestedModel: nullableText,
        runtimeType: text,
        parentScope: nullableText,
        granularity: z.enum(["call", "turn"]),
        occurredAt: z.iso.datetime(),
      })
      .strict(),
    actualProvider: nullableText,
    actualModel: nullableText,
    tokens: z
      .object({
        inputTotal: quantity,
        outputTotal: quantity,
        cacheRead: quantity,
        cacheWrite: quantity,
        reasoning: quantity,
        total: quantity,
      })
      .strict(),
    cost: z
      .object({
        amount: z.string().regex(/^(0|[1-9]\d{0,17})(\.\d{1,12})?$/),
        currency: z.string().regex(/^[A-Z]{3}$/),
        basis: z.enum(["estimated", "source_reported"]),
        source: text,
        asOf: z.iso.datetime(),
        priceVersion: nullableText,
      })
      .strict()
      .nullable(),
    completeness: z.enum(["complete", "partial", "unknown"]),
    state: z.enum([
      "prepared",
      "dispatched",
      "completed",
      "failed",
      "cancelled",
      "unknown",
    ]),
    dispatchEffect: z.enum(["not_dispatched", "dispatched", "effect_unknown"]),
    durationMs: quantity,
    ttftMs: quantity,
    correctionReason: nullableText,
    childCallIds: z.array(text).max(10000).nullable(),
    serviceTier: nullableText.optional(),
  })
  .strict();
const producerCoverageSchema = z
  .object({
    schemaVersion: z.literal(1),
    revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    state: z.literal("partial"),
    reason: z.enum([
      "spool_overflow",
      "spool_write_failed",
      "delivery_failed",
      "producer_unavailable",
    ]),
    droppedEvents: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    occurredAt: z.iso.datetime(),
  })
  .strict();
export type ProducerCoverage = z.infer<typeof producerCoverageSchema>;
export function selectProducerCoverage(
  previous: unknown,
  next: ProducerCoverage,
): ProducerCoverage {
  const parsed = producerCoverageSchema.safeParse(previous);
  if (!parsed.success) return next;
  const old = parsed.data;
  if (old.revision > next.revision) return old;
  if (old.revision === next.revision) {
    if (canonicalJson(old) !== canonicalJson(next))
      throw new UsageError("usage_hash_conflict");
    return old;
  }
  if (
    next.droppedEvents < old.droppedEvents ||
    next.occurredAt < old.occurredAt
  )
    throw new UsageError("usage_invalid_fact");
  return next;
}
const reportSchema = z
  .object({
    schemaVersion: z.literal(1),
    producerDigest: text,
    workflowIdentity: text,
    jobIdentity: text,
    facts: z.array(factSchema).max(100),
    producerCoverage: producerCoverageSchema.optional(),
  })
  .strict();
const artifactSchema = reportSchema
  .extend({
    grantId: text,
    invocationId: text,
    runAttempt: z.number().int().positive(),
    eventHashes: z.array(z.string().regex(/^[a-f0-9]{64}$/)).max(100),
    signature: z.string().max(256),
  })
  .strict();
const grantSchema = z
  .object({
    invocationId: text.optional(),
    publicKey: z.string().min(32).max(2048),
  })
  .strict();
export interface TrustedBootstrapUsagePrincipal {
  workspaceId: string;
  repositoryId: string;
  runId: string;
  runAttempt: number;
  authorizationId: string;
  invocationId: string;
  actorId: string | null;
  bindingId: null;
  producerDigest: string;
  workflowIdentity: string;
  jobIdentity: string;
  provider: "codex";
  requestedModel: null;
  runtimeType: "codex-refresh-bootstrap";
  purpose: "diagnostic";
  deadline: Date;
  githubInstallationId: string;
  repositoryFullName: string;
  bootstrapLeaseId: string;
}
export type TrustedActionSessionUsagePrincipal = Omit<
  TrustedBootstrapUsagePrincipal,
  "provider" | "requestedModel" | "runtimeType" | "purpose" | "bootstrapLeaseId"
> & {
  provider: string;
  requestedModel: string | null;
  runtimeType: string;
  purpose: "review";
};
const actionSessionScopeSchema = z
  .object({
    provider: text,
    requestedModel: nullableText,
    runtimeType: text,
    purpose: z.literal("review"),
    route: z.literal("direct"),
  })
  .strict();
const bootstrapScopeSchema = z
  .object({
    provider: z.literal("codex"),
    requestedModel: z.null(),
    runtimeType: z.literal("codex-refresh-bootstrap"),
    purpose: z.literal("diagnostic"),
    route: z.literal("direct"),
  })
  .strict();
export type UsageExecutionAuthorizations = Pick<
  ManageReviewRunAuthorizations,
  "resolveReviewRunAuthorizationToken"
>;
export type UsageRepositoryAuthority = (
  authorization: ReviewRunAuthorization,
) => Promise<{
  githubRepositoryId: string;
  githubInstallationId: string;
  repositoryFullName: string;
} | null>;
export interface ProviderUsageDependencies {
  resolveRunClosedAt?: (scope: UsageRunScope) => Promise<Date | null>;
  priceSnapshots?: UsagePriceSnapshotReader;
  resolveActor?: (
    auth: ReviewRunAuthorization,
    target: NonNullable<Awaited<ReturnType<UsageRepositoryAuthority>>>,
  ) => Promise<string | null>;
  prisma: PrismaClient;
  authorizations?: UsageExecutionAuthorizations;
  resolveRepository?: UsageRepositoryAuthority;
  confirmAuthority?: (
    token: string,
    auth: ReviewRunAuthorization,
    target: NonNullable<Awaited<ReturnType<UsageRepositoryAuthority>>>,
  ) => Promise<boolean>;
}
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
class UsageAccessError extends Error {
  constructor(
    readonly code: string,
    readonly status = 403,
  ) {
    super(code);
  }
}
export function createProviderUsageApi(input: ProviderUsageDependencies) {
  const feature = createProviderUsage({
    store: new PrismaUsageStore(input.prisma),
    reports: new PrismaUsageReportReader(input.prisma),
  });
  async function persistGrant(
    data: Prisma.ProviderUsageGrantUncheckedCreateInput,
    execution?: { authorizationId: string; version: number },
  ) {
    return input.prisma.$transaction(async (tx) => {
      const scopes = await tx.$queryRaw<
        { deletionState: string }[]
      >`SELECT "deletionState" FROM "Workspace" WHERE "id"=${data.workspaceId} FOR SHARE`;
      if (scopes[0]?.deletionState !== "active")
        throw new UsageAccessError("usage_scope_deleted", 410);
      if (execution) {
        const active = await tx.$queryRaw<
          { authorizationId: string }[]
        >`SELECT "authorizationId" FROM "ReviewRunAuthorization" WHERE "authorizationId"=${execution.authorizationId} AND "version"=${execution.version} AND "state"='active' AND "expiresAt">(statement_timestamp() AT TIME ZONE 'UTC') AND "maxExpiresAt">(statement_timestamp() AT TIME ZONE 'UTC') FOR SHARE`;
        if (!active.length)
          throw new UsageAccessError("usage_execution_denied");
      }
      return tx.providerUsageGrant.create({ data });
    });
  }
  async function issue(token: string, body: unknown) {
    if (
      !input.authorizations ||
      !input.resolveRepository ||
      !input.confirmAuthority
    )
      throw new UsageAccessError("usage_execution_unavailable", 503);
    const request = grantSchema.parse(body);
    const key = createPublicKey(request.publicKey);
    if (key.asymmetricKeyType !== "ed25519")
      throw new UsageAccessError("usage_invalid_public_key", 400);
    const resolution =
      await input.authorizations.resolveReviewRunAuthorizationToken({ token });
    if (resolution.status !== "valid")
      throw new UsageAccessError("usage_execution_denied", 401);
    const auth = resolution.authorization;
    const target = await input.resolveRepository(auth);
    if (
      !target ||
      !/^\d+$/.test(target.githubRepositoryId) ||
      !(await input.confirmAuthority(token, auth, target))
    )
      throw new UsageAccessError("usage_execution_denied");
    const snapshot = parseReviewRunRuntimeSnapshot(
      auth.runtimeSnapshotCanonicalJson,
    );
    if (!snapshot) throw new UsageAccessError("usage_runtime_unavailable");
    const release = await input.prisma.producerRelease.findUnique({
      where: { producerReleaseId: auth.producerReleaseId },
    });
    if (!release || release.revokedAt)
      throw new UsageAccessError("usage_producer_denied");
    const invocationId =
      snapshot.gateway?.invocationId ?? `${auth.authorizationId}-provider-api`;
    if (request.invocationId && request.invocationId !== invocationId)
      throw new UsageAccessError("usage_scope_mismatch");
    const now = new Date();
    if (auth.expiresAt <= now || auth.maxExpiresAt <= now)
      throw new UsageAccessError("usage_execution_denied");
    const grantId = randomUUID();
    const actorId = (await input.resolveActor?.(auth, target)) ?? null;
    const grantToken = "rr-usage-v1-" + randomBytes(32).toString("base64url");
    const scope = {
      workspaceId: auth.workspaceId,
      invocationId,
      repositoryId: target.githubRepositoryId,
      runId: auth.sourceRunId,
      runAttempt: Number(auth.sourceRunAttempt),
      authorizationId: auth.authorizationId,
      actorId,
      bindingId: snapshot.gateway?.bindingId ?? null,
      producerDigest: release.runtimeEntrypointDigest,
      workflowIdentity: auth.workflowIdentityHash,
      jobIdentity: auth.oidcReplayKeyHash,
    };
    if (!Number.isSafeInteger(scope.runAttempt) || scope.runAttempt < 1)
      throw new UsageAccessError("usage_scope_mismatch");
    // A lease may close early; every ingest rechecks closure and caps the replay window.
    const expiresAt = new Date(
      Math.min(now.getTime() + 8 * day, auth.maxExpiresAt.getTime() + 7 * day),
    );
    const config = parseReviewConfigurationStrict(
      JSON.parse(snapshot.configurationCanonicalJson),
    );
    const provider = config.providers[snapshot.gateway?.providerIndex ?? 0];
    if (!provider) throw new UsageAccessError("usage_scope_mismatch");
    const priceSnapshot = await (
      input.priceSnapshots ?? (await providerUsagePriceSnapshots())
    )
      .read({
        provider: providerUsageConfiguredProvider(provider).provider,
        model: providerUsageConfiguredProvider(provider).requestedModel,
        occurredAt: now.toISOString(),
        tier: "standard",
      })
      .catch(() => null);
    const grant = await persistGrant(
      {
        id: grantId,
        tokenHash: hash(grantToken),
        ...scope,
        ...(priceSnapshot ? { priceSnapshot: { ...priceSnapshot } } : {}),
        githubInstallationId: target.githubInstallationId,
        repositoryFullName: target.repositoryFullName,
        publicKey: key.export({ format: "pem", type: "spki" }).toString(),
        issuedAt: now,
        expiresAt,
      },
      { authorizationId: auth.authorizationId, version: auth.version },
    );
    return {
      grantId: grant.id,
      grantToken,
      expiresAt: expiresAt.toISOString(),
      scope: {
        ...scope,
        sourceInstance: `runner/${grant.id}`,
        callIdPrefix: `${grant.id}-`,
        provider: providerUsageConfiguredProvider(provider).provider,
        requestedModel:
          providerUsageConfiguredProvider(provider).requestedModel,
        runtimeType: snapshot.agent.agentKind,
        route: snapshot.gateway ? "gateway" : "direct",
        purpose: "review" as const,
      },
    };
  }
  async function issueTrustedReportGrant(
    principal:
      | TrustedBootstrapUsagePrincipal
      | TrustedActionSessionUsagePrincipal,
    publicKeyPem: string,
  ) {
    const key = createPublicKey(publicKeyPem);
    if (key.asymmetricKeyType !== "ed25519")
      throw new UsageAccessError("usage_invalid_public_key", 400);
    if (
      !/^\d+$/.test(principal.repositoryId) ||
      !/^\d+$/.test(principal.runId) ||
      !Number.isSafeInteger(principal.runAttempt) ||
      principal.runAttempt < 1 ||
      principal.deadline <= new Date()
    )
      throw new UsageAccessError("usage_scope_mismatch");
    const now = new Date();
    const id = randomUUID();
    const grantToken = "rr-usage-v1-" + randomBytes(32).toString("base64url");
    const {
      deadline,
      provider,
      requestedModel,
      runtimeType,
      purpose,
      ...scope
    } = principal;
    const reportScope = (
      purpose === "diagnostic" ? bootstrapScopeSchema : actionSessionScopeSchema
    ).parse({
      provider,
      requestedModel,
      runtimeType,
      purpose,
      route: "direct",
    });
    const expiresAt = new Date(
      Math.min(now.getTime() + 8 * day, deadline.getTime() + 7 * day),
    );
    const priceSnapshot =
      purpose === "review" && requestedModel
        ? await (input.priceSnapshots ?? (await providerUsagePriceSnapshots()))
            .read({
              provider,
              model: requestedModel,
              occurredAt: now.toISOString(),
              tier: "standard",
            })
            .catch(() => null)
        : null;
    await persistGrant({
      id,
      tokenHash: hash(grantToken),
      ...scope,
      purpose,
      ...(priceSnapshot ? { priceSnapshot: { ...priceSnapshot } } : {}),
      ...(purpose === "diagnostic"
        ? { bootstrapScope: reportScope }
        : { actionSessionScope: reportScope }),
      publicKey: key.export({ type: "spki", format: "pem" }).toString(),
      issuedAt: now,
      expiresAt,
    });
    return {
      grantId: id,
      grantToken,
      expiresAt: expiresAt.toISOString(),
      scope: {
        ...scope,
        ...reportScope,
        sourceInstance: `runner/${id}`,
        callIdPrefix: `${id}-`,
      },
    };
  }
  const issueTrustedBootstrapGrant = (
    principal: TrustedBootstrapUsagePrincipal,
    publicKeyPem: string,
  ) => issueTrustedReportGrant(principal, publicKeyPem);
  const issueTrustedActionSessionGrant = (
    principal: TrustedActionSessionUsagePrincipal,
    publicKeyPem: string,
  ) => issueTrustedReportGrant(principal, publicKeyPem);
  async function activeGrant(selector: { tokenHash: string } | { id: string }) {
    const grant = await input.prisma.providerUsageGrant.findUnique({
      where: selector,
    });
    if (!grant) throw new UsageAccessError("usage_grant_denied", 401);
    const workspace = await input.prisma.workspace.findUnique({
      where: { id: grant.workspaceId },
      select: { deletionState: true },
    });
    if (!workspace || workspace.deletionState !== "active") {
      await input.prisma.providerUsageGrant.updateMany({
        where: { workspaceId: grant.workspaceId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UsageAccessError("usage_scope_deleted", 410);
    }
    if (grant.revokedAt) throw new UsageAccessError("usage_grant_revoked");
    const auth = await input.prisma.reviewRunAuthorization.findUnique({
      where: { authorizationId: grant.authorizationId },
      select: {
        state: true,
        expiresAt: true,
        revokedAt: true,
        runtimeSnapshotCanonicalJson: true,
      },
    });
    if (!grant.closedAt && Date.now() > grant.issuedAt.getTime() + 7 * day) {
      if (!input.resolveRunClosedAt)
        throw new UsageAccessError("usage_run_completion_unavailable", 503);
      let completed: Date | null;
      try {
        completed = await input.resolveRunClosedAt(grant);
      } catch {
        throw new UsageAccessError("usage_run_completion_unavailable", 503);
      }
      if (completed) {
        if (
          !Number.isFinite(completed.getTime()) ||
          completed.getTime() < grant.issuedAt.getTime() - 300000 ||
          completed.getTime() > Date.now() + 300000
        )
          throw new UsageAccessError("usage_scope_mismatch");
        await input.prisma.providerUsageGrant.updateMany({
          where: {
            id: grant.id,
            OR: [{ closedAt: null }, { closedAt: { gt: completed } }],
          },
          data: { closedAt: completed },
        });
        grant.closedAt = completed;
      }
    }
    const close =
      grant.closedAt ??
      (auth?.state !== "active"
        ? (auth?.revokedAt ?? auth?.expiresAt)
        : auth.expiresAt <= new Date()
          ? auth.expiresAt
          : null);
    const replayUntil = new Date(
      Math.min(
        grant.expiresAt.getTime(),
        close ? close.getTime() + 7 * day : Infinity,
      ),
    );
    if (Date.now() > replayUntil.getTime())
      throw new UsageAccessError("usage_report_expired", 410);
    return {
      grant,
      replayUntil,
      bootstrapScope: bootstrapScopeSchema.safeParse(grant.bootstrapScope),
      actionSessionScope: actionSessionScopeSchema.safeParse(
        grant.actionSessionScope,
      ),
      snapshot: parseReviewRunRuntimeSnapshot(
        auth?.runtimeSnapshotCanonicalJson,
      ),
    };
  }
  async function recordCoverage(
    g: { id: string; workspaceId: string; issuedAt: Date },
    next: ProducerCoverage,
  ) {
    if (
      Date.parse(next.occurredAt) < g.issuedAt.getTime() - 300000 ||
      Date.parse(next.occurredAt) > Date.now() + 300000
    )
      throw new UsageError("usage_invalid_fact");
    return input.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        { producerCoverage: unknown }[]
      >`SELECT "producerCoverage" FROM "ProviderUsageGrant" WHERE "id"=${g.id} AND "revokedAt" IS NULL AND EXISTS (SELECT 1 FROM "Workspace" WHERE "id"=${g.workspaceId} AND "deletionState"='active') FOR UPDATE`;
      if (!rows[0]) throw new UsageAccessError("usage_scope_deleted", 410);
      const selected = selectProducerCoverage(rows[0].producerCoverage, next);
      await tx.providerUsageGrant.update({
        where: { id: g.id },
        data: { producerCoverage: selected },
      });
      return selected.revision;
    });
  }
  async function accept(
    grant: Awaited<ReturnType<typeof activeGrant>>,
    body: z.infer<typeof reportSchema>,
  ) {
    const g = grant.grant;
    if (!body.facts.length && !body.producerCoverage)
      throw new UsageAccessError("usage_invalid_payload", 400);
    if (
      body.producerDigest !== g.producerDigest ||
      body.workflowIdentity !== g.workflowIdentity ||
      body.jobIdentity !== g.jobIdentity
    )
      throw new UsageAccessError("usage_scope_mismatch");
    const snapshot = grant.snapshot;
    const bootstrap = grant.bootstrapScope.success
      ? grant.bootstrapScope.data
      : null;
    const actionSession = grant.actionSessionScope.success
      ? grant.actionSessionScope.data
      : null;
    if (!snapshot && !bootstrap && !actionSession)
      throw new UsageAccessError("usage_runtime_unavailable");
    const config = snapshot
      ? parseReviewConfigurationStrict(
          JSON.parse(snapshot.configurationCanonicalJson),
        )
      : null;
    const provider = config?.providers[snapshot?.gateway?.providerIndex ?? 0];
    const expected =
      bootstrap ??
      actionSession ??
      (provider && snapshot
        ? {
            provider: providerUsageConfiguredProvider(provider).provider,
            requestedModel:
              providerUsageConfiguredProvider(provider).requestedModel,
            runtimeType: snapshot.agent.agentKind,
            purpose: "review",
          }
        : null);
    if (!expected) throw new UsageAccessError("usage_scope_mismatch");
    let priceSnapshot: UsagePriceSnapshot | null = null;
    try {
      validateUsagePriceSnapshot(g.priceSnapshot);
      priceSnapshot = g.priceSnapshot;
    } catch {
      // No pinned snapshot means an unknown estimate; never fetch current prices here.
    }
    const facts: UsageFact[] = body.facts.map(({ serviceTier, ...fact }) => ({
      ...fact,
      ...(serviceTier === undefined ? {} : { serviceTier }),
    }));

    for (const fact of facts) {
      const i = fact.identity;
      if (
        fact.sourceInstance !== `runner/${g.id}` ||
        (!g.bindingId && !i.callId.startsWith(`${g.id}-`)) ||
        i.provider !== expected.provider ||
        i.requestedModel !== expected.requestedModel ||
        i.runtimeType !== expected.runtimeType ||
        i.workspaceId !== g.workspaceId ||
        i.repositoryId !== g.repositoryId ||
        i.runId !== g.runId ||
        i.runAttempt !== g.runAttempt ||
        i.invocationId !== g.invocationId ||
        i.authorizationId !== g.authorizationId ||
        i.actorId !== g.actorId ||
        i.bindingId !== g.bindingId ||
        fact.authority === "native" ||
        fact.cost?.basis === "estimated" ||
        i.purpose !== expected.purpose ||
        (i.route === "gateway") !== (g.bindingId !== null)
      )
        throw new UsageAccessError("usage_scope_mismatch");
    }
    const accepted = [];
    for (const fact of facts) {
      const result = await (
        await feature
      ).ingestUsage.execute(fact, {
        workspaceId: g.workspaceId,
        invocationId: g.invocationId,
        source: "runner",
        now: new Date(),
        replayUntil: grant.replayUntil,
        serverPriceSnapshot: priceSnapshot,
        originalEventNotBefore: g.issuedAt,
      });
      accepted.push({
        eventId: fact.eventId,
        revision: fact.revision,
        ...result,
        hash: hash(canonicalJson(fact)),
      });
    }
    const producerCoverageRevision = body.producerCoverage
      ? await recordCoverage(g, body.producerCoverage)
      : undefined;
    return {
      accepted,
      ...(producerCoverageRevision === undefined
        ? {}
        : { producerCoverageRevision }),
    };
  }
  async function verifyArtifact(
    raw: unknown,
    run: {
      repositoryId: string;
      runId: string;
      runAttempt: number;
      artifactName: string;
    },
    g: {
      id: string;
      repositoryId: string;
      runId: string;
      runAttempt: number;
      invocationId: string;
      producerDigest: string;
      workflowIdentity: string;
      jobIdentity: string;
      publicKey: string;
    },
  ) {
    const artifact = artifactSchema.parse(raw);
    if (
      artifact.grantId !== g.id ||
      run.repositoryId !== g.repositoryId ||
      run.runId !== g.runId ||
      run.runAttempt !== g.runAttempt ||
      artifact.invocationId !== g.invocationId ||
      artifact.runAttempt !== g.runAttempt ||
      run.artifactName !==
        `reviewrouter-usage-v1-${g.invocationId}-${g.runAttempt}`
    )
      throw new UsageAccessError("usage_scope_mismatch");
    const { signature, ...signed } = artifact;
    if (
      artifact.eventHashes.length !== artifact.facts.length ||
      artifact.eventHashes.some(
        (h, i) => h !== hash(canonicalJson(artifact.facts[i])),
      ) ||
      !verify(
        null,
        Buffer.from(canonicalJson(signed)),
        g.publicKey,
        Buffer.from(signature, "base64"),
      )
    )
      throw new UsageAccessError("usage_signature_invalid");
    if (
      artifact.producerDigest !== g.producerDigest ||
      artifact.workflowIdentity !== g.workflowIdentity ||
      artifact.jobIdentity !== g.jobIdentity
    )
      throw new UsageAccessError("usage_scope_mismatch");
    return artifact;
  }
  return {
    issue,
    issueTrustedBootstrapGrant,
    issueTrustedActionSessionGrant,
    verifyArtifactForDeletion: async (
      raw: unknown,
      run: {
        grantId: string;
        repositoryId: string;
        runId: string;
        runAttempt: number;
        artifactName: string;
      },
    ) => {
      const grant = await input.prisma.providerUsageGrant.findUnique({
        where: { id: run.grantId },
      });
      if (!grant) throw new UsageAccessError("usage_grant_denied");
      await verifyArtifact(raw, run, grant);
    },
    report: async (token: string, raw: unknown) =>
      accept(
        await activeGrant({ tokenHash: hash(token) }),
        reportSchema.parse(raw),
      ),
    /** Called only by the App-owned run artifact reader; no browser supplied artifact URL. */
    recover: async (
      raw: unknown,
      run: {
        repositoryId: string;
        runId: string;
        runAttempt: number;
        artifactName: string;
      },
    ) => {
      const artifact = artifactSchema.parse(raw);
      const active = await activeGrant({ id: artifact.grantId });
      await verifyArtifact(raw, run, active.grant);
      return accept(active, {
        schemaVersion: 1,
        producerDigest: artifact.producerDigest,
        workflowIdentity: artifact.workflowIdentity,
        jobIdentity: artifact.jobIdentity,
        facts: artifact.facts,
        ...(artifact.producerCoverage
          ? { producerCoverage: artifact.producerCoverage }
          : {}),
      });
    },
  };
}
export type ProviderUsageApi = ReturnType<typeof createProviderUsageApi>;
export async function registerProviderUsageRoutes(
  app: FastifyInstance,
  api: ProviderUsageApi,
) {
  for (const [path, handler] of [
    ["grants", api.issue],
    ["reports", api.report],
  ] as const)
    app.post(
      `/api/provider-usage/${path}`,
      { bodyLimit: 1024 * 1024 },
      async (request, reply) => {
        const bearer =
          request.headers.authorization?.match(/^Bearer ([^\s]+)$/)?.[1];
        if (!bearer)
          return reply.code(401).send({ error: "usage_grant_denied" });
        try {
          return await handler(bearer, request.body);
        } catch (error) {
          if (error instanceof z.ZodError)
            return reply.code(400).send({ error: "usage_invalid_payload" });
          if (error instanceof UsageAccessError)
            return reply.code(error.status).send({ error: error.code });
          if (error instanceof UsageError)
            return reply
              .code(error.code === "usage_report_expired" ? 410 : 409)
              .send({ error: error.code });
          request.log.error({ event: "provider_usage_request_failed" });
          return reply.code(503).send({ error: "usage_unavailable" });
        }
      },
    );
}
