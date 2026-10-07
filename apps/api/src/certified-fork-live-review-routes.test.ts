import { describe, expect, it, vi } from "vitest";
import {
  defaultActionOidcAudience,
  prepareCertifiedForkReview,
  type ActionRepositoryContext,
  type CertifiedForkReviewGatewayPort,
} from "@reviewrouter/features-action-control-plane";
import { InMemoryLock } from "@reviewrouter/platform-locks";
import {
  certifiedForkCommentBody,
  certifiedForkCommentMarker,
  executeCertifiedForkLiveReview,
  type CertifiedForkLiveReviewDependencies,
} from "./certified-fork-live-review-routes.js";

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

function fixture() {
  const trace: string[] = [];
  const now = new Date("2026-09-17T08:00:00.000Z");
  const seconds = now.getTime() / 1000;
  const packet = prepareCertifiedForkReview({
    binding: binding(),
    files: [
      {
        path: "src/a.ts",
        status: "modified",
        additions: 1,
        deletions: 1,
        patch: "@@ -1 +1 @@\n-old\n+new",
      },
    ],
  });
  const repository: ActionRepositoryContext = {
    workspaceId: "workspace",
    repositoryId: "repository",
    githubRepositoryId: "99",
    githubInstallationId: "7",
    fullName: "owner/example",
    owner: "owner",
    selected: true,
    installationStatus: "active",
  };
  const claims = {
    iss: "https://token.actions.githubusercontent.com" as const,
    aud: defaultActionOidcAudience,
    sub: "repo:owner/example:pull_request",
    repository: "owner/example",
    repository_id: "99",
    repository_owner: "owner",
    repository_visibility: "public" as const,
    event_name: "pull_request_target" as const,
    ref: "refs/heads/main",
    run_id: "700",
    run_attempt: "2",
    workflow_ref:
      "owner/example/.github/workflows/reviewrouter-fork.yml@refs/heads/main",
    workflow_sha: "c".repeat(40),
    actor: "contributor",
    runner_environment: "github-hosted" as const,
    iat: seconds - 5,
    nbf: seconds - 5,
    exp: seconds + 295,
    jti: "nonce-unique-123",
  };
  const consumed = new Set<string>();
  const gateway: CertifiedForkReviewGatewayPort = {
    assertBindingCurrent: vi.fn(async () => {
      trace.push("binding");
    }),
    prepareContext: vi.fn(async () => {
      trace.push("prepare");
      return { contextHash: packet.contextHash, promptPacket: packet };
    }),
    assertContextCurrent: vi.fn(async () => {
      trace.push("current");
      return { promptPacket: packet };
    }),
  };
  const model = {
    request: vi.fn(
      async (input: { accessToken: string; timeoutMs: number }) => {
        trace.push("model");
        expect(input.accessToken).toBe("top-secret-access-token");
        expect(input.timeoutMs).toBe(9 * 60_000);
        return {
          protocolVersion: 1 as const,
          summaryMarkdown: "Found one concrete issue.",
          findings: [
            {
              severity: "major" as const,
              title: "Broken branch",
              body: "The new branch cannot execute.",
              path: "src/a.ts",
              startLine: 1,
            },
          ],
        };
      },
    ),
  };
  const publisher = {
    upsert: vi.fn(async () => {
      trace.push("publish");
      return { commentId: "1234", url: "https://github.test/comment/1234" };
    }),
  };
  const dependencies: CertifiedForkLiveReviewDependencies = {
    enabled: true,
    oidcVerifier: {
      verify: vi.fn(async () => {
        trace.push("verify");
        return claims;
      }),
    },
    replayNonces: {
      tryConsumeNonce: vi.fn(async ({ key }) => {
        trace.push("nonce");
        if (consumed.has(key)) return false;
        consumed.add(key);
        return true;
      }),
    },
    repositories: {
      findSelectedRepositoryByGithubId: vi.fn(async () => {
        trace.push("repository");
        return repository;
      }),
    },
    admission: {
      assertAdmitted: vi.fn(() => {
        trace.push("admission");
      }),
    },
    workflowRuns: {
      resolveWorkflowRunPullRequest: vi.fn(async () => {
        trace.push("run");
        return 42;
      }),
    },
    gateway,
    reviewLock: new InMemoryLock(),
    hostedAccounts: {
      resolve: vi.fn(async () => {
        trace.push("account");
        return "account-1";
      }),
    },
    sessions: {
      ensureFreshSession: vi.fn(async () => {
        trace.push("session");
        return {
          accessToken: "top-secret-access-token",
          chatgptAccountId: "chatgpt-account",
          credentialGeneration: 3,
        };
      }),
    },
    model,
    publisher,
    clock: { now: () => now },
  };
  return { claims, dependencies, gateway, model, packet, publisher, trace };
}

