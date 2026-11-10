# Default-on AI finding replies without an onboarding checkbox

**Date:** 2026-11-11  
**Status:** plan v1 — pending two review rounds and implementation  
**Scope:** setup PR generation and repository setup UX only. No production deployment in this PR.

## User contract

Creating a ReviewRouter setup PR requires no "Enable AI suggested replies" checkbox. After the workflow is merged, a PR author may ask a question by replying directly to a ReviewRouter inline finding, and supported authenticated paths answer in suggest-only mode. The AI never merges code, applies a fix, dismisses a finding or unblocks CI. Existing repository variable `REVIEW_ROUTER_DISCUSSION_MODE=off` remains an explicit opt-out.

## Existing implementation

- `apps/web/app/dashboard/repository-setup-action-button.tsx` renders an optional checkbox, producing `reviewDiscussionMode=suggest`; the server form reader otherwise uses `off`.
- Qualified managed Account Gateway already generates `discussion_mode: ${{ vars.REVIEW_ROUTER_DISCUSSION_MODE || 'suggest' }}` for its immutable interaction caller. Unqualified Gateway does not generate that caller.
- Native Claude subscription and direct provider-API caller contracts reject `discussionMode=suggest`. Do not circumvent these release boundaries.
- The standalone Action discussion preflight skips bots, fork PRs and non-ReviewRouter threads, and limits replies; it does **not** establish commenter write/author authorization before inference. Default-on without an additional guard could spend a repository owner's provider allowance for unrelated commenters.

## Planned change

1. Remove the checkbox and its presentation plumbing from setup UI. Keep one obvious `Create setup PR` action and normal progress states.
2. Derive the effective discussion mode on the **server**, after inspecting the saved provider transport. Use `suggest` for the existing Codex-capable CI/rotating discussion workflow only; use `off` for unsupported direct provider API and Claude-only workflows. Gateway's separately qualified interaction caller retains its existing `suggest` default, without passing unsupported inputs to provisioning.
3. For Action-rendered interaction workflows, gate **paid discussion inference** to same-repository PR authors using trusted GitHub webhook event context in the workflow's discussion-mode expression. Keep `/rr` command delivery and existing preflight intact for maintainers. Preserve a repository-level `REVIEW_ROUTER_DISCUSSION_MODE=off` override.
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

## Review rounds

Pending.
