"use client";

import { Button, Checkbox } from "@reviewrouter/ui";
import {
  gatewayModelDefaultReasoningEffort,
  gatewayModelSupportsFastMode,
  gatewayModelSupportsReasoningEffort,
} from "../../src/features/account-gateway/review-reasoning-capabilities";
import * as Select from "@radix-ui/react-select";
import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  AccountsPage,
  AccountsResult,
} from "../../src/server/account-gateway-accounts";
import type {
  GatewayBatchRequest,
  GatewayBatchResult,
  GatewayBatchSelection,
  GatewayBatchTarget,
  GatewayBatchTargetResult,
} from "../../src/server/gateway-repository-batch-configuration";

// Kept here as a client-safe constant; the server independently bounds input.
const targetLimit = 100;
export type GatewayBatchInventoryItem = GatewayBatchTarget & {
  readonly fullName: string;
  readonly eligible: boolean;
};
export type GatewayBatchActions = {
  save(request: GatewayBatchRequest): Promise<GatewayBatchResult>;
  read(request: GatewayBatchRequest): Promise<GatewayBatchResult>;
};

type RepositoryActionSelectionValue = {
  readonly selected: readonly GatewayBatchTarget[];
  readonly inventory: readonly GatewayBatchInventoryItem[];
  readonly locked: boolean;
  readonly toggle: (item: GatewayBatchInventoryItem) => void;
  readonly clear: () => void;
  readonly refresh: () => void;
  readonly setOperationLocked: (locked: boolean) => void;
};

const RepositoryActionSelectionContext =
  createContext<RepositoryActionSelectionValue | null>(null);

export function useRepositoryActionSelection(): RepositoryActionSelectionValue | null {
  return useContext(RepositoryActionSelectionContext);
}

export function RepositoryActionSelectionProvider({
  workspaceId,
  inventory,
  disabled = false,
  refresh = () => {},
  children,
}: {
  readonly workspaceId: string;
  readonly inventory: readonly GatewayBatchInventoryItem[];
  readonly disabled?: boolean;
  readonly refresh?: () => void;
  readonly children: ReactNode;
}): React.ReactElement {
  const [selected, setSelected] = useState<readonly GatewayBatchTarget[]>([]);
  const [operationLocked, setOperationLocked] = useState(false);
  useEffect(() => {
    setSelected([]);
    setOperationLocked(false);
  }, [workspaceId]);
  const toggle = useCallback(
    (item: GatewayBatchInventoryItem) => {
      if (disabled || operationLocked) return;
      setSelected((prior) =>
        prior.some((target) => target.repositoryId === item.repositoryId)
          ? prior.filter((target) => target.repositoryId !== item.repositoryId)
          : item.eligible && prior.length < targetLimit
            ? [
                ...prior,
                {
                  repositoryId: item.repositoryId,
                  expectedVersion: item.expectedVersion,
                },
              ]
            : prior,
      );
    },
    [disabled, operationLocked],
  );
  const value: RepositoryActionSelectionValue = {
    selected,
    inventory,
    locked: disabled || operationLocked,
    toggle,
    clear: () => {
      if (!disabled && !operationLocked) setSelected([]);
    },
    refresh,
    setOperationLocked,
  };
  return (
    <RepositoryActionSelectionContext.Provider value={value}>
      {children}
    </RepositoryActionSelectionContext.Provider>
  );
}

function SelectionCheckbox({
  item,
  checked,
  disabled,
  onChange,
  className = "",
}: {
  readonly item: GatewayBatchInventoryItem;
  readonly checked: boolean;
  readonly disabled: boolean;
  readonly onChange: () => void;
  readonly className?: string;
}): React.ReactElement {
  return (
    <Checkbox
      checked={checked}
      aria-label={`Select ${item.fullName}`}
      title={
        item.eligible
          ? `Select ${item.fullName}`
          : `${item.fullName} is currently unavailable`
      }
      disabled={disabled}
      onClick={(event) => event.stopPropagation()}
      onChange={onChange}
      className={className}
    />
  );
}