describe("certified fork live review executor", () => {
  it("runs current-context review and publishes without returning credentials", async () => {
    const f = fixture();
    const result = await executeCertifiedForkLiveReview(
      { oidcToken: "signed-token", binding: binding() },
      f.dependencies,
      new AbortController().signal,
    );
    expect(result).toEqual({
      status: "published",
      commentId: "1234",
      contextHash: f.packet.contextHash,
      binding: binding(),
    });
    expect(JSON.stringify(result)).not.toContain("top-secret");
    expect(f.trace).toEqual([
      "verify",
      "repository",
      "admission",
      "run",
      "binding",
      "prepare",
      "current",
      "account",
      "nonce",
      "session",
      "model",
      "current",
      "publish",
    ]);
    expect(f.publisher.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        githubInstallationId: "7",
        pullRequestNumber: 42,
        marker: certifiedForkCommentMarker(binding()),
      }),
    );
  });

  it("consumes each OIDC jti once after context and account acceptance", async () => {
    const f = fixture();
    const request = { oidcToken: "signed-token", binding: binding() };
    await executeCertifiedForkLiveReview(
      request,
      f.dependencies,
      new AbortController().signal,
    );
    f.trace.length = 0;
    await expect(
      executeCertifiedForkLiveReview(
        request,
        f.dependencies,
        new AbortController().signal,
      ),
    ).rejects.toThrow("oidc_replay_detected");
    expect(f.trace.slice(-2)).toEqual(["account", "nonce"]);
    expect(f.model.request).toHaveBeenCalledTimes(1);
    expect(f.publisher.upsert).toHaveBeenCalledTimes(1);
  });

  it("admits only one in-flight model review per repository PR", async () => {
    const f = fixture();
    const original = f.model.request.getMockImplementation()!;
    let release!: () => void;
    let started!: () => void;
    const modelStarted = new Promise<void>((resolve) => (started = resolve));
    const modelRelease = new Promise<void>((resolve) => (release = resolve));
    f.model.request.mockImplementationOnce(async (input) => {
      started();
      await modelRelease;
      return original(input);
    });
    const request = { oidcToken: "signed-token", binding: binding() };
    const first = executeCertifiedForkLiveReview(
      request,
      f.dependencies,
      new AbortController().signal,
    );
    await modelStarted;

    await expect(
      executeCertifiedForkLiveReview(
        request,
        f.dependencies,
        new AbortController().signal,
      ),
    ).rejects.toThrow("Lock already held: certified-fork-review:99:42");
    release();
    await expect(first).resolves.toMatchObject({ status: "published" });
    expect(f.model.request).toHaveBeenCalledTimes(1);
  });

  it("rejects exact-input, event and repository mismatches before custody", async () => {
    for (const mutate of [
      (f: ReturnType<typeof fixture>) => {
        Object.assign(f.claims, { event_name: "pull_request" });
      },
      (f: ReturnType<typeof fixture>) => {
        Object.assign(f.claims, { repository_id: "100" });
      },
    ]) {
      const f = fixture();
      mutate(f);
      await expect(
        executeCertifiedForkLiveReview(
          { oidcToken: "signed-token", binding: binding() },
          f.dependencies,
          new AbortController().signal,
        ),
      ).rejects.toThrow();
      expect(f.dependencies.sessions.ensureFreshSession).not.toHaveBeenCalled();
    }
    const f = fixture();
    await expect(
      executeCertifiedForkLiveReview(
        {
          oidcToken: "signed-token",
          binding: binding(),
          accessToken: "attacker",
        },
        f.dependencies,
        new AbortController().signal,
      ),
    ).rejects.toThrow("certified_fork_live_review_input_invalid");
  });

  it("does not publish after model or stale-context failure", async () => {
    const modelFailure = fixture();
    modelFailure.model.request.mockRejectedValueOnce(
      new Error("provider_down"),
    );
    await expect(
      executeCertifiedForkLiveReview(
        { oidcToken: "signed-token", binding: binding() },
        modelFailure.dependencies,
        new AbortController().signal,
      ),
    ).rejects.toThrow("provider_down");
    expect(modelFailure.publisher.upsert).not.toHaveBeenCalled();

    const stale = fixture();
    vi.mocked(stale.gateway.assertContextCurrent)
      .mockResolvedValueOnce({ promptPacket: stale.packet })
      .mockRejectedValueOnce(new Error("certified_fork_tuple_mismatch"));
    await expect(
      executeCertifiedForkLiveReview(
        { oidcToken: "signed-token", binding: binding() },
        stale.dependencies,
        new AbortController().signal,
      ),
    ).rejects.toThrow("certified_fork_tuple_mismatch");
    expect(stale.publisher.upsert).not.toHaveBeenCalled();
  });

  it("does not consume the nonce when current-context admission fails", async () => {
    const f = fixture();
    vi.mocked(f.gateway.assertBindingCurrent).mockRejectedValueOnce(
      new Error("certified_fork_tuple_mismatch"),
    );
    await expect(
      executeCertifiedForkLiveReview(
        { oidcToken: "signed-token", binding: binding() },
        f.dependencies,
        new AbortController().signal,
      ),
    ).rejects.toThrow("certified_fork_tuple_mismatch");
    expect(f.dependencies.replayNonces.tryConsumeNonce).not.toHaveBeenCalled();
    expect(f.dependencies.sessions.ensureFreshSession).not.toHaveBeenCalled();
  });
});

