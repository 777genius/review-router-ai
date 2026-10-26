"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type {
  ProviderSecretScope,
  ProviderSecretSetupCommand,
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
  installManagedProviderKey,
  providerSetupQueryKeys,
  useProviderSecretStatus,
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

  async function confirm(input2: {
    readonly secretScope: ProviderSecretScope;
    readonly mode: "verified" | "manual";
  }): Promise<boolean> {
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
      });
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
      setSubmitError("dashboard_action_stale");
      return false;
    } finally {
      setSubmitting(false);
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
                  option.disabled
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
                  disabled={option.disabled}
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

type RotatingSetupCommandState =
  | { readonly status: "idle" | "loading" }
  | {
      readonly status: "ready";
      readonly command: ProviderSecretSetupCommand;
      readonly expiresAt: string;
      readonly providerInstanceId: string;
    }
  | { readonly status: "error"; readonly error: string };

/**
 * Codex subscription with automatic refresh: a short-lived command writes a
 * server-authorized, never-reused credential namespace into the repository
 * before its workflow is merged; verification then checks the activation.
 */
export function RotatingProviderDelivery({
  workspaceId,
  repositoryId,
  repositoryFullName,
  enabled,
  canManage,
  preparationOnly,
}: DeliveryRepository &
  Readonly<{
    /** The deployment allows rotating Codex for this repository. */
    enabled: boolean;
    canManage: boolean;
    /** Before the first setup PR: prepare the namespace the PR references. */
    preparationOnly: boolean;
  }>): React.ReactElement {
  const [commandState, setCommandState] = useState<RotatingSetupCommandState>({
    status: "idle",
  });
  const [refreshKey, setRefreshKey] = useState(0);
  const [recoveryAcknowledged, setRecoveryAcknowledged] = useState(false);
  const [recoverySubmitting, setRecoverySubmitting] = useState(false);
  const [recoveryRequestId, setRecoveryRequestId] = useState<string | null>(
    null,
  );
  const confirmation = useCredentialConfirmation({
    workspaceId,
    repositoryId,
    repositoryFullName,
    authMode: "codex_subscription_oauth_rotating",
  });
  const fetchCommand = enabled && canManage;

  useEffect(() => {
    if (!fetchCommand) return;
    let cancelled = false;
    const formData = new FormData();
    formData.set("workspaceId", workspaceId);
    formData.set("repositoryId", repositoryId);
    setCommandState({ status: "loading" });
    void fetch("/api/dashboard/codex-rotating/setup-command", {
      method: "POST",
      body: formData,
    })
      .then(async (response) => {
        const body: unknown = await response.json();
        if (!response.ok || !isRotatingSetupCommandResponse(body))
          throw new Error(responseErrorCode(body));
        if (cancelled) return;
        setCommandState({
          status: "ready",
          expiresAt: body.expiresAt,
          providerInstanceId: body.providerInstanceId,
          command: rotatingCommand(body.command, repositoryFullName, false),
        });
      })
      .catch((error: unknown) => {
        if (!cancelled)
          setCommandState({
            status: "error",
            error: error instanceof Error ? error.message : "unknown_error",
          });
      });
    return () => {
      cancelled = true;
    };
  }, [fetchCommand, refreshKey, repositoryFullName, repositoryId, workspaceId]);

  const recoveryRequired =
    commandState.status === "error" &&
    commandState.error === "codex_rotating_setup_recovery_required";

  function recover(): void {
    const formData = new FormData();
    formData.set("workspaceId", workspaceId);
    formData.set("repositoryId", repositoryId);
    formData.set(
      "acknowledgement",
      "all_prior_installers_and_writers_are_stopped",
    );
    const requestId = recoveryRequestId ?? crypto.randomUUID();
    setRecoveryRequestId(requestId);
    formData.set("recoveryRequestId", requestId);
    setRecoverySubmitting(true);
    void fetch("/api/dashboard/codex-rotating/setup-recovery", {
      method: "POST",
      body: formData,
    })
      .then(async (response) => {
        const body: unknown = await response.json();
        if (!response.ok || !isRotatingSetupCommandResponse(body))
          throw new Error(responseErrorCode(body));
        setCommandState({
          status: "ready",
          expiresAt: body.expiresAt,
          providerInstanceId: body.providerInstanceId,
          command: rotatingCommand(body.command, repositoryFullName, true),
        });
        setRecoveryAcknowledged(false);
        setRecoveryRequestId(null);
      })
      .catch((error: unknown) =>
        setCommandState({
          status: "error",
          error:
            error instanceof Error ? error.message : "dashboard_action_failed",
        }),
      )
      .finally(() => setRecoverySubmitting(false));
  }

  return (
    <div className="grid gap-4">
      <div className="grid gap-1">
        <h3 className="text-base font-semibold text-cyan-50">
          Connect your Codex subscription
        </h3>
        <p className="text-sm leading-6 text-slate-300">
          Run this command from a terminal on your own computer. It signs in to
          a dedicated Codex session for {repositoryFullName} and stores only a
          server-authorized credential in this repository&apos;s GitHub Actions
          secrets. Reviews refresh it automatically.
        </p>
      </div>
      <ol className="grid list-decimal gap-1.5 pl-5 text-sm leading-6 text-slate-200">
        <li>Run the command below on your computer.</li>
        <li>
          {preparationOnly
            ? "Create and merge the setup PR; it uses the credential you just stored."
            : "Make sure the setup PR is merged."}
        </li>
        <li>Come back here and verify the setup.</li>
      </ol>
      {!enabled ? (
        <p className="text-sm text-red-100">
          {rotatingErrorText("codex_rotating_not_enabled")}
        </p>
      ) : !canManage ? (
        <p className="text-xs leading-5 text-amber-100/85">
          You need write access to this repository on GitHub to get the setup
          command.
        </p>
      ) : commandState.status === "loading" ? (
        <p role="status" className="text-sm text-cyan-100">
          Creating a short-lived setup command...
        </p>
      ) : commandState.status === "error" ? (
        <div className="grid gap-3 text-sm leading-6 text-red-100">
          <p>{rotatingErrorText(commandState.error)}</p>
          {recoveryRequired ? (
            <div className="grid gap-3 border-t border-red-200/15 pt-3">
              <p className="text-red-50">
                If the setup PR is already merged, verify the setup below before
                issuing another command.
              </p>
              <label className="flex items-start gap-3 text-red-50">
                <Checkbox
                  checked={recoveryAcknowledged}
                  onChange={(event) =>
                    setRecoveryAcknowledged(event.target.checked)
                  }
                  className="mt-1 h-4 w-4"
                />
                <span>
                  I confirm every earlier installer and review run is stopped.
                  The GitHub secret may already have changed; recovery waits for
                  the safety deadline before it issues a fresh command.
                </span>
              </label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-fit"
                disabled={!recoveryAcknowledged || recoverySubmitting}
                onClick={recover}
              >
                {recoverySubmitting
                  ? "Recovering setup..."
                  : "Recover and issue a fresh command"}
              </Button>
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                confirmation.resetVerification();
                setRefreshKey((value) => value + 1);
              }}
            >
              Retry setup command
            </Button>
            <span className="text-xs text-red-100/70">
              Error code: {commandState.error}
            </span>
          </div>
        </div>
      ) : commandState.status === "ready" ? (
        <CodeBlock
          code={commandState.command.command}
          language="bash"
          className="rounded-xl p-3 text-xs leading-5"
        />
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          size="sm"
          disabled={
            !enabled ||
            !canManage ||
            confirmation.submitting ||
            confirmation.confirmed !== null ||
            (commandState.status !== "ready" && !recoveryRequired)
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
            ? "Checking the setup..."
            : confirmation.confirmed
              ? "Confirmed"
              : "Verify setup"}
        </Button>
        {confirmation.confirmed ? <Badge tone="success">Done</Badge> : null}
      </div>
      {confirmation.submitError ? (
        <p role="alert" className="text-sm leading-6 text-red-100">
          {confirmErrorText(confirmation.submitError)}
        </p>
      ) : null}
      {confirmation.confirmed ? (
        <p role="status" className="text-sm leading-6 text-emerald-50">
          The Codex subscription is active for {repositoryFullName}.
        </p>
      ) : null}
    </div>
  );
}

function rotatingCommand(
  command: string,
  repositoryFullName: string,
  recovered: boolean,
): ProviderSecretSetupCommand {
  return {
    scope: "repository",
    title: recovered
      ? "Recovered repository secret setup"
      : "Repository secret with automatic refresh",
    description: recovered
      ? "Runs one forced reseed after the unknown GitHub secret result was fenced."
      : "Allocates one server-authorized, never-reused versioned secret in this repository.",
    command,
    storesSecretIn: "github_repository_secret",
    targetLabel: `${repositoryFullName} repository secret`,
    secretNames: ["Server-authorized versioned secret"],
    selectedRepositories: [repositoryFullName],
    validatesBeforeWrite: true,
    failureRecovery: recovered
      ? "If this command is fetched but not confirmed, return here and explicitly recover again."
      : "If CI reports needs_reconnect or unknown_auth_state, reopen this dialog and run a fresh setup command.",
    sendsSecretToReviewRouter: false,
  };
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
    prompt:
      "Run claude setup-token first, then paste only the printed token when the command asks for it.",
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
      return "The Codex setup is not active yet. Run the command, merge its setup PR, then verify again.";
    case "codex_rotating_workflow_namespace_not_ready":
      return "The Codex setup is unfinished. Run a fresh command above, merge its setup PR, then verify again.";
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
    case "codex_rotating_mutation_fence_conflict":
      return "A review run is still updating this credential. Wait for it to finish, then retry.";
    case "codex_rotating_mutation_still_active":
      return "An earlier installer or review run may still be writing. Stop it and wait for the safety deadline before retrying.";
    case "codex_rotating_mutation_ownership_ambiguous":
      return "ReviewRouter cannot tell which installer owns the current change. Keep setup blocked and contact an operator.";
    case "codex_rotating_setup_recovery_request_conflict":
      return "Another recovery request already owns this repository. Retry that request instead.";
    case "codex_rotating_setup_lock_failed":
      return "Another request is setting up this repository. Wait a few seconds, then retry.";
    case "codex_rotating_installer_missing":
    case "codex_rotating_installer_descriptor_incomplete":
    case "invalid_codex_rotating_installer_sha256":
    case "invalid_review_router_web_url":
    case "server_misconfigured":
      return "The Codex installer is not configured on this server. This is a deployment problem, not something to fix on GitHub.";
    default:
      return "ReviewRouter could not create the setup command. Retry once; if it repeats, send this error code to support.";
  }
}

function isRotatingSetupCommandResponse(input: unknown): input is {
  readonly command: string;
  readonly expiresAt: string;
  readonly providerInstanceId: string;
} {
  if (!input || typeof input !== "object") return false;
  const candidate = input as Record<string, unknown>;
  return (
    typeof candidate.command === "string" &&
    typeof candidate.expiresAt === "string" &&
    typeof candidate.providerInstanceId === "string"
  );
}

function responseErrorCode(body: unknown): string {
  return body && typeof body === "object" && "error" in body
    ? String((body as { readonly error?: unknown }).error)
    : "dashboard_action_failed";
}
