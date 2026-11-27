# Unified Identity integration: planning review record

> Earlier sections record the original publication checkpoint. The reopened deep-review section at the end records the later findings, corrected hashes and verification boundary.

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
| Identity architecture after second-round closure | `d4de28a235be00f17b1994e31c2d331eda46ae7044520274ace186b8c8b630c2` |
| Identity final plan after the independently checked GetTok source-provenance correction | `10fda9097aa22c1aa92e585ac965e61fd615b4fe960041d39f6de95ec579996e` |

The final Identity-only correction distinguishes the actual GetTok fork main
from a newer supplemental TokenRouter upstream snapshot. The Foundation reviewer
checked the actual fork's existing OIDC and user/identity schemas. That correction
does not change the reviewed Identity/RR protocol or this consumer plan's bytes.

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

## Reopened deep review — 26 November 2026

The owner requested a deeper consistency/security review and explicitly limited
the task to documentation. The previous final-reviewed hashes above remain a
historical checkpoint. This pass found real omissions despite that earlier
acceptance; it supersedes the earlier confidence for the affected guarantees.

### Independent work actually performed

Three reviewers examined the two plans separately from the coordinating author:
security/proof and takeover scenarios; lifecycle/consumer delivery and phase
dependencies; Foundation/module architecture and source freshness. The Foundation
reviewer authored the BOOTSTRAP/package refresh, so that author's checks of those
edits are self-review, not a separate independent approval. The coordinating
author checked the shared contracts, source deltas and exact publication content.

First-pass findings were reconciled in both owning repositories. Second-pass
reviewers read the published corrected candidates at Identity
`22f98035de1b8f006c3b2aa58a3878ebcfcf23d5` and ReviewRouter
`8f911716dca510965d5901c2ae9a7b7f951081a9`. They confirmed the substantive
first-pass fixes and identified the three narrower residual issues listed below.
This is documentation/design review by separate assistant agents; it is neither
human approval nor a GitHub APPROVED review.

### Findings and corrections

| Priority | Counterexample or inconsistency | Corrected requirement |
| --- | --- | --- |
| P1 | Fresh broker/OAuth timestamp was treated as recent factor authentication | Two qualified proof classes and explicit ordinary migration versus incident recovery policies |
| P1 | Detach/reattach could revive old product sessions | Immutable issued attachment generation in session/status/cache/late-response fences, separate from account epoch |
| P1 | Closed central owner could be treated as an unbound legacy user | Never-centrally-bound predicate, retained history and repair/transfer-required conflict |
| P1/P2 | Closure lacked a bounded participant and late-write protocol | Existing account operation freezes manifest; own scoped receipts and a committed product terminal fence precede completion |
| P2 | GetOperation authority after closure was undefined | Operator-only detailed progress by default; bounded user receipt is optional, ordinary sessions remain closed |
| P2 | P1/R0/P5 publication requirements formed a cycle | Versioned packed TEST candidate, consumer qualification, then published production artifact |
| P2 | Absolute post-cutoff promise contradicted bounded staleness | Pin accepted snapshot; known newer state wins, original source/request-start deadline bounds older evidence |
| P2 | Generic scaffolding was assumed to generate DDD features | Package-boundary recipe only; real feature/composition/FMS/CMS source authored under the gates |
| P2 | CMS and resource-close semantics were underspecified | Forbid own public contracts in inner layers; close callbacks/waiter state do not prove physical release |
| P2 | Source/package observations had advanced | Foundation4.0.2/FMS0.4.3; RR f20a75ed/Prisma7.9.0; preserve historical evidence and unresolved bootstrap admission gaps |

Second-pass residual corrections:

1. **First factor / add-only root bootstrap.** An unrestricted social-only account
   can use an explicitly admitted bounded bootstrap profile; it inherits the
   original social-root risk. Persist prior stronger-profile admission rather
   than deriving eligibility from the current factor count. The exception cannot
   reopen after factor loss, remove an established root, clear incident
   restrictions or prove earlier legacy ownership. First enrollment and prohibited
   reuse share the existing T3 family; ordinary social login remains available.
2. **Cleanup membership outlives routing history.** Preserve the minimal
   consumer/account cleanup relation while in-scope product data or an obligation
   may remain. If an explicitly accepted retention decision removes it earlier,
   expose limited/unknown coverage; absence never proves not-provisioned or
   complete cross-product erasure. No discovery service or provisioning ledger
   was added.
3. **Residual all-path scaffolding wording.** The prospective tree now limits
   Plan/Apply/Receipt to actual eligible package-boundary recipes. Feature layout,
   composition and FMS/CMS facts are reviewed source changes, consistently with
   P1, BOOTSTRAP and AGENTS.

The owning PR descriptions record the status and outcome of the targeted final
check and current-head hosted CI, with exact commit identities.
The old hosted results are not transferred to a new head. This record identifies
the substantive corrected bytes below; it does not hash itself or infer successful
runtime qualification from reviewer agreement.

### Corrected document identities

| Document | SHA-256 |
| --- | --- |
| Identity architecture and implementation plan | `600d2e8448069dc5de821c38bc38e8c1d09c3001e686e2c261ae920d3a741f36` |
| ReviewRouter integration plan | `e79ea56d0a94e98e68cbf1a32f584280b6d89b8ad0f0dd4208f531ba798fd335` |
| Identity BOOTSTRAP | `58904cf6a4d5f1ae1fc21a9a721d9405df2e8a863cf4686ab59254c1d42ee129` |
| Identity dated source-freshness record | `a405c140b11cf2091287f20b931b1fe7f6e47cd511639278e005f394339b758c` |

### Verification method and limits

