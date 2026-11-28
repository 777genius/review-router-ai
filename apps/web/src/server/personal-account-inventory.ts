import * as c from "@agent-teams/account-gateway/contracts";
import {
  createAccountInventoryEnrichment,
  type AccountInventoryRead,
} from "./account-inventory-enrichment";
import type { ProviderAccountConnection } from "@reviewrouter/features-provider-accounts";
import type { AccountView, AccountsPage } from "./account-gateway-accounts";
import type {
  PersonalAccountDependencies,
  PersonalAdapter,
  QualifiedProfile,
} from "./personal-account-adapter-contract";
import { lifecycleProjection } from "./account-lifecycle";

/** Local, authorized inventory stays visible while optional native facts are unavailable. */
function personalAccountInventoryFallback(
  source: ProviderAccountConnection,
  profile: QualifiedProfile | PersonalAccountDependencies["profiles"][number],
  pendingAction: "suspend" | "resume" | "delete" | null,
): AccountView {
  const projection = lifecycleProjection({
    pendingAction: pendingAction ?? undefined,
    owned: true,
    compatible: false,
    state: source.state,
    pendingOperationId: source.pendingSourceOperationId ?? null,
    synchronized: false,
    operationReadable: !!pendingAction,
  });
  return {
    connectionId: source.id,
    label: source.displayName,
    profileId: profile.id,
    profileLabel: profile.label,
    provider: profile.provider,
    ...(profile.authKind ? { authKind: profile.authKind } : {}),
    connection: profile.connection,
    state:
      source.state === "suspended"
        ? "suspended"
        : source.state === "disabled"
          ? "disabled"
          : "quarantined",
    readiness: source.pendingSourceOperationId ? "pending" : "unknown",
    gatewayRevision: 0,
    mirrorRevision: source.metadataRevision,
    binding: null,
    canManage: false,
    isOwnedByViewer: true,
    origin: "personal",
    lifecycle: projection.lifecycle,
    allowedActions: projection.actions,
  };
}

type Profile =
  | QualifiedProfile
  | PersonalAccountDependencies["profiles"][number];
type InventoryScope = {
  actor: string;
  authorize(): Promise<void>;
  checked<T>(call: () => Promise<T>): Promise<T>;
  catalogue(read?: AccountInventoryRead): Promise<QualifiedProfile[]>;
  personal: Pick<PersonalAdapter, "list">;
  profileFor(
    id: string | null,
  ): PersonalAccountDependencies["profiles"][number] | undefined;
  project(
    source: ProviderAccountConnection,
    profile?: Profile,
    read?: AccountInventoryRead,
  ): Promise<AccountView>;
};

/** One personal inventory page; mutations retain their separate original path. */
export async function readPersonalAccountInventory(
  input: PersonalAccountDependencies,
  scope: InventoryScope,
  cursor: string | null,
  isDenied: (error: unknown) => boolean,
): Promise<AccountsPage> {
  const enrichment = createAccountInventoryEnrichment();
  try {
    const profiles = await scope.catalogue(enrichment.read).catch(async () => {
      await scope.authorize();
      return [];
    });
    const afterSourceId =
      cursor === null ? undefined : c.reference.parse(cursor);
    const page = await scope.personal.list({
      limit: 25,
      ...(afterSourceId ? { afterSourceId } : {}),
    });
    const rows = await enrichment.map(page.sources, async (row) => {
      try {
        return await scope.project(
          await scope.checked(() =>
            input.store.findOwnedSource(scope.actor, row.sourceId),
          ),
          profiles.find((profile) => profile.id === row.profileId),
          enrichment.read,
        );
      } catch (error) {
        if (isDenied(error)) return null;
        let source: ProviderAccountConnection;
        let pendingAction: "suspend" | "resume" | "delete" | null;
        try {
          source = await scope.checked(() =>
            input.store.findOwnedSource(scope.actor, row.sourceId),
          );
          pendingAction = source.pendingSourceOperationId
            ? ((await input.readLifecycleAction?.(
                source.id,
                source.pendingSourceOperationId,
              )) ?? null)
            : null;
        } catch (fallbackError) {
          if (isDenied(fallbackError)) throw fallbackError;
          return null;
        }
        const profile:
          | QualifiedProfile
          | PersonalAccountDependencies["profiles"][number]
          | undefined =
          profiles.find((entry) => entry.id === source.profileRef) ??
          scope.profileFor(source.profileRef) ??
          (source.profileRef
            ? {
                id: source.profileRef,
                label: "Provider account",
                protocol: "openai-responses",
                models: [],
              }
            : undefined);
        if (!profile) return null;
        return personalAccountInventoryFallback(source, profile, pendingAction);
      }
    });
    const limited = input.limits
      ? await input.limits.page(
          rows.filter((row) => row !== null),
          { deadlineAt: enrichment.deadlineAt, signal: enrichment.signal },
        )
      : rows.filter((row) => row !== null);
    return {
      accounts: input.metadata
        ? await input.metadata.page(limited, {
            deadlineAt: enrichment.deadlineAt,
            signal: enrichment.signal,
          })
        : limited,
      profiles: profiles.filter(
        (profile) =>
          profile.availability !== "deployment_configuration_required",
      ),
      nextCursor: page.nextCursor,
    };
  } finally {
    enrichment.close();
  }
}
