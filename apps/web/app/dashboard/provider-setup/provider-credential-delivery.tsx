"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type {
  ProviderSecretScope,
  ProviderSecretSetupGuidance,
} from "@reviewrouter/features-provider-setup";
import {
  apiKeyProviderForAuthMode,
  getApiKeyProvider,
  getProviderAuthModeMetadata,
  type ProviderAuthMode,
} from "@reviewrouter/features-review-providers";
import type { UserCiSecretAuthMode } from "@reviewrouter/features-review-config/workspace-provider-profile";
import { Badge, Button, Checkbox, CodeBlock } from "@reviewrouter/ui";
import { providerSetupConfirmedEvent } from "../repository-setup-optimistic-events";
import {
  confirmProviderSecretSetup,
  CodexSetupCommandError,
  installManagedProviderKey,
  providerSetupQueryKeys,
  recoverCodexSetupCommand,
  requestCodexSetupCommand,
  useProviderSecretStatus,
  useProviderSetupCompletion,
  type CodexSetupCommand,
} from "./provider-setup-api";

/**
 * How each credential reaches the review workflow, one panel per credential
 * kind. Account Gateway needs none: its credential stays on the server.
 */

export type OrganizationSecretPolicy = {
  readonly planName: string | null;
  readonly privateRepositoriesAvailable: boolean | null;
  readonly status: "available" | "permission_required" | "unknown";
};

type VerificationFallbackError =
  | "repository_not_visible_to_github_app"
  | "provider_secret_not_found"
  | "provider_secret_not_available_to_repository"
  | "provider_secret_check_permission_required";

type DeliveryRepository = Readonly<{
  workspaceId: string;
  repositoryId: string;
  repositoryFullName: string;
}>;

/**
 * Confirms a credential of the repository and tells the setup progress about
 * it. Verified mode reads GitHub secret metadata; manual mode records the
 * user's confirmation when GitHub cannot be read.
 */
function useCredentialConfirmation(
  input: DeliveryRepository & Readonly<{ authMode: ProviderAuthMode }>,
) {
  const queryClient = useQueryClient();
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [verificationError, setVerificationError] =
    useState<VerificationFallbackError | null>(null);
  const [confirmed, setConfirmed] = useState<"verified" | "manual" | null>(
    null,
  );
  const rotating = input.authMode === "codex_subscription_oauth_rotating";
  const mounted = useRef(false);
  const requestVersion = useRef(0);
  const inFlight = useRef(false);
  useEffect(() => {
    mounted.current = true;
    inFlight.current = false;
    return () => {
      mounted.current = false;
      requestVersion.current += 1;
    };
  }, [input.workspaceId, input.repositoryId, input.authMode]);

  async function confirm(input2: {
    readonly secretScope: ProviderSecretScope;
    readonly mode: "verified" | "manual";
  }): Promise<boolean> {
    if (inFlight.current) return false;
    inFlight.current = true;
    const version = ++requestVersion.current;
    const current = () => mounted.current && requestVersion.current === version;
    const formData = new FormData();
    formData.set("workspaceId", input.workspaceId);
    formData.set("repositoryId", input.repositoryId);
    formData.set(
      "providerKind",
      getProviderAuthModeMetadata(input.authMode).providerKind,
    );
    formData.set("authMode", input.authMode);
    formData.set("secretScope", input2.secretScope);
    formData.set("confirmationMode", input2.mode);
    setSubmitError(null);
    setConfirmed(null);
    setSubmitting(true);
    try {
      const { params } = await confirmProviderSecretSetup(formData);
      if (!current()) return false;
      if (
        !rotating &&
        input2.mode === "verified" &&
        isVerificationFallbackError(params.error)
      ) {
        setVerificationError(params.error);
        return false;
      }
      if (params.error) {
        setSubmitError(params.error);
        return false;
      }
      setVerificationError(null);
      setConfirmed(input2.mode);
      await queryClient.invalidateQueries({
        queryKey: providerSetupQueryKeys.secretStatus(
          input.workspaceId,
          input.repositoryId,
          input.authMode,
        ),
        exact: true,
      });
      if (!current()) return false;
      window.dispatchEvent(
        providerSetupConfirmedEvent({
          repositoryId: input.repositoryId,
          repositoryFullName: input.repositoryFullName,
          providerKind: getProviderAuthModeMetadata(input.authMode)
            .providerKind,
          authMode: input.authMode,
        }),
      );
      return true;
    } catch {
      if (current())
        setSubmitError(
          rotating
            ? "codex_setup_confirmation_outcome_unknown"
            : "dashboard_action_stale",
        );
      return false;
    } finally {
      if (current()) {
        inFlight.current = false;
        setSubmitting(false);
      } else {
        // The server may have completed after the dialog closed. A later open
        // must re-read this target without publishing an event into the new UI.
        await queryClient.invalidateQueries({
          queryKey: providerSetupQueryKeys.secretStatus(
            input.workspaceId,
            input.repositoryId,
            input.authMode,
          ),
          exact: true,
          refetchType: "none",
        });
      }
    }
  }

  return {
    confirm,
    submitting,
    submitError,
    verificationError,
    confirmed,
    resetVerification: () => {
      setVerificationError(null);
      setSubmitError(null);
      setConfirmed(null);
    },
  };
}

