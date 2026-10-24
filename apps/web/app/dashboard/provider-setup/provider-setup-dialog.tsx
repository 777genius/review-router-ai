"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ProviderSecretSetupGuidance } from "@reviewrouter/features-provider-setup";
import {
  getDefaultProviderConfigForAuthMode,
  providerKindForAuthMode,
  type ProviderAuthMode,
  type ReviewModelOption,
} from "@reviewrouter/features-review-providers";
import {
  Badge,
  Button,
  Checkbox,
  DialogBackdrop,
  DialogCloseButton,
  DialogDescription,
  DialogPopup,
  DialogPortal,
  DialogRoot,
  DialogTitle,
  DialogTrigger,
  RadioCard,
  RadioCardGroup,
  SelectField,
  TextField,
} from "@reviewrouter/ui";
import type { ProviderCredentialKind } from "@reviewrouter/features-review-config/workspace-provider-profile";
import {
  credentialStepLabel,
  credentialStepOf,
  providerSetupDenialText,
  sourceTitle,
  type CredentialStepKind,
  type ProviderProfileOption,
  type ProviderSelectionSettings,
  type ProviderSetupDecision,
  type ProviderSetupView,
  type ProviderSourceKey,
  type ProviderSourceOption,
} from "../../../src/features/provider-setup/provider-setup-model";
import type {
  AccountsPage,
  AccountsResult,
} from "../../../src/server/account-gateway-accounts";
import { getReadyGatewayAccounts } from "../../../src/server/dashboard-provider-setup-readiness";
import type { GatewayAgentProfileOption } from "../../../src/server/gateway-agent-profile-options";
import { personalAccountOriginText } from "../../../src/features/account-gateway/personal-accounts";
import { dashboardErrorText } from "../dashboard-copy";
import { GatewayConnectionTest } from "../gateway-connection-test";
import { useGatewayModelAccounts } from "../gateway-model-account-options";
import { ProviderAuthLogoFrame } from "../provider-auth-logo";
import { useProviderModelCatalogs } from "../provider-model-catalog";
import type { ProviderSetupAssignmentResult } from "../provider-setup-actions";
import {
  CiSecretDelivery,
  ManagedKeyDelivery,
  RotatingProviderDelivery,
  type OrganizationSecretPolicy,
} from "./provider-credential-delivery";
import {
  defaultProviderSelectionSettings,
  fitProviderSelectionSettings,
  ProviderModelFields,
  ProviderModelPicker,
} from "./provider-model-fields";
import {
  createProviderProfile,
  inheritWorkspaceDefaultProvider,
  installManagedProviderKey,
  saveProviderSetup,
  useProviderSetupCompletion,
  useProviderSetupView,
} from "./provider-setup-api";

/** Server-rendered facts of one repository the dialog may need offline. */
export type ProviderSetupRepositoryContext = Readonly<{
  id: string;
  fullName: string;
  visibility: string;
  /** Write access, needed to add or confirm its credentials. */
  canManageCredentials: boolean;
  /** The provider it reviews with now; null when none applies. */
  effective: Readonly<{
    authMode: ProviderAuthMode;
    credentialKind: ProviderCredentialKind;
  }> | null;
  secretGuidance: Readonly<{
    claude_code_oauth: ProviderSecretSetupGuidance;
    mimo_token_plan_api_key: ProviderSecretSetupGuidance;
  }> | null;
  organizationLogin: string | null;
  organizationSecretPolicy: OrganizationSecretPolicy | null;
  rotatingEnabled: boolean;
  /** Rotating Codex before the first setup PR: prepare its credential. */
  rotatingPreparationOnly: boolean;
}>;

export type ProviderSetupDialogTarget =
  | Readonly<{ kind: "workspace" }>
  | Readonly<{ kind: "repository"; repository: ProviderSetupRepositoryContext }>
  | Readonly<{
      kind: "repositories";
      repositories: readonly Readonly<{ id: string; fullName: string }>[];
    }>;

export type ProviderSetupDialogProps = Readonly<{
  workspaceId: string;
  target: ProviderSetupDialogTarget;
  /**
   * `choose` (default) picks the provider of the target. `add`, for the
   * workspace target only, adds a new provider to the workspace list and may
   * also make it the default.
   */
  mode?: "choose" | "add";
  /** Workspace target: the provider to offer first, such as "Make default". */
  initialProfileId?: string;
  /** Which part opens first; credentials only for one repository. */
  initialStep?: "provider" | "credentials";
  triggerLabel: ReactNode;
  triggerVariant?: "solid" | "soft" | "outline" | "ghost";
  triggerSize?: "sm" | "md" | "lg";
  triggerClassName?: string;
  triggerDisabled?: boolean;
  triggerTitle?: string;
  mutationsEnabled: boolean;
  modelOptions: readonly ReviewModelOption[];
  gatewayAccounts: AccountsResult<AccountsPage> | undefined;
  agentProfileOptions: readonly GatewayAgentProfileOption[];
  /** Called once the dialog closes after it saved something. */
  onSaved?: () => void;
}>;

type Choice =
  | Readonly<{ kind: "default" }>
  | Readonly<{ kind: "profile"; profileId: string }>
  | Readonly<{ kind: "new"; source: ProviderSourceKey }>;

type DraftProvider = Readonly<{
  model: string;
  bindingId: string;
  apiKey: string;
}>;

const newProviderChoice = "__new__";
const defaultChoice = "__default__";

/**
 * The single place to choose a review provider: for the workspace default,
 * for one repository, or for several at once. The target is fixed by the
 * caller; the dialog never asks which repositories it is for.
 */
