# Default-on AI finding replies without an onboarding checkbox

**Date:** 2026-11-11  
**Status:** plan v4 — two review rounds completed; implementation and CI verification in PR #856  
**Scope:** setup PR generation and repository setup UX only. No production deployment in this PR.

## User contract

Creating a ReviewRouter setup PR requires no "Enable AI suggested replies" checkbox. After the workflow is merged, a PR author may ask a question by replying directly to a ReviewRouter inline finding, and supported authenticated paths answer in suggest-only mode. The AI never merges code, applies a fix, dismisses a finding or unblocks CI. Existing repository variable `REVIEW_ROUTER_DISCUSSION_MODE=off` remains an explicit opt-out.

## Existing implementation

- `apps/web/app/dashboard/repository-setup-action-button.tsx` renders an optional checkbox, producing `reviewDiscussionMode=suggest`; the server form reader otherwise uses `off`.
- Qualified managed Account Gateway already generates `discussion_mode: ${{ vars.REVIEW_ROUTER_DISCUSSION_MODE || 'suggest' }}` for its immutable interaction caller. Unqualified Gateway does not generate that caller.
- Native Claude subscription and direct provider-API caller contracts reject `discussionMode=suggest`. Do not circumvent these release boundaries.
- The standalone Action discussion preflight skips bots, fork PRs and non-ReviewRouter threads, and limits replies; it does **not** establish commenter write/author authorization before inference. Default-on without an additional guard could spend a repository owner's provider allowance for unrelated commenters.
- **Propagation bug:** the provisioning use case does not forward `plan.discussionMode` to `renderReviewRouterWorkflowFiles`, and the rotating workflow renderer omits `options.discussionMode` when creating its interaction workflow. Merely changing the form reader would leave setup PRs with `off`.

## Planned change

1. Remove the checkbox and its presentation plumbing from setup UI. Keep one obvious `Create setup PR` action and normal progress states.
2. Derive the effective discussion mode on the **server**, after inspecting the saved provider transport. Use `suggest` only for qualified **rotating Codex** setups; use `off` for direct provider API, native Claude, hosted pool and all other legacy routes. Gateway stays separately qualified and defaults in its own caller. The current provider catalog has no valid CI-secret Codex mode, so do not add a fictitious fallback. Gateway's separately qualified interaction caller retains its existing `suggest` default, without passing unsupported inputs to provisioning.
3. Forward `discussionMode` through **both** the provisioning use case and rotating interaction renderer; test actual YAML. **Preserve immutable v1/v2/v3 canonical caller bytes** and create a narrow v4 exact-source variant for the author-guarded default. Source inventory, API verifier, readiness and migration admission accept only explicit known variants, never a relaxed string matcher. For Action-rendered interaction workflows, gate **paid discussion inference** to the verified GitHub PR author on same-repository **newly created** `pull_request_review_comment` events using GitHub-authored event metadata in the workflow's discussion-mode expression. Treat malformed repository variable values as `off`, and allow only unset or explicit `suggest`. Preserve the existing `off` value as a hard opt-out. Keep `/rr` command delivery and existing preflight intact for maintainers. Preserve a repository-level `REVIEW_ROUTER_DISCUSSION_MODE=off` override.
4. Remove obsolete form parsing and tests. Assert the server ignores submitted stale `reviewDiscussionMode` values (no client-controlled bypass).
5. Extend small, focused tests for: checkbox absence; server mode decisions; Action workflow expression and opt-out; Gateway qualified/unqualified callers; Claude and provider API unaffected; existing setup refresh and malformed form handling.
6. Document default-on behavior, who can trigger it, provider usage and how to opt out. Record rollout status in the deployment registry per repository rules.

## Deliberate non-goals

No new feature flags, database migration, provider support expansion, account billing, new settings page, additional AI prompts, new chat command framework, edited Action runtime, automatic replies to arbitrary PR conversation comments, changing existing deployed workflows without an approved setup PR, or production deploy. Unqualified providers **fail closed** rather than pretending AI replies work.

## Acceptance and verification

