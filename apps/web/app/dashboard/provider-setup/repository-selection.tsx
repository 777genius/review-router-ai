"use client";

import { Checkbox } from "@reviewrouter/ui";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  ProviderSetupDialog,
  type ProviderSetupDialogProps,
} from "./provider-setup-dialog";

/** A repository row the table can select for a bulk provider change. */
export type SelectableRepository = Readonly<{
  id: string;
  fullName: string;
  /** Its settings can be changed now (selected, not archived, writable). */
  eligible: boolean;
}>;

type RepositorySelection = Readonly<{
  inventory: ReadonlyMap<string, SelectableRepository>;
  selected: readonly string[];
  toggle: (repositoryId: string) => void;
  clear: () => void;
  limit: number;
}>;

const RepositorySelectionContext = createContext<RepositorySelection | null>(
  null,
);

/**
 * Table-wide selection of repositories for "Configure providers". The
 * selection resets when the workspace or its repositories change.
 */
export function RepositorySelectionProvider({
  workspaceId,
  repositories,
  limit,
  children,
}: {
  readonly workspaceId: string;
  readonly repositories: readonly SelectableRepository[];
  /** The most repositories one dialog may target. */
  readonly limit: number;
  readonly children: ReactNode;
}): React.ReactElement {
  const inventory = useMemo(
    () =>
      new Map(repositories.map((repository) => [repository.id, repository])),
    [repositories],
  );
  const [selected, setSelected] = useState<readonly string[]>([]);
  useEffect(() => setSelected([]), [workspaceId]);
  // A repository that disappeared or became ineligible leaves the selection.
  useEffect(
    () =>
      setSelected((current) =>
        current.filter((id) => inventory.get(id)?.eligible === true),
      ),
    [inventory],
  );
  const toggle = useCallback(
    (repositoryId: string) =>
      setSelected((current) =>
        current.includes(repositoryId)
          ? current.filter((id) => id !== repositoryId)
          : inventory.get(repositoryId)?.eligible && current.length < limit
            ? [...current, repositoryId]
            : current,
      ),
    [inventory, limit],
  );
  const clear = useCallback(() => setSelected([]), []);
  const value = useMemo(
    () => ({ inventory, selected, toggle, clear, limit }),
    [inventory, selected, toggle, clear, limit],
  );
  return (
    <RepositorySelectionContext.Provider value={value}>
      {children}
    </RepositorySelectionContext.Provider>
  );
}

/** The selection checkbox of one repository row. */
export function RepositorySelectionCheckbox({
  repositoryId,
}: {
  readonly repositoryId: string;
}): React.ReactElement | null {
  const selection = useContext(RepositorySelectionContext);
  const repository = selection?.inventory.get(repositoryId);
  if (!selection || !repository) return null;
  const checked = selection.selected.includes(repositoryId);
  return (
    <span
      data-ignore-repository-row-toggle
      className="flex min-h-[3.25rem] items-start justify-center pt-3.5"
    >
      <Checkbox
        checked={checked}
        aria-label={`Select ${repository.fullName}`}
        title={
          repository.eligible
            ? `Select ${repository.fullName}`
            : `${repository.fullName} cannot be changed now`
        }
        disabled={
          !checked &&
          (!repository.eligible || selection.selected.length >= selection.limit)
        }
        onChange={() => selection.toggle(repositoryId)}
      />
    </span>
  );
}

/**
 * "Configure providers" for the selected repositories: the provider dialog
 * with those repositories as its fixed target.
 */
export function BulkProviderSetupAction(
  props: Omit<
    ProviderSetupDialogProps,
    "target" | "triggerLabel" | "triggerDisabled" | "onSaved"
  >,
): React.ReactElement | null {
  const selection = useContext(RepositorySelectionContext);
  if (!selection) return null;
  const repositories = selection.selected.flatMap((id) => {
    const repository = selection.inventory.get(id);
    return repository
      ? [{ id: repository.id, fullName: repository.fullName }]
      : [];
  });
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="text-xs text-slate-400" aria-live="polite">
        {repositories.length === 0
          ? "Select repositories to change their provider together."
          : `${repositories.length} selected`}
      </span>
      {repositories.length > 0 ? (
        <button
          type="button"
          onClick={selection.clear}
          className="text-xs font-semibold text-cyan-200 transition hover:text-cyan-50"
        >
          Clear
        </button>
      ) : null}
      <ProviderSetupDialog
        {...props}
        target={{ kind: "repositories", repositories }}
        triggerLabel="Configure providers"
        triggerDisabled={repositories.length === 0}
        onSaved={selection.clear}
      />
    </div>
  );
}
