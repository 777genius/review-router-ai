import {
  providerApiDescriptors,
  type ProviderApiAuthMode,
} from "../../../packages/shared/src/review-action-companion-contracts.js";
import type { ReviewModelTransport } from "../../../packages/shared/src/review-model-dispatch-contract.js";
import {
  renderReviewRouterClaudeSubscriptionCaller,
  renderReviewRouterProviderApiCaller,
} from "../../../packages/protocol-review-workflow/src/index.js";
import {
  PrismaReviewConfigurationRepository,
  parseReviewConfigurationStrict,
  saveReviewConfiguration,
} from "../../../packages/features/review-config/src/index.js";
import {
  systemPolicyWriteFixture,
  workspacePolicyFixture,
} from "../../../packages/features/review-config/src/tests/current-policy-fixture.js";
import type { ReviewActionV2E2EHarness } from "../../review-action-v2-production-e2e/support/review-action-v2-e2e-harness.js";

export const productionRouteNames = [
  "openrouter-api",
  "mimo-token-plan-api",
  "kimi-code-api",
  "codex-subscription",
  "hosted-pool",
  "claude-subscription",
] as const;
export type ProductionRouteName = (typeof productionRouteNames)[number];

export function productionModelRoute(name?: ProductionRouteName) {
  const mode =
    name && name in providerApiDescriptors
      ? (name as ProviderApiAuthMode)
      : undefined;
  const descriptor = mode ? providerApiDescriptors[mode] : undefined;
  const anthropic = name === "claude-subscription";
  const transport: ReviewModelTransport = !name
    ? "account_gateway"
    : name === "hosted-pool"
      ? "hosted_pool"
      : anthropic
        ? "runner_local_anthropic"
        : "runner_local_responses";
  const model =
    descriptor?.defaultModel ??
    (anthropic ? "claude-sonnet-4-6" : "gpt-5-codex");
  return {
    name: name ?? "account-gateway",
    mode,
    descriptor,
    model,
    transport,
    protocol: anthropic
      ? ("anthropic-messages" as const)
      : descriptor || !name
        ? ("openai-responses" as const)
        : ("codex-responses" as const),
    provider: descriptor
      ? {
          kind: descriptor.providerKind,
          authMode: descriptor.authMode,
          model,
          ...(mode === "kimi-code-api" ? {} : { reasoningEffort: "high" }),
          agenticContext: true,
          fastMode: false,
        }
      : anthropic
        ? {
            kind: "claude",
            authMode: "claude_code_oauth",
            model: "sonnet",
            agenticContext: true,
          }
        : {
            kind: "codex",
            authMode:
              name === "hosted-pool"
                ? "codex_subscription_oauth_hosted_pool"
                : "codex_subscription_oauth_rotating",
            model,
            reasoningEffort: "high",
            agenticContext: true,
            fastMode: false,
          },
  };
}

export async function selectProductionModelRoute(
  fixture: ReviewActionV2E2EHarness,
  route: ReturnType<typeof productionModelRoute>,
) {
  const target = {
    scope: "repository" as const,
    workspaceId: fixture.workspaceId,
    repositoryId: fixture.repositoryConnectionId,
  };
  const policy = systemPolicyWriteFixture(
    parseReviewConfigurationStrict({
      ...workspacePolicyFixture,
      updatePrDescription: false,
      providers: [route.provider],
    }),
    target,
  );
  await saveReviewConfiguration(
    {
      target,
      expectedVersion: null,
      ...policy,
      profileDrafts: policy.profileDrafts.map((draft) => ({
        ...draft,
        credential:
          route.mode || route.name === "claude-subscription"
            ? {
                kind: "user_ci_secret" as const,
                authMode: route.provider.authMode as
                  | "openrouter_api_key"
                  | "mimo_token_plan_api_key"
                  | "kimi_code_api_key"
                  | "claude_code_oauth",
              }
            : draft.credential,
      })),
    },
    {
      configurations: new PrismaReviewConfigurationRepository(
        fixture.prisma,
        undefined,
        false,
        undefined,
      ),
    },
  );
  if (!route.mode && route.name !== "claude-subscription") return;
  const runtimeRef = (
    await fixture.prisma.producerRelease.findUniqueOrThrow({
      where: { producerReleaseId: fixture.producerReleaseId },
      select: { actionCommitSha: true },
    })
  ).actionCommitSha!;
  const caller = route.mode
    ? renderReviewRouterProviderApiCaller({
        runtimeRef,
        controlPlaneUrl: fixture.env.REVIEW_ROUTER_PUBLIC_API_URL!,
        providerApiAuthMode: route.mode,
      })
    : renderReviewRouterClaudeSubscriptionCaller({
        runtimeRef,
        controlPlaneUrl: fixture.env.REVIEW_ROUTER_PUBLIC_API_URL!,
      });
  const previous = fixture.fakeGitHub.fetch;
  const fetch: typeof fixture.fakeGitHub.fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    if (
      url.hostname === "api.github.com" &&
      decodeURIComponent(url.pathname).endsWith(
        "/contents/.github/workflows/reviewrouter-review.yml",
      )
    ) {
      if (url.searchParams.get("ref") !== fixture.fakeGitHub.revision.headSha)
        throw new Error("paired_route_caller_revision_mismatch");
      return Response.json({
        type: "file",
        path: ".github/workflows/reviewrouter-review.yml",
        encoding: "base64",
        content: Buffer.from(caller).toString("base64"),
      });
    }
    if (
      url.hostname === "api.github.com" &&
      request.method === "POST" &&
      url.pathname.endsWith("/access_tokens")
    ) {
      const raw = await request.clone().text();
      const body = (raw ? JSON.parse(raw) : {}) as {
        permissions?: Record<string, string>;
      };
      if (
        body.permissions?.contents === "read" &&
        !body.permissions?.checks &&
        !body.permissions?.issues
      )
        return Response.json(
          {
            token: "paired-read-only-token",
            expires_at: new Date(Date.now() + 600_000).toISOString(),
            permissions: body.permissions,
            repository_selection: "selected",
          },
          { status: 201 },
        );
    }
    return previous(input, init);
  };
  return fetch;
}
