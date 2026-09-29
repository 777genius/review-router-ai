import { parseInvestigationAuthorizationDescriptorJson } from "../../domain/hosted-v4-relay-descriptor";
import { createHash, randomUUID } from "node:crypto";
import { Prisma, type HostedCodexInvocationGrant, type PrismaClient } from "@prisma/client";
import type {
  HostedV4GrantReservation,
  HostedV4GrantReservationInput,
  HostedV4PreparedRequest,
  HostedV4PreparedRequestInput,
  HostedV4RelayDurableStatus,
  HostedV4RelayTurnPort,
} from "../../application/ports/hosted-v4-relay-turn-port";
import {
  canonicalScope,
  defineHostedV4RelayGrant,
  hostedV4RelayCanaryAccountRequestAllocation,
  hostedV4RelayCanaryPolicyFingerprint,
  hostedV4RelayCanaryPolicyVersion,
  type HostedV4RelayGrantContract,
} from "../../domain/hosted-v4-relay-grant";

function v4AdmissionEnabled(githubRepositoryId: string): boolean {
  return process.env.REVIEW_ROUTER_HOSTED_V4_RELAY_ENABLED === "1" &&
    process.env.REVIEW_ROUTER_HOSTED_V4_DISPOSABLE_REPOSITORY_ID === githubRepositoryId;
}

function retryableReservationConflict(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  // Prisma 7.8's adapter can omit the SQLSTATE from P2010 meta even when
  // meta itself exists. Accept the exact raw-query diagnostic in that case;
  // an explicit, different meta SQLSTATE must always take precedence.
  const failure = error as { code?: unknown; meta?: unknown };
  if (failure.code === "P2010") {
    const metaCode = typeof failure.meta === "object" && failure.meta !== null
      ? (failure.meta as { code?: unknown }).code : undefined;
    if (metaCode !== undefined && metaCode !== null) return metaCode === "40001";
    return error instanceof Error &&
      /(?:^|\n)Raw query failed\. Code: `40001`\. Message: `(?:ERROR: )?could not serialize access due to (?:concurrent (?:update|delete)|read\/write dependencies among transactions)`(?:\n|$)/.test(error.message);
  }
  return error instanceof Prisma.PrismaClientKnownRequestError &&
    (failure.code === "P2002" || failure.code === "P2034");
}

/** Sticky turn history. Reissue with a replacement lease cannot reset it. */
export class PrismaHostedV4RelayTurn implements HostedV4RelayTurnPort {
  constructor(private readonly prisma: PrismaClient) {}

