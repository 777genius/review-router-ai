import { createHmac } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import type {
  AccountMetadataAuthorization,
  AccountMetadataReader,
  AccountMetadataView,
} from "@reviewrouter/features-provider-accounts/account-metadata";
import { createAccountMetadata } from "@reviewrouter/features-provider-accounts/account-metadata/composition";
import {
  createAccountDisplayAuthorization,
  equalScope,
  owned,
  type Scope,
  type Source,
} from "./account-metadata/authorization";

type DisplayAccount = {
  readonly connectionId: string;
  readonly metadata?: AccountMetadataView;
};

export type AccountMetadataService = ReturnType<
  typeof createAccountMetadataService
>;

/** Product visibility only; account facts and their freshness belong to native. */
export function createAccountMetadataService(input: {
  prisma: PrismaClient;
  reader: AccountMetadataReader;
  secret: string;
  authorize(
    prisma: Pick<
      PrismaClient,
      "workspace" | "workspaceMember" | "userExternalIdentity"
    >,
  ): Promise<Scope>;
  ownerRef(
    owner:
      | { kind: "user"; userId: string }
      | { kind: "workspace"; workspaceId: string },
  ): string;
  operatorWorkspaceId?: string;
}) {
  const feature = createAccountMetadata({ reader: input.reader });
  const fingerprint = (scope: Scope, source: Source) =>
    createHmac("sha256", input.secret)
      .update(
        JSON.stringify(["account-metadata-v1", scope, source], (_key, value) =>
          typeof value === "bigint" ? String(value) : value,
        ),
      )
      .digest("base64url");
  async function authorize(
    connectionIds: readonly string[],
    deadlineAt: number,
  ): Promise<ReadonlyMap<string, AccountMetadataAuthorization>> {
    const remaining = Math.floor(deadlineAt - Date.now());
    if (remaining < 4) return new Map();
    const maxWait = Math.min(250, Math.floor(remaining / 4));
    const statementBudget = Math.min(500, Math.floor(remaining / 4));
    // Reserve a statement budget for server-side cancellation and rollback;
    // the pool wait and transaction cannot consume the entire page budget.
    const authorized = await input.prisma.$transaction(
      async (tx) => {
        const queryBudget = Math.min(
          statementBudget,
          Math.floor(deadlineAt - Date.now()),
        );
        if (queryBudget <= 0) throw new Error("account_metadata_deadline");
        await tx.$executeRaw(Prisma.sql`SELECT
        set_config('statement_timeout', ${String(queryBudget)}, true),
        set_config('lock_timeout', ${String(queryBudget)}, true)`);
        const scope = await input.authorize(tx);
        const { resolve } = createAccountDisplayAuthorization({
          ...input,
          prisma: tx,
        });
        const sources = await resolve(scope, connectionIds);
        if (!equalScope(scope, await input.authorize(tx))) return null;
        return { scope, sources };
      },
      { maxWait, timeout: remaining - maxWait - statementBudget },
    );
    if (!authorized) return new Map();
    const { scope, sources } = authorized;
    const result = new Map<string, AccountMetadataAuthorization>();
    for (const source of sources) {
      const epoch = Number(source.authorizationEpochMirror);
      const value: AccountMetadataAuthorization = !owned(scope, source)
        ? { status: "restricted" }
        : source.pendingSourceOperationId ||
            !["active", "suspended"].includes(source.state)
          ? { status: "unknown" }
          : source.authorizationEpochMirror === null ||
              !Number.isSafeInteger(epoch) ||
              epoch < 1 ||
              !source.profileRef
            ? { status: "unavailable" }
            : {
                status: "allowed",
                displayToken: fingerprint(scope, source),
                ownerRef: input.ownerRef(
                  source.ownerUserId
                    ? { kind: "user", userId: source.ownerUserId }
                    : {
                        kind: "workspace",
                        workspaceId: source.ownerWorkspaceId!,
                      },
                ),
                accountRef: source.gatewayAccountRef,
                expectedAuthorizationEpoch: epoch,
              };
      if (connectionIds.includes(source.id)) result.set(source.id, value);
      if (source.bindingId && connectionIds.includes(source.bindingId))
        result.set(source.bindingId, value);
    }
    return result;
  }
  const hidden = (): AccountMetadataView => ({
    status: "restricted",
    displayToken: "restricted",
  });
  async function page<T extends DisplayAccount>(
    accounts: readonly T[],
    options: { deadlineAt?: number; signal?: AbortSignal } = {},
  ): Promise<Array<T & { metadata: AccountMetadataView }>> {
    try {
      const values = await (
        await feature
      ).readMetadata({
        connectionIds: accounts.map((account) => account.connectionId),
        authorize,
        ...options,
      });
      return accounts.map((account) => ({
        ...account,
        metadata: values.get(account.connectionId) ?? hidden(),
      }));
    } catch {
      return accounts.map((account) => ({ ...account, metadata: hidden() }));
    }
  }
  return { page };
}
