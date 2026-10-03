import type {
  BindingScope,
  BindingState,
  ProviderAccountConnection,
  WorkspaceAccountBinding,
} from "../../domain/provider-account";

export interface ProviderAccountRepositoryPort {
  findOwnedConnection(
    scope: BindingScope,
  ): Promise<ProviderAccountConnection | null>;
  findBinding(input: {
    readonly workspaceId: string;
    readonly bindingId: string;
  }): Promise<{
    readonly binding: WorkspaceAccountBinding;
    readonly connection: ProviderAccountConnection;
  } | null>;
  /** Atomically recheck owner + state and CAS. 0 creates only an absent active binding.
   * Revoked rows are retained to prevent ABA. Revocation can clean up inactive accounts.
   * Failure must throw a safe ProviderAccountError; never overwrite a stale revision.
   */
  compareAndSetBinding(
    input: BindingScope & {
      readonly expectedRevision: number;
      readonly state: BindingState;
    },
  ): Promise<WorkspaceAccountBinding>;
}
