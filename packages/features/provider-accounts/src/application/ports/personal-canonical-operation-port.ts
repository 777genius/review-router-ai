import type { PersonalCanonicalIntent } from "../../domain/personal-canonical-operation";
import type {
  ProviderAccountConnection,
  ScopedBindingFence,
} from "../../domain/provider-account";
import type { PersonalGatewayAccount } from "./provider-account-synchronization-port";

export type PersonalCanonicalPhase =
  | "reserved"
  | "fencing"
  | "ready"
  | "submitted"
  | "unknown"
  | "rejected"
  | "applied";
export type PersonalCanonicalReceipt = {
  readonly id: string;
  readonly intent: PersonalCanonicalIntent;
  readonly phase: PersonalCanonicalPhase;
  readonly source: ProviderAccountConnection;
};
/** One finite canonical lifecycle. No credential payload, scheduler or operation router. */
export interface PersonalCanonicalOperationStore {
  findOwnedSource(
    actorUserId: string,
    sourceId: string,
  ): Promise<ProviderAccountConnection>;
  reserve(input: PersonalCanonicalIntent): Promise<PersonalCanonicalReceipt>;
  read(
    actorUserId: string,
    clientOperationId: string,
  ): Promise<PersonalCanonicalReceipt>;
  listFences(
    actorUserId: string,
    clientOperationId: string,
    afterBindingId?: string,
  ): Promise<readonly ScopedBindingFence[]>;
  ready(
    actorUserId: string,
    clientOperationId: string,
  ): Promise<PersonalCanonicalReceipt>;
  claim(
    actorUserId: string,
    clientOperationId: string,
  ): Promise<{ readonly claimToken: string } | null>;
  /** Only the winning caller that has not invoked ingress may release its exact claim. */
  releaseUnenteredClaim(
    actorUserId: string,
    clientOperationId: string,
    claimToken: string,
  ): Promise<boolean>;
  notePhase(
    actorUserId: string,
    clientOperationId: string,
    phase: "unknown" | "rejected",
  ): Promise<void>;
  finalize(
    actorUserId: string,
    clientOperationId: string,
    account: PersonalGatewayAccount,
  ): Promise<PersonalCanonicalReceipt>;
}
