import { generateKeyPairSync } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
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
function source() {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return new OctokitGitHubReviewRevisionSource({
    appId: "1",
    privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
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