  /** Reserve one immutable turn and grant. The token issuer supplies a
   * deterministic bearer hash; this transaction never handles its plaintext. */
  async reserveGrant(input: HostedV4GrantReservationInput): Promise<HostedV4GrantReservation> {
    const { contract, accountId, credentialGeneration } = input;
    if (!/^[1-9]\d*$/.test(contract.scope.githubRepositoryId))
      throw new Error("hosted_v4_relay_grant_facts_invalid");
    const verified = defineHostedV4RelayGrant({
      scope: contract.scope, now: new Date(),
      maxRequests: contract.maxRequests,
      maxRequestBytes: contract.maxRequestBytes,
      maxResponseBytes: contract.maxResponseBytes,
      maxOutputTokens: contract.maxOutputTokens,
    });
    if (contract.logicalTurnKey !== verified.logicalTurnKey ||
        contract.scopeHash !== verified.scopeHash ||
        contract.expiresAt.getTime() !== verified.expiresAt.getTime() ||
        contract.maxConcurrentRequests !== 1 ||
        !/^[a-f0-9]{64}$/.test(input.capabilityTokenHash) ||
        !Number.isSafeInteger(input.runtimeConfigVersion) ||
        input.runtimeConfigVersion < 1 ||
        contract.scope.policyFingerprint !== hostedV4RelayCanaryPolicyFingerprint({
          accountId, runtimeConfigVersion: input.runtimeConfigVersion,
          model: contract.scope.model, maxRequests: contract.maxRequests,
          maxRequestBytes: contract.maxRequestBytes,
          maxResponseBytes: contract.maxResponseBytes,
          maxOutputTokens: contract.maxOutputTokens,
        })) {
      throw new Error("hosted_v4_relay_grant_facts_invalid");
    }
    const grantId = `v4-grant-${contract.logicalTurnKey}`;
    const invocationId = `v4-turn-${contract.logicalTurnKey}`;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const databaseTime = await tx.$queryRaw<Array<{ now: Date }>>(Prisma.sql`
            SELECT clock_timestamp() AS "now"
          `);
          const now = databaseTime[0]?.now;
          if (!now || contract.expiresAt <= now)
            throw new Error("hosted_v4_relay_turn_expired");
          // Release is the first row lock in either reservation path. A
          // revoker that committed after the clock read forces a fresh retry.
          const releaseRegistered = await lockCurrentProducerRelease(
            tx, contract.scope.producerReleaseId,
          );
          const priorTurn = await tx.hostedCodexV4RelayTurn.findUnique({
            where: { logicalTurnKey: contract.logicalTurnKey },
            select: { state: true },
          });
          if (!releaseRegistered && !priorTurn)
            throw new Error("hosted_v4_relay_reservation_authority_stale");
          if (!priorTurn && !v4AdmissionEnabled(contract.scope.githubRepositoryId))
            throw new Error("hosted_v4_relay_admission_disabled");
          if (!priorTurn) await this.reserveInTransaction(tx, contract);
          const turnState = await assertScopeLocked(tx, contract, false);
          await tx.$queryRaw(Prisma.sql`
            SELECT "id" FROM public."HostedCodexInvocationGrant"
            WHERE "v4TurnKey" = ${contract.logicalTurnKey} FOR UPDATE
          `);
          const existing = await tx.hostedCodexInvocationGrant.findUnique({
            where: { v4TurnKey: contract.logicalTurnKey },
          });
          if (existing &&
              (existing.id !== grantId || existing.authorityKind !== "v4_relay_turn" ||
               existing.v4ScopeHash !== contract.scopeHash ||
               existing.capabilityTokenHash !== input.capabilityTokenHash ||
               existing.invocationId !== invocationId ||
               existing.runtimeConfigVersion !== input.runtimeConfigVersion ||
               existing.policyVersion !== hostedV4RelayCanaryPolicyVersion ||
               existing.activeAccountId !== accountId ||
               existing.expiresAt.getTime() !== contract.expiresAt.getTime())) {
            throw new Error("hosted_v4_relay_grant_conflict");
          }
          if (!v4AdmissionEnabled(contract.scope.githubRepositoryId)) {
            if (existing) return { status: "recovery_required", grantId } as const;
            throw new Error("hosted_v4_relay_admission_disabled");
          }
          if (turnState !== "open" ||
              (existing && (existing.status !== "issued" ||
                existing.requestCount !== 0 || existing.inFlight !== 0 ||
                existing.expiresAt <= now))) {
            return { status: "recovery_required", grantId } as const;
          }
          const authorization = await tx.reviewRunAuthorization.findUnique({
            where: { authorizationId: contract.scope.authorizationId },
          });
          const invocationLease = await tx.reviewInvocationLeaseV2.findUnique({
            where: { leaseId: contract.scope.invocationLease.leaseId },
          });
          const requestedIntents = await tx.reviewRequestedIntent.findMany({
            where: {
              authorizationId: contract.scope.authorizationId,
              executionId: contract.scope.executionId,
            },
          });
          const candidates = await tx.hostedCodexAccount.findMany({
            where: {
              workspaceId: contract.scope.workspaceId,
              poolId: contract.scope.poolId,
              state: "healthy",
            },
            orderBy: [{ priority: "asc" }, { createdAt: "asc" }, { id: "asc" }],
            include: { credentialVersions: {
              select: { generation: true, credentialExpiresAt: true },
            } },
          });
          const selected = candidates.find((candidate) =>
            candidate.activeGeneration !== null &&
            candidate.credentialVersions.some((credential) =>
              credential.generation === candidate.activeGeneration &&
              (credential.credentialExpiresAt === null ||
                credential.credentialExpiresAt > now),
            ),
          );
          if (!selected || selected.id !== accountId ||
              selected.activeGeneration !== credentialGeneration ||
              !authorization || !invocationLease ||
              !/^[1-9]\d*$/.test(authorization.sourceRunAttempt) ||
              !Number.isSafeInteger(Number(authorization.sourceRunAttempt)) ||
              requestedIntents.length !== 1) {
            if (existing) return { status: "recovery_required", grantId } as const;
            throw new Error("hosted_v4_relay_grant_authority_stale");
          }
          const requestedIntent = requestedIntents[0]!;
          if (requestedIntent.admissionState !== "admitted" ||
              !["awaiting_authorization", "dispatched"].includes(requestedIntent.state) ||
              requestedIntent.workspaceId !== contract.scope.workspaceId ||
              requestedIntent.repositoryConnectionId !== contract.scope.repositoryConnectionId ||
              requestedIntent.scmRepositoryIdentityId !== contract.scope.scmRepositoryIdentityId ||
              requestedIntent.pullRequestNumber !== contract.scope.pullRequestNumber ||
              requestedIntent.reviewRevisionHash !== contract.scope.reviewRevisionHash ||
              requestedIntent.headSha !== contract.scope.headSha ||
              requestedIntent.sourceRunId !== authorization.sourceRunId ||
              requestedIntent.sourceRunAttempt !== authorization.sourceRunAttempt) {
            if (existing) return { status: "recovery_required", grantId } as const;
            throw new Error("hosted_v4_relay_requested_intent_stale");
          }
          const grantFacts = {
            runId: authorization.sourceRunId,
            runAttempt: Number(authorization.sourceRunAttempt),
            providerInvocationKey: invocationLease.providerInvocationKey,
            workspaceId: contract.scope.workspaceId,
            repositoryConnectionId: contract.scope.repositoryConnectionId,
            repositoryBindingId: contract.scope.repositoryBindingId,
            poolId: contract.scope.poolId,
            bindingRevision: BigInt(contract.scope.bindingRevision),
            authzEpoch: contract.scope.poolAuthzEpoch,
            runtimeAuthzEpoch: contract.scope.runtimeAuthzEpoch,
            policyFingerprint: contract.scope.policyFingerprint,
            runtimeConfigVersion: input.runtimeConfigVersion,
            model: contract.scope.model,
            activeAccountId: accountId,
          };
          const lockedAccounts = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
            SELECT "id" FROM public."HostedCodexAccount"
            WHERE "id" = ${accountId} AND "workspaceId" = ${contract.scope.workspaceId}
              AND "poolId" = ${contract.scope.poolId} FOR UPDATE
          `);
          if (lockedAccounts.length !== 1) {
            if (existing) return { status: "recovery_required", grantId } as const;
            throw new Error("hosted_v4_relay_account_lock_missing");
          }
          // A replacement investigation cannot buy a second turn for the
          // same execution slot or invocation. This predicate is read inside
          // the serializable grant transaction, so concurrent insertions
          // conflict instead of both observing an empty set.
          const otherFundedTurns = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
            SELECT g."id" FROM public."HostedCodexInvocationGrant" g
            JOIN public."HostedCodexV4RelayTurn" v
              ON v."logicalTurnKey" = g."v4TurnKey"
            JOIN public."ReviewInvestigation" i
              ON i."investigationId" = v."investigationId"
            WHERE g."authorityKind" = 'v4_relay_turn'
              AND v."logicalTurnKey" <> ${contract.logicalTurnKey}
              AND ((i."executionId" = ${contract.scope.executionId}
                AND i."workSlotId" = ${contract.scope.workSlotId})
                OR g."providerInvocationKey" = ${invocationLease.providerInvocationKey})
            LIMIT 1
          `);
          if (otherFundedTurns.length !== 0 && existing)
            return { status: "recovery_required", grantId } as const;
          if (otherFundedTurns.length !== 0)
            throw new Error("hosted_v4_relay_invocation_allocation_exhausted");
          if (existing) {
            if (existing.reviewRequestId !== requestedIntent.requestId) {
              throw new Error("hosted_v4_relay_grant_conflict");
            }
            try {
              await assertPreparedReservationAuthority(
                tx, contract, existing, { accountId, credentialGeneration }, now,
              );
            } catch (error) {
              if (!(error instanceof Error) ||
                  error.message !== "hosted_v4_relay_reservation_authority_stale") throw error;
              return { status: "recovery_required", grantId } as const;
            }
            return { status: "restored", grantId } as const;
          }
          await assertPreparedReservationAuthority(
            tx, contract, grantFacts, { accountId, credentialGeneration }, now,
          );
          const allocation = await tx.hostedCodexInvocationGrant.aggregate({
            where: { authorityKind: "v4_relay_turn", activeAccountId: accountId },
            _sum: { maxRequests: true },
          });
          if ((allocation._sum.maxRequests ?? 0) + contract.maxRequests >
              hostedV4RelayCanaryAccountRequestAllocation) {
            throw new Error("hosted_v4_relay_account_allocation_exhausted");
          }
          await tx.hostedCodexInvocationGrant.create({ data: {
            id: grantId, authorityKind: "v4_relay_turn",
            v4TurnKey: contract.logicalTurnKey, v4ScopeHash: contract.scopeHash,
            invocationId, workspaceId: contract.scope.workspaceId,
            poolId: contract.scope.poolId,
            repositoryConnectionId: contract.scope.repositoryConnectionId,
            repositoryBindingId: contract.scope.repositoryBindingId,
            activeAccountId: accountId, primaryAccountId: accountId,
            backupAccountId: null, reviewRequestId: requestedIntent.requestId,
            providerInvocationKey: invocationLease.providerInvocationKey,
            runId: authorization.sourceRunId,
            runAttempt: Number(authorization.sourceRunAttempt),
            model: contract.scope.model, policyVersion: hostedV4RelayCanaryPolicyVersion,
            policyFingerprint: contract.scope.policyFingerprint,
            runtimeConfigVersion: input.runtimeConfigVersion,
            bindingRevision: BigInt(contract.scope.bindingRevision),
            authzEpoch: contract.scope.poolAuthzEpoch,
            runtimeAuthzEpoch: contract.scope.runtimeAuthzEpoch,
            capabilityTokenHash: input.capabilityTokenHash,
            issuedAt: now, expiresAt: contract.expiresAt,
            maxRequests: contract.maxRequests,
            maxConcurrentRequests: 1,
            maxRequestBytes: contract.maxRequestBytes,
            maxResponseBytes: contract.maxResponseBytes,
            maxOutputTokens: contract.maxOutputTokens,
          } });
          return { status: "issued", grantId } as const;
        }, { isolationLevel: "Serializable" });
      } catch (error) {
        if (attempt === 2 || !retryableReservationConflict(error)) throw error;
      }
    }
    throw new Error("hosted_v4_relay_grant_retry_exhausted");
  }

  async reserve(contract: HostedV4RelayGrantContract): Promise<void> {
    if (contract.expiresAt <= new Date())
      throw new Error("hosted_v4_relay_turn_expired");
    await this.prisma.$transaction(
      async (tx) => {
        await this.reserveInTransaction(tx, contract);
      },
      { isolationLevel: "Serializable" },
    );
  }

  /** Caller can reserve turn and grant under one transaction and lock order. */
  async reserveInTransaction(
    tx: Prisma.TransactionClient,
    contract: HostedV4RelayGrantContract,
  ): Promise<void> {
    if (contract.expiresAt <= new Date()) {
      throw new Error("hosted_v4_relay_turn_expired");
    }
    await tx.$executeRaw(Prisma.sql`
        INSERT INTO "HostedCodexV4RelayTurn"
          ("logicalTurnKey", "scopeHash", "scopeCanonical", "authorizationId",
           "investigationId", "turnId", "expiresAt", "maxRequests",
           "maxRequestBytes", "maxResponseBytes", "maxOutputTokens",
           "state", "updatedAt")
        VALUES (${contract.logicalTurnKey}, ${contract.scopeHash},
                ${canonicalScope(contract.scope)}, ${contract.scope.authorizationId},
                ${contract.scope.investigationId}, ${contract.scope.turnId},
                ${contract.expiresAt}, ${contract.maxRequests},
                ${contract.maxRequestBytes}, ${contract.maxResponseBytes},
                ${contract.maxOutputTokens},
                'open', CURRENT_TIMESTAMP)
        ON CONFLICT ("logicalTurnKey") DO NOTHING
      `);
    await assertOpenLocked(tx, contract);
  }

  async assertOpen(contract: HostedV4RelayGrantContract): Promise<void> {
    await this.prisma.$transaction(
      async (tx) => {
        await this.assertOpenInTransaction(tx, contract);
      },
      { isolationLevel: "Serializable" },
    );
  }

  async assertOpenInTransaction(
    tx: Prisma.TransactionClient,
    contract: HostedV4RelayGrantContract,
  ): Promise<void> {
    await assertOpenLocked(tx, contract);
  }

  /** One already issued v4 grant, one body hash, one request debit and one
   * prepared effect. No transport operation occurs in this transaction. */
  async reservePreparedRequest(input: HostedV4PreparedRequestInput): Promise<HostedV4PreparedRequest> {
    const { contract } = input;
    if (
      input.ordinal !== 1 || input.body.byteLength < 1 ||
      input.body.byteLength > contract.maxRequestBytes ||
      input.idempotencyKey.length < 1 || input.idempotencyKey.length > 256 ||
      !/^[a-f0-9]{64}$/.test(input.ownerIdHash)
    ) throw new Error("hosted_v4_relay_request_invalid");
    let body: unknown;
    try {
      body = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(input.body),
      );
    } catch {
      throw new Error("hosted_v4_relay_request_body_invalid");
    }
    if (!body || typeof body !== "object" || Array.isArray(body) ||
        (body as { model?: unknown }).model !== contract.scope.model) {
      throw new Error("hosted_v4_relay_request_model_invalid");
    }
    const outputLimit = (body as { max_output_tokens?: unknown }).max_output_tokens;
    if (typeof outputLimit !== "number" || !Number.isSafeInteger(outputLimit) ||
        outputLimit < 1 || outputLimit > contract.maxOutputTokens) {
      throw new Error("hosted_v4_relay_request_output_limit_invalid");
    }
    const requestHash = createHash("sha256").update(input.body).digest("hex");
    const idempotencyKeyHash = createHash("sha256")
      .update(JSON.stringify(["hosted-v4-request", input.grantId, input.idempotencyKey]))
      .digest("hex");
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.prisma.$transaction(async (tx) => {
        const databaseTime = await tx.$queryRaw<Array<{ now: Date }>>(Prisma.sql`
          SELECT clock_timestamp() AS "now"
        `);
        const now = databaseTime[0]?.now;
        if (!now) throw new Error("hosted_v4_relay_database_time_unavailable");
        const releaseRegistered = await lockCurrentProducerRelease(
          tx, contract.scope.producerReleaseId,
        );
        const turnState = await assertScopeLocked(tx, contract, false);
        const grant = await tx.hostedCodexInvocationGrant.findUnique({
          where: { id: input.grantId },
        });
        if (!releaseRegistered && !grant)
          throw new Error("hosted_v4_relay_reservation_authority_stale");
        if (!grant || grant.authorityKind !== "v4_relay_turn" ||
            grant.v4TurnKey !== contract.logicalTurnKey ||
            grant.v4ScopeHash !== contract.scopeHash ||
            grant.backupAccountId !== null ||
            grant.activeAccountId !== input.accountId ||
            grant.primaryAccountId !== input.accountId ||
            grant.maxRequests !== contract.maxRequests ||
            grant.maxRequestBytes !== contract.maxRequestBytes ||
            grant.maxResponseBytes !== contract.maxResponseBytes ||
            grant.maxOutputTokens !== contract.maxOutputTokens) {
          throw new Error("hosted_v4_relay_grant_stale");
        }
        const existing = await tx.hostedCodexRelayRequest.findFirst({
          where: { grantId: grant.id }, orderBy: { ordinal: "asc" },
        });
        if (existing) {
          if (existing.ordinal !== 1 || existing.idempotencyKeyHash !== idempotencyKeyHash ||
              existing.requestHash !== requestHash || existing.requestBytes !== input.body.byteLength) {
            throw new Error("hosted_v4_relay_request_conflict");
          }
          const effect = await tx.hostedCodexUpstreamEffectAttempt.findFirst({
            where: { grantId: grant.id, relayRequestId: existing.id },
            orderBy: { attemptOrdinal: "asc" },
          });
          if (!effect || effect.attemptOrdinal !== 1 ||
              effect.requestHash !== requestHash ||
              effect.idempotencyKeyHash !== idempotencyKeyHash) {
            throw new Error("hosted_v4_relay_effect_missing");
          }
          let authorityCurrent = false;
          if (turnState === "open" && grant.expiresAt > now &&
              grant.status === "exhausted" && grant.requestCount === 1 &&
              grant.inFlight === 1 && effect.state === "prepared" &&
              effect.accountId === input.accountId &&
              effect.credentialGeneration === input.credentialGeneration &&
              existing.status === "received") {
            try {
              await assertPreparedReservationAuthority(tx, contract, grant, input, now);
              authorityCurrent = true;
            } catch (error) {
              if (!(error instanceof Error) ||
                  error.message !== "hosted_v4_relay_reservation_authority_stale") throw error;
            }
          }
          return {
            status: authorityCurrent && v4AdmissionEnabled(contract.scope.githubRepositoryId)
              ? "restored" : "recovery_required",
            grantId: grant.id, requestId: existing.id, effectId: effect.id,
            ordinal: 1, requestHash,
          } as const;
        }
        await assertOpenLocked(tx, contract);
        if (!releaseRegistered)
          throw new Error("hosted_v4_relay_reservation_authority_stale");
        if (!v4AdmissionEnabled(contract.scope.githubRepositoryId))
          throw new Error("hosted_v4_relay_admission_disabled");
        if (grant.expiresAt <= now) throw new Error("hosted_v4_relay_grant_stale");
        await assertPreparedReservationAuthority(tx, contract, grant, input, now);
        if (grant.status !== "issued" || grant.requestCount !== 0 || grant.inFlight !== 0) {
          throw new Error("hosted_v4_relay_budget_exhausted");
        }
        const request = await tx.hostedCodexRelayRequest.create({ data: {
          id: randomUUID(), authorityKind: "v4_relay_turn", grantId: grant.id,
          ordinal: 1, idempotencyKeyHash, requestHash,
          requestBytes: input.body.byteLength, status: "received",
        } });
        const effect = await tx.hostedCodexUpstreamEffectAttempt.create({ data: {
          id: randomUUID(), authorityKind: "v4_relay_turn",
          relayRequestId: request.id, grantId: grant.id,
          workspaceId: grant.workspaceId, poolId: grant.poolId,
          accountId: input.accountId, credentialGeneration: input.credentialGeneration,
          attemptOrdinal: 1, requestHash, idempotencyKeyHash,
          state: "prepared", ownerIdHash: input.ownerIdHash,
          fenceEpoch: 1n, heartbeatAt: now,
          leaseExpiresAt: new Date(Math.min(now.getTime() + 30_000, grant.expiresAt.getTime())),
        } });
        return {
          status: "prepared", grantId: grant.id, requestId: request.id,
          effectId: effect.id, ordinal: 1, requestHash,
        } as const;
        }, { isolationLevel: "Serializable" });
      } catch (error) {
        if (attempt === 2 || !retryableReservationConflict(error)) throw error;
      }
    }
    throw new Error("hosted_v4_relay_reservation_retry_exhausted");
  }

  async readStatus(logicalTurnKey: string): Promise<HostedV4RelayDurableStatus> {
    if (!/^[a-f0-9]{64}$/.test(logicalTurnKey)) {
      throw new Error("hosted_v4_relay_turn_invalid");
    }
    return this.prisma.$transaction(async (tx) => {
      const turn = await tx.hostedCodexV4RelayTurn.findUnique({
        where: { logicalTurnKey },
        select: { state: true, investigationId: true, turnId: true },
      });
      if (!turn) {
        return {
          logicalTurnKey, state: "missing", grantId: null,
          requestId: null, effectId: null, ordinal: null,
          requestHash: null, acceptedAttestationId: null,
        };
      }
      const grant = await tx.hostedCodexInvocationGrant.findUnique({
        where: { v4TurnKey: logicalTurnKey },
        select: { id: true, authorityKind: true },
      });
      if (grant && grant.authorityKind !== "v4_relay_turn") {
        throw new Error("hosted_v4_relay_grant_authority_corrupt");
      }
      const request = grant
        ? await tx.hostedCodexRelayRequest.findFirst({
            where: { grantId: grant.id, authorityKind: "v4_relay_turn" },
            orderBy: { ordinal: "desc" },
            select: { id: true, ordinal: true, requestHash: true, status: true },
          })
        : null;
      const effect = request
        ? await tx.hostedCodexUpstreamEffectAttempt.findFirst({
            where: { grantId: grant!.id, relayRequestId: request.id, authorityKind: "v4_relay_turn" },
            orderBy: { attemptOrdinal: "desc" },
            select: { id: true, state: true },
          })
        : null;
      const investigationTurn = await tx.reviewInvestigationTurn.findUnique({
        where: { turnId: turn.turnId },
        select: { investigationId: true, acceptedAttestationId: true },
      });
      if (investigationTurn?.investigationId !== turn.investigationId) {
        throw new Error("hosted_v4_relay_investigation_turn_mismatch");
      }
      return {
        logicalTurnKey,
        state: turn.state === "terminal_unknown"
          ? "terminal_unknown"
          : !effect
            ? "missing"
            : effect.state === "succeeded" && request?.status !== "succeeded"
            ? "response_started"
            : effect.state,
        grantId: grant?.id ?? null,
        requestId: request?.id ?? null,
        effectId: effect?.id ?? null,
        ordinal: request?.ordinal ?? null,
        requestHash: request?.requestHash ?? null,
        acceptedAttestationId: investigationTurn.acceptedAttestationId,
      };
    }, { isolationLevel: "RepeatableRead" });
  }

  async reconcileExpiredPrepared(
    logicalTurnKey: string,
  ): Promise<"failed_no_effect" | "recovery_required"> {
    if (!/^[a-f0-9]{64}$/.test(logicalTurnKey)) {
      throw new Error("hosted_v4_relay_turn_invalid");
    }
    return this.prisma.$transaction(async (tx) => {
      const turns = await tx.$queryRaw<Array<{ state: string }>>(Prisma.sql`
        SELECT "state" FROM "HostedCodexV4RelayTurn"
        WHERE "logicalTurnKey" = ${logicalTurnKey} FOR UPDATE
      `);
      if (turns[0]?.state !== "open") return "recovery_required";
      const grant = await tx.hostedCodexInvocationGrant.findUnique({
        where: { v4TurnKey: logicalTurnKey },
      });
      if (!grant || grant.authorityKind !== "v4_relay_turn" ||
          !["exhausted", "revoked"].includes(grant.status) || grant.requestCount !== 1 ||
          grant.inFlight !== 1) return "recovery_required";
      const request = await tx.hostedCodexRelayRequest.findFirst({
        where: { grantId: grant.id, authorityKind: "v4_relay_turn" },
      });
      if (!request || request.ordinal !== 1 || request.status !== "received")
        return "recovery_required";
      const effect = await tx.hostedCodexUpstreamEffectAttempt.findFirst({
        where: { grantId: grant.id, relayRequestId: request.id,
          authorityKind: "v4_relay_turn" },
      });
      const databaseTime = await tx.$queryRaw<Array<{ now: Date }>>(Prisma.sql`
        SELECT clock_timestamp() AS "now"
      `);
      const now = databaseTime[0]?.now;
      if (!now || !effect || effect.attemptOrdinal !== 1 ||
          effect.state !== "prepared" || effect.dispatchStartedAt !== null ||
          effect.responseStartedAt !== null || effect.completedAt !== null ||
          effect.leaseExpiresAt > now) return "recovery_required";
      const changed = await tx.hostedCodexUpstreamEffectAttempt.updateMany({
        where: { id: effect.id, state: "prepared", fenceEpoch: effect.fenceEpoch,
          dispatchStartedAt: null },
        data: {
          state: "failed_no_effect", completedAt: now,
          terminalEvidenceHash: createHash("sha256").update(
            JSON.stringify(["prepared-expired-no-dispatch", effect.id,
              effect.fenceEpoch.toString(), effect.leaseExpiresAt.toISOString()]),
          ).digest("hex"),
          errorCode: "prepared_effect_expired_no_dispatch",
        },
      });
      if (changed.count !== 1) throw new Error("hosted_v4_relay_effect_fence_conflict");
      const closed = await tx.hostedCodexRelayRequest.updateMany({
        where: { id: request.id, status: "received" },
        data: { status: "failed", completedAt: now,
          errorCode: "prepared_effect_expired_no_dispatch" },
      });
      if (closed.count !== 1) throw new Error("hosted_v4_relay_request_fence_conflict");
      return "failed_no_effect";
    }, { isolationLevel: "Serializable" });
  }

  async markTerminalUnknown(logicalTurnKey: string, at: Date): Promise<void> {
    if (
      !/^[a-f0-9]{64}$/.test(logicalTurnKey) ||
      !Number.isFinite(at.getTime())
    ) {
      throw new Error("hosted_v4_relay_turn_invalid");
    }
    await this.prisma.$transaction(
      async (tx) => {
        const rows = await tx.$queryRaw<Array<{ state: string }>>(Prisma.sql`
        SELECT "state" FROM "HostedCodexV4RelayTurn"
        WHERE "logicalTurnKey" = ${logicalTurnKey} FOR UPDATE
        `);
        if (rows.length !== 1) throw new Error("hosted_v4_relay_turn_missing");
        const grant = await tx.hostedCodexInvocationGrant.findUnique({
          where: { v4TurnKey: logicalTurnKey }, select: { id: true, authorityKind: true },
        });
        if (grant && grant.authorityKind !== "v4_relay_turn")
          throw new Error("hosted_v4_relay_grant_authority_corrupt");
        const request = grant ? await tx.hostedCodexRelayRequest.findFirst({
          where: { grantId: grant.id, authorityKind: "v4_relay_turn" },
          orderBy: { ordinal: "desc" },
        }) : null;
        const effect = request ? await tx.hostedCodexUpstreamEffectAttempt.findFirst({
          where: { grantId: grant!.id, relayRequestId: request.id, authorityKind: "v4_relay_turn" },
          orderBy: { attemptOrdinal: "desc" },
        }) : null;
        if (effect?.state === "succeeded" || request?.status === "succeeded") {
          throw new Error("hosted_v4_relay_effect_already_succeeded");
        }
        if (effect?.state === "failed_no_effect" || effect?.state === "failed_classified" ||
            request?.status === "failed") {
          throw new Error("hosted_v4_relay_effect_already_classified");
        }
        if (effect && effect.state !== "terminal_unknown") {
          const changed = await tx.hostedCodexUpstreamEffectAttempt.updateMany({
            where: { id: effect.id, state: effect.state, fenceEpoch: effect.fenceEpoch },
            data: {
              state: "terminal_unknown", completedAt: at,
              terminalEvidenceHash: createHash("sha256").update(`manual-unknown:${effect.id}`).digest("hex"),
              errorCode: "upstream_dispatch_outcome_unknown",
            },
          });
          if (changed.count !== 1) throw new Error("hosted_v4_relay_effect_fence_conflict");
        }
        if (request && !["terminal_unknown", "failed"].includes(request.status)) {
          const changed = await tx.hostedCodexRelayRequest.updateMany({
            where: { id: request.id, status: request.status },
            data: { status: "terminal_unknown", completedAt: at,
              errorCode: "upstream_dispatch_outcome_unknown" },
          });
          if (changed.count !== 1) throw new Error("hosted_v4_relay_request_fence_conflict");
        }
        if (rows[0]?.state !== "terminal_unknown") {
          await tx.hostedCodexV4RelayTurn.update({
            where: { logicalTurnKey },
            data: { state: "terminal_unknown", unknownAt: at },
          });
        }
        await tx.hostedCodexInvocationGrant.updateMany({
          where: {
            v4TurnKey: logicalTurnKey,
            status: { in: ["issued", "exhausted"] },
          },
          data: {
            status: "revoked",
            revokedAt: at,
            revision: { increment: 1 },
          },
        });
      },
      { isolationLevel: "Serializable" },
    );
  }
}

