import type { AccountLimitsService } from "./account-limits-service";
import { lifecycleProjection } from "./account-lifecycle";
import type { AccountLifecycleRead } from "./account-lifecycle-reader";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { ProviderAccountError } from "@reviewrouter/features-provider-accounts";
import { Prisma, type PrismaClient } from "@prisma/client";
import * as c from "@agent-teams/account-gateway/contracts";
import {
  readWorkspaceAccountUsage,
  type AccountUsageView,
} from "./account-usage";
import type {
  AccountProfileView,
  AccountsPage,
  AccountsResult,
  AccountView,
} from "./account-gateway-accounts";

// Decorative avatar for organization owners, resolved from the workspace's
// GitHub App installation. Failures only lose the picture, never the row.
async function workspaceOwnerAvatar(
  prisma: PrismaClient,
  workspaceId: string,
): Promise<string | null> {
  try {
    const installations = await prisma.gitHubInstallation.findMany({
      where: { workspaceId },
      select: { status: true, accountAvatarUrl: true, accountLogin: true },
      orderBy: { id: "asc" },
    });
    const preferred =
      installations.find((installation) => installation.status === "active") ??
      installations[0];
    if (!preferred) return null;
    return (
      preferred.accountAvatarUrl ??
      (/^[A-Za-z0-9-]+$/.test(preferred.accountLogin)
        ? `https://github.com/${preferred.accountLogin}.png?size=64`
        : null)
    );
  } catch {
    return null;
  }
}

