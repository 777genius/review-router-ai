# Provider errors and security findings - 2026-11-04

## Actual production state

Application source remains `8561576c61abcead21419520e9bc350446017fc5`, image
`sha256:1962f5e6f60e465a5d902c28bf8f4a2f35280b88186f9d0c8d79fdd49f039b9c`.
Public Action227 and `workflow-v1` remain
`abff4814dccab046debd61f7f5e14f4524f54e5e`.

The quota-aware Gateway/native pair is **installed** at
`/srv/platform/artifacts/review-router/account-gateway/releases/provider-quota-83e335-c367603-20261104/release`.
Gateway source `c3676038` is merged through
[Gateway PR99](https://github.com/agent-teams-ai/account-gateway/pull/99);
native source `83e3353e7c25cd16bf2d978e807c5d46fa6d632c` is merged through
[native PR91](https://github.com/agent-teams-ai/sub2api/pull/91).
The actual Node process and both native child executable paths were checked.
Native binary SHA256 is
`a9401cebc92eb373f6a7e700f664bdbbab7da3834569d7f7a4149b97937dcdf0`.
Service configuration executable path and digest agree; service readiness is200.
Activation receipt and prior configuration are retained in that release's parent.
This supersedes the old Gateway/native paths in the account-concurrency record.
No schema migration, model/default change or admission-limit change was made.

## Observed live behavior

Before the daily reset, the exact Payments PR30 request exposed authenticated
OpenRouter quota metadata: limit1000, remaining0, reset2026-11-04T00:00:00Z.
This is an observed exhausted provider allowance, not an internal account lane.
After reset, [fresh run41743723435](https://github.com/agent-teams-ai/payments-sdk/actions/runs/41743723435)
completed required coverage1/1. Its exact execution produced one Statistics
review fact and two unique Usage calls. The model returned no finding for that
example; successful transport is not evidence that every defect is detected.

The stronger, single-file production authorization fixture in
[run41744471499](https://github.com/agent-teams-ai/payments-sdk/actions/runs/41744471499)
completed required coverage1/1 and returned one major security finding. The
old Action filtered it as a suggestion, publishing zero findings. This is a
confirmed projection bug, not a model miss. Seventeen model calls completed;
one optional description call remained unknown and was not retried.

## Pending coherent delivery

- [Action PR368](https://github.com/777genius/review-router/pull/368): preserve
  confirmed OCR security findings and show confirmed quota exhaustion with its
  reset time. Generic closed upstream failures explain the unknown request
  outcome, no approval from an incomplete review, and waiting for the current
  run to finish before starting a new review, without guessing HTTP/vendor/quota.
  Source11315289 passed75 focused transport/projection tests, typecheck and both
  affected bundle builds. The exact production finding failed on old projection and passes
  on the repair;58 projection tests passed on source32bb167. Bundles/version228
  are prepared. Exact-head required CI passed on11315289, and PR368 merged as
  `80c63cdbc23e32d099ba1779f9d09ff220a0370c`. Official public release
  [run41750361002](https://github.com/777genius/review-router/actions/runs/41750361002)
  is in progress; producer adoption remains pending. It is not installed merely
  because Gateway is installed. Final paired source checks can run in parallel
  with public publication; private publication/activation still requires the
  actual successful public release.
- [SaaS PR809](https://github.com/777genius/review-router-ai/pull/809): quota-aware
  SDK and relay propagation;100 focused SDK/relay cases passed. Candidate5ee9e9b
  built successfully as image
  `sha256:8ac2b0d6bb1d11abd7fe2ac49fb1c056ad27a8211863327a5c83e6bacf72d435`.
  It is not installed. Batch final paired Action pin and current-main integration
  before final CI/release; do not repeat intermediate full CI unnecessarily.
- After coherent delivery, use the existing disposable Payments PR30 for one
  fresh review and verify published security finding plus Statistics/Usage.
  Preserve the test stand and all old producer rows/profiles.

Memory semantic qualification is separate and does not block ordinary review
delivery. Candidate809 r1 remains UNAVAILABLE after13 complete responses and a
provider502 at event14/50; its request is closed/ACKed and cleanupDONE. A fresh
isolated serial r2 used new request identities. Neither result
is a semantic PASS. The isolated r2 subsequently observed all50 events:
46 completed/closed model calls, three settled no-call replays, and one catalog
refusal before dispatch; zero unknown effects. It remains UNAVAILABLE, with a
missing eligible endorsement and one invalid model output. No official score,
semantic activation, or automatic retry is credited. Generic502 must not be presented as confirmed quota failure;
unknown effects remain unknown and must not be blindly replayed.
