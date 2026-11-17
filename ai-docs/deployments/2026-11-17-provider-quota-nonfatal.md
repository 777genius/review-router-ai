# Provider quota does not drop a parallel review: deployment

- Task ID: `2026-11-17-provider-quota-nonfatal`
- Goal: in a parallel multi-reviewer review, a reviewer stopped by a Gateway-confirmed provider quota (for example OpenRouter `:free`, `0 of 1000`) is skipped while another reviewer completes all of its work. The review publishes normally (inline comments, check), and the summary names the skipped reviewer and the quota reset time.
- Affected targets: database (additive migration `000158_review_run_allocation_provider_quota`), API (relay records the quota fact; finalization verifies the skip), Web (roster hint for OpenRouter `:free` models), and the public Action runtime (`777genius/review-router`) that decides the skip.
- Implementation: [ReviewRouter AI PR #888](https://github.com/777genius/review-router-ai/pull/888) and the paired [runtime PR #394](https://github.com/777genius/review-router/pull/394). Plan: [architecture 69](../architecture/69-provider-quota-nonfatal.md).
- Dependencies: none. One additive nullable column; no configuration, protocol or Gateway/native change.
- Last updated: 2026-11-17.

## Environment status

| Target                   | Status        | Actual version                     | Evidence                                                                                                                           |
| ------------------------ | ------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Staging                  | `pending`     | Not verified                       | Ordinary API/Web rollout and checks below                                                                                          |
| Production               | `in_progress` | 000158 applied; API/Web `974295ea` | SaaS part shipped in the [coordinated rollout](2026-11-17-coordinated-rollout-974295ea.md); quota skip check waits for the runtime |
| Action runtime (channel) | `blocked`     | Not released                       | Release PR #398 waits for the GitHub Actions queue; see the [coordinated rollout](2026-11-17-coordinated-rollout-974295ea.md)      |

## Ordered rollout

1. Apply migration `000158_review_run_allocation_provider_quota` through the ordinary Prisma deploy in the [release procedure](../operations/07-environments-and-release-management.md) (additive nullable column; registered as checksum-bound checkout tail 163 in the schema handoff policy), then deploy the API and Web image that contains this change. Until a runtime with the skip ships, behavior is unchanged: older runtimes report partial coverage whenever a required slot is open, and the recorded fact alone never completes coverage.
2. Only after step 1 is live: release the runtime PR and pair/promote it through the existing producer registration and workflow channel process. A new runtime against an older SaaS degrades to today's partial publication and a partial Action result, not to a failed finalization.
3. Verify in a disposable repository with two Gateway reviewers where one OpenRouter `:free` account has no remaining daily quota:
   - the run completes and publishes inline comments and the check from the healthy reviewer;
   - the summary contains ``Reviewer `<model>` was skipped: OpenRouter request quota exhausted (0 of N requests remaining). Try again after ...`` and `1 of 2 review providers failed`;
   - with only the exhausted reviewer, or with an authentication failure instead of quota, the review stays incomplete as before.
4. In the dashboard roster editor, a reviewer row with an OpenRouter `:free` model shows the daily-limit hint.
5. Note: `review-run-gateway-allocations.postgres.test.ts` covers the quota record through the 000152 guard; it runs only with `REVIEW_ROUTER_MULTI_REVIEWER_TEST_DATABASE_URL` and was not run for this change.

## Retry and rollback

Code steps can be repeated. Rolling back the SaaS image restores the strict rule (every required slot must be satisfied); a newer runtime then reads back the partial execution and reports a partial result. Rolling back the runtime channel restores today's partial behavior. The additive column can stay in place on rollback; it holds only timestamps and is ignored by older code. No existing data is rewritten.

## Execution log

| Time         | Target             | Actual version | Result                                   |
| ------------ | ------------------ | -------------- | ---------------------------------------- |
| Not executed | Staging/Production | Not verified   | Pending; no environment mutation claimed |
