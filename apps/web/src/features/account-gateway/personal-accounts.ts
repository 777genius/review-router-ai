// Product UI contracts. These contain only authorized, safe projections; the
// server resolves Gateway counters and checks live ownership for every call.
export type PersonalAccountsResult<T> =
  | { status: "ok"; value: T }
  | { status: "denied" | "conflict" | "invalid" | "unavailable" };

export type PersonalSource = {
  sourceId: string;
  label: string;
  profileId: string | null;
  state:
    | "active"
    | "suspended"
    | "pending"
    | "disabled"
    | "quarantined"
    | "unknown";
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
export type PersonalAccessSummary = {
  sourceId: string;
  organizationCount: number;
  hasRestrictedAccess: boolean;
  // Up to 4 visible organizations, paired label↔workspaceId in name order.
  // avatarUrl is decorative (GitHub org/user picture) and may be missing.
  organizations: readonly {
    workspaceId: string;
    label: string;
    avatarUrl?: string | null;
  }[];
  // The viewer's own personal workspace, identical on every row of one call.
  personalWorkspaceId: string | null;
  complete: true;
};
export type PersonalAccessSummaryPage = {
  summaries: readonly PersonalAccessSummary[];
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
  listAccessSummaries(request: {
    sourceIds: readonly string[];
  }): Promise<PersonalAccountsResult<PersonalAccessSummaryPage>>;
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
  isOwnedByViewer?: boolean;
}): string | null {
  return account.origin === "personal"
    ? account.isOwnedByViewer === true
      ? "Your personal account"
      : "Shared personal account"
    : account.origin === "organization"
      ? "Organization account"
      : account.origin === "operator"
        ? "Operator account"
        : null;
}

// Read adapter batches the already loaded inventory; the server reauthorizes
// every source. A failed batch never releases a partial exact aggregate.
export async function readOwnAccessSummaries(
  api: Pick<PersonalAccountsApi, "listAccessSummaries">,
  sourceIds: readonly string[],
): Promise<PersonalAccountsResult<PersonalAccessSummaryPage>> {
  const summaries: PersonalAccessSummary[] = [];
  for (let offset = 0; offset < sourceIds.length; offset += 100) {
    const page = await api.listAccessSummaries({
      sourceIds: sourceIds.slice(offset, offset + 100),
    });
    if (page.status !== "ok") return page;
    summaries.push(...page.value.summaries);
  }
  return { status: "ok", value: { summaries } };
}
