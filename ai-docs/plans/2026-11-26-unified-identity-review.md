# Unified Identity integration: planning review record

Date: 2026-11-26, Europe/Kyiv. Scope: the proposed
[Review Router integration plan](2026-11-26-unified-identity-and-scm-connections.md)
and consistency with the
[Identity architecture plan](https://github.com/agent-teams-ai/identity/blob/docs/identity-service-plan-20261126/docs/plans/identity-service-implementation-plan.md).
This is documentation/source review by separate assistant agents, not a GitHub
APPROVED review, human acceptance, executed runtime qualification or deployment.

## Actual review passes

1. **Author research and self-review.** Read current auth, principal, dashboard,
   credential, schema and accepted ADR boundaries at main `1912bb61b54de8af113e0dccd5d4a144382e19e2`;
   inspected overlapping PRs and provider protocol documentation. Kept this
   source snapshot distinct from candidate #1007 behavior.
2. **Independent first pass by the Identity coordinating author.** Read the full
   consumer plan and checked local account ownership, migration proofs, session
   authority, namespace backfill, provider consent, additive rollout and safe
   rollback. Reconciled the common self/status APIs and lifecycle assumptions.
3. **Independent second passes by the Foundation and modules/HTTP reviewers.**
   Both reviewed the consumer plan separately from its author. The Foundation
   reviewer also checked the actual version/lock/adoption evidence. The security
   reviewer exercised design counterexamples for token substitution, stale
   sessions, refresh races, cutoff, account switch and missing lifecycle delivery.
4. **Final targeted closure.** Both independent reviewers read the corrections
   and verified the final document hash below. The consumer author's cross-plan
   consistency check was additional self-review, not independent approval of
   their own document.

The parallel Identity plan received three independent first and second passes;
its [review record](https://github.com/agent-teams-ai/identity/blob/docs/identity-service-plan-20261126/docs/reviews/identity-plan-review-2026-11-26.md)
owns that evidence. Shared findings were reconciled in both documents.

## Material corrections retained in the plan

| Concern | Resulting requirement |
| --- | --- |
| GitHub App scope string mistaken for repository authority | Validate actual App/user/installation permissions; preserve product-owned credentials and existing repository checks |
| GitLab login assumed to grant setup access | Separate `read_user` sign-in from explicit product API permission and setup/review credential purposes |
| Permanent migration from an old cookie | Require recent proof of both exact owners in one bounded, purpose-bound intent; no email/hint merge |
| GitLab native user ID treated as global | Instance-qualified identity and evidence-based backfill; ambiguous historical rows are quarantined |
| Lost suspend/enable events or delayed active response | Immutable issued security epoch, actual authentication cutoff and source/request-start-bound expiry; no receipt-time TTL renewal |
| Generic service token used for arbitrary account status | Dedicated workload client and user-proven ConsumerAttachment; both self and batch deny usable evidence after detach |
| Global logout equated with provider notification | Canonical account-wide epoch/cutoff; distinguish local/all-RR, canonical global and provider-native session scopes |
| OIDC session persistence assumed to implement refresh concurrency | Durable per-session claim/generation, revoke-wins semantics and explicit response-loss recovery; separate from SCM custody |
| Central PKCE described as optional | Mandatory S256 without downgrade, verified against the actual pinned session adapter |
| Broad Stack/version language | Compiler/linter/formatter authority only; product dependency versions belong to manifests/lock; Prisma range and resolution are distinct |
| Unsafe rollback to the untouched old binary | Define and qualify a compatible rollback release that retains binding/session guards and central suspension |
| Reimplementing active credential reliability work | Reuse accepted #1007 authority mechanisms; refresh overlapping PR state before implementation |

## Final reviewed bytes and result

| Document | SHA-256 |
| --- | --- |
| Review Router plan | `dfd7cec89a266024c3424dfd9b8aebb8818a02edd3648cdd834e1e53d1b9fa24` |
| Identity core plan | `d4de28a235be00f17b1994e31c2d331eda46ae7044520274ace186b8c8b630c2` |

The independent reviewers reported no unresolved material design/documentation
blocker for these proposed planning Draft PRs in their reviewed scope. Runtime
R0–R6 exits remain mandatory: supported adapter behavior, actual native-provider
permissions, two-replica session authority, real database migration, lifecycle
freshness, and the qualified compatible rollback cannot be proved by prose.

## Verification and freshness

Checked changed/new Markdown for local targets and used anchors, whitespace,
final newlines, balanced fences and bounded diff scope. `git diff --check` passes
on the planning changes. No runtime source, migrations, dependency manifest,
lock, deployment record or production configuration changed in this task.
No NextAuth/Keycloak/PostgreSQL/browser/provider test is reported as executed.

Main remained `1912bb61b54de8af113e0dccd5d4a144382e19e2` at final source refresh.
PR #1007 advanced from inspected auth head
`1a71a58ff79a21d95a29349f38a23627620584b5` to
`237c802358396414859366520cbb58fb07450004`; the inspected delta changes only the
private usage-retention source classification and related reliability-plan
annotation. Other cited RR PR heads remained unchanged. The plan preserves
the original source observation and labels this later, narrowly inspected delta.