export function RepositoryActionSelectionCheckbox({
  repositoryId,
}: {
  readonly repositoryId: string;
}): React.ReactElement | null {
  const selection = useContext(RepositoryActionSelectionContext);
  const item = selection?.inventory.find(
    (candidate) => candidate.repositoryId === repositoryId,
  );
  if (!selection || !item) return null;
  const checked = selection.selected.some(
    (target) => target.repositoryId === repositoryId,
  );
  return (
    <div
      className="flex h-full min-h-[3.25rem] items-start justify-center pt-3"
      onClick={(event) => event.stopPropagation()}
    >
      <SelectionCheckbox
        item={item}
        checked={checked}
        disabled={
          selection.locked ||
          (!checked &&
            (!item.eligible || selection.selected.length >= targetLimit))
        }
        onChange={() => selection.toggle(item)}
      />
    </div>
  );
}

export function RepositoryActionSelectionChooser({
  disabled = false,
}: {
  readonly disabled?: boolean;
}): React.ReactElement | null {
  const selection = useContext(RepositoryActionSelectionContext);
  if (!selection) return null;
  return (
    <section aria-label="Repository selection" className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-cyan-100">Repositories</h3>
        <span className="text-xs text-slate-500">
          {selection.selected.length} selected · up to {targetLimit}
        </span>
      </div>
      <div className="max-h-56 divide-y divide-cyan-200/10 overflow-y-auto border-y border-cyan-200/10">
        {selection.inventory.map((item) => {
          const checked = selection.selected.some(
            (target) => target.repositoryId === item.repositoryId,
          );
          return (
            <label
              key={item.repositoryId}
              className="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-cyan-300/[0.035]"
            >
              <SelectionCheckbox
                item={item}
                checked={checked}
                disabled={
                  disabled ||
                  selection.locked ||
                  (!checked &&
                    (!item.eligible ||
                      selection.selected.length >= targetLimit))
                }
                onChange={() => selection.toggle(item)}
              />
              <span className="min-w-0 flex-1 truncate text-sm text-cyan-50">
                {item.fullName}
              </span>
              {!item.eligible ? (
                <span className="text-xs text-amber-200">Unavailable</span>
              ) : null}
            </label>
          );
        })}
      </div>
    </section>
  );
}

function Choice({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  disabled: boolean;
  onChange(value: string): void;
}) {
  return (
    <div className="grid gap-2">
      <span className="text-xs text-slate-400">{label}</span>
      <Select.Root value={value} onValueChange={onChange} disabled={disabled}>
        <Select.Trigger
          aria-label={label}
          className="flex min-h-11 items-center justify-between rounded-xl border border-cyan-200/15 px-3 text-sm text-cyan-50 disabled:opacity-50"
        >
          <Select.Value placeholder={`Choose ${label.toLowerCase()}`} />
          <Select.Icon>⌄</Select.Icon>
        </Select.Trigger>
        <Select.Portal>
          <Select.Content
            position="popper"
            sideOffset={6}
            className="z-[70] max-h-72 overflow-auto rounded-xl border border-cyan-200/15 bg-slate-950 p-2 text-slate-200"
          >
            <Select.Viewport>
              {options.map((option) => (
                <Select.Item
                  key={option.value}
                  value={option.value}
                  className="cursor-pointer rounded-lg p-3 text-sm outline-none data-[highlighted]:bg-cyan-300/10"
                >
                  <Select.ItemText>{option.label}</Select.ItemText>
                  <Select.ItemIndicator> ✓</Select.ItemIndicator>
                </Select.Item>
              ))}
            </Select.Viewport>
          </Select.Content>
        </Select.Portal>
      </Select.Root>
    </div>
  );
}

