# Provider quota does not drop a parallel review: deployment

- Task ID: `2026-11-17-provider-quota-nonfatal`
- Goal: in a parallel multi-reviewer review, a reviewer stopped by a Gateway-confirmed provider quota (for example OpenRouter `:free`, `0 of 1000`) is skipped while another reviewer completes all of its work. The review publishes normally (inline comments, check), and the summary names the skipped reviewer and the quota reset time.
- Affected targets: database (additive migration `000158_review_run_allocation_provider_quota`), API (relay records the quota fact; finalization verifies the skip), Web (roster hint for OpenRouter `:free` models), and the public Action runtime (`777genius/review-router`) that decides the skip.
- Implementation: SaaS PR (this change) and the paired runtime PR in `777genius/review-router`. Plan: [architecture 69](../architecture/69-provider-quota-nonfatal.md).
- Dependencies: none. One additive nullable column; no configuration, protocol or Gateway/native change.
- Last updated: 2026-11-17.

## Environment status

| Target                   | Status    | Actual version | Evidence                                     |
| ------------------------ | --------- | -------------- | -------------------------------------------- |
| Staging                  | `pending` | Not verified   | Ordinary API/Web rollout and checks below    |
| Production               | `pending` | Not verified   | No deployment authorized by the source merge |
| Action runtime (channel) | `pending` | Not released   | Release and pair only after the SaaS rollout |

## Ordered rollout

1. Apply migration `000158_review_run_allocation_provider_quota` through the ordinary Prisma deploy in the [release procedure](../operations/07-environments-and-release-management.md) (additive nullable column; registered as checksum-bound checkout tail 163 in the schema handoff policy), then deploy the API and Web image that contains this change. Until a runtime with the skip ships, behavior is unchanged: older runtimes report partial coverage whenever a required slot is open, and the recorded fact alone never completes coverage.
2. Only after step 1 is live: release the runtime PR and pair/promote it through the existing producer registration and workflow channel process. A new runtime against an older SaaS degrades to today's partial publication, not to a failed finalization.
3. Verify in a disposable repository with two Gateway reviewers where one OpenRouter `:free` account has no remaining daily quota:
   - the run completes and publishes inline comments and the check from the healthy reviewer;
   - the summary contains ``Reviewer `<model>` was skipped: OpenRouter request quota exhausted (0 of N requests remaining). Try again after ...`` and `1 of 2 review providers failed`;
   - with only the exhausted reviewer, or with an authentication failure instead of quota, the review stays incomplete as before.
4. In the dashboard roster editor, a reviewer row with an OpenRouter `:free` model shows the daily-limit hint.

## Retry and rollback

Code steps can be repeated. Rolling back the SaaS image restores the strict rule (every required slot must be satisfied); a newer runtime then degrades to partial publication. Rolling back the runtime channel restores today's partial behavior. The additive column can stay in place on rollback; it holds only timestamps and is ignored by older code. No existing data is rewritten.

## Execution log

| Time         | Target             | Actual version | Result                                   |
| ------------ | ------------------ | -------------- | ---------------------------------------- |
| Not executed | Staging/Production | Not verified   | Pending; no environment mutation claimed |
