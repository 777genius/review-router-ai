import { AuthorityError } from "@reviewrouter/features-sdk-growth-authority";
import Fastify from "fastify";
import { ZodError } from "zod";
import { describe, expect, it, vi } from "vitest";
import type {
  ActionControlPlaneRepositoryPort,
  GitHubActionsOidcClaims,
} from "@reviewrouter/features-action-control-plane";
import type {
  AuthenticatedEfExecution,
  EfAuthorityService,
} from "@reviewrouter/features-sdk-growth-authority";
import { OctokitSdkGrowthExecutionResolver } from "./github/octokit-sdk-growth-execution-resolver.js";
import {
  registerSdkGrowthAuthorityRoutes,
  SdkGrowthOidcAuthentication,
} from "./sdk-growth-authority-routes.js";

const claims = (): GitHubActionsOidcClaims => ({
  iss: "https://token.actions.githubusercontent.com",
  aud: "sdk-growth",
  sub: "repo:acme/repo:pull_request",
  repository: "acme/repo",
  repository_id: "123",
  repository_owner: "acme",
  event_name: "pull_request",
  ref: "refs/pull/42/merge",
  run_id: "456",
  run_attempt: "2",
  workflow_ref: "acme/repo/.github/workflows/verify.yml@refs/heads/main",
  workflow_sha: "4".repeat(40),
  job_workflow_sha: "5".repeat(40),
  actor: "runner",
  exp: 2_000_000_000,
  jti: "nonce",
});

const repository = {
  workspaceId: "tenant",
  repositoryId: "repo",
  githubRepositoryId: "123",
  githubInstallationId: "789",
  fullName: "acme/repo",
  owner: "acme",
  selected: true,
  installationStatus: "active",
};

function authentication(
  overrides: {
    readonly claims?: GitHubActionsOidcClaims;
    readonly audience?: string;
    readonly repository?: typeof repository | null;
    readonly resolved?: {
      installationId: string;
      runId: string;
      runAttempt: string;
      verifierRevision: string;
      sourceCommit: string;
      sourceTree: string;
      pullRequest: number;
      headRepositoryId: string;
      baseRepositoryId: string;
      baseRef: string;
      baseCommit: string;
      baseTree: string;
      mergeBaseCommit: string;
      mergeBaseTree: string;
    } | null;
    readonly consume?: boolean;
    readonly rejectVerification?: boolean;
  } = {},
) {
  const verified = overrides.claims ?? claims();
  const expectedAudience = overrides.audience ?? "sdk-growth";
  const selected =
    overrides.repository === undefined ? repository : overrides.repository;
  const resolved =
    overrides.resolved === undefined
      ? {
          installationId: "789",
          runId: "456",
          runAttempt: "2",
          verifierRevision: "5".repeat(40),
          sourceCommit: "6".repeat(40),
          sourceTree: "7".repeat(40),
          pullRequest: 42,
          headRepositoryId: "123",
          baseRepositoryId: "123",
          baseRef: "main",
          baseCommit: "8".repeat(40),
          baseTree: "9".repeat(40),
          mergeBaseCommit: "8".repeat(40),
          mergeBaseTree: "9".repeat(40),
        }
      : overrides.resolved;
  return new SdkGrowthOidcAuthentication(
    {
      async verify(input) {
        if (overrides.rejectVerification) throw new Error("issuer rejected");
        if (input.token !== "oidc" || input.audience !== expectedAudience)
          throw new Error("jwt rejected");
        return verified;
      },
    },
    {
      async findSelectedRepositoryByGithubId() {
        return selected;
      },
    } as unknown as ActionControlPlaneRepositoryPort,
    {
      async tryConsumeNonce() {
        return overrides.consume ?? true;
      },
    },
    {
      async resolve() {
        return resolved;
      },
    },
    "sdk-growth",
    () => new Date(1_000),
  );
}

