# Provider transport scope

Owner decision, 2026-10-12: the selected production provider path is Account
Gateway/Sub2API only. The existing Sub2API delivery owner owns rollout, recovery
and the real GitHub App review E2E. Do not start a parallel rollout or provider canary.

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

## Direct OpenRouter option (2026-10-21)

The owner's later request adds a separate, explicit OpenRouter option using a
repository `OPENROUTER_API_KEY` in GitHub Actions. It is not a Gateway fallback:
Account Gateway retains its server-managed account and embedded Sub2API path.
Both options use App-first admission and GitHub App publication. Direct execution
uses the approved Codex CLI with OpenRouter as its model provider; OpenCodeReview
remains available through eligible Account Gateway profiles.

The direct caller is the canonical `.github/workflows/reviewrouter-review.yml`
variant pinned to an exact public Action commit. It uses OIDC, T0/schema 2 and
`provider_api_auth_mode: openrouter-api`, with only the fixed named secret mapping.
Installing a key alone does not install or activate this caller, or change policy.
Credential-only connection and rotation remain available before selecting a policy.

The first direct T0 route requires one OpenRouter provider and model, with agreement
of one. Setup, policy writes and admission reject incompatible multi-provider
policies without selecting their first row or rewriting saved configuration. The
captured OpenRouter model and authentication provenance use one conservative Codex
execution vote identity; a named secret is not proof of an independent upstream
account. TODO: qualify multi-provider/quorum execution before offering it on this
direct route. Existing configurations remain readable.
