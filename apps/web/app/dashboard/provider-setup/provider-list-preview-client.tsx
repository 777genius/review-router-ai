"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import type { ReviewModelOption } from "@reviewrouter/features-review-providers";
import {
  buildProviderListView,
  type ProviderListFacts,
} from "../../../src/features/provider-setup/provider-list-model";
import {
  buildProviderSetupView,
  type ProviderSetupFacts,
} from "../../../src/features/provider-setup/provider-setup-model";
import type {
  AccountsPage,
  AccountsResult,
} from "../../../src/server/account-gateway-accounts";
import { ProviderList } from "./provider-list";
import {
  providerSetupQueryKeys,
  type ManagedProviderKeyState,
} from "./provider-setup-api";

/**
 * Fixture-only rendering of the Providers list for visual review (plan S6,
 * S7). No request leaves the page: dialog reads come from a pre-filled query
 * cache and saving is not wired.
 */

export type ProviderListPreviewState = Readonly<{
  /** `empty`: no providers; `several`: one of each kind, some in use. */
  list: "empty" | "several";
  viewer: "owner" | "member";
  /** Access rights: only owners and admins manage providers. */
  adminOnly: boolean;
}>;

const workspaceId = "preview-workspace";

const modelOptions: readonly ReviewModelOption[] = [
  { value: "gpt-5.6-sol", label: "gpt-5.6-sol", provider: "codex" },
  { value: "gpt-5.5", label: "gpt-5.5", provider: "codex" },
  { value: "sonnet", label: "sonnet", provider: "claude" },
  { value: "opus", label: "opus", provider: "claude" },
  { value: "mimo-v2.6-pro", label: "mimo-v2.6-pro", provider: "codex-mimo" },
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

const viewers = {
  owner: { userId: "user-owner", role: "owner" },
  member: { userId: "user-member", role: "member" },
} as const;

const profiles: ProviderListFacts["profiles"] = [
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
  {
    id: "profile-personal",
    label: "Dana's ChatGPT Pro",
    model: "gpt-5.5",
    authMode: "codex_account_gateway",
    credentialKind: "gateway_binding",
    createdByUserId: "user-dana",
    gatewayBindingId: "binding-personal",
    personalBinding: true,
    rotatingRepositoryId: null,
  },
  {
    id: "profile-openrouter",
    label: "OpenRouter (openai/gpt-5.5)",
    model: "openai/gpt-5.5",
    authMode: "openrouter_api_key",
    credentialKind: "managed_api_key",
    createdByUserId: "user-former",
    gatewayBindingId: null,
    personalBinding: false,
    rotatingRepositoryId: null,
  },
  {
    id: "profile-old",
    label: "Old team account with a much longer name than usual",
    model: "gpt-5.5",
    authMode: "codex_account_gateway",
    credentialKind: "gateway_binding",
    createdByUserId: "user-owner",
    gatewayBindingId: "binding-old",
    personalBinding: false,
    rotatingRepositoryId: null,
  },
  {
    id: "profile-hosted",
    label: "Hosted Codex pool",
    model: "gpt-5.6-sol",
    authMode: "codex_subscription_oauth_hosted_pool",
    credentialKind: "hosted_pool",
    createdByUserId: null,
    gatewayBindingId: null,
    personalBinding: false,
    rotatingRepositoryId: null,
  },
  {
    id: "profile-rotating",
    label: "Codex for docs",
    model: "gpt-5.6-sol",
    authMode: "codex_subscription_oauth_rotating",
    credentialKind: "repository_rotating",
    createdByUserId: "user-member",
    gatewayBindingId: null,
    personalBinding: false,
    rotatingRepositoryId: "repo-docs",
  },
];

function listFacts(state: ProviderListPreviewState): ProviderListFacts {
  const several = state.list === "several";
  return {
    workspaceId,
    actor: viewers[state.viewer],
    workspace: {
      personalOwnerUserId: null,
      providerManagementAdminOnly: state.adminOnly,
    },
    profiles: several ? profiles : [],
    defaultProfileId: several ? "profile-team" : null,
    usage: several
      ? [
          {
            profileId: "profile-team",
            workspaceDefault: true,
            repositoryIds: ["repo-mobile"],
          },
          {
            profileId: "profile-claude",
            workspaceDefault: false,
            repositoryIds: [
              "repo-api",
              "repo-web",
              "repo-admin",
              "repo-billing",
              "repo-search",
            ],
          },
          {
            profileId: "profile-rotating",
            workspaceDefault: false,
            repositoryIds: ["repo-docs"],
          },
        ]
      : [],
    repositoryNames: new Map([
      ["repo-api", "acme/api"],
      ["repo-web", "acme/web"],
      ["repo-docs", "acme/docs"],
      ["repo-mobile", "acme/mobile"],
      ["repo-admin", "acme/admin-console"],
      ["repo-billing", "acme/billing"],
      ["repo-search", "acme/search"],
    ]),
    creators: new Map([
      ["user-owner", { login: "alex", member: true }],
      ["user-member", { login: "sam", member: true }],
      ["user-dana", { login: "dana", member: true }],
      ["user-former", { login: "riley", member: false }],
    ]),
    accounts: new Map([
      ["binding-team", { name: "Team ChatGPT", available: true }],
      ["binding-personal", { name: null, available: true }],
      ["binding-old", { name: "Old team account", available: false }],
    ]),
  };
}

/** What the "Add provider" and "Make default" dialogs read for the workspace. */
function dialogFacts(state: ProviderListPreviewState): ProviderSetupFacts {
  const facts = listFacts(state);
  return {
    workspaceId,
    target: "workspace",
    actor: facts.actor,
    workspace: facts.workspace,
    profiles: facts.profiles,
    defaultSelection: facts.defaultProfileId
      ? {
          profileId: facts.defaultProfileId,
          reasoningEffort: "high",
          agenticContext: true,
          fastMode: false,
          requiredHealthy: true,
        }
      : null,
    repositories: [],
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

const openRouterKey: ManagedProviderKeyState = {
  connected: true,
  keyVersion: 2,
  repositories: [
    {
      repositoryId: "repo-api",
      repositoryFullName: "acme/api",
      status: "applied",
    },
    {
      repositoryId: "repo-web",
      repositoryFullName: "acme/web",
      status: "stale",
    },
  ],
};

function previewQueryClient(state: ProviderListPreviewState): QueryClient {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  // Far in the future so the fixture never goes stale and nothing is fetched.
  const updatedAt = Date.now() + 365 * 24 * 60 * 60 * 1000;
  client.setQueryData(
    providerSetupQueryKeys.view(workspaceId, []),
    buildProviderSetupView(dialogFacts(state)),
    { updatedAt },
  );
  client.setQueryData(
    providerSetupQueryKeys.managedKey(workspaceId, "openrouter_api_key"),
    openRouterKey,
    { updatedAt },
  );
  return client;
}

export function ProviderListPreviewClient({
  state,
}: {
  readonly state: ProviderListPreviewState;
}): React.ReactElement {
  const [client] = useState(() => previewQueryClient(state));
  return (
    <QueryClientProvider client={client}>
      <div id="dashboard-section-content" className="min-w-0 space-y-6">
        <h2 className="text-2xl font-semibold text-cyan-50">Providers</h2>
        <ProviderList
          view={buildProviderListView(listFacts(state))}
          mutationsEnabled
          modelOptions={modelOptions}
          gatewayAccounts={gatewayAccounts}
          agentProfileOptions={[]}
          accessRightsHref="#access-rights"
        />
      </div>
    </QueryClientProvider>
  );
}
