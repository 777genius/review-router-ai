import { generateKeyPairSync } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import type { ReviewRunAuthorization } from "@reviewrouter/features-review-run-control";
import { createReviewRunGatewayTerminalRunReader } from "./review-run-gateway-terminal-run";

afterEach(() => vi.unstubAllGlobals());

it("aborts the real cold-token POST before any source-run GET", async () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const requests: string[] = [];
  let tokenStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    tokenStarted = resolve;
  });
  let observedSignal: AbortSignal | null | undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, options: RequestInit) => {
      requests.push(String(url));
      observedSignal = options.signal;
      tokenStarted();
      return await new Promise<Response>((_resolve, reject) => {
        const aborted = () =>
          reject(new DOMException("fixture aborted", "AbortError"));
        if (options.signal?.aborted) aborted();
        else options.signal?.addEventListener("abort", aborted, { once: true });
      });
    }),
  );
  const read = createReviewRunGatewayTerminalRunReader({
    appId: "1",
    privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    resolveRepository: async () => ({
      githubInstallationId: "789",
      githubRepositoryId: "123",
      repositoryFullName: "test/repository",
    }),
  });
  const controller = new AbortController();
  const result = read(
    { sourceRunId: "456", sourceRunAttempt: "2" } as ReviewRunAuthorization,
    { signal: controller.signal },
  );
  await started;
  // This is the auth-app token request, not the later source-run endpoint. A
  // per-GET-only signal leaves this request pending and the cleanup slot held.
  controller.abort();
  expect(observedSignal?.aborted).toBe(true);
  await expect(result).rejects.toBeDefined();
  expect(requests).toEqual([
    "https://api.github.com/app/installations/789/access_tokens",
  ]);
});
