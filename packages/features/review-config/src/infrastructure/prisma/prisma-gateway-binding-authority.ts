import {
  readProviderAccountBinding,
  selectBinding,
  ProviderAccountError,
  assertOpaqueReference,
} from "@reviewrouter/features-provider-accounts";
import type { Prisma } from "@prisma/client";

/** Capture and lock the saving actor together with all selected donors before
 * any Source/Binding lock. This preserves C2's sorted Member -> Source order.
 * Readonly receipt replay returns before this fresh-write authorization check.
 */
export async function lockPersonalWriteActor(
  prisma: Prisma.TransactionClient,
  workspaceId: string,
  bindingIds: readonly string[],
  actorUserId: string | undefined,
): Promise<ReadonlySet<string>> {
  if (!bindingIds.length) return new Set<string>();
  const rows = await prisma.workspaceAccountBinding.findMany({
    where: {
      workspaceId,
      id: { in: [...new Set(bindingIds)] },
      connection: { ownerUserId: { not: null } },
    },
    select: { id: true, connection: { select: { ownerUserId: true } } },
  });
  if (!rows.length) return new Set<string>();
  if (actorUserId === undefined)
    throw new Error("review_configuration_personal_actor_forbidden");
  assertOpaqueReference(actorUserId);
  const scope = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { personalOwnerUserId: true, deletionState: true },
  });
  if (!scope || scope.deletionState !== "active")
    throw new Error("review_configuration_personal_actor_forbidden");
  const users = [
    ...new Set([
      actorUserId,
      ...rows.flatMap((row) =>
        row.connection.ownerUserId ? [row.connection.ownerUserId] : [],
      ),
    ]),
  ];
  const members = await prisma.$queryRaw<
    { userId: string | null; role: string }[]
  >`
    SELECT "userId", "role" FROM "WorkspaceMember" WHERE "workspaceId" = ${workspaceId}
      AND "userId" = ANY(${users}::text[]) ORDER BY "id" FOR SHARE`;
  if (
    scope.personalOwnerUserId !== null
      ? scope.personalOwnerUserId !== actorUserId
      : !members.some(
          (row) =>
            row.userId === actorUserId &&
            (row.role === "owner" || row.role === "admin"),
        )
  )
    throw new Error("review_configuration_personal_actor_forbidden");
  return new Set(rows.map((row) => row.id));
}

/**
 * The account profile ref of one selectable binding, read after the binding
 * locks. A user-owned binding is selectable only when the personal actor lock
 * admitted it; a row absent from that preliminary read cannot acquire personal
 * write authority by appearing during this later read.
 */
export async function readSelectableGatewayProfileRef(
  prisma: Prisma.TransactionClient,
  input: {
    readonly workspaceId: string;
    readonly bindingId: string;
    readonly personalBindings: ReadonlySet<string>;
    readonly operatorWorkspaceId: string | undefined;
    readonly personalAccountsEnabled: boolean;
  },
): Promise<string | null> {
  const selection = await readProviderAccountBinding(
    prisma,
    { workspaceId: input.workspaceId, bindingId: input.bindingId },
    input.personalAccountsEnabled,
  );
  let selected: ReturnType<typeof selectBinding>;
  try {
    selected = selectBinding(
      input.workspaceId,
      input.bindingId,
      selection,
      input.operatorWorkspaceId,
    );
  } catch (error) {
    if (error instanceof ProviderAccountError)
      throw new Error("review_configuration_gateway_binding_unavailable", {
        cause: error,
      });
    throw error;
  }
  if (
    selection?.connection.owner.kind === "user" &&
    !input.personalBindings.has(input.bindingId)
  )
    throw new Error("review_configuration_personal_actor_forbidden");
  return selected.profileRef;
}