function request() {
  return {
    headers: { authorization: "Bearer oidc" },
  } as never;
}

describe("SDK growth OIDC authentication", () => {
  it("uses workflow_sha only for historical GET when reusable workflow SHA is absent", async () => {
    const resolve = vi.fn();
    const resolveHistorical = vi.fn().mockResolvedValue({
      installationId: "789",
      runId: "456",
      runAttempt: "2",
      verifierRevision: "4".repeat(40),
      pullRequest: 42,
      sourceCommit: "9".repeat(40),
      sourceTree: "a".repeat(40),
    });
    const auth = new SdkGrowthOidcAuthentication(
      {
        verify: vi
          .fn()
          .mockResolvedValue({ ...claims(), job_workflow_sha: undefined }),
      },
      {
        findSelectedRepositoryByGithubId: vi.fn().mockResolvedValue(repository),
      } as unknown as ActionControlPlaneRepositoryPort,
      { tryConsumeNonce: vi.fn().mockResolvedValue(true) },
      { resolve, resolveHistorical },
      "sdk-growth",
      () => new Date(1_000),
    );
    const route = { repositoryId: "repo", pullRequest: 42 };
    const result = await auth.authenticateReadback(request(), route);
    expect(result.current).toBeNull();
    expect(await result.historical?.()).toMatchObject({
      verifierRevision: "4".repeat(40),
      sourceCommit: "9".repeat(40),
    });
    expect(resolve).not.toHaveBeenCalled();
    await expect(auth.authenticate(request(), route)).rejects.toMatchObject({
      code: "wrong-identity",
    });
  });

  it("derives the complete execution identity outside request JSON", async () => {
    await expect(
      authentication().authenticate(request(), {
        repositoryId: "repo",
        pullRequest: 42,
      }),
    ).resolves.toEqual({
      tenantId: "tenant",
      repositoryId: "repo",
      pullRequest: 42,
      githubRepositoryId: "123",
      installationId: "789",
      subject: "repo:acme/repo:pull_request",
      runId: "456",
      runAttempt: "2",
      verifierRevision: "5".repeat(40),
      sourceCommit: "6".repeat(40),
      sourceTree: "7".repeat(40),
      sourceBinding: {
        headRepositoryId: "123",
        baseRepositoryId: "123",
        baseRef: "main",
        baseCommit: "8".repeat(40),
        baseTree: "9".repeat(40),
        mergeBaseCommit: "8".repeat(40),
        mergeBaseTree: "9".repeat(40),
      },
    });
  });

  it.each([
    ["issuer", () => authentication({ rejectVerification: true })],
    ["audience", () => authentication({ audience: "wrong" })],
    [
      "repository",
      () => authentication({ claims: { ...claims(), repository_id: "999" } }),
    ],
    [
      "event",
      () =>
        authentication({
          claims: { ...claims(), event_name: "pull_request_target" },
        }),
    ],
    [
      "PR ref",
      () =>
        authentication({ claims: { ...claims(), ref: "refs/pull/99/merge" } }),
    ],
    [
      "workflow revision",
      () =>
        authentication({
          claims: { ...claims(), job_workflow_sha: undefined },
        }),
    ],
    [
      "installation",
      () =>
        authentication({
          resolved: {
            installationId: "wrong",
            runId: "456",
            runAttempt: "2",
            verifierRevision: "5".repeat(40),
            sourceCommit: "6".repeat(40),
            sourceTree: "7".repeat(40),
            pullRequest: 42,
            headRepositoryId: "123",
            baseRepositoryId: "123",
            baseRef: "main",
            baseCommit: "8".repeat(40),
            baseTree: "9".repeat(40),
            mergeBaseCommit: "8".repeat(40),
            mergeBaseTree: "9".repeat(40),
          },
        }),
    ],
    [
      "run",
      () =>
        authentication({
          resolved: {
            installationId: "789",
            runId: "wrong",
            runAttempt: "2",
            verifierRevision: "5".repeat(40),
            sourceCommit: "6".repeat(40),
            sourceTree: "7".repeat(40),
            pullRequest: 42,
            headRepositoryId: "123",
            baseRepositoryId: "123",
            baseRef: "main",
            baseCommit: "8".repeat(40),
            baseTree: "9".repeat(40),
            mergeBaseCommit: "8".repeat(40),
            mergeBaseTree: "9".repeat(40),
          },
        }),
    ],
    [
      "attempt",
      () =>
        authentication({
          resolved: {
            installationId: "789",
            runId: "456",
            runAttempt: "wrong",
            verifierRevision: "5".repeat(40),
            sourceCommit: "6".repeat(40),
            sourceTree: "7".repeat(40),
            pullRequest: 42,
            headRepositoryId: "123",
            baseRepositoryId: "123",
            baseRef: "main",
            baseCommit: "8".repeat(40),
            baseTree: "9".repeat(40),
            mergeBaseCommit: "8".repeat(40),
            mergeBaseTree: "9".repeat(40),
          },
        }),
    ],
    [
      "verifier revision",
      () =>
        authentication({
          resolved: {
            installationId: "789",
            runId: "456",
            runAttempt: "2",
            verifierRevision: "8".repeat(40),
            sourceCommit: "6".repeat(40),
            sourceTree: "7".repeat(40),
            pullRequest: 42,
            headRepositoryId: "123",
            baseRepositoryId: "123",
            baseRef: "main",
            baseCommit: "8".repeat(40),
            baseTree: "9".repeat(40),
            mergeBaseCommit: "8".repeat(40),
            mergeBaseTree: "9".repeat(40),
          },
        }),
    ],
    ["nonce replay", () => authentication({ consume: false })],
  ])("rejects wrong %s", async (_name, create) => {
    await expect(
      create().authenticate(request(), {
        repositoryId: "repo",
        pullRequest: 42,
      }),
    ).rejects.toBeDefined();
  });
});

