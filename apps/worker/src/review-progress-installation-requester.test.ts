import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProgressInstallationRequester } from "./review-progress-installation-requester";

const mocks = vi.hoisted(() => {
  const requestInstallation =
    vi.fn<
      (
        route: string,
        parameters?: Readonly<Record<string, unknown>>,
      ) => Promise<{ data: unknown; headers: Record<string, string> }>
    >();
  return {
    construct: vi.fn<(input: { appId: string; privateKey: string }) => void>(),
    requestApp:
      vi.fn<(route: string) => Promise<{ data: { slug?: string } }>>(),
    getInstallationOctokit:
      vi.fn<(id: number) => Promise<{ request: typeof requestInstallation }>>(),
    requestInstallation,
  };
});

vi.mock("@octokit/app", () => ({
  App: class {
    readonly octokit = { request: mocks.requestApp };
    readonly getInstallationOctokit = mocks.getInstallationOctokit;

    constructor(input: { appId: string; privateKey: string }) {
      mocks.construct(input);
    }
  },
}));

function requester(requestTimeoutMs?: number) {
  return createProgressInstallationRequester({
    githubAppId: "123",
    githubPrivateKey: "fixture",
    ...(requestTimeoutMs === undefined ? {} : { requestTimeoutMs }),
  });
}

describe("createProgressInstallationRequester", () => {
  afterEach(() => vi.useRealTimers());
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.requestApp.mockResolvedValue({ data: { slug: "reviewrouter" } });
    mocks.getInstallationOctokit.mockResolvedValue({
      request: mocks.requestInstallation,
    });
  });

  it("rejects invalid installation IDs before requesting GitHub", async () => {
    const factory = requester();
    for (const id of [0n, -1n, 9007199254740992n]) {
      await expect(factory(id)).rejects.toThrow(
        "review_progress_github_installation_id_invalid",
      );
    }
    expect(mocks.getInstallationOctokit).not.toHaveBeenCalled();
    expect(mocks.requestApp).not.toHaveBeenCalled();
  });

  it("shares one app and bot identity across concurrent installations", async () => {
    const factory = requester();
    const [first, second] = await Promise.all([factory(1n), factory(2n)]);
    expect(mocks.construct).toHaveBeenCalledExactlyOnceWith({
      appId: "123",
      privateKey: "fixture",
      Octokit: expect.any(Function),
    });
    expect(mocks.getInstallationOctokit.mock.calls).toEqual([[1], [2]]);
    expect(mocks.requestApp).toHaveBeenCalledExactlyOnceWith("GET /app");
    expect(first.botLogin).toBe("reviewrouter[bot]");
    expect(second.botLogin).toBe(first.botLogin);
    await factory(3n);
    expect(mocks.requestApp).toHaveBeenCalledTimes(1);
  });

  it("forwards the route, parameters, data and headers", async () => {
    const factory = requester();
    const { request } = await factory(1n);
    const response = { data: { id: 42 }, headers: { "retry-after": "2" } };
    mocks.requestInstallation.mockResolvedValue(response);
    const parameters = { owner: "owner", repo: "repo" };
    const actual = await request("GET /repos/{owner}/{repo}", parameters);
    expect(actual).toEqual(response);
    expect(mocks.requestInstallation).toHaveBeenCalledExactlyOnceWith(
      "GET /repos/{owner}/{repo}",
      { ...parameters, request: { signal: expect.any(AbortSignal) } },
    );
  });

  it("retries a rejected bot identity lookup", async () => {
    mocks.requestApp.mockRejectedValueOnce(new Error("offline"));
    const factory = requester();
    await expect(factory(1n)).rejects.toThrow("offline");
    await expect(factory(1n)).resolves.toMatchObject({
      botLogin: "reviewrouter[bot]",
    });
    expect(mocks.requestApp).toHaveBeenCalledTimes(2);
  });

  it("fails closed on a missing app slug and retries the lookup", async () => {
    mocks.requestApp.mockResolvedValueOnce({ data: {} });
    const factory = requester();
    await expect(factory(1n)).rejects.toThrow(
      "review_progress_github_app_slug_missing",
    );
    await expect(factory(1n)).resolves.toMatchObject({
      botLogin: "reviewrouter[bot]",
    });
    expect(mocks.requestApp).toHaveBeenCalledTimes(2);
  });

  it("keeps one hanging identity lookup and a finite number of real waiters", async () => {
    vi.useFakeTimers();
    let rejectIdentity!: (reason: Error) => void;
    mocks.requestApp.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectIdentity = reject;
        }),
    );
    const factory = requester(30);
    const callers = [1n, 2n, 3n, 4n].map((id) => factory(id));
    const rejected = Promise.all(
      callers.map((call) => expect(call).rejects.toThrow("operation_deadline")),
    );
    await vi.advanceTimersByTimeAsync(30);
    await rejected;
    await expect(factory(5n)).rejects.toThrow("operation_capacity");
    expect(mocks.requestApp).toHaveBeenCalledTimes(1);
    expect(mocks.getInstallationOctokit).toHaveBeenCalledTimes(4);

    rejectIdentity(new Error("late identity failure"));
    await vi.advanceTimersByTimeAsync(0);
    await expect(factory(5n)).resolves.toMatchObject({
      botLogin: "reviewrouter[bot]",
    });
    expect(mocks.requestApp).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not expose a late installation requester after its pass was aborted", async () => {
    let resolveIdentity!: (value: { data: { slug: string } }) => void;
    mocks.requestApp.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveIdentity = resolve;
        }),
    );
    const controller = new AbortController();
    const factory = requester();
    const call = factory(1n, { signal: controller.signal });
    const stopped = expect(call).rejects.toThrow("pass expired");
    await vi.waitFor(() => expect(mocks.requestApp).toHaveBeenCalledTimes(1));
    controller.abort(new Error("pass expired"));
    await stopped;
    resolveIdentity({ data: { slug: "reviewrouter" } });
    await Promise.resolve();
    await Promise.resolve();
    expect(mocks.requestInstallation).not.toHaveBeenCalled();
    await expect(factory(2n)).resolves.toMatchObject({
      botLogin: "reviewrouter[bot]",
    });
    expect(mocks.requestApp).toHaveBeenCalledTimes(1);
  });

  it("does not retry an ambiguous timed-out mutation", async () => {
    vi.useFakeTimers();
    const factory = requester(25);
    const installation = await factory(1n);
    let settle!: (response: {
      data: unknown;
      headers: Record<string, string>;
    }) => void;
    mocks.requestInstallation.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          settle = resolve;
        }),
    );
    const call = installation.request(
      "POST /repos/{owner}/{repo}/issues/{issue_number}/comments",
      {
        owner: "owner",
        repo: "repo",
        issue_number: 1,
        body: "progress",
      },
    );
    const timedOut = expect(call).rejects.toThrow("operation_deadline");
    await vi.advanceTimersByTimeAsync(25);
    await timedOut;
    expect(mocks.requestInstallation).toHaveBeenCalledTimes(1);
    const parameters = mocks.requestInstallation.mock.calls[0]?.[1];
    expect(
      (parameters?.request as { signal: AbortSignal }).signal.aborted,
    ).toBe(true);
    settle({ data: { id: 9 }, headers: {} });
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.requestInstallation).toHaveBeenCalledTimes(1);
  });
});
