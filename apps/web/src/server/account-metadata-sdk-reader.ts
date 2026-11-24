import {
  createConsumerControlClient,
  createManagementClient,
  type ConsumerControlConfig,
} from "@agent-teams/account-gateway/http";
import type {
  AccountInfoFields,
  AccountInfo,
} from "@agent-teams/account-gateway/contracts";
import type {
  AccountMetadataFact,
  AccountMetadataFields,
  AccountMetadataReader,
} from "@reviewrouter/features-provider-accounts/account-metadata";

function fact<T, U>(
  value: AccountMetadataFact<T>,
  project: (known: T) => U,
): AccountMetadataFact<U> {
  return value.status === "known"
    ? {
        status: "known",
        value: project(value.value),
        source: value.source,
        observedAt: value.observedAt,
        freshness: value.freshness,
      }
    : { status: value.status };
}
/** Positive field projection: a type narrowing alone would retain extra data. */
function fields(value: AccountInfoFields): AccountMetadataFields {
  return {
    email: fact(value.email, (text) => text),
    accountLabel: fact(value.accountLabel, (text) => text),
    subscription: fact(value.subscription, (subscription) => ({
      code: subscription.code,
      label: subscription.label,
      scope: subscription.scope,
      endsAt: subscription.endsAt
        ? { kind: subscription.endsAt.kind, value: subscription.endsAt.value }
        : null,
    })),
    credentialExpiresAt: fact(value.credentialExpiresAt, (text) => text),
    privacyMode: fact(value.privacyMode, (value) => value),
  };
}
const project = (value: AccountInfo) =>
  value.status === "available"
    ? { status: "available" as const, fields: fields(value.fields) }
    : { status: value.status };

/** The only SDK-to-feature adapter. Construction remains passive. */
export function accountMetadataReader(
  settings:
    | ConsumerControlConfig
    | { role: "management"; origin: string; token: string },
): AccountMetadataReader {
  let client:
    | ReturnType<typeof createManagementClient>
    | ReturnType<typeof createConsumerControlClient>
    | undefined;
  return {
    async read(ownerRef, accountRefs, signal) {
      client ??=
        settings.role === "management"
          ? createManagementClient({ ...settings, timeoutMs: 2500 })
          : createConsumerControlClient({ ...settings, timeoutMs: 2500 });
      const response = await client.readAccountInfo(
        { ownerRef, accountRefs: [...accountRefs] },
        { signal },
      );
      return response.accounts.map((account) => ({
        accountRef: account.accountRef,
        authorizationEpoch: account.authorizationEpoch,
        metadataRevision: account.metadataRevision,
        info: project(account.info),
      }));
    },
  };
}
