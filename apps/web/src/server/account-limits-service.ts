import { createHmac } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import {
  readAccountLimits,
  type AccountLimitsReader,
  type AccountLimitsView,
} from "@reviewrouter/features-provider-accounts";
import type { AccountsResult, AccountView } from "./account-gateway-accounts";

type Scope = { userId: string; workspaceId?: string };
type Source = {
  id: string;
  ownerUserId: string | null;
  ownerWorkspaceId: string | null;
  gatewayAccountRef: string;
  profileRef: string | null;
  state: string;
  authorizationEpochMirror: bigint | null;
  pendingSourceOperationId: string | null;
  role: string | null;
  bindingId: string | null;
  bindingRevision: number | null;
};
export type AccountLimitsService = ReturnType<
  typeof createAccountLimitsService
>;

/** Resolves local IDs under live authorization. The native reader is cached-only. */
export function createAccountLimitsService(input: {
  prisma: PrismaClient;
  reader: AccountLimitsReader;
  secret: string;
  authorize(): Promise<Scope>;
  ownerRef(
    owner:
      | { kind: "user"; userId: string }
      | { kind: "workspace"; workspaceId: string },
  ): string;
  operatorWorkspaceId?: string;
  now?: () => Date;
}) {
  const now = input.now ?? (() => new Date());
  const view = (
    status: "restricted" | "unknown" | "unavailable",
    displayToken = "restricted",
  ): AccountLimitsView => ({
    status,
    displayToken,
    fetchedAt: now().toISOString(),
    refreshAvailable: false,
    reason:
      status === "restricted"
        ? "owner_only"
        : status === "unknown"
          ? "missing_snapshot"
          : "source_unavailable",
  });
  const fingerprint = (scope: Scope, source: Source) =>
    createHmac("sha256", input.secret)
      .update(
        JSON.stringify(["account-limits-v1", scope, source], (_key, value) =>
          typeof value === "bigint" ? String(value) : value,
        ),
      )
      .digest("base64url");
  async function resolve(
    scope: Scope,
    connectionIds: readonly string[],
  ): Promise<Source[]> {
    const tombstone = Prisma.sql`NOT EXISTS (SELECT 1 FROM "PersonalAccountOperation" deleted
      WHERE deleted."sourceId" = s."id" AND deleted."action" = 'delete' AND deleted."phase" = 'applied'
        AND deleted."deleteRemoteRetirementProofRef" IS NOT NULL AND deleted."deleteBindingErasureProofRef" IS NOT NULL
        AND deleted."deleteTransportErasureProofRef" IS NOT NULL AND deleted."deleteNativeErasureProofRef" IS NOT NULL)`;
    const fields = Prisma.sql`s."id", s."ownerUserId", s."ownerWorkspaceId", s."gatewayAccountRef", s."profileRef",
      s."state", s."authorizationEpochMirror", s."pendingSourceOperationId"`;
    const rows = scope.workspaceId
      ? await input.prisma.$queryRaw<Source[]>(Prisma.sql`
        SELECT ${fields}, m."role", b."id" AS "bindingId", b."revision" AS "bindingRevision"
        FROM "ProviderAccountConnection" s
        JOIN "Workspace" w ON w."id" = ${scope.workspaceId}
        JOIN "WorkspaceMember" m ON m."workspaceId" = w."id" AND m."userId" = ${scope.userId}
        LEFT JOIN "WorkspaceAccountBinding" b ON b."connectionId" = s."id" AND b."workspaceId" = w."id" AND b."state" = 'active'
        LEFT JOIN "WorkspaceMember" donor ON donor."workspaceId" = w."id" AND donor."userId" = s."ownerUserId"
        WHERE w."personalOwnerUserId" IS NULL AND w."deletionState" = 'active' AND ${tombstone}
          AND ((s."ownerWorkspaceId" = w."id" AND s."id" IN (${Prisma.join(connectionIds)}) AND m."role" IN ('owner','admin'))
            OR ((b."id" IN (${Prisma.join(connectionIds)}) OR s."id" IN (${Prisma.join(connectionIds)})) AND b."id" IS NOT NULL AND (s."ownerWorkspaceId" = w."id"
              OR (${input.operatorWorkspaceId !== undefined} AND s."ownerWorkspaceId" = ${input.operatorWorkspaceId ?? scope.workspaceId})
              OR (s."ownerWorkspaceId" IS NULL AND s."ownerUserId" IS NOT NULL AND donor."role" IN ('owner','admin')))))
        ORDER BY s."id", b."id"`)
      : await input.prisma.$queryRaw<Source[]>(Prisma.sql`
        SELECT ${fields}, NULL::text AS "role", NULL::text AS "bindingId", NULL::integer AS "bindingRevision"
        FROM "ProviderAccountConnection" s WHERE s."id" IN (${Prisma.join(connectionIds)})
          AND s."ownerUserId" = ${scope.userId} AND s."ownerWorkspaceId" IS NULL AND ${tombstone}`);
    return rows;
  }
  const equalScope = (left: Scope, right: Scope) =>
    left.userId === right.userId && left.workspaceId === right.workspaceId;
  const owned = (scope: Scope, source: Source) =>
    (source.ownerUserId === scope.userId && source.ownerWorkspaceId === null) ||
    (scope.workspaceId !== undefined &&
      source.ownerWorkspaceId === scope.workspaceId &&
      ["owner", "admin"].includes(source.role ?? ""));
  async function read(
    connectionId: string,
  ): Promise<AccountsResult<AccountLimitsView>> {
    try {
      const scope = await input.authorize();
      const source = (await resolve(scope, [connectionId]))[0];
      if (!source) return { status: "denied" };
      if (!owned(scope, source))
        return { status: "ok", value: view("restricted") };
      const token = fingerprint(scope, source);
      // A reconnect/delete intent invalidates the prior generation immediately.
      if (
        source.pendingSourceOperationId ||
        !["active", "suspended"].includes(source.state)
      )
        return { status: "ok", value: view("unknown", token) };
      const epoch = Number(source.authorizationEpochMirror);
      if (
        source.authorizationEpochMirror === null ||
        !Number.isSafeInteger(epoch) ||
        epoch < 1 ||
        !source.profileRef
      )
        return { status: "ok", value: view("unavailable", token) };
      const value = await readAccountLimits({
        reader: input.reader,
        now,
        authorize: async () => {
          const currentScope = await input.authorize();
          if (!equalScope(scope, currentScope)) return null;
          const current = (await resolve(currentScope, [connectionId]))[0];
          if (
            !current ||
            !owned(currentScope, current) ||
            fingerprint(currentScope, current) !== token
          )
            return null;
          return {
            displayToken: token,
            target: {
              ownerRef: input.ownerRef(
                current.ownerUserId
                  ? { kind: "user", userId: current.ownerUserId }
                  : {
                      kind: "workspace",
                      workspaceId: current.ownerWorkspaceId!,
                    },
              ),
              accountRef: current.gatewayAccountRef,
              profileId: current.profileRef!,
              expectedAuthorizationEpoch: epoch,
            },
          };
        },
      });
      // Ownership was established above. A later scope/lifetime fence is an
      // authorization failure, not evidence that this viewer is a recipient.
      if (value.status === "restricted") return { status: "denied" };
      return { status: "ok", value };
    } catch {
      // Session/DB failure and transport diagnostics never become browser labels.
      return { status: "denied" };
    }
  }
  async function page<T extends AccountView>(
    accounts: readonly T[],
  ): Promise<T[]> {
    const rows = accounts.map((account) => ({
      ...account,
      limits: view("unavailable"),
    }));
    let cursor = 0;
    let closed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const work = Promise.all(
      Array.from({ length: Math.min(4, rows.length) }, async () => {
        while (!closed && cursor < rows.length) {
          const index = cursor++;
          const result = await read(rows[index]!.connectionId);
          if (!closed && result.status === "ok")
            rows[index]!.limits = result.value;
        }
      }),
    );
    try {
      await Promise.race([
        work,
        new Promise<void>((done) => {
          timer = setTimeout(done, 3000);
        }),
      ]);
    } finally {
      closed = true;
      if (timer) clearTimeout(timer);
    }
    // A fast row may finish before another row consumes the page deadline.
    // Revalidate every numeric projection immediately before releasing the batch.
    const numeric = rows.filter((row) => row.limits.status === "snapshot");
    if (numeric.length) {
      try {
        const currentScope = await input.authorize();
        // One final SQL observation for the whole batch avoids holding an early
        // row's successful validation while another row's validation is awaited.
        const currentRows = await resolve(
          currentScope,
          numeric.map((row) => row.connectionId),
        );
        for (const row of numeric) {
          const current = currentRows.find(
            (source) =>
              source.id === row.connectionId ||
              source.bindingId === row.connectionId,
          );
          if (
            !current ||
            !owned(currentScope, current) ||
            fingerprint(currentScope, current) !== row.limits.displayToken
          )
            row.limits = view("unavailable");
        }
      } catch {
        for (const row of numeric) row.limits = view("unavailable");
      }
    }
    return rows;
  }
  return { read, page };
}
