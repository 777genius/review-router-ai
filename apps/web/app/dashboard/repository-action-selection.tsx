"use client";

import { Button, Checkbox } from "@reviewrouter/ui";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type RepositorySelectionItem = {
  readonly repositoryId: string;
  readonly fullName: string;
  readonly available: boolean;
};
type Selection = {
  readonly ids: readonly string[];
  readonly inventory: readonly RepositorySelectionItem[];
  readonly locked: boolean;
  readonly toggle: (id: string) => void;
  readonly selectMany: (ids: readonly string[]) => void;
  readonly clear: () => void;
  readonly refresh: () => void;
  readonly setOperationLocked: (locked: boolean) => void;
};
const Context = createContext<Selection | null>(null);
export const useRepositorySelection = () => useContext(Context);

/** Shared exact-ID selection. Action-specific limits and versions belong to adapters. */
export function RepositorySelectionProvider({
  workspaceId,
  inventory,
  disabled = false,
  refresh,
  children,
}: {
  readonly workspaceId: string;
  readonly inventory: readonly RepositorySelectionItem[];
  readonly disabled?: boolean;
  readonly refresh: () => void;
  readonly children: ReactNode;
}): React.ReactElement {
  const [ids, setIds] = useState<readonly string[]>([]);
  const [operationLocked, setOperationLocked] = useState(false);
  useEffect(() => {
    setIds([]);
    setOperationLocked(false);
  }, [workspaceId]);
  const locked = disabled || operationLocked;
  const available = useMemo(
    () =>
      new Set(
        inventory
          .filter((item) => item.available)
          .map((item) => item.repositoryId),
      ),
    [inventory],
  );
  const toggle = useCallback(
    (id: string) => {
      if (locked) return;
      setIds((prior) =>
        prior.includes(id)
          ? prior.filter((value) => value !== id)
          : available.has(id)
            ? [...prior, id]
            : prior,
      );
    },
    [locked, available],
  );
  const selectMany = useCallback(
    (nextIds: readonly string[]) => {
      if (!locked)
        setIds((prior) => [
          ...new Set([...prior, ...nextIds.filter((id) => available.has(id))]),
        ]);
    },
    [locked, available],
  );
  const clear = useCallback(() => {
    if (!locked) setIds([]);
  }, [locked]);
  return (
    <Context.Provider
      value={{
        ids,
        inventory,
        locked,
        toggle,
        selectMany,
        clear,
        refresh,
        setOperationLocked,
      }}
    >
      {children}
    </Context.Provider>
  );
}

export function RepositorySelectionCheckbox({
  repositoryId,
}: {
  readonly repositoryId: string;
}): React.ReactElement | null {
  const selection = useRepositorySelection();
  const item = selection?.inventory.find(
    (row) => row.repositoryId === repositoryId,
  );
  if (!selection || !item) return null;
  const checked = selection.ids.includes(repositoryId);
  return (
    <div
      className="flex h-full min-h-[3.25rem] items-start justify-center pt-3"
      onClick={(event) => event.stopPropagation()}
    >
      <Checkbox
        checked={checked}
        aria-label={`Select ${item.fullName}`}
        title={
          item.available
            ? `Select ${item.fullName}`
            : `${item.fullName} is currently unavailable`
        }
        disabled={selection.locked || (!checked && !item.available)}
        onChange={() => selection.toggle(repositoryId)}
      />
    </div>
  );
}

export function RepositorySelectionToolbar({
  matchingIds,
}: {
  readonly matchingIds: readonly string[];
}): React.ReactElement | null {
  const selection = useRepositorySelection();
  if (!selection) return null;
  const matching = new Set(matchingIds);
  const hidden = selection.ids.filter((id) => !matching.has(id)).length;
  return (
    <div
      className="flex flex-wrap items-center gap-3 border-b border-cyan-200/10 px-4 py-3 text-sm"
      aria-label="Repository selection"
    >
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={selection.locked || matchingIds.length === 0}
        onClick={() => selection.selectMany(matchingIds)}
      >
        Select all {matchingIds.length} matching
      </Button>
      <span aria-live="polite" className="text-slate-400">
        {selection.ids.length} selected
        {hidden ? ` · ${hidden} outside current search` : ""}
      </span>
      {selection.ids.length > 0 ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={selection.locked}
          onClick={selection.clear}
        >
          Clear selection
        </Button>
      ) : null}
    </div>
  );
}
