# TODO: Martian Code Review Bench

Status: **not started**. Deferred quality eval, not v1 product scope.

Run ReviewRouter against Martian's public offline Code Review Bench and keep
the numbers internal until we decide they are worth publishing.

Harness: [withmartian/code-review-benchmark](https://github.com/withmartian/code-review-benchmark)
Leaderboard context: [codereview.withmartian.com](https://codereview.withmartian.com)

## What to run

The comparable Cubic/Bugbot numbers are the **offline** set: 50 PRs from
Sentry, Grafana, Cal.com, Discourse, and Keycloak, scored against 173
human-curated golden comments. An LLM judge matches our review comments to
those gold issues and reports precision / recall / F1.

Do **not** try the online leaderboard. Official listing needs roughly 600–1000
public PRs and a Martian re-run. That is out of scope.

## How to start

Start with **5 PRs, one from each repo**. That is enough to prove the harness
and see whether we are in the “noisy 25% F1” or “useful 50% F1” band.

Reviews should use the **Codex OAuth subscription**, not pay-per-token API.
The 5-PR smoke is meant to fit in the existing OAuth quota. Watch the weekly
cap; large monorepo checkouts (Sentry/Grafana/Keycloak) are the expensive
part, not the judge.

Judge scoring is a separate, cheap LLM bill. Use one inexpensive judge for
the smoke (Sonnet or mini). Do not run Opus + Sonnet + GPT-5.2 unless the
5-PR result is worth a full 50-PR pass.

## Constraints

- Run the real ReviewRouter path: GitHub App + workflow + full checkout +
  agentic Codex review. Diff-only CLI scans are not this product.
- Do not read golden comments before or during the review run. Score only
  after comments are posted.
- Do not tune prompts against the gold set.
- Reviews must be attributable as a bot so the harness can extract them.
- ReviewRouter is precision-first (few, high-confidence comments). Expect
  Graphite-like scores: higher precision, lower recall. Prefer reporting
  F0.5 alongside F1 so the product default is not punished for being quiet.

## Later, only if the smoke is useful

1. 15 PRs (3 per repo).
2. Full 50-PR offline set.
3. Optional second judge model if we want to publish.

Record the disposable fork org, PR URLs, workflow runs, judge model, and
scores here when the smoke exists.
