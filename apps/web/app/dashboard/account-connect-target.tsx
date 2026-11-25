"use client";

import {
  createContext,
  useContext,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { SetupProviderId } from "../../src/features/provider-setup/setup-provider";

/**
 * A connect form embedded in another flow, such as adding a provider. The
 * host owns which request the form follows, so the form survives rereads of
 * the host's lists and opens fresh after the connection is used.
 */
export type ConnectTarget = Readonly<{
  /** Only this provider's profiles are offered. */
  provider: SetupProviderId;
  /** The host has no ready connection of this provider yet. */
  empty: boolean;
  /** The request this form follows; null shows a fresh form. */
  nonce: string | null;
  setNonce: Dispatch<SetStateAction<string | null>>;
  /** Called once the new connection can be used in this workspace. */
  onConnected(bindingId: string): void;
}>;

export const ConnectTargetContext = createContext<ConnectTarget | null>(null);

export function useConnectTarget(): ConnectTarget | null {
  return useContext(ConnectTargetContext);
}