- UI: no checkbox in new or refresh setup, no hidden toggle masquerading as user consent; existing create/merge/enable steps unaffected.
- Security: only human, same-repo PR author replies to a verified finding can request default-on legacy inference; normal command preflight stays functional; opt-out wins even for PR authors.
- Compatibility: qualified managed Gateway caller remains default-suggest and editable via its documented repo variable; provider-API and Claude workflows still provision; rotating v3 keeps its approved runtime pins.
- Evidence: targeted Vitest + typecheck/lint and workflow-render tests, PR CI, visual onboarding screenshot where available. A live paid-model reply needs a qualified test installation and may not be claimed from fixture-only tests.
- Reviews: two written architecture/security rounds on this plan before implementation, then final code/CI/review thread assessment before merge.
- Estimate: approximately 120–250 changed handwritten lines including tests/docs; risk 4/10 for generated workflow expressions; no new services.

## Implementation notes (2026-11-11)

- [x] Plan committed and Draft PR #856 opened.
- [x] Two review rounds with remediation recorded below.
- [x] Checkbox removed, server chooses per qualified transport, stale form values ignored.
- [x] Rotating v4 guard generated with exact-source admission; v3 historical bytes preserved.
- [x] Regression tests and deployment registry drafted.
- [ ] Exact-head CI and third-party review findings reconciled.
- [ ] Final merge after required checks pass; deployment and customer setup PR approvals remain outside this source PR.

## Review rounds

### Round 1 — architecture and compatibility (2026-11-11)

- **Finding A (high):** the original plan missed that both the provisioning use case and rotating renderer drop `discussionMode`; fixed by adding end-to-end option propagation to item 3 and rendered-YAML assertions.
- **Finding B (high):** the current provider catalog routes Codex via rotating/hosted pool/Gateway, MiMo via provider API, and native Claude via CI secrets. There is **no qualified CI-secret Codex onboarding path**. Default-on only for `rotating`; unsupported routes stay off.
- **Finding C (medium):** Gateway already defaults to suggest only when a qualified interaction runtime exists. Keep it untouched; never synthesize a Gateway release SHA or flip provisioning capability gates.
- **Decision:** one existing setup action, no additional client preference, no migration or Action bundle rebuild. Review verdict: proceed after focused security review.

### Round 2 — security and spending (2026-11-11)

- **Finding D (high):** `vars.REVIEW_ROUTER_DISCUSSION_MODE || 'suggest'` is insufficient as a default for the legacy path: a non-author could spend the owner's provider allowance. Use an explicit GitHub expression which permits `suggest` only when `event_name == pull_request_review_comment`, `action == created`, `head.repo.full_name == github.repository`, and `comment.user.id == pull_request.user.id`. This also keeps maintainer commands arriving through normal preflight, with no model call unless they are the PR author.
- **Finding D2 (high, fixed after implementation review):** an author can repeatedly edit a single comment; the legacy preflight updates one existing reply and does not consume a new per-thread reply slot. Restrict default-on paid inference to **newly created** human comment events; edited events still reach normal command preflight but do not run a discussion model.
- **Finding E (high):** a repository variable with any value besides unset or `suggest` must fail closed; `off` always wins. Never accept client-supplied `reviewDiscussionMode` as an authority. No runtime code receives sensitive credentials from the setup form.
- **Finding F (medium):** this reduces automatic Q&A for co-authors/reviewers who are not PR authors. That limitation is explicit and acceptable for this lean MVP. A future verified collaborator-role guard belongs in the interaction runtime, not a fabricated GitHub expression or additional server setting.
- **Finding G (critical, addressed):** immutable rotating v3 can already exist with exact historical `off` and unguarded `suggest` bytes. Rewriting v3 would reject installed workflows. Keep v3 untouched, add **v4 exact canonical** for default-on and accept only named v3/v4 source variants at API/inventory/migration boundaries. No weakening of source attestations or existing releases.
- **Test matrix:** render explicit/reusable/rotating qualified workflows; verify the same guard reaches preflight and execution, old opt-out is preserved, CI auth pins and job permissions remain unchanged, and older user-submitted form values cannot control server defaults.
- **Decision:** proceed. Risk revised **5/10** owing to source expression/YAML compatibility; total expected **250–450 handwritten lines** including rollout registry, docs and regression tests. No live model call or deployment without separately approved credentials/release.
