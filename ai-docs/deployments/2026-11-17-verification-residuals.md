# Verification residuals of 2026-11-17: deployment

- Task ID: `2026-11-17-verification-residuals`
- Goal: the Usage page stops polling for calls that will never get a report;
  the API refuses to start when a relay profile is missing from the run policy,
  and a reviewer whose saved profile is not its connection's profile gets an
  actionable 422; the Gateway logs one closed-phase line when it cuts a started
  stream itself; the review summary names a provider failure instead of the
  admission policy; CI on main is green again.
- Affected services/targets: ReviewRouter API and Web, Account Gateway service,
  public Action (next release after 240). No migration, no native change.
- Implementation PR/issue: [ReviewRouter #899](https://github.com/777genius/review-router-ai/pull/899),
  [account-gateway#115](https://github.com/agent-teams-ai/account-gateway/pull/115),
  [review-router#399](https://github.com/777genius/review-router/pull/399); plan
  [75](../architecture/75-verification-residuals.md).
- Implementation reference: Gateway merge `1dce5c327d14e9c0e5466da91441faa0d0ae38a5`;
  the ReviewRouter and runtime merge commits of the PRs above.
- Dependencies: the second small release of
  [Usage names the Gateway vendor](2026-11-17-usage-gateway-vendor.md)
  (ReviewRouter first, then the Gateway). The Action part waits for the next
  public Action release.
- Last updated: `2026-11-17`.

## Environment status

| Environment / target | Status    | Actual deployed version / image | Last verified (UTC) | Evidence / next step / blocker                       |
| -------------------- | --------- | ------------------------------- | ------------------- | ---------------------------------------------------- |
| staging              | `pending` | Not verified                    | Not verified        | Second small release.                                |
| production           | `pending` | Not verified                    | Not verified        | Second small release; check the relay policy first.  |
| public Action        | `pending` | Not verified                    | Not verified        | Next public Action release, producer, `workflow-v1`. |

`pending` means no verified completion is recorded. See the
[status contract](README.md#status-contract).

## Applicability and prerequisites

- Read-only before the ReviewRouter step: every `profiles[].profile.profileId`
  of `REVIEW_ROUTER_ACCOUNT_GATEWAY_RELAY_POLICY` must appear as a `profileRef`
  in `REVIEW_ROUTER_ACCOUNT_GATEWAY_POLICY` on the API. Otherwise the new API
  stops at startup with `review_run_gateway_relay_profile_unapproved:<ids>`.
  Fix the run policy first (the NVIDIA entry of the
  [error triage](2026-11-17-review-run-error-triage.md) is the template).
- From now on a profile cannot sit in the relay policy alone for dashboard
  probes, as on 2026-11-15: add it to both policies in the same change.
- The rebuilt `action-dist/index.cjs` reaches the public runtime repository
  through `Sync Public Action Runtime` after a green CI on main. Nothing pins it
  until a later release moves an Action ref.

## Ordered rollout

1. ReviewRouter API and Web, with the second release, through the
   [release process](../operations/07-environments-and-release-management.md).
   Ordinary code rollout; no migration.
2. Account Gateway with #115 in the Gateway step of the second release, after
   step 1 and together with #113/#114.
3. Action: the next public release after 1.0.240 carries review-router#399;
   then producer registration and `workflow-v1` promotion as usual.

## Verification and completion

- API starts; logs no `review_run_gateway_relay_profile_unapproved`.
- Usage page with old unreported calls only: no request every 30 seconds.
- Gateway: a facade cut after headers logs `gateway_facade_stream_failure`
  with `relay_chunk`, `relay_write` or `relay_terminal`; no second line for a
  stop that already has a `gateway_native_transport_failure` line.
- Action: a reviewer stopped on quota or a provider error shows "The review
  provider did not produce accepted evidence." and `required_work_exhausted`.

## Retry, partial completion, and rollback

Each step is an ordinary code rollout and can be rolled back to the previous
image or release on its own. If the API refuses to start on the relay check,
correct the run policy or keep the previous image; do not remove the check.

## Related links

- [Plan 75](../architecture/75-verification-residuals.md)
- [Usage names the Gateway vendor](2026-11-17-usage-gateway-vendor.md)
- [Coordinated rollout and rollback pins](2026-11-17-coordinated-rollout-974295ea.md)
- [Release process](../operations/07-environments-and-release-management.md)

## Execution log

| Time (UTC)   | Environment          | Operator   | Actual version / image | Step and observed result | Evidence | Next action           |
| ------------ | -------------------- | ---------- | ---------------------- | ------------------------ | -------- | --------------------- |
| Not executed | staging / production | Unassigned | Not verified           | Not started.             | None     | Second small release. |
