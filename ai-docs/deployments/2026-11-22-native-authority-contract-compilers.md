# Native authority contract compilers

- Task ID: `2026-11-22-native-authority-contract-compilers`.
- Goal: select the existing isolated TypeScript 7.0.2 compiler for eight authority,
  evidence, investigation, snapshot, publishing and action-control packages.
- Affected targets: build/CI artifacts consumed by API and worker.
- Implementation PR: pending.
- Implementation reference: pending; isolated stack on foundation
  [#971](https://github.com/777genius/review-router-ai/pull/971) exact head
  `84bad00de58eee29d59e485c1863f18e3867ec09`; merge that prerequisite first.
- Dependencies: unchanged native preparation, shared and foundation outputs.
  Shared #967 and logger/root #969 remain independently tracked. Their branches,
  provider #959, and their CI queues are not modified by this patch.
- Last updated: `2026-11-22`.

## Environment status

| Target     | Status    | Actual version | Evidence / next step                                                 |
| ---------- | --------- | -------------- | -------------------------------------------------------------------- |
| CI         | `pending` | Not verified   | Independent review, prerequisite merge and required final-commit CI. |
| staging    | `pending` | Not verified   | Include in a later authorized coherent build.                        |
| production | `pending` | Not verified   | Include in a later authorized coherent build.                        |

## Applicability and prerequisites

The eight manifests change 23 compiler-selection fields, preserving configs,
exports, flags and coverage. Two explicit return annotations preserve the original
TS6 concrete-class API for missing policy/control branches in the in-memory
run-control store. Native inference had dropped readonly; the comparison rejected
that difference, and its readonly check remains strict. Runtime bodies are unchanged.

Classic API consumers remain: Next, ESLint, own architecture/layout/memory AST
utilities, analysis/transpilation tests, and Prettier 3.8.3's embedded TypeScript
5.9 parser. The owner's explicit migration exception permits bounded TS6.0.3
baseline/API and pinned formatter checks. This is not a full TS7-only migration.

## Ordered rollout

1. Finish local qualification and independent review; merge foundation #971 first.
2. Reconcile this stack onto the resulting main and pass required exact-commit CI.
3. Include in a later authorized batch following the
   [release process](../operations/07-environments-and-release-management.md).
4. Record actual image/source and verification for each environment.

No migration, runtime configuration, flag or separate activation is needed.
This record does not authorize deployment.

## Verification and completion

CI-pinned Node 26.11.1 qualified all 23 native routes and 15 emitting projects.
854 output comparisons passed: 427 byte-identical JavaScript files and 427
complete equivalent declaration surfaces; no maps are emitted by these configs.
The original pre-annotation TS6 normal-build output is retained as the run-control
baseline. Literal values, readonly, tuples and overloads remain comparison inputs;
only the already reviewed foundation canonicalization rules apply.

320 focused fixture cases passed, one existing case was skipped, and both
API/worker native typechecks passed. Hash-bound unchanged shared/foundation
outputs (250 files at the exact stack base) were reused instead of recompiled.
Initial failures, source annotation provenance, formatter parser fingerprint,
commands and comparison matrices remain in the isolated worktree's
`tmp/native-authority-qualification/` and managed job custody.

Both compilers checked native emitted declarations with `skipLibCheck: false`.
An original-source snapshot independently reproduced all 132 frozen run-control
baseline files byte-for-byte. Targeted pinned ESLint and formatting passed.
After the existing root ESM import rewrite, 29 declared production target files
from seven packages imported successfully; the emitted action-domain audience,
schema rejection and trusted-workflow boundary checks also passed. These are
file-target imports, not qualification of every package export selector.

Initial direct imports required the normal root import rewrite and missing scratch
runtime dependency outputs. Their native builds used unchanged configs and are
retained as prerequisites, not additional migrated routes. The full action-control
production barrel reaches review-config/provider-accounts/auth; that wider runtime
closure was deliberately not expanded into a whole-application build.
Full current provider composition, whole-workspace CI and complete Next production
build remain unverified. See the
[qualification procedure](../../scripts/local-checks/native-cli-batch-qualification.md).

## Retry, partial completion, and rollback

Inspect exact flags, dependency prerequisites and diagnostics before retrying;
reuse successful hash-bound phases. Do not weaken flags or declarations, ignore
maps, or silently fall back to classic. If a regression is confirmed, revert this
cohort's compiler fields and type-only annotations together; rebuild normally.
No data rollback is involved. Preserve unrelated queued checks.

## Execution log

Local qualification completed; independent review and final-commit CI pending.
No merge, release or deployment performed.