/** A user-managed GitHub Actions secret, set with GitHub CLI. */
export function CiSecretDelivery({
  workspaceId,
  repositoryId,
  repositoryFullName,
  repositoryVisibility,
  authMode,
  guidance,
  organizationLogin,
  organizationSecretPolicy,
  canManage,
}: DeliveryRepository &
  Readonly<{
    repositoryVisibility: string;
    authMode: UserCiSecretAuthMode;
    guidance: ProviderSecretSetupGuidance;
    organizationLogin: string | null;
    organizationSecretPolicy: OrganizationSecretPolicy | null;
    /** Write access on the repository; read-only users see the steps only. */
    canManage: boolean;
  }>): React.ReactElement {
  const orgUnavailable =
    Boolean(organizationLogin) &&
    repositoryVisibility === "private" &&
    organizationSecretPolicy?.privateRepositoriesAvailable === false;
  const [scope, setScope] = useState<ProviderSecretScope>("repository");
  const confirmation = useCredentialConfirmation({
    workspaceId,
    repositoryId,
    repositoryFullName,
    authMode,
  });
  const status = useProviderSecretStatus({
    workspaceId,
    repositoryId,
    authMode,
    enabled: canManage,
  });
  const scopes = secretScopeOptions({
    organizationLogin,
    organizationSecretPolicy,
    repositoryFullName,
    repositoryVisibility,
  });
  const command =
    guidance.commands.find((candidate) => candidate.scope === scope) ??
    guidance.commands.find((candidate) => candidate.scope === "repository");
  const secretNames = command?.secretNames.join(", ") ?? "GitHub secret";
  const details = ciSecretDetails(authMode, repositoryFullName);
  const manual = verificationErrorAllowsManual(confirmation.verificationError);
  const secretFound =
    status.data === "available_repository" ||
    status.data === "available_organization";

  return (
    <div className="grid gap-4">
      <div className="grid gap-1">
        <h3 className="text-base font-semibold text-cyan-50">
          {details.title}
        </h3>
        <p className="text-sm leading-6 text-slate-300">{details.body}</p>
      </div>
      {canManage ? (
        <p
          role="status"
          className={
            secretFound ? "text-sm text-emerald-100" : "text-sm text-slate-400"
          }
        >
          {status.isPending
            ? "Checking the repository secrets on GitHub..."
            : secretFound
              ? `${secretNames} is available to this repository.`
              : status.data === "not_available_to_repository"
                ? `An organization secret ${secretNames} exists, but this repository is not allowed to use it.`
                : status.data === "missing"
                  ? `${secretNames} is not set for this repository yet.`
                  : "ReviewRouter cannot read the repository secrets right now; you can still follow the steps."}
        </p>
      ) : null}

      {scopes.length > 1 ? (
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-semibold text-cyan-50">
            Where to store the secret
          </legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {scopes.map((option) => (
              <label
                key={option.scope}
                className={[
                  "flex items-start gap-3 rounded-xl border p-3 text-sm leading-5 transition",
                  option.disabled || confirmation.submitting
                    ? "cursor-not-allowed border-slate-700/60 text-slate-500"
                    : scope === option.scope
                      ? "cursor-pointer border-cyan-300/50 bg-cyan-300/[0.07] text-cyan-50"
                      : "cursor-pointer border-cyan-200/12 text-slate-300 hover:border-cyan-200/30",
                ].join(" ")}
              >
                <input
                  type="radio"
                  name={`secret-scope-${repositoryId}`}
                  data-testid={`provider-scope-${option.scope}`}
                  checked={scope === option.scope}
                  disabled={option.disabled || confirmation.submitting}
                  onChange={() => {
                    setScope(option.scope);
                    confirmation.resetVerification();
                  }}
                  className="mt-1 h-4 w-4 accent-cyan-300"
                />
                <span className="grid gap-0.5">
                  <span className="font-semibold">{option.title}</span>
                  <span className="text-xs text-slate-400">{option.body}</span>
                </span>
              </label>
            ))}
          </div>
          {orgUnavailable ? (
            <p className="text-xs leading-5 text-amber-100/85">
              Organization secrets on this GitHub plan are not available to
              private repositories. Use a repository secret.
            </p>
          ) : null}
        </fieldset>
      ) : null}

      <ol className="grid list-decimal gap-1.5 pl-5 text-sm leading-6 text-slate-200">
        <li>Open a terminal on your computer where GitHub CLI is signed in.</li>
        {authMode === "claude_code_oauth" ? (
          <li>
            Run <code>claude setup-token</code> and copy only the printed token.
          </li>
        ) : null}
        <li>
          Run the command below. {details.prompt}
          {details.link ? (
            <>
              {" "}
              <a
                href={details.link.url}
                target="_blank"
                rel="noreferrer noopener"
                className="font-semibold text-cyan-200 underline-offset-4 hover:underline"
              >
                {details.link.label}
              </a>
              .
            </>
          ) : null}
        </li>
        <li>Come back here and check the secret.</li>
      </ol>
      {command ? (
        <CodeBlock
          code={command.command}
          language="bash"
          className="rounded-xl p-3 text-xs leading-5"
        />
      ) : (
        <p className="text-sm text-red-100">
          No command is available for this secret location.
        </p>
      )}

      <form
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          void confirmation.confirm({
            secretScope: command?.scope ?? "repository",
            mode: manual ? "manual" : "verified",
          });
        }}
        className="grid gap-3"
      >
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="submit"
            size="sm"
            disabled={
              !canManage ||
              !command ||
              confirmation.submitting ||
              confirmation.confirmed !== null
            }
            aria-busy={confirmation.submitting}
          >
            {confirmation.submitting
              ? manual
                ? "Saving..."
                : "Checking the secret..."
              : manual
                ? "Confirm manually"
                : confirmation.confirmed
                  ? "Confirmed"
                  : confirmation.verificationError
                    ? "Check again"
                    : "Check GitHub setup"}
          </Button>
          {confirmation.confirmed ? (
            <Badge
              tone={confirmation.confirmed === "manual" ? "neutral" : "success"}
            >
              {confirmation.confirmed === "manual"
                ? "Confirmed manually"
                : "Secret available"}
            </Badge>
          ) : null}
        </div>
        {!canManage ? (
          <p className="text-xs leading-5 text-amber-100/85">
            You need write access to this repository on GitHub to confirm the
            secret.
          </p>
        ) : null}
        {confirmation.verificationError ? (
          <p className="text-xs leading-5 text-amber-100/85">
            {verificationErrorText({
              error: confirmation.verificationError,
              scope: command?.scope ?? "repository",
              secretNames,
              repositoryFullName,
              organizationLogin,
            })}
          </p>
        ) : null}
        {confirmation.submitError ? (
          <p role="alert" className="text-sm leading-6 text-red-100">
            {confirmErrorText(confirmation.submitError)}
          </p>
        ) : null}
        {confirmation.confirmed ? (
          <p role="status" className="text-sm leading-6 text-emerald-50">
            {confirmation.confirmed === "manual"
              ? `Marked as done for ${repositoryFullName}. ReviewRouter could not check GitHub itself.`
              : `${secretNames} is set for ${repositoryFullName}.`}
          </p>
        ) : null}
      </form>
      <p className="text-xs leading-5 text-slate-500">
        This checks GitHub secret availability, not a response from the model.{" "}
        {details.footnote} ReviewRouter never receives this credential.
      </p>
    </div>
  );
}

