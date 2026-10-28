import { createHash, randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import {
  defaultReviewSkillScope,
  parseReviewSkillScope,
  createCapturedReviewSkills,
} from "@reviewrouter/shared/review-skills-contract";
import {
  ReviewSkillsError,
  ReviewSkillsErrorCode as Code,
} from "../../domain/errors.js";
import {
  canEditReviewSkill,
  assertReviewSkillAuthor,
} from "../../domain/author-policy.js";
import type * as C from "../../application/contracts.js";
import type { ReviewSkillsStore } from "../../application/ports/review-skills-store.js";

type Tx = Prisma.TransactionClient;
type Reader = Pick<Tx, "$queryRaw" | "$executeRaw">;
type Arg<K extends keyof C.ReviewSkillsService> = Parameters<
  C.ReviewSkillsService[K]
>[0];
type Identity = {
  id: string;
  sourceWorkspaceId: string;
  authorUserId: string;
  deletedAt: Date | null;
};
type Skill = Identity & {
  headRevisionId: string;
  revisionNumber: number;
  name: string;
  description: string;
  instructions: string;
  createdAt: Date;
  updatedAt: Date;
  sourceWorkspaceName: string;
  authorName: string;
};
type Grant = {
  skillId: string;
  destinationWorkspaceId: string;
  version: number;
  revokedAt: Date | null;
};
type Binding = {
  skillId: string;
  repositoryConnectionId: string;
  generation: string;
  version: number;
  includePaths: unknown;
  excludePaths: unknown;
};
const q = <T>(reader: Reader, sql: Prisma.Sql) =>
  reader.$queryRaw<readonly T[]>(sql);
function retryableTransactionError(failure: unknown): boolean {
  if (!(failure instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (failure.code === "P2034") return true;
  if (failure.code !== "P2010") return false;
  const adapter = failure.meta?.driverAdapterError;
  const cause =
    adapter && typeof adapter === "object" && "cause" in adapter
      ? adapter.cause
      : undefined;
  const code =
    failure.meta?.code ??
    (cause && typeof cause === "object" && "originalCode" in cause
      ? cause.originalCode
      : undefined);
  return code === "40001" || code === "40P01";
}
const error = (
  code: Code,
  details: Readonly<Record<string, string | number>> = {},
): never => {
  throw new ReviewSkillsError(code, details);
};
const identitySql = (id: string) =>
  Prisma.sql`SELECT "id", "sourceWorkspaceId", "authorUserId", "deletedAt" FROM "ReviewSkill" WHERE "id"=${id}`;
export async function readIdentity(
  reader: Reader,
  id: string,
): Promise<Identity> {
  const row = (await q<Identity>(reader, identitySql(id)))[0];
  return row ?? error(Code.NotFound);
}
export async function lockSkillWorkspaces(
  tx: Reader,
  ids: readonly string[],
  requireActive = true,
): Promise<boolean> {
  const expected = [...new Set(ids)].sort();
  if (!expected.length) return false;
  const rows = await q<{ id: string; deletionState: string }>(
    tx,
    Prisma.sql`SELECT "id", "deletionState" FROM "Workspace" WHERE "id" IN (${Prisma.join(expected)}) ORDER BY "id" FOR UPDATE`,
  );
  return (
    rows.length === expected.length &&
    (!requireActive || rows.every((r) => r.deletionState === "active"))
  );
}
async function active(reader: Reader, workspaceId: string) {
  if (
    !(
      await q(
        reader,
        Prisma.sql`SELECT "id" FROM "Workspace" WHERE "id"=${workspaceId} AND "deletionState"='active'`,
      )
    ).length
  )
    error(Code.Forbidden);
}
async function role(
  reader: Reader,
  workspaceId: string,
  userId: string,
  lock = false,
) {
  const rows = await q<{ role: string }>(
    reader,
    Prisma.sql`SELECT "role" FROM "WorkspaceMember" WHERE "workspaceId"=${workspaceId} AND "userId"=${userId} ${lock ? Prisma.sql`FOR SHARE` : Prisma.empty}`,
  );
  return rows[0]?.role ?? null;
}
const admin = (value: string | null) => value === "owner" || value === "admin";
async function member(
  reader: Reader,
  workspaceId: string,
  actor: C.ReviewSkillsActor,
  requireAdmin = false,
  lock = false,
) {
  await active(reader, workspaceId);
  const current = await role(reader, workspaceId, actor.userId, lock);
  if (!current || (requireAdmin && !admin(current))) error(Code.Forbidden);
  return current;
}
async function manage(
  reader: Reader,
  workspaceId: string,
  actor: C.ReviewSkillsActor,
  ids: readonly string[],
  scmIds: readonly string[],
  lock = false,
  allowInactiveCleanup = false,
) {
  await active(reader, workspaceId);
  if (!ids.length || ids.length > 1000) error(Code.InvalidInput);
  const isAdmin = admin(await role(reader, workspaceId, actor.userId, lock));
  const rows = await q<{ id: string }>(
    reader,
    // Only cleanup reads/removals use this branch. The parent workspace and DB
    // role are locked for a removal; the composite binding FK preserves local
    // repository ownership until this serializable delta deletes the binding.
    allowInactiveCleanup && isAdmin
      ? Prisma.sql`SELECT "id" FROM "RepositoryConnection" WHERE "workspaceId"=${workspaceId} AND "id" IN (${Prisma.join(ids)}) ORDER BY "id"`
      : lock
        ? Prisma.sql`SELECT id FROM public.rr_review_skills_repository_lock(${workspaceId}, ${[...ids]}::text[])`
        : Prisma.sql`SELECT "id" FROM "RepositoryConnection" WHERE "workspaceId"=${workspaceId} AND "id" IN (${Prisma.join(ids)}) AND "selected"=true AND "archived"=false ORDER BY "id"`,
  );
  if (rows.length !== ids.length) error(Code.Forbidden);
  if (!isAdmin && ids.some((id) => !scmIds.includes(id))) error(Code.Forbidden);
}
const skillColumns = Prisma.sql`s."id", s."sourceWorkspaceId", s."authorUserId", s."deletedAt", s."headRevisionId", s."createdAt", s."updatedAt", v."revisionNumber", v."name", v."description", v."instructions", w."name" AS "sourceWorkspaceName", COALESCE(u."githubLogin",s."authorUserId") AS "authorName"`;
const skillJoins = Prisma.sql`FROM "ReviewSkill" s JOIN "ReviewSkillRevision" v ON v."id"=s."headRevisionId" AND v."skillId"=s."id" JOIN "Workspace" w ON w."id"=s."sourceWorkspaceId" LEFT JOIN "User" u ON u."id"=s."authorUserId"`;
const availability = (workspaceId: string) =>
  Prisma.sql`s."deletedAt" IS NULL AND w."deletionState"='active' AND (s."sourceWorkspaceId"=${workspaceId} OR EXISTS(SELECT 1 FROM "ReviewSkillGrant" g JOIN "ReviewSkillLink" l ON l."skillId"=g."skillId" AND l."workspaceId"=g."destinationWorkspaceId" WHERE g."skillId"=s."id" AND g."destinationWorkspaceId"=${workspaceId} AND g."revokedAt" IS NULL AND l."unlinkedAt" IS NULL AND l."acceptedGrantVersion"=g."version"))`;
async function available(
  reader: Reader,
  workspaceId: string,
  skillId?: string,
  options: {
    ids?: readonly string[];
    page?: { search?: string; cursor?: string | null };
    metadata?: boolean;
  } = {},
) {
  if (options.ids?.length === 0) return [];
  const columns = options.metadata
    ? Prisma.sql`s."id", s."sourceWorkspaceId", s."authorUserId", s."deletedAt", s."headRevisionId", s."createdAt", s."updatedAt", v."revisionNumber", v."name", v."description", '' AS "instructions", w."name" AS "sourceWorkspaceName", COALESCE(u."githubLogin",s."authorUserId") AS "authorName"`
    : skillColumns;
  return q<Skill>(
    reader,
    Prisma.sql`SELECT ${columns} ${skillJoins} WHERE ${availability(workspaceId)} ${skillId ? Prisma.sql`AND s."id"=${skillId}` : Prisma.empty} ${options.ids ? Prisma.sql`AND s."id" IN (${Prisma.join(options.ids)})` : Prisma.empty} ${options.page?.cursor ? Prisma.sql`AND s."id">${options.page.cursor}` : Prisma.empty} ${options.page?.search ? Prisma.sql`AND (position(lower(${options.page.search}) in lower(v."name"))>0 OR position(lower(${options.page.search}) in lower(v."description"))>0 OR position(lower(${options.page.search}) in lower(s."id"))>0)` : Prisma.empty} ORDER BY s."id" ${options.page ? Prisma.sql`LIMIT 51` : Prisma.empty}`,
  );
}
async function bindings(
  reader: Reader,
  workspaceId: string,
  repositoryIds?: readonly string[],
) {
  return q<Binding>(
    reader,
    Prisma.sql`SELECT "skillId", "repositoryConnectionId", "generation", "version", "includePaths", "excludePaths" FROM "ReviewSkillBinding" WHERE "workspaceId"=${workspaceId} ${repositoryIds ? Prisma.sql`AND "repositoryConnectionId" IN (${Prisma.join(repositoryIds)})` : Prisma.empty} ORDER BY "repositoryConnectionId", "skillId"`,
  );
}
const bindingView = (b: Binding): C.ReviewSkillBindingView => ({
  skillId: b.skillId,
  repositoryId: b.repositoryConnectionId,
  generation: b.generation,
  version: b.version,
  scope: parseReviewSkillScope({
    includePaths: b.includePaths,
    excludePaths: b.excludePaths,
  }),
});
function paginate<T>(
  items: readonly T[],
  id: (item: T) => string,
  input: { search?: string; cursor?: string | null },
  name: (item: T) => string,
): C.ReviewSkillsPage<T> {
  if ((input.search?.length ?? 0) > 200 || (input.cursor?.length ?? 0) > 160)
    error(Code.InvalidInput);
  const found = items.filter(
    (x) =>
      (!input.cursor || id(x) > input.cursor) &&
      (!input.search ||
        name(x).toLowerCase().includes(input.search.toLowerCase())),
  );
  return {
    items: found.slice(0, 50),
    nextCursor: found.length > 50 ? id(found[49]!) : null,
  };
}
export class PrismaReviewSkillsStore implements ReviewSkillsStore {
  constructor(readonly prisma: PrismaClient) {}
  private async transaction<T>(
    workspaceIds: readonly string[],
    run: (tx: Tx) => Promise<T>,
    requireAllActive = true,
  ): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            if (
              !(await lockSkillWorkspaces(tx, workspaceIds, requireAllActive))
            )
              error(Code.Forbidden);
            // A row lock alone leaves an older SERIALIZABLE snapshot usable after
            // waiting. Materialize the shared parent fence so a concurrent admission
            // with a pre-mutation snapshot must retry before using captured grants.
            await tx.$executeRaw`UPDATE "Workspace" SET "updatedAt"=CURRENT_TIMESTAMP WHERE "id" IN (${Prisma.join([...new Set(workspaceIds)].sort())})`;
            return run(tx);
          },
          {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
            maxWait: 10_000,
            timeout: 25_000,
          },
        );
      } catch (failure) {
        if (attempt < 2 && retryableTransactionError(failure)) continue;
        throw failure;
      }
    }
  }
  private async audit(
    tx: Reader,
    workspaceId: string,
    actor: C.ReviewSkillsActor,
    action: string,
    targetId: string,
    metadata: object = {},
  ) {
    await tx.$executeRaw`INSERT INTO "AuditEvent" ("id","workspaceId","actor","action","targetType","targetId","metadata") VALUES (${randomUUID()},${workspaceId},${actor.userId},${`review_skills.${action}`},'review_skill',${targetId},${JSON.stringify(metadata)}::jsonb)`;
  }
  async loadWorkspaceCapabilities(i: Arg<"loadWorkspaceCapabilities">) {
    const current = await member(this.prisma, i.workspaceId, i.actor);
    return {
      canCreate: true,
      canAdmin: admin(current),
      canEdit: false,
      canGrant: admin(current),
      canDelete: false,
    };
  }
  private async localUsage(
    reader: Reader,
    workspaceId: string,
    actor: C.ReviewSkillsActor,
  ) {
    // Membership alone never discloses other repositories' private inventory.
    return admin(await role(reader, workspaceId, actor.userId))
      ? q<{ skillId: string; repositoryId: string; name: string }>(
          reader,
          Prisma.sql`SELECT b."skillId",r."id" AS "repositoryId",r."fullName" AS "name" FROM "ReviewSkillBinding" b JOIN "RepositoryConnection" r ON r."id"=b."repositoryConnectionId" AND r."workspaceId"=b."workspaceId" WHERE b."workspaceId"=${workspaceId} ORDER BY r."id"`,
        )
      : [];
  }
  private async summaries(
    reader: Reader,
    workspaceId: string,
    actor: C.ReviewSkillsActor,
    rows: readonly Skill[],
  ): Promise<readonly C.ReviewSkillSummary[]> {
    const current = await role(reader, workspaceId, actor.userId);
    const usage = await this.localUsage(reader, workspaceId, actor);
    const sourceRoles = new Map<string, string | null>();
    for (const source of [...new Set(rows.map((r) => r.sourceWorkspaceId))])
      sourceRoles.set(source, await role(reader, source, actor.userId));
    return rows.map((s) => {
      const canEdit = canEditReviewSkill({
        actorUserId: actor.userId,
        authorUserId: s.authorUserId,
        hasSourceMembership: Boolean(sourceRoles.get(s.sourceWorkspaceId)),
      });
      const canGrant = admin(sourceRoles.get(s.sourceWorkspaceId) ?? null);
      return {
        skillId: s.id,
        revisionId: s.headRevisionId,
        revisionNumber: s.revisionNumber,
        name: s.name,
        description: s.description,
        sourceWorkspaceId: s.sourceWorkspaceId,
        sourceWorkspaceName: s.sourceWorkspaceName,
        authorUserId: s.authorUserId,
        authorName: s.authorName,
        linked: s.sourceWorkspaceId !== workspaceId,
        updatedAt: s.updatedAt.toISOString(),
        usedIn: usage
          .filter((u) => u.skillId === s.id)
          .map(({ repositoryId, name }) => ({ repositoryId, name })),
        capabilities: {
          canCreate: true,
          canAdmin: admin(current),
          canEdit,
          canGrant,
          canDelete: canEdit,
        },
      };
    });
  }
  async listWorkspaceSkills(i: Arg<"listWorkspaceSkills">) {
    const current = await member(this.prisma, i.workspaceId, i.actor);
    const rows = await available(this.prisma, i.workspaceId, undefined, {
      page: i,
      metadata: true,
    });
    // Retain cleanup access to a local link after revoke/source deletion. Read
    // only its canonical ID; fresh source metadata belongs to available() only.
    const unavailable = await q<{ skillId: string }>(
      this.prisma,
      Prisma.sql`SELECT l."skillId" FROM "ReviewSkillLink" l WHERE l."workspaceId"=${i.workspaceId} AND l."unlinkedAt" IS NULL AND NOT EXISTS(SELECT 1 ${skillJoins} WHERE s."id"=l."skillId" AND ${availability(i.workspaceId)}) ${i.cursor ? Prisma.sql`AND l."skillId">${i.cursor}` : Prisma.empty} ${i.search ? Prisma.sql`AND position(lower(${i.search}) in lower('Unavailable skill ' || l."skillId"))>0` : Prisma.empty} ORDER BY l."skillId" LIMIT 51`,
    );
    const summaries = await this.summaries(
      this.prisma,
      i.workspaceId,
      i.actor,
      rows,
    );
    const usage = unavailable.length
      ? await this.localUsage(this.prisma, i.workspaceId, i.actor)
      : [];
    const entries: C.ReviewSkillLibraryEntry[] = [
      ...summaries.map((summary) => ({ ...summary, available: true as const })),
      ...unavailable
        .filter(({ skillId }) => !rows.some((row) => row.id === skillId))
        .map(({ skillId }) => ({
          skillId,
          available: false as const,
          linked: true as const,
          name: "Unavailable skill" as const,
          unavailableReason: "unavailable" as const,
          usedIn: usage
            .filter((item) => item.skillId === skillId)
            .map(({ repositoryId, name }) => ({ repositoryId, name })),
          canUnlink: admin(current),
        })),
    ];
    return paginate(
      entries.sort((left, right) =>
        left.skillId < right.skillId
          ? -1
          : left.skillId > right.skillId
            ? 1
            : 0,
      ),
      (entry) => entry.skillId,
      i,
      (entry) =>
        entry.available
          ? `${entry.name} ${entry.description} ${entry.skillId}`
          : `${entry.name} ${entry.skillId}`,
    );
  }
  private async document(
    reader: Reader,
    i: Arg<"loadSkill">,
  ): Promise<C.ReviewSkillDocument> {
    const row =
      (await available(reader, i.workspaceId, i.skillId))[0] ??
      error(Code.NotFound);
    const summary = (
      await this.summaries(reader, i.workspaceId, i.actor, [row])
    )[0]!;
    return {
      ...summary,
      instructions: row.instructions,
      createdAt: row.createdAt.toISOString(),
      canEdit: summary.capabilities.canEdit,
      canGrant: summary.capabilities.canGrant,
      canDelete: summary.capabilities.canDelete,
    };
  }
  async loadSkill(i: Arg<"loadSkill">) {
    await member(this.prisma, i.workspaceId, i.actor);
    return this.document(this.prisma, i);
  }
  async createSkill(i: Arg<"createSkill">) {
    return this.transaction([i.workspaceId], async (tx) => {
      await member(tx, i.workspaceId, i.actor, false, true);
      // The immutable first revision identifies this creation intent even after
      // subsequent edits. The workspace fence serializes concurrent exact retries.
      const prior = (
        await q<C.ReviewSkillContent & { id: string; deletedAt: Date | null }>(
          tx,
          Prisma.sql`SELECT s."id",s."deletedAt",v."name",v."description",v."instructions" FROM "ReviewSkill" s JOIN "ReviewSkillRevision" v ON v."skillId"=s."id" AND v."revisionNumber"=1 WHERE s."sourceWorkspaceId"=${i.workspaceId} AND s."authorUserId"=${i.actor.userId} AND s."createOperationId"=${i.createOperationId}`,
        )
      )[0];
      if (prior) {
        if (prior.deletedAt) error(Code.Unavailable);
        if (
          prior.name !== i.content.name ||
          prior.description !== i.content.description ||
          prior.instructions !== i.content.instructions
        )
          error(Code.Conflict);
        return this.document(tx, { ...i, skillId: prior.id });
      }
      const skillId = randomUUID(),
        revisionId = randomUUID();
      await tx.$executeRaw`INSERT INTO "ReviewSkill" ("id","sourceWorkspaceId","authorUserId","headRevisionId","createOperationId") VALUES (${skillId},${i.workspaceId},${i.actor.userId},${revisionId},${i.createOperationId})`;
      await this.insertRevision(tx, skillId, revisionId, 1, i.content);
      await this.audit(tx, i.workspaceId, i.actor, "created", skillId, {
        revisionId,
      });
      return this.document(tx, { ...i, skillId });
    });
  }
  private async insertRevision(
    tx: Reader,
    skillId: string,
    revisionId: string,
    n: number,
    content: C.ReviewSkillContent,
  ) {
    const digest = `sha256:${createHash("sha256")
      .update(
        JSON.stringify([
          content.name,
          content.description,
          content.instructions,
        ]),
      )
      .digest("hex")}`;
    await tx.$executeRaw`INSERT INTO "ReviewSkillRevision" ("id","skillId","revisionNumber","name","description","instructions","contentDigest") VALUES (${revisionId},${skillId},${n},${content.name},${content.description},${content.instructions},${digest})`;
  }
  async saveSkill(i: Arg<"saveSkill">) {
    const original = await readIdentity(this.prisma, i.skillId);
    return this.transaction([original.sourceWorkspaceId], async (tx) => {
      await member(tx, original.sourceWorkspaceId, i.actor, false, true);
      const row =
        (await available(tx, original.sourceWorkspaceId, i.skillId))[0] ??
        error(Code.NotFound);
      if (i.workspaceId !== row.sourceWorkspaceId) error(Code.Forbidden);
      assertReviewSkillAuthor({
        actorUserId: i.actor.userId,
        authorUserId: row.authorUserId,
        hasSourceMembership: true,
      });
      if (row.headRevisionId !== i.expectedRevisionId)
        error(Code.Conflict, { currentRevisionId: row.headRevisionId });
      const revisionId = randomUUID();
      await this.insertRevision(
        tx,
        row.id,
        revisionId,
        row.revisionNumber + 1,
        i.content,
      );
      await tx.$executeRaw`UPDATE "ReviewSkill" SET "headRevisionId"=${revisionId},"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=${row.id} AND "headRevisionId"=${i.expectedRevisionId}`;
      await this.audit(tx, row.sourceWorkspaceId, i.actor, "saved", row.id, {
        revisionId,
      });
      return this.document(tx, i);
    });
  }
  async deleteSkill(i: Arg<"deleteSkill">) {
    const original = await readIdentity(this.prisma, i.skillId);
    return this.transaction([original.sourceWorkspaceId], async (tx) => {
      await member(tx, original.sourceWorkspaceId, i.actor, false, true);
      if (i.workspaceId !== original.sourceWorkspaceId) error(Code.Forbidden);
      assertReviewSkillAuthor({
        actorUserId: i.actor.userId,
        authorUserId: original.authorUserId,
        hasSourceMembership: true,
      });
      const deps = await q(
        tx,
        Prisma.sql`SELECT 1 FROM "ReviewSkillBinding" WHERE "skillId"=${i.skillId} AND "workspaceId"=${i.workspaceId} UNION ALL SELECT 1 FROM "ReviewSkillGrant" WHERE "skillId"=${i.skillId} AND "revokedAt" IS NULL LIMIT 1`,
      );
      if (deps.length) error(Code.DependencyExists);
      await tx.$executeRaw`UPDATE "ReviewSkill" SET "deletedAt"=COALESCE("deletedAt",CURRENT_TIMESTAMP) WHERE "id"=${i.skillId}`;
      await this.audit(tx, i.workspaceId, i.actor, "deleted", i.skillId);
    });
  }
  private async grantView(
    reader: Reader,
    skillId: string,
    destinationWorkspaceId: string,
    actor: C.ReviewSkillsActor,
  ): Promise<C.ReviewSkillGrantView> {
    const row =
      (
        await q<Grant & { accepted: boolean }>(
          reader,
          Prisma.sql`SELECT g.*, EXISTS(SELECT 1 FROM "ReviewSkillLink" l WHERE l."skillId"=g."skillId" AND l."workspaceId"=g."destinationWorkspaceId" AND l."acceptedGrantVersion"=g."version" AND l."unlinkedAt" IS NULL) AS accepted FROM "ReviewSkillGrant" g WHERE g."skillId"=${skillId} AND g."destinationWorkspaceId"=${destinationWorkspaceId}`,
        )
      )[0] ?? error(Code.NotFound);
    const visible = Boolean(
      await role(reader, destinationWorkspaceId, actor.userId),
    );
    const ws = visible
      ? (
          await q<{ name: string }>(
            reader,
            Prisma.sql`SELECT "name" FROM "Workspace" WHERE "id"=${destinationWorkspaceId}`,
          )
        )[0]
      : null;
    return {
      skillId,
      destinationWorkspaceId,
      destinationWorkspaceName: ws?.name ?? null,
      version: row.version,
      active: !row.revokedAt,
      accepted: !row.revokedAt && row.accepted,
    };
  }
  private async grantIn(tx: Reader, i: Arg<"grantSkill">) {
    const original = await readIdentity(tx, i.skillId);
    if (
      original.sourceWorkspaceId !== i.sourceWorkspaceId ||
      original.deletedAt ||
      i.sourceWorkspaceId === i.destinationWorkspaceId
    )
      error(Code.InvalidInput);
    await member(tx, i.sourceWorkspaceId, i.actor, true, true);
    await tx.$executeRaw`INSERT INTO "ReviewSkillGrant" ("skillId","destinationWorkspaceId","grantedBy") VALUES (${i.skillId},${i.destinationWorkspaceId},${i.actor.userId}) ON CONFLICT ("skillId","destinationWorkspaceId") DO UPDATE SET "version"="ReviewSkillGrant"."version"+1,"revokedAt"=NULL,"grantedBy"=EXCLUDED."grantedBy","grantedAt"=CURRENT_TIMESTAMP WHERE "ReviewSkillGrant"."revokedAt" IS NOT NULL`;
    await this.audit(tx, i.sourceWorkspaceId, i.actor, "granted", i.skillId, {
      destinationWorkspaceId: i.destinationWorkspaceId,
    });
    return this.grantView(tx, i.skillId, i.destinationWorkspaceId, i.actor);
  }
  async grantSkill(i: Arg<"grantSkill">) {
    return this.transaction(
      [i.sourceWorkspaceId, i.destinationWorkspaceId],
      (tx) => this.grantIn(tx, i),
    );
  }
  async revokeSkillGrant(i: Arg<"revokeSkillGrant">) {
    return this.transaction(
      [i.sourceWorkspaceId, i.destinationWorkspaceId],
      async (tx) => {
        const original = await readIdentity(tx, i.skillId);
        if (original.sourceWorkspaceId !== i.sourceWorkspaceId)
          error(Code.Forbidden);
        await member(tx, i.sourceWorkspaceId, i.actor, true, true);
        const current = await this.grantView(
          tx,
          i.skillId,
          i.destinationWorkspaceId,
          i.actor,
        );
        if (!current.active) return current;
        if (current.version !== i.expectedGrantVersion) error(Code.StaleGrant);
        await tx.$executeRaw`UPDATE "ReviewSkillGrant" SET "revokedAt"=CURRENT_TIMESTAMP,"version"="version"+1 WHERE "skillId"=${i.skillId} AND "destinationWorkspaceId"=${i.destinationWorkspaceId}`;
        await this.audit(
          tx,
          i.sourceWorkspaceId,
          i.actor,
          "revoked",
          i.skillId,
          { destinationWorkspaceId: i.destinationWorkspaceId },
        );
        return this.grantView(tx, i.skillId, i.destinationWorkspaceId, i.actor);
      },
      false,
    );
  }
  private async acceptIn(
    tx: Reader,
    i: Arg<"acceptSkillGrant">,
  ): Promise<C.ReviewSkillLinkView> {
    await member(tx, i.destinationWorkspaceId, i.actor, true, true);
    const current = await this.grantView(
      tx,
      i.skillId,
      i.destinationWorkspaceId,
      i.actor,
    );
    const original = await readIdentity(tx, i.skillId);
    if (
      !current.active ||
      original.deletedAt ||
      current.version !== i.expectedGrantVersion
    )
      error(Code.StaleGrant);
    await tx.$executeRaw`INSERT INTO "ReviewSkillLink" ("workspaceId","skillId","acceptedGrantVersion","acceptedBy") VALUES (${i.destinationWorkspaceId},${i.skillId},${current.version},${i.actor.userId}) ON CONFLICT ("workspaceId","skillId") DO UPDATE SET "acceptedGrantVersion"=EXCLUDED."acceptedGrantVersion","acceptedBy"=EXCLUDED."acceptedBy","acceptedAt"=CURRENT_TIMESTAMP,"unlinkedAt"=NULL WHERE "ReviewSkillLink"."unlinkedAt" IS NOT NULL OR "ReviewSkillLink"."acceptedGrantVersion"<>EXCLUDED."acceptedGrantVersion"`;
    await this.audit(
      tx,
      i.destinationWorkspaceId,
      i.actor,
      "accepted",
      i.skillId,
      { grantVersion: current.version },
    );
    return {
      skillId: i.skillId,
      workspaceId: i.destinationWorkspaceId,
      acceptedGrantVersion: current.version,
      active: true,
    };
  }
  async acceptSkillGrant(i: Arg<"acceptSkillGrant">) {
    const source = await readIdentity(this.prisma, i.skillId);
    return this.transaction(
      [source.sourceWorkspaceId, i.destinationWorkspaceId],
      (tx) => this.acceptIn(tx, i),
    );
  }
  async linkSkillAsDualAdmin(i: Arg<"linkSkillAsDualAdmin">) {
    return this.transaction(
      [i.sourceWorkspaceId, i.destinationWorkspaceId],
      async (tx) => {
        await member(tx, i.destinationWorkspaceId, i.actor, true, true);
        const grant = await this.grantIn(tx, i);
        return this.acceptIn(tx, {
          actor: i.actor,
          destinationWorkspaceId: i.destinationWorkspaceId,
          skillId: i.skillId,
          expectedGrantVersion: grant.version,
        });
      },
    );
  }
  async unlinkSkill(i: Arg<"unlinkSkill">) {
    return this.transaction([i.destinationWorkspaceId], async (tx) => {
      await member(tx, i.destinationWorkspaceId, i.actor, true, true);
      if (
        (
          await q(
            tx,
            Prisma.sql`SELECT 1 FROM "ReviewSkillBinding" WHERE "workspaceId"=${i.destinationWorkspaceId} AND "skillId"=${i.skillId} LIMIT 1`,
          )
        ).length
      )
        error(Code.DependencyExists);
      await tx.$executeRaw`UPDATE "ReviewSkillLink" SET "unlinkedAt"=COALESCE("unlinkedAt",CURRENT_TIMESTAMP) WHERE "workspaceId"=${i.destinationWorkspaceId} AND "skillId"=${i.skillId}`;
      await this.audit(
        tx,
        i.destinationWorkspaceId,
        i.actor,
        "unlinked",
        i.skillId,
      );
    });
  }
  async loadSkillAccess(i: Arg<"loadSkillAccess">) {
    const source = await readIdentity(this.prisma, i.skillId);
    if (source.sourceWorkspaceId !== i.workspaceId) error(Code.Forbidden);
    await member(this.prisma, i.workspaceId, i.actor, true);
    const rows = await q<{ destinationWorkspaceId: string }>(
      this.prisma,
      Prisma.sql`SELECT "destinationWorkspaceId" FROM "ReviewSkillGrant" WHERE "skillId"=${i.skillId} ORDER BY "destinationWorkspaceId"`,
    );
    const views: C.ReviewSkillGrantView[] = [];
    for (const row of rows)
      views.push(
        await this.grantView(
          this.prisma,
          i.skillId,
          row.destinationWorkspaceId,
          i.actor,
        ),
      );
    return views;
  }
  async listLinkableSkills(i: Arg<"listLinkableSkills">) {
    await member(this.prisma, i.destinationWorkspaceId, i.actor, true);
    const rows = await q<Skill>(
      this.prisma,
      Prisma.sql`SELECT s."id",s."sourceWorkspaceId",s."authorUserId",s."deletedAt",s."headRevisionId",s."createdAt",s."updatedAt",v."revisionNumber",v."name",v."description",'' AS instructions,w."name" AS "sourceWorkspaceName",COALESCE(u."githubLogin",s."authorUserId") AS "authorName" ${skillJoins} WHERE s."sourceWorkspaceId"<>${i.destinationWorkspaceId} AND s."deletedAt" IS NULL AND w."deletionState"='active' AND (EXISTS(SELECT 1 FROM "ReviewSkillGrant" g WHERE g."skillId"=s."id" AND g."destinationWorkspaceId"=${i.destinationWorkspaceId} AND g."revokedAt" IS NULL) OR EXISTS(SELECT 1 FROM "WorkspaceMember" m WHERE m."workspaceId"=s."sourceWorkspaceId" AND m."userId"=${i.actor.userId} AND m."role" IN ('owner','admin'))) ${i.cursor ? Prisma.sql`AND s."id">${i.cursor}` : Prisma.empty} ${i.search ? Prisma.sql`AND (position(lower(${i.search}) in lower(v."name"))>0 OR position(lower(${i.search}) in lower(v."description"))>0)` : Prisma.empty} ORDER BY s."id" LIMIT 51`,
    );
    const page = paginate(
        rows,
        (s) => s.id,
        i,
        (s) => `${s.name} ${s.description}`,
      ),
      summaries = await this.summaries(
        this.prisma,
        i.destinationWorkspaceId,
        i.actor,
        page.items,
      );
    const result: C.ReviewSkillLinkChoice[] = [];
    for (const s of summaries) {
      const g = (
        await q<Grant>(
          this.prisma,
          Prisma.sql`SELECT * FROM "ReviewSkillGrant" WHERE "skillId"=${s.skillId} AND "destinationWorkspaceId"=${i.destinationWorkspaceId} AND "revokedAt" IS NULL`,
        )
      )[0];
      result.push({
        ...s,
        grantVersion: g?.version ?? null,
        canAccept: Boolean(g),
        canLinkAsDualAdmin: admin(
          await role(this.prisma, s.sourceWorkspaceId, i.actor.userId),
        ),
      });
    }
    return { items: result, nextCursor: page.nextCursor };
  }
  async listRepositoryTargetIds(
    i: Arg<"listSkillRepositoryTargets">,
  ): Promise<readonly string[]> {
    const skillAvailable = await this.authorizeTargetSkill(i);
    const isAdmin = admin(
      await role(this.prisma, i.workspaceId, i.actor.userId),
    );
    const rows = await q<{ id: string }>(
      this.prisma,
      Prisma.sql`SELECT r."id" FROM "RepositoryConnection" r WHERE r."workspaceId"=${i.workspaceId} AND ((r.selected=true AND r.archived=false) ${isAdmin ? Prisma.sql`OR EXISTS(SELECT 1 FROM "ReviewSkillBinding" b WHERE b."workspaceId"=${i.workspaceId} AND b."repositoryConnectionId"=r."id" AND b."skillId"=${i.skillId})` : Prisma.empty}) ${skillAvailable ? Prisma.empty : Prisma.sql`AND EXISTS(SELECT 1 FROM "ReviewSkillBinding" b WHERE b."workspaceId"=${i.workspaceId} AND b."repositoryConnectionId"=r."id" AND b."skillId"=${i.skillId})`} ${i.cursor ? Prisma.sql`AND r."id">${i.cursor}` : Prisma.empty} ${i.search ? Prisma.sql`AND position(lower(${i.search}) in lower(r."fullName"))>0` : Prisma.empty} ORDER BY r."id" LIMIT 51`,
    );
    return rows.map((r) => r.id);
  }
  private async authorizeTargetSkill(i: Arg<"listSkillRepositoryTargets">) {
    await member(this.prisma, i.workspaceId, i.actor);
    if (
      (
        await available(this.prisma, i.workspaceId, i.skillId, {
          metadata: true,
        })
      ).length
    )
      return true;
    const link = await q(
      this.prisma,
      Prisma.sql`SELECT 1 FROM "ReviewSkillLink" WHERE "workspaceId"=${i.workspaceId} AND "skillId"=${i.skillId} AND "unlinkedAt" IS NULL`,
    );
    if (!link.length) error(Code.NotFound);
    return false;
  }
  async listSkillRepositoryTargets(
    i: Arg<"listSkillRepositoryTargets">,
    scmIds: readonly string[],
  ) {
    const skillAvailable = await this.authorizeTargetSkill(i);
    const isAdmin = admin(
      await role(this.prisma, i.workspaceId, i.actor.userId),
    );
    const rows = await q<C.ReviewSkillRepositoryTarget>(
      this.prisma,
      Prisma.sql`SELECT r."id" AS "repositoryId",r."fullName" AS name,(r."selected" AND NOT r."archived") AS active,(b."skillId" IS NOT NULL) AS assigned,b."version" AS "bindingVersion" FROM "RepositoryConnection" r LEFT JOIN "ReviewSkillBinding" b ON b."repositoryConnectionId"=r."id" AND b."skillId"=${i.skillId} WHERE r."workspaceId"=${i.workspaceId} AND ((r."selected"=true AND r."archived"=false) ${isAdmin ? Prisma.sql`OR b."skillId" IS NOT NULL` : Prisma.empty}) ${skillAvailable ? Prisma.empty : Prisma.sql`AND b."skillId" IS NOT NULL`} ${isAdmin ? Prisma.empty : scmIds.length ? Prisma.sql`AND r."id" IN (${Prisma.join(scmIds)})` : Prisma.sql`AND false`} ${i.cursor ? Prisma.sql`AND r."id">${i.cursor}` : Prisma.empty} ${i.search ? Prisma.sql`AND position(lower(${i.search}) in lower(r."fullName"))>0` : Prisma.empty} ORDER BY r."id" LIMIT 51`,
    );
    return paginate(
      rows,
      (r) => r.repositoryId,
      i,
      (r) => r.name,
    );
  }
  async loadRepositorySkillSettings(
    i: Arg<"loadRepositorySkillSettings">,
    scmIds: readonly string[],
  ) {
    await manage(this.prisma, i.workspaceId, i.actor, [i.repositoryId], scmIds);
    return this.settings(this.prisma, i.workspaceId, i.repositoryId);
  }
  private async settings(
    reader: Reader,
    workspaceId: string,
    repositoryId: string,
  ): Promise<C.ReviewSkillRepositorySettings> {
    const source = (
      await q<{ roots: C.ReviewSkillSourceRoot[]; version: number }>(
        reader,
        Prisma.sql`SELECT "roots","version" FROM "ReviewSkillRepositorySource" WHERE "repositoryConnectionId"=${repositoryId}`,
      )
    )[0];
    const all = await bindings(reader, workspaceId, [repositoryId]),
      live = new Set(
        (
          await available(reader, workspaceId, undefined, {
            ids: all.map((b) => b.skillId),
            metadata: true,
          })
        ).map((s) => s.id),
      );
    return {
      repositoryId,
      roots: source?.roots ?? [],
      sourceVersion: source?.version ?? 0,
      bindings: all.map(bindingView),
      unavailable: all
        .filter((b) => !live.has(b.skillId))
        .map((b) => ({ skillId: b.skillId, name: "Unavailable skill" })),
    };
  }
  async listAssignmentChoices(
    i: Arg<"listAssignmentChoices">,
    scmIds: readonly string[],
  ) {
    await manage(
      this.prisma,
      i.workspaceId,
      i.actor,
      i.repositoryIds,
      scmIds,
      false,
      true,
    );
    const all = await bindings(this.prisma, i.workspaceId, i.repositoryIds);
    const ownIds = [...new Set(all.map((b) => b.skillId))];
    const assignedLive = await available(
      this.prisma,
      i.workspaceId,
      undefined,
      { ids: ownIds, metadata: true },
    );
    const candidateLive = i.assignedOnly
      ? assignedLive
      : await available(this.prisma, i.workspaceId, undefined, {
          page: i,
          metadata: true,
        });
    const liveMap = new Map(
      [...assignedLive, ...candidateLive].map((s) => [s.id, s]),
    );
    const ids = [
      ...new Set([
        ...candidateLive.map((s) => s.id),
        ...ownIds.filter((id) => !liveMap.has(id)),
      ]),
    ].sort();
    const bySkill = new Map<string, Binding[]>();
    for (const b of all) {
      const list = bySkill.get(b.skillId) ?? [];
      list.push(b);
      bySkill.set(b.skillId, list);
    }
    const rows: C.ReviewSkillAssignmentChoice[] = ids.map((id) => {
      const s = liveMap.get(id),
        own = bySkill.get(id) ?? [];
      return {
        skillId: id,
        available: Boolean(s),
        name: s?.name ?? "Unavailable skill",
        description: s?.description ?? null,
        sourceWorkspaceId: s?.sourceWorkspaceId ?? null,
        sourceWorkspaceName: s?.sourceWorkspaceName ?? null,
        authorName: s?.authorName ?? null,
        assignedCount: own.length,
        repositoryCount: i.repositoryIds.length,
        unavailableReason: s ? null : "unavailable",
        bindings: own.map(bindingView),
      };
    });
    return paginate(
      rows,
      (r) => r.skillId,
      i,
      (r) => `${r.name} ${r.description ?? ""} ${r.skillId}`,
    );
  }

  async applyAssignments(
    i: Arg<"applyAssignments">,
    scmIds: readonly string[],
  ) {
    const sources = await q<{ sourceWorkspaceId: string }>(
      this.prisma,
      Prisma.sql`SELECT DISTINCT "sourceWorkspaceId" FROM "ReviewSkill" WHERE "id" IN (${Prisma.join(i.skillIds)})`,
    );
    return this.transaction(
      [
        i.workspaceId,
        ...(i.mode === "remove" ? [] : sources.map((s) => s.sourceWorkspaceId)),
      ],
      async (tx) => {
        await manage(
          tx,
          i.workspaceId,
          i.actor,
          i.repositoryIds,
          scmIds,
          true,
          i.mode === "remove",
        );
        const total = i.repositoryIds.length * i.skillIds.length;
        if (i.mode === "remove") {
          const removed =
            await tx.$executeRaw`DELETE FROM "ReviewSkillBinding" WHERE "workspaceId"=${i.workspaceId} AND "repositoryConnectionId" IN (${Prisma.join(i.repositoryIds)}) AND "skillId" IN (${Prisma.join(i.skillIds)})`;
          await this.audit(
            tx,
            i.workspaceId,
            i.actor,
            "assignments_removed",
            i.workspaceId,
            { count: removed },
          );
          return { added: 0, removed, unchanged: total - removed };
        }
        const liveIds = new Set(
          (
            await available(tx, i.workspaceId, undefined, {
              ids: i.skillIds,
              metadata: true,
            })
          ).map((s) => s.id),
        );
        if (i.skillIds.some((id) => !liveIds.has(id))) error(Code.Unavailable);
        if (i.skillIds.length > 32) error(Code.LimitExceeded);
        const overflow = await q(
          tx,
          Prisma.sql`WITH proposed AS (SELECT b."repositoryConnectionId" AS r,b."skillId" AS s FROM "ReviewSkillBinding" b WHERE b."repositoryConnectionId" IN (${Prisma.join(i.repositoryIds)}) UNION SELECT r.value AS r,s.value AS s FROM jsonb_array_elements_text(${JSON.stringify(i.repositoryIds)}::jsonb) r CROSS JOIN jsonb_array_elements_text(${JSON.stringify(i.skillIds)}::jsonb) s) SELECT r FROM proposed GROUP BY r HAVING count(*)>32 LIMIT 1`,
        );
        if (overflow.length) error(Code.LimitExceeded);
        const scope = i.scope ?? defaultReviewSkillScope;
        const added =
          await tx.$executeRaw`INSERT INTO "ReviewSkillBinding" ("workspaceId","repositoryConnectionId","skillId","includePaths","excludePaths") SELECT ${i.workspaceId},r.value,s.value,${JSON.stringify(scope.includePaths)}::jsonb,${JSON.stringify(scope.excludePaths)}::jsonb FROM jsonb_array_elements_text(${JSON.stringify(i.repositoryIds)}::jsonb) r CROSS JOIN jsonb_array_elements_text(${JSON.stringify(i.skillIds)}::jsonb) s ON CONFLICT ("repositoryConnectionId","skillId") DO NOTHING`;
        await this.audit(
          tx,
          i.workspaceId,
          i.actor,
          "assignments_added",
          i.workspaceId,
          { count: added },
        );
        return { added, removed: 0, unchanged: total - added };
      },
    );
  }
  async updateBindingScope(
    i: Arg<"updateBindingScope">,
    scmIds: readonly string[],
  ) {
    const source = await readIdentity(this.prisma, i.skillId);
    return this.transaction(
      [i.workspaceId, source.sourceWorkspaceId],
      async (tx) => {
        await manage(
          tx,
          i.workspaceId,
          i.actor,
          [i.repositoryId],
          scmIds,
          true,
        );
        if (!(await available(tx, i.workspaceId, i.skillId)).length)
          error(Code.Unavailable);
        const n =
          await tx.$executeRaw`UPDATE "ReviewSkillBinding" SET "includePaths"=${JSON.stringify(i.scope.includePaths)}::jsonb,"excludePaths"=${JSON.stringify(i.scope.excludePaths)}::jsonb,"version"="version"+1 WHERE "workspaceId"=${i.workspaceId} AND "repositoryConnectionId"=${i.repositoryId} AND "skillId"=${i.skillId} AND "generation"=${i.expectedGeneration} AND "version"=${i.expectedVersion}`;
        if (!n) error(Code.Conflict);
        await this.audit(
          tx,
          i.workspaceId,
          i.actor,
          "scope_updated",
          i.skillId,
          { repositoryId: i.repositoryId },
        );
        return bindingView(
          (await bindings(tx, i.workspaceId, [i.repositoryId])).find(
            (b) => b.skillId === i.skillId,
          )!,
        );
      },
    );
  }
  async setRepositorySources(
    i: Arg<"setRepositorySources">,
    scmIds: readonly string[],
  ) {
    return this.transaction([i.workspaceId], async (tx) => {
      await manage(tx, i.workspaceId, i.actor, [i.repositoryId], scmIds, true);
      const current = (
        await q<{ version: number }>(
          tx,
          Prisma.sql`SELECT "version" FROM "ReviewSkillRepositorySource" WHERE "repositoryConnectionId"=${i.repositoryId}`,
        )
      )[0];
      if ((current?.version ?? 0) !== i.expectedVersion) error(Code.Conflict);
      if (current)
        await tx.$executeRaw`UPDATE "ReviewSkillRepositorySource" SET roots=${JSON.stringify([...i.roots].sort())}::jsonb,"version"="version"+1 WHERE "repositoryConnectionId"=${i.repositoryId}`;
      else
        await tx.$executeRaw`INSERT INTO "ReviewSkillRepositorySource" ("repositoryConnectionId",roots) VALUES (${i.repositoryId},${JSON.stringify([...i.roots].sort())}::jsonb)`;
      await this.audit(
        tx,
        i.workspaceId,
        i.actor,
        "sources_updated",
        i.repositoryId,
        { count: i.roots.length },
      );
      return this.settings(tx, i.workspaceId, i.repositoryId);
    });
  }
}

