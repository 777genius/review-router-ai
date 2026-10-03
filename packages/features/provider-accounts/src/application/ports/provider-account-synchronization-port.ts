import type { ConnectionMetadata, ProviderAccountConnection } from "../../domain/provider-account";

/** Privileged gateway-status synchronization only. Compose on the trusted backend,
 * never as a browser metadata mutation. No account creation/reconnect/credential effect.
 */
export interface ProviderAccountSynchronizationPort {
  recordWorkspaceConnection(input: ConnectionMetadata & {
    readonly id: string;
    readonly workspaceId: string;
    readonly gatewayAccountRef: string;
  }): Promise<ProviderAccountConnection>;
  synchronizeMetadata(input: ConnectionMetadata & {
    readonly workspaceId: string;
    readonly connectionId: string;
    readonly expectedRevision: number;
  }): Promise<ProviderAccountConnection>;
}
