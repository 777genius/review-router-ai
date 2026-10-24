"use client";

import { useId } from "react";
import { repositoryCountLabel } from "../../../src/features/provider-setup/provider-setup-model";
import { useRepositorySelection } from "../repository-action-selection";
import {
  ProviderSetupDialog,
  type ProviderSetupDialogProps,
} from "./provider-setup-dialog";

/**
 * "Configure providers" for the repositories selected in the table: the
 * provider dialog with those repositories as its fixed target. The selection
 * is shared with the table's other bulk actions, so this action applies its
 * own limit and refuses repositories whose settings the viewer cannot change.
 */
export function BulkProviderSetupAction({
  editableRepositoryIds,
  limit,
  ...props
}: Omit<
  ProviderSetupDialogProps,
  | "target"
  | "triggerLabel"
  | "triggerDisabled"
  | "triggerTitle"
  | "triggerDescribedBy"
  | "onSaved"
> & {
  /** Repositories whose settings the viewer can change now. */
  readonly editableRepositoryIds: readonly string[];
  /** The most repositories one dialog may target. */
  readonly limit: number;
}): React.ReactElement | null {
  const reasonId = useId();
  const selection = useRepositorySelection();
  if (!selection) return null;
  // The shared selection only holds repositories of its inventory.
  const repositories = selection.ids.flatMap((id) => {
    const item = selection.inventory.find((row) => row.repositoryId === id);
    return item ? [{ id: item.repositoryId, fullName: item.fullName }] : [];
  });
  const locked = repositories.filter(
    (repository) => !editableRepositoryIds.includes(repository.id),
  ).length;
  const reason =
    repositories.length > limit
      ? `Up to ${repositoryCountLabel(limit)} per change.`
      : locked > 0
        ? `${repositoryCountLabel(locked)} of the selection cannot be changed now.`
        : null;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <ProviderSetupDialog
        {...props}
        target={{ kind: "repositories", repositories }}
        triggerLabel="Configure providers"
        triggerDisabled={
          repositories.length === 0 || reason !== null || selection.locked
        }
        {...(reason
          ? { triggerTitle: reason, triggerDescribedBy: reasonId }
          : {})}
        onSaved={selection.clear}
      />
      {reason ? (
        <span id={reasonId} className="text-xs text-slate-400">
          {reason}
        </span>
      ) : null}
    </div>
  );
}
