"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { ProviderApiKeyRepositoryResult } from "@reviewrouter/features-provider-setup";
import type { ManagedApiKeyAuthMode } from "@reviewrouter/features-review-config/workspace-provider-profile";
import {
  Badge,
  Button,
  DialogBackdrop,
  DialogCloseButton,
  DialogDescription,
  DialogPopup,
  DialogPortal,
  DialogRoot,
  DialogTitle,
  DialogTrigger,
  TextField,
} from "@reviewrouter/ui";
import type { ProviderListDecision } from "../../../src/features/provider-setup/provider-list-model";
import {
  managedKeyErrorText,
  managedKeyName,
} from "./provider-credential-delivery";
import {
  installManagedProviderKey,
  providerSetupQueryKeys,
  useManagedProviderKeyState,
  useProviderSetupCompletion,
  type ManagedProviderKeyState,
} from "./provider-setup-api";

/**
 * Replaces the key ReviewRouter saved for a managed provider (owner/admin):
 * the new key is stored encrypted and installed in every repository that has
 * the current one, through the same apply flow as its first installation.
 */
export function ManagedKeyRotationDialog({
  workspaceId,
  authMode,
  decision,
}: {
  readonly workspaceId: string;
  readonly authMode: ManagedApiKeyAuthMode;
  readonly decision: ProviderListDecision;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  return (
    <DialogRoot
      open={open}
      onOpenChange={(next) => {
        if (!next && pending) return;
        setOpen(next);
      }}
    >
      <DialogTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-9 rounded-lg px-3"
            disabled={!decision.allowed}
          />
        }
      >
        Replace key
      </DialogTrigger>
      <DialogPortal>
        <DialogBackdrop />
        <DialogPopup className="w-[min(96vw,36rem)] p-0">
          <DialogCloseButton label="Close key replacement" disabled={pending} />
          {open ? (
            <ManagedKeyRotationForm
              workspaceId={workspaceId}
              authMode={authMode}
              onPendingChange={setPending}
              onDone={() => setOpen(false)}
            />
          ) : null}
        </DialogPopup>
      </DialogPortal>
    </DialogRoot>
  );
}

