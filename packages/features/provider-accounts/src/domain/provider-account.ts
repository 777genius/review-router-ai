export type ConnectionOwner =
  | { readonly kind: "workspace"; readonly workspaceId: string }
  | { readonly kind: "user"; readonly userId: string };

export type ConnectionState =
  | "active"
  | "suspended"
  | "disabled"
  | "quarantined"
  | "pending"
  | "unknown";
export type BindingState = "active" | "revoked";

// Safe projection, never a native account descriptor or credential container.
export type ConnectionMetadata = {
  readonly gatewayOperationRef: string | null;
  readonly profileRef: string | null;
  readonly displayName: string;
  readonly state: ConnectionState;
};
export type ProviderAccountConnection = ConnectionMetadata & {
  readonly id: string;
  readonly owner: ConnectionOwner;
  readonly gatewayAccountRef: string;
  /** Mirror CAS version only. The gateway remains the account authority. */
  readonly metadataRevision: number;
  readonly authorizationEpochMirror?: number | null;
  readonly pendingSourceOperationId?: string | null;
};
export type WorkspaceAccountBinding = {
  readonly id: string;
  readonly workspaceId: string;
  readonly connectionId: string;
  readonly state: BindingState;
  readonly revision: number;
  /** Authorization version, persisted independently of the binding CAS version. */
  readonly policyRevision: number;
  readonly pendingFence: BindingFenceIntent | null;
  readonly fenceAck: BindingFenceAck | null;
};
export type BindingFenceIntent = {
  readonly operationId: string;
  readonly policySubject: string;
  readonly policyRevision: number;
};
export type BindingFenceAck = {
  readonly operationId: string;
  readonly policyRevision: number;
};
export type ScopedBindingFence = BindingFenceIntent & {
  readonly bindingId: string;
  readonly workspaceId: string;
};
export type BindingScope = {
  readonly workspaceId: string;
  readonly connectionId: string;
};
/** Repository-loaded facts from the current target and immutable source owner.
 * Never supplied by a request or retained as a permission across dispatches.
 */
export type PersonalBindingUse = {
  readonly workspaceId: string;
  readonly personalOwnerUserId: string | null;
  readonly donorUserId: string;
  readonly donorRole: "owner" | "admin" | "member" | null;
};
export type BindingSelection = {
  readonly binding: WorkspaceAccountBinding;
  readonly connection: ProviderAccountConnection;
  readonly personalUse?: PersonalBindingUse;
};
export type SafeBindingTuple = {
  readonly workspaceId: string;
  readonly bindingId: string;
  readonly bindingRevision: number;
  readonly policySubject: string;
  readonly policyRevision: number;
  readonly connectionId: string;
  readonly gatewayAccountRef: string;
  readonly profileRef: string | null;
  /** Present only for eligible personal use; pinned unchanged by a v2 run. */
  readonly expectedAuthorizationEpoch?: number;
};
export type ProviderAccountErrorCode =
  | "workspace_forbidden"
  | "connection_unavailable"
  | "binding_unavailable"
  | "revision_conflict"
  | "invalid_input"
  | "not_found"
  | "operation_conflict";

export class ProviderAccountError extends Error {
  readonly code: ProviderAccountErrorCode;
  constructor(code: ProviderAccountErrorCode) {
    super(`provider_accounts:${code}`);
    this.name = "ProviderAccountError";
    this.code = code;
  }
}

