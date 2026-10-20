import { z } from "zod";
import {
  ProviderAccountError,
  reconcileWorkspaceBindingFences,
  type PersonalAccountOperationStore,
  type PersonalOperationResult,
} from "@reviewrouter/features-provider-accounts";
import type { PersonalAccountGatewayPort } from "@reviewrouter/features-provider-accounts/synchronization";
import type { createDisabledPersonalAccountsAdapter } from "./account-gateway-accounts";
import type { PrismaPersonalAccountSharingQueries } from "./personal-account-sharing-queries";
import type {
  PersonalAccountsApi,
  PersonalAccountsResult,
  PersonalAttachRequest,
  PersonalMutationReceipt,
  PersonalRevokeRequest,
} from "../features/account-gateway/personal-accounts";

// Trusted server composition only. This factory does not enable a public route.
type Adapter = Pick<
  ReturnType<typeof createDisabledPersonalAccountsAdapter>,
  "list" | "attach" | "revoke" | "operation"
>;
type Dependencies = {
  authorizeUser(): Promise<string>;
  store: PersonalAccountOperationStore;
  createAdapter(authorizeUser: () => Promise<string>): Adapter;
  gateway: PersonalAccountGatewayPort;
  queries: Pick<
    PrismaPersonalAccountSharingQueries,
    | "listOwnOrgBindings"
    | "listOwnAccessSummaries"
    | "listEligibleOrganizations"
  >;
  /** Bounded applied attach lookup by immutable resultBindingId and source owner. */
  readBindingAttachOperation(
    actorUserId: string,
    bindingId: string,
  ): Promise<PersonalOperationResult>;
  bindingFences?: Parameters<typeof reconcileWorkspaceBindingFences>[1];
};
const reference = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/);
const revision = z.number().int().min(1).max(2147483646);
const nonce = z.string().uuid();
const paging = { limit: z.number().int().min(1).max(100) };
const selection = {
  nonce,
  sourceId: reference,
  targetWorkspaceId: reference,
  expectedSourceMetadataRevision: revision,
};
const attachSchema = z
  .strictObject({
    ...selection,
    predecessorBindingId: reference.nullable(),
    expectedPredecessorRevision: revision.nullable(),
  })
  .refine(
    (v) =>
      (v.predecessorBindingId === null) ===
      (v.expectedPredecessorRevision === null),
  );
const revokeSchema = z.strictObject({
  ...selection,
  bindingId: reference,
  expectedBindingRevision: revision,
});
class Denied extends Error {}

function failure(error: unknown): PersonalAccountsResult<never> {
  if (error instanceof Denied) return { status: "denied" };
  if (error instanceof z.ZodError) return { status: "invalid" };
  if (error instanceof ProviderAccountError) {
    if (error.code === "invalid_input") return { status: "invalid" };
    if (
      error.code === "operation_conflict" ||
      error.code === "revision_conflict"
    )
      return { status: "conflict" };
    if (error.code === "workspace_forbidden") return { status: "denied" };
  }
  return { status: "unavailable" };
}
function view(result: PersonalOperationResult): PersonalMutationReceipt {
  const binding = result.binding;
  return {
    operation: {
      operationId: result.id,
      phase: result.phase,
      sourceId: result.source?.id ?? null,
      bindingId: binding?.id ?? null,
      available: result.available,
      state:
        result.intent.action === "attach" || result.intent.action === "revoke"
          ? (binding?.state ?? "revoked")
          : (result.source?.state ?? "pending"),
    },
    ...(result.intent.action === "revoke"
      ? {
          remoteFenceDelivery:
            binding?.state === "revoked" &&
            binding.pendingFence === null &&
            binding.fenceAck?.operationId === result.id &&
            binding.fenceAck.policyRevision === binding.policyRevision
              ? ("remote_applied" as const)
              : ("remote_pending" as const),
        }
      : {}),
  };
}

