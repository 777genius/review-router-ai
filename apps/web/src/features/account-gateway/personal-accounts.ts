// Product UI contracts. These contain only authorized, safe projections; the
// server resolves Gateway counters and checks live ownership for every call.
export type PersonalAccountsResult<T> =
  | { status: "ok"; value: T }
  | { status: "denied" | "conflict" | "invalid" | "unavailable" };

export type PersonalSource = {
  sourceId: string;
  label: string;
  profileId: string | null;
  state: "active" | "pending" | "disabled" | "quarantined" | "unknown";
  metadataRevision: number;
  sourceOperationPending: boolean;
};
export type PersonalSourcePage = {
  sources: readonly PersonalSource[];
  nextCursor: string | null;
};
export type OwnAccountGrant = {
  bindingId: string;
  sourceId: string;
  targetWorkspaceId: string;
  // Null after losing access, even though source-owner revocation remains allowed.
  organizationLabel: string | null;
  revision: number;
  state: "active" | "revoked";
  remoteFenceDelivery: "not_required" | "remote_pending" | "remote_applied";
  canRevoke: boolean;
};
export type OwnAccountGrantPage = {
  grants: readonly OwnAccountGrant[];
  nextCursor: string | null;
};
export type PersonalShareOrganization = {
  workspaceId: string;
  label: string;
  predecessors?: readonly {
    sourceId: string;
    bindingId: string;
    revision: number;
  }[];
};
export type PersonalOrganizationPage = {
  organizations: readonly PersonalShareOrganization[];
  nextCursor: string | null;
};
export type PersonalAccountOperation = {
  operationId: string;
  phase: string;
  sourceId: string | null;
  bindingId: string | null;
  available: boolean;
  state: string;
};
export type PersonalMutationReceipt = {
  operation: PersonalAccountOperation;
  remoteFenceDelivery?: "remote_pending" | "remote_applied";
};
export type PersonalAttachRequest = {
  nonce: string;
  sourceId: string;
  targetWorkspaceId: string;
  expectedSourceMetadataRevision: number;
  predecessorBindingId: string | null;
  expectedPredecessorRevision: number | null;
};
export type PersonalRevokeRequest = {
  nonce: string;
  sourceId: string;
  targetWorkspaceId: string;
  expectedSourceMetadataRevision: number;
  bindingId: string;
  expectedBindingRevision: number;
};
export type PersonalAccountsApi = {
  listSources(request: {
    afterSourceId?: string;
    limit: number;
  }): Promise<PersonalAccountsResult<PersonalSourcePage>>;
  listOwnGrants(request: {
    sourceId: string;
    afterBindingId?: string;
    limit: number;
  }): Promise<PersonalAccountsResult<OwnAccountGrantPage>>;
  listEligibleOrganizations(request: {
    sourceIds: readonly string[];
    afterWorkspaceId?: string;
    limit: number;
  }): Promise<PersonalAccountsResult<PersonalOrganizationPage>>;
  attach(
    request: PersonalAttachRequest,
  ): Promise<PersonalAccountsResult<PersonalMutationReceipt>>;
  revoke(
    request: PersonalRevokeRequest,
  ): Promise<PersonalAccountsResult<PersonalMutationReceipt>>;
  readOperation(
    nonce: string,
  ): Promise<PersonalAccountsResult<PersonalMutationReceipt>>;
};

export type PersonalAccountsBootstrap = {
  enabled: boolean;
  // Safe stable session scope, never a service token or cached permission.
  scope: string;
  page: PersonalAccountsResult<PersonalSourcePage>;
};

export function personalAccountOriginText(account: {
  label: string;
  origin?: "organization" | "personal" | "operator";
}): string | null {
  return account.origin === "personal"
    ? "Shared personal account"
    : account.origin === "organization"
      ? "Organization account"
      : account.origin === "operator"
        ? "Operator account"
        : null;
}
