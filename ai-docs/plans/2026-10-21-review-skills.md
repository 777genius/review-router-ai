# Review Skills — implementation plan and delivery log

Status: initial draft; implementation starts after three sequential multi-direction plan reviews.
Owner: this isolated Review Skills delivery. Date: 2026-10-21.

## Authorized product scope

- Workspace Skills library, three-field Markdown editor, and a Skills navigation section immediately before Memory.
- Author-only content editing; source workspace custody and explicit direct grants to destination workspaces.
- Live canonical links across workspaces, never independently editable copies.
- Repository bulk Add/Remove operations as deltas, mixed assignment counts, and explicit selection of all current search matches.
- Automatic immutable revisions on Save; captured instructions and assignments for each admitted review; new runs use current versions.
- Mandatory managed OCR integration and the same engine-neutral input contract for the native reviewer.
- Standard SKILL.md text and bounded Markdown references; Git-managed sources remain governed by Git permissions.
- Detailed SOLID/Clean Architecture/DRY design within accepted feature-first DDD (ADR-005).
- Use applicable Get Modular and Engineering Foundation capabilities without migrating unrelated hosts or creating an executable plugin framework.
- Real persistence, authorization, runtime, and browser E2E verification; incremental commits and draft PRs.

## Current source baseline

- SaaS/control plane: 777genius/review-router-ai @ bb277462bed5135a838b20d07eeae69034562bd8.
- Public runtime: 777genius/review-router @ 9e494fb9b8809dc5c91c9f4159edcca13b89fbde.
- Separate branch/worktrees: feat/review-skills-20261021.
- OCR integration is merged in both repositories. The controlled-rule JSON builder still requires exact-parser qualification and correction.

## Delivery sequence

1. Audit accepted architecture, module tooling, data custody, admission, runtime, repository selection, and existing browser fixtures.
2. Expand this document into exact contracts, migration strategy, ownership, UX semantics, implementation steps, and acceptance checks.
3. Run three sequential rounds of independent architecture/runtime/UX-and-authorization critics; resolve each substantive finding before implementation.
4. Implement the feature-owned domain/application/persistence and Get Modular host composition; preserve authorization and existing run compatibility.
5. Implement captured engine-neutral skills transport and both runtime projections; qualify the pinned OCR parser and prompts.
6. Implement the actual Skills frontend and bulk/shared workflows, then verify persistence and permission failures in the browser.
7. Run focused integration and E2E gates, independent implementation review, correct findings, and push evidence/status.

## Working evidence

No implementation or verification success is claimed by this initial checkpoint. The detailed plan, review logs, commits, and test evidence will be appended as work progresses. Production rollout and stable release-tag movement are separate from this implementation PR.
