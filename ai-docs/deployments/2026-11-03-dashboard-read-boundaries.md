# Dashboard read boundaries: deployment

- Task ID: `2026-11-03-dashboard-read-boundaries`
- Goal: preserve dashboard workspace navigation, repository visibility and
  organization plan guidance while moving their read logic out of the renderer.
- Affected services/targets: Web.
- Implementation PR: [#798](https://github.com/777genius/review-router-ai/pull/798),
  consolidating [#796](https://github.com/777genius/review-router-ai/pull/796) and
  [#797](https://github.com/777genius/review-router-ai/pull/797).
- Implementation reference: final merge
  `06ab562b1d331cf5683b39bd5c2e49e97451b4db`, confirmed as an ancestor of the
  earlier installed production application `8561576c61abcead21419520e9bc350446017fc5`,
  retained by current private228/a3.
  Original stack head `b2cbac2322b9d20afbb4dae3ec57ad02d87f15fe` and integration
  reference `228cfe7352dd2db65516fbcc8e49be2bb7f2fc62` remain source provenance.
- Dependencies: none beyond the existing Web release prerequisites.
- Last updated: `2026-11-04`.

## Environment status

| Environment / target | Status      | Actual deployed version / image                   | Last verified (UTC) | Evidence / next step / blocker                                                                                                          |
| -------------------- | ----------- | ------------------------------------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| staging / Web        | `pending`   | Not verified                                      | Not verified        | No staging installation or live journey verification is credited.                                                                       |
| production / Web     | `installed` | Private228 a3db73fd / image0ff; exact tuple below | 2026-11-04          | #798 merge ancestry and actual installed code confirmed. Live authenticated workspace/repository/plan-guidance journey remains pending. |

Production source is `a3db73fd77eda829480f57ffe3f40ed7c9f9da06`, image
`sha256:0ffbaadca4d257d8b9f49c4d9e6292c4683669fcf3477cfa202303442522a3c2`.
The earlier verified856/image1962 installation remains historical evidence.
The code is already installed. Remaining production work is live verification;
no repeat Web deployment is required merely to close that evidence gap.
Staging `pending` means no verified completion is recorded, not observed absence.

## Applicability and prerequisites

Use the existing [release process](../operations/07-environments-and-release-management.md)
for any future authorized Web rollout. Production installation/ancestry is already
confirmed; reconcile that installed version before verification. This
change requires no schema migration, environment variable, feature activation or
provider rollout. The organization metadata cache remains bounded and local to
each Web process, with the existing five-minute, thirty-second and five-second
TTLs.

## Ordered rollout

1. Production code installation is complete on the exact a3/image0ff tuple
   above. Preserve that receipt and reconcile applicable verification tasks.
2. Staging remains unverified. If an authorized staging rollout is selected,
   use the normal release path and record its exact version independently.
   Do not repeat the completed production code rollout.
3. Sign in with the approved verification identities and check workspace
   selection, repository listing and direct repository navigation. Confirm that
   repository-only access does not disclose another workspace's installations
   or repositories, and that direct configuration still requires its separate
   permission check.
4. Check organization plan guidance for the configured GitHub App installation.
   An unavailable or denied metadata request must remain safe presentation
   guidance and must not grant repository access. Record per-environment results
   before marking that environment deployed.

## Verification and completion

The extracted cache, repository access loader and workspace projection must pass
their focused regression tests, the existing rendered dashboard contract tests,
the relevant browser journey and required repository CI. Capture actual commands,
revision, results and fixture boundaries in the PR. Fixture-backed browser runs
prove the UI/read contract rather than live GitHub permissions or deployment.
An environment is complete only after the deployed Web version and the journey
above have been observed there. Production therefore remains `installed` until
the authenticated journey and access boundaries have live evidence.

## Retry, partial completion, and rollback

Inspect the recorded Web version and completed verification steps before retrying.
The implementation adds no durable state or activation step. Use the existing
release [rollback procedure](../operations/07-environments-and-release-management.md#rollback)
for a confirmed regression, then recheck
workspace and repository visibility. Preserve verification evidence and record
any failed or unfinished step for the affected environment.

## Related links

- [Consolidated implementation PR #798](https://github.com/777genius/review-router-ai/pull/798).
- [Release process](../operations/07-environments-and-release-management.md).
- [Quality gates](../operations/03-quality-gates.md).

## Execution log

| Time (UTC)   | Environment               | Operator      | Actual version / image | Step and observed result                                                                           | Evidence                           | Next action                                                        |
| ------------ | ------------------------- | ------------- | ---------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------ |
| Not verified | staging / Web             | Release owner | Not verified           | No staging completion credited.                                                                    | #798 source record                 | Reconcile staging independently.                                   |
| 2026-11-04   | production / Web          | Release owner | 8561576c / image 1962  | Final #798 merge 06ab562 is an ancestor of the actual installed application; code is installed.    | Exact source/image and merge above | Verify the live authenticated dashboard journey; no repeat deploy. |
| Pending      | production / live journey | Release owner | Installeda3            | Workspace/repository isolation and organization plan guidance have no live verification claim yet. | Verification criteria above        | Append actual per-identity observations.                           |

Current private228 activation and compatible Action229 adoption are recorded in
[provider errors and findings](2026-11-04-provider-errors-and-findings.md). All four
roles, seven worker privilege checks and readiness200 passed on selected a3/image0ff.
Later main87f340 (#810) is outside that image. This installation does not close the
named live verification or semantic qualification gaps above.
