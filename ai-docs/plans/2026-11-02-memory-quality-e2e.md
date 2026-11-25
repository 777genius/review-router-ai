# Gateway / Hindsight memory-quality E2E

Date: 2026-11-02. Status: draft implementation plan.
Owner scope: evaluate actual ReviewRouter memory extraction, storage, delivery, retrieval, answers and forgetting. No production deployment, no change to production inference policy, no second semantic judge or memory engine.

## Existing authority

Reuse `scripts/conversation-evals/{run,fixture,score,score-inventory}.ts` and the native Hindsight qualification owner. Do **not** infer semantic quality from synthetic/provider-stub, PostgreSQL, UI or transport contracts. Live results must identify actual selected Account Gateway inference and native model, strict-preview mission/qualification, fresh isolated PostgreSQL and native namespace, source SHA, rubric/run ID and bound model-input delivery. Unavailable prerequisites are **UNAVAILABLE**, never PASS. Do not place secrets or customer content in artifacts.

## Delivery sequence

1. Keep both existing immutable eval corpora and targets intact. Add a small independent, versioned multilingual regression slice for Russian/mixed RU+EN full threads, including hostile quoted instructions, cross-repository isolation, source edit/delete and real A→B recall. Keep tuning distinct from protected cases; never use protected labels to tune.
2. Expose a **focused** GitHub Actions memory-eval workflow. On untrusted PRs run only corpus validation, scorer boundary regressions and focused deterministic test contracts. A separately authorized manual invocation on a reviewed main ref may run live tuning using existing runner with explicit qualified secrets/inputs and a disposable loopback database. Never run live from pull_request/push or with missing environment qualification. Retain only redacted summaries and a bounded rubric artifact; mark live `UNAVAILABLE` or `AWAITING_HUMAN_RUBRIC` until independent review. No silent protected split execution.
3. Add regression checks for live gate misuse (no accidental holdout, missing qualification, wrong DB), correct split/revision/runner command and refusal to manufacture a success result. Separate native/provider reliability from model semantic accuracy. Reuse the existing scorer and its rubric binding; do not invent automatic evaluator.
4. Critic reviews: security/privacy (secrets, PR trust and provider charges), correctness/statistical boundaries (split isolation, fixed denominators and causal memory delivery), and operator UX (easy repeatable, source-linked report with failure modes). Fix concrete findings; do not weaken protected gates.
5. Push incremental commits to the **draft PR** as changes are made. Require complete exact-HEAD CI for affected source and focused E2E, close actionable review findings, then merge safely. Observe post-merge checks. A live semantic score is separately required before claiming the product meets quality targets; no production activation is authorized.

## Quality signals (predeclared, not observed)

Retained-fact precision >=95%; eligible-fact recall >=80%; supported answers >=90%; attribution >=95%; unauthorized effects and critical blocked operations = 0; unnecessary replies/clarifications <=10%. Report numerator/denominator, errors and per-scenario witnesses, both languages, latency/availability and repeated-run variance without treating one small corpus as population reliability.

## Known blockers / decisions

The existing native Hindsight CI uses a deterministic inference stub and cannot prove real-model quality. The live runner requires the selected Gateway account, qualified strict-preview/mission, Hindsight credentials and a migrated disposable PostgreSQL database; none may be synthesized for CI. If this session cannot dispatch an authorized private live job, ship the safe workflow and tests but report live semantic quality **UNAVAILABLE**, leaving the protected holdout untouched.
