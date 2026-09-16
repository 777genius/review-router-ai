import { describe, expect, it, vi } from "vitest";
import { generateKeyPair, SignJWT } from "jose";
import {
  defaultActionOidcAudience,
  JoseGitHubActionsOidcTokenVerifier,
  prepareCertifiedForkReview,
  type ActionRepositoryContext,
  type CertifiedForkReviewGatewayPort,
  type GitHubActionsOidcClaims,
} from "@reviewrouter/features-action-control-plane";
import type {
  CodexRotatingProviderBinding,
  CodexRotatingOidcClaims,
} from "@reviewrouter/features-codex-oauth-rotating";
import {
  composeCertifiedForkReview,
  type CertifiedForkReviewCompositionDependencies,
} from "./certified-fork-review-composition.js";
import { OctokitCertifiedForkReviewGateway } from "./github/octokit-certified-fork-review-gateway.js";

const workflowSha = "c".repeat(40);
const workflowPath = ".github/workflows/reviewrouter-codex.yml";
const binding = () => ({
  sourceRepository: "contributor/example",
  sourceRepositoryId: "101",
  baseRepository: "owner/example",
  baseRepositoryId: "99",
  pullRequestNumber: 42,
  baseSha: "a".repeat(40),
  reviewHeadSha: "b".repeat(40),
  trustDomain: "fork" as const,
});
const request = () => ({
  oidcToken: "opaque-signed-token",
  binding: binding(),
});
const unavailable = {
  status: "unavailable",
  code: "certified_fork_prepare_prelease_bridge_unavailable",
};
const packet = (patch = "@@ -1 +1 @@\n-old\n+new") =>
  prepareCertifiedForkReview({
    binding: binding(),
    files: [
      {
        path: "src/a.ts",
        status: "modified",
        additions: 1,
        deletions: 1,
        patch,
      },
    ],
  });