async function assertOpenLocked(
  tx: Prisma.TransactionClient,
  contract: HostedV4RelayGrantContract,
): Promise<void> {
  await assertScopeLocked(tx, contract, true);
}

/** A row lock, rather than a late advisory lock, invalidates an old
 * Serializable snapshot when the real release revoker has updated the row. */
export async function lockCurrentProducerRelease(
  tx: Prisma.TransactionClient,
  producerReleaseId: string,
): Promise<boolean> {
  const rows = await tx.$queryRaw<Array<{
    producerReleaseId: string; state: string;
  }>>(Prisma.sql`
    SELECT "producerReleaseId", "state"::text AS "state"
    FROM public."ProducerRelease"
    WHERE "producerReleaseId" = ${producerReleaseId} FOR SHARE
  `);
  if (rows.length !== 1 || rows[0]?.producerReleaseId !== producerReleaseId)
    throw new Error("hosted_v4_relay_reservation_authority_stale");
  return rows[0].state === "registered";
}

async function assertScopeLocked(
  tx: Prisma.TransactionClient,
  contract: HostedV4RelayGrantContract,
  requireOpen: boolean,
): Promise<string> {
  const rows = await tx.$queryRaw<
    Array<{
      scopeHash: string;
      scopeCanonical: string;
      state: string;
      expiresAt: Date;
      maxRequests: number;
      maxRequestBytes: number;
      maxResponseBytes: number;
      maxOutputTokens: number;
    }>
  >(Prisma.sql`
    SELECT "scopeHash", "scopeCanonical", "state", "expiresAt",
           "maxRequests", "maxRequestBytes", "maxResponseBytes", "maxOutputTokens"
    FROM "HostedCodexV4RelayTurn"
    WHERE "logicalTurnKey" = ${contract.logicalTurnKey} FOR UPDATE
  `);
  const saved = rows[0];
  if (!saved) {
    throw new Error("hosted_v4_relay_turn_missing");
  }
  if (requireOpen && saved.state !== "open") {
    throw new Error("hosted_v4_relay_turn_terminal_unknown");
  }
  if (requireOpen && saved.expiresAt <= new Date())
    throw new Error("hosted_v4_relay_turn_expired");
  if (
    saved.scopeHash !== contract.scopeHash ||
    saved.scopeCanonical !== canonicalScope(contract.scope) ||
    saved.expiresAt.getTime() !== contract.expiresAt.getTime() ||
    saved.maxRequests !== contract.maxRequests ||
    saved.maxRequestBytes !== contract.maxRequestBytes ||
    saved.maxResponseBytes !== contract.maxResponseBytes ||
    saved.maxOutputTokens !== contract.maxOutputTokens
  ) {
    throw new Error("hosted_v4_relay_turn_scope_conflict");
  }
  return saved.state;
}