export function createPrismaReviewSkillsAdmission(prisma: PrismaClient) {
  const capture = async (
    i: C.ReviewSkillsAdmissionInput,
    reader: Reader = prisma,
  ): Promise<C.ReviewSkillsAdmissionSelection> => {
    await active(reader, i.workspaceId);
    const repo = await q(
      reader,
      Prisma.sql`SELECT "id" FROM "RepositoryConnection" WHERE "id"=${i.repositoryConnectionId} AND "workspaceId"=${i.workspaceId} AND selected=true AND archived=false`,
    );
    if (!repo.length) error(Code.Unavailable);
    const all = await bindings(reader, i.workspaceId, [
      i.repositoryConnectionId,
    ]);
    const live = new Map(
      (
        await available(reader, i.workspaceId, undefined, {
          ids: all.map((b) => b.skillId),
        })
      ).map((s) => [s.id, s]),
    );
    if (all.some((b) => !live.has(b.skillId))) error(Code.Unavailable);
    const webSkills = all.map((b) => {
      const s = live.get(b.skillId)!;
      return {
        skillId: s.id,
        revisionId: s.headRevisionId,
        sourceWorkspaceId: s.sourceWorkspaceId,
        name: s.name,
        description: s.description,
        instructions: s.instructions,
        ...parseReviewSkillScope({
          includePaths: b.includePaths,
          excludePaths: b.excludePaths,
        }),
      };
    });
    const roots =
      (
        await q<{ roots: readonly C.ReviewSkillSourceRoot[] }>(
          reader,
          Prisma.sql`SELECT roots FROM "ReviewSkillRepositorySource" WHERE "repositoryConnectionId"=${i.repositoryConnectionId}`,
        )
      )[0]?.roots ?? [];
    let canonical;
    try {
      canonical = createCapturedReviewSkills({
        baseSha: i.baseSha,
        webSkills,
        gitSources: roots.map((root) => ({ root })),
      });
    } catch (e) {
      if (e instanceof Error && /too_large|too_many/.test(e.message))
        error(Code.LimitExceeded);
      throw e;
    }
    return {
      sourceWorkspaceIds: [
        ...new Set(webSkills.map((s) => s.sourceWorkspaceId)),
      ].sort(),
      webSkills: canonical.webSkills,
      gitSources: canonical.gitSources,
    };
  };
  return {
    capture,
    prelock: (
      tx: Tx,
      i: { workspaceId: string; candidate: C.ReviewSkillsAdmissionSelection },
    ) =>
      lockSkillWorkspaces(tx, [
        i.workspaceId,
        ...i.candidate.sourceWorkspaceIds,
      ]),
    matchesAdmission: async (
      tx: Tx,
      i: C.ReviewSkillsAdmissionInput & {
        candidate: C.ReviewSkillsAdmissionSelection;
      },
    ) => {
      try {
        const current = await capture(i, tx);
        if (
          current.sourceWorkspaceIds.some(
            (id) => !i.candidate.sourceWorkspaceIds.includes(id),
          )
        )
          return false;
        return JSON.stringify(current) === JSON.stringify(i.candidate);
      } catch (e) {
        if (e instanceof ReviewSkillsError) return false;
        throw e;
      }
    },
  };
}
