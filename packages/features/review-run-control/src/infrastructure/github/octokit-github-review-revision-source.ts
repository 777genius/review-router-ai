import { App } from "@octokit/app";
import {
  ReviewScmMergeBaseStatus,
  type GitHubReviewRevisionSourcePort,
  type ReviewScmMergeBaseResult,
  type ReviewScmPullRequestPointer,
} from "../../application/ports/review-scm-revision-ports";

type OctokitRequest = {
  (
    route: string,
    parameters?: Readonly<Record<string, unknown>>,
  ): Promise<{ readonly data: unknown }>;
  defaults(options: Readonly<Record<string, unknown>>): OctokitRequest;
};
type OctokitRequester = { request: OctokitRequest };
const revisionReadTimeoutMs = 15_000;
/**
 * Waits before each retry of a transient GitHub read (plan 86). All attempts
 * share the read's single deadline, so a retry never makes a read slower than
 * one read could already be, and a wait that does not fit is not taken.
 */
export const GITHUB_REVISION_READ_RETRY_DELAYS_MS: readonly number[] =
  Object.freeze([1_000, 2_000, 4_000]);
// GitHub: a rate limit answer without a wait still needs at least a minute.
// That never fits the read deadline, so such a read is refused at once.
const unannouncedRateLimitWaitMs = 60_000;

export class OctokitGitHubReviewRevisionSource implements GitHubReviewRevisionSourcePort {
  private readonly app: App;

  private readonly retryDelaysMs: readonly number[];

  constructor(options: {
    readonly appId: string;
    readonly privateKey: string;
    /** Tests only; production uses GITHUB_REVISION_READ_RETRY_DELAYS_MS. */
    readonly retryDelaysMs?: readonly number[];
  }) {
    this.app = new App({
      appId: options.appId,
      privateKey: options.privateKey,
    });
    this.retryDelaysMs =
      options.retryDelaysMs ?? GITHUB_REVISION_READ_RETRY_DELAYS_MS;
  }

  async findPullRequestNumbersForRun(
    input: Parameters<
      GitHubReviewRevisionSourcePort["findPullRequestNumbersForRun"]
    >[0],
  ): Promise<readonly number[]> {
    try {
      const response = await this.request(
        input.githubInstallationId,
        "GET /repos/{owner}/{repo}/actions/runs/{run_id}",
        {
          owner: input.owner,
          repo: input.repo,
          run_id: input.sourceRunId,
        },
      );
      return parseWorkflowRunPullRequestNumbers(response.data);
    } catch (error) {
      if (providerStatus(error) === 404) return [];
      throw error;
    }
  }

  async loadPullRequestPointer(
    input: Parameters<
      GitHubReviewRevisionSourcePort["loadPullRequestPointer"]
    >[0],
  ): Promise<ReviewScmPullRequestPointer | null> {
    try {
      const response = await this.request(
        input.githubInstallationId,
        "GET /repos/{owner}/{repo}/pulls/{pull_number}",
        {
          owner: input.owner,
          repo: input.repo,
          pull_number: input.pullRequestNumber,
        },
      );
      return parsePullRequestPointer(response.data);
    } catch (error) {
      if (providerStatus(error) === 404) return null;
      throw error;
    }
  }

  async resolveOfficialMergeBase(
    input: Parameters<
      GitHubReviewRevisionSourcePort["resolveOfficialMergeBase"]
    >[0],
  ): Promise<ReviewScmMergeBaseResult> {
    try {
      const response = await this.request(
        input.githubInstallationId,
        "GET /repos/{owner}/{repo}/compare/{basehead}",
        {
          owner: input.owner,
          repo: input.repo,
          basehead: `${input.baseSha}...${input.headSha}`,
        },
      );
      const mergeBaseSha = parseMergeBaseSha(response.data);
      return mergeBaseSha
        ? { status: ReviewScmMergeBaseStatus.Resolved, mergeBaseSha }
        : { status: ReviewScmMergeBaseStatus.Unavailable };
    } catch (error) {
      const status = providerStatus(error);
      if (status === 409) {
        return { status: ReviewScmMergeBaseStatus.Conflict };
      }
      if (status === 404 || status === 422) {
        return { status: ReviewScmMergeBaseStatus.Unavailable };
      }
      throw error;
    }
  }

