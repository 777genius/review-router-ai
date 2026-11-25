import { App } from "@octokit/app";
import type { ReviewRunAuthorization } from "@reviewrouter/features-review-run-control";
import { reviewRouterWorkflowContract } from "@reviewrouter/protocol-review-workflow";
import type { ReviewRunGatewayCheckoutTarget } from "./review-run-gateway-checkout.js";

// Successful v4 cleanup intentionally preserves publication authority. Only
// abnormal source termination enters cancellation cleanup through this seam.
const failedConclusions = new Set([
  "failure",
  "cancelled",
  "timed_out",
  "action_required",
  "startup_failure",
]);
const numericId = (value: string) =>
  /^[1-9][0-9]*$/.test(value) && Number.isSafeInteger(Number(value));

/** Only observes the original App-owned caller run. Terminal does not mean
 * unpaid: the relay must still durably deny and close its retained capability. */
export function createReviewRunGatewayTerminalRunReader(input: {
  readonly appId: string;
  readonly privateKey: string;
  readonly resolveRepository: (
    authorization: ReviewRunAuthorization,
  ) => Promise<ReviewRunGatewayCheckoutTarget | null>;
}) {
  const app = new App({ appId: input.appId, privateKey: input.privateKey });
  return async (
    authorization: ReviewRunAuthorization,
    options: { readonly signal: AbortSignal },
  ): Promise<boolean> => {
    if (
      options.signal.aborted ||
      !numericId(authorization.sourceRunId) ||
      !numericId(authorization.sourceRunAttempt)
    )
      return false;
    const target = await input.resolveRepository(authorization);
    if (
      !target ||
      options.signal.aborted ||
      !numericId(target.githubInstallationId) ||
      !numericId(target.githubRepositoryId)
    )
      return false;
    const parts = target.repositoryFullName.split("/");
    if (parts.length !== 2 || !parts[0] || !parts[1]) return false;
    const client = await app.getInstallationOctokit(
      Number(target.githubInstallationId),
    );
    // Set defaults on the request function itself: auth-app derives its token
    // POST from this function and does not inherit endpoint-only request options.
    const request = client.request.defaults({
      request: { signal: options.signal, timeout: 5_000 },
    });
    const { data } = await request(
      "GET /repos/{owner}/{repo}/actions/runs/{run_id}/attempts/{attempt_number}",
      {
        owner: parts[0],
        repo: parts[1],
        run_id: Number(authorization.sourceRunId),
        attempt_number: Number(authorization.sourceRunAttempt),
        request: { signal: options.signal, timeout: 5_000 },
      },
    );
    // workflow_dispatch runs have the default branch's head SHA, rather than the
    // reviewed PR's head SHA. Their signed run/attempt and repository identify the
    // source; comparing data.head_sha with authorization.headSha would be wrong.
    return (
      !options.signal.aborted &&
      String(data.id) === authorization.sourceRunId &&
      String(data.repository.id) === target.githubRepositoryId &&
      data.repository.full_name.toLowerCase() ===
        target.repositoryFullName.toLowerCase() &&
      String(data.run_attempt) === authorization.sourceRunAttempt &&
      data.event === "workflow_dispatch" &&
      data.path === reviewRouterWorkflowContract.callerPath &&
      data.status === "completed" &&
      typeof data.conclusion === "string" &&
      failedConclusions.has(data.conclusion)
    );
  };
}
