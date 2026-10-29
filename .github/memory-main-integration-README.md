# PR #734: published integration recovery

The previously local integration patch is now preserved in GitHub, before further qualification. This temporary branch is not a production change and must not be merged into main. Its helper files must not enter the feature tree.

Exact feature parent: `f599ad10844ac2891eadea042c4f7c57788fecd2`.
Exact main parent: `78434bee6344ff497e0791140887ea9522d94ef6`.
Audited merge tree: `ada0c65de2bc407d683cee56684c20997c49ffe6`.
[Audit run](https://github.com/777genius/review-router-ai/actions/runs/40895116603).

The XZ file contains the complete UTF-8 unified patch for the 28 prepared paths; it contains no credentials or executable binary. Its compressed SHA-256 is `602e588c9c43ca70fd6a0ead120070ddaafcff58263bf2cd30d65affacb868a1`; uncompressed patch SHA-256 is `a75a8858a08b303503fefcabcbb00f894cb721d17f5a72c78f1d93477041b49a`. The companion manifest records all before/after Git blob hashes, exact parents and expected conflicts. Decode with `xz -dc .github/memory-main-integration.patch.xz` for human review.

The patch preserves published Gateway migration 152, renames only the pending memory migrations to 153/154 without changing SQL, retains main and memory catalog assertions, shares primary-account selection between conversation capture and publication, and updates the existing deployment task and index. Generated conflict-runtime must be rebuilt by the existing pinned builder, never selected from one conflict side.

Already obtained locally: 9/9 supplemental checks, exact input/output hashes and relative-link validation. Not yet established for this integration: the repository-pinned full typecheck/build, normal required CI, actual PostgreSQL/native/browser E2E and live model/deployment qualification. Do not relabel historical evidence as a pass for the new tree. Source-authority limitations and pending environment status remain.

Publication through the authorized GitHub connector does not establish local gh authentication. The current local container has no gh executable and cannot resolve github.com; no device authorization code has been issued from it.
