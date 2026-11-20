import { generateKeyPairSync } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { CanonicalReviewRevisionResolutionStatus } from "../../application/ports/review-scm-revision-ports";
import { CanonicalGitHubReviewRevisionResolver } from "./canonical-github-review-revision-resolver";
import { OctokitGitHubReviewRevisionSource } from "./octokit-github-review-revision-source";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const input = {
  githubInstallationId: "789",
  owner: "test",
  repo: "repository",
  pullRequestNumber: 12,
};
const fixturePrivateKey = generateKeyPairSync("rsa", { modulusLength: 2048 })
  .privateKey.export({ type: "pkcs8", format: "pem" })
  .toString();
function source(retryDelaysMs?: readonly number[]) {
  return new OctokitGitHubReviewRevisionSource({
    appId: "1",
    privateKey: fixturePrivateKey,
    ...(retryDelaysMs ? { retryDelaysMs } : {}),
  });
}

it.each(["installation-token", "pull-request"] as const)(
  "bounds the real cold %s read with the same per-read deadline",
  async (phase) => {
    const controller = new AbortController();
    const timeout = vi
      .spyOn(AbortSignal, "timeout")
      .mockReturnValue(controller.signal);
    const requests: string[] = [];
    let started!: () => void;
    const pending = new Promise<void>((resolve) => {
      started = resolve;
    });
    let fetchSignal: AbortSignal | null | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, options: RequestInit) => {
        requests.push(String(url));
        if (String(url).endsWith("/access_tokens") && phase === "pull-request")
          return new Response(
            JSON.stringify({
              token: "fixture-installation-token",
              expires_at: new Date(Date.now() + 3600000).toISOString(),
              permissions: { contents: "read" },
              repository_selection: "selected",
            }),
            { status: 201, headers: { "content-type": "application/json" } },
          );
        fetchSignal = options.signal;
        started();
        return await new Promise<Response>((_resolve, reject) => {
          const aborted = () =>
            reject(new DOMException("fixture abort", "AbortError"));
          if (options.signal?.aborted) aborted();
          else
            options.signal?.addEventListener("abort", aborted, { once: true });
        });
      }),
    );
    const result = source().loadPullRequestPointer(input);
    await pending;
    expect(timeout).toHaveBeenCalledWith(15_000);
    controller.abort();
    await expect(result).rejects.toThrow("github_review_revision_read_timeout");
    expect(fetchSignal?.aborted).toBe(true);
    expect(requests).toEqual(
      phase === "installation-token"
        ? ["https://api.github.com/app/installations/789/access_tokens"]
        : [
            "https://api.github.com/app/installations/789/access_tokens",
            "https://api.github.com/repos/test/repository/pulls/12",
          ],
    );
  },
);

it("does not keep the authority read awaiting an auth transport that ignores cancellation", async () => {
  const controller = new AbortController();
  vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
  let started!: () => void;
  const pending = new Promise<void>((resolve) => {
    started = resolve;
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      started();
      return await new Promise<Response>(() => {});
    }),
  );
  const result = source().loadPullRequestPointer(input);
  await pending;
  controller.abort();
  await expect(result).rejects.toThrow("github_review_revision_read_timeout");
});

const headSha = "a".repeat(40);
// A fresh installation per test: the earlier never-answering token fixture
// would otherwise hold a shared in-flight token request for installation 789.
let installation = 900;
function retryInput() {
  installation += 1;
  return { ...input, githubInstallationId: String(installation) };
}
const baseSha = "b".repeat(40);
function json(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}
const pullRequest = {
  number: 12,
  base: { sha: baseSha },
  head: { sha: headSha },
};
// The pull request read answers from `answers` in order; the installation
// token is always issued. Returns the number of pull request reads.
function stubGitHub(answers: (() => Response)[]) {
  const reads = { count: 0 };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (String(url).endsWith("/access_tokens"))
        return json(201, {
          token: "fixture-installation-token",
          expires_at: new Date(Date.now() + 3600000).toISOString(),
          permissions: { pull_requests: "read" },
          repository_selection: "selected",
        });
      const answer = answers[Math.min(reads.count, answers.length - 1)]!;
      reads.count += 1;
      return answer();
    }),
  );
  return reads;
}
const noWait = [0, 0, 0];