export function ProviderSetupDialog(
  props: ProviderSetupDialogProps,
): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [locked, setLocked] = useState(false);
  // The target the dialog opened with: a selection the page clears after a
  // save must not retarget the dialog or the results it still shows.
  const [openedTarget, setOpenedTarget] = useState(props.target);
  const saved = useRef(false);
  const close = () => {
    setOpen(false);
    if (saved.current) {
      saved.current = false;
      props.onSaved?.();
    }
  };
  return (
    <DialogRoot
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setOpenedTarget(props.target);
          saved.current = false;
          setOpen(true);
          return;
        }
        if (!locked) close();
      }}
    >
      <DialogTrigger
        render={
          <Button
            type="button"
            variant={props.triggerVariant ?? "outline"}
            size={props.triggerSize ?? "sm"}
            className={props.triggerClassName}
            disabled={props.triggerDisabled}
            title={props.triggerTitle}
          />
        }
      >
        {props.triggerLabel}
      </DialogTrigger>
      <DialogPortal>
        <DialogBackdrop />
        <DialogPopup className="w-[min(96vw,46rem)] p-0">
          <DialogCloseButton label="Close provider setup" disabled={locked} />
          {open ? (
            <ProviderSetupDialogBody
              {...props}
              target={openedTarget}
              onSaved={() => {
                saved.current = true;
              }}
              onLockedChange={setLocked}
              onClose={close}
            />
          ) : null}
        </DialogPopup>
      </DialogPortal>
    </DialogRoot>
  );
}

function ProviderSetupDialogBody({
  workspaceId,
  target,
  mode = "choose",
  initialProfileId,
  initialStep = "provider",
  mutationsEnabled,
  modelOptions,
  gatewayAccounts,
  agentProfileOptions,
  onSaved,
  onLockedChange,
  onClose,
}: ProviderSetupDialogProps &
  Readonly<{
    onLockedChange: (locked: boolean) => void;
    onClose: () => void;
  }>): React.ReactElement {
  const repositoryIds =
    target.kind === "workspace"
      ? []
      : target.kind === "repository"
        ? [target.repository.id]
        : target.repositories.map((repository) => repository.id);
  const view = useProviderSetupView({
    workspaceId,
    repositoryIds,
    enabled: true,
  });
  const completion = useProviderSetupCompletion(workspaceId);
  const repository = target.kind === "repository" ? target.repository : null;
  const [step, setStep] = useState<"provider" | "credentials" | "results">(
    initialStep === "credentials" && repository?.effective
      ? "credentials"
      : "provider",
  );
  // A save that moves on replaces the content under the focus: take the
  // focus to the step now shown instead of losing it to the page.
  const stepNav = useRef<HTMLOListElement>(null);
  const handledStep = useRef(step);
  useEffect(() => {
    if (step === handledStep.current) return;
    handledStep.current = step;
    stepNav.current
      ?.querySelector<HTMLButtonElement>('[aria-current="step"]')
      ?.focus();
  }, [step]);
  // What the repository uses after a save, before the page refreshes.
  const [saved, setSaved] = useState<{
    readonly authMode: ProviderAuthMode;
    readonly credentialKind: ProviderCredentialKind;
  } | null>(null);
  const [results, setResults] = useState<
    readonly ProviderSetupAssignmentResult[]
  >([]);
  const effective = saved ?? repository?.effective ?? null;
  const credentialStep =
    repository && effective ? credentialStepOf(effective) : null;

  const adding = mode === "add" && target.kind === "workspace";
  const title = adding
    ? "Add a provider"
    : target.kind === "workspace"
      ? "Workspace default provider"
      : target.kind === "repository"
        ? `Provider for ${target.repository.fullName}`
        : `Provider for ${target.repositories.length} repositories`;
  const description = adding
    ? "It joins this workspace's providers. Repositories use it once it is chosen for them or made the default."
    : target.kind === "workspace"
      ? "Repositories without a provider of their own review with this one."
      : target.kind === "repository"
        ? step === "credentials"
          ? "Add the credential this provider needs in this repository."
          : "Choose which AI provider reviews pull requests in this repository."
        : "Every selected repository gets this provider. The workspace default does not change.";

  return (
    <div className="grid">
      <div className="border-b border-cyan-200/10 px-5 pb-4 pt-5 pr-14 sm:px-6">
        <DialogTitle className="text-xl text-cyan-50">{title}</DialogTitle>
        <DialogDescription className="text-sm leading-6 text-slate-300">
          {description}
        </DialogDescription>
        {repository && credentialStep ? (
          <nav aria-label="Provider setup steps" className="mt-4">
            <ol
              ref={stepNav}
              className="inline-flex rounded-xl border border-cyan-200/12 bg-slate-950/50 p-1"
            >
              <li>
                <StepButton
                  current={step === "provider"}
                  onSelect={() => setStep("provider")}
                >
                  1. Provider
                </StepButton>
              </li>
              <li>
                <StepButton
                  current={step === "credentials"}
                  onSelect={() => setStep("credentials")}
                >
                  2. {credentialStepLabel(credentialStep)}
                </StepButton>
              </li>
            </ol>
          </nav>
        ) : null}
      </div>
      <div className="px-5 py-5 sm:px-6">
        {step === "credentials" && repository && credentialStep ? (
          <CredentialStep
            workspaceId={workspaceId}
            repository={repository}
            credentialStep={credentialStep}
            authMode={effective!.authMode}
            view={view.data}
            onInstalled={() => void completion.complete()}
          />
        ) : step === "results" ? (
          <AssignmentResults results={results} onDone={onClose} />
        ) : view.isPending ? (
          <p role="status" className="text-sm text-slate-400">
            Loading providers...
          </p>
        ) : view.isError ? (
          <div role="alert" className="grid gap-3 text-sm text-red-100">
            <p>{viewErrorText(view.error)}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-fit"
              onClick={() => void view.refetch()}
            >
              Try again
            </Button>
          </div>
        ) : (
          <ProviderChoiceStep
            workspaceId={workspaceId}
            target={target}
            adding={adding}
            initialProfileId={initialProfileId}
            view={view.data}
            mutationsEnabled={mutationsEnabled}
            modelOptions={modelOptions}
            gatewayAccounts={gatewayAccounts}
            agentProfileOptions={agentProfileOptions}
            onLockedChange={onLockedChange}
            onSaved={async (outcome) => {
              await completion.complete();
              onSaved?.();
              if (outcome.kind === "results") {
                setResults(outcome.results);
                setStep("results");
                return;
              }
              if (outcome.kind === "repository" && outcome.provider) {
                setSaved(outcome.provider);
                if (credentialStepOf(outcome.provider)) {
                  setStep("credentials");
                  return;
                }
              }
              onClose();
            }}
          />
        )}
      </div>
    </div>
  );
}