/**
 * The server-held key of a managed provider. An owner or admin installs it
 * into the repository's GitHub Actions secrets; the step then confirms it.
 */
export function ManagedKeyDelivery({
  workspaceId,
  repositoryId,
  repositoryFullName,
  authMode,
  installed,
  installDecisionReason,
  canManage,
  onInstalled,
}: DeliveryRepository &
  Readonly<{
    authMode: "mimo_token_plan_api_key" | "openrouter_api_key";
    installed: boolean;
    /** Why the viewer cannot install the key; null when they can. */
    installDecisionReason: string | null;
    canManage: boolean;
    onInstalled?: () => void;
  }>): React.ReactElement {
  const [installing, setInstalling] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);
  const confirmation = useCredentialConfirmation({
    workspaceId,
    repositoryId,
    repositoryFullName,
    authMode,
  });
  const name = managedKeyName(authMode);
  const secretName = getProviderAuthModeMetadata(authMode).secretNames[0];

  async function install(): Promise<void> {
    setInstallError(null);
    setInstalling(true);
    try {
      const { results } = await installManagedProviderKey({
        workspaceId,
        authMode,
        repositoryIds: [repositoryId],
      });
      const result = results.find((item) => item.repositoryId === repositoryId);
      if (result?.status !== "applied") {
        setInstallError(result?.errorReason ?? result?.status ?? "failed");
        return;
      }
      onInstalled?.();
      await confirmation.confirm({
        secretScope: "repository",
        mode: "verified",
      });
    } catch (error) {
      setInstallError(
        error instanceof Error ? error.message : "provider_key_apply_failed",
      );
    } finally {
      setInstalling(false);
    }
  }

  return (
    <div className="grid gap-4">
      <div className="grid gap-1">
        <h3 className="text-base font-semibold text-cyan-50">
          {installed
            ? `The ${name} key is installed`
            : `Install the ${name} key`}
        </h3>
        <p className="text-sm leading-6 text-slate-300">
          {installed
            ? `ReviewRouter wrote ${secretName} to the GitHub Actions secrets of ${repositoryFullName}. Check its availability to finish this step.`
            : `ReviewRouter writes its saved key as ${secretName} to the GitHub Actions secrets of ${repositoryFullName}. The key is never shown in the browser.`}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {installed ? (
          <Button
            type="button"
            size="sm"
            disabled={
              !canManage ||
              confirmation.submitting ||
              confirmation.confirmed !== null
            }
            aria-busy={confirmation.submitting}
            onClick={() =>
              void confirmation.confirm({
                secretScope: "repository",
                mode: "verified",
              })
            }
          >
            {confirmation.submitting
              ? "Checking the secret..."
              : confirmation.confirmed
                ? "Checked"
                : "Check GitHub setup"}
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            disabled={
              installDecisionReason !== null ||
              installing ||
              confirmation.submitting
            }
            aria-busy={installing}
            onClick={() => void install()}
          >
            {installing ? "Installing..." : "Install key"}
          </Button>
        )}
        {confirmation.confirmed ? (
          <Badge tone="success">Secret available</Badge>
        ) : null}
      </div>
      {!installed && installDecisionReason ? (
        <p className="text-xs leading-5 text-amber-100/85">
          {installDecisionReason}
        </p>
      ) : null}
      {installError ? (
        <p role="alert" className="text-sm leading-6 text-red-100">
          {managedKeyErrorText(installError)}
        </p>
      ) : null}
      {confirmation.verificationError ? (
        <p className="text-xs leading-5 text-amber-100/85">
          GitHub does not show {secretName} for this repository yet. Wait a
          moment and check again.
        </p>
      ) : null}
      {confirmation.submitError ? (
        <p role="alert" className="text-sm leading-6 text-red-100">
          {confirmErrorText(confirmation.submitError)}
        </p>
      ) : null}
      <p className="text-xs leading-5 text-slate-500">
        This checks GitHub secret availability, not a response from the model.
        The saved key is used in GitHub Actions.
      </p>
    </div>
  );
}