function ManagedKeyRotationForm({
  workspaceId,
  authMode,
  onPendingChange,
  onDone,
}: {
  readonly workspaceId: string;
  readonly authMode: ManagedApiKeyAuthMode;
  readonly onPendingChange: (pending: boolean) => void;
  readonly onDone: () => void;
}): React.ReactElement {
  const state = useManagedProviderKeyState({
    workspaceId,
    authMode,
    enabled: true,
  });
  const queryClient = useQueryClient();
  const completion = useProviderSetupCompletion(workspaceId);
  const [apiKey, setApiKey] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<
    readonly ProviderApiKeyRepositoryResult[] | null
  >(null);
  const name = managedKeyName(authMode);
  const repositories = state.data?.repositories ?? [];
  const outdated = repositories.filter(
    (repository) => repository.status !== "applied",
  );

  async function apply(input: {
    readonly apiKey?: string;
    readonly repositoryIds: readonly string[];
  }): Promise<void> {
    setPending(true);
    onPendingChange(true);
    setError(null);
    try {
      const result = await installManagedProviderKey({
        workspaceId,
        authMode,
        ...(input.apiKey ? { apiKey: input.apiKey } : {}),
        repositoryIds: input.repositoryIds,
      });
      setResults(result.results);
      setApiKey("");
      await queryClient.invalidateQueries({
        queryKey: providerSetupQueryKeys.managedKey(workspaceId, authMode),
      });
      await completion.complete();
    } catch (caught) {
      setError(
        managedKeyErrorText(
          caught instanceof Error
            ? caught.message
            : "provider_key_apply_failed",
        ),
      );
    } finally {
      setPending(false);
      onPendingChange(false);
    }
  }

  return (
    <div className="grid gap-5 px-5 py-5 sm:px-6">
      <div>
        <DialogTitle className="pr-10 text-xl text-cyan-50">
          Replace the {name} key
        </DialogTitle>
        <DialogDescription className="text-sm leading-6 text-slate-300">
          Every {name} provider in this workspace uses this key. The new key is
          saved encrypted and installed in each repository that has the current
          one. It is never shown again.
        </DialogDescription>
      </div>

      {results ? (
        <KeyResults results={results} />
      ) : state.isPending ? (
        <p role="status" className="text-sm text-slate-400">
          Loading the key...
        </p>
      ) : state.isError ? (
        <div role="alert" className="grid gap-3 text-sm text-red-100">
          <p>{keyStateErrorText(state.error)}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-fit"
            onClick={() => void state.refetch()}
          >
            Try again
          </Button>
        </div>
      ) : (
        <KeyRepositories state={state.data} />
      )}

      {!results && state.data ? (
        repositories.length === 0 ? (
          <p className="text-sm leading-6 text-amber-100/85">
            The key is not installed in any repository yet, so there is nothing
            to replace. It is installed from a repository&apos;s setup step.
          </p>
        ) : (
          <TextField
            label="New API key"
            type="password"
            autoComplete="off"
            value={apiKey}
            disabled={pending}
            placeholder="Paste the new key"
            onChange={(event) => setApiKey(event.target.value)}
          />
        )
      ) : null}

      {error ? (
        <p role="alert" className="text-sm leading-6 text-red-100">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center justify-end gap-3 border-t border-cyan-200/10 pt-4">
        {results ? (
          <Button type="button" size="sm" onClick={onDone}>
            Done
          </Button>
        ) : (
          <>
            {outdated.length > 0 ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={() =>
                  void apply({
                    repositoryIds: outdated.map(
                      (repository) => repository.repositoryId,
                    ),
                  })
                }
              >
                Install again in {outdated.length}{" "}
                {outdated.length === 1 ? "repository" : "repositories"}
              </Button>
            ) : null}
            <Button
              type="button"
              size="sm"
              aria-busy={pending}
              disabled={pending || repositories.length === 0 || !apiKey.trim()}
              onClick={() =>
                void apply({
                  apiKey: apiKey.trim(),
                  repositoryIds: repositories.map(
                    (repository) => repository.repositoryId,
                  ),
                })
              }
            >
              {pending ? "Installing..." : "Replace key"}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

function KeyRepositories({
  state,
}: {
  readonly state: ManagedProviderKeyState;
}): React.ReactElement | null {
  if (state.repositories.length === 0) return null;
  return (
    <div className="grid gap-2">
      <p className="text-sm text-slate-300">
        Installed in {state.repositories.length}{" "}
        {state.repositories.length === 1 ? "repository" : "repositories"}:
      </p>
      <ul className="grid divide-y divide-cyan-200/10 border-y border-cyan-200/10">
        {state.repositories.map((repository) => (
          <li
            key={repository.repositoryId}
            className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
          >
            <span className="min-w-0 break-words text-cyan-50">
              {repository.repositoryFullName}
            </span>
            <KeyStatusBadge status={repository.status} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function KeyResults({
  results,
}: {
  readonly results: readonly ProviderApiKeyRepositoryResult[];
}): React.ReactElement {
  const applied = results.filter((result) => result.status === "applied");
  return (
    <div className="grid gap-2">
      <p role="status" className="text-sm text-slate-200">
        {applied.length === results.length
          ? `The key is installed in all ${results.length} ${results.length === 1 ? "repository" : "repositories"}.`
          : `The key is installed in ${applied.length} of ${results.length} repositories. Install it again later for the others.`}
      </p>
      <ul className="grid divide-y divide-cyan-200/10 border-y border-cyan-200/10">
        {results.map((result) => (
          <li key={result.repositoryId} className="grid gap-1 py-2 text-sm">
            <span className="flex flex-wrap items-center justify-between gap-2">
              <span className="min-w-0 break-words text-cyan-50">
                {result.repositoryFullName}
              </span>
              <KeyStatusBadge status={result.status} />
            </span>
            {result.status !== "applied" && result.errorReason ? (
              <span className="text-xs leading-5 text-slate-400">
                {managedKeyErrorText(result.errorReason)}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function KeyStatusBadge({
  status,
}: {
  readonly status: ProviderApiKeyRepositoryResult["status"];
}): React.ReactElement {
  switch (status) {
    case "applied":
      return (
        <Badge tone="success" size="xs">
          Up to date
        </Badge>
      );
    case "stale":
      return (
        <Badge tone="warning" size="xs">
          Older key
        </Badge>
      );
    case "applying":
    case "pending":
      return (
        <Badge tone="neutral" size="xs">
          Installing
        </Badge>
      );
    case "reconciliation_needed":
      return (
        <Badge tone="warning" size="xs">
          Checking
        </Badge>
      );
    case "denied":
      return (
        <Badge tone="warning" size="xs">
          Not allowed
        </Badge>
      );
    case "failed":
      return (
        <Badge tone="danger" size="xs">
          Failed
        </Badge>
      );
  }
}

function keyStateErrorText(error: unknown): string {
  const code = error instanceof Error ? error.message : "";
  if (code.startsWith("entitlement_"))
    return "The workspace plan does not include keys saved by ReviewRouter.";
  if (
    code === "workspace_admin_forbidden" ||
    code === "dashboard_admin_forbidden"
  )
    return "Only workspace owners and admins manage saved keys.";
  return "The key could not be loaded.";
}
