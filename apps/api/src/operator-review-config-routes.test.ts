import { createHash } from "node:crypto";
import Fastify from "fastify";
import {
  HashedReviewConfigurationOperatorAuthorization,
  parseRepositoryReviewPolicy,
  resolveEffectiveReviewPolicy,
  resolveReviewConfiguration,
  ReviewConfigurationWriteConflictError,
  parseReviewConfigurationStrict,
  type OperatorReviewConfigurationDependencies,
  type ReviewConfiguration,
  type ReviewInvestigationRolloutConfiguration,
  type ReviewConfigurationOperatorAuditEvent,
} from "@reviewrouter/features-review-config";
import { afterEach, describe, expect, it } from "vitest";
import { InMemoryReviewConfigurationRepository } from "../../../packages/features/review-config/src/tests/in-memory-review-configuration";
import {
  providerProfileFixture,
  workspacePolicyDocumentFixture,
} from "../../../packages/features/review-config/src/tests/current-policy-fixture";
import { registerOperatorReviewConfigRoutes } from "./operator-review-config-routes.js";

const workspacePolicy = parseReviewConfigurationStrict({
  schemaVersion: 3,
  providers: [
    {
      kind: "codex",
      authMode: "codex_subscription_oauth_hosted_pool",
      model: "gpt-5.6-sol",
      reasoningEffort: "xhigh",
      agenticContext: true,
      fastMode: false,
      requiredHealthy: true,
    },
  ],
  execution: {
    providerLimit: 1,
    providerMaxParallel: 1,
    inlineMinAgreement: 1,
  },
  blockingPolicy: { failOnSeverity: "critical" },
  limits: { inlineMaxComments: 5, targetTokensPerBatch: 50000 },
  reviewLanguage: null,
  investigationRollout: {
    recordingEnabled: true,
    shadowEnabled: true,
    contextCriticEnabled: true,
    verifiedCleanEnabled: true,
    crossRevisionReplayEnabled: false,
    productionEffectsEnabled: true,
  },
});

/** Stores the configuration as the workspace default over a hosted profile. */
async function seedWorkspace(
  configurations: InMemoryReviewConfigurationRepository,
  config: ReviewConfiguration,
) {
  const profile = providerProfileFixture({
    id: `profile_hosted_${config.providers[0]!.model}`,
    credential: {
      kind: "hosted_pool",
      authMode: "codex_subscription_oauth_hosted_pool",
    },
    model: config.providers[0]!.model,
  });
  configurations.addProfile(profile);
  await configurations.saveNextVersion({
    target: { scope: "workspace", workspaceId: "workspace_1" },
    policy: workspacePolicyDocumentFixture(config, [profile.id]),
  });
}

const credential = "route-operator-credential-with-32-characters";
const disabledRollout = {
  recordingEnabled: false,
  shadowEnabled: false,
  contextCriticEnabled: false,
  verifiedCleanEnabled: false,
  crossRevisionReplayEnabled: false,
  productionEffectsEnabled: false,
} as const;
const shadowRollout = {
  ...disabledRollout,
  recordingEnabled: true,
  shadowEnabled: true,
} as const;
const fullRollout = {
  recordingEnabled: true,
  shadowEnabled: true,
  contextCriticEnabled: true,
  verifiedCleanEnabled: true,
  crossRevisionReplayEnabled: true,
  productionEffectsEnabled: true,
} as const;

