"use client";

import type { AccountsResult } from "../../src/server/account-gateway-accounts";
import type {
  AccountLifecycleRequest,
  AccountLifecycleView,
} from "../../src/server/account-lifecycle";
import {
  mutateAccountLifecycle,
  continueAccountLifecycleOperation,
} from "./account-lifecycle-actions";

export type AccountLifecycleApi = {
  mutate(
    context: string,
    workspaceId: string,
    request: AccountLifecycleRequest,
  ): Promise<AccountsResult<AccountLifecycleView>>;
  continue(
    context: string,
    workspaceId: string,
    operationId: string,
  ): Promise<AccountsResult<AccountLifecycleView>>;
  read(
    context: string,
    workspaceId: string,
    request: { nonce: string } | { operationId: string },
  ): Promise<AccountsResult<AccountLifecycleView>>;
};
export const accountLifecycleApi: AccountLifecycleApi = {
  mutate: mutateAccountLifecycle,
  continue: continueAccountLifecycleOperation,
  async read(context, workspaceId, original) {
    try {
      const query = new URLSearchParams({
        context,
        view: "lifecycle",
        request: JSON.stringify({ workspaceId, ...original }),
      });
      const response = await fetch(`/api/dashboard/accounts/access?${query}`, {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!response.ok) return { status: "unavailable" };
      const result =
        (await response.json()) as AccountsResult<AccountLifecycleView>;
      return ["ok", "denied", "conflict", "invalid", "unavailable"].includes(
        result?.status,
      )
        ? result
        : { status: "unavailable" };
    } catch {
      return { status: "unavailable" };
    }
  },
};
