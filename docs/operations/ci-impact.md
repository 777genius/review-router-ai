# CI impact tiers

Normal pull requests run a conservative change-based subset of the core CI. The `CI impact selection` job computes a complete, NUL-delimited Git diff against the current PR merge commit (not GitHub's limited changed-file API). Unavailable ancestry, unknown paths, executable scripts, toolchains, workflow edits, or mixed backend changes fall back to `full`.

**`docs`:** Markdown/text/images in `docs/` or `ai-docs/`, or named root documents. Runs Static Checks, CI impact and Quality Gates.

**`ui`:** The above plus visual `.tsx`, CSS or image files in `apps/web/` or `packages/ui/`; server/API/auth paths excluded. Runs Static Checks, Quality Checks, CI impact and Quality Gates.

**`full`:** Everything else. Runs all existing core jobs, including PostgreSQL 17, certification, runtime image and Self-hosted E2E.

Draft PRs retain their current skip policy. Workflow dispatch and every push to `main` always use `full`; this preserves the exact-source CI/release evidence required by the public Action sync and GitLab runtime image workflows. Separately path-scoped UI/OCR/Memory/Skills workflows keep their own triggers.

The `Quality Gates` check **fails closed** if impact selection fails, returns an unexpected tier, or any required lane fails/is skipped unexpectedly. Job-level `if:` clauses are used instead of workflow-level `paths` filters, so required check names remain present. No feature flags, production changes, policy bypasses or test-result reuse are introduced.

Quick validation: `node --test scripts/ci-impact.test.mjs`; workflow changes themselves select `full` on their PR. To obtain a complete pre-merge qualification for a UI/docs-only change, use `workflow_dispatch` against a reviewed commit; merge builds still run the complete matrix.

Measured reference: core CI on PR #831 consumed ~77 runner-minutes (including ~14 minutes of Self-hosted E2E and ~19 minutes of PostgreSQL recovery lanes). The lightweight `docs` and `ui` paths avoid these heavy lanes; wall-clock and total savings depend on independent workflows, cache state, and runner queue.
