"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type {
  RepositorySetupStepId,
  ReviewRuntimeCompatibility,
} from "@reviewrouter/features-provider-setup";
import type { ProviderAuthMode } from "@reviewrouter/features-review-providers";
import {
  providerSetupConfirmedEventName,
  setupPullRequestMergedEventName,
  type ProviderSetupConfirmedEventDetail,
  type SetupPullRequestMergedEventDetail,
} from "./repository-setup-optimistic-events";

export type SetupStep = RepositorySetupStepId;

/** Position of each setup step in the stepper. */
export const setupStepNumber: Readonly<Record<SetupStep, 1 | 2 | 3 | 4>> = {
  setup_pr: 1,
  merge_setup_pr: 2,
  provider: 3,
  ready: 4,
};

/** A provider/merge event cannot attest which execution runtime is installed. */
export function runtimeQualifiedSetupStep(
  step: SetupStep,
  currentStep: SetupStep,
  runtimeCompatibility: ReviewRuntimeCompatibility,
): SetupStep {
  if (
    runtimeCompatibility !== "compatible" &&
    setupStepNumber[step] >= setupStepNumber.provider
  )
    return setupStepNumber[currentStep] < setupStepNumber.provider
      ? currentStep
      : "setup_pr";
  return step;
}

/** A credential confirmation cannot complete an unfinished workflow setup. */
export function hasCompletedWorkflowSetup(step: SetupStep): boolean {
  return setupStepNumber[step] >= setupStepNumber.provider;
}

export function repositorySetupScopeKey(
  repositoryId: string,
  expectedProviderAuthModes: readonly ProviderAuthMode[],
): string {
  return JSON.stringify([
    repositoryId,
    [...new Set(expectedProviderAuthModes)].sort(),
  ]);
}

export function repositorySetupStepPillClassName(isComplete: boolean): string {
  return [
    "setup-toggle inline-flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border px-2.5 font-mono text-xs font-semibold uppercase tracking-[0.12em] transition duration-200 ease-out hover:saturate-125",
    isComplete
      ? "border-emerald-300/40 bg-emerald-400/[0.09] text-emerald-100 hover:border-emerald-300/60 hover:bg-emerald-400/[0.14]"
      : "border-cyan-300/25 bg-cyan-300/[0.035] text-cyan-100 hover:border-cyan-300/50 hover:bg-cyan-300/[0.075]",
  ].join(" ");
}

export function RepositorySetupStepPillBody({
  step,
}: {
  readonly step: SetupStep;
}): React.ReactElement {
  const isComplete = step === "ready";

  return (
    <>
      <span>Setup</span>
      <span
        className={[
          "text-[0.65rem] tracking-normal",
          isComplete ? "text-emerald-200/80" : "text-slate-400",
        ].join(" ")}
      >
        {setupStepNumber[step]}/4
      </span>
      {isComplete ? <SetupCompleteCheckIcon /> : <SetupDisclosureChevron />}
    </>
  );
}

export function RepositorySetupDisclosureToggle({
  repositoryId,
  disclosureId,
  currentStep,
  expectedProviderAuthModes = [],
  gatewayReviewV2Ready = false,
  runtimeCompatibility = "compatible",
}: {
  readonly repositoryId: string;
  readonly disclosureId: string;
  readonly currentStep: SetupStep;
  readonly expectedProviderAuthModes?: readonly ProviderAuthMode[];
  readonly gatewayReviewV2Ready?: boolean;
  readonly runtimeCompatibility?: ReviewRuntimeCompatibility;
}): React.ReactElement {
  const optimisticStep = useOptimisticSetupStep({
    repositoryId,
    currentStep,
    expectedProviderAuthModes,
    gatewayReviewV2Ready,
    runtimeCompatibility,
  });

  const isComplete = optimisticStep === "ready";
  return (
    <label
      htmlFor={disclosureId}
      title={repositorySetupProgressSummary(optimisticStep)}
      className={repositorySetupStepPillClassName(isComplete)}
    >
      <RepositorySetupStepPillBody step={optimisticStep} />
    </label>
  );
}

export function RepositorySetupReadyGate({
  repositoryId,
  currentStep,
  expectedProviderAuthModes = [],
  gatewayReviewV2Ready = false,
  runtimeCompatibility = "compatible",
  children,
}: {
  readonly repositoryId: string;
  readonly currentStep: SetupStep;
  readonly expectedProviderAuthModes?: readonly ProviderAuthMode[];
  readonly gatewayReviewV2Ready?: boolean;
  readonly runtimeCompatibility?: ReviewRuntimeCompatibility;
  readonly children: ReactNode;
}): React.ReactElement | null {
  const optimisticStep = useOptimisticSetupStep({
    repositoryId,
    currentStep,
    expectedProviderAuthModes,
    gatewayReviewV2Ready,
    runtimeCompatibility,
  });

  return optimisticStep === "ready" ? <>{children}</> : null;
}

