"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button, LinkButton } from "@reviewrouter/ui";
import type { ProviderAuthMode } from "@reviewrouter/features-review-providers";
import type { ReviewRuntimeCompatibility } from "@reviewrouter/features-provider-setup";
import type { GatewayReviewV2ProvisioningResult } from "@reviewrouter/features-workflow-provisioning";
import { ActionToast } from "../action-toast";
import {
  RepositorySetupActionButton,
  RepositorySetupMergedButton,
} from "./repository-setup-action-button";
import {
  dashboardErrorText as sharedDashboardErrorText,
  dashboardNoticeText,
} from "./dashboard-copy";
import {
  providerSetupConfirmedEventName,
  setupPullRequestMergedEvent,
  setupPullRequestMergedEventName,
  type ProviderSetupConfirmedEventDetail,
  type SetupPullRequestMergedEventDetail,
} from "./repository-setup-optimistic-events";
import {
  hasCompletedWorkflowSetup,
  repositorySetupScopeKey,
  setupStepNumber,
  runtimeQualifiedSetupStep,
  type SetupStep,
} from "./repository-setup-optimistic-status";

type SetupToast = {
  readonly tone: "success" | "danger" | "warning";
  readonly title: string;
  readonly body: string;
  readonly errorCode?: string;
  readonly actionUrl?: string;
  readonly actionLabel?: string;
};

type SetupIssue =
  | "setup_pr_closed"
  | "setup_pr_branch_deleted"
  | "setup_pr_wrong_base_branch"
  | "setup_pr_workflow_mismatch";