async function assertPreparedReservationAuthority(
  tx: Prisma.TransactionClient,
  contract: HostedV4RelayGrantContract,
  grant: Pick<HostedCodexInvocationGrant,
    "runId" | "runAttempt" | "providerInvocationKey" | "workspaceId" |
    "repositoryConnectionId" | "repositoryBindingId" | "poolId" |
    "bindingRevision" | "authzEpoch" | "runtimeAuthzEpoch" |
    "policyFingerprint" | "runtimeConfigVersion" | "model" | "activeAccountId">,
  input: { accountId: string; credentialGeneration: bigint },
  now: Date,
): Promise<void> {
  const scope = contract.scope;
  // The mutation writer updates this authority row. FOR SHARE coordinates
  // with that write; a Serializable snapshot predating it must fail instead
  // of admitting an old epoch. The execution stream gets the same fence.
  const currentAuthority = await tx.$queryRaw<Array<{ mode: string; epoch: bigint }>>(Prisma.sql`
    SELECT "mode"::text AS "mode", "epoch" FROM public."ReviewMutationAuthority"
    WHERE "scmRepositoryIdentityId" = ${scope.scmRepositoryIdentityId}
      AND "laneKind" = 'hosted_reviewrouter_app'
    FOR SHARE
  `);
  const currentStream = await tx.$queryRaw<Array<{
    activeExecutionId: string | null; preparedExecutionId: string | null;
    lastAllocatedGeneration: bigint; currentReviewRevisionHash: string | null;
  }>>(Prisma.sql`
    SELECT "activeExecutionId", "preparedExecutionId", "lastAllocatedGeneration",
      "currentReviewRevisionHash"
    FROM public."ReviewExecutionStreamV2"
    WHERE "workspaceId" = ${scope.workspaceId}
      AND "repositoryConnectionId" = ${scope.repositoryConnectionId}
      AND "scmRepositoryIdentityId" = ${scope.scmRepositoryIdentityId}
      AND "pullRequestNumber" = ${scope.pullRequestNumber}
    FOR SHARE
  `);
  // The release revoker updates this row. A lock on the row itself is needed:
  // an advisory lock acquired after this Serializable transaction's first
  // snapshot would still allow the old registered version to be read. If a
  // revocation committed after that snapshot, PostgreSQL raises 40001 here;
  // the outer reservation retries with a new transaction and snapshot.
  await lockCurrentProducerRelease(tx, scope.producerReleaseId);
  const authorization = await tx.reviewRunAuthorization.findUnique({
    where: { authorizationId: scope.authorizationId },
  });
  const release = await tx.producerRelease.findUnique({
    where: { producerReleaseId: scope.producerReleaseId },
  });
  const execution = await tx.reviewExecutionV2.findUnique({
    where: { executionId: scope.executionId },
  });
  const slot = await tx.reviewExecutionWorkSlotV2.findUnique({
    where: { executionId_workSlotId: { executionId: scope.executionId, workSlotId: scope.workSlotId } },
  });
  const investigation = await tx.reviewInvestigation.findUnique({
    where: { investigationId: scope.investigationId },
  });
  const turn = await tx.reviewInvestigationTurn.findUnique({
    where: { turnId: scope.turnId },
  });
  const investigationLease = await tx.reviewInvestigationLease.findUnique({
    where: { leaseId: scope.investigationLease.leaseId },
  });
  const invocationLease = await tx.reviewInvocationLeaseV2.findUnique({
    where: { leaseId: scope.invocationLease.leaseId },
  });
  const repository = await tx.repositoryConnection.findUnique({
    where: { id: scope.repositoryConnectionId }, include: { installation: true },
  });
  const scmIdentity = await tx.scmRepositoryIdentity.findUnique({
    where: { scmRepositoryIdentityId: scope.scmRepositoryIdentityId },
  });
  const binding = await tx.hostedCodexRepositoryBinding.findUnique({
    where: { id: scope.repositoryBindingId }, include: { pool: true },
  });
  const runtimeGate = await tx.$queryRaw<Array<{ status: string; authzEpoch: bigint }>>(Prisma.sql`
    SELECT * FROM public.hosted_historical_lock_runtime_gate()
  `);
  const account = await tx.hostedCodexAccount.findUnique({ where: { id: input.accountId } });
  const credential = await tx.hostedCodexCredentialVersion.findUnique({
    where: { accountId_generation: {
      accountId: input.accountId, generation: input.credentialGeneration,
    } },
    select: { workspaceId: true, poolId: true, credentialExpiresAt: true },
  });
  const readConfig = (targetKey: string) => tx.reviewConfiguration.findUnique({
    where: { workspaceId_targetKey: { workspaceId: scope.workspaceId, targetKey } },
    select: { versions: { orderBy: { version: "desc" }, take: 1,
      select: { version: true, providerKind: true, providerAuthMode: true,
        model: true, providerLimit: true, providerMaxParallel: true,
        investigationRecordingEnabled: true,
        providers: { select: { providerKind: true, providerAuthMode: true,
          model: true } },
      },
    } },
  });
  const repositoryConfig = await readConfig(`repo:${scope.repositoryConnectionId}`);
  const workspaceConfig = await readConfig("workspace:default");
  const runtimeConfig = repositoryConfig?.versions[0] ?? workspaceConfig?.versions[0];
  const configuredProviders = runtimeConfig?.providers.length
    ? runtimeConfig.providers
    : runtimeConfig ? [runtimeConfig] : [];
  if (
    !authorizationHasHostedRelayDescriptor(
      authorization?.reviewInvestigationAuthorizationDescriptorCanonicalJson,
    ) ||
    currentAuthority.length !== 1 || currentAuthority[0]?.mode !== "v2_active" ||
    currentAuthority[0].epoch !== scope.mutationEpoch ||
    currentStream.length !== 1 ||
    currentStream[0]?.activeExecutionId !== scope.executionId ||
    currentStream[0].preparedExecutionId !== null ||
    currentStream[0].lastAllocatedGeneration !== execution?.generation ||
    currentStream[0].currentReviewRevisionHash !== scope.reviewRevisionHash ||
    !authorization || authorization.state !== "active" ||
    authorization.expiresAt <= now ||
    authorization.expiresAt < scope.authorizationExpiresAt ||
    authorization.mutationEpoch !== scope.mutationEpoch ||
    authorization.workspaceId !== scope.workspaceId ||
    authorization.repositoryConnectionId !== scope.repositoryConnectionId ||
    authorization.scmRepositoryIdentityId !== scope.scmRepositoryIdentityId ||
    authorization.pullRequestNumber !== scope.pullRequestNumber ||
    authorization.baseSha !== scope.baseSha ||
    authorization.mergeBaseSha !== scope.mergeBaseSha ||
    authorization.reviewRevisionHash !== scope.reviewRevisionHash ||
    authorization.producerReleaseId !== scope.producerReleaseId ||
    authorization.headSha !== scope.headSha ||
    authorization.trustDomain !== scope.trustDomain ||
    authorization.selectedProtocolVersion !== scope.protocolVersion ||
    authorization.schemaDigest !== scope.schemaDigest ||
    authorization.protocolLimitsProfileId !== scope.protocolLimitsProfileId ||
    !release || release.state !== "registered" ||
    release.schemaDigest !== scope.schemaDigest ||
    release.protocolLimitsProfileId !== scope.protocolLimitsProfileId ||
    release.wrapperEntrypointDigest !== scope.actionIdentityHash ||
    release.runtimeEntrypointDigest !== scope.runtimeIdentityHash ||
    release.contextGatewayEntrypointDigest !== scope.gatewayIdentityHash ||
    authorization.sourceRunId !== grant.runId ||
    authorization.sourceRunAttempt !== String(grant.runAttempt) ||
    !execution || execution.state !== "running" ||
    execution.authorizationId !== scope.authorizationId ||
    execution.mutationEpoch !== scope.mutationEpoch ||
    execution.reviewRevisionHash !== scope.reviewRevisionHash ||
    execution.producerReleaseId !== scope.producerReleaseId ||
    execution.workspaceId !== scope.workspaceId ||
    execution.repositoryConnectionId !== scope.repositoryConnectionId ||
    execution.scmRepositoryIdentityId !== scope.scmRepositoryIdentityId ||
    execution.pullRequestNumber !== scope.pullRequestNumber ||
    execution.baseSha !== scope.baseSha ||
    execution.mergeBaseSha !== scope.mergeBaseSha ||
    execution.headSha !== scope.headSha ||
    execution.sourceRunId !== authorization.sourceRunId ||
    execution.sourceRunAttempt !== authorization.sourceRunAttempt ||
    execution.protocolLimitsProfileId !== scope.protocolLimitsProfileId ||
    !slot || slot.state !== "leased" ||
    slot.activeLeaseId !== scope.invocationLease.leaseId ||
    !investigation || investigation.state !== "turn_leased" ||
    investigation.runtimeProfile !== "gateway_attested_agent_v1" ||
    investigation.workspaceId !== scope.workspaceId ||
    investigation.repositoryConnectionId !== scope.repositoryConnectionId ||
    investigation.scmRepositoryIdentityId !== scope.scmRepositoryIdentityId ||
    investigation.pullRequestNumber !== scope.pullRequestNumber ||
    investigation.baseSha !== scope.baseSha ||
    investigation.mergeBaseSha !== scope.mergeBaseSha ||
    investigation.headSha !== scope.headSha ||
    investigation.reviewRevisionHash !== scope.reviewRevisionHash ||
    investigation.producerReleaseId !== scope.producerReleaseId ||
    investigation.providerVoteLaneId !== scope.providerVoteLaneId ||
    investigation.providerStrategyId !== scope.providerStrategyId ||
    investigation.investigationManifestHash !== scope.investigationManifestHash ||
    investigation.activeTurnId !== scope.turnId ||
    investigation.version !== scope.investigationVersion ||
    investigation.dossierDigest !== scope.dossierDigest ||
    investigation.executionId !== scope.executionId ||
    investigation.workSlotId !== scope.workSlotId ||
    !turn || turn.investigationId !== scope.investigationId ||
    turn.state !== "leased" || turn.purpose !== scope.turnPurpose ||
    turn.leasedAtVersion !== scope.investigationVersion ||
    turn.dossierDigest !== scope.planningInputDossierDigest ||
    turn.expiresAt <= now ||
    turn.expiresAt.getTime() !== scope.turnExpiresAt.getTime() ||
    turn.turnBudgetCanonicalJson !== scope.turnBudgetCanonicalJson ||
    turn.turnBudgetHash !== scope.turnBudgetHash ||
    !investigationLease || investigationLease.purpose !== "relay_turn" ||
    investigationLease.state !== "active" || investigationLease.expiresAt <= now ||
    investigationLease.expiresAt < scope.investigationLease.expiresAt ||
    investigationLease.authorizationId !== scope.authorizationId ||
    investigationLease.workspaceId !== scope.workspaceId ||
    investigationLease.repositoryConnectionId !== scope.repositoryConnectionId ||
    investigationLease.scmRepositoryIdentityId !== scope.scmRepositoryIdentityId ||
    investigationLease.pullRequestNumber !== scope.pullRequestNumber ||
    investigationLease.mutationEpoch !== scope.mutationEpoch ||
    investigationLease.executionId !== scope.executionId ||
    investigationLease.workSlotId !== scope.workSlotId ||
    investigationLease.baseSha !== scope.baseSha ||
    investigationLease.mergeBaseSha !== scope.mergeBaseSha ||
    investigationLease.headSha !== scope.headSha ||
    investigationLease.reviewRevisionHash !== scope.reviewRevisionHash ||
    investigationLease.investigationVersion !== scope.investigationVersion ||
    investigationLease.turnPurpose !== scope.turnPurpose ||
    investigationLease.providerVoteLaneId !== scope.providerVoteLaneId ||
    investigationLease.providerStrategyId !== scope.providerStrategyId ||
    investigationLease.investigationManifestHash !== scope.investigationManifestHash ||
    investigationLease.attemptId !== scope.attemptId ||
    investigationLease.investigationId !== scope.investigationId ||
    investigationLease.turnId !== scope.turnId ||
    investigationLease.leaseCapabilityId !== scope.investigationLease.capabilityId ||
    investigationLease.ownerIdHash !== scope.investigationLease.ownerIdHash ||
    investigationLease.fencingToken !== scope.investigationLease.fencingToken ||
    !invocationLease || invocationLease.purpose !== "provider_execution" ||
    invocationLease.state !== "active" || invocationLease.expiresAt <= now ||
    invocationLease.expiresAt < scope.invocationLease.expiresAt ||
    invocationLease.authorizationId !== scope.authorizationId ||
    invocationLease.workspaceId !== scope.workspaceId ||
    invocationLease.repositoryConnectionId !== scope.repositoryConnectionId ||
    invocationLease.scmRepositoryIdentityId !== scope.scmRepositoryIdentityId ||
    invocationLease.pullRequestNumber !== scope.pullRequestNumber ||
    invocationLease.executionGeneration !== execution.generation ||
    invocationLease.reviewRevisionHash !== scope.reviewRevisionHash ||
    invocationLease.producerReleaseId !== scope.producerReleaseId ||
    invocationLease.mutationEpoch !== scope.mutationEpoch ||
    invocationLease.executionId !== scope.executionId ||
    invocationLease.workSlotId !== scope.workSlotId ||
    invocationLease.leaseCapabilityId !== scope.invocationLease.capabilityId ||
    invocationLease.ownerIdHash !== scope.invocationLease.ownerIdHash ||
    invocationLease.fencingToken !== scope.invocationLease.fencingToken ||
    invocationLease.attemptId !== scope.invocationLease.attemptId ||
    invocationLease.providerInvocationKey !== scope.invocationLease.providerInvocationKey ||
    grant.providerInvocationKey !== invocationLease.providerInvocationKey ||
    grant.workspaceId !== scope.workspaceId ||
    grant.repositoryConnectionId !== scope.repositoryConnectionId ||
    grant.repositoryBindingId !== scope.repositoryBindingId ||
    grant.poolId !== scope.poolId ||
    grant.bindingRevision !== BigInt(scope.bindingRevision) ||
    grant.authzEpoch !== scope.poolAuthzEpoch ||
    grant.runtimeAuthzEpoch !== scope.runtimeAuthzEpoch ||
    grant.policyFingerprint !== scope.policyFingerprint ||
    !runtimeConfig || runtimeConfig.version !== grant.runtimeConfigVersion ||
    runtimeConfig.investigationRecordingEnabled !== true ||
    runtimeConfig.providerLimit !== 1 || runtimeConfig.providerMaxParallel !== 1 ||
    configuredProviders.length !== 1 ||
    configuredProviders[0]?.providerKind !== "codex" ||
    configuredProviders[0].providerAuthMode !== "codex_subscription_oauth_hosted_pool" ||
    configuredProviders[0].model !== scope.model ||
    grant.model !== scope.model ||
    scope.providerInstanceId !== `hosted-pool:repository:${scope.githubRepositoryId}` ||
    !repository || repository.workspaceId !== scope.workspaceId ||
    repository.scmRepositoryIdentityId !== scope.scmRepositoryIdentityId ||
    repository.provider !== "github" || repository.selected !== true ||
    repository.archived !== false ||
    repository.githubRepositoryId?.toString() !== scope.githubRepositoryId ||
    !repository.installation || repository.installation.status !== "active" ||
    repository.installation.workspaceId !== scope.workspaceId ||
    repository.installation.githubInstallationId.toString() !== scope.githubInstallationId ||
    !scmIdentity || scmIdentity.provider !== "github" ||
    scmIdentity.currentWorkspaceId !== scope.workspaceId ||
    scmIdentity.currentRepositoryConnectionId !== scope.repositoryConnectionId ||
    scmIdentity.externalRepositoryId !== scope.githubRepositoryId ||
    !binding || binding.status !== "active" ||
    binding.workspaceId !== scope.workspaceId ||
    binding.repositoryConnectionId !== scope.repositoryConnectionId ||
    binding.revision !== BigInt(scope.bindingRevision) ||
    binding.pool.authzEpoch !== scope.poolAuthzEpoch ||
    binding.pool.status !== "active" ||
    binding.poolId !== scope.poolId ||
    runtimeGate.length !== 1 || runtimeGate[0]?.status !== "active" ||
    runtimeGate[0].authzEpoch !== scope.runtimeAuthzEpoch ||
    !account || account.state !== "healthy" ||
    account.workspaceId !== scope.workspaceId || account.poolId !== scope.poolId ||
    account.activeGeneration !== input.credentialGeneration ||
    account.id !== grant.activeAccountId ||
    !credential || credential.workspaceId !== scope.workspaceId ||
    credential.poolId !== scope.poolId ||
    (credential.credentialExpiresAt !== null &&
      credential.credentialExpiresAt <= now)
  ) throw new Error("hosted_v4_relay_reservation_authority_stale");
}

function authorizationHasHostedRelayDescriptor(canonical: string | null | undefined): boolean {
  return parseInvestigationAuthorizationDescriptorJson(canonical)?.hostedRelayExtension !== undefined;
}