function fixture() {
  const trace: string[] = [];
  const at = new Date(Math.floor(Date.now() / 1000) * 1000);
  const seconds = at.getTime() / 1000;
  const claims: GitHubActionsOidcClaims & CodexRotatingOidcClaims = {
    iss: "https://token.actions.githubusercontent.com",
    aud: defaultActionOidcAudience,
    sub: "repo:owner/example:pull_request",
    repository: "owner/example",
    repository_id: "99",
    repository_owner: "owner",
    repository_visibility: "public",
    event_name: "pull_request_target",
    ref: "refs/heads/main",
    run_id: "700",
    run_attempt: "2",
    workflow_ref: `owner/example/${workflowPath}@refs/heads/main`,
    workflow_sha: workflowSha,
    actor: "contributor",
    runner_environment: "github-hosted",
    iat: seconds - 5,
    nbf: seconds - 5,
    exp: seconds + 295,
    jti: "nonce-unique-123",
  };
  const repository: ActionRepositoryContext = {
    workspaceId: "workspace",
    repositoryId: "internal-repo",
    githubRepositoryId: "99",
    githubInstallationId: "7",
    fullName: "owner/example",
    owner: "owner",
    selected: true,
    installationStatus: "active",
  };
  const provider: CodexRotatingProviderBinding = {
    providerInstanceId: "codex-rotating:99",
    repositoryFullName: "owner/example",
    githubRepositoryId: "99",
    actionRef: `777genius/review-router@${"d".repeat(40)}`,
    workflowPath,
    workflowSchemaVersion: 6,
    activeWorkflowSource: {
      repositoryId: "99",
      workflowPath,
      workflowSourceCommitSha: workflowSha,
      workflowSourceBlobSha: "e".repeat(40),
      workflowSourceSha256: "f".repeat(64),
      workflowSemanticSha256: "a".repeat(64),
      sourceTrust: "trusted_default_branch_revision",
    },
  };
  // Fake durable nonce storage exists only in the test adapter. The composition
  // must consult it for each token; it has no process-local authority cache.
  const consumed = new Set<string>();
  const oidcVerifier = {
    verify: vi.fn(async () => {
      trace.push("verify");
      return claims;
    }),
  };
  const replayNonces = {
    tryConsumeNonce: vi.fn(async ({ key }: { key: string }) => {
      trace.push("nonce");
      if (consumed.has(key)) return false;
      consumed.add(key);
      return true;
    }),
  };
  const repositories = {
    findSelectedRepositoryByGithubId: vi.fn(async () => {
      trace.push("repository");
      return repository;
    }),
  };
  const oauth = {
    findProviderBinding: vi.fn(async () => {
      trace.push("provider");
      return provider;
    }),
    acquirePrelease: vi.fn(() => {
      throw new Error("forbidden lease effect");
    }),
    ensureVerifiedProviderBinding: vi.fn(() => {
      throw new Error("forbidden provider mutation");
    }),
  };
  const admission = {
    assertAdmitted: vi.fn(() => {
      trace.push("admission");
    }),
  };
  const workflowRuns = {
    resolveWorkflowRunPullRequest: vi.fn(async () => {
      trace.push("run");
      return 42;
    }),
  };
  const githubMutations: Record<string, unknown> = {};
  let compares = 0;
  const github = new OctokitCertifiedForkReviewGateway({
    app: {
      getInstallationOctokit: async (installationId) => {
        expect(installationId).toBe(7);
        return {
          request: async (route, parameters) => {
            // This real gateway sees only realistic read responses, no network.
            expect(route.startsWith("GET ")).toBe(true);
            if (route === "GET /repos/{owner}/{repo}") {
              const source = parameters?.owner === "contributor";
              return {
                data: {
                  id: source ? 101 : 99,
                  full_name: source ? "contributor/example" : "owner/example",
                  private: source ? (githubMutations.private ?? false) : false,
                  visibility: "public",
                  fork: source ? (githubMutations.fork ?? true) : false,
                  ...(source
                    ? {
                        parent: { id: githubMutations.parentId ?? 99 },
                        source: { id: githubMutations.parentId ?? 99 },
                      }
                    : {}),
                },
              };
            }
            if (route.endsWith("/pulls/{pull_number}"))
              return {
                data: {
                  number: 42,
                  state: "open",
                  draft: false,
                  merged: false,
                  user: { type: "User" },
                  changed_files: 1,
                  base: {
                    sha: githubMutations.baseSha ?? binding().baseSha,
                    repo: { id: 99, full_name: "owner/example" },
                  },
                  head: {
                    sha: githubMutations.headSha ?? binding().reviewHeadSha,
                    repo: { id: 101, full_name: "contributor/example" },
                  },
                },
              };
            if (route.endsWith("/compare/{basehead}")) {
              compares++;
              return {
                data: {
                  base_commit: { sha: binding().baseSha },
                  files: [
                    {
                      filename: "src/a.ts",
                      status: "modified",
                      additions: 1,
                      deletions: 1,
                      patch:
                        compares > 1 && githubMutations.contextChanged
                          ? "@@ -1 +1 @@\n-old\n+other"
                          : "@@ -1 +1 @@\n-old\n+new",
                    },
                  ],
                },
              };
            }
            throw new Error(`unexpected GitHub route ${route}`);
          },
        };
      },
    },
  });
  const gateway = {
    assertBindingCurrent: vi.fn<
      CertifiedForkReviewGatewayPort["assertBindingCurrent"]
    >(async (input) => {
      trace.push("tuple");
      await github.assertBindingCurrent(input);
    }),
    prepareContext: vi.fn<CertifiedForkReviewGatewayPort["prepareContext"]>(
      async (input) => {
        trace.push("prepare");
        return github.prepareContext(input);
      },
    ),
    assertContextCurrent: vi.fn<
      CertifiedForkReviewGatewayPort["assertContextCurrent"]
    >(async (input) => {
      trace.push("current");
      return github.assertContextCurrent(input);
    }),
  };
  const dependencies = {
    oidcVerifier,
    replayNonces,
    repositories,
    oauth,
    admission,
    workflowRuns,
    gateway,
    clock: { now: () => at },
  };
  const composition = composeCertifiedForkReview(dependencies);
  const noEffects = () => {
    expect(oauth.acquirePrelease).not.toHaveBeenCalled();
    expect(oauth.ensureVerifiedProviderBinding).not.toHaveBeenCalled();
  };
  return {
    dependencies,
    composition,
    trace,
    claims,
    repository,
    provider,
    githubMutations,
    noEffects,
  };
}