describe("SDK growth authority routes", () => {
  // Regression: GitHub can null a deleted fork's head.repo after closure.
  // A throw during current capture would prevent verified v1 GET readback.
  it("reads historical v1 custody after a closed PR loses its fork repository", async () => {
    const legacy = {
      installationId: "789",
      runId: "456",
      runAttempt: "2",
      verifierRevision: "5".repeat(40),
      pullRequest: 42,
      sourceCommit: "9".repeat(40),
      sourceTree: "a".repeat(40),
    };
    const githubRequest = vi.fn(async (route: string) => {
      if (route === "GET /repos/{owner}/{repo}")
        return { data: { id: 123, full_name: "acme/repo" } };
      if (route === "GET /repos/{owner}/{repo}/pulls/{pull_number}")
        return {
          data: {
            number: 42,
            state: "closed",
            head: { sha: "6".repeat(40), repo: null },
            base: { sha: "8".repeat(40), ref: "main", repo: { id: 123 } },
          },
        };
      if (route === "GET /repos/{owner}/{repo}/actions/runs/{run_id}")
        return {
          data: {
            id: 456,
            run_attempt: 2,
            event: "pull_request",
            head_sha: legacy.sourceCommit,
            workflow_id: 7,
            path: ".github/workflows/verify.yml",
            repository: { id: 123, full_name: "acme/repo" },
            pull_requests: [],
          },
        };
      if (route === "GET /repos/{owner}/{repo}/git/commits/{commit_sha}")
        return {
          data: {
            sha: legacy.sourceCommit,
            tree: { sha: legacy.sourceTree },
          },
        };
      throw new Error(`Unexpected GitHub route: ${route}`);
    });
    const executions = new OctokitSdkGrowthExecutionResolver({
      app: { getInstallationOctokit: async () => ({ request: githubRequest }) },
    });
    const nonce = vi.fn().mockResolvedValue(true);
    const auth = new SdkGrowthOidcAuthentication(
      { verify: vi.fn().mockResolvedValue(claims()) },
      {
        findSelectedRepositoryByGithubId: vi.fn().mockResolvedValue(repository),
      } as unknown as ActionControlPlaneRepositoryPort,
      { tryConsumeNonce: nonce },
      executions,
      "sdk-growth",
      () => new Date(1_000),
    );
    const grant = Buffer.from("historical-grant");
    const receipt = Buffer.from("historical-receipt");
    const stored = {
      tenantId: "tenant",
      repositoryId: "repo",
      pullRequest: 42,
      githubRepositoryId: "123",
      installationId: "789",
      subject: "repo:acme/repo:pull_request",
      runId: "456",
      runAttempt: "2",
      verifierRevision: "5".repeat(40),
      sourceCommit: "9".repeat(40),
      sourceTree: "a".repeat(40),
    };
    const service = {
      admit: vi.fn(),
      complete: vi.fn(),
      admissionReadback: vi.fn(async (value: AuthenticatedEfExecution) =>
        JSON.stringify(value) === JSON.stringify(stored) ? grant : null,
      ),
      completionReadback: vi.fn(async (value: AuthenticatedEfExecution) =>
        JSON.stringify(value) === JSON.stringify(stored) ? receipt : null,
      ),
      status: vi.fn(),
      historicalStatus: vi.fn(async (value: AuthenticatedEfExecution) =>
        JSON.stringify(value) === JSON.stringify(stored)
          ? {
              requestDigest: "request",
              grantDigest: "grant",
              completionDigest: "completion",
              receiptDigest: "receipt",
              publicationState: "applied",
              authorityState: "stale",
            }
          : null,
      ),
    };
    const app = Fastify();
    await registerSdkGrowthAuthorityRoutes(app, {
      authentication: auth,
      service: service as unknown as EfAuthorityService,
    });
    const base = "/sdk-growth/v1/repositories/repo/pulls/42";
    const requestDigest = "sha256:" + "a".repeat(64);
    const completionDigest = "sha256:" + "b".repeat(64);
    const getGrant = await app.inject({
      method: "GET",
      url: `${base}/requests/${requestDigest}`,
      headers: { authorization: "Bearer oidc" },
    });
    const getReceipt = await app.inject({
      method: "GET",
      url: `${base}/receipts?requestDigest=${requestDigest}&completionDigest=${completionDigest}`,
      headers: { authorization: "Bearer oidc" },
    });
    const getStatus = await app.inject({
      method: "GET",
      url: `${base}/status?requestDigest=${requestDigest}`,
      headers: { authorization: "Bearer oidc" },
    });
    expect(getGrant.body).toBe(grant.toString());
    expect(getReceipt.body).toBe(receipt.toString());
    expect(getStatus.json().authorityState).toBe("stale");
    expect(nonce).toHaveBeenCalledTimes(3);
    expect(service.status).not.toHaveBeenCalled();
    const historicalRunReads = githubRequest.mock.calls.filter(([route]) =>
      route.includes("actions/runs"),
    ).length;
    expect(historicalRunReads).toBe(6);
    const post = await app.inject({
      method: "POST",
      url: `${base}/requests`,
      payload: {},
      headers: { authorization: "Bearer oidc" },
    });
    expect(post.statusCode).toBe(403);
    expect(service.admit).not.toHaveBeenCalled();
    expect(
      githubRequest.mock.calls.filter(([route]) =>
        route.includes("actions/runs"),
      ),
    ).toHaveLength(historicalRunReads);
    expect(
      githubRequest.mock.calls.filter(([route]) => route.includes("/pulls/")),
    ).toHaveLength(4);
    expect(
      githubRequest.mock.calls.some(([route]) => route.includes("/compare/")),
    ).toBe(false);
    await app.close();
  });

  it("tries v1 GET only after v2 custody misses", async () => {
    const current = {
      repositoryId: "repo",
      pullRequest: 42,
      sourceBinding: { baseRef: "main" },
    } as AuthenticatedEfExecution;
    const historical = {
      repositoryId: "repo",
      pullRequest: 42,
      sourceCommit: "9".repeat(40),
    } as AuthenticatedEfExecution;
    const readback = vi.fn(async (value: AuthenticatedEfExecution) =>
      value === historical ? Buffer.from("v1-grant") : null,
    );
    const loadHistorical = vi.fn(async () => historical);
    const app = Fastify();
    await registerSdkGrowthAuthorityRoutes(app, {
      authentication: {
        authenticate: vi.fn(),
        authenticateReadback: vi
          .fn()
          .mockResolvedValue({ current, historical: loadHistorical }),
      },
      service: { admissionReadback: readback } as unknown as EfAuthorityService,
    });
    const response = await app.inject({
      method: "GET",
      url:
        "/sdk-growth/v1/repositories/repo/pulls/42/requests/sha256:" +
        "a".repeat(64),
    });
    expect(response.body).toBe("v1-grant");
    expect(readback.mock.calls.map(([value]) => value)).toEqual([
      current,
      historical,
    ]);
    expect(loadHistorical).toHaveBeenCalledOnce();
    readback.mockResolvedValueOnce(Buffer.from("v2-grant"));
    const currentResponse = await app.inject({
      method: "GET",
      url:
        "/sdk-growth/v1/repositories/repo/pulls/42/requests/sha256:" +
        "a".repeat(64),
    });
    expect(currentResponse.body).toBe("v2-grant");
    expect(loadHistorical).toHaveBeenCalledOnce();
    await app.close();
  });

  it("registers admission, both readbacks, completion and status", async () => {
    const execution = {
      tenantId: "tenant",
      repositoryId: "repo",
      pullRequest: 42,
    } as AuthenticatedEfExecution;
    const service = {
      admit: vi.fn().mockResolvedValue(Buffer.from("grant")),
      admissionReadback: vi.fn().mockResolvedValue(Buffer.from("grant")),
      complete: vi.fn().mockResolvedValue(Buffer.from("receipt")),
      completionReadback: vi.fn().mockResolvedValue(Buffer.from("receipt")),
      status: vi.fn().mockResolvedValue({
        requestDigest: "request",
        grantDigest: "grant",
        grantWire: Buffer.from("grant"),
        completionDigest: "completion",
        receiptDigest: "receipt",
        receiptWire: Buffer.from("receipt"),
        publicationState: "ready",
      }),
    };
    const app = Fastify();
    await registerSdkGrowthAuthorityRoutes(app, {
      authentication: { authenticate: vi.fn().mockResolvedValue(execution) },
      service: service as unknown as EfAuthorityService,
    });
    const base = "/sdk-growth/v1/repositories/repo/pulls/42";
    const requestDigest = "sha256:" + "a".repeat(64);
    const completionDigest = "sha256:" + "b".repeat(64);
    const requests = [
      app.inject({ method: "POST", url: base + "/requests", payload: {} }),
      app.inject({
        method: "GET",
        url: base + "/requests/" + requestDigest,
      }),
      app.inject({ method: "POST", url: base + "/completions", payload: {} }),
      app.inject({
        method: "GET",
        url:
          base +
          "/receipts?requestDigest=" +
          requestDigest +
          "&completionDigest=" +
          completionDigest,
      }),
      app.inject({
        method: "GET",
        url: base + "/status?requestDigest=" + requestDigest,
      }),
    ];
    const responses = await Promise.all(requests);
    expect(responses.map((response) => response.statusCode)).toEqual([
      200, 200, 200, 200, 200,
    ]);
    expect(service.admit).toHaveBeenCalledOnce();
    expect(service.admissionReadback).toHaveBeenCalledOnce();
    expect(service.complete).toHaveBeenCalledOnce();
    expect(service.completionReadback).toHaveBeenCalledOnce();
    expect(service.status).toHaveBeenCalledOnce();
    expect(service.admissionReadback).toHaveBeenCalledWith(
      execution,
      "repo",
      42,
      requestDigest,
    );
    expect(service.completionReadback).toHaveBeenCalledWith(
      execution,
      "repo",
      42,
      requestDigest,
      completionDigest,
    );
    expect(service.status).toHaveBeenCalledWith(
      execution,
      "repo",
      42,
      requestDigest,
    );
    await app.close();
  });

  it("fails closed when PR 99 reads custody admitted and completed for PR 42", async () => {
    const execution = {
      tenantId: "tenant",
      repositoryId: "repo",
      pullRequest: 99,
    } as AuthenticatedEfExecution;
    const service = {
      admissionReadback: vi.fn().mockResolvedValue(null),
      completionReadback: vi.fn().mockResolvedValue(null),
      status: vi.fn().mockResolvedValue(null),
    };
    const app = Fastify();
    await registerSdkGrowthAuthorityRoutes(app, {
      authentication: { authenticate: vi.fn().mockResolvedValue(execution) },
      service: service as unknown as EfAuthorityService,
    });
    const requestDigest = "sha256:" + "a".repeat(64);
    const completionDigest = "sha256:" + "b".repeat(64);
    const base = "/sdk-growth/v1/repositories/repo/pulls/99";
    const responses = await Promise.all([
      app.inject({
        method: "GET",
        url: base + "/requests/" + requestDigest,
      }),
      app.inject({
        method: "GET",
        url:
          base +
          "/receipts?requestDigest=" +
          requestDigest +
          "&completionDigest=" +
          completionDigest,
      }),
      app.inject({
        method: "GET",
        url: base + "/status?requestDigest=" + requestDigest,
      }),
    ]);
    expect(responses.map((response) => response.statusCode)).toEqual([
      404, 404, 404,
    ]);
    expect(service.admissionReadback).toHaveBeenCalledWith(
      execution,
      "repo",
      99,
      requestDigest,
    );
    expect(service.completionReadback).toHaveBeenCalledWith(
      execution,
      "repo",
      99,
      requestDigest,
      completionDigest,
    );
    expect(service.status).toHaveBeenCalledWith(
      execution,
      "repo",
      99,
      requestDigest,
    );
    await app.close();
  });

  it.each([
    "/sdk-growth/v1/repositories/repo/pulls/0/requests",
    "/sdk-growth/v1/repositories/repo/pulls/1e2/requests",
    "/sdk-growth/v1/repositories/%25repo/pulls/42/requests",
    "/sdk-growth/v1/repositories/repo/pulls/42/requests/not-a-digest",
    "/sdk-growth/v1/repositories/repo/pulls/42/receipts?requestDigest=bad&completionDigest=bad",
    "/sdk-growth/v1/repositories/repo/pulls/42/status",
  ])("returns a client error for malformed route input: %s", async (url) => {
    const authenticate = vi.fn();
    const app = Fastify();
    await registerSdkGrowthAuthorityRoutes(app, {
      authentication: { authenticate },
      service: {} as EfAuthorityService,
    });
    const response = await app.inject({
      method: url.endsWith("/requests") ? "POST" : "GET",
      url,
      ...(url.endsWith("/requests") ? { payload: {} } : {}),
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid-contract" });
    expect(authenticate).not.toHaveBeenCalled();
    await app.close();
  });
});

it.each([
  [
    "auth credential",
    "auth",
    Object.assign(new Error("secret"), { code: "ERR_JWT_EXPIRED" }),
    401,
    false,
    false,
  ],
  [
    "auth infrastructure",
    "auth",
    new Error("secret database"),
    503,
    true,
    false,
  ],
  [
    "admission infrastructure",
    "admit",
    new Error("secret database"),
    503,
    true,
    true,
  ],
  [
    "completion infrastructure",
    "complete",
    new Error("secret transaction"),
    503,
    true,
    true,
  ],
  [
    "post-auth error with credential-like code",
    "complete",
    Object.assign(new Error("secret service"), { code: "ERR_JWT_EXPIRED" }),
    503,
    true,
    true,
  ],
  [
    "completion timeout",
    "complete",
    new AuthorityError("io-timeout"),
    503,
    true,
    true,
  ],
  [
    "readback infrastructure",
    "status",
    new Error("secret database"),
    503,
    true,
    false,
  ],
  [
    "completion conflict",
    "complete",
    new AuthorityError("conflict"),
    409,
    false,
    false,
  ],
] as const)(
  "classifies %s with retry and uncertainty semantics",
  async (_name, stage, error, code, retryable, uncertain) => {
    const app = Fastify();
    const authenticate =
      stage === "auth"
        ? vi.fn().mockRejectedValue(error)
        : vi.fn().mockResolvedValue({
            tenantId: "tenant",
            repositoryId: "repo",
            pullRequest: 42,
          });
    const fail = vi.fn().mockRejectedValue(error);
    await registerSdkGrowthAuthorityRoutes(app, {
      authentication: { authenticate },
      service: {
        admit: fail,
        complete: fail,
        status: fail,
      } as unknown as EfAuthorityService,
    });
    const suffix =
      stage === "complete"
        ? "/completions"
        : stage === "status"
          ? "/status?requestDigest=sha256:" + "a".repeat(64)
          : "/requests";
    const response = await app.inject({
      method: stage === "status" ? "GET" : "POST",
      url: "/sdk-growth/v1/repositories/repo/pulls/42" + suffix,
    });
    expect(response.statusCode).toBe(code);
    expect(response.json()).toEqual({
      error:
        error instanceof AuthorityError
          ? error.code
          : code === 401
            ? "authentication-failed"
            : "service-failed",
      ...(retryable ? { retryable, uncertain } : {}),
    });
    expect(response.body).not.toContain("secret");
    if (stage === "auth") expect(fail).not.toHaveBeenCalled();
    await app.close();
  },
);

it.each([
  ["claims schema", new ZodError([]), 401],
  [
    "JWKS timeout",
    Object.assign(new Error("secret JWKS"), { code: "ERR_JWKS_TIMEOUT" }),
    503,
  ],
  [
    "signature",
    Object.assign(new Error("secret signature"), {
      code: "ERR_JWS_SIGNATURE_VERIFICATION_FAILED",
    }),
    401,
  ],
] as const)(
  "maps verifier %s failures before service invocation",
  async (_name, error, statusCode) => {
    const app = Fastify();
    const lookup = vi.fn();
    const admit = vi.fn();
    const auth = new SdkGrowthOidcAuthentication(
      { verify: vi.fn().mockRejectedValue(error) },
      {
        findSelectedRepositoryByGithubId: lookup,
      } as unknown as ActionControlPlaneRepositoryPort,
      { tryConsumeNonce: vi.fn() },
      { resolve: vi.fn() },
      "sdk-growth",
    );
    await registerSdkGrowthAuthorityRoutes(app, {
      authentication: auth,
      service: { admit } as unknown as EfAuthorityService,
    });
    try {
      const response = await app.inject({
        method: "POST",
        url: "/sdk-growth/v1/repositories/repo/pulls/42/requests",
        headers: { authorization: "Bearer oidc" },
      });
      expect(response.statusCode).toBe(statusCode);
      expect(response.json()).toEqual(
        statusCode === 401
          ? { error: "authentication-failed" }
          : { error: "service-failed", retryable: true, uncertain: false },
      );
      expect(lookup).not.toHaveBeenCalled();
      expect(admit).not.toHaveBeenCalled();
      expect(response.body).not.toContain("secret");
    } finally {
      await app.close();
    }
  },
);
