// Controlled Gateway boundary only: real RR SSR/actions/SDK, no native/provider calls.
import { createHash } from "node:crypto";
import type { WireAccount } from "./gateway-fixture.ts";

export const subscriptionProfiles = [
  {
    provider: "kimi",
    label: "Kimi",
    plan: "Coding Plan",
    planId: "coding_plan",
    profileId: "kimi-code-global-responses-apikey-v1",
    model: "k3-256k",
  },
  {
    provider: "glm",
    label: "GLM",
    plan: "Coding Plan",
    planId: "coding_plan",
    profileId: "glm-coding-global-responses-apikey-v1",
    model: "glm-5.3-flash",
  },
  {
    provider: "minimax",
    label: "MiniMax",
    plan: "M Plan",
    planId: "m_plan",
    profileId: "minimax-mplan-global-responses-apikey-v1",
    model: "MiniMax-M3.1-Flash",
  },
  {
    provider: "grok",
    label: "Grok",
    plan: "Subscription",
    planId: "subscription",
    profileId: "grok-subscription-responses-oauth-v1",
    model: "grok-4.7",
  },
] as const;
type Profile = (typeof subscriptionProfiles)[number];
type Operation = {
  operationRef: string;
  state: "pending" | "applied" | "rejected";
  error?: {
    code: "invalid_request";
    traceRef: string;
    effect: "not_dispatched";
    retry: { kind: "never" };
  };
  oauthMethod?: "browser";
  result?: {
    kind: "account";
    accountRef: string;
    metadataRevision: number;
    authorizationEpoch: number;
  };
};
type Reply = { status: number; body: unknown };
export function createSubscriptionFixture(accounts: WireAccount[]) {
  const operations = new Map<string, Operation>();
  const pending = new Map<
    string,
    { ownerRef: string; profile: Profile; displayName: string }
  >();
  const stats = {
    connects: 0,
    begins: 0,
    completes: 0,
    quotaReads: 0,
    inference: 0,
    refresh: 0,
    operationIds: [] as string[],
  };
  const state = "a".repeat(64);
  const observed = new Date(Date.now() - 60_000).toISOString();
  const resetAt = new Date(Date.now() + 3_600_000).toISOString();
  const nextResetAt = new Date(Date.now() + 86_400_000).toISOString();
  function applied(
    operationId: string,
    ownerRef: string,
    profile: Profile,
    displayName: string,
  ): Operation {
    const accountRef = `subscription-${createHash("sha256").update(operationId).digest("hex").slice(0, 24)}`;
    if (!accounts.some((account) => account.accountRef === accountRef))
      accounts.push({
        accountRef,
        ownerRef,
        profileId: profile.profileId,
        displayName,
        state: "active",
        metadataRevision: 1,
        authorizationEpoch: 1,
      });
    const operation: Operation = {
      operationRef: operationId,
      state: "applied",
      result: {
        kind: "account",
        accountRef,
        metadataRevision: 1,
        authorizationEpoch: 1,
      },
    };
    operations.set(operationId, operation);
    return operation;
  }
  return {
    stats: () => ({ ...stats, operationIds: [...stats.operationIds] }),
    observe(method: string, path: string) {
      if (method === "POST" && /\/requests$/.test(path)) stats.inference++;
      if (method === "POST" && /\/refresh$/.test(path)) stats.refresh++;
    },
    async handle(
      method: string,
      path: string,
      read: () => Promise<Record<string, unknown>>,
    ): Promise<Reply | null> {
      if (method === "GET" && path === "/v1/provider-connection-capabilities")
        return {
          status: 200,
          body: {
            contract: "provider-connections/v1",
            capabilities: subscriptionProfiles.map((profile) => ({
              contract: "provider-connections/v1",
              profileId: profile.profileId,
              provider: { identity: profile.provider, label: profile.label },
              plan: { identity: profile.planId, label: profile.plan },
              region: { identity: "global", label: "Global" },
              protocol: "openai-responses",
              modelIds: [profile.model],
              authMethods: [
                profile.provider === "grok"
                  ? "oauth_authorization_code"
                  : "api_key",
              ],
              completionInputKind:
                profile.provider === "grok" ? "callback_url" : "none",
              availability: "enabled",
              oauthCallbackMode:
                profile.provider === "grok" ? "manual_callback_url" : null,
              reconnect:
                profile.provider === "grok"
                  ? "oauth_reauthorize"
                  : "replace_api_key",
              limitsContract: "account-limits/v2",
              models: [
                {
                  modelId: profile.model,
                  reasoning: null,
                  fast: null,
                  tools: { allowed: ["function"], default: "function" },
                },
              ],
            })),
          },
        };
      if (method === "GET" && path === "/v1/profiles") return null;
      if (method === "GET" && path === "/v2/capabilities/account-limits")
        return {
          status: 200,
          body: {
            contract: "account-limits/v2",
            cachedRead: true,
            quotaOnlyRefresh: false,
          },
        };
      if (method === "POST" && path === "/v2/account-limits/read") {
        const input = await read();
        const account = accounts.find(
          (account) =>
            account.accountRef === input.accountRef &&
            account.ownerRef === input.ownerRef &&
            account.profileId === input.profileId,
        );
        const profile = subscriptionProfiles.find(
          (profile) => profile.profileId === account?.profileId,
        );
        if (!profile || !account)
          return { status: 200, body: { status: "unavailable" } };
        stats.quotaReads++;
        if (profile.provider === "minimax")
          return { status: 200, body: { status: "unavailable" } };
        return {
          status: 200,
          body: {
            status: "snapshot",
            physicalGeneration: `fixture-${account.accountRef}`,
            principalVersion: "fixture-principal",
            revision: 1,
            scope: "subscription",
            windows: [
              {
                id: "five_hour",
                provider: profile.provider,
                dimension: "plan_quota",
                unit: "credits",
                period: { kind: "duration", durationSeconds: 18000 },
                label: "5h",
                usedPercent: 20,
                observedAt: observed,
                resetAt,
              },
              {
                id: "monthly",
                provider: profile.provider,
                dimension: "plan_quota",
                unit: "credits",
                period: { kind: "monthly_billing_cycle" },
                label: "Month",
                usedPercent: 40,
                observedAt: observed,
                resetAt: nextResetAt,
              },
              {
                id: "weekly",
                provider: profile.provider,
                dimension: "plan_quota",
                unit: "credits",
                period: { kind: "duration", durationSeconds: 604800 },
                label: "Week",
                usedPercent: 30,
                observedAt: observed,
                resetAt: nextResetAt,
              },
            ],
          },
        };
      }
      const match = path.match(/^\/v1\/operations\/([^/]+)$/);
      if (method === "GET" && match && operations.has(match[1]!))
        return { status: 200, body: operations.get(match[1]!) };
      if (
        method !== "POST" ||
        ![
          "/v1/accounts",
          "/v1/accounts/oauth/begin",
          "/v1/accounts/oauth/complete",
        ].includes(path)
      )
        return null;
      const input = await read();
      const operationId = String(input.operationId);
      if (path.endsWith("/complete")) {
        const original = pending.get(operationId);
        if (
          !original ||
          typeof input.callbackURL !== "string" ||
          new URL(input.callbackURL).searchParams.get("state") !== state
        )
          return denied();
        stats.completes++;
        return {
          status: 200,
          body: applied(
            operationId,
            original.ownerRef,
            original.profile,
            original.displayName,
          ),
        };
      }
      const profile = subscriptionProfiles.find(
        (profile) => profile.profileId === input.profileId,
      );
      if (!profile) return denied();
      if (operations.has(operationId))
        return { status: 200, body: operations.get(operationId) };
      stats.operationIds.push(operationId);
      if (path.endsWith("/begin")) {
        stats.begins++;
        pending.set(operationId, {
          ownerRef: String(input.ownerRef),
          profile,
          displayName: String(input.displayName),
        });
        const operation: Operation = {
          operationRef: operationId,
          state: "pending",
          oauthMethod: "browser",
        };
        operations.set(operationId, operation);
        const query = new URLSearchParams({
          response_type: "code",
          redirect_uri: "http://127.0.0.1:56121/callback",
          code_challenge_method: "S256",
          scope:
            "openid profile email offline_access grok-cli:access api:access",
          client_id: "synthetic-browser-fixture",
          state,
          code_challenge: "b".repeat(43),
          nonce: "c".repeat(43),
        });
        return {
          status: 200,
          body: {
            operation,
            authorizationURL: `https://auth.x.ai/oauth2/authorize?${query}`,
          },
        };
      }
      if (
        (input.credential as { value?: unknown } | undefined)?.value !==
        `synthetic-${profile.provider}-subscription-key`
      ) {
        const rejected: Operation = {
          operationRef: operationId,
          state: "rejected",
          error: {
            code: "invalid_request",
            traceRef: "subscription-key-rejected",
            effect: "not_dispatched",
            retry: { kind: "never" },
          },
        };
        operations.set(operationId, rejected);
        return { status: 200, body: rejected };
      }
      stats.connects++;
      return {
        status: 200,
        body: applied(
          operationId,
          String(input.ownerRef),
          profile,
          String(input.displayName),
        ),
      };
    },
  };
}
function denied(): Reply {
  return {
    status: 400,
    body: {
      code: "invalid_request",
      traceRef: "subscription-fixture-denied",
      effect: "not_dispatched",
      retry: { kind: "never" },
    },
  };
}
