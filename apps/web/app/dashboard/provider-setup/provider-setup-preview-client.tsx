"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import type { ProviderSecretSetupGuidance } from "@reviewrouter/features-provider-setup";
import type { ReviewModelOption } from "@reviewrouter/features-review-providers";
import {
  buildProviderSetupView,
  PROVIDER_SETUP_MAX_REPOSITORIES,
  type ProviderSetupFacts,
} from "../../../src/features/provider-setup/provider-setup-model";
import type {
  AccountsPage,
  AccountsResult,
} from "../../../src/server/account-gateway-accounts";
import { RepositorySetupProgressPanel } from "../repository-setup-progress-panel";
import { ProviderLine, type ProviderLineSummary } from "./provider-line";
import { providerSetupQueryKeys } from "./provider-setup-api";
import {
  ProviderSetupDialog,
  type ProviderSetupRepositoryContext,
} from "./provider-setup-dialog";
import { BulkProviderSetupAction } from "./repository-selection";
import {
  RepositorySelectionCheckbox,
  RepositorySelectionProvider,
  RepositorySelectionToolbar,
} from "../repository-action-selection";

/**
 * Fixture-only rendering of the provider lines and dialog for visual review
 * (plan S5/S7). No request leaves the page: the dialog reads come from a
 * pre-filled query cache, and saving is not wired.
 */

const workspaceId = "preview-workspace";
const repositories = [
  { id: "repo-web", fullName: "acme/web" },
  { id: "repo-api", fullName: "acme/api" },
  { id: "repo-docs", fullName: "acme/docs" },
] as const;

const modelOptions: readonly ReviewModelOption[] = [
  {
    value: "gpt-5.6-sol",
    label: "gpt-5.6-sol",
    provider: "codex",
    description: "Codex default model.",
  },
  {
    value: "sonnet",
    label: "sonnet",
    provider: "claude",
    description: "Claude Code default model.",
  },
  {
    value: "opus",
    label: "opus",
    provider: "claude",
    description: "Claude Code model.",
  },
  {
    value: "mimo-v2.6-pro",
    label: "mimo-v2.6-pro",
    provider: "codex-mimo",
    description: "MiMo Token Plan model.",
  },
];

const gatewayAccounts: AccountsResult<AccountsPage> = {
  status: "ok",
  value: {
    profiles: [
      {
        id: "profile-codex",
        label: "ChatGPT",
        provider: "codex",
        protocol: "openai-responses",
        models: ["gpt-5.6-sol", "gpt-5.5"],
      },
    ],
    accounts: [
      {
        connectionId: "connection-team",
        label: "Team ChatGPT",
        profileId: "profile-codex",
        profileLabel: "ChatGPT",
        origin: "organization",
        state: "active",
        gatewayRevision: 1,
        mirrorRevision: 1,
        binding: {
          id: "binding-team",
          revision: 1,
          state: "active",
          fencePending: false,
        },
      },
    ],
    nextCursor: null,
  },
};

const profiles: ProviderSetupFacts["profiles"] = [
  {
    id: "profile-team",
    label: "Team ChatGPT",
    model: "gpt-5.6-sol",
    authMode: "codex_account_gateway",
    credentialKind: "gateway_binding",
    createdByUserId: "user-owner",
    gatewayBindingId: "binding-team",
    personalBinding: false,
    rotatingRepositoryId: null,
  },
  {
    id: "profile-claude",
    label: "Claude Code (opus)",
    model: "opus",
    authMode: "claude_code_oauth",
    credentialKind: "user_ci_secret",
    createdByUserId: "user-member",
    gatewayBindingId: null,
    personalBinding: false,
    rotatingRepositoryId: null,
  },
];

export type ProviderSetupPreviewState = "default" | "no-default";

/** Who looks at the preview, and the workspace's Access rights. */
export type ProviderSetupPreviewViewer = Readonly<{
  role: "owner" | "member";
  adminOnly: boolean;
}>;

const ownerViewer: ProviderSetupPreviewViewer = {
  role: "owner",
  adminOnly: false,
};