export function GatewayRepositoryBatchContent({
  workspaceId,
  accounts,
  enabled,
  actions,
  onLockedChange,
}: {
  readonly workspaceId: string;
  readonly accounts: AccountsResult<AccountsPage> | undefined;
  readonly enabled: boolean;
  readonly actions: GatewayBatchActions;
  readonly onLockedChange?: (locked: boolean) => void;
}): React.ReactElement | null {
  const selection = useContext(RepositoryActionSelectionContext);
  const [bindingId, setBindingId] = useState("");
  const [profileId, setProfileId] = useState("");
  const [model, setModel] = useState("");
  const [reasoningEffort, setReasoningEffort] =
    useState<GatewayBatchSelection["reasoningEffort"]>("high");
  const [agenticContext, setAgenticContext] = useState(true);
  const [fastMode, setFastMode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [batch, setBatch] = useState<GatewayBatchRequest | null>(null);
  const [results, setResults] = useState<readonly GatewayBatchTargetResult[]>(
    [],
  );
  const inFlight = useRef(false);
  const selected = selection?.selected ?? [];
  const inventory = selection?.inventory ?? [];
  const page = accounts?.status === "ok" ? accounts.value : null;
  const eligibleAccounts =
    page?.accounts.filter(
      (account) =>
        account.state === "active" &&
        account.binding?.state === "active" &&
        !account.binding.fencePending &&
        page.profiles.some(
          (profile) =>
            profile.id === account.profileId &&
            profile.availability !== "deployment_configuration_required" &&
            profile.protocol === "openai-responses" &&
            profile.models.length > 0,
        ),
    ) ?? [];
  const account = eligibleAccounts.find(
    (item) => item.binding?.id === bindingId && item.profileId === profileId,
  );
  const profile = page?.profiles.find(
    (profile) => profile.id === account?.profileId,
  );
  const models = profile?.models ?? [];
  const qualifiedSettings = profile?.connection?.modelSettings.find(
    (row) => row.modelId === model,
  );
  const showReasoning =
    !profile?.connection || qualifiedSettings?.reasoning != null;
  const showFast = gatewayModelSupportsFastMode(model, profile?.connection);
  const selectionValid = Boolean(
    account &&
    models.includes(model) &&
    gatewayModelSupportsReasoningEffort(
      model,
      reasoningEffort,
      profile?.connection,
    ) &&
    (!fastMode || showFast),
  );
  const unknown = results.some((result) => result.status === "unknown");
  const unavailableCount = selected.filter(
    (target) =>
      !inventory.some(
        (item) => item.repositoryId === target.repositoryId && item.eligible,
      ),
  ).length;
  const locked = busy || batch !== null;
  const allApplied =
    results.length > 0 &&
    results.every((result) => result.status === "applied");
  const setOperationLocked = selection?.setOperationLocked;

  useEffect(() => {
    setOperationLocked?.(locked);
    onLockedChange?.(locked);
    return () => setOperationLocked?.(false);
  }, [locked, onLockedChange, setOperationLocked]);

  function accept(request: GatewayBatchRequest, response: GatewayBatchResult) {
    // A missing/wrong scoped response stays unknown; it never becomes green.
    setResults(
      request.targets.map((target) => {
        const matches =
          response.operationId === request.operationId
            ? response.results.filter(
                (result) => result.repositoryId === target.repositoryId,
              )
            : [];
        return matches.length === 1
          ? matches[0]!
          : { repositoryId: target.repositoryId, status: "unknown" };
      }),
    );
  }
  async function apply() {
    if (
      inFlight.current ||
      locked ||
      !enabled ||
      !selected.length ||
      unavailableCount ||
      !selectionValid ||
      !account
    )
      return;
    inFlight.current = true;
    const selectionValue: GatewayBatchSelection = {
      kind: "codex",
      authMode: "codex_account_gateway",
      gatewayBindingId: bindingId,
      gatewayProfileRef: profileId,
      model,
      reasoningEffort,
      agenticContext,
      fastMode,
      requiredHealthy: true,
    };
    const request: GatewayBatchRequest = {
      workspaceId,
      operationId: crypto.randomUUID(),
      targets: selected.map((target) => ({ ...target })),
      selection: selectionValue,
    };
    setBatch(request);
    setBusy(true);
    setResults(
      request.targets.map((target) => ({
        repositoryId: target.repositoryId,
        status: "unknown",
      })),
    );
    try {
      accept(request, await actions.save(request));
    } catch {
      // Response loss can only read the same durable scoped operation. It cannot
      // regenerate a nonce or submit the save again, including on receipt absence.
      try {
        accept(request, await actions.read(request));
      } catch {
        /* Remain unknown. */
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
      selection?.refresh();
    }
  }
  async function readUnknown() {
    if (inFlight.current || !batch) return;
    inFlight.current = true;
    setBusy(true);
    const targets = batch.targets.filter((target) =>
      results.some(
        (result) =>
          result.repositoryId === target.repositoryId &&
          result.status === "unknown",
      ),
    );
    try {
      const response = await actions.read({ ...batch, targets });
      if (response.operationId === batch.operationId)
        setResults((prior) =>
          prior.map((result) => {
            if (result.status !== "unknown") return result;
            const matches = response.results.filter(
              (item) => item.repositoryId === result.repositoryId,
            );
            return matches.length === 1 ? matches[0]! : result;
          }),
        );
    } catch {
      /* Read failure does not authorize another save. */
    } finally {
      inFlight.current = false;
      setBusy(false);
      selection?.refresh();
    }
  }

  return (
    <section
      aria-label="Account gateway"
      className="grid gap-4 border-b border-cyan-200/10 pb-5"
    >
      <div>
        <h3 className="text-sm font-semibold text-cyan-50">
          Account gateway (server credentials)
        </h3>
        <p className="mt-1 text-sm leading-6 text-slate-400">
          Replaces the selected repositories’ provider list with one required
          healthy gateway provider and sets execution provider count,
          parallelism and agreement to 1. Existing repository overrides for
          blocking, language, comment/token limits and investigation settings
          are preserved; fields without an override continue inheriting the
          workspace policy. Existing admitted runs keep their pinned
          configuration.
        </p>
      </div>
      <RepositoryActionSelectionChooser disabled={!enabled} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Choice
          label="Gateway account"
          value={account ? bindingId : ""}
          disabled={locked || !enabled}
          options={eligibleAccounts.map((item) => ({
            value: item.binding!.id,
            label: `${item.label} · ${item.profileLabel}`,
          }))}
          onChange={(value) => {
            const chosen = eligibleAccounts.find(
              (item) => item.binding?.id === value,
            );
            if (!chosen) return;
            setBindingId(value);
            setProfileId(chosen.profileId);
            setModel("");
            setFastMode(false);
          }}
        />
        <Choice
          label="Gateway model"
          value={models.includes(model) ? model : ""}
          disabled={locked || !enabled || !account}
          options={models.map((value) => ({ value, label: value }))}
          onChange={(value) => {
            if (
              !gatewayModelSupportsReasoningEffort(
                value,
                reasoningEffort,
                profile?.connection,
              )
            )
              setReasoningEffort(
                gatewayModelDefaultReasoningEffort(value, profile?.connection),
              );
            if (!gatewayModelSupportsFastMode(value, profile?.connection))
              setFastMode(false);
            setModel(value);
          }}
        />
        {showReasoning ? (
          <Choice
            label="Reasoning effort"
            value={reasoningEffort ?? ""}
            disabled={locked || !enabled}
            options={(
              ["low", "medium", "high", "xhigh", "max", "ultra"] as const
            )
              .filter((value) =>
                gatewayModelSupportsReasoningEffort(
                  model,
                  value,
                  profile?.connection,
                ),
              )
              .map((value) => ({ value, label: value }))}
            onChange={(value) => {
              if (
                ["low", "medium", "high", "xhigh", "max", "ultra"].includes(
                  value,
                ) &&
                gatewayModelSupportsReasoningEffort(
                  model,
                  value,
                  profile?.connection,
                )
              )
                setReasoningEffort(
                  value as GatewayBatchSelection["reasoningEffort"],
                );
            }}
          />
        ) : null}
      </div>
      <div className="flex flex-wrap gap-4 text-sm text-slate-300">
        <label>
          <Checkbox
            checked={agenticContext}
            disabled={locked || !enabled}
            onChange={(event) => setAgenticContext(event.target.checked)}
            className="align-middle"
          />{" "}
          Agentic context
        </label>
        {showFast ? (
          <label>
            <Checkbox
              checked={fastMode}
              disabled={locked || !enabled}
              onChange={(event) => setFastMode(event.target.checked)}
              className="align-middle"
            />{" "}
            Fast mode
          </label>
        ) : null}
        <span>Required healthy: on</span>
      </div>
      {!page ? (
        <p className="text-sm text-amber-200">
          Gateway accounts are unavailable or access was denied.
        </p>
      ) : null}
      {page?.nextCursor ? (
        <p className="text-sm text-slate-400">
          Showing the first account page. Manage other accounts in Accounts.
        </p>
      ) : null}
      {bindingId && !selectionValid ? (
        <p role="status" className="text-sm text-amber-200">
          The chosen account or model is no longer eligible. Your repository
          selection is preserved.
        </p>
      ) : null}
      {unavailableCount ? (
        <p className="text-sm text-amber-200">
          {unavailableCount} selected repositories are currently unavailable.
          Selection is preserved; unselect them or refresh permissions.
        </p>
      ) : null}
      {selected
        .filter(
          (target) =>
            !inventory.some(
              (item) => item.repositoryId === target.repositoryId,
            ),
        )
        .map((target) => (
          <div
            key={target.repositoryId}
            className="flex flex-wrap items-center gap-3 text-sm text-amber-200"
          >
            <span>
              Selected repository {target.repositoryId} is no longer in the
              inventory.
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={locked || !enabled}
              onClick={() =>
                selection?.toggle({
                  repositoryId: target.repositoryId,
                  expectedVersion: target.expectedVersion,
                  fullName: target.repositoryId,
                  eligible: false,
                })
              }
            >
              Remove {target.repositoryId} from selection
            </Button>
          </div>
        ))}
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-slate-300">
          {selected.length} repositories selected
        </span>
        <Button
          type="button"
          size="sm"
          disabled={
            locked ||
            !enabled ||
            !selected.length ||
            !selectionValid ||
            unavailableCount > 0
          }
          onClick={() => {
            void apply();
          }}
        >
          Apply gateway configuration
        </Button>
        {!batch ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy || !selected.length}
            onClick={() => selection?.clear()}
          >
            Clear selection
          </Button>
        ) : null}
        {unknown ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => {
              void readUnknown();
            }}
          >
            Check saved operation
          </Button>
        ) : null}
        {batch && !busy && !unknown ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setBatch(null);
              setResults([]);
            }}
          >
            Finish viewing results
          </Button>
        ) : null}
      </div>
      {batch ? (
        <div
          aria-live="polite"
          role="status"
          className={allApplied ? "text-lime-200" : "text-amber-200"}
        >
          <p>
            {busy
              ? "Checking configuration results…"
              : allApplied
                ? "Applied to every selected repository."
                : "Batch has unapplied or unresolved targets. Review each result."}
          </p>
          <p className="break-all text-xs">Operation: {batch.operationId}</p>
          <ul className="mt-2 grid gap-1 text-sm">
            {results.map((result) => (
              <li key={result.repositoryId}>
                {inventory.find(
                  (item) => item.repositoryId === result.repositoryId,
                )?.fullName ?? result.repositoryId}
                : {result.status}
                {result.status === "applied"
                  ? ` (version ${result.version})`
                  : ""}
              </li>
            ))}
          </ul>
          {unknown ? (
            <p className="mt-2 text-sm">
              Unknown targets stay locked. Check this exact operation; absence
              of a receipt does not prove the save failed.
            </p>
          ) : null}
          {results.some((result) => result.status === "conflict") ? (
            <p className="mt-2 text-sm">
              Conflicts need fresh versions: finish viewing results, unselect
              and reselect those repositories before applying a new batch.
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

export function GatewayRepositoryBatchRefreshBoundary({
  workspaceId,
  inventory,
  enabled,
  children,
}: {
  readonly workspaceId: string;
  readonly inventory: readonly GatewayBatchInventoryItem[];
  readonly enabled: boolean;
  readonly children: ReactNode;
}): React.ReactElement {
  const router = useRouter();
  return (
    <RepositoryActionSelectionProvider
      workspaceId={workspaceId}
      inventory={inventory}
      disabled={!enabled}
      refresh={() => router.refresh()}
    >
      {children}
    </RepositoryActionSelectionProvider>
  );
}