function useOptimisticSetupStep({
  repositoryId,
  currentStep,
  expectedProviderAuthModes,
  gatewayReviewV2Ready,
  runtimeCompatibility,
}: {
  readonly repositoryId: string;
  readonly currentStep: SetupStep;
  readonly expectedProviderAuthModes: readonly ProviderAuthMode[];
  readonly gatewayReviewV2Ready: boolean;
  readonly runtimeCompatibility: ReviewRuntimeCompatibility;
}): SetupStep {
  const scopeKey = repositorySetupScopeKey(
    repositoryId,
    expectedProviderAuthModes,
  );
  const [optimisticScopeKey, setOptimisticScopeKey] = useState(scopeKey);
  const [optimisticStep, setOptimisticStep] = useState(currentStep);
  const optimisticProviderAuthModesRef = useRef(new Set<ProviderAuthMode>());

  useEffect(() => {
    optimisticProviderAuthModesRef.current = new Set();
    setOptimisticScopeKey(scopeKey);
    setOptimisticStep(currentStep);
  }, [currentStep, scopeKey]);

  useEffect(() => {
    function handleSetupPullRequestMerged(event: Event): void {
      const detail = (event as CustomEvent<SetupPullRequestMergedEventDetail>)
        .detail;
      if (detail?.repositoryId === repositoryId) {
        setOptimisticStep((current) =>
          setupStepNumber[current] < setupStepNumber.provider
            ? "provider"
            : current,
        );
      }
    }

    function handleProviderSetupConfirmed(event: Event): void {
      const detail = (event as CustomEvent<ProviderSetupConfirmedEventDetail>)
        .detail;
      if (
        detail?.repositoryId === repositoryId &&
        providerSetupConfirmationMatchesAnyExpectedAuthMode(
          detail,
          expectedProviderAuthModes,
        )
      ) {
        if (detail.authMode !== undefined) {
          optimisticProviderAuthModesRef.current.add(detail.authMode);
        }
        if (
          providerSetupConfirmationsComplete(
            optimisticProviderAuthModesRef.current,
            expectedProviderAuthModes,
          )
        ) {
          if (
            !expectedProviderAuthModes.includes("codex_account_gateway") ||
            gatewayReviewV2Ready
          )
            setOptimisticStep((current) =>
              hasCompletedWorkflowSetup(current) ? "ready" : current,
            );
        }
      }
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
  }, [expectedProviderAuthModes, repositoryId, gatewayReviewV2Ready]);

  // Do not render the old scope's progress while its reset effect is pending.
  const scopedStep =
    optimisticScopeKey === scopeKey ? optimisticStep : currentStep;
  const step =
    scopedStep === "ready" &&
    expectedProviderAuthModes.includes("codex_account_gateway") &&
    !gatewayReviewV2Ready
      ? "provider"
      : scopedStep;
  return runtimeQualifiedSetupStep(step, currentStep, runtimeCompatibility);
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

export function RepositorySetupRowDisclosureController(): null {
  useEffect(() => {
    function handleRowClick(event: MouseEvent): void {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest(repositoryRowInteractiveSelector)) return;

      const row = target.closest<HTMLElement>("[data-repository-setup-row]");
      if (!row) return;
      if (target.closest("[data-repository-setup-panel]")) return;

      const disclosureId = row.dataset.disclosureId;
      if (!disclosureId) return;

      const input = document.getElementById(disclosureId);
      if (!(input instanceof HTMLInputElement)) return;

      input.checked = !input.checked;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }

    document.addEventListener("click", handleRowClick);
    return () => document.removeEventListener("click", handleRowClick);
  }, []);

  return null;
}

const repositoryRowInteractiveSelector = [
  "a",
  "button",
  "input",
  "label",
  "select",
  "textarea",
  "[role='button']",
  "[role='link']",
  "[role='tab']",
  "[data-ignore-repository-row-toggle]",
].join(",");

function SetupDisclosureChevron(): React.ReactElement {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="setup-chevron h-3.5 w-3.5 shrink-0 text-cyan-100 transition-transform duration-200 ease-out motion-reduce:transition-none"
      fill="none"
    >
      <path
        d="M4 6l4 4 4-4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SetupCompleteCheckIcon(): React.ReactElement {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="h-3.5 w-3.5 shrink-0 text-emerald-200"
      fill="none"
    >
      <path
        d="M3.5 8.5l3 3 6-6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function repositorySetupProgressSummary(step: SetupStep): string {
  switch (step) {
    case "setup_pr":
      return "1 of 4 - setup PR needed";
    case "merge_setup_pr":
      return "2 of 4 - merge setup PR";
    case "provider":
      return "3 of 4 - enable review";
    case "ready":
      return "4 of 4 - complete";
  }
}