export function assertOpaqueReference(value: string): void {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9]/.test(value) ||
    value.length > 160 ||
    /[^A-Za-z0-9_.:-]/.test(value)
  ) {
    throw new ProviderAccountError("invalid_input");
  }
}
export function assertExpectedRevision(
  value: number,
  allowCreate = false,
): void {
  // Reserve room for the next positive PostgreSQL INTEGER revision.
  if (
    !Number.isInteger(value) ||
    value < (allowCreate ? 0 : 1) ||
    value >= 2147483647
  ) {
    throw new ProviderAccountError("invalid_input");
  }
}
export function isPersistedRevision(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 2147483647;
}
export function snapshotBindingFence(
  input: ScopedBindingFence,
): ScopedBindingFence {
  const intent = Object.freeze({
    bindingId: input.bindingId,
    workspaceId: input.workspaceId,
    operationId: input.operationId,
    policySubject: input.policySubject,
    policyRevision: input.policyRevision,
  });
  for (const ref of [intent.bindingId, intent.workspaceId, intent.operationId])
    assertOpaqueReference(ref);
  if (
    intent.policySubject !== intent.bindingId ||
    !isPersistedRevision(intent.policyRevision)
  )
    throw new ProviderAccountError("invalid_input");
  return intent;
}
export function assertMetadata(metadata: ConnectionMetadata): void {
  for (const ref of [metadata.gatewayOperationRef, metadata.profileRef]) {
    if (ref !== null) assertOpaqueReference(ref);
  }
  if (
    !metadata.displayName.trim() ||
    metadata.displayName.length > 120 ||
    [...metadata.displayName].some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    }) ||
    ![
      "active",
      "suspended",
      "disabled",
      "quarantined",
      "pending",
      "unknown",
    ].includes(metadata.state)
  ) {
    throw new ProviderAccountError("invalid_input");
  }
}
/** Product usage restriction, independent of Gateway ownership/transport metadata. */
export function isPersonalOwnerOnlyProfile(profileRef: string | null): boolean {
  return profileRef === "glm-coding-global-responses-apikey-v1";
}
export function assertProfileUseAllowed(
  connection: ProviderAccountConnection,
  workspaceId: string,
  personalUse?: PersonalBindingUse,
): void {
  if (!isPersonalOwnerOnlyProfile(connection.profileRef)) return;
  if (
    connection.owner.kind !== "user" ||
    !personalUse ||
    personalUse.workspaceId !== workspaceId ||
    personalUse.personalOwnerUserId !== connection.owner.userId ||
    personalUse.donorUserId !== connection.owner.userId
  )
    throw new ProviderAccountError("connection_unavailable");
}
/** Sharing a personal-only subscription is forbidden, including operator pools. */
export function assertProfileShareAllowed(profileRef: string | null): void {
  if (isPersonalOwnerOnlyProfile(profileRef))
    throw new ProviderAccountError("workspace_forbidden");
}
export function assertWorkspaceOwner(
  connection: ProviderAccountConnection | null,
  workspaceId: string,
): asserts connection is ProviderAccountConnection {
  // C1 rejects personal ownership even when a reserved personalOwnerUserId exists.
  if (
    !connection ||
    connection.owner.kind !== "workspace" ||
    connection.owner.workspaceId !== workspaceId
  ) {
    throw new ProviderAccountError("connection_unavailable");
  }
}
export function assertExecutable(connection: ProviderAccountConnection): void {
  // Unknown/new gateway states fail closed, as do pending/disabled/quarantined.
  if (
    connection.state !== "active" ||
    connection.pendingSourceOperationId != null
  )
    throw new ProviderAccountError("connection_unavailable");
}
/** Use authority is separate from credential management. An ordinary binding is
 * the explicit grant record; only trusted composition can designate its owner.
 */
export function assertWorkspaceUseOwner(
  connection: ProviderAccountConnection | null,
  workspaceId: string,
  operatorWorkspaceId?: string,
  personalUse?: PersonalBindingUse,
): asserts connection is ProviderAccountConnection {
  if (connection?.owner.kind === "user") {
    const epoch = connection.authorizationEpochMirror;
    if (
      !personalUse ||
      personalUse.workspaceId !== workspaceId ||
      personalUse.donorUserId !== connection.owner.userId ||
      (personalUse.personalOwnerUserId !== null
        ? personalUse.personalOwnerUserId !== connection.owner.userId
        : personalUse.donorRole !== "owner" &&
          personalUse.donorRole !== "admin") ||
      typeof epoch !== "number" ||
      !Number.isSafeInteger(epoch) ||
      epoch < 1
    )
      throw new ProviderAccountError("connection_unavailable");
    return;
  }
  if (
    !connection ||
    connection.owner.kind !== "workspace" ||
    (connection.owner.workspaceId !== workspaceId &&
      (!operatorWorkspaceId ||
        connection.owner.workspaceId !== operatorWorkspaceId))
  )
    throw new ProviderAccountError("connection_unavailable");
}
export function selectBinding(
  workspaceId: string,
  bindingId: string,
  selection: BindingSelection | null,
  operatorWorkspaceId?: string,
): SafeBindingTuple {
  if (
    !selection ||
    selection.binding.id !== bindingId ||
    selection.binding.workspaceId !== workspaceId ||
    selection.binding.state !== "active" ||
    selection.binding.pendingFence !== null ||
    selection.binding.connectionId !== selection.connection.id ||
    !isPersistedRevision(selection.binding.revision) ||
    !isPersistedRevision(selection.binding.policyRevision)
  ) {
    throw new ProviderAccountError("binding_unavailable");
  }
  assertProfileUseAllowed(
    selection.connection,
    workspaceId,
    selection.personalUse,
  );
  assertWorkspaceUseOwner(
    selection.connection,
    workspaceId,
    operatorWorkspaceId,
    selection.personalUse,
  );
  assertExecutable(selection.connection);
  return {
    workspaceId,
    bindingId,
    bindingRevision: selection.binding.revision,
    policySubject: selection.binding.id,
    policyRevision: selection.binding.policyRevision,
    connectionId: selection.connection.id,
    gatewayAccountRef: selection.connection.gatewayAccountRef,
    profileRef: selection.connection.profileRef,
    ...(selection.connection.owner.kind === "user"
      ? {
          expectedAuthorizationEpoch:
            selection.connection.authorizationEpochMirror!,
        }
      : {}),
  };
}
