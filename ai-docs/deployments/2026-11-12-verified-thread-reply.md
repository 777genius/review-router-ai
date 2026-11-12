# Verified native review-thread replies — production qualification

Status: source **merged and postmerge E2E PASS**; staging **pending**;
production **not verified**. This is a deployment handoff, not permission to
release, replay old work, or change the current production fleet.

## Scope and source evidence

- [SaaS PR #861](https://github.com/777genius/review-router-ai/pull/861)
  merged on 2026-11-11 21:58:38 UTC as
  `8700a7b7fb269269d419b20d318dad2ce60beea4`.
- [Full premerge CI #43099916291](https://github.com/777genius/review-router-ai/actions/runs/43099916291)
  passed on the final source head.
- [Exact merge postmerge CI #43107754296](https://github.com/777genius/review-router-ai/actions/runs/43107754296)
  passed on `8700a7b` at 2026-11-11 22:58 UTC: 15/15 jobs succeeded,
  including Static, Quality, PostgreSQL migration, Self-hosted E2E, Source
  and Certification and Quality Gates. The Source and Certification log
  reported 25/25 lifecycle paired tests and 45/45 tests across six paired
  integration suites. PostgreSQL E2E applied
  `000156_verified_thread_reply` in an **isolated test database**, not in
  production.
- The V2 plan separates append-only `thread_reply` from
  `thread_lifecycle` resolve authority. Native REST replies require the
  trusted App-owned original parent, exact thread and finding identity.
  Reconciliation must not duplicate an ambiguous POST and historic attempts
  retain their own original publication plan.
- The original [get-tok PR #2](https://github.com/get-tok/reviewrouter-onboarding-e2e/pull/2)
  has a [summary confirming one verified fix](https://github.com/get-tok/reviewrouter-onboarding-e2e/pull/2#issuecomment-6783432295),
  but as checked on 2026-11-12 its
  [review thread](https://github.com/get-tok/reviewrouter-onboarding-e2e/pull/2#discussion_r4532358290)
  remains open and contains only the original `review-router-ai[bot]`
  finding. **No live native reply has been proved.** The original thread is
  now marked outdated; do not claim that the merged patch retroactively
  republishes an old attempt.

## Production HOLD — required before a real canary

1. Select and record one **exact** protected release commit, its successful
   trusted push CI, signed matching runtime image digest, approved migration
   inventory and public Action/runtime compatibility. The current `main`
   has advanced beyond #861 and includes later migrations. Do not silently
   claim that postmerge CI on `8700a7b` qualifies a different release head.
2. Follow the [stopped-cohort procedure](../operations/07-environments-and-release-management.md#verified-native-thread-replies-000156).
   With V2 publication admission disabled, stop/drain old API/worker writers
   and in-flight publication work, apply the reviewed schema migration, then
   attest matching new API and worker images before reopening admission.
   Do **not** roll back to pre-000156 readers while any `thread_reply` attempt
   can remain readable. Preserve any other migration-specific release gates
   selected by the exact release candidate.
3. Record real production evidence: database migration status, drained writer
   inventory, image digests/source IDs for every API/worker role, active
   feature admission, App installation identity and worker health. Source
   CI, local fixtures and a GitHub release asset are not fleet readbacks.
4. Use a **new, safe, bounded** event/fixture only after the fleet is
   qualified. Confirm its expected review/model cost and genuine installed
   GitHub App bot; do not replay the old get-tok publication attempt or
   trigger unbounded inference. Do not merge get-tok PR #2 or publish a
   manual impersonating reply. Prefer a deliberate new canary over mutating
   the historical evidence.
5. In the **actual GitHub PR review thread**, read back a native
   `in_reply_to_id` pointing to the verified original App-owned finding,
   bot identity, one canonical body/marker and no duplicate after safe
   repeat. Verify `reply` works in `report_only` even when `resolve`
   is denied; check that `open`/`resolved` matches policy and live
   history/head guards, and that stale/unknown effects are not replayed.
   Record the run, commit, review-comment and receipt URLs and observed
   resolved state separately from simulated paired E2E.

**Current disposition:** production HOLD. The last recorded production
baseline in [deployment index](README.md) is the 2026-11-11 03:23 UTC
`d2f4f69a` candidate, preceding #861. No verified migration, image
convergence or production bot reply for #861 is recorded here.
