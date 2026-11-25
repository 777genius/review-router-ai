import { Badge, LinkButton, SelectField } from "@reviewrouter/ui";
import {
  defaultOrgRulesetSourceRepositoryName,
  type OrgRulesetProvisioningRecord,
} from "@reviewrouter/features-org-ruleset-provisioning";
import {
  dashboardWorkspaceUrlKey,
  type DashboardWorkspace,
} from "./dashboard-workspace-navigation";
import { dashboardSectionHref } from "./dashboard-section";
import {
  buildInstallationSettingsUrl,
  orgRulesetErrorText,
  orgRulesetStatusTone,
} from "./dashboard-copy";
import { safeGitHubDashboardLink } from "../../src/server/safe-dashboard-link";
import { DashboardActionForm } from "./dashboard-action-form";
import { enableOrgRulesetWorkflowClientAction } from "./actions";
import { FormSubmitButton } from "../form-submit-button";
import { GitHubAppInstallPermissionDialog } from "../github-app-install-permission-dialog";

// Presentational server component; authorization remains in the existing Server Action.
export function OrgRulesetAdvancedCard({
  workspace,
  orgRuleset,
  mutationsEnabled,
  appInstallUrl,
  permissionUpgradeNeeded,
}: {
  readonly workspace: DashboardWorkspace;
  readonly orgRuleset: Pick<
    OrgRulesetProvisioningRecord,
    "scope" | "enforcement" | "status" | "safeErrorCode" | "rulesetUrl"
  > | null;
  readonly mutationsEnabled: boolean;
  readonly appInstallUrl: string | null;
  readonly permissionUpgradeNeeded: boolean;
}): React.ReactElement | null {
  const organizationInstallation = workspace.installations.find(
    (installation) => installation.accountType === "Organization",
  );
  if (!organizationInstallation) {
    return null;
  }

  const rulesetsUnsupported =
    orgRuleset?.safeErrorCode === "org_rulesets_not_supported";
  const organizationPlanName =
    organizationInstallation.organizationSecretPolicy?.planName ?? null;
  const rulesetsUnavailableByPlan = organizationPlanName === "free";
  const permissionMissing =
    permissionUpgradeNeeded ||
    orgRuleset?.safeErrorCode === "org_admin_permission_required" ||
    orgRuleset?.safeErrorCode === "org_ruleset_permission_update_pending";
  const rulesetUrl = safeGitHubDashboardLink(orgRuleset?.rulesetUrl ?? "");
  const permissionApprovalUrl =
    buildInstallationSettingsUrl(organizationInstallation) ?? appInstallUrl;
  const sourceRepositoryFullName = `${organizationInstallation.accountLogin}/${defaultOrgRulesetSourceRepositoryName}`;

  return (
    <details className="rounded-[1.5rem] border border-amber-300/20 bg-amber-300/[0.08] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]">
      <summary className="cursor-pointer list-none">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
          <div>
            <Badge tone={rulesetsUnavailableByPlan ? "neutral" : "warning"}>
              {rulesetsUnavailableByPlan
                ? "Plan upgrade required"
                : "Advanced org-wide mode"}
            </Badge>
            <p className="mt-2 text-sm leading-6 text-amber-50">
              Enable a GitHub Organization Ruleset required workflow for many
              repositories without opening setup PRs in every repo. Default
              onboarding stays per-repository setup PR.
            </p>
          </div>
          <Badge
            tone={
              rulesetsUnavailableByPlan
                ? "neutral"
                : orgRulesetStatusTone(orgRuleset?.status)
            }
          >
            {rulesetsUnavailableByPlan
              ? "unavailable"
              : orgRuleset?.status
                ? orgRuleset.status.replaceAll("_", " ")
                : "not enabled"}
          </Badge>
        </div>
      </summary>

      <div className="mt-5 grid gap-4">
        <div className="rounded-2xl border border-amber-200/15 bg-slate-950/70 p-4 text-sm leading-6 text-slate-300">
          <p>
            This advanced mode requires GitHub App{" "}
            <strong className="text-amber-100">
              Organization Administration: write
            </strong>{" "}
            only to create/update the ReviewRouter ruleset and its central
            workflow. Provider secrets still stay in GitHub Actions, not in
            ReviewRouter SaaS.
          </p>
          {rulesetsUnavailableByPlan ? (
            <div className="mt-4 rounded-xl border border-cyan-200/15 bg-cyan-300/[0.06] p-4 text-cyan-50">
              <p className="font-semibold">
                Organization-wide required workflows are not available on the
                current GitHub Free plan.
              </p>
              <p className="mt-2 text-slate-300">
                GitHub requires a paid organization plan, Team or Enterprise, to
                use organization rulesets for private repositories. Until this
                organization is upgraded, use per-repository setup PRs from the
                repositories list. After the upgrade, create{" "}
                <strong className="text-cyan-100">
                  {sourceRepositoryFullName}
                </strong>{" "}
                and enable org-wide mode here.
              </p>
              <LinkButton
                href={dashboardSectionHref(
                  "repositories",
                  dashboardWorkspaceUrlKey(workspace),
                )}
                variant="outline"
                size="sm"
                className="mt-3"
              >
                Open repositories
              </LinkButton>
            </div>
          ) : (
            <div className="mt-3 text-slate-300">
              <p>Manual source setup before enabling org-wide mode:</p>
              <ol className="mt-2 list-decimal space-y-1 pl-5">
                <li>
                  Create the private source repository{" "}
                  <strong className="text-amber-100">
                    {sourceRepositoryFullName}
                  </strong>
                  .
                </li>
                <li>
                  In that repository, open Settings - Actions - General - Access
                  and choose Accessible from repositories in{" "}
                  <strong className="text-amber-100">
                    {organizationInstallation.accountLogin}
                  </strong>{" "}
                  organization.
                </li>
                <li>
                  Make sure the ReviewRouter GitHub App installation includes
                  that source repository.
                </li>
              </ol>
            </div>
          )}
          {rulesetsUnsupported ? (
            <p className="mt-3 text-amber-100">
              GitHub accepted the App permissions, but this organization plan
              does not expose Organization Rulesets through the API. Use the
              per-repository setup PR fallback unless the organization is
              upgraded to a plan that supports rulesets.
            </p>
          ) : permissionMissing ? (
            <p className="mt-3 text-amber-100">
              GitHub did not allow ruleset access. Usually this means the
              optional Organization Administration permission still needs
              approval; if it is already approved, the organization plan may not
              support rulesets. Use the setup PR fallback when rulesets are not
              available.
            </p>
          ) : null}
          {orgRuleset?.safeErrorCode ? (
            <p className="mt-3 text-amber-100">
              Last status: {orgRulesetErrorText(orgRuleset.safeErrorCode)}
            </p>
          ) : null}
          {rulesetUrl ? (
            <a
              href={rulesetUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-flex text-cyan-100 underline decoration-cyan-300/50 underline-offset-4"
            >
              Open GitHub ruleset
            </a>
          ) : null}
        </div>

        {rulesetsUnavailableByPlan ? null : (
          <div className="rounded-2xl border border-amber-200/10 bg-slate-950/55 p-4">
            <DashboardActionForm
              action={enableOrgRulesetWorkflowClientAction}
              fallbackParams={{
                error: "dashboard_action_failed",
                workspace: workspace.id,
                section: "repositories",
              }}
              className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-[minmax(0,18rem)_minmax(0,18rem)_auto] 2xl:items-end"
            >
              <input type="hidden" name="workspaceId" value={workspace.id} />
              <input
                type="hidden"
                name="githubInstallationId"
                value={organizationInstallation.githubInstallationId}
              />
              <SelectField
                name="scope"
                label="Repository scope"
                defaultValue={orgRuleset?.scope ?? "selected_repositories"}
                disabled={!mutationsEnabled}
                options={[
                  {
                    value: "selected_repositories",
                    label: "Selected App repos",
                    description:
                      "Safer default, matches App repository access.",
                  },
                  {
                    value: "all_repositories",
                    label: "All organization repos",
                    description:
                      "Advanced, ruleset applies broadly where GitHub allows it.",
                  },
                ]}
              />
              <SelectField
                name="enforcement"
                label="Ruleset enforcement"
                defaultValue={orgRuleset?.enforcement ?? "evaluate"}
                disabled={!mutationsEnabled}
                options={[
                  {
                    value: "evaluate",
                    label: "Evaluate first",
                    description:
                      "Non-blocking smoke mode. GitHub Enterprise only.",
                  },
                  {
                    value: "active",
                    label: "Active",
                    description:
                      "Blocks according to GitHub required workflow.",
                  },
                ]}
              />
              <div className="flex items-end">
                <FormSubmitButton
                  variant="soft"
                  tone="warning"
                  className="w-full whitespace-nowrap"
                  disabled={
                    !mutationsEnabled ||
                    organizationInstallation.status !== "active" ||
                    orgRuleset?.status === "processing" ||
                    rulesetsUnsupported
                  }
                  idleLabel={orgRuleset ? "Update org-wide" : "Enable org-wide"}
                  pendingLabel="Checking permission..."
                />
              </div>
            </DashboardActionForm>

            <div className="mt-4 flex flex-wrap gap-2 border-t border-amber-200/10 pt-4">
              {permissionMissing && permissionApprovalUrl ? (
                <GitHubAppInstallPermissionDialog
                  href={permissionApprovalUrl}
                  variant="outline"
                  size="sm"
                  continueLabel="Continue to GitHub permissions"
                >
                  Review App permissions
                </GitHubAppInstallPermissionDialog>
              ) : null}
              <LinkButton
                href={dashboardSectionHref(
                  "repositories",
                  dashboardWorkspaceUrlKey(workspace),
                )}
                variant="ghost"
                size="sm"
              >
                Use setup PR fallback
              </LinkButton>
            </div>
          </div>
        )}
      </div>
    </details>
  );
}