The reopened pass checked exact UTF-8 content for final newlines, trailing
whitespace and balanced fences, and resolved local Markdown targets against
the planned files and exact Git trees, including used anchors. It used direct
content/tree verification; the earlier `git diff --check` results above remain
historical, not reruns falsely attributed to this pass. Published source
candidates were fetched back and matched exactly; remote incremental file
scope contained only the intended Markdown documents. Final publication
verification and author/committer identity belong to the exact heads recorded
in the PRs.

The implementation test families were amended with discriminating counterexamples,
not executed. No runtime source, database migration, service scaffold, dependency
installation, Keycloak/provider registration, production rollout or merge was
performed. Foundation consumer admission, proof-provenance enforcement, native
provider behavior, retention decisions and the operational freshness target
remain concrete P0–P6 / R0–R6 implementation gates. They are not blockers to
reviewing these complete proposed plans.

## Additional IAM cross-product review — 2026-11-26

This is a later pass, after the historical checkpoints above. Three actual
independent critics used **gpt-6.1-sol, xhigh**: account security, product/authority
boundaries, and ReviewRouter migration. They read Identity `ae61c972c8e4b40062c36dcc13c8075a5e1b002e`
and ReviewRouter `5c6b78776244d22c30a6d02aa05a0fa8c7d52959`, then cross-checked
each other's counterexamples. The coordinator re-read the exact owning clauses
and primary sources. No previous critic result is represented as a new run.

The approved expanded Identity architecture, direct GitHub/GitLab login, local
product ownership and standalone/Fully Local independence pass this comparison.
The [shared research](https://github.com/agent-teams-ai/engineering-research/blob/578b166650b916efa51f011598a42fabadaeff2f/docs/studies/identity-provider-evidence.md)
preserves the earlier 18-question alternatives and the owner's newly endorsed
directions. It is not provider qualification or implementation authorization.

| ID | Disposition |
| --- | --- |
| IAM-N26-01 | Open P0/P2 trust-profile choice, now explicit: social-root custody can change after enrollment; unknown custody is not proof of neutral recovery. D3 contains three scoped options and the A-to-B negative experiment. |
| IAM-N26-02 | Clarified in both plans: first attachment/history registration and closure participant capture serialize through the same Account lifecycle gate. The consumer is included or the new admission loses; test both orders with delayed responses. |
| IAM-N26-03 | Corrected consumer wording: only operations with the same proven native identity promise convergence. A deliberate central-only new user may later hit a safe native-identity ownership conflict; no automatic merge. |
| IAM-N26-04 | Open P0/R0 session-control contract, now explicit in D8 and consumer behavior: account-status renewal does not prove a native SSO/client session remains active after lost logout delivery. Three finite-scope alternatives are recorded. |

These are two precise plan fixes and two retained admission choices, not four
demonstrated vulnerabilities. The earlier generation, proof-strength, bootstrap,
closure-fence and retired-owner corrections remain valid. Root-removal/recovery
session invalidation is included in the operation inventory without claiming a
separate confirmed defect.

Updated substantive document SHA-256 values:

| Document | SHA-256 |
| --- | --- |
| Identity plan | `14e3d84985af996e4e4ed0d429e4ab636394cd74fc97712c0750f945b6641903` |
| ReviewRouter plan | `99866dedddc77121f7fa231612fc460f7a8236fcbc722013593fba54c26d3695` |

This pass changes Markdown only. The future transaction, provider and browser
counterexamples are specified, not executed. Old-head CI 45834320649 remains
historical: two jobs succeeded and ten were skipped under Draft policy. It cannot
qualify the new head or real authentication. The current PR description records
the new head's publication and applicable checks separately. No service code,
dependency, migration, provider registration, deployment or merge is authorized
or performed by this review.

## Owner-selected D3-A and implementation handoff — 2026-11-26

This later checkpoint follows the open-choice review above. The owner selected
D3 continuity option A, with progressive independent proof for protected
organizational use and a future path toward scoped enterprise authentication.
The alternative profiles remain preserved. The selected direction does not
accept a numerical proof/freshness horizon, D6 legacy-ownership policy, D8's
additional session-control policies, or an unqualified provider mechanism.

Two actual gpt-6.1-sol xhigh critics re-read the current plans for implementation
readiness, scope and sizing. Their bounded review identified the necessary
handoff detail: P0/R0 must map protected resource/actions and session assurance;
P2 must qualify enrollment/recovery and real provider proof before dependent
admission. Identity P0 and bounded P2 fixtures can start first; substantive P1
and RR R0/R1 retain the exact prerequisites in the phase table. This is a
bounded first release on the intended architecture. P7 and enterprise breadth
are later scope, while the relevant P2-P6 / R2-R6 release evidence remains required.

The growth contract preserves AccountId and product IDs, permits versioned
proof/authority integration and forbids a policy change from silently widening
existing sessions. No zero-refactoring guarantee or general identity/grant
migration framework was introduced. The estimate clarification distinguishes
ReviewRouter's mixed non-test lines from pure production TS and prevents
counting D3's overlapping cross-product estimate twice.

Current substantive document SHA-256 values:

| Document | SHA-256 |
| --- | --- |
| Identity plan | `572e55379f7137b74c76e71114ec4ab7a5a7b6cfde061c47e547f591a74453ab` |
| ReviewRouter plan | `37c8acf8261360698f35862a828eca158ad31ba2e39be0e3de927b3dd326eac5` |

The coordinator checked UTF-8 contents, final newlines, trailing whitespace,
fence balance and the bounded Markdown delta. Existing local link targets were
unchanged. No runtime source, migration, dependency, provider configuration,
deployment or merge is part of this documentation update. Prior-head CI and
hashes remain historical; the PR descriptions record new-head delivery evidence
separately. The selected policy is not an executed E2E or provider qualification.
