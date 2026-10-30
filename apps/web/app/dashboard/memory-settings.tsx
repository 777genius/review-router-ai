import { Checkbox } from "@reviewrouter/ui";
import { FormSubmitButton } from "../form-submit-button";
import { DashboardActionForm } from "./dashboard-action-form";
import { saveWorkspaceMemorySettingsClientAction } from "./memory-settings-actions";

/** One workspace setting; repository navigation never narrows its effect. */
export function MemorySettings({
  workspaceId,
  requireConfirmation,
  version,
  canEdit,
  mutationsEnabled,
}: {
  readonly workspaceId: string;
  readonly requireConfirmation: boolean;
  readonly version: number | null;
  readonly canEdit: boolean;
  readonly mutationsEnabled: boolean;
}): React.ReactElement {
  return (
    <section
      aria-labelledby="memory-settings-title"
      className="mx-auto grid w-full max-w-5xl gap-4 border-t border-white/10 py-6"
    >
      <h2
        id="memory-settings-title"
        className="text-lg font-semibold text-slate-100"
      >
        Settings
      </h2>
      <DashboardActionForm
        key={`${workspaceId}:${version ?? "new"}:${requireConfirmation}`}
        action={saveWorkspaceMemorySettingsClientAction}
        fallbackParams={{
          workspace: workspaceId,
          section: "memory",
          error: "dashboard_action_failed",
        }}
        className="grid gap-4"
      >
        <input type="hidden" name="workspaceId" value={workspaceId} />
        <input type="hidden" name="expectedVersion" value={version ?? ""} />
        <label className="flex items-start gap-3">
          <Checkbox
            name="requireConfirmation"
            defaultChecked={requireConfirmation}
            disabled={!canEdit}
            className="mt-0.5"
          />
          <span>
            <span className="block text-sm font-semibold text-slate-100">
              Require confirmation for memory changes
            </span>
            <span className="mt-1 block max-w-2xl text-sm leading-6 text-slate-400">
              When off, ReviewRouter applies permitted memory changes
              automatically from review discussions. When on, proposed changes
              need a maintainer’s confirmation. This setting applies to every
              repository in this workspace.
            </span>
          </span>
        </label>
        {canEdit ? (
          <div>
            <FormSubmitButton
              idleLabel="Save memory settings"
              pendingLabel="Saving..."
            />
          </div>
        ) : (
          <p role="status" className="text-sm text-slate-400">
            {mutationsEnabled
              ? "Only workspace owners and admins can change memory settings."
              : "Changes are turned off for this dashboard."}
          </p>
        )}
      </DashboardActionForm>
    </section>
  );
}
