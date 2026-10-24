"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useCallback, useTransition } from "react";
import type { ProviderApiKeyRepositoryResult } from "@reviewrouter/features-provider-setup";
import {
  getProviderAuthModeMetadata,
  type ProviderAuthMode,
} from "@reviewrouter/features-review-providers";
import {
  managedApiKeyProviderTypes,
  type ManagedApiKeyAuthMode,
} from "@reviewrouter/features-review-config/workspace-provider-profile";
import type { ProviderSetupView } from "../../../src/features/provider-setup/provider-setup-model";
import { checkProviderRepositorySecretClientAction } from "../actions";
/**
 * Client adapter of the provider dialog: typed query keys, read functions and
 * the mutations it calls. Reads go through React Query; writes are server
 * actions, so they keep origin protection and revalidate the dashboard.
 */
export const providerSetupQueryKeys = {
  workspace: (workspaceId: string) => ["provider-setup", workspaceId] as const,
  view: (workspaceId: string, repositoryIds: readonly string[]) =>
    [
      "provider-setup",
      workspaceId,
      "view",
      [...repositoryIds].sort().join(","),
    ] as const,
  secretStatus: (
    workspaceId: string,
    repositoryId: string,
    authMode: ProviderAuthMode,
  ) =>
    ["provider-setup", workspaceId, "secret", repositoryId, authMode] as const,
  managedKey: (workspaceId: string, authMode: ManagedApiKeyAuthMode) =>
    ["provider-setup", workspaceId, "managed-key", authMode] as const,
};