  private async request(
    githubInstallationId: string,
    route: string,
    parameters: Readonly<Record<string, unknown>>,
  ): Promise<{ readonly data: unknown }> {
    const signal = AbortSignal.timeout(revisionReadTimeoutMs);
    const deadline = Date.now() + revisionReadTimeoutMs;
    let aborted!: () => void;
    const cancelled = new Promise<never>((_resolve, reject) => {
      aborted = () => reject(new Error("github_review_revision_read_timeout"));
      signal.addEventListener("abort", aborted, { once: true });
      if (signal.aborted) aborted();
    });
    try {
      const work = (async () => {
        for (let attempt = 0; ; attempt++) {
          try {
            const octokit =
              await this.installationOctokit(githubInstallationId);
            if (signal.aborted)
              throw new Error("github_review_revision_read_timeout");
            // auth-app derives its cold installation-token POST from these
            // request defaults. Endpoint-only options would leave that POST
            // unbounded.
            const request = octokit.request.defaults({
              request: { signal, timeout: revisionReadTimeoutMs },
            });
            return await request(route, parameters);
          } catch (error) {
            // Only a transient failure is read again, and never past the
            // deadline. Every other error reaches the caller unchanged, so
            // 404, auth failures and invalid answers behave as before.
            const retry = transientRetry(
              error,
              this.retryDelaysMs[attempt],
              deadline - Date.now(),
            );
            if (!retry || signal.aborted) throw error;
            logRetry(retry, attempt + 1);
            await waitUnlessAborted(retry.waitMs, signal);
            if (signal.aborted) throw error;
          }
        }
      })();
      // Also bound auth-app's internal replication backoff, which is not itself
      // signal-aware. Its underlying HTTP still receives the same cancellation.
      return await Promise.race([work, cancelled]);
    } finally {
      signal.removeEventListener("abort", aborted);
    }
  }

  private async installationOctokit(
    githubInstallationId: string,
  ): Promise<OctokitRequester> {
    if (!/^[1-9][0-9]*$/.test(githubInstallationId)) {
      throw new Error("github_installation_id_invalid");
    }
    return this.app.getInstallationOctokit(Number(githubInstallationId));
  }
}

function parseWorkflowRunPullRequestNumbers(data: unknown): number[] {
  if (!isRecord(data) || !Array.isArray(data.pull_requests)) {
    throw new Error("github_workflow_run_response_invalid");
  }
  return data.pull_requests.map((value) => {
    if (!isRecord(value) || !isPullRequestNumber(value.number)) {
      throw new Error("github_workflow_run_pull_request_invalid");
    }
    return value.number;
  });
}

function parsePullRequestPointer(data: unknown): ReviewScmPullRequestPointer {
  if (!isRecord(data) || !isPullRequestNumber(data.number)) {
    throw new Error("github_pull_request_response_invalid");
  }
  const baseSha = nestedSha(data.base);
  const headSha = nestedSha(data.head);
  if (!baseSha || !headSha) {
    throw new Error("github_pull_request_revision_invalid");
  }
  return { pullRequestNumber: data.number, baseSha, headSha };
}

function parseMergeBaseSha(data: unknown): string | null {
  if (!isRecord(data) || !isRecord(data.merge_base_commit)) return null;
  const sha = data.merge_base_commit.sha;
  return typeof sha === "string" && /^[a-f0-9]{40}$/i.test(sha) ? sha : null;
}

