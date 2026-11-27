/** Native observations projected for the viewer, never account authority. */
export type AccountMetadataFact<T> =
  | {
      readonly status: "known";
      readonly value: T;
      readonly source:
        | "provider_api"
        | "verified_claim"
        | "imported"
        | "user_supplied"
        | "inferred";
      readonly observedAt: string;
      readonly freshness: "current" | "stale";
    }
  | { readonly status: "unknown" | "unsupported" | "unavailable" };

export type AccountMetadataSubscription = {
  readonly code: string;
  readonly label: string;
  readonly scope: "personal" | "organization" | "workspace" | "unknown";
  readonly endsAt: {
    readonly kind: "instant" | "date";
    readonly value: string;
  } | null;
};

export type AccountMetadataFields = {
  readonly email: AccountMetadataFact<string>;
  readonly accountLabel: AccountMetadataFact<string>;
  readonly subscription: AccountMetadataFact<AccountMetadataSubscription>;
  readonly credentialExpiresAt: AccountMetadataFact<string>;
  readonly trainingUsage: AccountMetadataFact<"enabled" | "disabled">;
};

export type AccountMetadataObservation = {
  readonly accountRef: string;
  readonly authorizationEpoch: number;
  readonly metadataRevision: number;
  readonly info:
    | { readonly status: "available"; readonly fields: AccountMetadataFields }
    | { readonly status: "unavailable" | "unsupported" };
};

/** This single result is reused by AccountView and the common identity UI. */
export type AccountMetadataView =
  | {
      readonly status: "available";
      readonly displayToken: string;
      readonly fields: AccountMetadataFields;
    }
  | {
      readonly status: "unknown" | "unsupported" | "unavailable" | "restricted";
      readonly displayToken: string;
    };

export type AccountMetadataAuthorization =
  | {
      readonly status: "allowed";
      readonly displayToken: string;
      readonly ownerRef: string;
      readonly accountRef: string;
      readonly expectedAuthorizationEpoch: number;
    }
  | { readonly status: "unknown" | "unavailable" | "restricted" };

export type AccountMetadataRequest = {
  readonly connectionIds: readonly string[];
  /** Live host policy; the absolute deadline bounds its own I/O and pool wait. */
  readonly authorize: (
    connectionIds: readonly string[],
    deadlineAt: number,
  ) => Promise<ReadonlyMap<string, AccountMetadataAuthorization>>;
};

export type AccountMetadataFeature = {
  readonly readMetadata: (
    input: AccountMetadataRequest,
  ) => Promise<ReadonlyMap<string, AccountMetadataView>>;
};

export type { AccountMetadataReader } from "./account-metadata-reader.js";
