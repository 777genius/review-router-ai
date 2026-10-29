import { App } from "@octokit/app";
import type { PrismaClient } from "@prisma/client";
import { JoseGitHubActionsOidcTokenVerifier } from "@reviewrouter/features-action-control-plane/oidc";
import { selectModelDispatchReviewAgentProfile } from "@reviewrouter/features-review-run-control";
import { createPrismaReviewRunControlRepositories } from "@reviewrouter/features-review-run-control/composition";
import {
  PrismaReviewPolicyHeadReader,
  resolveReviewRuntimeEnv,
} from "@reviewrouter/features-review-config";
import {
  requireGitHubAppPrivateKey,
  requireReviewRouterDatabaseRecoveryWitness,
  resolveReviewRouterCodexRotatingActionRef,
} from "@reviewrouter/platform-config";
import { selectReviewModelRoutePolicy } from "@reviewrouter/shared";
import { z } from "zod";
import {
  CodexRuntimeMigrationGitHub,
  type CodexRuntimeMigrationGitHubRequest,
} from "./codex-runtime-migration-github";
import { exchangeCodexRuntimeMigration } from "./codex-runtime-migration-exchange";
import { ProviderApiKeyGitHubGateway } from "./provider-api-key-github-gateway";
import {
  resolveCodexRotatingPublicWebUrl,
  resolveCodexRotatingSeedScriptDescriptor,
} from "./codex-rotating-seed-script";
import { readDashboardRuntimeReleases } from "./review-runtime-readiness";
import {
  assertCodexRuntimeMigrationTargetWorkflow,
  readImmutableTargetWorkflow,
} from "./workflow-provisioning/approved-codex-runtime-migration-ref";

export async function assertConfiguredCodexRuntimeMigrationTarget(input: {
  readonly prisma: PrismaClient;
  readonly repositoryId: string;
  readonly workspaceId: string;
  readonly targetActionRef: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly readTargetWorkflow?: (sha: string) => Promise<string>;
}): Promise<void> {
  const env = input.env ?? process.env;
  const sha = /^777genius\/review-router@([a-f0-9]{40})$/u.exec(
    input.targetActionRef,
  )?.[1];
  if (
    !sha ||
    resolveReviewRouterCodexRotatingActionRef(env) !== input.targetActionRef
  ) {
    throw new Error("codex_runtime_migration_target_unavailable");
  }
  const installer = resolveCodexRotatingSeedScriptDescriptor(env);
  if (
    installer.url !==
    `https://raw.githubusercontent.com/777genius/review-router/${sha}/scripts/seed-codex-rotating-auth.sh`
  ) {
    throw new Error("codex_runtime_migration_target_unavailable");
  }
  const releases = await readDashboardRuntimeReleases({
    env,
    releases: createPrismaReviewRunControlRepositories(input.prisma)
      .producerReleases,
  });
  const release = releases?.get(sha);
  const runtime = await resolveReviewRuntimeEnv(
    {
      scope: "repository",
      workspaceId: input.workspaceId,
      repositoryId: input.repositoryId,
    },
    { policyHeads: new PrismaReviewPolicyHeadReader(input.prisma) },
  );
  const route = release
    ? selectReviewModelRoutePolicy(
        release.modelDispatchProfile,
        runtime.config.providers,
      )
    : null;
  if (
    !release ||
    !route ||
    route.transport !== "runner_local_responses" ||
    runtime.config.providers[0]?.authMode !==
      "codex_subscription_oauth_rotating" ||
    !release.provisioningTransports.includes(route.transport)
  ) {
    throw new Error("codex_runtime_migration_target_unavailable");
  }
  selectModelDispatchReviewAgentProfile({
    agentProfiles: release.agentProfiles,
    modelTransport: "provider_api",
    preparedRouteDefaultRef: route.defaultAgentProfileRef,
    agenticContext: runtime.config.providers[0].agenticContext !== false,
    reviewSkillsDelivery: true,
  });
  const source = await (
    input.readTargetWorkflow ?? readImmutableTargetWorkflow
  )(sha);
  assertCodexRuntimeMigrationTargetWorkflow(source);
}

export async function createCodexRuntimeMigrationGitHub(input: {
  readonly githubInstallationId: string;
  readonly githubRepositoryId: string;
  readonly repositoryFullName: string;
  readonly providerInstanceId: string;
  readonly setupBaseUrl: string;
}) {
  const appId = process.env.GITHUB_APP_ID;
  if (!appId) throw new Error("github_app_not_configured");
  const privateKey = requireGitHubAppPrivateKey();
  const app = new App({ appId, privateKey });
  const repositoryId = z.coerce
    .number()
    .int()
    .positive()
    .safe()
    .parse(input.githubRepositoryId);
  const installationId = z.coerce
    .number()
    .int()
    .positive()
    .safe()
    .parse(input.githubInstallationId);
  const token = z
    .object({
      token: z.string().min(1),
      repositoryIds: z.array(z.literal(repositoryId)).length(1),
      permissions: z
        .object({
          actions: z.literal("write"),
          contents: z.literal("read"),
          metadata: z.literal("read").optional(),
        })
        .strict(),
    })
    .parse(
      await app.octokit.auth({
        type: "installation",
        installationId,
        repositoryIds: [repositoryId],
        permissions: { actions: "write", contents: "read" },
        refresh: true,
      }),
    );
  const prefix = `/repos/${input.repositoryFullName.split("/").map(encodeURIComponent).join("/")}`;
  const request: CodexRuntimeMigrationGitHubRequest = async (
    method,
    path,
    body,
  ) => {
    if (path !== prefix && !path.startsWith(`${prefix}/`))
      throw new Error("codex_runtime_migration_repository_invalid");
    const response = await fetch(`https://api.github.com${path}`, {
      method,
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
      headers: {
        authorization: `Bearer ${token.token}`,
        accept: "application/vnd.github+json",
        "content-type": "application/json",
        "x-github-api-version": "2022-11-28",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok)
      throw Object.assign(
        new Error("codex_runtime_migration_github_request_failed"),
        { status: response.status },
      );
    if (response.status === 204) return null;
    const text = await response.text();
    if (Buffer.byteLength(text) > 2 * 1024 * 1024)
      throw new Error("codex_runtime_migration_inventory_incomplete");
    return JSON.parse(text) as unknown;
  };
  const secrets = new ProviderApiKeyGitHubGateway({ appId, privateKey });
  const [owner, repo] = input.repositoryFullName.split("/");
  return {
    migration: new CodexRuntimeMigrationGitHub({ ...input, request }),
    publicKey: () =>
      secrets.getRepositoryActionsPublicKey({
        ...input,
        owner: owner!,
        repo: repo!,
      }),
  };
}

export function exchangeConfiguredCodexRuntimeMigration(input: {
  readonly prisma: PrismaClient;
  readonly migrationId: string;
  readonly oidcToken: string;
}) {
  const setupBaseUrl = resolveCodexRotatingPublicWebUrl();
  return exchangeCodexRuntimeMigration({
    ...input,
    setupBaseUrl,
    oidc: new JoseGitHubActionsOidcTokenVerifier(),
    databaseRecoveryWitness: requireReviewRouterDatabaseRecoveryWitness(),
    runtimeEnvironment: process.env,
    github: (scope) =>
      createCodexRuntimeMigrationGitHub({ ...scope, setupBaseUrl }),
    assertTargetQualified: (target) =>
      assertConfiguredCodexRuntimeMigrationTarget({
        ...target,
        prisma: input.prisma,
      }),
  });
}
