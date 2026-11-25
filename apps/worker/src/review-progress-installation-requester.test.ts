import { beforeEach, describe, expect, it, vi } from "vitest";
import { createProgressInstallationRequester } from "./review-progress-installation-requester";

const mocks = vi.hoisted(() => {
  const requestInstallation = vi.fn<
    (
      route: string,
      parameters?: Readonly<Record<string, unknown>>,
    ) => Promise<{ data: unknown; headers: Record<string, string> }>
  >();
  return {
    construct: vi.fn<(input: { appId: string; privateKey: string }) => void>(),
    requestApp: vi.fn<(route: string) => Promise<{ data: { slug?: string } }>>(),
    getInstallationOctokit: vi.fn<
      (id: number) => Promise<{ request: typeof requestInstallation }>
    >(),
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

function requester() {
  return createProgressInstallationRequester({
    githubAppId: "123",
    githubPrivateKey: "fixture",
  });
}

describe("createProgressInstallationRequester", () => {
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
      parameters,
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
});