it("reads again after a transient GitHub failure and returns the same current head", async () => {
  const log = vi.spyOn(console, "warn").mockImplementation(() => {});
  const reads = stubGitHub([
    () => json(502, { message: "Bad Gateway" }),
    () => json(429, { message: "slow down" }, { "retry-after": "0" }),
    () => json(200, pullRequest),
  ]);
  await expect(
    source(noWait).loadPullRequestPointer(retryInput()),
  ).resolves.toEqual({
    pullRequestNumber: 12,
    baseSha,
    headSha,
  });
  expect(reads.count).toBe(3);
  const lines = log.mock.calls.map(([line]) => JSON.parse(String(line)));
  expect(lines).toEqual([
    {
      event: "github_review_revision_read_retry",
      attempt: 1,
      failureClass: "server_error",
      status: 502,
      waitMs: 0,
    },
    {
      event: "github_review_revision_read_retry",
      attempt: 2,
      failureClass: "rate_limited",
      status: 429,
      waitMs: 0,
    },
  ]);
  expect(JSON.stringify(log.mock.calls)).not.toContain(
    "fixture-installation-token",
  );
});

it("refuses as before once three retries are spent", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const reads = stubGitHub([() => json(503, { message: "unavailable" })]);
  await expect(
    source(noWait).loadPullRequestPointer(retryInput()),
  ).rejects.toMatchObject({ status: 503 });
  expect(reads.count).toBe(4);
});

it.each([
  [403, {}],
  [422, {}],
])("never reads again after a non-transient %s", async (status, headers) => {
  const log = vi.spyOn(console, "warn").mockImplementation(() => {});
  const reads = stubGitHub([() => json(status, { message: "no" }, headers)]);
  await expect(
    source(noWait).loadPullRequestPointer(retryInput()),
  ).rejects.toMatchObject({ status });
  expect(reads.count).toBe(1);
  expect(log).not.toHaveBeenCalled();
});

it("adds no retry of its own to an authentication failure", async () => {
  // auth-app already re-reads a 401 for token replication lag; this layer
  // must not multiply that.
  const log = vi.spyOn(console, "warn").mockImplementation(() => {});
  stubGitHub([() => json(401, { message: "Bad credentials" })]);
  await expect(
    source(noWait).loadPullRequestPointer(retryInput()),
  ).rejects.toMatchObject({ status: 401 });
  expect(log).not.toHaveBeenCalled();
});

it("keeps a missing or closed-off pull request a single read that returns null", async () => {
  const reads = stubGitHub([() => json(404, { message: "Not Found" })]);
  await expect(
    source(noWait).loadPullRequestPointer(retryInput()),
  ).resolves.toBeNull();
  expect(reads.count).toBe(1);
});

it("retries a secondary rate limit 403 that carries its retry headers", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const reads = stubGitHub([
    () =>
      json(403, { message: "secondary rate limit" }, { "retry-after": "0" }),
    () => json(200, pullRequest),
  ]);
  await expect(
    source(noWait).loadPullRequestPointer(retryInput()),
  ).resolves.toMatchObject({ headSha });
  expect(reads.count).toBe(2);
});

it("does not wait past the read deadline when GitHub asks for a longer pause", async () => {
  const log = vi.spyOn(console, "warn").mockImplementation(() => {});
  const reads = stubGitHub([
    () => json(429, { message: "slow down" }, { "retry-after": "60" }),
    () => json(200, pullRequest),
  ]);
  const started = Date.now();
  await expect(
    source(noWait).loadPullRequestPointer(retryInput()),
  ).rejects.toMatchObject({ status: 429 });
  expect(reads.count).toBe(1);
  expect(log).not.toHaveBeenCalled();
  expect(Date.now() - started).toBeLessThan(5_000);
});

