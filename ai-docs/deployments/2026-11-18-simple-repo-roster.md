# Simpler repository reviewer list: deployment

- Task ID: `2026-11-18-simple-repo-roster`
- Goal: the reviewer dialog of a repository explains that it follows the
  workspace default and that saving gives it its own copy ("Save for this
  repository"); "Use workspace reviewers" names the reviewers it switches to or
  warns that reviews stop when the workspace has no default; with one reviewer
  the mode, limits and reorder arrows are hidden; the arrows also work in
  "Together, in parallel", so the primary can be changed.
- Affected target: Web only.
- Implementation: [ReviewRouter AI PR #911](https://github.com/777genius/review-router-ai/pull/911). Plan:
  [80](../architecture/80-simple-repo-roster.md).
- Dependencies: none. No migration, configuration, feature flag, server action,
  Gateway, native or runtime change.
- Last updated: 2026-11-18.

## Environment status

| Target     | Status    | Actual image | Evidence                                       |
| ---------- | --------- | ------------ | ---------------------------------------------- |
| Staging    | `pending` | Not verified | Ordinary web rollout and the checks below      |
| Production | `pending` | Not verified | Ordinary web rollout with the next Web release |

`pending` means no verified completion is recorded, not that deployment was
observed to be absent. Use the [status contract](README.md#status-contract).

## Applicability and rollout

1. Confirm the selected web image contains the merged change, then deploy it
   through the existing web release path in the
   [release procedure](../operations/07-environments-and-release-management.md).
   Ordinary code rollout is sufficient.
2. Open the provider dialog of a repository that follows a Gateway workspace
   default: the line "This repository uses the workspace default reviewers
   below..." and the button "Save for this repository" are shown.
3. Open a repository with its own reviewers: under "Use workspace reviewers" the
   workspace default reviewers are named.
4. With one reviewer, "How reviewers work together", the limits and the arrows
   are hidden; with two they appear, and the arrows work in both modes.
5. Record the actual image/version, timestamp and evidence separately for each
   environment.

## Retry and rollback

Only the dialog's presentation changes; the saved roster, its order and mode
use the existing save path. Rolling back is an ordinary web image rollback.
Record any rollback as `rolled_back` with the previous image.

## Execution log

| Time         | Target             | Actual version | Result                                   |
| ------------ | ------------------ | -------------- | ---------------------------------------- |
| Not executed | Staging/Production | Not verified   | Pending; no environment mutation claimed |
