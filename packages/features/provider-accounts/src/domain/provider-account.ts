export type ConnectionOwner =
  | { readonly kind: "workspace"; readonly workspaceId: string }
  | { readonly kind: "user"; readonly userId: string };

export type ConnectionState = "active" | "disabled" | "quarantined" | "pending" | "unknown";
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
};
export type WorkspaceAccountBinding = {
  readonly id: string;
  readonly workspaceId: string;
  readonly connectionId: string;
  readonly state: BindingState;
  readonly revision: number;
};
export type BindingScope = {
  readonly workspaceId: string;
  readonly connectionId: string;
};
export type SafeBindingTuple = {
  readonly workspaceId: string;
  readonly bindingId: string;
  readonly bindingRevision: number;
  readonly connectionId: string;
  readonly gatewayAccountRef: string;
  readonly profileRef: string | null;
};
export type ProviderAccountErrorCode =
  | "workspace_forbidden" | "connection_unavailable" | "binding_unavailable"
  | "revision_conflict" | "invalid_input";

export class ProviderAccountError extends Error {
  readonly code: ProviderAccountErrorCode;
  constructor(code: ProviderAccountErrorCode) {
    super(`provider_accounts:${code}`);
    this.name = "ProviderAccountError";
    this.code = code;
  }
}

export function assertOpaqueReference(value: string): void {
  if (typeof value !== "string" || !/^[A-Za-z0-9]/.test(value) ||
      value.length > 160 || /[^A-Za-z0-9_.:-]/.test(value)) {
    throw new ProviderAccountError("invalid_input");
  }
}
export function assertExpectedRevision(value: number, allowCreate = false): void {
  // Reserve room for the next positive PostgreSQL INTEGER revision.
  if (!Number.isInteger(value) || value < (allowCreate ? 0 : 1) || value >= 2147483647) {
    throw new ProviderAccountError("invalid_input");
  }
}
export function assertMetadata(metadata: ConnectionMetadata): void {
  for (const ref of [metadata.gatewayOperationRef, metadata.profileRef]) {
    if (ref !== null) assertOpaqueReference(ref);
  }
  if (!metadata.displayName.trim() || metadata.displayName.length > 120 ||
      /[\u0000-\u001f\u007f]/.test(metadata.displayName) ||
      !["active", "disabled", "quarantined", "pending", "unknown"].includes(metadata.state)) {
    throw new ProviderAccountError("invalid_input");
  }
}
export function assertWorkspaceOwner(
  connection: ProviderAccountConnection | null,
  workspaceId: string,
): asserts connection is ProviderAccountConnection {
  // C1 rejects personal ownership even when a reserved personalOwnerUserId exists.
  if (!connection || connection.owner.kind !== "workspace" ||
      connection.owner.workspaceId !== workspaceId) {
    throw new ProviderAccountError("connection_unavailable");
  }
}
export function assertExecutable(connection: ProviderAccountConnection): void {
  // Unknown/new gateway states fail closed, as do pending/disabled/quarantined.
  if (connection.state !== "active") throw new ProviderAccountError("connection_unavailable");
}
export function selectBinding(
  workspaceId: string,
  bindingId: string,
  selection: { readonly binding: WorkspaceAccountBinding; readonly connection: ProviderAccountConnection } | null,
): SafeBindingTuple {
  if (!selection || selection.binding.id !== bindingId ||
      selection.binding.workspaceId !== workspaceId || selection.binding.state !== "active" ||
      selection.binding.connectionId !== selection.connection.id ||
      !Number.isInteger(selection.binding.revision) || selection.binding.revision < 1) {
    throw new ProviderAccountError("binding_unavailable");
  }
  assertWorkspaceOwner(selection.connection, workspaceId);
  assertExecutable(selection.connection);
  return {
    workspaceId, bindingId, bindingRevision: selection.binding.revision,
    connectionId: selection.connection.id,
    gatewayAccountRef: selection.connection.gatewayAccountRef,
    profileRef: selection.connection.profileRef,
  };
}
