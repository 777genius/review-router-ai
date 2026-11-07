# Inline reviewer agreement: dashboard wording rollout

- Task ID: `2026-11-07-inline-agreement-dashboard`
- Goal: the dashboard accurately explains the managed v2 inline agreement threshold.
- Affected target: Web dashboard only. Paired managed Action behavior is tracked in [Action PR #375](https://github.com/777genius/review-router/pull/375).
- Implementation: [ReviewRouter AI PR #830](https://github.com/777genius/review-router-ai/pull/830).
- Last updated: 2026-11-07.

## Environment status

| Target     | Status    | Actual image | Evidence                                                |
| ---------- | --------- | ------------ | ------------------------------------------------------- |
| Staging    | `pending` | Not verified | Web rollout and screenshot/tooltip verification pending |
| Production | `pending` | Not verified | No deployment authorized by source merge                |

## Applicability and rollout

1. Verify that the selected web image contains merged PR #830. For **each affected cohort/workspace**, verify the effective (not just default) managed v2 Action release includes the one-vote threshold fix from [Action PR #375](https://github.com/777genius/review-router/pull/375). Existing namespaces may remain pinned to older releases. If any active cohort still runs the old behavior, hold the wording rollout or explicitly scope the UI copy until that cohort is updated. See the [release procedure](../operations/07-environments-and-release-management.md).
2. Use the existing web deployment process; no database migration, config change, provider credential change, feature activation, or release-channel mutation is needed for the wording.
3. With a test workspace and two independent reviewers, confirm that a threshold of two keeps an unconfirmed finding in summary, posts no corresponding inline comment, and preserves the configured severity gate. A confirmed finding may be inline. Confirm the dashboard tooltip matches this behavior.
4. Record the actual image/version, Action/runtime identity, timestamp and verified evidence separately for each environment. Source CI alone is not proof of deployment.

## Retry and rollback

Inspect current deployed web/Action identities before retrying. Do not replay review publication as part of a UI-copy rollout; use a disposable PR for live checks. If a required runtime does not satisfy the documented policy, keep an unexecuted rollout `pending` and do not claim the UI contract is active. If a deployed web image is reverted or the feature is disabled, record that environment as `rolled_back` with the previous image and any remaining recovery work. Use `blocked` if a required recovery step cannot proceed. No data migration to reverse.

## Execution log

| Time         | Target             | Actual version | Result                                   |
| ------------ | ------------------ | -------------- | ---------------------------------------- |
| Not executed | Staging/Production | Not verified   | Pending; no environment mutation claimed |