function nestedSha(value: unknown): string | null {
  if (!isRecord(value)) return null;
  const sha = value.sha;
  return typeof sha === "string" && /^[a-f0-9]{40}$/i.test(sha) ? sha : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPullRequestNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

type TransientRetry = Readonly<{
  failureClass: "server_error" | "rate_limited" | "network";
  status: number | null;
  waitMs: number;
}>;

function transientRetry(
  error: unknown,
  delayMs: number | undefined,
  remainingMs: number,
): TransientRetry | null {
  if (delayMs === undefined) return null;
  const status = providerStatus(error);
  const headers = responseHeaders(error);
  let failureClass: TransientRetry["failureClass"];
  if (status === 500 && isRecord(error) && !isRecord(error.response)) {
    // Octokit reports a failed fetch (reset, refused, DNS) as 500 without a
    // response.
    failureClass = "network";
  } else if (status !== null && status >= 500 && status <= 599) {
    failureClass = "server_error";
  } else if (
    status === 429 ||
    (status === 403 &&
      (headers["retry-after"] !== undefined ||
        headers["x-ratelimit-remaining"] === "0"))
  ) {
    failureClass = "rate_limited";
  } else {
    return null;
  }
  // Spread concurrent readers; never wait less than GitHub asks for, and give
  // up when that wait does not fit the deadline.
  const waitMs = Math.max(
    Math.round(delayMs * (0.5 + Math.random() / 2)),
    failureClass === "rate_limited"
      ? rateLimitWaitMs(headers)
      : (retryAfterMs(headers) ?? 0),
  );
  return waitMs < remainingMs ? { failureClass, status, waitMs } : null;
}

function retryAfterMs(
  headers: Readonly<Record<string, string>>,
  now = Date.now(),
): number | null {
  const value = headers["retry-after"]?.trim();
  if (!value) return null;
  // An excessive but valid delay must exceed the deadline, not become absent.
  if (/^\d+$/u.test(value)) return Number(value) * 1_000;
  const retryAt = httpDateTimestamp(value, now);
  return retryAt === null ? null : Math.max(0, retryAt - now);
}

/** HTTP recipients accept all three date forms (RFC 9110, section 5.6.7).
 * Normalize the obsolete forms before the round-trip calendar check. */
function httpDateTimestamp(value: string, now: number): number | null {
  const leapSecond = / 23:59:60(?: GMT| \d{4})$/u.test(value);
  let normalized = leapSecond ? value.replace("23:59:60", "23:59:59") : value;
  const obsolete =
    /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), (\d{2})-([A-Z][a-z]{2})-(\d{2}) (\d{2}:\d{2}:\d{2}) GMT$/u.exec(
      normalized,
    );
  if (obsolete) {
    const futureLimit = new Date(now);
    futureLimit.setUTCFullYear(futureLimit.getUTCFullYear() + 50);
    const year =
      Math.floor(futureLimit.getUTCFullYear() / 100) * 100 +
      Number(obsolete[4]);
    normalized = `${obsolete[1]!.slice(0, 3)}, ${obsolete[2]} ${obsolete[3]} ${year} ${obsolete[5]} GMT`;
    if (
      Date.parse(normalized) + (leapSecond ? 1_000 : 0) > futureLimit.getTime()
    ) {
      normalized = normalized.replace(` ${year} `, ` ${year - 100} `);
    }
  } else {
    const asctime =
      /^([A-Z][a-z]{2}) ([A-Z][a-z]{2}) ( \d|\d{2}) (\d{2}:\d{2}:\d{2}) (\d{4})$/u.exec(
        normalized,
      );
    if (asctime) {
      normalized = `${asctime[1]}, ${asctime[3]!.trim().padStart(2, "0")} ${asctime[2]} ${asctime[5]} ${asctime[4]} GMT`;
    }
  }
  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) &&
    new Date(timestamp).toUTCString() === normalized
    ? timestamp + (leapSecond ? 1_000 : 0)
    : null;
}

function rateLimitWaitMs(headers: Readonly<Record<string, string>>): number {
  const now = Date.now();
  const retryAfter = retryAfterMs(headers, now);
  const resetHeader = headers["x-ratelimit-reset"]?.trim();
  const resetSeconds =
    resetHeader && /^\d+(?:\.\d+)?$/u.test(resetHeader)
      ? Number(resetHeader)
      : Number.NaN;
  // Exhausted primary quota must respect both announced boundaries, including
  // a syntactically valid boundary too far away to represent as a Date.
  if (headers["x-ratelimit-remaining"] === "0" && !Number.isNaN(resetSeconds)) {
    return Math.max(0, retryAfter ?? 0, resetSeconds * 1_000 - now);
  }
  return retryAfter ?? unannouncedRateLimitWaitMs;
}

function responseHeaders(error: unknown): Readonly<Record<string, string>> {
  if (!isRecord(error) || !isRecord(error.response)) return {};
  const headers = error.response.headers;
  if (!isRecord(headers)) return {};
  const result: Record<string, string> = {};
  for (const name of [
    "retry-after",
    "x-ratelimit-remaining",
    "x-ratelimit-reset",
  ]) {
    const value = headers[name];
    if (typeof value === "string" || typeof value === "number")
      result[name] = String(value);
  }
  return result;
}

function logRetry(retry: TransientRetry, attempt: number): void {
  try {
    console.warn(
      JSON.stringify({
        event: "github_review_revision_read_retry",
        attempt,
        failureClass: retry.failureClass,
        ...(retry.status === null ? {} : { status: retry.status }),
        waitMs: retry.waitMs,
      }),
    );
  } catch {
    // A diagnostic sink cannot change the read.
  }
}

async function waitUnlessAborted(
  ms: number,
  signal: AbortSignal,
): Promise<void> {
  await new Promise<void>((resolve) => {
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
  });
}

function providerStatus(error: unknown): number | null {
  if (!isRecord(error)) return null;
  return typeof error.status === "number" ? error.status : null;
}