export async function fetchProviderSetupView(
  workspaceId: string,
  repositoryIds: readonly string[],
): Promise<ProviderSetupView> {
  const params = new URLSearchParams({ workspace: workspaceId });
  for (const repositoryId of repositoryIds)
    params.append("repository", repositoryId);
  const response = await fetch(`/api/dashboard/provider-setup?${params}`, {
    cache: "no-store",
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(
      body && typeof body === "object" && "error" in body
        ? String((body as { readonly error: unknown }).error)
        : "provider_setup_unavailable",
    );
  return body as ProviderSetupView;
}

/** What the dialog offers for its target; fetched while it is open. */
export function useProviderSetupView(input: {
  readonly workspaceId: string;
  readonly repositoryIds: readonly string[];
  readonly enabled: boolean;
}) {
  return useQuery({
    queryKey: providerSetupQueryKeys.view(
      input.workspaceId,
      input.repositoryIds,
    ),
    queryFn: () =>
      fetchProviderSetupView(input.workspaceId, input.repositoryIds),
    enabled: input.enabled,
    // Decisions depend on roles and Access rights; keep them fresh.
    staleTime: 15_000,
  });
}

export type ProviderSecretStatus = Awaited<
  ReturnType<typeof checkProviderRepositorySecretClientAction>
>["status"];

/** Whether the repository's GitHub Actions secret for a provider exists. */
export function useProviderSecretStatus(input: {
  readonly workspaceId: string;
  readonly repositoryId: string;
  readonly authMode: ProviderAuthMode;
  readonly enabled: boolean;
}) {
  return useQuery({
    queryKey: providerSetupQueryKeys.secretStatus(
      input.workspaceId,
      input.repositoryId,
      input.authMode,
    ),
    queryFn: async () => {
      const formData = new FormData();
      formData.set("workspaceId", input.workspaceId);
      formData.set("repositoryId", input.repositoryId);
      formData.set(
        "providerKind",
        getProviderAuthModeMetadata(input.authMode).providerKind,
      );
      formData.set("authMode", input.authMode);
      return (await checkProviderRepositorySecretClientAction(formData)).status;
    },
    enabled: input.enabled,
    // GitHub metadata changes outside ReviewRouter; recheck after a minute.
    staleTime: 60_000,
    retry: false,
  });
}

/**
 * The dialog's and the Providers list's writes: server actions, each deciding
 * again under its own locks.
 */
export {
  archiveProviderProfileAction as archiveProviderProfile,
  clearWorkspaceDefaultProviderAction as clearWorkspaceDefaultProvider,
  createProviderProfileAction as createProviderProfile,
  inheritWorkspaceDefaultProviderAction as inheritWorkspaceDefaultProvider,
  saveProviderSetupAction as saveProviderSetup,
  updateProviderProfileAction as updateProviderProfile,
} from "../provider-setup-actions";

export type ManagedProviderKeyState = Readonly<{
  connected: boolean;
  keyVersion: number | null;
  repositories: readonly Readonly<{
    repositoryId: string;
    repositoryFullName: string;
    status: ProviderApiKeyRepositoryResult["status"];
  }>[];
}>;

export async function fetchManagedProviderKeyState(
  workspaceId: string,
  authMode: ManagedApiKeyAuthMode,
): Promise<ManagedProviderKeyState> {
  const params = new URLSearchParams({
    workspace: workspaceId,
    providerType: managedApiKeyProviderTypes[authMode],
  });
  const response = await fetch(`/api/dashboard/provider-keys?${params}`, {
    cache: "no-store",
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(
      body && typeof body === "object" && "error" in body
        ? String((body as { readonly error: unknown }).error)
        : "provider_key_request_failed",
    );
  return body as ManagedProviderKeyState;
}

/** The saved key of a managed provider and where it is installed. */
export function useManagedProviderKeyState(input: {
  readonly workspaceId: string;
  readonly authMode: ManagedApiKeyAuthMode;
  readonly enabled: boolean;
}) {
  return useQuery({
    queryKey: providerSetupQueryKeys.managedKey(
      input.workspaceId,
      input.authMode,
    ),
    queryFn: () =>
      fetchManagedProviderKeyState(input.workspaceId, input.authMode),
    enabled: input.enabled,
    // Installs run in the background of an apply; recheck while open.
    staleTime: 30_000,
    retry: false,
  });
}

/**
 * After a provider write: refetch the dialog reads of the workspace and the
 * server-rendered dashboard, which owns the stepper and provider lines.
 */
export function useProviderSetupCompletion(workspaceId: string) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [refreshing, startTransition] = useTransition();
  const complete = useCallback(async () => {
    await queryClient.invalidateQueries({
      queryKey: providerSetupQueryKeys.workspace(workspaceId),
    });
    startTransition(() => router.refresh());
  }, [queryClient, router, workspaceId]);
  return { complete, refreshing };
}

export type ProviderSecretConfirmation = Readonly<{
  params: Record<string, string>;
}>;

/** Marks a provider credential of the repository as set up. */
export async function confirmProviderSecretSetup(
  formData: FormData,
): Promise<ProviderSecretConfirmation> {
  const response = await fetch("/api/dashboard/provider-secret-setup/confirm", {
    method: "POST",
    body: formData,
  });
  if (!response.ok) throw new Error("provider_setup_confirm_failed");
  const result: unknown = await response.json();
  if (
    !result ||
    typeof result !== "object" ||
    !("params" in result) ||
    !result.params ||
    typeof result.params !== "object" ||
    !Object.values(result.params).every((value) => typeof value === "string")
  )
    throw new Error("provider_setup_confirm_invalid_response");
  return result as ProviderSecretConfirmation;
}

export type ManagedProviderKeyResult = Readonly<{
  results: readonly ProviderApiKeyRepositoryResult[];
}>;

/**
 * Saves (when `apiKey` is given) and installs the server-held key of a
 * managed provider into repository GitHub Actions secrets. Owner/admin only.
 */
export async function installManagedProviderKey(input: {
  readonly workspaceId: string;
  readonly authMode: ManagedApiKeyAuthMode;
  readonly apiKey?: string;
  readonly repositoryIds: readonly string[];
}): Promise<ManagedProviderKeyResult> {
  const response = await fetch("/api/dashboard/provider-keys/apply", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      workspaceId: input.workspaceId,
      providerType: managedApiKeyProviderTypes[input.authMode],
      ...(input.apiKey ? { apiKey: input.apiKey } : {}),
      repositoryIds: input.repositoryIds,
    }),
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(
      body && typeof body === "object" && "error" in body
        ? String((body as { readonly error: unknown }).error)
        : "provider_key_apply_failed",
    );
  return body as ManagedProviderKeyResult;
}