type RotatingSetupOperation = "issue" | "recovery" | "check";

type RotatingSetupCommandState =
  | { readonly status: "idle" }
  | { readonly status: "ready"; readonly value: CodexSetupCommand }
  | {
      readonly status: "error";
      readonly error: string;
      readonly operation: "issue" | "recovery";
      readonly outcomeUnknown: boolean;
    };

type RotatingProviderDeliveryProps = DeliveryRepository &
  Readonly<{
    enabled: boolean;
    canManage: boolean;
    onBusyChange?: (busy: boolean) => void;
  }>;

/** A different target must never inherit a previous repository's command. */
export function RotatingProviderDelivery(
  props: RotatingProviderDeliveryProps,
): React.ReactElement {
  return (
    <RotatingProviderDeliveryPanel
      key={`${props.workspaceId}:${props.repositoryId}`}
      {...props}
    />
  );
}

/** Connection commands are explicit mutations; opening this panel only reads. */
function RotatingProviderDeliveryPanel({
  workspaceId,
  repositoryId,
  repositoryFullName,
  enabled,
  canManage,
  onBusyChange,
}: RotatingProviderDeliveryProps): React.ReactElement {
  const queryClient = useQueryClient();
  const completion = useProviderSetupCompletion(workspaceId);
  const [operation, setOperation] = useState<RotatingSetupOperation | null>(
    null,
  );
  const operationRef = useRef<symbol | null>(null);
  const mounted = useRef(false);
  const busyCallback = useRef(onBusyChange);
  busyCallback.current = onBusyChange;
  const [commandState, setCommandState] = useState<RotatingSetupCommandState>({
    status: "idle",
  });
  const [suppressReadSuccess, setSuppressReadSuccess] = useState(false);
  const [recoveryAcknowledged, setRecoveryAcknowledged] = useState(false);
  const recoveryRequestId = useRef<string | null>(null);
  const busy = operation !== null;
  const confirmation = useCredentialConfirmation({
    workspaceId,
    repositoryId,
    repositoryFullName,
    authMode: "codex_subscription_oauth_rotating",
  });
  const status = useProviderSecretStatus({
    workspaceId,
    repositoryId,
    authMode: "codex_subscription_oauth_rotating",
    enabled: enabled && canManage && !busy,
    freshOnOpen: true,
  });
  const statusKey = providerSetupQueryKeys.secretStatus(
    workspaceId,
    repositoryId,
    "codex_subscription_oauth_rotating",
  );
  const connected =
    !busy &&
    !suppressReadSuccess &&
    status.isSuccess &&
    status.fetchStatus === "idle" &&
    status.data === "available_repository";
  const command = commandState.status === "ready" ? commandState.value : null;
  const deadlinePassed = useCommandStartDeadline(command?.expiresAt ?? null);
  const commandError = commandState.status === "error" ? commandState : null;
  const recoveryRequired =
    commandError?.error === "codex_rotating_setup_recovery_required" ||
    commandError?.operation === "recovery";
  const commandRetryAllowed =
    !commandError || rotatingCommandCanRetry(commandError.error);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      operationRef.current = null;
      busyCallback.current?.(false);
    };
  }, []);

  const current = (token: symbol) =>
    mounted.current && operationRef.current === token;

  async function begin(next: RotatingSetupOperation): Promise<symbol | null> {
    if (!enabled || !canManage || operationRef.current) return null;
    const token = Symbol(next);
    operationRef.current = token;
    setOperation(next);
    busyCallback.current?.(true);
    setSuppressReadSuccess(true);
    confirmation.resetVerification();
    // A read started before this mutation cannot restore its old green result.
    await queryClient.cancelQueries({ queryKey: statusKey, exact: true });
    queryClient.setQueryData(statusKey, "unknown");
    return current(token) ? token : null;
  }

  async function finish(token: symbol): Promise<void> {
    try {
      await queryClient.invalidateQueries({
        queryKey: statusKey,
        exact: true,
        refetchType: "none",
      });
      if (!current(token)) return;
      // Issuance itself can put a connected provider back into setup_pending.
      // Refresh the existing repository projection, including after lost replies.
      await completion.complete();
    } catch {
      if (current(token)) setSuppressReadSuccess(true);
    } finally {
      if (current(token)) {
        operationRef.current = null;
        setOperation(null);
        busyCallback.current?.(false);
      }
    }
  }

  function showCommandError(
    caught: unknown,
    attempted: "issue" | "recovery",
  ): void {
    const error =
      caught instanceof CodexSetupCommandError
        ? caught
        : new CodexSetupCommandError("codex_setup_outcome_unknown", true);
    setCommandState({
      status: "error",
      error: error.code,
      operation: attempted,
      outcomeUnknown: error.outcomeUnknown,
    });
  }

  async function issue(): Promise<void> {
    const token = await begin("issue");
    if (!token) return;
    setCommandState({ status: "idle" });
    try {
      const value = await requestCodexSetupCommand({
        workspaceId,
        repositoryId,
      });
      if (current(token)) setCommandState({ status: "ready", value });
    } catch (error) {
      if (current(token)) showCommandError(error, "issue");
    } finally {
      await finish(token);
    }
  }

  async function recover(): Promise<void> {
    if (!recoveryAcknowledged) return;
    const token = await begin("recovery");
    if (!token) return;
    const requestId = recoveryRequestId.current ?? crypto.randomUUID();
    recoveryRequestId.current = requestId;
    try {
      const value = await recoverCodexSetupCommand({
        workspaceId,
        repositoryId,
        recoveryRequestId: requestId,
        acknowledgement: "all_prior_installers_and_writers_are_stopped",
      });
      if (!current(token)) return;
      setCommandState({ status: "ready", value });
      setRecoveryAcknowledged(false);
      recoveryRequestId.current = null;
    } catch (error) {
      // Retain the operation and request ID: a lost reply can follow a commit.
      if (current(token)) showCommandError(error, "recovery");
    } finally {
      await finish(token);
    }
  }

  async function check(): Promise<void> {
    const token = await begin("check");
    if (!token) return;
    try {
      const verified = await confirmation.confirm({
        secretScope: "repository",
        mode: "verified",
      });
      if (!current(token) || !verified) return;
      setSuppressReadSuccess(false);
      setCommandState({ status: "idle" });
      setRecoveryAcknowledged(false);
      recoveryRequestId.current = null;
    } finally {
      await finish(token);
    }
  }

  return (
    <div className="grid gap-4">
      <div className="grid gap-1">
        <h3 className="text-base font-semibold text-cyan-50">
          Codex in GitHub Secrets
        </h3>
        <p className="text-sm leading-6 text-slate-300">
          Connect a dedicated Codex session for {repositoryFullName} from your
          own computer. Its credential stays in this repository&apos;s GitHub
          Actions secrets. Reviews refresh it automatically.
        </p>
      </div>
      {!enabled ? (
        <p className="text-sm text-red-100">
          {rotatingErrorText("codex_rotating_not_enabled")}
        </p>
      ) : !canManage ? (
        <p className="text-sm text-amber-100/85">
          You need write access to this repository on GitHub to connect or check
          Codex.
        </p>
      ) : (
        <p
          role="status"
          className={
            connected ? "text-sm text-emerald-100" : "text-sm text-slate-300"
          }
        >
          {operation === "check"
            ? "Checking this repository's Codex setup..."
            : connected
              ? `Codex is connected for ${repositoryFullName}.`
              : suppressReadSuccess
                ? "Setup needs to be checked again after the connection changes."
                : status.isPending || status.isFetching
                  ? "Checking this repository's Codex setup..."
                  : status.isSuccess && status.data === "missing"
                    ? "This repository's Codex setup is not confirmed yet. If you already ran a command, finish the setup PR and check here."
                    : "The current setup status could not be checked. Use Check GitHub setup to try again."}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          size="sm"
          disabled={!enabled || !canManage || busy}
          aria-busy={operation === "check"}
          onClick={() => void check()}
        >
          {operation === "check" ? "Checking setup..." : "Check GitHub setup"}
        </Button>
        {connected && confirmation.confirmed ? (
          <Badge tone="success">Setup verified</Badge>
        ) : null}
      </div>
      {confirmation.submitError ? (
        <p role="alert" className="text-sm leading-6 text-red-100">
          {confirmErrorText(confirmation.submitError)}
        </p>
      ) : null}
      <p className="text-xs leading-5 text-slate-400">
        This checks the repository workflow and Codex setup, not a response from
        the model. If the command has finished, return to repository setup to
        finish or merge its setup PR before checking here.
      </p>

      <div className="grid gap-3 border-t border-cyan-200/10 pt-4">
        <p className="text-sm leading-6 text-slate-300">
          Requesting a setup command can pause the current connection before you
          run it. Use it only to connect or reconnect Codex. If you already ran
          one, check the setup first.
        </p>
        {operation === "issue" || operation === "recovery" ? (
          <p role="status" className="text-sm text-cyan-100">
            {operation === "recovery"
              ? "Recovering setup..."
              : "Creating a setup command..."}
          </p>
        ) : null}
        {command ? (
          <>
            <p className="text-sm leading-6 text-slate-200">
              Start this command by{" "}
              <time dateTime={command.expiresAt}>
                {new Date(command.expiresAt).toLocaleString(undefined, {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </time>
              . Run it in a terminal on your computer.
            </p>
            <CodeBlock
              code={command.command}
              language="bash"
              className="rounded-xl p-3 text-xs leading-5"
            />
            {deadlinePassed ? (
              <p role="status" className="text-sm leading-6 text-amber-100/85">
                The start deadline has passed. If you have not started this
                command, get a fresh one. If it is already running, let it
                finish, then return to repository setup.
              </p>
            ) : (
              <p className="text-xs leading-5 text-slate-400">
                This is the deadline to start, not a time limit for an installer
                that is already running. A new request may return the same
                command while it is still valid.
              </p>
            )}
          </>
        ) : null}
        {commandError ? (
          <div
            role="alert"
            className="grid gap-2 text-sm leading-6 text-red-100"
          >
            <p>
              {commandError.outcomeUnknown
                ? commandError.operation === "recovery"
                  ? "The recovery result is unknown. The server may already have changed the setup. Check the setup or retry this recovery request."
                  : "The setup command result is unknown. The server may already have changed the connection. Check the setup before requesting another command."
                : rotatingErrorText(commandError.error)}
            </p>
          </div>
        ) : null}
        {recoveryRequired && commandRetryAllowed ? (
          <div className="grid gap-3">
            <p className="text-sm leading-6 text-slate-300">
              If the setup PR is already merged, check the setup above before
              recovering it.
            </p>
            <label className="flex items-start gap-3 text-sm leading-6 text-slate-200">
              <Checkbox
                checked={recoveryAcknowledged}
                disabled={busy}
                onChange={(event) =>
                  setRecoveryAcknowledged(event.target.checked)
                }
                className="mt-1 h-4 w-4"
              />
              <span>
                I confirm every earlier installer and review run is stopped. The
                GitHub secret may already have changed; recovery waits for the
                safety deadline before it issues a fresh command.
              </span>
            </label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-fit"
              disabled={!enabled || !canManage || !recoveryAcknowledged || busy}
              onClick={() => void recover()}
            >
              {commandError?.operation === "recovery"
                ? "Retry recovery"
                : "Recover and get a setup command"}
            </Button>
          </div>
        ) : !recoveryRequired && commandRetryAllowed ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-fit"
            disabled={!enabled || !canManage || busy}
            aria-busy={operation === "issue"}
            onClick={() => void issue()}
          >
            {command
              ? "Get a fresh command"
              : commandError
                ? "Retry setup command"
                : connected
                  ? "Reconnect Codex"
                  : "Get setup command"}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/** Updates presentation only; elapsed time must never issue or recover setup. */
function useCommandStartDeadline(expiresAt: string | null): boolean {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    if (!expiresAt) return;
    const refresh = () => setNow(Date.now());
    const remaining = Date.parse(expiresAt) - Date.now();
    const timer =
      remaining > 0
        ? window.setTimeout(refresh, Math.min(remaining + 1, 2_147_483_647))
        : null;
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [expiresAt]);
  return expiresAt !== null && Date.parse(expiresAt) <= now;
}

function rotatingCommandCanRetry(error: string): boolean {
  return ![
    "codex_rotating_setup_issuance_quiesced",
    "codex_rotating_identity_quarantined",
    "codex_rotating_mutation_ownership_ambiguous",
    "codex_rotating_provider_identity_mismatch",
    "codex_rotating_setup_recovery_already_used",
    "codex_rotating_setup_recovery_not_required",
    "codex_rotating_setup_recovery_request_conflict",
    "codex_rotating_remote_outcome_unknown",
    "repository_not_found",
    "repository_not_selected",
    "repository_archived",
    "installation_not_active",
    "repository_mutation_forbidden",
    "workspace_mutation_forbidden",
    "dashboard_mutation_requires_sign_in",
    "dashboard_auth_misconfigured",
    "dashboard_mutations_disabled",
    "codex_rotating_not_enabled",
    "codex_rotating_installer_missing",
    "codex_rotating_installer_descriptor_incomplete",
    "invalid_codex_rotating_installer_sha256",
    "invalid_review_router_web_url",
    "server_misconfigured",
  ].includes(error);
}

function ciSecretDetails(
  authMode: UserCiSecretAuthMode,
  repositoryFullName: string,
): Readonly<{
  title: string;
  body: string;
  prompt: string;
  footnote: string;
  link: Readonly<{ label: string; url: string }> | null;
}> {
  const provider = apiKeyProviderForAuthMode(authMode);
  if (provider) {
    const label = getApiKeyProvider(provider).label;
    return {
      title: `Add your ${label} key`,
      body: `Store its API key as a GitHub Actions secret of ${repositoryFullName}.`,
      prompt: "Paste the key when the command asks for it.",
      footnote:
        "The key stays in GitHub Secrets and is not sent to ReviewRouter.",
      link: null,
    };
  }
  return {
    title: "Add your Claude Code token",
    body: `Reviews use your Claude Code subscription. Store its token as a GitHub Actions secret of ${repositoryFullName}.`,
    prompt: "Paste only the printed token when the command asks for it.",
    footnote: "Do not paste an ANTHROPIC_API_KEY or Claude config files.",
    link: null,
  };
}

/** The plain name of a key ReviewRouter saves for a managed provider. */
export function managedKeyName(
  authMode: "mimo_token_plan_api_key" | "openrouter_api_key",
): string {
  return authMode === "mimo_token_plan_api_key"
    ? "MiMo Token Plan"
    : "OpenRouter";
}

function secretScopeOptions(input: {
  readonly organizationLogin: string | null;
  readonly organizationSecretPolicy: OrganizationSecretPolicy | null;
  readonly repositoryFullName: string;
  readonly repositoryVisibility: string;
}): readonly {
  readonly scope: ProviderSecretScope;
  readonly title: string;
  readonly body: string;
  readonly disabled: boolean;
}[] {
  const repository = {
    scope: "repository" as const,
    title: "This repository",
    body: `A secret of ${input.repositoryFullName} only. Needs write access.`,
    disabled: false,
  };
  if (!input.organizationLogin) return [repository];
  const disabled =
    input.repositoryVisibility === "private" &&
    input.organizationSecretPolicy?.privateRepositoriesAvailable === false;
  const unavailable = "Not available for private repositories on this plan.";
  return [
    repository,
    {
      scope: "organization_selected_repositories",
      title: "Organization, selected repositories",
      body: disabled
        ? unavailable
        : `One ${input.organizationLogin} secret shared with the repositories you choose on GitHub.`,
      disabled,
    },
    {
      scope: "organization_private_repositories",
      title: "Organization, private repositories",
      body: disabled
        ? unavailable
        : `Shared with every private repository of ${input.organizationLogin}.`,
      disabled,
    },
    {
      scope: "organization_all_repositories",
      title: "Organization, all repositories",
      body: disabled
        ? unavailable
        : `Shared with every repository of ${input.organizationLogin}.`,
      disabled,
    },
  ];
}

function isVerificationFallbackError(
  value: unknown,
): value is VerificationFallbackError {
  return (
    value === "repository_not_visible_to_github_app" ||
    value === "provider_secret_not_found" ||
    value === "provider_secret_not_available_to_repository" ||
    value === "provider_secret_check_permission_required"
  );
}

function verificationErrorAllowsManual(
  error: VerificationFallbackError | null,
): boolean {
  return (
    error === "provider_secret_check_permission_required" ||
    error === "repository_not_visible_to_github_app"
  );
}

function verificationErrorText(input: {
  readonly error: VerificationFallbackError;
  readonly scope: ProviderSecretScope;
  readonly secretNames: string;
  readonly repositoryFullName: string;
  readonly organizationLogin: string | null;
}): string {
  switch (input.error) {
    case "provider_secret_not_found":
      return input.scope === "repository"
        ? `${input.secretNames} is not in the Actions secrets of ${input.repositoryFullName} yet. Run the command, then check again.`
        : `${input.secretNames} is not an Actions secret of ${input.organizationLogin ?? "the organization"} yet. Ask an organization owner to add it, or use a repository secret.`;
    case "provider_secret_not_available_to_repository":
      return `${input.secretNames} exists in the organization, but ${input.repositoryFullName} is not allowed to use it. Add the repository under the secret's repository access on GitHub, or use a repository secret.`;
    case "repository_not_visible_to_github_app":
      return "ReviewRouter cannot read this repository through its GitHub App. Confirm manually only if GitHub shows the secret.";
    case "provider_secret_check_permission_required":
      return "ReviewRouter cannot read the secret list on GitHub. Confirm manually only if GitHub shows the secret and the repository can use it.";
  }
}

function confirmErrorText(error: string): string {
  switch (error) {
    case "dashboard_action_stale":
      return "The dashboard changed while this page was open. Refresh the page, then try again.";
    case "github_operation_forbidden":
      return "GitHub refused the check. Check the ReviewRouter GitHub App permissions, then retry.";
    case "github_operation_not_found":
      return "GitHub could not find the repository or its secrets. Sync repositories, then retry.";
    case "github_service_unavailable":
      return "GitHub is not available right now. Retry later.";
    case "rate_limited":
      return "Too many requests for this repository. Wait a little, then retry.";
    case "repository_mutation_forbidden":
      return "You need write, maintain or admin access to this repository on GitHub.";
    case "workspace_mutation_forbidden":
      return "You cannot change this workspace.";
    case "entitlement_denied":
      return "The workspace plan does not include this.";
    case "codex_rotating_not_enabled":
      return rotatingErrorText(error);
    case "codex_rotating_setup_not_ready":
      return "The Codex connection is not ready. Return to repository setup to finish or merge its setup PR, then check again.";
    case "codex_rotating_workflow_namespace_not_ready":
      return "The workflow does not match this Codex connection yet. Return to repository setup to create or merge its setup PR, then check again.";
    case "codex_setup_confirmation_outcome_unknown":
      return "The check did not return a result. The server may already have completed it. Check again; a new setup command is not needed for this check.";
    default:
      return "The setup could not be saved. Retry once; if it repeats, contact support.";
  }
}

export function managedKeyErrorText(code: string): string {
  switch (code) {
    case "workspace_admin_forbidden":
      return "Only workspace owners and admins install keys.";
    case "stored_api_key_unavailable":
      return "There is no saved key yet. Add the provider again with its key.";
    case "repository_not_available_to_github_app":
      return "The ReviewRouter GitHub App cannot reach this repository.";
    case "insufficient_permissions":
      return "The GitHub App cannot write repository secrets. Approve the Secrets permission, then retry.";
    case "rate_limited":
      return "GitHub rate limit reached. Retry later.";
    case "provider_key_reconciliation_required":
    case "persistence_failed":
      return "GitHub accepted the key, but ReviewRouter must reconcile its status. Retry in a minute.";
    case "provider_key_storage_not_configured":
      return "Key storage is not configured on this server.";
    default:
      return code.startsWith("entitlement_denied")
        ? "The workspace plan does not include managed keys."
        : "The key could not be installed. Retry once; if it repeats, contact support.";
  }
}

function rotatingErrorText(error: string): string {
  switch (error) {
    case "codex_rotating_not_enabled":
      return "Codex with automatic refresh is not enabled on this ReviewRouter server.";
    case "codex_rotating_setup_issuance_quiesced":
      return "New Codex setup commands are paused for maintenance. Wait until they reopen; do not retry now.";
    case "repository_not_found":
    case "repository_not_selected":
      return "This repository is not selected for the GitHub App. Sync repositories, then reopen this dialog.";
    case "repository_archived":
      return "Archived repositories cannot be set up.";
    case "installation_not_active":
      return "The GitHub App installation is not active. Reinstall or reconnect it.";
    case "repository_mutation_forbidden":
    case "workspace_mutation_forbidden":
      return "You need write, maintain or admin access to this repository on GitHub.";
    case "rate_limited":
      return "Too many setup commands for this repository. Wait a little, then retry.";
    case "codex_rotating_setup_in_progress":
      return "Another setup command for this repository is still open. Finish it or wait until it expires.";
    case "codex_rotating_setup_recovery_required":
      return "An earlier setup command was used, so the GitHub secret may already have changed. Setup stays blocked until someone with access recovers it.";
    case "codex_rotating_identity_quarantined":
      return "This setup is quarantined. An operator must repair it; recovery does not rewrite it.";
    case "codex_rotating_provider_identity_mismatch":
      return "This connection no longer matches the repository. Contact an operator before trying to reconnect.";
    case "codex_rotating_setup_recovery_already_used":
      return "This recovery request has already been used. Check the setup before starting another recovery.";
    case "codex_rotating_setup_recovery_not_required":
      return "Recovery is not needed for this connection. Check the setup instead.";
    case "codex_rotating_remote_outcome_unknown":
      return "GitHub may have accepted an earlier credential update. Keep earlier installers stopped and check setup. Contact an operator if it remains blocked.";
    case "codex_rotating_mutation_fence_conflict":
      return "A review run is still updating this credential. Wait for it to finish, then retry.";
    case "codex_rotating_mutation_still_active":
      return "An earlier installer or review run may still be writing. Stop it and wait for the safety deadline before retrying.";
    case "codex_rotating_mutation_ownership_ambiguous":
      return "ReviewRouter cannot tell which installer owns the current change. Keep setup blocked and contact an operator.";
    case "codex_rotating_setup_recovery_request_conflict":
      return "Another recovery is already in progress for this repository. Finish that recovery or check the setup before starting again.";
    case "codex_rotating_setup_lock_failed":
      return "Another request is setting up this repository. Wait a few seconds, then retry.";
    case "codex_rotating_installer_missing":
    case "codex_rotating_installer_descriptor_incomplete":
    case "invalid_codex_rotating_installer_sha256":
    case "invalid_review_router_web_url":
    case "dashboard_auth_misconfigured":
    case "server_misconfigured":
      return "The Codex installer is not configured on this server. This is a deployment problem, not something to fix on GitHub.";
    case "dashboard_mutation_requires_sign_in":
      return "Sign in again, then reopen this repository's setup.";
    case "dashboard_mutations_disabled":
      return "Setup changes are disabled on this server. You can return when they are enabled again.";
    default:
      return "ReviewRouter could not create the setup command. Retry once; if it repeats, send this error code to support.";
  }
}
