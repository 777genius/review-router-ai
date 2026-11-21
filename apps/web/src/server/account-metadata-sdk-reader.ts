import {
  createConsumerControlClient,
  createManagementClient,
  type ConsumerControlConfig,
} from "@agent-teams/account-gateway/http";
import type {
  AccountInfoFields,
  AccountInfo,
  AccountInfoFieldsV2,
  AccountInfoV2,
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
function fields(value: AccountInfoFields | AccountInfoFieldsV2): AccountMetadataFields {
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
    trainingUsage:
      "trainingUsage" in value
        ? fact(value.trainingUsage, (value) => value)
        : { status: "unsupported" },
  };
}
const project = (value: AccountInfo | AccountInfoV2) =>
  value.status === "available"
    ? { status: "available" as const, fields: fields(value.fields) }
    : { status: value.status };

/** The only SDK-to-feature adapter. Construction remains passive. */
export function accountMetadataReader(
  settings:
    | ConsumerControlConfig
    | { role: "management"; origin: string; token: string },
  contract: "account-info/v1" | "account-info/v2" = "account-info/v2",
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
      // Compatibility is selected at composition, never inferred from a failure.
      const request = { ownerRef, accountRefs: [...accountRefs] };
      const response =
        contract === "account-info/v2"
          ? await client.readAccountInfoV2(request, { signal })
          : await client.readAccountInfo(request, { signal });
      return response.accounts.map((account) => ({
        accountRef: account.accountRef,
        authorizationEpoch: account.authorizationEpoch,
        metadataRevision: account.metadataRevision,
        info: project(account.info),
      }));
    },
  };
}