// Inventory deliberately includes unavailable sources. Models keeps its separate,
// executable-only selector. Authorization is repeated after all remote reads.
export function createAccountsOverview(input: {
  limits?: AccountLimitsService;
  prisma: PrismaClient;
  cursorSecret: string;
  gateway: { get(accountRef: string): Promise<AccountLifecycleRead> };
  lifecycleCompatible?: () => Promise<boolean>;
  profiles: readonly (Pick<AccountProfileView, "id" | "label" | "authKind"> &
    Partial<AccountProfileView>)[];
  operatorWorkspaceId?: string;
  authorize(): Promise<{ workspaceId: string; userId: string }>;
  // Viewer repository visibility for the usage read. null keeps the
  // workspace-wide unfiltered read; a failed read fails closed to an empty
  // (fully hidden) set so repository names never leak past the filter.
  visibleRepositoryIds(): Promise<ReadonlySet<string> | null>;
  ownerRef(
    owner:
      | { kind: "user"; userId: string }
      | { kind: "workspace"; workspaceId: string },
  ): string;
}) {
  if (!input.cursorSecret) throw new Error("accounts_cursor_key_required");
  const cursorKey = createHash("sha256")
    .update(`accounts-overview-v1\0${input.cursorSecret}`)
    .digest();
  function encodeCursor(value: unknown): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", cursorKey, iv);
    const encrypted = Buffer.concat([
      cipher.update(JSON.stringify(value)),
      cipher.final(),
    ]);
    return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString(
      "base64url",
    );
  }
  function decodeCursor(value: string): unknown {
    const bytes = Buffer.from(value, "base64url");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      cursorKey,
      bytes.subarray(0, 12),
    );
    decipher.setAuthTag(bytes.subarray(12, 28));
    return JSON.parse(
      Buffer.concat([
        decipher.update(bytes.subarray(28)),
        decipher.final(),
      ]).toString(),
    );
  }
  type Row = {
    id: string;
    ownerUserId: string | null;
    ownerWorkspaceId: string | null;
    gatewayAccountRef: string;
    profileRef: string | null;
    displayName: string;
    state: string;
    metadataRevision: number;
    authorizationEpochMirror: bigint | null;
    pendingSourceOperationId: string | null;
    bindingId: string | null;
    bindingRevision: number | null;
    bindingState: "active" | "revoked" | null;
    fencePending: boolean;
    role: string;
    workspaceName: string;
  };
  async function read(
    who: { workspaceId: string; userId: string },
    ids?: readonly string[],
    after?: string,
    limit = 26,
  ) {
    return input.prisma.$queryRaw<Row[]>(Prisma.sql`
      SELECT s.*, b."id" AS "bindingId", b."revision" AS "bindingRevision", b."state" AS "bindingState",
        (b."pendingFenceOperationId" IS NOT NULL OR b."pendingFencePolicySubject" IS NOT NULL OR b."pendingFencePolicyRevision" IS NOT NULL) AS "fencePending",
        m."role", w."name" AS "workspaceName"
      FROM "ProviderAccountConnection" s
      JOIN "Workspace" w ON w."id" = ${who.workspaceId}
      JOIN "WorkspaceMember" m ON m."workspaceId" = w."id" AND m."userId" = ${who.userId}
      LEFT JOIN LATERAL (SELECT bound.* FROM "WorkspaceAccountBinding" bound
        WHERE bound."connectionId" = s."id" AND bound."workspaceId" = w."id" AND bound."state" = 'active'
        ORDER BY bound."id" ASC LIMIT 1) b ON TRUE
      LEFT JOIN "WorkspaceMember" donor ON donor."workspaceId" = w."id" AND donor."userId" = s."ownerUserId"
      WHERE w."personalOwnerUserId" IS NULL AND w."deletionState" = 'active'
        AND NOT EXISTS (SELECT 1 FROM "PersonalAccountOperation" deleted
          WHERE deleted."sourceId" = s."id" AND deleted."action" = 'delete' AND deleted."phase" = 'applied'
            AND deleted."deleteRemoteRetirementProofRef" IS NOT NULL AND deleted."deleteBindingErasureProofRef" IS NOT NULL
            AND deleted."deleteTransportErasureProofRef" IS NOT NULL AND deleted."deleteNativeErasureProofRef" IS NOT NULL)
        AND ((s."ownerWorkspaceId" = w."id" AND m."role" IN ('owner','admin'))
          OR (b."id" IS NOT NULL AND (
            s."ownerWorkspaceId" = w."id"
            OR (${input.operatorWorkspaceId !== undefined} AND s."ownerWorkspaceId" = ${input.operatorWorkspaceId ?? who.workspaceId})
            OR (s."ownerWorkspaceId" IS NULL AND s."ownerUserId" IS NOT NULL AND donor."role" IN ('owner','admin')))))
        ${ids?.length ? Prisma.sql`AND s."id" IN (${Prisma.join(ids)})` : Prisma.empty}
        ${after ? Prisma.sql`AND s."id" > ${after}` : Prisma.empty}
      ORDER BY s."id" ASC LIMIT ${limit}`);
  }
  return {
    async list(
      request: { afterBindingId?: string; limit?: number } = {},
    ): Promise<AccountsResult<AccountsPage>> {
      try {
        const who = await input.authorize();
        const limit = request.limit ?? 25;
        if (!Number.isInteger(limit) || limit < 1 || limit > 100)
          return { status: "invalid" };
        let after: string | undefined;
        if (request.afterBindingId) {
          if (request.afterBindingId.length > 2048)
            return { status: "invalid" };
          let decoded: unknown;
          try {
            decoded = decodeCursor(request.afterBindingId);
          } catch {
            return { status: "invalid" };
          }
          if (!decoded || typeof decoded !== "object" || Array.isArray(decoded))
            return { status: "invalid" };
          const cursor = decoded as Record<string, unknown>;
          if (
            cursor.view !== "accounts" ||
            cursor.workspace !== who.workspaceId ||
            cursor.viewer !== who.userId
          )
            return { status: "denied" };
          after = c.reference.parse(cursor.source);
          // The authenticated boundary is a position, not a live row. Revoke,
          // role loss or deletion must not strand authorized later pages.
        }
        const candidates = await read(who, undefined, after, limit + 1);
        const scanned = candidates.slice(0, limit);
        const visible = scanned.flatMap((source) => {
          const profile = input.profiles.find(
            (p) => p.id === source.profileRef,
          );
          return profile ? [{ source, profile }] : [];
        });
        // One capability read per inventory page; per-row repetition only adds
        // sequential Gateway timeouts to a server render.
        const compatible = !!(await input
          .lifecycleCompatible?.()
          .catch(() => false));
        const remotes = await Promise.all(
          visible.map(({ source }) =>
            input.gateway.get(source.gatewayAccountRef).catch(() => null),
          ),
        );
        const projections: Array<{ source: Row; account: AccountView }> = [];
        for (const [index, { source, profile }] of visible.entries()) {
          let remote = remotes[index];
          const own = source.ownerWorkspaceId === who.workspaceId;
          if (
            remote &&
            (remote.accountRef !== source.gatewayAccountRef ||
              remote.profileId !== profile.id ||
              remote.ownerRef !==
                input.ownerRef(
                  source.ownerUserId
                    ? { kind: "user", userId: source.ownerUserId }
                    : {
                        kind: "workspace",
                        workspaceId: source.ownerWorkspaceId!,
                      },
                ))
          )
            remote = null;
          const isAdmin = source.role === "owner" || source.role === "admin";
          const ready =
            !!remote &&
            remote.state === "active" &&
            source.state === "active" &&
            !source.pendingSourceOperationId &&
            !source.fencePending &&
            (source.authorizationEpochMirror === null
              ? source.ownerUserId === null
              : String(remote.authorizationEpoch) ===
                String(source.authorizationEpochMirror));
          const pendingLifecycle =
            own && isAdmin && source.pendingSourceOperationId
              ? await input.prisma.personalAccountOperation.findFirst({
                  where: {
                    id: source.pendingSourceOperationId,
                    sourceId: source.id,
                    action: { in: ["suspend", "resume", "delete"] },
                    owningWorkspaceId: who.workspaceId,
                  },
                  select: { id: true, action: true },
                })
              : null;
          const projection = lifecycleProjection({
            operationReadable: !!pendingLifecycle,
            pendingAction: pendingLifecycle
              ? (pendingLifecycle.action as "suspend" | "resume" | "delete")
              : undefined,
            owned: own && isAdmin,
            compatible,
            state: remote?.state ?? source.state,
            pendingOperationId: source.pendingSourceOperationId,
            synchronized:
              !!remote &&
              remote.state === source.state &&
              !source.pendingSourceOperationId &&
              (source.authorizationEpochMirror === null
                ? source.ownerUserId === null
                : String(remote.authorizationEpoch) ===
                  String(source.authorizationEpochMirror)),
            custodyVerified: remote?.resumeCustody === "verified",
          });
          const account: AccountView = {
            lifecycle: projection.lifecycle,
            ...(remote &&
            own &&
            isAdmin &&
            projection.lifecycle.status === "available"
              ? { authorizationEpoch: remote.authorizationEpoch }
              : {}),
            connectionId: own ? source.id : source.bindingId!,
            origin: source.ownerUserId
              ? "personal"
              : own
                ? "organization"
                : "operator",
            isOwnedByViewer: source.ownerUserId === who.userId,
            canManage: own && isAdmin,
            label: remote?.displayName ?? source.displayName,
            profileId: profile.id,
            profileLabel: profile.label,
            ...(profile.provider ? { provider: profile.provider } : {}),
            ...(profile.connection ? { connection: profile.connection } : {}),
            ...(profile.authKind ? { authKind: profile.authKind } : {}),
            state: remote?.state ?? "quarantined",
            readiness:
              source.pendingSourceOperationId || source.state === "pending"
                ? "pending"
                : ready
                  ? "ready"
                  : remote
                    ? "unavailable"
                    : "unknown",
            gatewayRevision: remote?.metadataRevision ?? 0,
            mirrorRevision: source.metadataRevision,
            binding: source.bindingId
              ? {
                  id: source.bindingId,
                  revision: source.bindingRevision!,
                  state: source.bindingState!,
                  fencePending: source.fencePending,
                }
              : null,
            owner: own
              ? {
                  kind: "organization",
                  label: source.workspaceName,
                  avatarUrl: null,
                }
              : source.ownerUserId
                ? {
                    kind: "personal",
                    isViewer: source.ownerUserId === who.userId,
                    handle: null,
                    avatarUrl: null,
                  }
                : { kind: "operator", label: "ReviewRouter" },
            allowedActions: [
              ...projection.actions,
              ...(isAdmin && source.bindingId ? ["detach" as const] : []),
            ],
          };
          projections.push({ source, account });
        }
        const ownerIds = [
          ...new Set(
            projections.flatMap(({ source }) =>
              source.ownerUserId ? [source.ownerUserId] : [],
            ),
          ),
        ];
        const owners = ownerIds.length
          ? await input.prisma.user.findMany({
              where: { id: { in: ownerIds } },
              select: {
                id: true,
                githubLogin: true,
                avatarUrl: true,
                externalIdentities: {
                  orderBy: [{ createdAt: "asc" }, { id: "asc" }],
                  select: { login: true, avatarUrl: true },
                },
              },
            })
          : [];
        const organizationAvatar = projections.some(
          ({ account }) => account.owner?.kind === "organization",
        )
          ? await workspaceOwnerAvatar(input.prisma, who.workspaceId)
          : null;
        const pendingAccounts = projections.map(({ account }) => account);
        // Enrich before the final authorization observation: quota/usage awaits
        // must not retain a row whose shared binding is revoked in the meantime.
        if (pendingAccounts.length) {
          const visibleRepositoryIds = await input
            .visibleRepositoryIds()
            .catch(() => new Set<string>());
          const usage = await readWorkspaceAccountUsage(input.prisma, {
            workspaceId: who.workspaceId,
            profiles: input.profiles,
            visibleRepositoryIds,
            rows: pendingAccounts.map((account) => ({
              key: account.connectionId,
              bindingId: account.binding?.id ?? null,
              profileId: account.profileId,
            })),
          }).catch(() => new Map<string, AccountUsageView>());
          for (const account of pendingAccounts) {
            const facts = usage.get(account.connectionId);
            if (facts) account.usage = facts;
          }
        }
        const limited = input.limits
          ? await input.limits.page(pendingAccounts)
          : pendingAccounts;
        const current = await input.authorize();
        if (
          current.userId !== who.userId ||
          current.workspaceId !== who.workspaceId
        )
          return { status: "denied" };
        const accounts: AccountView[] = [];
        // Authorization is repeated after all remote reads with one revalidation
        // query, compared per row: current donor role and exact binding lifetime,
        // not just session.
        const liveRows = projections.length
          ? await read(
              who,
              projections.map(({ source }) => source.id),
              undefined,
              projections.length,
            )
          : [];
        const liveById = new Map(liveRows.map((row) => [row.id, row]));
        const enriched = new Map(
          limited.map((account) => [account.connectionId, account]),
        );
        for (const { source, account: original } of projections) {
          const account = enriched.get(original.connectionId)!;
          const live = liveById.get(source.id);
          if (
            !live ||
            JSON.stringify(live, (_key, value) =>
              typeof value === "bigint" ? String(value) : value,
            ) !==
              JSON.stringify(source, (_key, value) =>
                typeof value === "bigint" ? String(value) : value,
              )
          )
            continue;
          const owner = owners.find((u) => u.id === source.ownerUserId);
          if (owner && account.owner?.kind === "personal") {
            account.owner.handle =
              owner.githubLogin ?? owner.externalIdentities[0]?.login ?? null;
            account.owner.avatarUrl =
              owner.avatarUrl ?? owner.externalIdentities[0]?.avatarUrl ?? null;
          }
          if (account.owner?.kind === "organization") {
            account.owner.avatarUrl = organizationAvatar;
          }
          accounts.push(account);
        }
        return {
          status: "ok",
          value: {
            accounts,
            profiles: [],
            nextCursor:
              candidates.length > limit
                ? encodeCursor({
                    view: "accounts",
                    workspace: who.workspaceId,
                    viewer: who.userId,
                    source: scanned.at(-1)!.id,
                  })
                : null,
          },
        };
      } catch (error) {
        if (
          error instanceof ProviderAccountError &&
          error.code === "workspace_forbidden"
        )
          return { status: "denied" };
        return { status: "unavailable" };
      }
    },
  };
}
