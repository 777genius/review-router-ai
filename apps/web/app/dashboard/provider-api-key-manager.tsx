"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, PlugZap, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  type ProviderApiKeyProvider,
  type ProviderApiKeyRepositoryResult,
} from "@reviewrouter/features-provider-setup";
import {
  Badge,
  Button,
  DialogBackdrop,
  DialogClose,
  DialogDescription,
  DialogPopup,
  DialogPortal,
  DialogRoot,
  DialogTitle,
  DialogTrigger,
} from "@reviewrouter/ui";
import {
  applyProviderApiKeyRequest,
  fetchProviderApiKeyState,
  fetchProviderKeyRepositories,
  providerApiKeyStateQueryKey,
  providerKeyRepositoryQueryKey,
} from "./provider-api-key-manager-api";

const providerOptions = [
  { value: "mimo", label: "MiMo Token Plan" },
  { value: "openrouter", label: "OpenRouter" },
] as const;

type ApplyProviderKeyOperation = {
  readonly id: number;
  readonly workspaceId: string;
  readonly providerType: ProviderApiKeyProvider;
  readonly apiKey?: string;
  readonly repositoryIds: readonly string[];
};

export function ProviderApiKeyManager({
  workspaceId,
  disabled = false,
  disabledReason,
}: {
  readonly workspaceId: string;
  readonly disabled?: boolean;
  readonly disabledReason?: string;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [providerType, setProviderType] =
    useState<ProviderApiKeyProvider>("mimo");
  const [apiKey, setApiKey] = useState("");
  const [selectedRepositoryIds, setSelectedRepositoryIds] = useState<
    ReadonlySet<string>
  >(new Set());
  const [repositoryFilter, setRepositoryFilter] = useState("");
  const [results, setResults] = useState<
    readonly ProviderApiKeyRepositoryResult[] | null
  >(null);
  const [resultsScope, setResultsScope] = useState<string | null>(null);
  const [pendingOperation, setPendingOperation] =
    useState<ApplyProviderKeyOperation | null>(null);
  const initializedSelectionScopeRef = useRef<string | null>(null);
  const nextOperationIdRef = useRef(0);
  const pendingOperationRef = useRef<ApplyProviderKeyOperation | null>(null);
  const queryClient = useQueryClient();
  const scopedWorkspaceId = pendingOperation?.workspaceId ?? workspaceId;
  const scopedProviderType = pendingOperation?.providerType ?? providerType;
  const scopedOperationKey = `${scopedWorkspaceId}:${scopedProviderType}`;
  const repositoryQueryKey = providerKeyRepositoryQueryKey(scopedWorkspaceId);
  const stateQueryKey = providerApiKeyStateQueryKey(
    scopedWorkspaceId,
    scopedProviderType,
  );
  const repositoriesQuery = useQuery({
    queryKey: repositoryQueryKey,
    enabled: open,
    staleTime: 60_000,
    queryFn: () => fetchProviderKeyRepositories(scopedWorkspaceId),
  });
  const stateQuery = useQuery({
    queryKey: stateQueryKey,
    enabled: open,
    staleTime: 30_000,
    queryFn: () =>
      fetchProviderApiKeyState({
        workspaceId: scopedWorkspaceId,
        providerType: scopedProviderType,
      }),
  });
  const applyMutation = useMutation({
    mutationFn: (operation: ApplyProviderKeyOperation) =>
      applyProviderApiKeyRequest({
        workspaceId: operation.workspaceId,
        providerType: operation.providerType,
        ...(operation.apiKey ? { apiKey: operation.apiKey } : {}),
        repositoryIds: operation.repositoryIds,
      }),
    onSuccess: (data, operation) => {
      if (pendingOperationRef.current?.id !== operation.id) return;
      setResults(data.results);
      setResultsScope(`${operation.workspaceId}:${operation.providerType}`);
      setApiKey("");
      void queryClient.invalidateQueries({
        queryKey: providerApiKeyStateQueryKey(
          operation.workspaceId,
          operation.providerType,
        ),
      });
    },
    onSettled: (_data, _error, operation) => {
      if (!operation || pendingOperationRef.current?.id !== operation.id) {
        return;
      }
      pendingOperationRef.current = null;
      setPendingOperation(null);
    },
  });

  useEffect(() => {
    initializedSelectionScopeRef.current = null;
    setApiKey("");
    setResults(null);
    setResultsScope(null);
    setRepositoryFilter("");
    setSelectedRepositoryIds(new Set());
  }, [scopedProviderType, scopedWorkspaceId]);

  useEffect(() => {
    if (
      !stateQuery.data ||
      initializedSelectionScopeRef.current === scopedOperationKey
    ) {
      return;
    }
    initializedSelectionScopeRef.current = scopedOperationKey;
    setSelectedRepositoryIds(
      new Set(
        stateQuery.data.repositories
          .filter(
            (repository) =>
              repository.status !== "failed" && repository.status !== "denied",
          )
          .map((repository) => repository.repositoryId),
      ),
    );
  }, [scopedOperationKey, stateQuery.data]);

  const repositories = useMemo(
    () =>
      (repositoriesQuery.data?.repositories ?? []).filter(
        (repository) =>
          repository.provider === "github" &&
          repository.fullName
            .toLowerCase()
            .includes(repositoryFilter.trim().toLowerCase()),
      ),
    [repositoriesQuery.data, repositoryFilter],
  );
  const connectedRepositoryIds = new Set(
    stateQuery.data?.repositories.map((repository) => repository.repositoryId),
  );
  const applyPending = applyMutation.isPending || pendingOperation !== null;
  const applyErrorScope = applyMutation.variables
    ? `${applyMutation.variables.workspaceId}:${applyMutation.variables.providerType}`
    : null;

  const beginApply = () => {
    const operationId = nextOperationIdRef.current + 1;
    nextOperationIdRef.current = operationId;
    const operation: ApplyProviderKeyOperation = {
      id: operationId,
      workspaceId,
      providerType,
      ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      repositoryIds: [...selectedRepositoryIds],
    };
    pendingOperationRef.current = operation;
    setPendingOperation(operation);
    setResults(null);
    setResultsScope(null);
    applyMutation.mutate(operation);
  };

  return (
    <DialogRoot
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && applyPending) return;
        setOpen(nextOpen);
        if (!nextOpen) {
          setApiKey("");
          setResults(null);
        }
      }}
    >
      <DialogTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            title={disabled ? disabledReason : undefined}
          />
        }
      >
        <KeyRound aria-hidden="true" className="h-4 w-4" />
        Connect MiMo / OpenRouter
      </DialogTrigger>
      <DialogPortal>
        <DialogBackdrop className="z-50" />
        <DialogPopup className="z-[60] max-h-[88vh] w-[min(96vw,64rem)] overflow-y-auto border-cyan-200/20 bg-[var(--rr-surface-menu)] p-0">
          <DialogClose
            render={
              <button
                type="button"
                disabled={applyPending}
                className="absolute right-4 top-4 z-10 grid h-9 w-9 place-items-center rounded-full border border-cyan-200/15 text-cyan-100"
                aria-label="Close provider key manager"
              />
            }
          >
            ×
          </DialogClose>
          <div className="border-b border-cyan-200/10 p-5 pr-14 sm:p-6">
            <Badge tone="accent">Repository secrets</Badge>
            <DialogTitle className="mt-3 text-xl font-semibold text-cyan-50">
              Connect MiMo / OpenRouter
            </DialogTitle>
            <DialogDescription className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">
              Apply your own provider key to explicitly selected GitHub
              repositories. ReviewRouter encrypts the saved key and never
              returns it to the browser.
            </DialogDescription>
          </div>

          <div className="space-y-6 p-5 sm:p-6">
            {pendingOperation ? (
              <div
                role="status"
                aria-live="polite"
                className="border-l-2 border-cyan-300/60 pl-3 text-sm text-cyan-100"
              >
                Applying {providerLabel(pendingOperation.providerType)} in{" "}
                {pendingOperation.workspaceId} to{" "}
                {pendingOperation.repositoryIds.length}{" "}
                {pendingOperation.repositoryIds.length === 1
                  ? "repository"
                  : "repositories"}
                . Workspace and provider scope are locked until this operation
                settles.
              </div>
            ) : null}

            <fieldset disabled={applyPending}>
              <legend className="text-sm font-semibold text-cyan-100">
                Provider
              </legend>
              <div className="mt-3 flex flex-wrap gap-2">
                {providerOptions.map((option) => (
                  <label
                    key={option.value}
                    className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm ${
                      providerType === option.value
                        ? "border-cyan-300/50 bg-cyan-300/10 text-cyan-50"
                        : "border-cyan-200/10 text-slate-300"
                    } ${applyPending ? "cursor-default opacity-60" : "cursor-pointer"}`}
                  >
                    <input
                      type="radio"
                      name="providerType"
                      value={option.value}
                      checked={providerType === option.value}
                      disabled={applyPending}
                      onChange={() => setProviderType(option.value)}
                    />
                    {option.label}
                  </label>
                ))}
              </div>
            </fieldset>

            <label className="block">
              <span className="text-sm font-semibold text-cyan-100">
                {providerType === "mimo"
                  ? "MiMo Token Plan API key"
                  : "OpenRouter API key"}
              </span>
              <input
                type="password"
                autoComplete="off"
                disabled={applyPending}
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder={
                  stateQuery.data?.connected
                    ? "Saved key available — leave blank to keep it"
                    : "Paste API key"
                }
                className="mt-2 w-full rounded-xl border border-cyan-200/15 bg-slate-950/70 px-3 py-2.5 text-sm text-cyan-50 outline-none focus:border-cyan-300/50"
              />
            </label>

            <section>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-cyan-100">
                    GitHub repositories
                  </h3>
                  <p className="mt-1 text-xs text-slate-500">
                    {selectedRepositoryIds.size} selected
                    {stateQuery.data?.connected
                      ? ` · ${connectedRepositoryIds.size} previously connected`
                      : ""}
                  </p>
                </div>
                <label className="relative min-w-[14rem] flex-1 sm:max-w-xs">
                  <Search
                    aria-hidden="true"
                    className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500"
                  />
                  <input
                    value={repositoryFilter}
                    disabled={applyPending}
                    onChange={(event) =>
                      setRepositoryFilter(event.target.value)
                    }
                    placeholder="Filter repositories"
                    className="w-full rounded-full border border-cyan-200/10 bg-slate-950/60 py-2 pl-9 pr-3 text-sm text-cyan-50 outline-none focus:border-cyan-300/40"
                  />
                </label>
              </div>
              <div className="mt-3 max-h-72 divide-y divide-cyan-200/10 overflow-y-auto border-y border-cyan-200/10">
                {repositoriesQuery.isLoading ? (
                  <p className="p-4 text-sm text-slate-400">
                    Loading repositories…
                  </p>
                ) : repositories.length === 0 ? (
                  <p className="p-4 text-sm text-slate-400">
                    No matching GitHub repositories.
                  </p>
                ) : (
                  repositories.map((repository) => (
                    <label
                      key={repository.id}
                      className="flex cursor-pointer items-center gap-3 px-3 py-3 hover:bg-cyan-300/[0.035]"
                    >
                      <input
                        type="checkbox"
                        checked={selectedRepositoryIds.has(repository.id)}
                        disabled={applyPending}
                        onChange={(event) => {
                          const next = new Set(selectedRepositoryIds);
                          if (event.target.checked) next.add(repository.id);
                          else next.delete(repository.id);
                          setSelectedRepositoryIds(next);
                        }}
                      />
                      <span className="min-w-0 flex-1 truncate text-sm text-cyan-50">
                        {repository.fullName}
                      </span>
                      {connectedRepositoryIds.has(repository.id) ? (
                        <Badge tone="success">Saved</Badge>
                      ) : null}
                    </label>
                  ))
                )}
              </div>
            </section>

            {stateQuery.error ? (
              <p role="alert" className="text-sm text-rose-200">
                {providerKeyErrorMessage((stateQuery.error as Error).message)}
              </p>
            ) : null}

            {applyMutation.error && applyErrorScope === scopedOperationKey ? (
              <p role="alert" className="text-sm text-rose-200">
                {providerKeyErrorMessage(
                  (applyMutation.error as Error).message,
                )}
              </p>
            ) : null}

            <div className="flex flex-wrap items-center justify-end gap-3">
              <Button
                type="button"
                variant="ghost"
                disabled={applyPending}
                onClick={() => {
                  setSelectedRepositoryIds(
                    new Set(
                      (repositoriesQuery.data?.repositories ?? [])
                        .filter(
                          (repository) => repository.provider === "github",
                        )
                        .map((repository) => repository.id),
                    ),
                  );
                }}
              >
                Select all
              </Button>
              <Button
                type="button"
                variant="solid"
                disabled={
                  selectedRepositoryIds.size === 0 ||
                  applyPending ||
                  (!apiKey.trim() && !stateQuery.data?.connected)
                }
                onClick={beginApply}
              >
                <PlugZap aria-hidden="true" className="h-4 w-4" />
                {applyPending ? "Applying…" : "Apply"}
              </Button>
            </div>

            {results && resultsScope === scopedOperationKey ? (
              <section>
                <h3 className="text-sm font-semibold text-cyan-100">
                  Batch results
                </h3>
                <div className="mt-3 overflow-x-auto border-y border-cyan-200/10">
                  <table className="w-full text-left text-sm">
                    <thead className="text-xs uppercase tracking-[0.12em] text-slate-500">
                      <tr>
                        <th className="px-3 py-3">Repository</th>
                        <th className="px-3 py-3">Status</th>
                        <th className="px-3 py-3">Details</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-cyan-200/10">
                      {results.map((result) => (
                        <tr key={result.repositoryId}>
                          <td className="px-3 py-3 text-cyan-50">
                            {result.repositoryFullName}
                          </td>
                          <td className="px-3 py-3">
                            <ProviderKeyResultBadge status={result.status} />
                          </td>
                          <td className="px-3 py-3 text-slate-300">
                            {result.errorSummary ??
                              (result.errorReason
                                ? providerKeyErrorMessage(result.errorReason)
                                : result.status === "applied"
                                  ? "Secret written to repository Actions."
                                  : providerKeyErrorMessage(result.status))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ) : null}
          </div>
        </DialogPopup>
      </DialogPortal>
    </DialogRoot>
  );
}

function providerLabel(providerType: ProviderApiKeyProvider): string {
  return (
    providerOptions.find((option) => option.value === providerType)?.label ??
    providerType
  );
}

function ProviderKeyResultBadge({
  status,
}: {
  readonly status: ProviderApiKeyRepositoryResult["status"];
}): React.ReactElement {
  const presentation: {
    readonly tone: "accent" | "success" | "warning" | "danger";
    readonly label: string;
  } =
    status === "applied"
      ? { tone: "success", label: "Success" }
      : status === "failed"
        ? { tone: "danger", label: "Error" }
        : status === "denied"
          ? { tone: "warning", label: "Denied" }
          : status === "stale"
            ? { tone: "warning", label: "Stale" }
            : status === "reconciliation_needed"
              ? { tone: "warning", label: "Reconcile" }
              : status === "applying"
                ? { tone: "accent", label: "Applying" }
                : { tone: "accent", label: "Pending" };
  return <Badge tone={presentation.tone}>{presentation.label}</Badge>;
}

function providerKeyErrorMessage(code: string): string {
  const messages: Record<string, string> = {
    "entitlement_denied:provider_key_management:feature_not_enabled_for_plan":
      "Provider key management is unavailable for this workspace plan.",
    "entitlement_denied:provider_key_management:workspace_entitlement_not_active":
      "Provider key management requires an active workspace plan.",
    workspace_admin_forbidden: "Workspace admin access is required.",
    stored_api_key_unavailable:
      "Enter a new API key; no saved key is available.",
    repository_not_allowed: "Repository is not allowed for this workspace.",
    repository_not_found:
      "Repository was not found or is not in this workspace.",
    repository_not_available_to_github_app:
      "Repository is not connected to the ReviewRouter GitHub App.",
    insufficient_permissions:
      "GitHub App lacks permission to write repository secrets.",
    rate_limited: "GitHub rate limit reached. Try again later.",
    github_secret_encryption_failed:
      "GitHub returned an invalid repository encryption key.",
    github_request_failed: "GitHub rejected the repository secret request.",
    persistence_failed:
      "GitHub accepted the update, but ReviewRouter needs to reconcile its saved status.",
    provider_key_reconciliation_required:
      "Resolve the saved reconciliation state before starting another provider key operation.",
    provider_key_apply_failed: "The batch request failed.",
    provider_key_state_failed: "Provider key state could not be loaded.",
    provider_key_storage_not_configured:
      "Server-side key encryption is not configured.",
    github_app_id_not_configured:
      "The ReviewRouter GitHub App is not configured.",
    "missing_env:GITHUB_APP_PRIVATE_KEY":
      "The ReviewRouter GitHub App private key is not configured.",
  };
  return messages[code] ?? "Provider key operation failed.";
}