export function createPersonalAccountSharingApi(
  deps: Dependencies,
): PersonalAccountsApi {
  async function authorized<T>(
    work: (
      actor: string,
      checked: <V>(call: () => Promise<V>) => Promise<V>,
      adapter: Adapter,
    ) => Promise<T>,
  ): Promise<PersonalAccountsResult<T>> {
    let actor: string;
    try {
      actor = reference.parse(await deps.authorizeUser());
    } catch {
      return { status: "denied" };
    }
    async function reauthorize() {
      try {
        if ((await deps.authorizeUser()) !== actor) throw new Denied();
      } catch {
        throw new Denied();
      }
    }
    async function checked<V>(call: () => Promise<V>): Promise<V> {
      await reauthorize();
      const value = await call();
      await reauthorize();
      return value;
    }
    try {
      const adapter = deps.createAdapter(async () => {
        await reauthorize();
        return actor;
      });
      const value = await work(actor, checked, adapter);
      await reauthorize();
      return { status: "ok", value };
    } catch (error) {
      try {
        await reauthorize();
      } catch {
        return { status: "denied" };
      }
      return failure(error);
    }
  }
  async function original(actor: string, id: string) {
    try {
      return await deps.store.readOperation(actor, id);
    } catch (error) {
      if (error instanceof ProviderAccountError && error.code === "not_found")
        return null;
      throw error;
    }
  }
  function matches(
    result: PersonalOperationResult,
    actor: string,
    raw: PersonalAttachRequest | PersonalRevokeRequest,
    action: "attach" | "revoke",
  ) {
    const intent = result.intent;
    if (intent.action !== "attach" && intent.action !== "revoke")
      throw new ProviderAccountError("operation_conflict");
    if (
      result.source &&
      (result.source.owner.kind !== "user" ||
        result.source.owner.userId !== actor)
    )
      throw new Denied();
    if (
      intent.actorUserId !== actor ||
      intent.clientOperationId !== raw.nonce ||
      intent.action !== action ||
      intent.sourceId !== raw.sourceId ||
      intent.targetWorkspaceId !== raw.targetWorkspaceId ||
      intent.expectedSourceMetadataRevision !==
        raw.expectedSourceMetadataRevision ||
      (intent.action === "attach" &&
        (intent.predecessorBindingId !==
          (raw as PersonalAttachRequest).predecessorBindingId ||
          intent.expectedPredecessorRevision !==
            (raw as PersonalAttachRequest).expectedPredecessorRevision)) ||
      (intent.action === "revoke" &&
        (intent.bindingId !== (raw as PersonalRevokeRequest).bindingId ||
          intent.expectedBindingRevision !==
            (raw as PersonalRevokeRequest).expectedBindingRevision))
    )
      throw new ProviderAccountError("operation_conflict");
  }
  async function receipt(
    result: PersonalOperationResult,
    checked: <V>(call: () => Promise<V>) => Promise<V>,
  ) {
    if (
      result.intent.action === "revoke" &&
      result.binding &&
      deps.bindingFences
    ) {
      // Local deny has already committed. Unknown delivery retains its pending fact.
      try {
        await checked(() =>
          reconcileWorkspaceBindingFences(
            { limit: 1, bindingIds: [result.binding!.id] },
            deps.bindingFences!,
          ),
        );
        result = await checked(() =>
          deps.store.readOperation(
            result.intent.actorUserId,
            result.intent.clientOperationId,
          ),
        );
      } catch (error) {
        if (error instanceof Denied) throw error;
        // Preserve the committed local deny when fence storage/delivery is unavailable.
      }
    }
    return view(result);
  }
  return {
    listSources(raw) {
      return authorized(async (_actor, checked, adapter) => {
        const safe = z
          .strictObject({ ...paging, afterSourceId: reference.optional() })
          .parse(raw);
        return checked(() =>
          adapter.list({
            limit: safe.limit,
            ...(safe.afterSourceId === undefined
              ? {}
              : { afterSourceId: safe.afterSourceId }),
          }),
        );
      });
    },
    listOwnGrants(raw) {
      return authorized(async (actor, checked) => {
        const safe = z
          .strictObject({
            ...paging,
            sourceId: reference,
            afterBindingId: reference.optional(),
          })
          .parse(raw);
        const page = await checked(() =>
          deps.queries.listOwnOrgBindings({
            sourceId: safe.sourceId,
            limit: safe.limit,
            actorUserId: actor,
            ...(safe.afterBindingId === undefined
              ? {}
              : { afterBindingId: safe.afterBindingId }),
          }),
        );
        return {
          grants: page.items.map((row) => ({
            bindingId: row.bindingId,
            sourceId: row.sourceId,
            targetWorkspaceId: row.targetWorkspaceId,
            organizationLabel: row.organizationLabel,
            revision: row.revision,
            state: row.state,
            canRevoke: row.canRevoke,
            remoteFenceDelivery: row.remoteFenceDelivery,
          })),
          nextCursor: page.nextAfterId,
        };
      });
    },
    listAccessSummaries(raw) {
      return authorized(async (actor, checked) => {
        const safe = z
          .strictObject({
            sourceIds: z.array(reference).min(1).max(100),
          })
          .refine(
            (value) => new Set(value.sourceIds).size === value.sourceIds.length,
          )
          .parse(raw);
        return {
          summaries: await checked(() =>
            deps.queries.listOwnAccessSummaries({
              actorUserId: actor,
              sourceIds: safe.sourceIds,
            }),
          ),
        };
      });
    },
    listEligibleOrganizations(raw) {
      return authorized(async (actor, checked) => {
        const safe = z
          .strictObject({
            ...paging,
            sourceIds: z.array(reference).min(1).max(100),
            afterWorkspaceId: reference.optional(),
          })
          .refine((v) => new Set(v.sourceIds).size === v.sourceIds.length)
          .parse(raw);
        const page = await checked(() =>
          deps.queries.listEligibleOrganizations({
            sourceIds: safe.sourceIds,
            limit: safe.limit,
            ...(safe.afterWorkspaceId === undefined
              ? {}
              : { afterWorkspaceId: safe.afterWorkspaceId }),
            actorUserId: actor,
          }),
        );
        return {
          organizations: page.items.map((row) => ({
            workspaceId: row.workspaceId,
            label: row.label,
            ...(row.predecessors
              ? {
                  predecessors: row.predecessors.map(
                    ({ sourceId, bindingId, revision }) => ({
                      sourceId,
                      bindingId,
                      revision,
                    }),
                  ),
                }
              : {}),
          })),
          nextCursor: page.nextAfterId,
        };
      });
    },
    attach(raw) {
      return authorized(async (actor, checked, adapter) => {
        const safe = attachSchema.parse(raw);
        // Stored tuple precedes current metadata checks: retry never selects a new tuple.
        const previous = await checked(() => original(actor, safe.nonce));
        if (previous) {
          matches(previous, actor, safe, "attach");
          return view(previous);
        }
        const source = await checked(() =>
          deps.store.findOwnedSource(actor, safe.sourceId),
        );
        if (
          source.owner.kind !== "user" ||
          source.owner.userId !== actor ||
          !source.profileRef
        )
          throw new Denied();
        if (source.metadataRevision !== safe.expectedSourceMetadataRevision)
          throw new ProviderAccountError("revision_conflict");
        if (source.state !== "active" || source.pendingSourceOperationId)
          throw new ProviderAccountError("connection_unavailable");
        const account = await checked(() =>
          deps.gateway.get(actor, source.gatewayAccountRef, source.profileRef!),
        );
        if (
          account.accountRef !== source.gatewayAccountRef ||
          account.profileId !== source.profileRef ||
          account.authorizationEpoch !== source.authorizationEpochMirror ||
          account.state !== "active" ||
          !Number.isSafeInteger(account.metadataRevision) ||
          account.metadataRevision < 1
        )
          throw new ProviderAccountError("connection_unavailable");
        const operation = await checked(() =>
          adapter.attach({
            ...safe,
            expectedGatewayRevision: account.metadataRevision,
          }),
        );
        return { operation };
      });
    },
    revoke(raw) {
      return authorized(async (actor, checked, adapter) => {
        const safe = revokeSchema.parse(raw);
        const previous = await checked(() => original(actor, safe.nonce));
        if (previous) {
          matches(previous, actor, safe, "revoke");
          return receipt(previous, checked);
        }
        const source = await checked(() =>
          deps.store.findOwnedSource(actor, safe.sourceId),
        );
        if (source.owner.kind !== "user" || source.owner.userId !== actor)
          throw new Denied();
        const attached = await checked(() =>
          deps.readBindingAttachOperation(actor, safe.bindingId),
        );
        const intent = attached.intent,
          binding = attached.binding;
        if (
          intent.action !== "attach" ||
          intent.actorUserId !== actor ||
          attached.phase !== "applied" ||
          intent.sourceId !== safe.sourceId ||
          intent.targetWorkspaceId !== safe.targetWorkspaceId ||
          attached.source?.id !== safe.sourceId ||
          attached.source.owner.kind !== "user" ||
          attached.source.owner.userId !== actor ||
          !binding ||
          binding.id !== safe.bindingId ||
          binding.connectionId !== safe.sourceId ||
          binding.workspaceId !== safe.targetWorkspaceId
        )
          throw new Denied();
        if (binding.revision !== safe.expectedBindingRevision)
          throw new ProviderAccountError("revision_conflict");
        // No Gateway GET: remote availability must not block the local owner deny.
        const committed = await checked(() =>
          adapter.revoke({
            ...safe,
            expectedGatewayRevision: intent.expectedGatewayRevision,
          }),
        );
        try {
          return await receipt(
            await checked(() => deps.store.readOperation(actor, safe.nonce)),
            checked,
          );
        } catch (error) {
          if (error instanceof Denied) throw error;
          // A later read failure cannot erase the actual committed local-deny receipt.
          // The outer boundary reauthorizes before exposing this pending projection.
          return {
            operation: committed.operation,
            remoteFenceDelivery: "remote_pending" as const,
          };
        }
      });
    },
    readOperation(raw) {
      return authorized(async (actor, checked, adapter) => {
        const id = nonce.parse(raw);
        await checked(() => adapter.operation(id));
        const result = await checked(() => deps.store.readOperation(actor, id));
        if (result.intent.actorUserId !== actor) throw new Denied();
        return receipt(result, checked);
      });
    },
  };
}
