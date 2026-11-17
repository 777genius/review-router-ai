import { createHash } from "node:crypto";
import { z } from "zod";
import {
  ProviderAccountError,
  isPersonalOwnerOnlyProfile,
  type PersonalOperationResult,
} from "@reviewrouter/features-provider-accounts";
import type {
  ConnectWorkspaceAttachment,
  PersonalAccountsResult,
  PersonalAttachRequest,
  PersonalMutationReceipt,
} from "../features/account-gateway/personal-accounts";

type Dependencies = {
  readonly actorUserId: string;
  /** The actor's own personal operation by client nonce; not_found if absent. */
  readOperation(nonce: string): Promise<PersonalOperationResult>;
  /** Live membership of the actor; throws workspace_forbidden otherwise. */
  workspaceAccess(
    workspaceId: string,
  ): Promise<{ readonly personal: boolean; readonly canDetach: boolean }>;
  hasActiveBinding(workspaceId: string, sourceId: string): Promise<boolean>;
  /** The existing owner attach operation; it re-checks every rule under locks. */
  attach(
    request: PersonalAttachRequest,
  ): Promise<PersonalAccountsResult<PersonalMutationReceipt>>;
};

const nonce = z.string().uuid();
const workspace = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/);
const attached: ConnectWorkspaceAttachment = { status: "attached" };
const notAttached = (
  reason: Extract<
    ConnectWorkspaceAttachment,
    { status: "not_attached" }
  >["reason"],
): ConnectWorkspaceAttachment => ({ status: "not_attached", reason });

/** One attach identity per connect and workspace, so a repeated status read
 * replays the original receipt instead of granting access again. */
export function connectAttachNonce(
  connectNonce: string,
  workspaceId: string,
): string {
  const hex = createHash("sha256")
    .update(JSON.stringify(["rr-connect-attach-v1", connectNonce, workspaceId]))
    .digest("hex");
  // RFC 9562 version 8 (custom) layout with the standard variant bits.
  const variant = ((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `8${hex.slice(13, 16)}`,
    `${variant}${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join("-");
}

/** Adds a freshly connected personal source to the workspace it was connected
 * from. The checks here only pick the reason shown to the user; the existing
 * attach path stays the authority for ownership, role and profile rules. */
export function createConnectWorkspaceAttach(deps: Dependencies) {
  async function read(nonce: string) {
    try {
      return await deps.readOperation(nonce);
    } catch (error) {
      if (error instanceof ProviderAccountError && error.code === "not_found")
        return null;
      throw error;
    }
  }
  return async function attachConnected(
    rawWorkspaceId: string,
    rawNonce: string,
  ): Promise<ConnectWorkspaceAttachment> {
    const parsed = z
      .strictObject({ workspaceId: workspace, nonce })
      .safeParse({ workspaceId: rawWorkspaceId, nonce: rawNonce });
    if (!parsed.success) throw new ProviderAccountError("invalid_input");
    const { workspaceId } = parsed.data;
    const connect = await read(parsed.data.nonce);
    if (!connect) return notAttached("not_connected");
    const source = connect.source;
    if (
      connect.intent.action !== "connect" ||
      connect.intent.actorUserId !== deps.actorUserId ||
      connect.phase !== "applied" ||
      !source
    )
      return notAttached("not_connected");
    if (
      source.owner.kind !== "user" ||
      source.owner.userId !== deps.actorUserId
    )
      throw new ProviderAccountError("workspace_forbidden");
    let access: Awaited<ReturnType<Dependencies["workspaceAccess"]>>;
    try {
      access = await deps.workspaceAccess(workspaceId);
    } catch (error) {
      if (
        error instanceof ProviderAccountError &&
        error.code === "workspace_forbidden"
      )
        return notAttached("not_permitted");
      throw error;
    }
    // Connect itself binds the owner's personal workspace.
    if (access.personal)
      return connect.available && connect.binding?.workspaceId === workspaceId
        ? attached
        : notAttached("unavailable");
    if (isPersonalOwnerOnlyProfile(source.profileRef))
      return notAttached("personal_only");
    // A member must not expose a key they pay for to other members silently.
    if (!access.canDetach) return notAttached("not_permitted");
    const attachNonce = connectAttachNonce(parsed.data.nonce, workspaceId);
    // A stored attach is final: its receipt is reported, never a new tuple.
    const previous = await read(attachNonce);
    if (previous) {
      if (
        previous.intent.action !== "attach" ||
        previous.intent.sourceId !== source.id ||
        previous.intent.targetWorkspaceId !== workspaceId
      )
        return notAttached("unavailable");
      if (previous.available) return attached;
      // A paused or changing source keeps its binding; only revocation is final.
      return previous.binding?.state === "revoked"
        ? notAttached("removed")
        : notAttached("unavailable");
    }
    const result = await deps.attach({
      nonce: attachNonce,
      sourceId: source.id,
      targetWorkspaceId: workspaceId,
      expectedSourceMetadataRevision: source.metadataRevision,
      predecessorBindingId: null,
      expectedPredecessorRevision: null,
    });
    if (result.status === "ok")
      return result.value.operation.available
        ? attached
        : notAttached("unavailable");
    if (result.status === "denied") return notAttached("not_permitted");
    // An Access grant made in between already gave this workspace its binding.
    if (
      result.status === "conflict" &&
      (await deps.hasActiveBinding(workspaceId, source.id))
    )
      return attached;
    return notAttached("unavailable");
  };
}