it("uses the 1, 2 and 4 second waits by default", async () => {
  const { GITHUB_REVISION_READ_RETRY_DELAYS_MS } =
    await import("./octokit-github-review-revision-source");
  expect(GITHUB_REVISION_READ_RETRY_DELAYS_MS).toEqual([1_000, 2_000, 4_000]);
});

it("refuses at once on a rate limit that names no wait", async () => {
  // GitHub asks for at least a minute then, which never fits the deadline.
  const log = vi.spyOn(console, "warn").mockImplementation(() => {});
  const reads = stubGitHub([() => json(429, { message: "slow down" })]);
  await expect(
    source(noWait).loadPullRequestPointer(retryInput()),
  ).rejects.toMatchObject({ status: 429 });
  expect(reads.count).toBe(1);
  expect(log).not.toHaveBeenCalled();
});

it("retries an exhausted primary limit whose reset has already passed", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const reads = stubGitHub([
    () =>
      json(
        403,
        { message: "API rate limit exceeded" },
        {
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) - 1),
        },
      ),
    () => json(200, pullRequest),
  ]);
  await expect(
    source(noWait).loadPullRequestPointer(retryInput()),
  ).resolves.toMatchObject({ headSha });
  expect(reads.count).toBe(2);
});

it("still refuses a revision that moved while a read was retried", async () => {
  // The retry only reads again: a head that changed between the two pointer
  // reads stays revision_moved and never authorizes.
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const movedHead = "c".repeat(40);
  const pointers = [
    () => json(200, pullRequest),
    () => json(502, { message: "Bad Gateway" }),
    () => json(200, { ...pullRequest, head: { sha: movedHead } }),
  ];
  let pointerReads = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (String(url).endsWith("/access_tokens"))
        return json(201, {
          token: "fixture-installation-token",
          expires_at: new Date(Date.now() + 3600000).toISOString(),
          permissions: { pull_requests: "read" },
          repository_selection: "selected",
        });
      if (String(url).includes("/compare/"))
        return json(200, { merge_base_commit: { sha: baseSha } });
      const answer = pointers[Math.min(pointerReads, pointers.length - 1)]!;
      pointerReads += 1;
      return answer();
    }),
  );
  const resolver = new CanonicalGitHubReviewRevisionResolver(source(noWait), {
    digestUtf8: async () => "d".repeat(64),
  } as unknown as ConstructorParameters<
    typeof CanonicalGitHubReviewRevisionResolver
  >[1]);
  const scope = retryInput();
  await expect(
    resolver.resolve({
      workspaceId: "workspace-1",
      repositoryConnectionId: "connection-1",
      scmRepositoryIdentityId: "identity-1",
      githubInstallationId: scope.githubInstallationId,
      owner: scope.owner,
      repo: scope.repo,
      sourceRunId: null,
      pullRequestNumberHint: 12,
    }),
  ).resolves.toEqual({
    status: CanonicalReviewRevisionResolutionStatus.RevisionMoved,
  });
  expect(pointerReads).toBe(3);
});

it("reads again after a dropped connection and logs it as network", async () => {
  const log = vi.spyOn(console, "warn").mockImplementation(() => {});
  const reads = stubGitHub([
    () => {
      throw Object.assign(new TypeError("fetch failed"), {
        cause: Object.assign(new Error("socket hang up"), {
          code: "ECONNRESET",
        }),
      });
    },
    () => json(200, pullRequest),
  ]);
  await expect(
    source(noWait).loadPullRequestPointer(retryInput()),
  ).resolves.toMatchObject({ headSha });
  expect(reads.count).toBe(2);
  expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({
    event: "github_review_revision_read_retry",
    failureClass: "network",
  });
});
