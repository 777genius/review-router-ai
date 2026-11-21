import type { ConsumerControlClient } from "@agent-teams/account-gateway/http";
import type { PersonalAccountOperationStore } from "@reviewrouter/features-provider-accounts";
import type { PersonalCanonicalOperationStore } from "@reviewrouter/features-provider-accounts/synchronization";
import type { CredentialImportMethod } from "../features/account-gateway/connection-capabilities";
import type { AccountLimitsService } from "./account-limits-service";
import type { AccountMetadataService } from "./account-metadata-service";
import type { AccountLifecycleRead } from "./account-lifecycle-reader";
import type {
  AccountOperationView,
  AccountProfileView,
  createDisabledPersonalAccountsAdapter,
} from "./account-gateway-accounts";

export type PersonalAdapter = Pick<
  ReturnType<typeof createDisabledPersonalAccountsAdapter>,
  "list" | "connect" | "operation" | "completeOAuth" | "pollOAuth"
>;
export type QualifiedProfile = AccountProfileView;
export type PersonalCanonicalOperationView = AccountOperationView & {
  resume?: {
    kind: "reconnect";
    connectionId: string;
    profileId: string;
    gatewayRevision: number;
    mirrorRevision: number;
    credentialImportMethod?: CredentialImportMethod;
  };
};
export type PersonalAccountDependencies = {
  limits?: AccountLimitsService;
  metadata?: AccountMetadataService;
  authorizeUser(): Promise<string>;
  lifecycleReader?: {
    get(accountRef: string): Promise<AccountLifecycleRead>;
    compatible(): Promise<boolean>;
    writable(): Promise<boolean>;
  };
  readLifecycleAction?: (
    sourceId: string,
    operationId: string,
  ) => Promise<"suspend" | "resume" | "delete" | null>;
  store: PersonalAccountOperationStore;
  canonical: PersonalCanonicalOperationStore;
  control: Pick<
    ConsumerControlClient,
    "profiles" | "get" | "operation" | "rename" | "reconnect" | "disable"
  > &
    Partial<
      Pick<
        ConsumerControlClient,
        | "beginOAuthReconnect"
        | "completeOAuth"
        | "beginConnection"
        | "reconnectConnection"
        | "readConnection"
        | "submitConnection"
        | "pollConnection"
      >
    >;
  profiles: readonly {
    id: string;
    label: string;
    provider?: NonNullable<AccountProfileView["provider"]>;
    authKind: "api_key" | "oauth";
    canReconnect?: boolean;
    oauthMethods?: NonNullable<AccountProfileView["oauthMethods"]>;
    dedicatedBaseURL?: string;
    connection?: AccountProfileView["connection"];
    availability?: AccountProfileView["availability"];
  }[];
  /** Current connection admission/display only; original recovery needs no discovery. */
  catalogue?: () => Promise<AccountProfileView[]>;
  personalAdapterFactory(input: {
    authorizeUser(): Promise<string>;
    profiles: ReadonlyMap<string, "api-key-create" | "oauth-begin">;
    connectionProfiles?: readonly Pick<
      AccountProfileView,
      | "id"
      | "label"
      | "connection"
      | "oauthMethods"
      | "authKind"
      | "canReconnect"
      | "availability"
    >[];
  }): PersonalAdapter;
  /** Bounded exact-ID fence delivery/ACK only; no credential or inference ingress. */
  deliverFences(actorUserId: string, clientOperationId: string): Promise<void>;
};
