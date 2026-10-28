"use client";

import type { ProviderIdentity } from "../../../src/features/provider-setup/provider-identity";

import type { ProviderCredentialKind } from "@reviewrouter/features-review-config/workspace-provider-profile";
import type { ProviderAuthMode } from "@reviewrouter/features-review-providers";
import { sourceTitle } from "../../../src/features/provider-setup/provider-setup-model";
import { ProviderAuthLogoFrame } from "../provider-auth-logo";
import {
  ProviderSetupDialog,
  type ProviderSetupDialogProps,
} from "./provider-setup-dialog";

/** What a target reviews with now, as the server resolved it. */
export type ProviderLineSummary = Readonly<{
  /**
   * `repository`: its own provider; `workspace`: the workspace default;
   * `none`: nothing selected; `unreadable`: stored settings in a retired
   * format, so no provider applies until they are saved again.
   */
  source: "repository" | "workspace" | "none" | "unreadable";
  /** `unreadable` only: whose document is in the retired format. */
  retiredScope?: "workspace" | "repository";
  profile: Readonly<{
    label: string;
    model: string;
    providerId?: ProviderIdentity | undefined;
    authMode: ProviderAuthMode;
    credentialKind: ProviderCredentialKind;
  }> | null;
}>;

type LineCopy = Readonly<{
  title: string;
  /** The title in a table row, where space is short. */
  short: string;
  detail: string | null;
  action: string;
  attention: boolean;
}>;

/**
 * "Provider: X · Change": what the target reviews with and the one way to
 * change it, the provider dialog for that fixed target.
 */
export function ProviderLine({
  summary,
  compact = false,
  ...dialog
}: Omit<ProviderSetupDialogProps, "triggerLabel"> &
  Readonly<{
    summary: ProviderLineSummary;
    /** A short inline variant for a table row header. */
    compact?: boolean;
  }>): React.ReactElement {
  const copy = providerLineCopy(summary, dialog.target.kind);
  const trigger = (
    <ProviderSetupDialog
      {...dialog}
      triggerLabel={copy.action}
      triggerVariant={compact ? "ghost" : copy.attention ? "solid" : "outline"}
      triggerSize="sm"
      triggerClassName={
        compact ? "min-h-8 rounded-lg px-2 text-xs" : "min-h-10 rounded-lg px-4"
      }
    />
  );
  if (compact)
    return (
      <span
        data-ignore-repository-row-toggle
        className="inline-flex min-w-0 max-w-full flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-slate-300"
      >
        {summary.profile ? (
          <ProviderAuthLogoFrame
            authMode={summary.profile.authMode}
            providerId={summary.profile.providerId}
          />
        ) : null}
        <span
          title={copy.title}
          className={[
            "min-w-0 break-words",
            copy.attention ? "text-amber-100" : "",
          ].join(" ")}
        >
          {copy.short}
        </span>
        <span aria-hidden="true" className="text-slate-600">
          ·
        </span>
        {trigger}
      </span>
    );
  return (
    <div
      className={[
        "flex flex-wrap items-center justify-between gap-3 border-b pb-3",
        copy.attention ? "border-amber-300/20" : "border-cyan-200/10",
      ].join(" ")}
    >
      <div className="flex min-w-0 items-center gap-3">
        {summary.profile ? (
          <ProviderAuthLogoFrame
            authMode={summary.profile.authMode}
            providerId={summary.profile.providerId}
          />
        ) : null}
        <div className="min-w-0">
          <p
            className={[
              "text-sm font-semibold",
              copy.attention ? "text-amber-50" : "text-cyan-50",
            ].join(" ")}
          >
            {copy.title}
          </p>
          {copy.detail ? (
            <p className="text-xs leading-5 text-slate-400">{copy.detail}</p>
          ) : null}
        </div>
      </div>
      {trigger}
    </div>
  );
}

export function providerLineCopy(
  summary: ProviderLineSummary,
  target: ProviderSetupDialogProps["target"]["kind"],
): LineCopy {
  const { profile } = summary;
  const detail = profile
    ? `${sourceTitle(profile.credentialKind, profile.authMode)} · ${profile.model}`
    : null;
  if (target === "workspace" && summary.source === "unreadable")
    return {
      title: "Workspace settings need to be saved again",
      short: "Settings need saving",
      detail:
        "They use a retired format, so repositories that follow them are stopped. Choosing a default provider replaces them with the built-in settings.",
      action: "Choose default provider",
      attention: true,
    };
  if (target === "workspace")
    return profile
      ? {
          title: `Default provider: ${profile.label}`,
          short: profile.label,
          detail,
          action: "Change",
          attention: false,
        }
      : {
          title: "No default provider",
          short: "No default provider",
          detail:
            "Repositories without a provider of their own wait until you choose one.",
          action: "Choose default provider",
          attention: true,
        };
  switch (summary.source) {
    case "repository":
      return {
        title: `Provider: ${profile?.label ?? "unavailable"}`,
        short: profile?.label ?? "Provider unavailable",
        detail,
        action: "Change",
        attention: profile === null,
      };
    case "workspace":
      return {
        title: `Using workspace default: ${profile?.label ?? "unavailable"}`,
        short: `Default: ${profile?.label ?? "unavailable"}`,
        detail,
        action: "Use a different provider",
        attention: profile === null,
      };
    case "unreadable":
      return summary.retiredScope === "workspace"
        ? {
            title: "Workspace settings need to be replaced",
            short: "Workspace settings need replacing",
            detail:
              "They use a retired format, so this repository is stopped too. An owner or admin replaces them by choosing a default provider.",
            action: "Choose provider",
            attention: true,
          }
        : {
            title: "Provider settings need to be saved again",
            short: "Provider settings need saving",
            detail:
              "They use a retired format, so reviews are stopped. Choosing a provider replaces them; the repository then follows the workspace settings.",
            action: "Choose provider",
            attention: true,
          };
    case "none":
      return {
        title: "No provider yet",
        short: "No provider yet",
        detail:
          "Choose a provider for this repository, or ask an owner or admin to set a workspace default.",
        action: "Choose provider",
        attention: true,
      };
  }
}