async function createHarness() {
  const configurations = new InMemoryReviewConfigurationRepository();
  await seedWorkspace(configurations, workspacePolicy);
  const auditEvents: ReviewConfigurationOperatorAuditEvent[] = [];
  /** Effective configuration of every stored repository version, in order. */
  const repositoryHistory = () =>
    [...configurations.heads.entries()]
      .filter(([key]) => key.startsWith("repo:"))
      .flatMap(([key, heads]) =>
        heads.map(
          (head) =>
            resolveEffectiveReviewPolicy({
              target: {
                scope: "repository",
                workspaceId: "workspace_1",
                repositoryId: key.slice("repo:".length),
              },
              workspace: JSON.parse(
                configurations.heads.get("workspace:default")!.at(-1)!
                  .policyJson!,
              ),
              repository: parseRepositoryReviewPolicy(
                JSON.parse(head.policyJson!),
              ),
              profiles: configurations.profiles,
            })!.config,
        ),
      );
  const mutations: OperatorReviewConfigurationDependencies["mutations"] = {
    async commit(input) {
      const current = await resolveReviewConfiguration(input.target, {
        configurations,
      });
      if (!current || current.revisionToken !== input.expectedRevisionToken) {
        throw new ReviewConfigurationWriteConflictError();
      }
      const saved = await configurations.saveNextVersion({
        target: input.target,
        policy: input.policy,
        expectedVersion: current.repositoryVersion,
      });
      auditEvents.push({
        ...input.auditEvent,
        metadata: { ...input.auditEvent.metadata, version: saved.version },
      });
      return saved;
    },
  };
  const dependencies = {
    authorization: new HashedReviewConfigurationOperatorAuthorization(
      "operator:route-test",
      createHash("sha256").update(credential).digest("hex"),
    ),
    repositories: {
      async findActiveCandidates(input) {
        return input.repositoryFullName.toLowerCase() === "777genius/example"
          ? [
              {
                id: "repo_1",
                workspaceId: "workspace_1",
                workspaceSlug: "workspace-one",
                provider: "github",
                sourceBaseUrl: "https://github.com",
                fullName: "777genius/example",
              },
            ]
          : [];
      },
    },
    rateLimits: {
      async consume() {
        return true;
      },
    },
    configurations,
    mutations,
    audit: {
      async record(event) {
        auditEvents.push(event);
      },
    },
  } satisfies OperatorReviewConfigurationDependencies;
  return { dependencies, configurations, repositoryHistory, auditEvents };
}

async function createDependencies(): Promise<OperatorReviewConfigurationDependencies> {
  return (await createHarness()).dependencies;
}

const apps: ReturnType<typeof Fastify>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function createApp() {
  const app = Fastify({ logger: false });
  apps.push(app);
  await registerOperatorReviewConfigRoutes(app, await createDependencies());
  return app;
}