/** One of the dialog's two steps; the current one carries `aria-current`. */
function StepButton({
  current,
  onSelect,
  children,
}: {
  readonly current: boolean;
  readonly onSelect: () => void;
  readonly children: ReactNode;
}): React.ReactElement {
  return (
    <button
      type="button"
      aria-current={current ? "step" : undefined}
      onClick={onSelect}
      className={[
        "rounded-lg px-3 py-1.5 text-sm font-semibold transition",
        current
          ? "bg-cyan-300/[0.12] text-cyan-50"
          : "text-slate-400 hover:text-cyan-50",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

type SaveOutcome =
  | Readonly<{
      kind: "repository";
      provider: Readonly<{
        authMode: ProviderAuthMode;
        credentialKind: ProviderCredentialKind;
      }> | null;
    }>
  | Readonly<{ kind: "workspace" }>
  | Readonly<{
      kind: "results";
      results: readonly ProviderSetupAssignmentResult[];
    }>;

function ProviderChoiceStep({
  workspaceId,
  target,
  adding,
  initialProfileId,
  view,
  mutationsEnabled,
  modelOptions,
  gatewayAccounts,
  agentProfileOptions,
  onLockedChange,
  onSaved,
}: {
  readonly workspaceId: string;
  readonly target: ProviderSetupDialogTarget;
  /** Adding a provider to the workspace list (workspace target). */
  readonly adding: boolean;
  readonly initialProfileId: string | undefined;
  readonly view: ProviderSetupView;
  readonly mutationsEnabled: boolean;
  readonly modelOptions: readonly ReviewModelOption[];
  readonly gatewayAccounts: AccountsResult<AccountsPage> | undefined;
  readonly agentProfileOptions: readonly GatewayAgentProfileOption[];
  readonly onLockedChange: (locked: boolean) => void;
  readonly onSaved: (outcome: SaveOutcome) => Promise<void>;
}): React.ReactElement {
  const repositoryView =
    target.kind === "repository" ? (view.repositories[0] ?? null) : null;
  const defaultProfile = view.defaultSelection
    ? view.profiles.find(
        (profile) => profile.id === view.defaultSelection!.profileId,
      )
    : undefined;
  const offersDefault =
    target.kind === "repository" && view.defaultSelection !== null;
  // Nothing to choose from yet: the dialog opens straight on a new provider.
  const firstProvider = !adding && view.profiles.length === 0 && !offersDefault;
  const initialChoice = useMemo<Choice | null>(() => {
    if (adding || firstProvider) {
      const first = firstAllowedSource(view.sources);
      return first ? { kind: "new", source: first.key } : null;
    }
    if (target.kind === "workspace")
      return initialProfileId &&
        view.profiles.some((candidate) => candidate.id === initialProfileId)
        ? { kind: "profile", profileId: initialProfileId }
        : view.defaultSelection
          ? { kind: "profile", profileId: view.defaultSelection.profileId }
          : null;
    if (repositoryView?.selection)
      return { kind: "profile", profileId: repositoryView.selection.profileId };
    if (target.kind === "repository" && view.defaultSelection)
      return { kind: "default" };
    return null;
  }, [
    adding,
    firstProvider,
    initialProfileId,
    repositoryView,
    target.kind,
    view.defaultSelection,
    view.profiles,
    view.sources,
  ]);
  /** The draft and settings a choice starts with. */
  const startOf = (
    next: Choice | null,
  ): Readonly<{
    draft: DraftProvider;
    settings: ProviderSelectionSettings | null;
  }> => {
    const empty = { model: "", bindingId: "", apiKey: "" };
    if (!next) return { draft: empty, settings: null };
    if (next.kind === "new") {
      const option = view.sources.find(
        (candidate) => candidate.key === next.source,
      );
      if (!option) return { draft: empty, settings: null };
      const model =
        option.key === "gateway_binding"
          ? ""
          : getDefaultProviderConfigForAuthMode(option.authMode).model;
      return {
        draft: { ...empty, model },
        settings: defaultProviderSelectionSettings({
          authMode: option.authMode,
          model,
        }),
      };
    }
    const selected =
      next.kind === "default"
        ? view.defaultSelection
        : next.profileId === repositoryView?.selection?.profileId
          ? repositoryView.selection
          : next.profileId === view.defaultSelection?.profileId
            ? view.defaultSelection
            : null;
    const chosen =
      next.kind === "default"
        ? defaultProfile
        : view.profiles.find((candidate) => candidate.id === next.profileId);
    return {
      draft: empty,
      settings: selected
        ? selectionSettings(selected)
        : chosen
          ? defaultProviderSelectionSettings({
              authMode: chosen.authMode,
              model: chosen.model,
            })
          : null,
    };
  };
  const [choice, setChoice] = useState<Choice | null>(initialChoice);
  const [draft, setDraft] = useState<DraftProvider>(
    () => startOf(initialChoice).draft,
  );
  const [settings, setSettings] = useState<ProviderSelectionSettings | null>(
    () => startOf(initialChoice).settings,
  );
  // Adding from the list: preselected only while there is no default.
  const [makeDefault, setMakeDefault] = useState(
    adding && view.defaultSelection === null,
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const source =
    choice?.kind === "new"
      ? view.sources.find((candidate) => candidate.key === choice.source)
      : undefined;
  const profile =
    choice?.kind === "profile"
      ? view.profiles.find((candidate) => candidate.id === choice.profileId)
      : choice?.kind === "default"
        ? defaultProfile
        : undefined;
  // Accounts of the chosen bindings are loaded even beyond the first page.
  const gatewayOptions = useGatewayModelAccounts(
    gatewayAccounts,
    [draft.bindingId, profile?.gatewayBindingId ?? ""].filter(Boolean),
  );
  const gatewayPage =
    gatewayOptions.accounts?.status === "ok"
      ? gatewayOptions.accounts.value
      : null;
  const gatewayAccountList = getReadyGatewayAccounts(
    gatewayOptions.accounts,
  ).filter((account) =>
    gatewayPage?.profiles.some(
      (profile) =>
        profile.id === account.profileId &&
        profile.protocol === "openai-responses",
    ),
  );
  const catalogs = useProviderModelCatalogs(modelOptions);

  const gatewayAccount =
    source?.key === "gateway_binding"
      ? gatewayAccountList.find(
          (account) => account.binding?.id === draft.bindingId,
        )
      : undefined;
  const gatewayProfile = gatewayAccount
    ? gatewayPage?.profiles.find(
        (candidate) => candidate.id === gatewayAccount.profileId,
      )
    : profile?.authMode === "codex_account_gateway"
      ? gatewayPage?.profiles.find((candidate) =>
          gatewayPage.accounts.some(
            (account) =>
              account.binding?.id === profile.gatewayBindingId &&
              account.profileId === candidate.id,
          ),
        )
      : undefined;
  const authMode = source?.authMode ?? profile?.authMode;
  const gatewayBindingId = source
    ? (gatewayAccount?.binding?.id ?? null)
    : (profile?.gatewayBindingId ?? null);
  const model = source ? draft.model : (profile?.model ?? "");
  const sourceModelOptions: readonly ReviewModelOption[] = !source
    ? []
    : source.key === "gateway_binding"
      ? (gatewayProfile?.models ?? []).map((value) => ({
          value,
          label: value,
          provider: "codex",
        }))
      : catalogs.optionsFor(
          providerKindForAuthMode(source.authMode),
          settings?.agenticContext ?? true,
        );
  const sourceDecision = source
    ? source.key === "gateway_binding" && gatewayAccount?.origin === "personal"
      ? (source.personalAccountDecision ?? source.decision)
      : source.decision
    : undefined;
  const needsKeyUpload =
    source?.credentialKind === "managed_api_key" &&
    source.managedKey?.uploaded === false;
  const decision: ProviderSetupDecision | undefined =
    choice?.kind === "default"
      ? (repositoryView?.useDefault ?? { allowed: true })
      : (profile?.decision ?? sourceDecision);

  function choose(next: Choice): void {
    setChoice(next);
    setError(null);
    setNotice(null);
    if (next.kind === "new" && !view.sources.some((s) => s.key === next.source))
      return;
    const start = startOf(next);
    if (next.kind === "new") setDraft(start.draft);
    setSettings(start.settings);
  }

  const unchanged =
    target.kind === "repository" &&
    ((choice?.kind === "default" && repositoryView?.source === "workspace") ||
      (choice?.kind === "profile" &&
        repositoryView?.selection?.profileId === choice.profileId &&
        sameSettings(settings, selectionSettings(repositoryView.selection))));
  const draftIncomplete =
    source !== undefined &&
    (!draft.model.trim() ||
      (source.key === "gateway_binding" && !gatewayAccount) ||
      (needsKeyUpload && !draft.apiKey.trim()));
  const canSave =
    mutationsEnabled &&
    !pending &&
    choice !== null &&
    (!adding || choice.kind === "new") &&
    decision?.allowed === true &&
    !draftIncomplete &&
    (settings !== null || choice.kind === "default") &&
    !(
      target.kind === "workspace" &&
      choice.kind === "profile" &&
      profile?.isDefault &&
      sameSettings(settings, selectionSettings(view.defaultSelection))
    );

  async function save(): Promise<void> {
    if (!choice || !canSave) return;
    setPending(true);
    onLockedChange(true);
    setError(null);
    setNotice(null);
    try {
      if (choice.kind === "default") {
        if (target.kind !== "repository") return;
        if (repositoryView?.source === "repository") {
          const result = await inheritWorkspaceDefaultProvider({
            workspaceId,
            repositoryId: target.repository.id,
          });
          if (result.status === "error") {
            setError(actionErrorText(result));
            return;
          }
        }
        await onSaved({
          kind: "repository",
          provider: defaultProfile
            ? {
                authMode: defaultProfile.authMode,
                credentialKind: defaultProfile.credentialKind,
              }
            : null,
        });
        return;
      }
      const repositoryIds =
        target.kind === "workspace"
          ? []
          : target.kind === "repository"
            ? [target.repository.id]
            : target.repositories.map((repository) => repository.id);
      if (
        source?.credentialKind === "managed_api_key" &&
        needsKeyUpload &&
        repositoryIds.length > 0
      ) {
        // The key is saved together with its first installation.
        await installManagedProviderKey({
          workspaceId,
          authMode: source.authMode as
            | "mimo_token_plan_api_key"
            | "openrouter_api_key",
          apiKey: draft.apiKey.trim(),
          repositoryIds,
        });
      }
      if (adding && !makeDefault && source) {
        // Only added to the list: its review settings belong to selections.
        const created = await createProviderProfile({
          workspaceId,
          credential: credentialRequest(source, {
            bindingId: gatewayAccount?.binding?.id ?? "",
            gatewayProfileRef: gatewayAccount?.profileId ?? "",
            repositoryId: "",
          }),
          model: model.trim(),
        });
        if (created.status === "error") {
          setError(actionErrorText(created));
          return;
        }
        if (created.created === false) {
          setNotice("This provider is already in the list.");
          return;
        }
        await onSaved({ kind: "workspace" });
        return;
      }
      const fitted = fitProviderSelectionSettings({
        authMode: authMode!,
        model,
        settings: settings!,
        connection: gatewayProfile?.connection,
      });
      const result = await saveProviderSetup({
        workspaceId,
        target:
          target.kind === "workspace"
            ? { kind: "workspace" }
            : { kind: "repositories", repositoryIds },
        provider:
          choice.kind === "profile"
            ? { kind: "profile", profileId: choice.profileId }
            : {
                kind: "new",
                credential: credentialRequest(source!, {
                  bindingId: gatewayAccount?.binding?.id ?? "",
                  gatewayProfileRef: gatewayAccount?.profileId ?? "",
                  repositoryId: repositoryIds[0] ?? "",
                }),
                model: model.trim(),
              },
        settings: fitted,
      });
      if (result.status === "error") {
        setError(actionErrorText(result));
        return;
      }
      if (target.kind === "repositories") {
        await onSaved({ kind: "results", results: result.results });
        return;
      }
      if (target.kind === "repository") {
        const outcome = result.results[0];
        if (outcome && outcome.status !== "applied") {
          setError(assignmentText(outcome));
          return;
        }
        await onSaved({
          kind: "repository",
          provider: {
            authMode: authMode!,
            credentialKind: (source ?? profile)!.credentialKind,
          },
        });
        return;
      }
      await onSaved({ kind: "workspace" });
    } catch (caught) {
      setError(
        dashboardErrorText(
          caught instanceof Error ? caught.message : "dashboard_action_failed",
        ),
      );
    } finally {
      setPending(false);
      onLockedChange(false);
    }
  }

  const visibleSources = view.sources;
  // Adding to the list only: the review settings belong to selections.
  const modelOnly = adding && !makeDefault;
  const groupValue =
    choice === null
      ? null
      : choice.kind === "default"
        ? defaultChoice
        : choice.kind === "profile"
          ? choice.profileId
          : newProviderChoice;
  const listedProfiles = view.profiles.filter(
    (candidate) =>
      !(offersDefault && candidate.id === view.defaultSelection?.profileId) ||
      repositoryView?.selection?.profileId === candidate.id,
  );
  // One reason refusing every choice (such as admin-only Access rights) is
  // said once, not under each option.
  const newProviderDecision: ProviderSetupDecision = firstAllowedSource(
    visibleSources,
  )
    ? { allowed: true }
    : (visibleSources[0]?.decision ?? { allowed: true });
  const choiceDecisions: readonly ProviderSetupDecision[] = [
    ...(offersDefault && defaultProfile && repositoryView
      ? [repositoryView.useDefault]
      : []),
    ...listedProfiles.map((option) => option.decision),
    newProviderDecision,
  ];
  const sharedDenial =
    !adding &&
    !firstProvider &&
    choiceDecisions.every(
      (candidate) =>
        !candidate.allowed &&
        !choiceDecisions[0]!.allowed &&
        candidate.reason === choiceDecisions[0]!.reason,
    )
      ? choiceDecisions[0]!
      : null;
  const reasonOf = (candidate: ProviderSetupDecision | undefined) =>
    sharedDenial ? undefined : deniedText(candidate);

  return (
    <div className="grid gap-6">
      {!mutationsEnabled ? (
        <p role="status" className="text-sm text-amber-100/85">
          Changes are turned off for this dashboard.
        </p>
      ) : null}
      {target.kind === "repositories" ? (
        <RepositoryList repositories={target.repositories} />
      ) : null}

      {(adding || firstProvider) && !firstAllowedSource(visibleSources) ? (
        <p className="text-sm text-amber-100/85">
          {deniedText(visibleSources[0]?.decision)}
        </p>
      ) : null}

      {firstProvider ? (
        <h3 className="text-sm font-semibold text-cyan-50">
          Add the first provider
        </h3>
      ) : null}
      {sharedDenial ? (
        <p role="status" className="text-sm text-amber-100/85">
          {deniedText(sharedDenial)}
        </p>
      ) : null}
      {adding || firstProvider ? null : (
        <section className="grid gap-3">
          <h3 className="text-sm font-semibold text-cyan-50">
            Choose a provider
          </h3>
          <RadioCardGroup
            label="Provider"
            value={groupValue}
            disabled={pending}
            onValueChange={(value) => {
              if (value === defaultChoice) choose({ kind: "default" });
              else if (value === newProviderChoice)
                choose({
                  kind: "new",
                  source:
                    firstAllowedSource(visibleSources)?.key ??
                    "gateway_binding",
                });
              else choose({ kind: "profile", profileId: value });
            }}
          >
            {offersDefault && defaultProfile ? (
              <RadioCard
                value={defaultChoice}
                icon={
                  <ProviderAuthLogoFrame authMode={defaultProfile.authMode} />
                }
                title={`Workspace default: ${defaultProfile.label}`}
                description={`${sourceTitle(defaultProfile.credentialKind, defaultProfile.authMode)} · ${defaultProfile.model}. Follows the default when it changes.`}
                meta={
                  repositoryView?.source === "workspace" ? (
                    <Badge tone="success" size="xs">
                      In use
                    </Badge>
                  ) : null
                }
                disabled={!repositoryView?.useDefault.allowed}
                disabledReason={reasonOf(repositoryView?.useDefault)}
              />
            ) : null}
            {listedProfiles.map((option) => (
              <ProfileCard
                key={option.id}
                option={option}
                inUse={
                  target.kind === "workspace"
                    ? option.isDefault
                    : repositoryView?.selection?.profileId === option.id
                }
                bulk={target.kind === "repositories"}
                total={repositoryIds(target).length}
                disabledReason={reasonOf(option.decision)}
              />
            ))}
            <RadioCard
              value={newProviderChoice}
              title="Add a new provider"
              description="Connect an account, a key or a subscription. It is added to this workspace's providers."
              disabled={!firstAllowedSource(visibleSources)}
              disabledReason={reasonOf(newProviderDecision)}
            />
          </RadioCardGroup>
        </section>
      )}

      {choice?.kind === "new" ? (
        <section
          className={
            adding || firstProvider
              ? "grid gap-4"
              : "grid gap-4 border-t border-cyan-200/10 pt-5"
          }
        >
          <SelectField
            label="Where the credential comes from"
            value={choice.source}
            options={visibleSources.map((option) => ({
              value: option.key,
              label: sourceTitle(option.credentialKind, option.authMode),
              description: option.decision.allowed
                ? sourceDescription(option)
                : deniedText(option.decision),
              disabled: !option.decision.allowed,
            }))}
            disabled={pending}
            onValueChange={(value) =>
              choose({ kind: "new", source: value as ProviderSourceKey })
            }
          />
          {source?.key === "gateway_binding" ? (
            <SelectField
              label="Account"
              value={gatewayAccount?.binding?.id ?? ""}
              placeholder={
                gatewayAccountList.length === 0
                  ? "No active accounts"
                  : "Choose an account"
              }
              disabled={pending || gatewayAccountList.length === 0}
              options={gatewayAccountList.map((account) => {
                const personalDenied =
                  account.origin === "personal" &&
                  source.personalAccountDecision?.allowed === false;
                return {
                  value: account.binding!.id,
                  label: account.label,
                  description: personalDenied
                    ? deniedText(source.personalAccountDecision)
                    : [account.profileLabel, personalAccountOriginText(account)]
                        .filter(Boolean)
                        .join(" · "),
                  disabled: personalDenied,
                };
              })}
              onValueChange={(bindingId) => {
                const account = gatewayAccountList.find(
                  (candidate) => candidate.binding?.id === bindingId,
                );
                const models =
                  gatewayPage?.profiles.find(
                    (candidate) => candidate.id === account?.profileId,
                  )?.models ?? [];
                const nextModel = models.length === 1 ? models[0]! : "";
                setDraft((current) => ({
                  ...current,
                  bindingId,
                  model: nextModel,
                }));
              }}
              hint={
                gatewayAccountList.length === 0
                  ? "Connect and activate an account in Accounts first."
                  : "Credentials stay on the ReviewRouter server."
              }
            />
          ) : null}
          {needsKeyUpload ? (
            <TextField
              label="API key"
              type="password"
              autoComplete="new-password"
              value={draft.apiKey}
              disabled={pending || target.kind === "workspace"}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  apiKey: event.target.value,
                }))
              }
              placeholder="Paste the key"
              hint="Saved encrypted on the server and installed in the selected repositories. It is never shown again."
            />
          ) : null}
          {adding ? (
            <label className="flex cursor-pointer items-start gap-3 text-sm has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60">
              <Checkbox
                checked={makeDefault}
                disabled={pending || !sourceDecision?.allowed}
                onChange={(event) => setMakeDefault(event.target.checked)}
                className="mt-0.5"
              />
              <span className="grid gap-0.5">
                <span className="font-semibold text-cyan-50">
                  Use as workspace default
                </span>
                <span className="text-xs leading-5 text-slate-400">
                  {view.defaultSelection
                    ? "Replaces the current default for repositories without a provider of their own."
                    : "Repositories without a provider of their own start reviewing with it."}
                </span>
              </span>
            </label>
          ) : null}
        </section>
      ) : null}

      {authMode && settings && (choice?.kind !== "new" || source) ? (
        <section
          className={
            modelOnly
              ? "grid gap-4"
              : "grid gap-4 border-t border-cyan-200/10 pt-5"
          }
        >
          {modelOnly ? null : (
            <h3 className="text-sm font-semibold text-cyan-50">
              {adding
                ? "Model and review settings of the default"
                : "Model and review settings"}
            </h3>
          )}
          {modelOnly ? (
            <ProviderModelPicker
              model={model}
              onModelChange={(next) =>
                setDraft((current) => ({ ...current, model: next }))
              }
              modelOptions={sourceModelOptions}
              modelChoice={
                source?.key === "gateway_binding" ? "list" : "catalog"
              }
              disabled={pending || !mutationsEnabled}
            />
          ) : (
            <ProviderModelFields
              authMode={authMode}
              model={model}
              onModelChange={
                source
                  ? (next) => {
                      setDraft((current) => ({ ...current, model: next }));
                      setSettings((current) =>
                        current
                          ? fitProviderSelectionSettings({
                              authMode,
                              model: next,
                              settings: current,
                              connection: gatewayProfile?.connection,
                            })
                          : current,
                      );
                    }
                  : null
              }
              modelOptions={sourceModelOptions}
              modelChoice={
                source?.key === "gateway_binding" ? "list" : "catalog"
              }
              settings={settings}
              onSettingsChange={setSettings}
              connection={gatewayProfile?.connection}
              agentProfileOptions={agentProfileOptions}
              disabled={
                pending || !mutationsEnabled || choice?.kind === "default"
              }
            />
          )}
          {modelOnly ? (
            <p className="text-xs leading-5 text-slate-400">
              Review depth and similar settings are chosen where the provider is
              used.
            </p>
          ) : null}
          {authMode === "codex_account_gateway" && gatewayBindingId ? (
            <GatewayConnectionTest
              bindingId={gatewayBindingId}
              model={model.trim()}
              available={
                gatewayAccountList.some(
                  (account) => account.binding?.id === gatewayBindingId,
                ) && (gatewayProfile?.models ?? []).includes(model.trim())
              }
            />
          ) : null}
          {choice?.kind === "default" ? (
            <p className="text-xs leading-5 text-slate-400">
              The workspace default decides these settings.
            </p>
          ) : profile && !source ? (
            <p className="text-xs leading-5 text-slate-400">
              The model belongs to the provider and is changed in Providers, for
              everyone who uses it. The settings above apply only here.
            </p>
          ) : null}
        </section>
      ) : null}

      {decision && !decision.allowed && !sharedDenial ? (
        <p className="text-sm text-amber-100/85">{deniedText(decision)}</p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm leading-6 text-red-100">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="text-sm leading-6 text-slate-200">
          {notice}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center justify-end gap-3 border-t border-cyan-200/10 pt-4">
        <Button
          type="button"
          size="sm"
          disabled={!canSave || unchanged}
          aria-busy={pending}
          onClick={() => void save()}
        >
          {pending
            ? "Saving..."
            : adding
              ? makeDefault
                ? "Add and make default"
                : "Add provider"
              : target.kind === "workspace"
                ? "Set as default"
                : target.kind === "repositories"
                  ? `Use for ${target.repositories.length} repositories`
                  : choice?.kind === "default"
                    ? "Use the workspace default"
                    : "Use for this repository"}
        </Button>
      </div>
    </div>
  );
}

function ProfileCard({
  option,
  inUse,
  bulk,
  total,
  disabledReason,
}: {
  readonly option: ProviderProfileOption;
  readonly inUse: boolean;
  readonly bulk: boolean;
  readonly total: number;
  readonly disabledReason: string | undefined;
}): React.ReactElement {
  return (
    <RadioCard
      value={option.id}
      icon={<ProviderAuthLogoFrame authMode={option.authMode} />}
      title={option.label}
      description={
        bulk && option.refusedRepositoryCount > 0
          ? `${sourceTitle(option.credentialKind, option.authMode)} · ${option.model}. Not allowed in ${option.refusedRepositoryCount} of ${total} repositories.`
          : `${sourceTitle(option.credentialKind, option.authMode)} · ${option.model}`
      }
      meta={
        <>
          {option.isDefault ? (
            <Badge tone="accent" size="xs">
              Default
            </Badge>
          ) : null}
          {inUse && !option.isDefault ? (
            <Badge tone="success" size="xs">
              In use
            </Badge>
          ) : null}
        </>
      }
      disabled={!option.decision.allowed}
      disabledReason={disabledReason}
    />
  );
}

function RepositoryList({
  repositories,
}: {
  readonly repositories: readonly Readonly<{ id: string; fullName: string }>[];
}): React.ReactElement {
  const shown = repositories.slice(0, 6);
  return (
    <p className="text-sm leading-6 text-slate-300">
      {shown.map((repository) => repository.fullName).join(", ")}
      {repositories.length > shown.length
        ? ` and ${repositories.length - shown.length} more`
        : ""}
    </p>
  );
}

function CredentialStep({
  workspaceId,
  repository,
  credentialStep,
  authMode,
  view,
  onInstalled,
}: {
  readonly workspaceId: string;
  readonly repository: ProviderSetupRepositoryContext;
  readonly credentialStep: CredentialStepKind;
  readonly authMode: ProviderAuthMode;
  readonly view: ProviderSetupView | undefined;
  readonly onInstalled: () => void;
}): React.ReactElement {
  const common = {
    workspaceId,
    repositoryId: repository.id,
    repositoryFullName: repository.fullName,
  };
  switch (credentialStep) {
    case "ci_secret": {
      const ciAuthMode = authMode as
        | "claude_code_oauth"
        | "mimo_token_plan_api_key";
      const guidance = repository.secretGuidance?.[ciAuthMode];
      return guidance ? (
        <CiSecretDelivery
          {...common}
          repositoryVisibility={repository.visibility}
          authMode={ciAuthMode}
          guidance={guidance}
          organizationLogin={repository.organizationLogin}
          organizationSecretPolicy={repository.organizationSecretPolicy}
          canManage={repository.canManageCredentials}
        />
      ) : (
        <p className="text-sm text-slate-300">
          Secrets are added on GitHub for GitHub repositories only.
        </p>
      );
    }
    case "managed_key": {
      const managedAuthMode = authMode as
        | "mimo_token_plan_api_key"
        | "openrouter_api_key";
      const option = view?.sources.find(
        (candidate) => candidate.key === `managed_api_key:${managedAuthMode}`,
      );
      return (
        <ManagedKeyDelivery
          {...common}
          authMode={managedAuthMode}
          installed={
            option?.managedKey?.installedRepositoryIds.includes(
              repository.id,
            ) ?? false
          }
          installDecisionReason={
            option?.managedKey?.install.allowed === false
              ? deniedText(option.managedKey.install)
              : option
                ? null
                : "Loading..."
          }
          canManage={repository.canManageCredentials}
          onInstalled={onInstalled}
        />
      );
    }
    case "rotating":
      return (
        <RotatingProviderDelivery
          {...common}
          enabled={repository.rotatingEnabled}
          canManage={repository.canManageCredentials}
          preparationOnly={repository.rotatingPreparationOnly}
        />
      );
  }
}

function AssignmentResults({
  results,
  onDone,
}: {
  readonly results: readonly ProviderSetupAssignmentResult[];
  readonly onDone: () => void;
}): React.ReactElement {
  const applied = results.filter((result) => result.status === "applied");
  return (
    <div className="grid gap-4">
      <p role="status" className="text-sm text-slate-200">
        {applied.length === results.length
          ? `The provider is set for all ${results.length} repositories.`
          : `The provider is set for ${applied.length} of ${results.length} repositories.`}{" "}
        Repositories that need a secret or key show it as their next setup step.
      </p>
      <ul className="grid divide-y divide-cyan-200/10 border-y border-cyan-200/10">
        {results.map((result) => (
          <li
            key={result.repositoryId}
            className="flex flex-wrap items-start justify-between gap-2 py-2.5 text-sm"
          >
            <span className="min-w-0 break-words font-semibold text-cyan-50">
              {result.fullName || result.repositoryId}
            </span>
            <span className="flex flex-wrap items-center gap-2">
              <Badge
                size="xs"
                tone={
                  result.status === "applied"
                    ? "success"
                    : result.status === "denied"
                      ? "warning"
                      : "danger"
                }
              >
                {result.status === "applied"
                  ? "Set"
                  : result.status === "denied"
                    ? "Not allowed"
                    : result.status === "conflict"
                      ? "Changed meanwhile"
                      : "Failed"}
              </Badge>
            </span>
            {result.status !== "applied" ? (
              <span className="w-full text-xs leading-5 text-slate-400">
                {assignmentText(result)}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      <div className="flex justify-end">
        <Button type="button" size="sm" onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  );
}

function sourceDescription(option: ProviderSourceOption): string {
  switch (option.credentialKind) {
    case "gateway_binding":
      return "An account connected in Accounts. The credential stays on the server; nothing is added to GitHub.";
    case "managed_api_key":
      return option.managedKey?.uploaded
        ? "ReviewRouter installs the saved key in each repository."
        : "An owner or admin pastes the key once; ReviewRouter installs it in each repository.";
    case "user_ci_secret":
      return "You add the credential to the repository's GitHub secrets yourself.";
    case "repository_rotating":
      return "Only for this repository. You connect it once from your computer and reviews refresh it.";
    case "hosted_pool":
      return "Uses this workspace's hosted Codex sessions.";
  }
}

function credentialRequest(
  source: ProviderSourceOption,
  refs: Readonly<{
    bindingId: string;
    gatewayProfileRef: string;
    repositoryId: string;
  }>,
): unknown {
  switch (source.credentialKind) {
    case "gateway_binding":
      return {
        kind: "gateway_binding",
        bindingId: refs.bindingId,
        gatewayProfileRef: refs.gatewayProfileRef,
      };
    case "managed_api_key":
      return { kind: "managed_api_key", authMode: source.authMode };
    case "user_ci_secret":
      return { kind: "user_ci_secret", authMode: source.authMode };
    case "repository_rotating":
      return { kind: "repository_rotating", repositoryId: refs.repositoryId };
    case "hosted_pool":
      return { kind: "hosted_pool" };
  }
}

function firstAllowedSource(
  sources: readonly ProviderSourceOption[],
): ProviderSourceOption | undefined {
  return sources.find((source) => source.decision.allowed);
}

function repositoryIds(target: ProviderSetupDialogTarget): readonly string[] {
  return target.kind === "workspace"
    ? []
    : target.kind === "repository"
      ? [target.repository.id]
      : target.repositories.map((repository) => repository.id);
}

function selectionSettings(
  selection: ProviderSetupView["defaultSelection"],
): ProviderSelectionSettings | null {
  if (!selection) return null;
  return {
    ...(selection.reasoningEffort === undefined
      ? {}
      : { reasoningEffort: selection.reasoningEffort }),
    agenticContext: selection.agenticContext,
    fastMode: selection.fastMode,
    ...(selection.agentProfileRef === undefined
      ? {}
      : { agentProfileRef: selection.agentProfileRef }),
  };
}

function sameSettings(
  left: ProviderSelectionSettings | null,
  right: ProviderSelectionSettings | null,
): boolean {
  return (
    left?.reasoningEffort === right?.reasoningEffort &&
    left?.fastMode === right?.fastMode &&
    left?.agenticContext === right?.agenticContext &&
    left?.agentProfileRef === right?.agentProfileRef
  );
}

function deniedText(decision: ProviderSetupDecision | undefined): string {
  return decision && !decision.allowed
    ? providerSetupDenialText(decision.reason)
    : "";
}

function actionErrorText(
  result: Readonly<{ error: string; reason?: string }>,
): string {
  return result.reason
    ? providerSetupDenialText(
        result.reason as Parameters<typeof providerSetupDenialText>[0],
      )
    : dashboardErrorText(result.error);
}

function assignmentText(result: ProviderSetupAssignmentResult): string {
  if (result.status === "denied")
    return result.reason
      ? providerSetupDenialText(result.reason)
      : dashboardErrorText(
          result.error ?? "repository_config_mutation_forbidden",
        );
  if (result.status === "conflict")
    return "This repository changed while you were choosing. Open it and try again.";
  return dashboardErrorText(result.error ?? "dashboard_action_failed");
}

function viewErrorText(error: unknown): string {
  const code = error instanceof Error ? error.message : "";
  switch (code) {
    case "sign_in_required":
      return "Sign in again to choose a provider.";
    case "provider_setup_forbidden":
      return "You cannot change providers in this workspace.";
    case "repository_not_found":
    case "workspace_not_found":
      return "This repository or workspace is no longer available. Refresh the page.";
    default:
      return "Providers could not be loaded.";
  }
}
