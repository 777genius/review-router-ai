import type {
  ProviderAccountConnection as ConnectionRecord,
  WorkspaceAccountBinding as BindingRecord,
} from "@prisma/client";
import {
  ProviderAccountError,
  type ProviderAccountConnection,
  type WorkspaceAccountBinding,
} from "../../domain/provider-account";

export function mapConnection(
  row: ConnectionRecord,
): ProviderAccountConnection {
  if ((row.ownerWorkspaceId === null) === (row.ownerUserId === null)) {
    throw new ProviderAccountError("connection_unavailable");
  }
  return {
    id: row.id,
    owner:
      row.ownerWorkspaceId !== null
        ? { kind: "workspace", workspaceId: row.ownerWorkspaceId }
        : { kind: "user", userId: row.ownerUserId! },
    gatewayAccountRef: row.gatewayAccountRef,
    gatewayOperationRef: row.gatewayOperationRef,
    profileRef: row.profileRef,
    displayName: row.displayName,
    state: row.state,
    metadataRevision: row.metadataRevision,
  };
}
export function mapBinding(row: BindingRecord): WorkspaceAccountBinding {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    connectionId: row.connectionId,
    state: row.state,
    revision: row.revision,
  };
}
export function rethrowProductStorageError(error: unknown): never {
  if (error instanceof ProviderAccountError) throw error;
  // Map expected persistence races without exposing SQL, refs, or database messages.
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? error.code
      : null;
  if (code === "P2002" || code === "P2025" || code === "P2034") {
    throw new ProviderAccountError("revision_conflict");
  }
  if (code === "P2003")
    throw new ProviderAccountError("connection_unavailable");
  throw error;
}
