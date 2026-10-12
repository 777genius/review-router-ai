# Provider transport scope

Owner decision, 2026-10-12: ReviewRouter production uses Account Gateway/Sub2API
only. The existing Sub2API delivery owner owns rollout, recovery and the real
GitHub App review E2E. Do not start a parallel rollout or provider canary.

The old direct native-v4 adapter and direct hosted Codex relay are legacy.
Retain their code, custody, packages, receipts and consumed UNKNOWN outcomes;
do not replay, reset, refund or reclassify them. Finishing that adapter or proving
a separate monetary debit through it is not a Hetzner migration requirement.
It must not be selected as an automatic fallback from Sub2API.

These comments do not disable routes or change deployed feature flags. The
delivery owner must verify actual configuration selects only the intended path.
Do not remove shared authorization, SCM read, fencing or exactly-once checks
just because a symbol contains `v4`. Likewise, Gateway native-response types
describe its protocol, not the legacy direct transport.

Migration acceptance is a working public ReviewRouter on Hetzner with current
data, one writer and preserved recovery/rollback, plus a genuine disposable PR
review through Sub2API with GitHub App publication. A merged implementation or
HTTP 200 alone does not prove that acceptance. Render is entirely out of scope;
the current Hetzner database is authoritative. Landing work is last priority.