export function RepositorySetupProgressPanel({
  workspaceId,
  repositoryId,
  repositoryFullName,
  selected,
  archived,
  initialSetupStatus,
  initialSetupPullRequestUrl,
  initialSetupIssue,
  workflowCurrent,
  runtimeCompatibility = "compatible",
  mutationsEnabled,
  initialStep,
  expectedProviderAuthModes = [],
  providerLine,
  enableReviewAction,
  providerSetupBeforeWorkflow = false,
  gatewayReviewV2Readiness,
}: {
  readonly workspaceId: string;
  readonly repositoryId: string;
  readonly repositoryFullName: string;
  readonly selected: boolean;
  readonly archived: boolean;
  readonly initialSetupStatus: string;
  readonly initialSetupPullRequestUrl: string | null;
  readonly initialSetupIssue?: string | null;
  readonly workflowCurrent: boolean;
  readonly runtimeCompatibility?: ReviewRuntimeCompatibility;
  readonly mutationsEnabled: boolean;
  readonly initialStep: SetupStep;
  readonly expectedProviderAuthModes?: readonly ProviderAuthMode[];
  /** "Provider: X · Change" above the steps. */
  readonly providerLine?: ReactNode;
  readonly enableReviewAction?: ReactNode;
  readonly providerSetupBeforeWorkflow?: boolean;
  readonly gatewayReviewV2Readiness?:
    | GatewayReviewV2ProvisioningResult
    | undefined;
}): React.ReactElement {
  const router = useRouter();
  const scopeKey = repositorySetupScopeKey(
    repositoryId,
    expectedProviderAuthModes,
  );
  const [optimisticScopeKey, setOptimisticScopeKey] = useState(scopeKey);
  const [setupStatus, setSetupStatus] = useState(initialSetupStatus);
  const [setupPullRequestUrl, setSetupPullRequestUrl] = useState(
    initialSetupPullRequestUrl,
  );
  const [setupIssue, setSetupIssue] = useState<SetupIssue | null>(
    normalizeSetupIssue(initialSetupIssue),
  );
  const [currentStep, setCurrentStep] = useState(initialStep);
  const optimisticProviderAuthModesRef = useRef(new Set<ProviderAuthMode>());
  const [toast, setToast] = useState<SetupToast | null>(null);
  const canManage = mutationsEnabled && selected && !archived;
  const runtimeMigrationUpdate =
    runtimeCompatibility === "update_required" &&
    expectedProviderAuthModes.includes("codex_subscription_oauth_rotating");
  const runtimeVerificationNeeded =
    runtimeCompatibility === "unknown" && setupStatus === "configured";
  const gatewayBlocked =
    expectedProviderAuthModes.includes("codex_account_gateway") &&
    gatewayReviewV2Readiness?.status !== "ready";
  // Never render the previous scope's optimistic progress before its effect resets.
  const scopedStep =
    optimisticScopeKey === scopeKey ? currentStep : initialStep;
  const displayStep = runtimeQualifiedSetupStep(
    gatewayBlocked && scopedStep === "ready" ? "provider" : scopedStep,
    initialStep,
    runtimeCompatibility,
  );

  useEffect(() => {
    optimisticProviderAuthModesRef.current = new Set();
    setOptimisticScopeKey(scopeKey);
    setSetupStatus(initialSetupStatus);
    setSetupPullRequestUrl(initialSetupPullRequestUrl);
    setSetupIssue(normalizeSetupIssue(initialSetupIssue));
    setCurrentStep(initialStep);
    if (setupStepNumber[initialStep] > setupStepNumber.merge_setup_pr) {
      setToast((current) =>
        current?.errorCode === "setup_pr_not_merged" ? null : current,
      );
    }
  }, [
    initialSetupIssue,
    initialSetupPullRequestUrl,
    initialSetupStatus,
    initialStep,
    scopeKey,
  ]);

  useEffect(() => {
    function handleSetupPullRequestMerged(event: Event): void {
      const detail = (event as CustomEvent<SetupPullRequestMergedEventDetail>)
        .detail;
      if (detail?.repositoryId !== repositoryId) return;

      setSetupStatus("configured");
      setSetupIssue(null);
      setCurrentStep((current) =>
        setupStepNumber[current] < setupStepNumber.provider
          ? "provider"
          : current,
      );
    }

    function handleProviderSetupConfirmed(event: Event): void {
      const detail = (event as CustomEvent<ProviderSetupConfirmedEventDetail>)
        .detail;
      if (detail?.repositoryId !== repositoryId) return;
      if (
        !providerSetupConfirmationMatchesAnyExpectedAuthMode(
          detail,
          expectedProviderAuthModes,
        )
      ) {
        return;
      }

      if (detail.authMode !== undefined) {
        optimisticProviderAuthModesRef.current.add(detail.authMode);
      }
      router.refresh();
      if (
        !providerSetupConfirmationsComplete(
          optimisticProviderAuthModesRef.current,
          expectedProviderAuthModes,
        )
      ) {
        return;
      }

      // Only workflow confirmation can clear a pending workflow or its issue.
      // Use the effective step so a preceding merge event counts immediately.
      if (!gatewayBlocked)
        setCurrentStep((current) =>
          hasCompletedWorkflowSetup(current) ? "ready" : current,
        );
    }

    window.addEventListener(
      setupPullRequestMergedEventName,
      handleSetupPullRequestMerged,
    );
    window.addEventListener(
      providerSetupConfirmedEventName,
      handleProviderSetupConfirmed,
    );
    return () => {
      window.removeEventListener(
        setupPullRequestMergedEventName,
        handleSetupPullRequestMerged,
      );
      window.removeEventListener(
        providerSetupConfirmedEventName,
        handleProviderSetupConfirmed,
      );
    };
  }, [expectedProviderAuthModes, repositoryId, router, gatewayBlocked]);

  const handleSetupMutation = (params: Record<string, string>) => {
    clearTransientDashboardUrlParams("repositories");

    if (params.error) {
      const issue = normalizeSetupIssue(params.error);
      if (issue) {
        setSetupStatus("needs_attention");
        setSetupIssue(issue);
        setCurrentStep("setup_pr");
        router.refresh();
      }
      setToast({
        tone: "danger",
        title: issue ? "Setup PR needs recovery" : "Action needs attention",
        body: dashboardErrorText(params.error),
        errorCode: params.error,
      });
      return;
    }

    if (params.notice?.startsWith("runtime_migration_")) {
      setToast({
        tone: "warning",
        title: "Runtime update",
        body: dashboardNoticeText(
          params.notice,
          params.repository || repositoryFullName,
        ),
        ...(params.pr
          ? { actionUrl: params.pr, actionLabel: "Open first update PR" }
          : {}),
      });
      openOnce(params.pr);
      router.refresh();
      return;
    }

    if (params.notice === "setup_pr_ready") {
      const pullRequestUrl = params.pr || setupPullRequestUrl || undefined;
      setSetupStatus("setup_pr_open");
      setSetupPullRequestUrl(pullRequestUrl ?? null);
      setSetupIssue(null);
      setCurrentStep("merge_setup_pr");
      setToast({
        tone: "success",
        title: "Setup PR ready",
        body: `Setup PR is ready for ${params.repository || repositoryFullName}.`,
        ...(pullRequestUrl ? { actionUrl: pullRequestUrl } : {}),
        actionLabel: "Open setup PR",
      });
      openOnce(pullRequestUrl);
      return;
    }

    if (params.notice === "workflow_already_current") {
      setSetupStatus("configured");
      setSetupIssue(null);
      setCurrentStep("provider");
      router.refresh();
      setToast({
        tone: "success",
        title: "Workflow installed",
        body: `ReviewRouter workflow is already current for ${
          params.repository || repositoryFullName
        }.`,
      });
      return;
    }
  };

  const handleMergeMutation = (params: Record<string, string>) => {
    clearTransientDashboardUrlParams("repositories");

    if (params.error) {
      const issue = normalizeSetupIssue(params.error);
      if (issue) {
        setSetupStatus("needs_attention");
        setSetupIssue(issue);
        setCurrentStep("setup_pr");
        router.refresh();
      }
      setToast({
        tone: "danger",
        title: issue ? "Setup PR needs recovery" : "Action needs attention",
        body: dashboardErrorText(params.error),
        errorCode: params.error,
      });
      return;
    }

    if (params.notice === "setup_pr_merged") {
      setSetupStatus("configured");
      setSetupIssue(null);
      setCurrentStep("provider");
      window.dispatchEvent(setupPullRequestMergedEvent({ repositoryId }));
      router.refresh();
      setToast({
        tone: "success",
        title: "Setup PR merged",
        body: `Setup PR merge was confirmed for ${
          params.repository || repositoryFullName
        }.`,
      });
    }
  };

  // Provisioning can fail for reasons outside the setup-PR family (an untrusted
  // legacy workflow, a rejected provider enrollment). They reach the card as
  // `errorMessage` but are not recovery issues, so without this the card shows a
  // neutral "add the workflow by PR" hint on a repository that cannot proceed.
  const setupIssueGuidance =
    displayStep === "setup_pr" &&
    setupIssue === null &&
    normalizeSetupIssue(initialSetupIssue) === null &&
    typeof initialSetupIssue === "string" &&
    initialSetupIssue.length > 0
      ? sharedDashboardErrorText(initialSetupIssue)
      : null;

  const steps = buildSetupSteps({
    workspaceId,
    repositoryId,
    selected,
    archived,
    setupStatus,
    setupPullRequestUrl,
    setupIssue,
    setupIssueGuidance,
    workflowCurrent,
    runtimeCompatibility,
    runtimeVerificationNeeded,
    mutationsEnabled,
    currentStep: displayStep,
    enableReviewAction:
      canManage && !runtimeMigrationUpdate ? enableReviewAction : null,
    providerSetupBeforeWorkflow:
      providerSetupBeforeWorkflow && !runtimeMigrationUpdate,
    showDiscussionModeOption: !runtimeMigrationUpdate,
    gatewayProviderSetup: expectedProviderAuthModes.includes(
      "codex_account_gateway",
    ),
    onSetupComplete: handleSetupMutation,
    onMergeComplete: handleMergeMutation,
    gatewayReviewV2Readiness,
  });

  return (
    <section className="mb-4 pt-1">
      {providerLine ? <div className="mb-4">{providerLine}</div> : null}
      {runtimeMigrationUpdate ? (
        <p className="mb-3 text-sm leading-6 text-slate-300" role="status">
          This update uses two setup PRs. The first installs a temporary
          migration workflow; after existing reviews finish, it preserves your
          current GitHub credentials. The final PR installs the new runtime and
          resumes reviews after verification.
        </p>
      ) : null}
      {gatewayBlocked &&
      setupStepNumber[displayStep] >= setupStepNumber.provider ? (
        <p className="mb-3 text-sm text-slate-300" role="status">
          {gatewayReviewV2Readiness?.status === "draining"
            ? `Review migration is draining until ${gatewayReviewV2Readiness.drainNotBefore}. Reviews remain unavailable.`
            : gatewayReviewV2Readiness?.status === "legacy_migration_required"
              ? "This repository has a legacy review enrollment. Complete its migration before reviews can run."
              : gatewayReviewV2Readiness?.status === "paused"
                ? "Review authorization is paused. Complete its recovery before reviews can run."
                : gatewayReviewV2Readiness &&
                    "issue" in gatewayReviewV2Readiness
                  ? sharedDashboardErrorText(gatewayReviewV2Readiness.issue)
                  : "Review authorization is not ready. Confirm the merged workflow or check workspace configuration."}
        </p>
      ) : null}
      {toast ? (
        <ActionToast
          tone={toast.tone}
          title={toast.title}
          body={toast.body}
          actionUrl={toast.actionUrl}
          actionLabel={toast.actionLabel}
          storageKey={
            toast.actionUrl
              ? `reviewrouter:dashboard-setup-pr:${toast.actionUrl}`
              : undefined
          }
        />
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-mono text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-cyan-100">
          Setup progress
        </p>
        <span className="font-mono text-xs text-slate-400">
          {repositorySetupProgressSummary(
            displayStep,
            providerSetupBeforeWorkflow && !runtimeMigrationUpdate,
            runtimeVerificationNeeded,
          )}
        </span>
      </div>

      <div className="relative mt-3">
        <span
          aria-hidden="true"
          className="absolute left-4 right-4 top-6 hidden h-px bg-cyan-300/12 md:block"
        />
        <span
          aria-hidden="true"
          className="absolute left-4 top-6 hidden h-px bg-cyan-300/45 md:block"
          style={{ width: repositorySetupProgressTrackWidth(displayStep) }}
        />
        <ol className="relative z-10 grid gap-3 md:grid-cols-4">
          {steps.map((step) => (
            <RepositorySetupProgressStepItem
              key={step.id}
              step={step}
              currentStep={displayStep}
            />
          ))}
        </ol>
      </div>
    </section>
  );
}

function providerSetupConfirmationMatchesAnyExpectedAuthMode(
  detail: ProviderSetupConfirmedEventDetail,
  expectedProviderAuthModes: readonly ProviderAuthMode[],
): boolean {
  if (expectedProviderAuthModes.length === 0) {
    return true;
  }
  return (
    detail.authMode !== undefined &&
    expectedProviderAuthModes.includes(detail.authMode)
  );
}

function providerSetupConfirmationsComplete(
  confirmedAuthModes: ReadonlySet<ProviderAuthMode>,
  expectedProviderAuthModes: readonly ProviderAuthMode[],
): boolean {
  const uniqueExpected = [...new Set(expectedProviderAuthModes)];
  if (uniqueExpected.length === 0) {
    return true;
  }
  return uniqueExpected.every((authMode) => confirmedAuthModes.has(authMode));
}

function buildSetupSteps({
  workspaceId,
  repositoryId,
  selected,
  archived,
  setupStatus,
  setupPullRequestUrl,
  setupIssue,
  setupIssueGuidance,
  workflowCurrent,
  runtimeCompatibility,
  runtimeVerificationNeeded,
  mutationsEnabled,
  currentStep,
  enableReviewAction,
  providerSetupBeforeWorkflow,
  showDiscussionModeOption,
  gatewayProviderSetup,
  gatewayReviewV2Readiness,
  onSetupComplete,
  onMergeComplete,
}: {
  readonly workspaceId: string;
  readonly repositoryId: string;
  readonly selected: boolean;
  readonly archived: boolean;
  readonly setupStatus: string;
  readonly setupPullRequestUrl: string | null;
  readonly setupIssue: SetupIssue | null;
  readonly setupIssueGuidance: string | null;
  readonly workflowCurrent: boolean;
  readonly runtimeCompatibility: ReviewRuntimeCompatibility;
  readonly runtimeVerificationNeeded: boolean;
  readonly mutationsEnabled: boolean;
  readonly currentStep: SetupStep;
  readonly enableReviewAction?: ReactNode;
  readonly providerSetupBeforeWorkflow: boolean;
  readonly showDiscussionModeOption: boolean;
  readonly gatewayProviderSetup: boolean;
  readonly gatewayReviewV2Readiness?:
    | GatewayReviewV2ProvisioningResult
    | undefined;
  readonly onSetupComplete: (params: Record<string, string>) => void;
  readonly onMergeComplete: (params: Record<string, string>) => void;
}): readonly RepositorySetupProgressStep[] {
  const position = setupStepNumber[currentStep];
  const workflowRefresh =
    runtimeCompatibility === "update_required" ||
    (providerSetupBeforeWorkflow && currentStep === "provider") ||
    (gatewayProviderSetup && position >= setupStepNumber.provider);
  const setupPrAction =
    setupStatus === "setup_pr_open" && setupPullRequestUrl ? (
      <LinkButton
        href={setupPullRequestUrl}
        target="_blank"
        rel="noreferrer"
        variant="outline"
        size="sm"
        className="min-h-11 w-full min-w-0 rounded-lg px-3 sm:w-auto sm:min-w-[9.5rem] sm:px-5"
      >
        Open setup PR
        <span aria-hidden="true" className="text-xs">
          ↗
        </span>
      </LinkButton>
    ) : runtimeVerificationNeeded ? (
      <RepositorySetupMergedButton
        workspaceId={workspaceId}
        repositoryId={repositoryId}
        selected={selected}
        archived={archived}
        mutationsEnabled={mutationsEnabled}
        onComplete={onMergeComplete}
        label="Verify setup"
      />
    ) : currentStep === "setup_pr" || workflowRefresh ? (
      <RepositorySetupActionButton
        workspaceId={workspaceId}
        repositoryId={repositoryId}
        selected={selected}
        archived={archived}
        setupStatus={setupStatus}
        workflowCurrent={workflowCurrent}
        workflowRefresh={workflowRefresh}
        mutationsEnabled={mutationsEnabled}
        gatewayWorkflow={gatewayProviderSetup}
        showDiscussionModeOption={showDiscussionModeOption}
        onComplete={onSetupComplete}
      />
    ) : null;
  const mergeConfirmAction =
    currentStep === "merge_setup_pr" ||
    (gatewayProviderSetup &&
      workflowCurrent &&
      position >= setupStepNumber.provider &&
      (!gatewayReviewV2Readiness ||
        gatewayReviewV2Readiness.status === "blocked" ||
        gatewayReviewV2Readiness.status === "conflict")) ? (
      <RepositorySetupMergedButton
        workspaceId={workspaceId}
        repositoryId={repositoryId}
        selected={selected}
        archived={archived}
        mutationsEnabled={mutationsEnabled}
        onComplete={onMergeComplete}
      />
    ) : null;
  const preWorkflowProviderAction =
    providerSetupBeforeWorkflow && currentStep === "setup_pr"
      ? enableReviewAction
      : null;
  const setupPreparationAction = preWorkflowProviderAction ? (
    <div className="flex w-full flex-col gap-2 sm:w-auto">
      {preWorkflowProviderAction}
      {setupPrAction}
    </div>
  ) : (
    setupPrAction
  );
  const shouldRenderProviderAction =
    Boolean(enableReviewAction) && position >= setupStepNumber.provider;
  const lockedReviewAction =
    currentStep !== "ready" ? (
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="min-h-11 w-full min-w-0 rounded-lg px-3 sm:w-auto sm:min-w-[9.5rem] sm:px-5"
        disabled
      >
        Enable review
        <SetupProgressLockIcon />
      </Button>
    ) : null;
  const reviewAction = shouldRenderProviderAction
    ? enableReviewAction
    : lockedReviewAction;

  const setupPrHelper = setupIssue
    ? setupIssueHelperText(setupIssue)
    : setupIssueGuidance
      ? setupIssueGuidance
      : runtimeVerificationNeeded
        ? "Check the installed workflow and runtime."
        : position > setupStepNumber.setup_pr
          ? "Setup PR exists."
          : providerSetupBeforeWorkflow
            ? "Connect Codex, then create and merge the setup PR."
            : "Add the workflow by PR.";

  return [
    {
      id: "setup_pr",
      title: setupIssue
        ? "Recover setup PR"
        : runtimeVerificationNeeded
          ? "Verify setup"
          : providerSetupBeforeWorkflow
            ? "Prepare setup PR"
            : "Create setup PR",
      helper: setupPrHelper,
      action: setupPreparationAction,
    },
    {
      id: "merge_setup_pr",
      title: "Merge setup PR",
      helper:
        position > setupStepNumber.merge_setup_pr
          ? "Workflow is on the default branch."
          : "Merge on GitHub.",
      action: mergeConfirmAction,
    },
    {
      id: "provider",
      title: providerSetupBeforeWorkflow
        ? "Check Codex setup"
        : gatewayProviderSetup
          ? "Configure account"
          : "Enable review",
      helper:
        currentStep === "ready"
          ? "Provider access is configured."
          : currentStep === "provider"
            ? providerSetupBeforeWorkflow
              ? "Check the Codex connection for this repository."
              : gatewayProviderSetup
                ? "Choose an active workspace account and model. Credentials stay on the server."
                : "Add the credential the provider needs."
            : providerSetupBeforeWorkflow
              ? "After merge, check the Codex connection."
              : "Available after merge.",
      action: reviewAction,
    },
    {
      id: "ready",
      title: "Ready",
      helper: null,
    },
  ];
}

type RepositorySetupProgressStep = {
  readonly id: SetupStep;
  readonly title: string;
  readonly helper: string | null;
  readonly action?: ReactNode;
};

function RepositorySetupProgressStepItem({
  step,
  currentStep,
}: {
  readonly step: RepositorySetupProgressStep;
  readonly currentStep: SetupStep;
}): React.ReactElement {
  const isActive = step.id === currentStep;
  const isComplete = setupStepNumber[step.id] < setupStepNumber[currentStep];
  const isFuture = setupStepNumber[step.id] > setupStepNumber[currentStep];
  const circleClass = isActive
    ? "border-cyan-200 bg-cyan-200 text-slate-950 shadow-[0_0_18px_rgba(103,232,249,0.28)]"
    : isComplete
      ? "border-cyan-300/45 bg-slate-950 text-cyan-100 shadow-[inset_0_0_18px_rgba(103,232,249,0.12)]"
      : "border-slate-700 bg-slate-950 text-slate-500";
  const desktopAlignment =
    step.id === "setup_pr"
      ? "md:items-start md:text-left"
      : step.id === "ready"
        ? "md:items-end md:text-right"
        : "md:items-center md:text-center";

  return (
    <li className="relative min-w-0">
      <div
        className={[
          "relative z-10 flex min-w-0 items-start gap-3 py-2 pr-3 md:flex-col md:gap-0 md:pr-0",
          "md:min-h-[8.25rem]",
          desktopAlignment,
        ].join(" ")}
      >
        <span
          className={[
            "grid h-8 w-8 shrink-0 place-items-center rounded-full border font-mono text-xs font-bold leading-none",
            circleClass,
          ].join(" ")}
        >
          {setupStepNumber[step.id]}
        </span>
        <div className="min-w-0 md:mt-3">
          <p
            className={[
              "text-sm font-semibold leading-5",
              isFuture ? "text-slate-500" : "text-cyan-50",
            ].join(" ")}
          >
            {step.title}
          </p>
          {step.helper ? (
            <p className="mt-1 text-xs leading-5 text-slate-500">
              {step.helper}
            </p>
          ) : null}
          {step.action ? (
            <div
              className={[
                "mt-3",
                step.id === "ready"
                  ? "md:flex md:justify-end"
                  : step.id === "setup_pr"
                    ? "md:flex md:justify-start"
                    : "md:flex md:justify-center",
              ].join(" ")}
            >
              {step.action}
            </div>
          ) : null}
        </div>
      </div>
    </li>
  );
}

function repositorySetupProgressSummary(
  step: SetupStep,
  providerSetupBeforeWorkflow: boolean,
  runtimeVerificationNeeded: boolean,
): string {
  switch (step) {
    case "setup_pr":
      return runtimeVerificationNeeded
        ? "1 of 4 - verification needed"
        : providerSetupBeforeWorkflow
          ? "1 of 4 - connect Codex"
          : "1 of 4 - setup PR needed";
    case "merge_setup_pr":
      return "2 of 4 - merge setup PR";
    case "provider":
      return providerSetupBeforeWorkflow
        ? "3 of 4 - check Codex setup"
        : "3 of 4 - enable review";
    case "ready":
      return "4 of 4 - complete";
  }
}

function repositorySetupProgressTrackWidth(step: SetupStep): string {
  switch (step) {
    case "setup_pr":
      return "0";
    case "merge_setup_pr":
      return "calc(37.5% - 1rem)";
    case "provider":
      return "calc(62.5% - 1rem)";
    case "ready":
      return "calc(100% - 2rem)";
  }
}

function SetupProgressLockIcon(): React.ReactElement {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="h-3.5 w-3.5 shrink-0"
      fill="none"
    >
      <path
        d="M5 7V5.4C5 3.7 6.3 2.5 8 2.5s3 1.2 3 2.9V7"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <path
        d="M4.2 7h7.6v5.8H4.2z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function clearTransientDashboardUrlParams(section: string): void {
  const url = new URL(window.location.href);
  let changed = false;

  for (const key of ["notice", "error", "pr"]) {
    if (url.searchParams.has(key)) {
      url.searchParams.delete(key);
      changed = true;
    }
  }

  if (url.searchParams.get("section") !== section) {
    url.searchParams.set("section", section);
    changed = true;
  }

  if (!changed) return;

  const search = url.searchParams.toString();
  window.history.replaceState(
    window.history.state,
    "",
    `${url.pathname}${search ? `?${search}` : ""}${url.hash}`,
  );
}

function openOnce(url: string | undefined): void {
  if (!url) return;

  const storageKey = `reviewrouter:dashboard-setup-pr:${url}`;
  try {
    if (window.sessionStorage.getItem(storageKey) === "1") return;
    window.sessionStorage.setItem(storageKey, "1");
  } catch {
    // Privacy settings can block storage. The explicit link remains visible.
  }

  window.open(url, "_blank", "noopener,noreferrer");
}

function dashboardErrorText(error: string): string {
  switch (error) {
    case "dashboard_action_stale":
      return "The dashboard was updated while this page was open. Refresh the page, then click again.";
    case "setup_pr_not_merged":
      return "GitHub does not show the workflow on the setup PR target branch yet. If you just merged the setup PR, wait a few seconds; the dashboard will advance automatically when GitHub metadata catches up. If the setup PR was merged a while ago, an older ReviewRouter workflow left in the repository can also block this check: remove reviewrouter.yml, reviewrouter-codex.yml and reviewrouter-interaction.yml if they exist, then check again.";
    case "setup_legacy_workflows_present":
      return "Older ReviewRouter workflows are still in the repository (reviewrouter.yml, reviewrouter-codex.yml or reviewrouter-interaction.yml), so the new setup cannot be confirmed. Recreate the setup PR: it removes them (including the /rr comment commands), then merge it and check again.";
    case "setup_pr_closed":
      return "The saved setup PR was closed before it was merged. Recreate the setup PR, then merge the new one.";
    case "setup_pr_branch_deleted":
      return "The saved setup PR branch was deleted, so GitHub cannot merge that PR anymore. Recreate the setup PR to continue.";
    case "setup_pr_wrong_base_branch":
      return "The saved setup PR was merged outside the allowed setup branches. Recreate the setup PR, then merge it into the repository default branch.";
    case "setup_pr_workflow_mismatch":
      return "The merged setup PR does not contain the expected ReviewRouter workflow. Recreate the setup PR and merge it without edits, then check again.";
    case "dashboard_action_failed":
      return "The dashboard action failed. Retry once, then inspect server logs if it repeats.";
    case "github_operation_forbidden":
      return "GitHub refused the setup PR update. Check GitHub App Contents, Workflows, and Pull requests write permissions, then retry.";
    case "github_operation_not_found":
      return "GitHub could not find the repository or setup branch. Sync the installation, confirm repository access, then retry.";
    case "github_operation_conflict":
      return "GitHub reported a write conflict while updating the setup PR. Retry once after the current GitHub operation settles.";
    case "github_validation_failed":
      return "GitHub rejected the setup PR update. Check whether the setup PR can be reopened, or delete the setup branch and retry.";
    case "github_service_unavailable":
      return "GitHub is temporarily unavailable for this setup action. Retry after GitHub recovers.";
    case "github_operation_failed":
      return "The setup check could not be completed. The repository may have changed while it ran, so wait a moment and check again. If it repeats, look for dashboard_action_unclassified_error in the web server log.";
    default:
      return sharedDashboardErrorText(error);
  }
}

function normalizeSetupIssue(
  value: string | null | undefined,
): SetupIssue | null {
  return value === "setup_pr_closed" ||
    value === "setup_pr_branch_deleted" ||
    value === "setup_pr_wrong_base_branch" ||
    value === "setup_pr_workflow_mismatch"
    ? value
    : null;
}

function setupIssueHelperText(issue: SetupIssue): string {
  switch (issue) {
    case "setup_pr_closed":
      return "Previous setup PR was closed. Recreate it.";
    case "setup_pr_branch_deleted":
      return "Setup PR branch was deleted. Recreate it.";
    case "setup_pr_wrong_base_branch":
      return "Setup PR was merged outside the allowed setup branches. Recreate it.";
    case "setup_pr_workflow_mismatch":
      return "Merged setup PR does not contain the expected workflow. Recreate it and merge without edits.";
  }
}