describe("operator review config routes", () => {
  it("returns conflict for missing workspace policy without writing", async () => {
    const harness = await createHarness();
    harness.configurations.heads.clear();
    const app = Fastify({ logger: false });
    apps.push(app);
    await registerOperatorReviewConfigRoutes(app, harness.dependencies);
    const response = await app.inject({
      method: "PATCH",
      url: "/api/operator/v1/review-config",
      headers: { authorization: `Bearer ${credential}` },
      payload: { repository: "777genius/example", effort: "high" },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: { code: "configuration_missing" },
    });
    expect(harness.configurations.heads.size).toBe(0);
    expect(harness.auditEvents).toEqual([]);
  });

  it("requires a valid bearer credential", async () => {
    const app = await createApp();

    const response = await app.inject({
      method: "GET",
      url: "/api/operator/v1/review-config?repo=777genius/example",
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: { code: "unauthorized" } });
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("sets and reads a repository-specific effort", async () => {
    const app = Fastify({ logger: false });
    apps.push(app);
    const dependencies = await createDependencies();
    await registerOperatorReviewConfigRoutes(app, dependencies);

    const patch = await app.inject({
      method: "PATCH",
      url: "/api/operator/v1/review-config",
      headers: { authorization: `Bearer ${credential}` },
      payload: {
        repository: "777genius/example",
        effort: "ultra",
      },
    });
    const get = await app.inject({
      method: "GET",
      url: "/api/operator/v1/review-config?repo=777genius/example",
      headers: { authorization: `Bearer ${credential}` },
    });

    expect(patch.statusCode).toBe(200);
    expect(patch.json().result).toMatchObject({
      changed: true,
      source: "repository",
      reasoningEffort: "ultra",
    });
    expect(get.statusCode).toBe(200);
    expect(get.json().result).toMatchObject({
      source: "repository",
      reasoningEffort: "ultra",
    });
  });

  it("rejects ultra for a Codex model that does not support it", async () => {
    const app = Fastify({ logger: false });
    apps.push(app);
    const harness = await createHarness();
    await seedWorkspace(
      harness.configurations,
      parseReviewConfigurationStrict({
        ...workspacePolicy,
        providers: [{ ...workspacePolicy.providers[0]!, model: "gpt-5.5" }],
      }),
    );
    await registerOperatorReviewConfigRoutes(app, harness.dependencies);

    const response = await app.inject({
      method: "PATCH",
      url: "/api/operator/v1/review-config",
      headers: { authorization: `Bearer ${credential}` },
      payload: {
        repository: "777genius/example",
        effort: "ultra",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: { code: "unsupported_reasoning_effort" },
    });
  });

  it("creates and reads a repository-scoped investigation rollout version", async () => {
    const app = Fastify({ logger: false });
    apps.push(app);
    const harness = await createHarness();
    await registerOperatorReviewConfigRoutes(app, harness.dependencies);

    const response = await putRollout(app, {
      expectedCurrentVersion: null,
      investigationRollout: fullRollout,
      reason: "disposable canary",
    });
    const readback = await app.inject({
      method: "GET",
      url: "/api/operator/v1/review-config?repo=777genius/example",
      headers: { authorization: `Bearer ${credential}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().result).toMatchObject({
      source: "repository",
      repositoryVersion: 1,
      previousRepositoryVersion: null,
      investigationRollout: fullRollout,
    });
    expect(readback.json().result).toMatchObject({
      repositoryVersion: 1,
      investigationRollout: fullRollout,
    });
    const saved = harness.repositoryHistory().at(-1);
    expect(saved?.providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ model: "gpt-5.6-sol" }),
      ]),
    );
    expect(saved?.investigationRollout).toEqual(fullRollout);
  });

  it.each([
    [
      "shadow requires recording",
      { ...shadowRollout, recordingEnabled: false },
    ],
    [
      "critic requires shadow",
      {
        ...disabledRollout,
        recordingEnabled: true,
        contextCriticEnabled: true,
      },
    ],
    [
      "effects require shadow and critic",
      {
        ...disabledRollout,
        recordingEnabled: true,
        productionEffectsEnabled: true,
      },
    ],
    [
      "verified clean requires critic and effects",
      { ...shadowRollout, verifiedCleanEnabled: true },
    ],
    [
      "replay requires shadow",
      {
        ...disabledRollout,
        recordingEnabled: true,
        crossRevisionReplayEnabled: true,
      },
    ],
  ])("rejects an invalid dependency lattice: %s", async (_name, rollout) => {
    const app = await createApp();

    const response = await putRollout(app, {
      expectedCurrentVersion: null,
      investigationRollout: rollout,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: { code: "invalid_investigation_rollout" },
    });
  });

  it("fails closed for a stale expected repository version", async () => {
    const app = Fastify({ logger: false });
    apps.push(app);
    const harness = await createHarness();
    await registerOperatorReviewConfigRoutes(app, harness.dependencies);
    await putRollout(app, {
      expectedCurrentVersion: null,
      investigationRollout: shadowRollout,
    });

    const stale = await putRollout(app, {
      expectedCurrentVersion: null,
      investigationRollout: disabledRollout,
    });

    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toEqual({
      error: { code: "configuration_changed" },
    });
    expect(harness.repositoryHistory()).toHaveLength(1);
    expect(harness.auditEvents).toHaveLength(1);
  });

  it("rolls a canary back by creating another immutable version", async () => {
    const app = Fastify({ logger: false });
    apps.push(app);
    const harness = await createHarness();
    await registerOperatorReviewConfigRoutes(app, harness.dependencies);
    const enabled = await putRollout(app, {
      expectedCurrentVersion: null,
      investigationRollout: shadowRollout,
    });

    const rollback = await putRollout(app, {
      expectedCurrentVersion: enabled.json().result.repositoryVersion,
      investigationRollout: disabledRollout,
      reason: "canary rollback",
    });

    expect(rollback.statusCode).toBe(200);
    expect(rollback.json().result).toMatchObject({
      repositoryVersion: 2,
      previousRepositoryVersion: 1,
      previousInvestigationRollout: shadowRollout,
      investigationRollout: disabledRollout,
    });
    const history = harness.repositoryHistory();
    expect(history).toHaveLength(2);
    expect(history[0]?.investigationRollout).toEqual(shadowRollout);
    expect(history[1]?.investigationRollout).toEqual(disabledRollout);
  });

  it("requires authorization and audits only the accepted rollout mutation", async () => {
    const app = Fastify({ logger: false });
    apps.push(app);
    const harness = await createHarness();
    await registerOperatorReviewConfigRoutes(app, harness.dependencies);

    const unauthorized = await app.inject({
      method: "PUT",
      url: "/api/operator/v1/review-config/investigation-rollout",
      payload: rolloutPayload({
        expectedCurrentVersion: null,
        investigationRollout: shadowRollout,
      }),
    });
    const authorized = await putRollout(app, {
      expectedCurrentVersion: null,
      investigationRollout: shadowRollout,
      reason: "authorized canary",
    });

    expect(unauthorized.statusCode).toBe(401);
    expect(authorized.statusCode).toBe(200);
    expect(harness.auditEvents).toHaveLength(1);
    expect(harness.auditEvents[0]).toMatchObject({
      actor: "operator:route-test",
      action: "review_config.operator_investigation_rollout_set",
      targetType: "repository",
      targetId: "repo_1",
      metadata: {
        expectedCurrentVersion: null,
        investigationRollout: shadowRollout,
        reason: "authorized canary",
      },
    });
    expect(JSON.stringify(harness.auditEvents)).not.toContain(credential);
  });

  it("reports a missing repository for rollout mutation", async () => {
    const app = await createApp();

    const response = await putRollout(
      app,
      {
        expectedCurrentVersion: null,
        investigationRollout: shadowRollout,
      },
      "777genius/missing",
    );

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: { code: "repository_not_found" },
    });
  });

  it("rejects invalid input and reports an unknown repository", async () => {
    const app = await createApp();
    const invalid = await app.inject({
      method: "PATCH",
      url: "/api/operator/v1/review-config",
      headers: { authorization: `Bearer ${credential}` },
      payload: {
        repository: "777genius/example",
        effort: "extreme",
      },
    });
    const missing = await app.inject({
      method: "GET",
      url: "/api/operator/v1/review-config?repo=777genius/missing",
      headers: { authorization: `Bearer ${credential}` },
    });

    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toEqual({ error: { code: "invalid_request" } });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({
      error: { code: "repository_not_found" },
    });
  });
});

function rolloutPayload(
  input: Readonly<{
    expectedCurrentVersion: number | null;
    investigationRollout: ReviewInvestigationRolloutConfiguration;
    reason?: string;
  }>,
  repository = "777genius/example",
) {
  return {
    repository,
    expectedCurrentVersion: input.expectedCurrentVersion,
    investigationRollout: input.investigationRollout,
    ...(input.reason ? { reason: input.reason } : {}),
  };
}

function putRollout(
  app: ReturnType<typeof Fastify>,
  input: Parameters<typeof rolloutPayload>[0],
  repository?: string,
) {
  return app.inject({
    method: "PUT",
    url: "/api/operator/v1/review-config/investigation-rollout",
    headers: { authorization: `Bearer ${credential}` },
    payload: rolloutPayload(input, repository),
  });
}
