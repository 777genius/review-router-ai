# Provider and repository UI: deployment

- Task ID: `2026-11-27-provider-and-repository-ui`.
- Goal: show providers as selectable cards and improve repository-screen clarity.
- Affected target: Web.
- Implementation: [provider cards PR #1016](https://github.com/777genius/review-router-ai/pull/1016) and [repository UI PR #1018](https://github.com/777genius/review-router-ai/pull/1018).
- Implementation reference: record the merged revisions and exact release revision before rollout.
- Dependencies: the compatible provider catalog and the [Gateway route recovery PR #1017](https://github.com/777genius/review-router-ai/pull/1017), when applicable.
- Last updated: `2026-11-27`.

## Environment status

| Environment | Status    | Actual deployed version          | Last verified (UTC) | Evidence / next step                                                |
| ----------- | --------- | -------------------------------- | ------------------- | ------------------------------------------------------------------- |
| staging     | `pending` | Not verified                     | Not verified        | Reconcile before rollout.                                           |
| production  | `installed` | RR `5ab12e2d79a2` | 2026-11-27 03:20 UTC | Fleet applied; public Web and API readiness return HTTP 200. Authenticated UI and keyboard/mobile verification remain pending. |

## Applicability and prerequisites

- Confirm both implementation PRs are merged and included in the selected release. If one is excluded, retain its task as pending.
- Reconcile the production fleet, applicable deployment records and available disk against the exact release before rollout.
- This is a Web presentation change; it does not itself require a schema migration or feature activation. Follow the [release process](../operations/07-environments-and-release-management.md) for the selected batch.

## Ordered rollout

1. Verify the exact selected source and relevant checks. Use the existing hosted build and deployment procedure.
2. Deploy the selected fleet batch and verify the Web image revision and application readiness.
3. Verify the provider picker shows selectable cards with a green selected state, and that the repository screen shows its source icon and intended context-management link placement. Confirm keyboard operation and narrow layout.
4. Record the actual release, environment, timestamp and evidence; mark `deployed` only after the applicable checks pass.

## Verification and completion

Provider setup component tests and a fixture preview are implementation checks, not proof of production behavior. Check the authenticated provider and repository surfaces after rollout without entering credentials or changing user data.

## Retry, partial completion and rollback

Inspect the actual active fleet and rollout receipts before resuming an interrupted attempt. Restore the previous compatible Web image using the [release process](../operations/07-environments-and-release-management.md); preserve the installed Gateway configuration, database and source data. Do not mark an excluded PR deployed.

## Execution log

| Time (UTC)   | Environment          | Operator   | Actual version / image     | Step and result  | Evidence   | Next action                            |
| ------------ | -------------------- | ---------- | -------------------------- | ---------------- | ---------- | -------------------------------------- |
| Not executed | staging / production | Unassigned | Not verified for this task | Rollout pending. | PRs above. | Reconcile and deploy selected release. |

### Production installation — 2026-11-27

The four-role fleet was installed from `5ab12e2d79a2d60351fd17cca871b32f3d039f13`, image `sha256:e54aa8d14da80d0f7d462896d321483a670a2fa89b402e5b903cb4254a3b64b4`. The applied receipt is retained on the production host at `/srv/platform/projects/review-router/releases/fleet-overlay-5ab12-hook-v2-7J0ZRxaf/apply-receipt.json`. Web `/` and API `/ready` returned HTTP 200. Provider-card and repository UI verification in an authenticated session remains pending; no account was changed. This batch included the multi-tenant migrations documented in the linked deployment record.