describe("disabled certified fork prepare/prelease composition", () => {
  it("completes read-only preflight in deterministic order but never returns a capability", async () => {
    const f = fixture();
    expect(f.trace).toEqual([]);
    const result = await f.composition.preparePrelease(request());
    expect(result).toEqual(unavailable);
    expect(Object.isFrozen(result)).toBe(true);
    expect(f.trace).toEqual([
      "verify",
      "repository",
      "admission",
      "provider",
      "nonce",
      "run",
      "tuple",
      "prepare",
      "current",
    ]);
    expect(f.dependencies.oidcVerifier.verify).toHaveBeenCalledWith({
      token: "opaque-signed-token",
      audience: defaultActionOidcAudience,
    });
    expect(f.dependencies.oauth.findProviderBinding).toHaveBeenCalledWith({
      repository: f.repository,
      providerInstanceId: "codex-rotating:99",
      workflowSha,
      workflowSchemaVersion: 6,
    });
    expect(
      f.dependencies.workflowRuns.resolveWorkflowRunPullRequest,
    ).toHaveBeenCalledWith({
      repository: f.repository,
      githubRunId: "700",
      githubRunAttempt: "2",
      eventName: "pull_request_target",
    });
    expect(f.dependencies.gateway.assertContextCurrent).toHaveBeenCalledWith({
      githubInstallationId: "7",
      binding: binding(),
      expectedContextHash: packet().contextHash,
    });
    f.noEffects();
  });

  it("consumes the existing replay nonce once, including across reconstructed compositions", async () => {
    const f = fixture();
    await f.composition.preparePrelease(request());
    f.trace.length = 0;
    await expect(
      composeCertifiedForkReview(f.dependencies).preparePrelease(request()),
    ).rejects.toThrow("oidc_replay_detected");
    expect(f.trace).toEqual([
      "verify",
      "repository",
      "admission",
      "provider",
      "nonce",
    ]);
    f.noEffects();
  });

  it.each([
    "audience",
    "providerInstanceId",
    "principal",
    "claims",
    "workflowSchemaVersion",
    "promptPacket",
    "proof",
    "leaseId",
    "contextHash",
  ])("rejects caller authority field %s before any I/O", async (field) => {
    const f = fixture();
    await expect(
      f.composition.preparePrelease({ ...request(), [field]: "untrusted" }),
    ).rejects.toThrow("certified_fork_composition_input_invalid");
    expect(f.trace).toEqual([]);
    f.noEffects();
  });

  it.each([
    ["aud", "wrong-audience"],
    ["aud", ["other"]],
    ["iss", "https://issuer.invalid"],
    ["event_name", "pull_request"],
    ["event_name", "workflow_dispatch"],
    ["repository", "other/repo"],
    ["repository_id", "100"],
    ["run_id", "zero"],
    ["run_attempt", "0"],
    ["runner_environment", "self-hosted"],
    ["jti", undefined],
  ])(
    "rejects invalid verified %s = %j before repository lookup",
    async (key, value) => {
      const f = fixture();
      Object.assign(f.claims, { [key as string]: value });
      await expect(f.composition.preparePrelease(request())).rejects.toThrow();
      expect(f.trace).toEqual(["verify"]);
      f.noEffects();
    },
  );

  it.each([
    ["exp", -1],
    ["iat", -1000],
    ["iat", 10],
    ["nbf", 10],
  ])(
    "rejects non-fresh %s offset %s without consuming or preparing",
    async (key, offset) => {
      const f = fixture();
      Object.assign(f.claims, {
        [key]: f.dependencies.clock.now().getTime() / 1000 + Number(offset),
      });
      await expect(f.composition.preparePrelease(request())).rejects.toThrow();
      expect(
        f.dependencies.replayNonces.tryConsumeNonce,
      ).not.toHaveBeenCalled();
      expect(f.dependencies.gateway.prepareContext).not.toHaveBeenCalled();
      f.noEffects();
    },
  );

  it.each([
    { selected: false },
    { installationStatus: "suspended" },
    { githubRepositoryId: "100" },
    { fullName: "other/repo" },
    { githubInstallationId: "0" },
    { githubInstallationId: "9007199254740992" },
  ])("rejects a changed trusted repository %j", async (change) => {
    const f = fixture();
    Object.assign(f.repository, change);
    await expect(f.composition.preparePrelease(request())).rejects.toThrow();
    expect(f.trace).toEqual(["verify", "repository"]);
    f.noEffects();
  });

  it("fails closed on disabled repository admission before provider and context reads", async () => {
    const f = fixture();
    f.dependencies.admission.assertAdmitted.mockImplementation(() => {
      f.trace.push("admission");
      throw new Error("disabled");
    });
    await expect(f.composition.preparePrelease(request())).rejects.toThrow(
      "disabled",
    );
    expect(f.trace).toEqual(["verify", "repository", "admission"]);
    f.noEffects();
  });

  it.each(["resolved", "rejected", "late rejection"])(
    "rejects a %s Promise admission guard without awaiting it or leaking rejection",
    async (scenario) => {
      const f = fixture();
      let rejectAdmission: (reason: Error) => void = () => {};
      f.dependencies.admission.assertAdmitted.mockImplementation(() => {
        f.trace.push("admission");
        if (scenario === "resolved") return Promise.resolve();
        if (scenario === "rejected")
          return Promise.reject(new Error("async_admission_failure"));
        return new Promise<void>((_resolve, reject) => {
          rejectAdmission = reject;
        });
      });
      await expect(f.composition.preparePrelease(request())).rejects.toThrow(
        "certified_fork_admission_guard_invalid",
      );
      // The pending guard must not delay rejection of the operation. Drain a
      // turn after rejecting it so Vitest also detects unhandled rejections.
      rejectAdmission(new Error("late_admission_failure"));
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(f.trace).toEqual(["verify", "repository", "admission"]);
      expect(f.dependencies.oauth.findProviderBinding).not.toHaveBeenCalled();
      expect(
        f.dependencies.replayNonces.tryConsumeNonce,
      ).not.toHaveBeenCalled();
      expect(f.dependencies.gateway.prepareContext).not.toHaveBeenCalled();
      f.noEffects();
    },
  );

  it.each([false, true, null, {}])(
    "rejects a non-void guard result %j",
    async (result) => {
      const f = fixture();
      f.dependencies.admission.assertAdmitted.mockImplementation(() => result);
      await expect(f.composition.preparePrelease(request())).rejects.toThrow(
        "certified_fork_admission_guard_invalid",
      );
      expect(f.dependencies.oauth.findProviderBinding).not.toHaveBeenCalled();
      f.noEffects();
    },
  );

  it.each([
    { providerInstanceId: "codex-rotating:100" },
    { githubRepositoryId: "100" },
    { repositoryFullName: "other/repo" },
    { workflowSchemaVersion: 5 },
    { workflowPath: ".github/workflows/other.yml" },
    { activeWorkflowSource: undefined },
  ])("rejects changed provider/workflow binding %j", async (change) => {
    const f = fixture();
    Object.assign(f.provider, change);
    await expect(f.composition.preparePrelease(request())).rejects.toThrow();
    expect(f.dependencies.replayNonces.tryConsumeNonce).not.toHaveBeenCalled();
    f.noEffects();
  });

  it.each([
    { repositoryId: "100" },
    { workflowSourceCommitSha: "d".repeat(40) },
    { workflowPath: ".github/workflows/other.yml" },
    { sourceTrust: "untrusted" },
  ])("rejects stale workflow source %j", async (change) => {
    const f = fixture();
    Object.assign(f.provider.activeWorkflowSource!, change);
    await expect(f.composition.preparePrelease(request())).rejects.toThrow(
      "certified_fork_workflow_mismatch",
    );
    expect(f.dependencies.replayNonces.tryConsumeNonce).not.toHaveBeenCalled();
    f.noEffects();
  });

  it.each([
    `attacker/repo/${workflowPath}@refs/heads/main`,
    `owner/example/${workflowPath}@refs/tags/v1`,
    "owner/example/.github/workflows/other.yml@refs/heads/main",
  ])("rejects workflow repository/ref mismatch %s", async (workflowRef) => {
    const f = fixture();
    f.claims.workflow_ref = workflowRef;
    await expect(f.composition.preparePrelease(request())).rejects.toThrow();
    expect(f.dependencies.replayNonces.tryConsumeNonce).not.toHaveBeenCalled();
    f.noEffects();
  });

  it("binds PR to trusted run/attempt resolution rather than the request locator", async () => {
    const f = fixture();
    f.dependencies.workflowRuns.resolveWorkflowRunPullRequest.mockResolvedValue(
      43,
    );
    await expect(f.composition.preparePrelease(request())).rejects.toThrow(
      "certified_fork_run_pull_request_mismatch",
    );
    expect(f.dependencies.gateway.assertBindingCurrent).not.toHaveBeenCalled();
    f.noEffects();
  });

  it.each([
    { sourceRepositoryId: "99" },
    { sourceRepository: "owner/example" },
    { trustDomain: "same-repo" },
    { trustDomain: "public" },
  ])(
    "rejects same-repo/domain confusion %j before verifying",
    async (change) => {
      const f = fixture();
      await expect(
        f.composition.preparePrelease({
          ...request(),
          binding: { ...binding(), ...change },
        }),
      ).rejects.toThrow("certified_fork_review_binding_invalid");
      expect(f.trace).toEqual([]);
      f.noEffects();
    },
  );

  it.each([
    { private: true },
    { fork: false },
    { parentId: 200 },
    { headSha: "d".repeat(40) },
    { baseSha: "e".repeat(40) },
  ])(
    "uses the existing GitHub gateway to reject private/non-fork/stale facts %j",
    async (change) => {
      const f = fixture();
      Object.assign(f.githubMutations, change);
      await expect(f.composition.preparePrelease(request())).rejects.toThrow();
      expect(f.dependencies.gateway.prepareContext).not.toHaveBeenCalled();
      expect(
        f.dependencies.gateway.assertContextCurrent,
      ).not.toHaveBeenCalled();
      f.noEffects();
    },
  );

  it("checks the real gateway's prepare/prelease context hash", async () => {
    const f = fixture();
    f.githubMutations.contextChanged = true;
    await expect(f.composition.preparePrelease(request())).rejects.toThrow(
      "certified_fork_context_mismatch",
    );
    f.noEffects();
  });

  it("independently rejects different valid packets from a defective context adapter", async () => {
    const f = fixture();
    f.dependencies.gateway.assertContextCurrent.mockResolvedValue({
      promptPacket: packet("@@ -1 +1 @@\n-old\n+different"),
    });
    await expect(f.composition.preparePrelease(request())).rejects.toThrow(
      "certified_fork_review_context_hash_mismatch",
    );
    f.noEffects();
  });

  it("rejects inconsistent prepare envelope hashes through the existing use case", async () => {
    const f = fixture();
    f.dependencies.gateway.prepareContext.mockResolvedValue({
      promptPacket: packet(),
      contextHash: "f".repeat(64),
    });
    await expect(f.composition.preparePrelease(request())).rejects.toThrow(
      "certified_fork_review_context_hash_mismatch",
    );
    expect(f.dependencies.gateway.assertContextCurrent).not.toHaveBeenCalled();
    f.noEffects();
  });

  it.each([
    ["oidcVerifier", "verify"],
    ["replayNonces", "tryConsumeNonce"],
    ["repositories", "findSelectedRepositoryByGithubId"],
    ["oauth", "findProviderBinding"],
    ["admission", "assertAdmitted"],
    ["workflowRuns", "resolveWorkflowRunPullRequest"],
    ["gateway", "assertBindingCurrent"],
    ["gateway", "prepareContext"],
    ["gateway", "assertContextCurrent"],
    ["clock", "now"],
  ] as const)(
    "requires %s.%s at construction and operation entry",
    async (port, name) => {
      const f = fixture();
      const target = f.dependencies[port] as unknown as Record<string, unknown>;
      delete target[name];
      expect(() => composeCertifiedForkReview(f.dependencies)).toThrow(
        `certified_fork_composition_dependency_missing:${port}.${name}`,
      );
      await expect(f.composition.preparePrelease(request())).rejects.toThrow(
        `certified_fork_composition_dependency_missing:${port}.${name}`,
      );
      expect(f.trace).toEqual([]);
      f.noEffects();
    },
  );

  it.each([
    ["oidcVerifier", "verify", "verify"],
    ["repositories", "findSelectedRepositoryByGithubId", "repository"],
    ["admission", "assertAdmitted", "admission"],
    ["oauth", "findProviderBinding", "provider"],
    ["replayNonces", "tryConsumeNonce", "nonce"],
    ["workflowRuns", "resolveWorkflowRunPullRequest", "run"],
    ["gateway", "assertBindingCurrent", "tuple"],
    ["gateway", "prepareContext", "prepare"],
    ["gateway", "assertContextCurrent", "current"],
  ] as const)(
    "does no subsequent work after %s.%s fails",
    async (port, method, stage) => {
      const f = fixture();
      const order = [
        "verify",
        "repository",
        "admission",
        "provider",
        "nonce",
        "run",
        "tuple",
        "prepare",
        "current",
      ];
      const target = f.dependencies[port] as unknown as Record<string, unknown>;
      target[method] = () => {
        f.trace.push(stage);
        throw new Error("adapter_failure");
      };
      await expect(f.composition.preparePrelease(request())).rejects.toThrow(
        "adapter_failure",
      );
      expect(f.trace).toEqual(order.slice(0, order.indexOf(stage) + 1));
      f.noEffects();
    },
  );

  it.each([
    "sourceRepository",
    "sourceRepositoryId",
    "pullRequestNumber",
    "baseSha",
    "reviewHeadSha",
  ] as const)(
    "treats caller %s as a locator rather than a trusted fact",
    async (field) => {
      const f = fixture();
      const changes = {
        sourceRepository: "contributor/other",
        sourceRepositoryId: "102",
        pullRequestNumber: 43,
        baseSha: "d".repeat(40),
        reviewHeadSha: "e".repeat(40),
      };
      await expect(
        f.composition.preparePrelease({
          ...request(),
          binding: { ...binding(), [field]: changes[field] },
        }),
      ).rejects.toThrow();
      expect(f.dependencies.gateway.prepareContext).not.toHaveBeenCalled();
      f.noEffects();
    },
  );

  it.each([null, undefined, {}])(
    "rejects missing dependency objects %j",
    async (value) => {
      const dependencies =
        value as unknown as CertifiedForkReviewCompositionDependencies;
      expect(() => composeCertifiedForkReview(dependencies)).toThrow(
        "certified_fork_composition_dependency_missing",
      );
    },
  );

  it("does not let a changed dependency dispatch map switch adapters after verify", async () => {
    const f = fixture();
    const replacement = vi.fn(() => {
      throw new Error("replacement must not run");
    });
    const verify = f.dependencies.oidcVerifier.verify.getMockImplementation()!;
    f.dependencies.oidcVerifier.verify.mockImplementation(async () => {
      f.dependencies.gateway.prepareContext = replacement;
      return verify();
    });
    await expect(f.composition.preparePrelease(request())).resolves.toEqual(
      unavailable,
    );
    expect(replacement).not.toHaveBeenCalled();
    f.noEffects();
  });

  it("detaches the caller's binding before awaiting trusted I/O", async () => {
    const f = fixture();
    const input = request();
    const verify = f.dependencies.oidcVerifier.verify.getMockImplementation()!;
    f.dependencies.oidcVerifier.verify.mockImplementation(async () => {
      input.binding.reviewHeadSha = "f".repeat(40);
      return verify();
    });
    await expect(f.composition.preparePrelease(input)).resolves.toEqual(
      unavailable,
    );
    expect(f.dependencies.gateway.assertBindingCurrent).toHaveBeenCalledWith({
      githubInstallationId: "7",
      binding: binding(),
    });
  });

  it("rejects accessors in request data without invoking them", async () => {
    const f = fixture();
    const getter = vi.fn(() => "token");
    const input = Object.defineProperty(request(), "oidcToken", {
      get: getter,
    });
    await expect(f.composition.preparePrelease(input)).rejects.toThrow();
    expect(getter).not.toHaveBeenCalled();
    expect(f.trace).toEqual([]);
  });

  it("cannot turn a caller principal/proof or extra lease method into authority", async () => {
    const f = fixture();
    // Neither actor/sub nor a matching packet hash proves the current durable
    // principal. Missing bridge remains unavailable for every verified actor.
    f.claims.actor = "another-human";
    f.claims.sub = "repo:owner/example:environment:other";
    await expect(f.composition.preparePrelease(request())).resolves.toEqual(
      unavailable,
    );
    f.noEffects();
  });
});

