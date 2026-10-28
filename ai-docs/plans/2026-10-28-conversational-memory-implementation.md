# Conversational memory implementation record

Implementation of [the reviewed plan](./2026-10-28-conversational-memory-and-shared-llm.md), authorized by the owner on 2026-10-28. This record distinguishes implemented and tested behavior from release qualification. The plan's earlier three rounds reviewed the design; implementation receives three new review rounds.

## Delivery and ownership

- SaaS branch: `feat/conversational-memory-e2e`, based on the reviewed plan and the configured-provider default from PR #729.
- Action branch: `feat/conversational-memory-runtime`, based on the native memory delivery fix from PR #349.
- All implementation and review delegates: `gpt-6.1-sol`, `xhigh`.
- Memory owner: portable engine capability, native preview, automatic source lifecycle and existing command integration.
- Conversation owner: full source, finite processing, plain Gateway inference, authority, routes and provisioning.
- Action owner: managed interaction, memory consumers, OCR native integrity and committed runtime.
- Coordinator: integration, release evidence, plan coverage and independent reviews.

No production activation is inferred from a passing local test. Existing source pins, privacy requirements, account authority and irreversible-effect uncertainty remain in force.

## Plan coverage

| Plan requirement                                             | State       | Evidence |
| ------------------------------------------------------------ | ----------- | -------- |
| Scoped source-processing/privacy/authority successor         | In progress | —        |
| OCR one-pass native rendering and actual CLI regression      | In progress | —        |
| Portable memory package, Router and external consumers       | In progress | —        |
| Strict native preview, no autosplit/retry/partial empty      | In progress | —        |
| Managed Gateway interaction caller, OIDC, selected account   | In progress | —        |
| Plain text/JSON inference without ar, bounded SSE            | In progress | —        |
| Full paginated thread, all-author revision coherence         | In progress | —        |
| Automatic learning independent of reply gates                | In progress | —        |
| Stable processing/replay/output-uncertainty handling         | In progress | —        |
| Atomic source cohorts, 2→1→0, partial and late callbacks     | In progress | —        |
| Explicit suppression, maintained detachment, forget fences   | In progress | —        |
| Common automatic-source eligibility and audience filtering   | In progress | —        |
| Review/investigation/description receipts and actual inputs  | In progress | —        |
| App publication marker/reconciliation and envelope purge     | In progress | —        |
| 48-thread corpus, isolated variants, protected A→B witnesses | Pending     | —        |
| Focused suites, PostgreSQL, native and paired E2E            | Pending     | —        |
| Protocol/bundle generation and repository required gates     | Pending     | —        |
| Implementation review round 1 and fixes                      | Pending     | —        |
| Implementation review round 2 and fixes                      | Pending     | —        |
| Implementation review round 3 and fixes                      | Pending     | —        |
| Live selected-model eval and disposable App-first E2E        | Pending     | —        |

## Verification rules

Each evidence entry names the tested revision and distinguishes deterministic transport/native checks from live model behavior. Live model quality targets are the plan's fixed targets, with no tuning against protected hold-out. Missing infrastructure or credentials are reported as a qualification blocker, never replaced by fabricated green results. New contextual capability stays unavailable until its applicable qualification is demonstrated.
