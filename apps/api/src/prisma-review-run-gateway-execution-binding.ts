import type { Prisma, PrismaClient } from "@prisma/client";
import {
  canonicalJson,
  parseReviewRunGatewayExecutionBinding,
  parseReviewRunRuntimeSnapshot,
  reviewRunGatewayEpochMatches,
  reviewRunGatewayOwnedIdentity,
  type ReviewRunGatewayExecutionAttachment,
  type ReviewRunGatewayExecutionBinding,
  type ReviewRunGatewayExecutionBindingPort,
  type ReviewRunGatewayExecutionOwner,
  type ReviewRunGatewayExecutionRead,
  type ReviewRunRuntimeSnapshot,
} from "@reviewrouter/features-review-run-control";
import type { ProductionReviewRunRuntimeSnapshot } from "./review-run-runtime-snapshot";

/** Private SQL121 attachment on the existing authority row. No public mapper,
 * capability persistence, second ledger or automatic transaction/HTTP retry. */
export class PrismaReviewRunGatewayExecutionBinding implements ReviewRunGatewayExecutionBindingPort {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly snapshots: ProductionReviewRunRuntimeSnapshot,
  ) {}

  async read(
    raw: ReviewRunGatewayExecutionOwner,
  ): Promise<ReviewRunGatewayExecutionRead> {
    const owner = copyOwner(raw);
    return this.prisma.$transaction(
      async (tx): Promise<ReviewRunGatewayExecutionRead> => {
        const current = await this.lockLive(tx, owner);
        if (!current) return { status: "denied" };
        return { status: "live", binding: current.binding };
      },
    );
  }

  async attach(
    raw: ReviewRunGatewayExecutionOwner,
    selected: ReviewRunGatewayExecutionBinding,
  ): Promise<ReviewRunGatewayExecutionAttachment> {
    const owner = copyOwner(raw);
    const canonical = canonicalJson(selected);
    const binding = parseReviewRunGatewayExecutionBinding(canonical);
    const snapshot = parseReviewRunRuntimeSnapshot(
      owner.runtimeSnapshotCanonicalJson,
    );
    const original = snapshot ? selectedAllocation(snapshot, owner) : null;
    if (
      !snapshot ||
      !original?.limits ||
      binding.operationId !== original.operationId ||
      binding.accountRef !== original.permittedAccountRef ||
      binding.deadline !== snapshot?.deadline ||
      !reviewRunGatewayEpochMatches(
        snapshot,
        binding.authorizationEpoch,
        owner.allocationId,
      )
    )
      return { status: "denied" };
    return this.prisma.$transaction(
      async (tx): Promise<ReviewRunGatewayExecutionAttachment> => {
        const current = await this.lockLive(tx, owner);
        if (!current) return { status: "denied" };
        if (current.binding) {
          return canonicalJson(current.binding) === canonical
            ? { status: "restored", binding: current.binding }
            : { status: "conflict" };
        }
        if (snapshot.snapshotVersion === 4) {
          const attached = await tx.$queryRaw<
            readonly { gatewayExecutionCanonicalJson: string }[]
          >`
            INSERT INTO "ReviewRunGatewayAllocationExecution" ("authorizationId", "allocationId", "gatewayExecutionCanonicalJson")
            VALUES (${owner.authorizationId}, ${owner.allocationId!}, ${canonical})
            ON CONFLICT ("authorizationId", "allocationId") DO NOTHING
            RETURNING "gatewayExecutionCanonicalJson"`;
          if (attached.length !== 1 || !attached[0])
            return { status: "conflict" };
          const saved = parseReviewRunGatewayExecutionBinding(
            attached[0].gatewayExecutionCanonicalJson,
          );
          if (canonicalJson(saved) !== canonical)
            throw new Error("review_run_gateway_attachment_corrupt");
          return { status: "attached", binding: saved };
        }
        // The lock and predicates preserve identity/state/snapshot. SQL121 adds
        // independent write-once, original-intent and current-deadline guards.
        const attached = await tx.$queryRaw<
          readonly { gatewayExecutionCanonicalJson: string }[]
        >`
        UPDATE "ReviewRunAuthorization"
        SET "gatewayExecutionCanonicalJson" = ${canonical}
        WHERE "authorizationId" = ${owner.authorizationId}
          AND "runtimeSnapshotCanonicalJson" = ${owner.runtimeSnapshotCanonicalJson}
          AND "gatewayExecutionCanonicalJson" IS NULL
          AND "state" = 'active'
          AND "expiresAt" > (clock_timestamp() AT TIME ZONE 'UTC')
          AND "maxExpiresAt" > (clock_timestamp() AT TIME ZONE 'UTC')
        RETURNING "gatewayExecutionCanonicalJson"`;
        if (attached.length !== 1 || !attached[0]) return { status: "denied" };
        const saved = parseReviewRunGatewayExecutionBinding(
          attached[0].gatewayExecutionCanonicalJson,
        );
        if (canonicalJson(saved) !== canonical)
          throw new Error("review_run_gateway_attachment_corrupt");
        return { status: "attached", binding: saved };
      },
    );
  }

  async readForCleanup(
    raw: ReviewRunGatewayExecutionOwner,
  ): Promise<ReviewRunGatewayExecutionBinding | null> {
    const owner = copyOwner(raw);
    const snapshot = parseReviewRunRuntimeSnapshot(
      owner.runtimeSnapshotCanonicalJson,
    );
    const original = snapshot ? selectedAllocation(snapshot, owner) : null;
    if (!snapshot || !original) return null;
    const row = await this.prisma.reviewRunAuthorization.findUnique({
      where: { authorizationId: owner.authorizationId },
    });
    if (
      !row ||
      row.runtimeSnapshotCanonicalJson !== owner.runtimeSnapshotCanonicalJson ||
      !Object.entries(owner.identity).every(
        ([key, value]) => Reflect.get(row, key) === value,
      )
    )
      return null;
    const children =
      snapshot.snapshotVersion === 4
        ? await this.prisma.$queryRaw<
            readonly { gatewayExecutionCanonicalJson: string }[]
          >`
      SELECT "gatewayExecutionCanonicalJson" FROM "ReviewRunGatewayAllocationExecution"
      WHERE "authorizationId" = ${owner.authorizationId} AND "allocationId" = ${owner.allocationId!}`
        : [];
    const canonical =
      snapshot.snapshotVersion === 4
        ? children[0]?.gatewayExecutionCanonicalJson
        : row.gatewayExecutionCanonicalJson;
    if (!canonical) return null;
    const binding = parseReviewRunGatewayExecutionBinding(canonical);
    return binding.operationId === original.operationId &&
      binding.accountRef === original.permittedAccountRef &&
      binding.deadline === snapshot.deadline &&
      reviewRunGatewayEpochMatches(
        snapshot,
        binding.authorizationEpoch,
        owner.allocationId,
      )
      ? binding
      : null;
  }

  async completeCleanup(
    raw: ReviewRunGatewayExecutionOwner,
    selected: ReviewRunGatewayExecutionBinding,
  ): Promise<void> {
    const owner = copyOwner(raw);
    const saved = await this.readForCleanup(owner);
    if (
      !owner.allocationId ||
      !saved ||
      canonicalJson(saved) !== canonicalJson(selected)
    )
      return;
    await this.prisma.$executeRaw`
      UPDATE "ReviewRunGatewayAllocationExecution" SET "cleanupCompletedAt" = (clock_timestamp() AT TIME ZONE 'UTC')
      WHERE "authorizationId" = ${owner.authorizationId} AND "allocationId" = ${owner.allocationId}
        AND "gatewayExecutionCanonicalJson" = ${canonicalJson(saved)} AND "cleanupCompletedAt" IS NULL`;
  }

  private async lockLive(
    tx: Prisma.TransactionClient,
    owner: ReviewRunGatewayExecutionOwner,
  ) {
    const snapshot = parseReviewRunRuntimeSnapshot(
      owner.runtimeSnapshotCanonicalJson,
    );
    const original = snapshot ? selectedAllocation(snapshot, owner) : null;
    if (!snapshot || !original?.limits) return null;
    // Live donor authority precedes source/binding locks, as at admission/save.
    await this.snapshots.lockGatewaySelection(
      tx,
      owner.identity.workspaceId,
      snapshot,
      owner.allocationId,
    );
    const privateRows = await tx.$queryRaw<
      readonly { gatewayExecutionCanonicalJson: string | null }[]
    >`
      SELECT "gatewayExecutionCanonicalJson" FROM "ReviewRunAuthorization"
      WHERE "authorizationId" = ${owner.authorizationId} FOR UPDATE`;
    if (privateRows.length !== 1 || !privateRows[0]) return null;
    const row = await tx.reviewRunAuthorization.findUnique({
      where: { authorizationId: owner.authorizationId },
    });
    if (
      !row ||
      row.state !== "active" ||
      row.runtimeSnapshotCanonicalJson !== owner.runtimeSnapshotCanonicalJson ||
      row.maxExpiresAt.toISOString() !== snapshot.deadline ||
      !Object.entries(owner.identity).every(
        ([key, value]) => Reflect.get(row, key) === value,
      )
    )
      return null;
    if (
      !(await this.snapshots.isLive(
        { snapshot, identity: owner.identity, now: new Date() },
        tx,
      ))
    )
      return null;
    if (
      snapshot.snapshotVersion === 4 &&
      !(await this.snapshots.isAllocationLive(
        {
          snapshot,
          allocationId: owner.allocationId!,
          identity: owner.identity,
          now: new Date(),
        },
        tx,
      ))
    )
      return null;
    const children =
      snapshot.snapshotVersion === 4
        ? await tx.$queryRaw<
            readonly { gatewayExecutionCanonicalJson: string }[]
          >`
          SELECT "gatewayExecutionCanonicalJson" FROM "ReviewRunGatewayAllocationExecution"
          WHERE "authorizationId" = ${owner.authorizationId} AND "allocationId" = ${owner.allocationId!}`
        : [];
    const rawBinding =
      snapshot.snapshotVersion === 4
        ? (children[0]?.gatewayExecutionCanonicalJson ?? null)
        : privateRows[0].gatewayExecutionCanonicalJson;
    const binding =
      rawBinding === null
        ? null
        : parseReviewRunGatewayExecutionBinding(rawBinding);
    if (
      binding &&
      (binding.operationId !== original.operationId ||
        binding.accountRef !== original.permittedAccountRef ||
        binding.deadline !== snapshot.deadline ||
        !reviewRunGatewayEpochMatches(
          snapshot,
          binding.authorizationEpoch,
          owner.allocationId,
        ))
    )
      return null;
    // Use fresh DB wall time after every awaited read, rather than transaction-start time.
    const times = await tx.$queryRaw<
      readonly { now: Date }[]
    >`SELECT (clock_timestamp() AT TIME ZONE 'UTC') AS "now"`;
    const now = times[0]?.now;
    if (!now || now >= row.expiresAt || now >= row.maxExpiresAt) return null;
    return { binding };
  }
}

function copyOwner(
  owner: ReviewRunGatewayExecutionOwner,
): ReviewRunGatewayExecutionOwner {
  return {
    authorizationId: owner.authorizationId,
    ...(owner.allocationId === undefined
      ? {}
      : { allocationId: owner.allocationId }),
    runtimeSnapshotCanonicalJson: owner.runtimeSnapshotCanonicalJson,
    identity: reviewRunGatewayOwnedIdentity(owner.identity),
  };
}

function selectedAllocation(
  snapshot: ReviewRunRuntimeSnapshot,
  owner: ReviewRunGatewayExecutionOwner,
) {
  return snapshot.snapshotVersion === 4
    ? owner.allocationId === undefined
      ? null
      : (snapshot.allocations.find(
          (row) => row.allocationId === owner.allocationId,
        ) ?? null)
    : owner.allocationId === undefined
      ? snapshot.gateway
      : null;
}
