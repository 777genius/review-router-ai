import type { AccountLifecycleIntent } from "../../domain/account-lifecycle";
import type {
  ProviderAccountConnection,
  ScopedBindingFence,
} from "../../domain/provider-account";
import type { PersonalGatewayAccount } from "./provider-account-synchronization-port";
export type AccountLifecyclePhase =
  | "fencing"
  | "ready"
  | "submitted"
  | "unknown"
  | "rejected"
  | "applied";
export type AccountLifecycleReceipt = {
  readonly id: string;
  readonly intent: AccountLifecycleIntent;
  readonly phase: AccountLifecyclePhase;
  readonly source: ProviderAccountConnection;
  readonly retirementOperationId: string | null;
  readonly closureComplete: boolean;
};
export type AccountLifecycleClosure = {
  readonly retirementOperationId: string;
  readonly bindingErasureProofRef: string;
  readonly transportErasureProofRef: string;
  readonly nativeErasureProofRef: string;
};
export interface AccountLifecycleOperationStore {
  /** Ordinary methods enforce live owning authority under the established lock order; exact unentered cleanup uses a private claim capability. */
  reserve(intent: AccountLifecycleIntent): Promise<AccountLifecycleReceipt>;
  read(
    actorUserId: string,
    operationId: string,
  ): Promise<AccountLifecycleReceipt>;
  listFences(
    actorUserId: string,
    operationId: string,
    afterBindingId?: string,
  ): Promise<readonly ScopedBindingFence[]>;
  ready(
    actorUserId: string,
    operationId: string,
  ): Promise<AccountLifecycleReceipt>;
  claim(
    actorUserId: string,
    operationId: string,
  ): Promise<{ readonly claimToken: string } | null>;
  /** Consume the private unentered capability immediately before Gateway ingress. */
  enterClaim(
    actorUserId: string,
    operationId: string,
    claimToken: string,
  ): Promise<boolean>;
  /** Only an exact unconsumed private capability can abandon its claim, even after role loss. */
  releaseUnenteredClaim(
    actorUserId: string,
    operationId: string,
    claimToken: string,
  ): Promise<boolean>;
  unknown(actorUserId: string, operationId: string): Promise<void>;
  /** Positive exact no-effect evidence only; delete must retain its permanent denial. */
  reject(
    actorUserId: string,
    operationId: string,
    account: PersonalGatewayAccount,
    noEffectProofRef: string,
  ): Promise<AccountLifecycleReceipt>;
  finalize(
    actorUserId: string,
    operationId: string,
    account: PersonalGatewayAccount,
    retirementOperationId: string | null,
    closure: AccountLifecycleClosure | null,
  ): Promise<AccountLifecycleReceipt>;
}
export type AccountLifecycleCommand = {
  readonly operationId: string;
  readonly accountRef: string;
  readonly profileId: string;
  readonly expectedMetadataRevision: number;
  readonly action: AccountLifecycleIntent["action"];
};
export interface AccountLifecycleGatewayPort {
  /** Local ingress gates only; must pass before the unentered claim is consumed. */
  preflight(command: AccountLifecycleCommand): Promise<void>;
  submit(command: AccountLifecycleCommand): Promise<void>;
  /** Exact immutable request tuple and authoritative result; never infers no-effect from 404. */
  read(command: AccountLifecycleCommand): Promise<{
    readonly command: AccountLifecycleCommand;
    readonly state: "pending" | "unknown" | "rejected_no_effect" | "applied";
    readonly account: PersonalGatewayAccount | null;
    readonly retirementOperationId: string | null;
    readonly closure: AccountLifecycleClosure | null;
    readonly noEffectProofRef: string | null;
  }>;
}
