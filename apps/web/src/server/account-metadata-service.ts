import { createHmac } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
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
  authorize(): Promise<Scope>;
  ownerRef(
    owner:
      | { kind: "user"; userId: string }
      | { kind: "workspace"; workspaceId: string },
  ): string;
  operatorWorkspaceId?: string;
}) {
  const { resolve } = createAccountDisplayAuthorization(input);
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
  ): Promise<ReadonlyMap<string, AccountMetadataAuthorization>> {
    const scope = await input.authorize();
    const sources = await resolve(scope, connectionIds);
    if (!equalScope(scope, await input.authorize())) return new Map();
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
  ): Promise<Array<T & { metadata: AccountMetadataView }>> {
    try {
      const values = await (
        await feature
      ).readMetadata({
        connectionIds: accounts.map((account) => account.connectionId),
        authorize,
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
