import { Checkbox } from "@reviewrouter/ui";
import { FormSubmitButton } from "../form-submit-button";
import { DashboardActionForm } from "./dashboard-action-form";
import { saveWorkspaceOtherSettingsClientAction } from "./other-settings-actions";

export function WorkspaceOtherSettings({
  workspaceId,
  reviewDraftPullRequests,
  canEdit,
}: {
  readonly workspaceId: string;
  readonly reviewDraftPullRequests: boolean;
  readonly canEdit: boolean;
}): React.ReactElement {
  return (
    <section className="py-5">
      <DashboardActionForm
        key={`${workspaceId}:${reviewDraftPullRequests}`}
        action={saveWorkspaceOtherSettingsClientAction}
        fallbackParams={{
          workspace: workspaceId,
          section: "other",
          error: "dashboard_action_failed",
        }}
        className="grid gap-5"
      >
        <input type="hidden" name="workspaceId" value={workspaceId} />
        <label className="flex items-start gap-3 border-b border-cyan-200/10 pb-5">
          <Checkbox
            name="reviewDraftPullRequests"
            defaultChecked={reviewDraftPullRequests}
            disabled={!canEdit}
          />
          <span>
            <span className="block text-sm font-semibold text-cyan-50">
              Review draft pull requests
            </span>
            <span className="mt-1 block text-sm leading-6 text-slate-400">
              Automatically review draft pull requests in every repository in
              this workspace.
            </span>
          </span>
        </label>
        {!canEdit ? (
          <p className="text-sm text-slate-400">
            Only workspace owners and admins can change these settings.
          </p>
        ) : null}
        <div>
          <FormSubmitButton
            idleLabel="Save settings"
            pendingLabel="Saving..."
            disabled={!canEdit}
          />
        </div>
      </DashboardActionForm>
    </section>
  );
}