function facts(
  state: ProviderSetupPreviewState,
  target: ProviderSetupFacts["target"],
  repositoryIds: readonly string[],
  viewer: ProviderSetupPreviewViewer,
): ProviderSetupFacts {
  return {
    workspaceId,
    target,
    actor:
      viewer.role === "owner"
        ? { userId: "user-owner", role: "owner" }
        : { userId: "user-member", role: "member" },
    workspace: {
      personalOwnerUserId: null,
      providerManagementAdminOnly: viewer.adminOnly,
    },
    profiles: state === "no-default" ? [] : profiles,
    defaultSelection:
      state === "no-default"
        ? null
        : {
            profileId: "profile-team",
            reasoningEffort: "high",
            agenticContext: true,
            fastMode: false,
            requiredHealthy: true,
          },
    repositories: repositoryIds.map((id) => ({
      id,
      fullName: repositories.find((item) => item.id === id)!.fullName,
      capability: "direct_config",
      ownSelection:
        state === "default" && id === "repo-api"
          ? {
              profileId: "profile-claude",
              agenticContext: true,
              fastMode: false,
              requiredHealthy: true,
            }
          : null,
      rotatingAvailable: false,
    })),
    managedKeys: {
      mimo_token_plan_api_key: {
        uploaded: false,
        installedRepositoryIds: new Set(),
      },
      openrouter_api_key: {
        uploaded: true,
        installedRepositoryIds: new Set(),
      },
    },
    claudeCodeEnabled: true,
  };
}

function previewQueryClient(
  state: ProviderSetupPreviewState,
  viewer: ProviderSetupPreviewViewer,
): QueryClient {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  // Far in the future so the fixture never goes stale and nothing is fetched.
  const updatedAt = Date.now() + 365 * 24 * 60 * 60 * 1000;
  const targets: readonly (readonly string[])[] = [
    [],
    ...repositories.map((repository) => [repository.id]),
    repositories.map((repository) => repository.id),
    ["repo-web", "repo-docs"],
  ];
  for (const ids of targets)
    client.setQueryData(
      providerSetupQueryKeys.view(workspaceId, ids),
      buildProviderSetupView(
        facts(state, ids.length ? "repositories" : "workspace", ids, viewer),
      ),
      { updatedAt },
    );
  return client;
}

function repositoryContext(
  id: string,
  summary: ProviderLineSummary,
): ProviderSetupRepositoryContext {
  const fullName = repositories.find((item) => item.id === id)!.fullName;
  return {
    id,
    fullName,
    visibility: "private",
    canManageCredentials: true,
    effective: summary.profile
      ? {
          authMode: summary.profile.authMode,
          credentialKind: summary.profile.credentialKind,
        }
      : null,
    secretGuidance: {
      claude_code_oauth: previewGuidance(
        "claude_code_oauth",
        "CLAUDE_CODE_OAUTH_TOKEN",
        fullName,
      ),
      mimo_token_plan_api_key: previewGuidance(
        "mimo_token_plan_api_key",
        "MIMO_TOKEN_PLAN_API_KEY",
        fullName,
      ),
    },
    organizationLogin: null,
    organizationSecretPolicy: null,
    rotatingEnabled: false,
  };
}

function previewGuidance(
  provider: "claude_code_oauth" | "mimo_token_plan_api_key",
  secretName: string,
  repository: string,
): ProviderSecretSetupGuidance {
  return {
    provider,
    recommendedScope: "repository",
    commands: [
      {
        scope: "repository",
        title: "Repository secret",
        description: `Stores ${secretName} in this repository.`,
        command: `gh secret set ${secretName} --repo ${repository}`,
        storesSecretIn: "github_repository_secret",
        targetLabel: `${repository} repository secret`,
        secretNames: [secretName],
        selectedRepositories: [repository],
        validatesBeforeWrite: false,
        failureRecovery: "Run the command again.",
        sendsSecretToReviewRouter: false,
      },
    ],
    warnings: [],
  };
}

