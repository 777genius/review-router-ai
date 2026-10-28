# Skills usability completion

Status: implemented and independently reviewed. Final published-head browser/visual results, required CI, review disposition, and merge evidence are tracked in [control-plane PR #704](https://github.com/777genius/review-router-ai/pull/704) and [runtime PR #338](https://github.com/777genius/review-router/pull/338).

## Goal and evidence

Make the existing Skills feature understandable from connection through review output, without adding another product surface, permission model, execution mode, or setup wizard. The user authorized planning, independent criticism, implementation, real browser qualification, PR review, immediate push of every commit, and merge after required checks.

Starting points: control plane `73629de84c40f437fd900d09f0ead7015dc5237d` (PR #702 merged), runtime `f92e4fff822a0fef9e0daee792d8d4cf6783277d`. Both working branches are `feat/skills-usability-20261025`. Existing authorization, sharing, assignment delta retry, scope CAS, trusted-base materialization, and runtime admission are retained.

The source and previous browser evidence identify six connected gaps:

1. One repository's dialog mixes adding skills, editing existing scopes, and immediately saved Git roots. Assigned skills beyond the library's first page need a dedicated assigned query.
2. A known skill's repository picker opens another skill picker. A newly accepted shared skill has no direct assignment handoff.
3. Compatibility is only a generic warning, despite the original plan requiring a useful signal before Apply.
4. Import can silently omit portable metadata/resources, while app display names and empty descriptions do not necessarily produce a portable SKILL.md.
5. Review output does not explain whether configured instructions matched the review, reached a new accepted invocation, or were associated with reused evidence.
6. Git materialization errors become generic terminal failures; users do not see a source file and an actionable correction in the actual workflow failure report.

Industry baseline is the text-first portable [Agent Skills specification](https://agentskills.io/specification), with progressive disclosure and repository-scoped administration. Competitor breadth is not a reason to add marketplace, scripts, or governance screens here.

## Scope limits

- No database migration, new skill permission, execution privilege, captured contract version, cache identity, or producer capability is introduced.
- No new Git roots, implicit AGENTS inheritance, executable skills, ZIP/folder import, marketplace, history UI, or per-skill runtime controls.
- Do not refactor unrelated review lifecycle, providers, Memory/Hindsight, or findings presentation. Concurrent PRs in those areas stay separate.
- No production deployment or workflow tag promotion is implied by these PRs. Existing release authority and CI remain required.
- Reuse existing UI primitives, dialogs, query adapters and typed keys. Use sections and inline status, not nested cards or a new dashboard.
- New source/helpers/tests use TypeScript. No new mjs/mts implementation files.

## User flows

### Repository → Skills

For a single repository, open **Assigned skills** first. Show the current skills, source, concise file scope, and existing removal action. An expandable **File scope** editor retains CAS and explicitly reports saving/saved/error. An **Add skills** action switches the same dialog to the existing library picker. Scope drafts and their original CAS tokens stay in the stable dialog owner: Add/Back retains them without a discard confirmation. Disable view switching during nested saves and assignment submission. Close and removal retain the existing destructive-discard protections. Successful Add returns to or refreshes Assigned with visible confirmation, without clearing another row's scope draft.

Git sources remain in the assigned view under a plain **Skills from this repository** section. Label the existing immediate persistence clearly and show saving/saved/error feedback. Do not place Git controls inside the Add flow. The Add flow has one primary action, **Add N skills**, with its optional default scope collapsed. Multiple-repository management keeps the existing Add/Remove delta flow.

A compact compatibility sentence is visible before saving assignments or Git source choices. Ready means only **Configured runtime supports Skills**. Blocked/unknown states explain the relevant setup action through existing configuration destinations. Bulk views summarize counts and disclose repository names/reasons on demand. Saving configuration remains allowed, with a clear notice when a review cannot yet consume it. Readiness is advisory; runtime admission remains authoritative.

### Library → known skill → repositories

Keep one repository picker, explicit Add/Remove mode, and one mode-specific primary **Assign to N repositories** or **Remove from N repositories** action. Apply the already known skill ID directly through the existing assignment command. Preserve add/remove delta semantics, uncertain-response retry locking, repository authorization, inactive-target cleanup, and existing bindings/scopes. Unavailable skills or any selected inactive target permit removal only. Keep selected IDs across pages/search; above 1,000 targets retain the selection and explain the limit without submission or truncation. Pending or unknown completion locks target selection/mode/scope; retry uses the identical submitted command even if readiness/counts refresh. No second skill-selection dialog or generic operation framework.

After accepting/linking a shared skill, report **Added to this library. Choose repositories to use it.** Offer **Assign to repositories** using the same picker; close the shared dialog before opening it and place focus predictably. Continuing to add other shared skills remains possible. Do not imply library membership alone enables reviews.

### Editor → import/export

Keep import/export in the existing editor; add no required form field. A feature-local pure helper owns portable parsing/serialization and bounded validation.

- Parse bounded YAML safely before modifying a draft. Reject unsupported executable/unknown fields, custom tags, aliases/merges, and unsupported document structure with concise inline messages.
- Known optional `license`, `compatibility`, and `metadata` fields are not persisted by this product. Show the actual omitted fields and a single explicit **Import text only** acknowledgment. Never silently drop them.
- Use one bounded resource eligibility check for import and portable export. Recognized actual references are Markdown links/images, used reference definitions, and HTML `href`/`src` with relative/local destinations. Ignore fenced, indented and inline code examples, unused definitions, anchors, remote URLs, and arbitrary prose/shell snippets. Document this finite grammar; do not promise general dependency detection. Reject recognized companion resources on import before draft changes. Manually typed references remain recoverable as **Download draft**, with an explanation that companion files are not included. Suggest Git only for its existing supported Markdown-reference subset, not arbitrary assets, HTML resources or executables.
- Invalid input or cancel leaves the draft untouched. Replacing a changed draft requires one explicit replacement action, combined with the omission acknowledgment if both apply. Preserve pending-operation guards.
- Keep app-valid import separate from portable-export eligibility. Legacy ReviewRouter human/Unicode names and blank descriptions remain accepted under existing app limits, without silently rewriting draft/saved fields. Only export derives a deterministic lowercase ASCII slug, collapsing repeated hyphens and trimming edge hyphens after truncation to 64 characters, with stable `review-skill` fallback. Show the matching suggested folder and tell users to place SKILL.md there. Blank descriptions get a visible deterministic title-derived export description; do not invent additional semantics.
- Export the visible instruction body byte for byte, including the 32 KiB boundary, without rewriting Markdown or adding a trailing newline. Only the disclosed frontmatter conversion is intentional. Label incomplete/invalid/non-self-contained content **Download draft** rather than presenting it as a valid text-only portable skill. Keep recovery available; reject malformed/oversized import before modifying any field.
- Field errors are associated with their controls. Do not turn the editor into a schema or dependency manager.

## Architecture and backend

### Assigned skills read

Extend existing `listAssignmentChoices` with an optional `assignedOnly` input (default false). When true, derive metadata from the exact existing bindings, including redacted unavailable entries, and skip the unassigned library candidate query. Keep pagination/search behavior and repository management authorization. Include the flag in the feature query key. Never fetch an entire library in the browser or issue one metadata request per binding.

### Readiness from the existing selection rules

Extract the narrow pure runtime profile selection branch currently owned by `apps/api/src/review-run-runtime-snapshot.ts` into the existing review-run-control domain. Both admission/snapshot and the web reader use it. Preserve explicit selection, default selection, direct OpenRouter capability, OCR preference, ambiguity rejection, and supplied-diff restrictions exactly; `provider_api` alone is not a capability proof.

The shared implicit-settings helper consumes the raw `REVIEW_ROUTER_AGENT_PROFILE`, preserving absence versus an explicit override; do not use its defaulted `loadRuntimeEnv()` value. Keep narrow facts in the domain rather than importing ReviewConfiguration. Web/API readiness assumes the same deployment selection authority and attestations: preserve them in shared composition, add a small parity check to the existing deployment convergence qualification, and cover absent, explicit default/supporting/non-supporting, and malformed overrides. No new endpoint, persisted capability or authority version.

The web composition owns a new batched reader; the review-skills domain does not depend on review-config, workflow provisioning, or release authority. Read local effective saved policies, installed workflow requirements, configured release attestations, and the relevant ProducerRelease rows. Reuse `ConfiguredProducerReleaseAttestationRegistry` with a map-backed query port. A configured valid release may be materializable before its DB row exists; do not classify that as unsupported. Revoked/mismatched/malformed authority cannot produce ready.

There is no exact next producer SHA stored for a repository. Never infer support from the latest row or any one supporting release. Evaluate a nonempty configured candidate set against independently compiled supported schema/canonicalizer pairs before registry/DB consistency and profile selection. Never feed a candidate's own digests back as the expected support proof. Do not discard invalid, mismatched, missing-profile or ambiguous candidates and advertise ready from a happy subset; document any irrelevant exclusion. Ready requires the saved seam plus compatible selections across all relevant candidates. Homogeneous conclusive incompatibility may be blocked; mixed, missing or ambiguous evidence is unknown. Document the existing repository override invariant: it cannot change skill capability on the same immutable producer.

Return only safe repository ID/name, status (`ready`, `blocked`, `unknown`), and a closed reason (`supported`, `unsupported_workflow`, `engine_unsupported`, `engine_unavailable`, `configuration_required`, `configuration_resave_required`, `workflow_update_required`, `workflow_unconfirmed`, `runtime_unconfirmed`). Do not expose credentials, provider identifiers, release registry payloads, or raw configuration.

Enrich successful web action results **after existing service authorization**:

- `listAssignmentChoices`: readiness for the exact authorized repository IDs.
- `loadRepositorySkillSettings`: that repository's readiness.
- `listSkillRepositoryTargets`: readiness for returned authorized `page.items` IDs only, never internal candidate IDs/cursors, allowing the direct known-skill picker to explain its targets without a second generic query. Preserve sparse/empty pages with a next cursor after SCM filtering.

Use web response types for enrichment; keep the domain service DTOs independent. Selected target status may be retained with the existing selection draft across pages, not copied into another server cache. Git-source mutation success must not overwrite enriched settings with a domain-only response: merge the changed settings while retaining the current advisory field and invalidate/refetch the exact enriched query, or enrich the web mutation consistently. A reader failure gives unknown, never a false ready or an unusable library. No additional live SCM permission calls beyond the existing command/query checks.

## Runtime output and diagnostics

### Truthful Skills receipt

Add a small runtime-local collector outside captured/materialized serialization and cache identity. Preparation/materialization happen before cache lookup and do not prove inference. Record only successful executions with a proven fresh model-request witness, keyed by provider invocation key plus returned payload hash; intersect with the accepted evidence supplied to the final projection builder. Native supply uses the actual prompt paths, separately from coverage completeness. Managed OCR requires a finite positive per-execution bridge request-count delta around actual process dispatch; a cumulative earlier request or undefined counter is not proof. An authoritative investigation execute can restore/replay without any new turn: use a narrow actual successful-turn observer only if its contribution to the same terminal payload is provable, otherwise report fresh supply unconfirmed. Do not add persisted provenance, a new state machine, or contract. Failed, superseded, unselected, shadow-only and prepare-only work must not contribute a fresh-supply claim.

Use one collapsed **Review skills** block below the existing summary content. Web entries are aggregate counts only; no names, skill/revision/workspace IDs, source workspace labels, descriptions, or instruction text. Git skill paths come only from the reviewed repository at the trusted base. Display the captured/materialized digests and trusted base as secondary details. Distinguish:

- no changed paths matched;
- matching paths have no accepted review evidence;
- accepted evidence is available, but fresh instruction supply is unconfirmed (say reused only when positive cache/restoration evidence establishes reuse);
- instructions were supplied with accepted review evidence from this run.

Never claim the model obeyed, verified, or applied instructions. Retain the existing incomplete-review status. Supply and coverage completeness are separate facts: native may receive instructions for a summary-only path; an OCR preview/unavailable path does not establish that those instructions reached a main request. Prefer conservative aggregate supply wording when per-path delivery cannot be established. Do not change existing engine acceptance semantics to implement the receipt.

Keep missing/empty/loaded Git root diagnostics as a sibling local materialization result, outside the hashed bundle. Expose them only after complete successful materialization. Existing materialization callers can retain their current execution-input return shape through a narrow compatibility wrapper.

Render the bounded block into `publishing.summary.body` and `publishing.check.summary` **before** canonical projection/operations/artifact hashing in `CurrentReviewProjectionBuilderAdapter`. Keep existing lifecycle/finding policies intact. Escape all displayed paths/mentions; cap path and row sizes and report omitted counts. Check each summary's UTF-8 field limit as well as the final canonical projection and operations byte limits. Try the full block, then a compact static **Review skills receipt unavailable: publication limits.** If even that cannot fit, retain the valid original envelope and emit the same closed notice in the Actions summary/log. Do not slice core output/structural Markdown or fail an otherwise valid review solely for optional details. Preserve exact old output for absent callback, legacy input, and a captured-empty set with no configured sources.

### Actionable Git errors on the actual failure route

Add a typed feature error with a closed code, trusted base SHA, bounded repository-relative source path, closed field selector, optional referenced path, and static remediation. Keep the Error message as a closed code. Do not expose YAML values/bodies, Git stderr, raw causes, stacks, credentials, or arbitrary exception messages.

Attribute invalid name/description/body/frontmatter, missing or invalid references, traversal/cycle/depth, nonregular files, size limits, source read failures, and fatal UTF-8 decoding at each parser/blob boundary. Split combined validation branches only where needed for attribution.

Handle this error before generic classification in `src/codex-oauth/action.ts`. Render safe diagnostics into the **actual Actions step summary/failure report**. The default Account Gateway route does not have a PR terminal reporter; do not claim that it does or add a new token/publication auth path. Existing injected terminal reporters may use the same safe report. Public success receipts continue through the canonical App publication path.

## Ownership and sequence

1. Three fresh critics review this plan independently: architecture/authorization, simple UX/portability, and runtime truthfulness/privacy/qualification. Record findings and revise before implementation.
2. Root publishes the reviewed plan checkpoint immediately. Root owns commits/push, PRs, integration, portable editor helper, and browser qualification.
3. Backend implementer owns shared selection extraction, readiness composition/response enrichment, assignedOnly query and focused tests.
4. Frontend implementer owns repository/library/shared-link flows, readiness display, query keys and direct assignment semantics. Coordinate response type ownership; do not edit root-owned editor files.
5. Runtime implementer owns local receipt, typed Git errors, production wiring, focused tests and docs. Coordinate heavy builds/OCR with root to avoid shared-host pressure.
6. Run focused source tests and independent code review, fix actionable findings, then publish coherent implementation checkpoints immediately. Every commit is pushed in the same operation sequence.
7. Open ready PRs in both repositories with concrete behavior, limits and evidence. No runtime contract change requires a schema rollout; the PRs can merge independently after their checks. If new paired qualification is needed, pin only an exact verified runtime revision through the existing gate; do not move release tags.
8. Qualify the final published heads, handle CI/review findings, merge only with required checks green, and verify resulting main revisions and post-merge checks.

## Validation and acceptance

### Focused automated evidence

- Shared selector parity and fail-closed ambiguity; effective inheritance/resave/workflow mismatch; all-candidate authority handling including valid missing DB rows; exact repository authorization before readiness; no additional SCM calls or identifier leakage.
- Real PostgreSQL tests for assigned skills beyond the first library page, search/pagination, unavailable cleanup, foreign repository isolation, and app reader data shaping where useful.
- Direct assignment add/remove, uncertain-response retry, inactive cleanup, shared-link handoff, scope draft retention, and distinct persistence feedback.
- Portable parser: metadata acknowledgment/cancel, resource/execution rejection, safe URL/code acceptance, malicious YAML, Unicode/legacy names, deterministic valid export, empty description hint, exact body preservation, and draft recovery.
- Runtime: accepted fresh native/OCR/investigation evidence, cache/replay/prepare-only paths, unaccepted failures, privacy sentinels, no-match vs incomplete, missing/empty Git roots, hostile path rendering, canonical hash sensitivity, output limits, and unchanged legacy/empty output.
- Action mode tests prove a typed materialization error survives the real classifier into its actual terminal summary.

### End-to-end and visual qualification

- Use the existing actual Next.js + PostgreSQL + isolated GitHub App HTTP fixture harness; no browser-only mocked replacement for product flows. Fresh owned PG17 cluster and schema migrations, final exact published head and clean tracked tree. Preserve the previous run directories.
- Extend the Skills browser suite for assigned-first view, add/back/remove, scopes and saving feedback, direct known-skill assignment, shared handoff, readiness states, import acknowledgment/recovery/export, revoked/unavailable content, keyboard focus and closing guards.
- Inspect screenshots at desktop and narrow mobile widths, including long names, empty states, expanded scopes, readiness explanations and import errors. Fix clipping, overflow, obscured actions, stacked frames, confusing persistence or unnecessary steps. Browser automation alone is not visual approval.
- Run the real managed OCR CLI suite with `REVIEWROUTER_OCR_REQUIRED=1` and a manifest-qualified binary. Exercise real model-request fixtures through the receipt and final production projection; cache replay must not claim fresh supply. Retain actual native invocation and terminal publication seam tests. Do not describe HTTP fixture proof as a live hosted GitHub review.
- Run relevant type/lint/architecture checks. Runtime source changes require the normal build and tracked generated dist. Do not broaden tests after sufficient verification unless a concrete risk or required gate remains.
- Record exact head, commands, pass/fail/skip counts, screenshots, independent review decisions and CI links in PR evidence. No fabricated or manually satisfied statuses.

### Operational discipline

Other tasks share the host. Record only this task's service PIDs, command lines, working directories and ports. Stop only processes whose identity/ownership has been verified. Do not kill global node/tsc/browser processes or wipe prior evidence. Use `tmp/` for disposable tooling and screenshots. No credentials in logs or report artifacts.

## Completion record

### Independent plan review

- Architecture critic: GO after raw implicit-selection/web-API parity and independently compiled contract support are explicit. Authorized target enrichment uses returned rows only.
- UX/portability critic: GO after five corrections: shared import/export resource eligibility, legacy blank-description/name compatibility, readiness retention on Git save, stable scope/CAS draft ownership, and full direct-picker retry/limit protections.
- Runtime critic: GO after fresh supply is witnessed per execution, missing evidence is unconfirmed rather than inferred reuse, and per-field plus aggregate byte fallback is explicit. Investigation restore and OCR cumulative counters are specifically covered.

### Implementation/source review checkpoint

- Assigned-first repository management, direct known-skill assignment, shared-link continuation, compact readiness, and explicit save feedback are implemented using the existing commands and permissions.
- Portable import/export preserves legacy app content, acknowledges omitted metadata, distinguishes text-only export from draft recovery, and retains visible Markdown bytes. Independent criticism found ordinary Markdown indentation/whitespace edge cases; targeted fixes and regression cases resolved them.
- Shared raw runtime selection, conservative compiled-contract authority checks, and authorized batched readiness enrichment are implemented. The source critic required the existing RepeatableRead policy-head wrapper; that correction is applied.
- Runtime source review approved the actual-request/accepted-evidence receipt, conservative unconfirmed investigation provenance, safe pre-hash byte fallback, and typed Actions failure diagnostics. No protocol/cache identity change is required.
- Completed local evidence so far: control-plane selector/API/readiness/enrichment/composition 51 tests, real PostgreSQL Skills 14 tests, and final portable/readiness/authorization recheck 64 tests. Web typecheck passed. The real manifest-qualified OCR lane passed 11 CLI cases without skips, with receipt and error suites also passing. Later runtime counter refinements still require the coordinated final rerun/build.
- The existing case-distinct OCR fixture remains an engine transport proof. A second real invocation with a case-unique inventory is used for canonical publication because the existing projection rejects case-fold duplicates. No unrelated path-normalization policy was changed.

### Review corrections and integration

- Actual desktop/mobile inspection led to shorter readiness labels in repository rows, an explicit disabled **Added** state after linking, and an import-error prefix that confirms the current draft is unchanged. Full readiness explanations remain in the selected-repository summary. Repository names wrap at natural word boundaries.
- External review identified multiline Markdown labels, known context-tools incompatibility, invalid raw deployment settings, and a generated Next.js type-path change. Multiline inline/full/collapsed/shortcut references now use one bounded soft-line-break grammar; configured tools require an OCR profile and the existing producer capability; invalid profile references fail before hosted API requests; the generated type import is restored. Assignment continuation pages also avoid repeating unused readiness queries.
- The corrected portable suite passed 63 tests. Readiness/enrichment/authorization/selector checks passed 31 tests, and the full deployment contract file passed 92 tests. Web, API, and harness typechecks passed before these focused review corrections; final CI is recorded in PR #704. Skills architecture passed 82 shared cases and its rejecting mutation, and the main architecture scan passed 604 domain/application files.
- A fresh PG17 browser run on `292697e4` applied all 149 migrations and verified the new flows. It exposed two stale expected UI strings; those assertions were updated without weakening their persistence, privacy, size, or layout checks. The complete rerun after all review corrections is recorded in PR #704, including any failures rather than treating this earlier partial run as qualification.
- Runtime main advanced to `fb13bd1` while this work was in progress. Integration had no source overlap; all 15 Skills source/test/doc files remained byte-identical. The final normal build regenerated the Action and plan artifacts. To avoid duplicated debug-source text, `build:action:main` omits only source-map `sourcesContent`: executable JavaScript and all other map metadata are verified identical, while the map decreased from 16,659,681 to 4,846,381 bytes. The README documents the matching-checkout/dependencies requirement for original-source viewing.
- Runtime qualification passed 203 focused cases and all 11 required actual OCR CLI cases with the manifest-qualified binary, without unfiltered skips. After main integration, typecheck, the normal build, and 60 receipt/projection/Action-handler cases passed again. All published blobs were checked against their local Git object hashes.

The linked PRs carry the final exact revision and browser/visual evidence, review replies, required-check results, and merge commits. Source/unit success alone is not final merge qualification; production release-tag promotion remains a separate operation.