describe("existing OIDC verifier, offline signed tokens", () => {
  it.each([
    "valid",
    "wrong audience",
    "wrong issuer",
    "bad signature",
    "expired",
  ])("handles %s without any remote key lookup", async (scenario) => {
    const f = fixture();
    const keys = await generateKeyPair("ES256");
    const other = await generateKeyPair("ES256");
    const verifier = new JoseGitHubActionsOidcTokenVerifier({
      jwks: async () => keys.publicKey,
      clockToleranceSeconds: 0,
    });
    const payload = { ...f.claims };
    if (scenario === "wrong audience") payload.aud = "attacker-audience";
    if (scenario === "wrong issuer")
      payload.iss = "https://issuer.invalid" as typeof payload.iss;
    if (scenario === "expired") payload.exp = Math.floor(Date.now() / 1000) - 1;
    const token = await new SignJWT(payload)
      .setProtectedHeader({ alg: "ES256" })
      .sign(scenario === "bad signature" ? other.privateKey : keys.privateKey);
    const dependencies: CertifiedForkReviewCompositionDependencies = {
      ...f.dependencies,
      oidcVerifier: verifier,
    };
    const operation = composeCertifiedForkReview(dependencies).preparePrelease({
      ...request(),
      oidcToken: token,
    });
    if (scenario === "valid")
      await expect(operation).resolves.toEqual(unavailable);
    else {
      await expect(operation).rejects.toThrow();
      expect(
        f.dependencies.repositories.findSelectedRepositoryByGithubId,
      ).not.toHaveBeenCalled();
      expect(
        f.dependencies.replayNonces.tryConsumeNonce,
      ).not.toHaveBeenCalled();
    }
    f.noEffects();
  });
});