describe("certified fork live comment formatting", () => {
  it("keeps the ownership marker first and stays inside GitHub limits", () => {
    const marker = certifiedForkCommentMarker(binding());
    const body = certifiedForkCommentBody(
      marker,
      {
        protocolVersion: 1,
        summaryMarkdown: "x".repeat(70_000),
        findings: [],
      },
      {
        reviewHeadSha: binding().reviewHeadSha,
        contextHash: "d".repeat(64),
      },
    );
    expect(body.startsWith(`${marker}\n`)).toBe(true);
    expect(Buffer.byteLength(body, "utf8")).toBeLessThanOrEqual(60_000);
    expect(body).toContain("Review truncated");
  });

  it("neutralizes model-authored mentions and HTML comments", () => {
    const marker = certifiedForkCommentMarker(binding());
    const body = certifiedForkCommentBody(
      marker,
      {
        protocolVersion: 1,
        summaryMarkdown: "Notify @reviewers <!-- hidden",
        findings: [
          {
            severity: "major",
            title: "@team finding",
            body: "Ask @owner",
          },
        ],
      },
      {
        reviewHeadSha: binding().reviewHeadSha,
        contextHash: "d".repeat(64),
      },
    );

    expect(body).not.toContain("@reviewers");
    expect(body).not.toContain("<!-- hidden");
    expect(body).toContain("@\u200breviewers");
    expect(body.startsWith(`${marker}\n`)).toBe(true);
  });
});
