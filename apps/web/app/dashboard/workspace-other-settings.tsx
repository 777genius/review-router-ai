import type { ReactNode } from "react";
import { Checkbox } from "@reviewrouter/ui";
import { FormSubmitButton } from "../form-submit-button";
import { DashboardActionForm } from "./dashboard-action-form";
import {
  saveWorkspaceAccessRightsClientAction,
  saveWorkspaceOtherSettingsClientAction,
} from "./other-settings-actions";

/**
 * Dashboard -> Other: workspace-wide review settings and Access rights. Each
 * setting has its own form and action, so saving one never resets the other.
 * Only owners and admins change them; everyone else sees them disabled.
 */
export function WorkspaceOtherSettings({
  workspaceId,
  reviewDraftPullRequests,
  providerManagementAdminOnly,
  canEdit,
  mutationsEnabled = true,
}: {
  readonly workspaceId: string;
  readonly reviewDraftPullRequests: boolean;
  readonly providerManagementAdminOnly: boolean;
  /** The viewer may change these settings and changes are on. */
  readonly canEdit: boolean;
  readonly mutationsEnabled?: boolean;
}): React.ReactElement {
  const readOnlyText = mutationsEnabled
    ? "Only workspace owners and admins can change these settings."
    : "Changes are turned off for this dashboard.";
  return (
    <div className="grid">
      {/* A read-only viewer is told once why, instead of under each setting. */}
      {!canEdit ? (
        <p role="status" className="pt-2 text-sm text-slate-400">
          {readOnlyText}
        </p>
      ) : null}
      <OtherSettingsForm
        title="Reviews"
        formKey={`${workspaceId}:drafts:${reviewDraftPullRequests}`}
        workspaceId={workspaceId}
        action={saveWorkspaceOtherSettingsClientAction}
        submitLabel="Save settings"
        canEdit={canEdit}
      >
        <SettingCheckbox
          name="reviewDraftPullRequests"
          defaultChecked={reviewDraftPullRequests}
          disabled={!canEdit}
          label="Review draft pull requests"
          description="Automatically review draft pull requests in every repository in this workspace."
        />
      </OtherSettingsForm>
      <OtherSettingsForm
        title="Access rights"
        formKey={`${workspaceId}:access:${providerManagementAdminOnly}`}
        workspaceId={workspaceId}
        action={saveWorkspaceAccessRightsClientAction}
        submitLabel="Save access rights"
        canEdit={canEdit}
      >
        <SettingCheckbox
          name="providerManagementAdminOnly"
          defaultChecked={providerManagementAdminOnly}
          disabled={!canEdit}
          label="Only owners and admins manage providers"
          description="When on, other members cannot add, edit or remove providers, or choose a provider for a repository. Off by default: members who maintain a repository choose its provider, and whoever added a provider can edit it."
        />
      </OtherSettingsForm>
    </div>
  );
}

function OtherSettingsForm({
  title,
  formKey,
  workspaceId,
  action,
  submitLabel,
  canEdit,
  children,
}: {
  readonly title: string;
  readonly formKey: string;
  readonly workspaceId: string;
  readonly action: typeof saveWorkspaceOtherSettingsClientAction;
  readonly submitLabel: string;
  readonly canEdit: boolean;
  readonly children: ReactNode;
}): React.ReactElement {
  return (
    <section
      aria-label={title}
      className="grid gap-4 border-b border-cyan-200/10 py-5 last:border-b-0"
    >
      <h3 className="text-base font-semibold text-cyan-50">{title}</h3>
      <DashboardActionForm
        key={formKey}
        action={action}
        fallbackParams={{
          workspace: workspaceId,
          section: "other",
          error: "dashboard_action_failed",
        }}
        className="grid gap-4"
      >
        <input type="hidden" name="workspaceId" value={workspaceId} />
        {children}
        {canEdit ? (
          <div>
            <FormSubmitButton
              idleLabel={submitLabel}
              pendingLabel="Saving..."
            />
          </div>
        ) : null}
      </DashboardActionForm>
    </section>
  );
}

function SettingCheckbox({
  name,
  defaultChecked,
  disabled,
  label,
  description,
}: {
  readonly name: string;
  readonly defaultChecked: boolean;
  readonly disabled: boolean;
  readonly label: string;
  readonly description: string;
}): React.ReactElement {
  return (
    <label className="flex items-start gap-3">
      <Checkbox
        name={name}
        defaultChecked={defaultChecked}
        disabled={disabled}
        className="mt-0.5"
      />
      <span>
        <span className="block text-sm font-semibold text-cyan-50">
          {label}
        </span>
        <span className="mt-1 block max-w-2xl text-sm leading-6 text-slate-400">
          {description}
        </span>
      </span>
    </label>
  );
}
