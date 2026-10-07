import type { HostedV4RelayGrantContract } from "../../domain/hosted-v4-relay-grant";

/** Persistence only. These checks do not resolve live authorization or leases. */
export interface HostedV4RelayTurnPort {
  reserve(contract: HostedV4RelayGrantContract): Promise<void>;
  assertOpen(contract: HostedV4RelayGrantContract): Promise<void>;
  markTerminalUnknown(logicalTurnKey: string, at: Date): Promise<void>;
}