export function ProviderSetupPreviewClient({
  state,
  viewer = ownerViewer,
}: {
  readonly state: ProviderSetupPreviewState;
  readonly viewer?: ProviderSetupPreviewViewer;
}): React.ReactElement {
  const [client] = useState(() => previewQueryClient(state, viewer));
  const dialog = {
    workspaceId,
    mutationsEnabled: true,
    modelOptions,
    gatewayAccounts,
    agentProfileOptions: [],
  } as const;
  const team = {
    label: "Team ChatGPT",
    model: "gpt-5.6-sol",
    authMode: "codex_account_gateway",
    credentialKind: "gateway_binding",
  } as const;
  const summaries: Record<string, ProviderLineSummary> =
    state === "no-default"
      ? {
          "repo-web": { source: "none", profile: null },
          "repo-api": { source: "none", profile: null },
          "repo-docs": { source: "none", profile: null },
        }
      : {
          "repo-web": { source: "workspace", profile: team },
          "repo-api": {
            source: "repository",
            profile: {
              label: "Claude Code (opus)",
              model: "opus",
              authMode: "claude_code_oauth",
              credentialKind: "user_ci_secret",
            },
          },
          "repo-docs": { source: "workspace", profile: team },
        };
  const workspaceSummary: ProviderLineSummary =
    state === "no-default"
      ? { source: "none", profile: null }
      : { source: "workspace", profile: team };
  const api = repositoryContext("repo-api", summaries["repo-api"]!);

  return (
    <QueryClientProvider client={client}>
      <div id="dashboard-section-content" className="min-w-0 space-y-6">
        <section className="grid gap-3">
          <h2 className="text-2xl font-semibold text-cyan-50">Models</h2>
          <ProviderLine
            {...dialog}
            summary={workspaceSummary}
            target={{ kind: "workspace" }}
          />
        </section>

        <RepositorySelectionProvider
          workspaceId={workspaceId}
          inventory={repositories.map((repository) => ({
            repositoryId: repository.id,
            fullName: repository.fullName,
            available: true,
          }))}
        >
          <section className="rounded-[1.5rem] border border-cyan-200/10 bg-slate-950/62">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-cyan-200/10 px-4 py-3 lg:px-6">
              <p className="text-sm font-semibold text-cyan-100">
                Repository providers
              </p>
              <BulkProviderSetupAction
                {...dialog}
                limit={PROVIDER_SETUP_MAX_REPOSITORIES}
                editableRepositoryIds={repositories.map(
                  (repository) => repository.id,
                )}
              />
            </div>
            <RepositorySelectionToolbar
              matchingIds={repositories.map((repository) => repository.id)}
            />
            {repositories.map((repository) => (
              <div
                key={repository.id}
                className="grid grid-cols-[2.75rem_minmax(0,1fr)] items-start border-t border-cyan-200/10"
              >
                <RepositorySelectionCheckbox repositoryId={repository.id} />
                <div className="grid gap-2 px-2 py-3 pr-4">
                  <p className="text-sm font-semibold text-cyan-50">
                    {repository.fullName}
                  </p>
                  <ProviderLine
                    {...dialog}
                    compact
                    summary={summaries[repository.id]!}
                    target={{
                      kind: "repository",
                      repository: repositoryContext(
                        repository.id,
                        summaries[repository.id]!,
                      ),
                    }}
                  />
                </div>
              </div>
            ))}
          </section>
        </RepositorySelectionProvider>

        <section className="rounded-2xl border border-cyan-200/10 bg-slate-950/45 px-4 pb-1 pt-4 sm:px-5">
          <RepositorySetupProgressPanel
            workspaceId={workspaceId}
            repositoryId={api.id}
            repositoryFullName={api.fullName}
            selected
            archived={false}
            initialSetupStatus="configured"
            initialSetupPullRequestUrl={null}
            workflowCurrent
            mutationsEnabled
            initialStep="provider"
            expectedProviderAuthModes={
              summaries["repo-api"]!.profile
                ? [summaries["repo-api"]!.profile.authMode]
                : []
            }
            providerLine={
              <ProviderLine
                {...dialog}
                summary={summaries["repo-api"]!}
                target={{ kind: "repository", repository: api }}
              />
            }
            enableReviewAction={
              api.effective ? (
                <ProviderSetupDialog
                  {...dialog}
                  target={{ kind: "repository", repository: api }}
                  initialStep="credentials"
                  triggerLabel="Add secret"
                  triggerClassName="min-h-11 w-full min-w-0 rounded-lg px-3 sm:w-auto sm:min-w-[9.5rem] sm:px-5"
                />
              ) : null
            }
          />
        </section>
      </div>
    </QueryClientProvider>
  );
}
