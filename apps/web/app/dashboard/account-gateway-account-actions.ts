"use server";

import { snapshotOAuthCompletion } from "../../src/server/legacy-oauth-credentials";
import type { AccountNativeConnectionIntent } from "../../src/server/native-connection-adapter";
import { snapshotNativeConnectionInputs } from "../../src/features/account-gateway/domain/native-connection";

import {
  accountsServerAdapter,
  type AccountIntent,
  type AccountOAuthIntent,
  type AccountOAuthReconnectIntent,
  type AccountOAuthCompletion,
  type AccountOAuthBeginView,
  type AccountOperationView,
  type AccountsPage,
  type AccountsResult,
} from "../../src/server/account-gateway-accounts";

// Client-facing adapter functions. Secret submissions use direct one-off calls,
// never React Query mutation variables. Configuration/session errors are sanitized here too.
export async function listGatewayAccounts(
  context: string,
  cursor: string | null,
): Promise<AccountsResult<AccountsPage>> {
  try {
    return await (await accountsServerAdapter()).list(context, cursor);
  } catch {
    return { status: "unavailable" };
  }
}
export async function mutateGatewayAccount(
  context: string,
  intent: AccountIntent,
): Promise<AccountsResult<AccountOperationView>> {
  // Retirement is only admitted through the durable lifecycle journal.
  if (intent?.kind === "disable") return { status: "denied" };
  if (intent?.kind === "connect" || intent?.kind === "reconnect")
    return { status: "invalid" };
  try {
    return await (await accountsServerAdapter()).mutate(context, intent);
  } catch {
    return { status: "unavailable" };
  }
}
// Compatible action name: the declared method selects API-key or bounded import ingress.
export async function submitGatewayApiKey(
  context: string,
  intent: AccountIntent,
  credential: string,
): Promise<AccountsResult<AccountOperationView>> {
  if (intent?.kind !== "connect" && intent?.kind !== "reconnect")
    return { status: "invalid" };
  try {
    return await (
      await accountsServerAdapter()
    ).mutate(context, intent, credential);
  } catch {
    return { status: "unavailable" };
  }
}
export async function readGatewayOperation(
  context: string,
  nonce: string,
): Promise<AccountsResult<AccountOperationView>> {
  try {
    return await (await accountsServerAdapter()).operation(context, nonce);
  } catch {
    return { status: "unavailable" };
  }
}
export async function beginGatewayOAuth(
  context: string,
  intent: AccountOAuthIntent | AccountOAuthReconnectIntent,
): Promise<AccountsResult<AccountOAuthBeginView>> {
  try {
    return await (await accountsServerAdapter()).beginOAuth(context, intent);
  } catch {
    return { status: "unavailable" };
  }
}
export async function beginGatewayNativeConnection(
  context: string,
  intent: AccountNativeConnectionIntent,
  values: Record<string, string>,
): Promise<AccountsResult<AccountOAuthBeginView>> {
  try {
    const inputFields = snapshotNativeConnectionInputs(values);
    return await (
      await accountsServerAdapter()
    ).beginNative(context, intent, inputFields);
  } catch {
    return { status: "unavailable" };
  }
}
export async function continueGatewayNativeConnection(
  context: string,
  nonce: string,
  values?: Record<string, string>,
): Promise<AccountsResult<AccountOperationView>> {
  try {
    const inputFields =
      values === undefined ? undefined : snapshotNativeConnectionInputs(values);
    return await (
      await accountsServerAdapter()
    ).continueNative(context, nonce, inputFields);
  } catch {
    return { status: "unavailable" };
  }
}
export async function pollGatewayOAuth(
  context: string,
  nonce: string,
): Promise<AccountsResult<AccountOperationView>> {
  try {
    return await (await accountsServerAdapter()).pollOAuth(context, nonce);
  } catch {
    return { status: "unavailable" };
  }
}
export async function completeGatewayOAuth(
  context: string,
  intent: AccountOAuthCompletion,
): Promise<AccountsResult<AccountOperationView>> {
  try {
    const safe = snapshotOAuthCompletion(intent);
    return await (await accountsServerAdapter()).completeOAuth(context, safe);
  } catch {
    return { status: "unavailable" };
  }
}
export async function bindGatewayAccount(
  context: string,
  intent: {
    connectionId: string;
    mirrorRevision: number;
    gatewayRevision: number;
    bindingRevision: number;
  },
): Promise<AccountsResult<{ label: string }>> {
  try {
    return await (await accountsServerAdapter()).bind(context, intent);
  } catch {
    return { status: "unavailable" };
  }
}

export async function changeGatewayOperatorGrant(
  context: string,
  intent: {
    workspaceId: string;
    connectionId: string;
    expectedRevision: number;
    state: "active" | "revoked";
  },
) {
  try {
    return await (await accountsServerAdapter()).changeGrant(context, intent);
  } catch {
    return { status: "unavailable" as const };
  }
}

export async function detachGatewayAccount(
  context: string,
  intent: {
    connectionId: string;
    expectedRevision: number;
  },
) {
  try {
    return await (await accountsServerAdapter()).detach(context, intent);
  } catch {
    return { status: "unavailable" as const };
  }
}

export async function reconcileGatewayAccountFence(
  context: string,
  intent: {
    workspaceId: string;
    connectionId: string;
  },
) {
  try {
    return await (
      await accountsServerAdapter()
    ).reconcileFence(context, intent);
  } catch {
    return { status: "unavailable" as const };
  }
}
