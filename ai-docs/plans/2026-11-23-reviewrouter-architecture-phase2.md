# ReviewRouter architecture hardening — Phase II

Date: 2026-11-23 (Europe/Chisinau)
Baseline main: 06aae0faf17687e52b9d0be63717c8ccc16d1458
Working branch: refactor/architecture-boundaries-phase2-20261123
Status: priority expansion published; scoped local qualification passed; whole-PR release acceptance remains pending
Authority: AGENTS.md, Engineering Quality Standard, Feature Module Standard adopted profiles, current security/runtime protocols.

## Correctness follow-through and E2E — 2026-11-24

The owner increased the target to at least 30,000 total Git changed lines and
requested repeated correctness review plus completion of the affected E2E.
Continue to publish each qualified slice immediately, retain Draft status and
do not wait for hosted CI. Volume is a reporting threshold, not justification
for unrelated edits. Preserve all deployment and merge boundaries below.

Review now includes ordinary failure scenarios and independent behavioral
oracles, beyond checking that extraction preserved existing function bodies.
The first new confirmed finding was replay ordering: grouping all reads of a
file together reordered an authenticated A/B/A source sequence, while repeated
complete paged queries collapsed into one operation. The host planner now uses
the domain-owned chronological receipt selection and preserves repeated query
starts. A selected page chain interleaved with another selected operation is
declined because the existing whole-query plan cannot represent that tape.
The positional domain comparison, signed preimages and protocol stay intact.

Five focused tests failed on the previous implementation for the intended
ordering reasons; the repaired focused suites passed 19/19. The wider affected
context/API consumer suites passed 79/79 without skips, including the existing
signed gateway, replay, AEAD and cancellation coverage. Both original strict
context and API projects passed on TypeScript 7.0.2. Further checker findings,
lease deadline/revocation races, independent review and the current local
production/paired Action E2E are tracked as ongoing work, not completed gates.

## Priority expansion — 2026-11-24

The owner requested at least 25,000 total changed lines in this existing PR,
prioritized by correctness and maintainability, with parallel implementation,
independent review and immediate publication of each locally qualified commit.
The PR returned to Draft at the owner's request. Do not wait for CI between
slices; deferred or skipped CI is not successful qualification. Deployment and
merge are not part of this expansion request.

Published starting point: `4964066ec8e9fb45dab47ef3aa5cdb9e9207471c`,
12,878 additions and 1,819 deletions. Integrate actual main
`18c57630b69334c9bfc071dc2500a952edc66f7a` without replacing source history.
Preserve its progress-publication, dispatch preparation and Gateway recovery
fixes. The only source merge conflict is the CI-impact fixture: retain the
PR's exact runner expression, which is stricter than main's substring checks.
The resulting unchanged-scope fixture passed all 40 existing cases on Node
24.22.3, with zero failures, skips or cancellations.

| Priority | Owner and change                                                                                                   | Estimated production scope             | Required invariant                                                                            |
| -------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------- | --------------------------------------------------------------------------------------------- |
| 1        | Review execution domain: separate preparation, lease, observation, finalization and terminal transitions           | About 1,900 existing lines reorganized | Exact public decisions, validation order, replay identity, lease fences and immutable updates |
| 2        | Context attestation API host: separate lease admission, gateway lifecycle, replay authority, validation and crypto | About 3,000 existing lines reorganized | Exact signed preimages, clock reads, status/error mapping and authorization before effects    |
| 3        | Architecture checker: typed inventory and owner-specific policies behind the existing CLI                          | About 1,200 existing lines migrated    | Same governed roots, negative fixtures, diagnostic order and rejection behavior               |

Keep cross-feature orchestration at the API host. Do not move concrete crypto,
protocol or persistence dependencies into strict feature domain/application
layers. Similar authorization helpers intentionally have different error
contracts; do not unify them by syntax alone. No new framework, runtime,
generic service container or provider implementation is needed.

Use two review rounds: first source/body/export/dependency review, then an
independent review against the actual integrated tree and executed regressions.
Run the existing native TypeScript 7.0.2 strict projects, owning behavioral
suites and affected architecture fixtures. Use real PostgreSQL checks for
transaction/recovery coverage when available. Report exact results and remaining
graph/browser limits without reusing historical passes as new evidence.

Complexity 6/10; regression risk before qualification 5/10; achievable confidence
after the scoped checks 8/10. These are planning judgments, not guarantees.
Count Git additions plus deletions for the requested PR total, but also report
relocated production lines once, new semantic changes, tests and documentation
separately. Existing main changes and generated/lockfile churn do not count as
new substantive refactoring work. The missing published Stack lint dependency
remains a separately identified baseline gap until its owning release and
ordinary dependency installation are verified.

### Published expansion result

Source HEAD `a5ed3e93072002efc04b1581a991d0b798065b46` includes three
independently reviewed refactoring commits after the main integration:

| Slice                                              | Commit     | Additions / deletions | Changed lines |
| -------------------------------------------------- | ---------- | --------------------- | ------------- |
| Execution transitions                              | `69be662c` | +2,056 / -1,908       | 3,964         |
| Context attestation host                           | `52a61f5c` | +4,012 / -3,729       | 7,741         |
| Typed architectural policies and strict enrollment | `a5ed3e93` | +1,393 / -1,190       | 2,583         |
| **New source batch**                               | 25 files   | **+7,461 / -6,827**   | **14,288**    |

The whole PR at that source checkpoint has **28,353 changed lines in 204 files**
against main `18c57630` (+20,018 / -8,335, normal rename detection). The three
original source files contained 6,969 lines; this is reorganized source scope,
not new implementation. Net source growth is 634 lines. No new package,
dependency, lockfile, protocol, database migration or feature flag was added.

The existing suites passed **450/450 tests without skips**: execution 134,
context/consumer 101, architecture 102, CI routing 40, Fastify transport 28 and
real PostgreSQL execution/recovery 45. The original complete execution, API and
tooling strict projects passed with TypeScript 7.0.2. Two independent source
reviews preserved all 69 execution and 107 context declarations and their
44/18 public exports, with acyclic ownership graphs and no confirmed defect.
The complete `pnpm architecture:check` also passed: 694 domain/application
files, zero Foundation diagnostics, 23 Memory and six Statistics workspace
cases, plus History and account-metadata gates. The old and new core checker
produce byte-identical diagnostics and exit status on the integrated source.

Actual PostgreSQL 17.12 qualification applied the maintained 165-migration full
catalog and the historical 82-migration provider fixture, including canonical
role handoff and verification. All ledger checksums match source; 261 captured
inputs stayed unchanged, and the owned database was stopped and removed.
The API dependency build passed 46/46 uncached tasks. A separately guarded
original API build and production-condition import proved nine emitted context
modules and declarations, seven runtime exports, 234 first-party dist modules
and zero source fallbacks. The initial Turbo run did not forward its preload;
it is build evidence, while the direct API build establishes guarded native emit.

The [scoped evidence summary](../deployments/evidence/2026-11-24-priority-refactor.json)
binds the source paths and local log hashes. These results do not relabel old
browser, whole-Web, bundled Action or hosted CI results as current. The verified
published Stack 0.3 adoption and ordinary whole-root lint remain separate from
this completed refactoring batch. Every commit was immediately published; the
PR stays Draft and no CI wait, merge or deployment was performed.

## Paired lifecycle and browser cleanup checkpoint — 2026-11-23

The complete maintained paired lifecycle ran on exact clean `6013a91a` and
Action `1112a0f1`: **25/25 passed**, with no failed, skipped or todo cases. The
maintained receipt checker also accepted all 25 cases. The run used PostgreSQL
17.12 with all 165 Prisma migration-ledger entries and the verified maintained
OCR `1.13.1-rr.6` release binary through all seven production routes. Controlled
providers and synthetic GitHub transport do not establish live external
publication. This qualifies the recorded paired execution, not the separate
OCR source rebuild or final-head browser gate. The
[paired receipt](../deployments/evidence/2026-11-23-architecture-phase2-paired-lifecycle.json)
preserves the recorded results and their evidence-availability limitation.

The ordinary [Statistics run 45255482669](https://github.com/777genius/review-router-ai/actions/runs/45255482669)
checked out exact `6013a91a`, passed frozen installation, required offline Prisma
generation, all 165 migrations and the full Web native typecheck. It completed
18 authenticated journey records and 21 screenshots, with no browser errors or
external requests. **The workflow failed** during cleanup because Next 16.4.6
also rewrites `root-params.d.ts`; the previous cleanup admitted only `routes.d.ts`.
Its final receipt assertion was skipped. The
[Statistics receipt](../deployments/evidence/2026-11-23-architecture-phase2-statistics-browser.json)
binds the recovered GitHub artifact and log to all 49 recorded source inputs.

The reconstructed cleanup helper admits only the two known imports from the
exact run-owned types directory, then requires the entire normalized file to
equal its baseline before writing. Both original caller bodies reproduce the
failure against the integrity-verified released Next writer. Both corrected
callers pass; additional-source controls still reject without overwriting.
All **13/13** helper cases pass, including CRLF, wrong-run and wrong-directory
controls. The helper and tests are enrolled in the original tooling project.
The complete original strict project passed in 9.373 seconds with its inherited
strict options unchanged. On reviewed hosted-runner routing revision v3,
all 40 unchanged CI-impact cases, 16 routing/cleanup cases and the complete
original tooling project passed again with 4,816 source inputs unchanged and no
legacy initialization. The subsequent v4 selector extension and final published
graph still require their combined root check; corrected browser execution also
remains pending. The
[Next receipt](../deployments/evidence/2026-11-23-architecture-phase2-native-next.json)
keeps these checks separate from the earlier failed production build attempts.

The restored ordinary frozen graph then completed the actual **whole `pnpm build`**:
56/56 tasks, zero cached tasks, all production Next phases, and 588 maintained
emitted-file rewrites. The 157.430-second execution used Node 26.11.1, native
TypeScript 7.0.2, Go2/2048MiB and serialized Turbo; all 4,815 captured source inputs
remained unchanged. It produced `BUILD_ID=AA-TcjEF_ASr0li-DgkYK`. This new pass does
not change the recorded result or cause attribution of the earlier SIGKILLs.

The original production HTTP smoke exposed a separate startup defect in this
executor: Next called the restricted network-interface enumeration without an
explicit hostname, and an unbounded readiness fetch could exceed the loop's
deadline. The localized existing-JavaScript correction passes the same loopback
host explicitly and gives each readiness fetch its remaining deadline. All
original page, discovery, structured-data and redirect assertions remain. The
complete maintained `pnpm web:smoke` passed against the actual build in 4.342 seconds
(12 pages and two redirects), with unchanged inputs, no legacy loads and its owned
server fully stopped. This is HTTP acceptance, not authenticated browser evidence.

The complete maintained Action check also passed again, including its original
native strict project, both source-generated bundle comparisons and the required
binary archive/manifest. All 4,816 source inputs and committed bundle bytes stayed
unchanged. Ordinary Self-hosted E2E job
[138022980855](https://github.com/777genius/review-router-ai/actions/runs/45255482350/job/138022980855)
independently completed its filtered production Docker build, network-isolated
Prisma and 17+2 actual database E2Es. Its checkout was merge `6aeb2203`, whose tree
equals `6013`, and its bootstrap retained one optional skipped control (36 passed).
Neither that skip, historical source tree nor partial native-memory scope is
represented as final-head or full browser acceptance.

The executor reset preceded the restored build, smoke and tooling checks above.
It removed the older local work and raw evidence; the fresh restored packets
remain available. The branch remains recoverable at `6013a91a`; recovered original
GitHub logs and artifacts match their recorded hashes. Historical local packets
that could not be recovered are identified as such, without fabricating their
contents or calling them new runs. The current full baseline frozen installation
passed with ordinary lifecycle scripts, unchanged 4,812 source inputs and no
legacy compiler/parser load. The remaining native Stack adoption continues
through the owning protected release and a new genuine frozen root graph.

The complete `pnpm modular:qualify` passed on exact clean `e5279c73`: the original strict project (`skipLibCheck:false`) and all seven composition suites, **25/25** with zero skips. The complete `pnpm foundation:qualify` then passed on that same clean tree: verified registry tarballs, strict packed Get Modular consumer, runtime/rejecting wiring, original tooling project and all seven actual workspace boundary cases. All 4,799 tracked file hashes remained unchanged during Foundation qualification. The ordinary Source and Certification Checks lane now explicitly invokes both the full native compiler pilot and Foundation consumer/boundary qualification; the compiler pilot's `.pilot.ts` file is not ordinary Vitest discovery.

Two complete `pnpm build` attempts on `e5279c73` failed at Web's unchanged native preflight with SIGKILL before Next started. The second serialized attempt measured the received Go1/512MiB limits and completed 55/56 package tasks, including API and worker emission. The maintained ESM rewrite and unchanged `pnpm runtime:smoke` subsequently passed on those real outputs against a fresh PostgreSQL 17.12 database with all 165 successful Prisma migration-ledger entries. The owned cluster was removed, and source/locks/tree stayed unchanged. This historical attempt establishes compiled API/worker runtime only; the later restored whole build and maintained HTTP smoke are recorded above, while full corrected browser acceptance remains pending. The [runtime and tooling receipt](../deployments/evidence/2026-11-23-architecture-phase2-runtime-tooling.json) preserves both failed builds alongside the bounded passes.

## Complete native lint and OCR acceptance gates — 2026-11-23

Actual main advanced to `e180f4a9` while the PR metadata still reported the older base. Direct Git refs and anonymous Git agreed on the new head. Main's #992 runner routes and #995 equivalent CI-test correction are preserved; the conflict resolution retains this branch's stricter exact impact-runner/fallback contract. All **40/40** CI routing tests pass after integration.

The reviewed native lint source now uses the public `stack-toolchain/eslint-syntax` adapter with the retained 20-rule independent oracle, original config scopes and explicit legacy-load guard. `pnpm lint:qualify` owns the original strict project and full fixture sequence, records JSON/TAP counts and source identities, checks the actually executed TEST copy, and writes success only after owned cleanup. The exact integrated source matches the independently reviewed candidate's **47/47** formatter/proof tests. The combined original tooling and lint-format strict projects pass; the complete guarded `pnpm format:check` also passes. **Full adapter qualification is still pending the actual qualified Stack 0.3.0 publication, its SRI and an ordinary regenerated/frozen lock.** The conditional pin has not been applied, and no unpublished preview is represented as a release.

Unified OCR acceptance now rejects partial skipped runs explicitly. The narrow typed receipt checker requires the 16 reviewed UI scenarios with passing raw results, no retries, exact source identity and a freshly migrated database, plus all 25 maintained paired lifecycle cases. Its **16/16** positive/rejecting synthetic receipt tests pass under the normal root test gate; source and tests are enrolled in the original strict tooling project. The UI workflow retains full history and the independent paired Action pin, binds its receipt to the candidate head, and keeps ordinary CI merge compatibility checks separate. These validator tests do not establish actual browser or paired lifecycle execution.

The [acceptance gate receipt](../deployments/evidence/2026-11-23-architecture-phase2-acceptance-gates.json) records the exact source delta, tests, strict projects, full format result and remaining package/browser/build limits. Ordinary CI now invokes the maintained native lint qualifier beside the complete compiler and Foundation qualifiers and guards lint, format, typecheck and build before any old compiler/parser initialization.

## Additional native policy parity and Skills qualification — 2026-11-23

Independent review reproduced native AST regressions in typed transaction aliases, default/rest/constructor parameters, named callback methods, ambient functions, overload declarations, annotated destructuring and parenthesized expressions. The corrected combined architecture/layout/import/Memory suites passed **135/135** with zero skips; the original strict tooling and modular projects both passed under native TypeScript 7.0.2. The full maintained `pnpm architecture:check` then passed, including all 688 domain/application files, Foundation, Memory/Statistics rejecting mutations and History/account metadata. All 4,800 tracked file hashes remained unchanged during those strict and architecture gates. The [native AST receipt](../deployments/evidence/2026-11-23-architecture-phase2-native-ast.json) binds these results to the exact reviewed source delta on `a8925fe7`, retaining the earlier RED evidence.

The legacy checker and CI contract test retain their existing `.mjs` entrypoints only for these localized parity corrections; migrating their complete bodies would materially expand the fix. The new fixtures and collectors are TypeScript in the original strict projects. This does not claim strict coverage of those legacy JavaScript files. The actual CI tests also passed **40/40** after correcting their obsolete hosted-only expectation to main #990's dedicated impact runner and exact fork/explicit-hosted fallbacks. No workflow routing was reverted or bypassed.

On exact clean `a8925fe7`, the complete Skills module and PostgreSQL qualification passed **139/139** module/PG cases plus **5/5** API cases, with zero skips. This included the real paired Action HTTP transport at immutable `1112a0f1`, a fresh PostgreSQL 17.12 cluster, all 165 maintained Prisma migrations, the real nested frozen installation, 82 shared FMS cases, a rejecting architecture mutation and the original native strict Skills project. Sources and locks stayed unchanged, and the owned cluster was removed. The [Skills receipt](../deployments/evidence/2026-11-23-architecture-phase2-skills.json) also records the independent functional source review. These are actual local module/PG/HTTP results; browser interaction and a complete paired Action build remain separate claims.

## Integrated continuation — 2026-11-23

The owner requested that remaining work be consolidated into existing Draft #977. Current main `014d708d` and the preserved source histories of #967, #972–#975, #978, #980 and #982–#986 are integrated. No additional PR or scheduled automation was created. Production rollout remains outside scope.

Two #982 defects were reproduced and corrected: `.js` imports resolve to their `.ts` source, and Oxc type imports use `TSImportType.source`. Thirteen independent import-reference cases are enrolled with the existing layout tests in the strict tooling project. The exact repaired bytes passed 109/109 tests and strict TypeScript 7.0.2 with pinned Oxfmt; that bounded run used Node 24.22.3. The #983 production-declaration loader and its independent fixtures resolve the overlap with #985 without changing recovery scenarios. The separate formatter qualifier retains its Oxc migration and now uses ordinary `.ts` with its current executable caller updated.

The unchanged #978 concurrent-claim oracle was independently requalified against main: 37/37 cases (13 actual PostgreSQL, 9 memory and 15 domain), no skips, native TypeScript 7.0.2, Node 26.11.1 and PostgreSQL 17.12. All 165 SQL migrations were applied to an isolated cluster for that bounded run; this is not a Prisma migration-ledger or whole-workspace frozen-install claim. Sequential order and concurrent exact-once, fencing and ownership assertions remain independent. Production SQL was not changed.

Published Foundation 3.1.0, FMS 0.3.2, Get Modular Core/Assembly 0.8.0, Conformance 0.5.2 and Resources 0.2.2 were verified against registry versions and integrity. The packed GM0.8 consumer passed strict native compilation, invalid wiring before I/O and owned cleanup. Historical SDK Foundation 1.6.0 and GM0.2 inputs remain unchanged.

The local executor reset during full workspace installation. The integration was reconstructed from the original remote commits and retained Git blob hashes; recovered source fixes and dependency files match their previously verified bytes. Both lockfiles were regenerated by their declared package managers: pnpm 11.28.7 at the root and 11.25.0 for review-skills tooling. Their Git blob hashes exactly reproduce the earlier generated files: `34fa6f8859e2c78f9bb3c4de9a7c06257688d1ed` and `9153779668b4a962b1b027de81b77f1f0390b10a`. Full frozen installation is running separately; a partial installation is not successful installation evidence. Node 26.11.1 was restored from the official checksum-verified archive. The temporary native qualifier workflows are retired with their source/tests integrated into the regular gates.

Full frozen installation now completed with the declared lifecycle: Prisma 7.8.0 generated, both pinned subscription-runtime peer contexts verified, and the isolated native compiler prepared. Native TypeScript 7.0.2 checks of the complete original workflow-provisioning, review-context-attestation and review-processes projects passed. On exact clean `e3a2e9db87f052df68c21278f5dc96d7676e8aeb`, actual local functional tests passed **732/732**, with zero failed/skipped/todo: cold Gateway restricted-grant installation/recovery (1), owner/Web recovery/context/completion-process suites (714 across 42 files), and Review Action v2 PostgreSQL fault/recovery scenarios (17). Two separate disposable PostgreSQL 17.12 clusters were used; the ordinary database has all 165 successful entries from the maintained Prisma migration deploy. HEAD, tracked source and all four lockfile hashes stayed unchanged. Both clusters were stopped and removed. The [source-bound receipt](../deployments/evidence/2026-11-23-architecture-phase2-local-e2e.json) retains exact counts and raw-log hashes. SCM/model fixtures are synthetic; this is not live external publication evidence.

Two fresh source-generated builds under Node 26.11.1, pnpm 11.28.7 and esbuild 0.28.1 produced identical bytes matching both committed Action artifacts: conflict runtime SHA-256 `a3ac19a1be5ddb9dbb897ff6db3fe5ea495fe537dc420d919f2797ab786fc9cb`, main Action `2bb673a9739690edb734929a2a49483df3e1c316707f973dde4843425e4af02b`. No generated artifact edit was needed. The guarded full native Prettier check found only two documentation formatting defects; no legacy compiler/parser was initialized.

After compiler-source integration, the six selected native architecture/import/layout/memory, formatter and recovery-loader suites passed **166/166** under Node 26.11.1 with zero skips. This includes 43 independent native Prettier/guard cases and all 14 production-declaration loader fixtures. The two documentation formatting defects were corrected with the same guarded native formatter.

The actual full `pnpm typecheck` passed: Shared built first, all 56 Turbo package tasks ran uncached, and the spikes, one-shot handoff and tooling projects passed afterward. Across the documentation-only publication to `679055b5`, all 4,106 source/config/lock inputs retained aggregate SHA-256 `cb888e272c503a7db8b99da45356788f13cba3243e67e0513a4e9dbfb932acc4`. The pre-initialization guard observed 169 Node processes and 61 native compiler invocations, exclusively TypeScript 7.0.2. Turbo used explicit loose environment forwarding so child processes inherited the guard and resource limits. This is the recorded source closure, not a claim about future changes.

The complete actual `pnpm architecture:check` also passed on source equivalent to `3986c68`: 688 domain/application files, the real Web Host check, Foundation registry/dev-only/installed/lock consistency with zero diagnostics, 23 Memory positive/rejecting cases, six Statistics cases, and History/account-metadata layout, imports and strict project checks. These qualifiers temporarily mutate owned fixtures; they finished and restored a clean tracked tree before any later compiler pilot. Existing Web Host contracts passed 101/101, conflict-runtime/public-contract suites passed 49/49, and the full Action artifact check passed including archive integrity.

The independently locked accounts/browser harness now also pins TypeScript 7.0.2 and Next 16.4.6. Pnpm 11.28.7 regenerated its real lockfile; an independent frozen installation completed with the declared lifecycle and the integrated original strict project check passed. Playwright discovered all 77 tests across 17 files with the pre-initialization guard; discovery is not browser execution. The [browser toolchain receipt](../deployments/evidence/2026-11-23-architecture-phase2-browser-toolchain.json) records source and lock hashes. The actual browser scenarios remain assigned to the supported ordinary CI runner.

#987's original native-only compiler implementation is integrated with its author retained, including independent emitted/typed public-surface consumers and the real tooling-project case. Review corrected abnormal compiler termination so a signal or missing exit status cannot satisfy a negative fixture. The complete integrated compiler pilot subsequently passed **19/19** across all three files, including the original strict tooling preflight, the full copied tooling closure, rejecting fixtures, public declarations, production emission and plain-Node runtime consumers. Exact source `34bb72c6e6e04439e29744f8f1ffd5c0e279f984` and tree `c1f001d40f13721e8daaf1ed3cfc72c7e5013456` stayed unchanged, as did all four locks; all 50 observed Node processes were guarded, with only TypeScript 7.0.2 and no blocked legacy loads. The [native compiler receipt](../deployments/evidence/2026-11-23-architecture-phase2-native-compiler.json) retains exact input and proof hashes. Prior signal/interruption failures remain recorded as failures. Remaining owners and acceptance: Foundation #470's public compiler-free ESLint syntax adapter and exact qualified artifact, effective strict compiler/AST/lint/format/build checks, browser and offline-Prisma runner qualification, final independent review, protected exact-head merge and resulting-main verification. The legacy ESLint plugin cannot be made compliant merely by swapping its parser. Preserve every configured rule and its independent diagnostic/fix expectations. Chromium was blocked from creating its Unix socket, and required offline Prisma generation failed to create network isolation locally; neither is claimed as passed. Queued, skipped and partial work do not establish completion.

## Earlier continuation checkpoint — 2026-11-23

This is retained historical context. The integrated continuation above supersedes its runtime, dependency and acceptance status claims.

- Artifact run [45090028169](https://github.com/777genius/review-router-ai/actions/runs/45090028169) actually completed under Node 26.11.1/pnpm 11.28.7: two builds of source `6224308a263bd9b0fbe3c13e6ceb792352444abf` had SHA-256 `a3ac19a1be5ddb9dbb897ff6db3fe5ea495fe537dc420d919f2797ab786fc9cb`. The job passed 81 focused tests and the then-current architecture checker (686 core files), and committed generated bytes as `bc5926fa79acc30c851a618a0dc6666f29510a1a`. That is retained evidence for that source/toolchain, not proof of final-head or TypeScript-7-only conformance. The completed one-time artifact workflow is removed.
- Lane B now includes actual application orchestration: `assertCurrentWorkflowSetup` owns the two sequential current-state reads through a narrow query port, a Prisma adapter preserves the exact predicates, and the host keeps authorization, activation callsites and final CAS. Seven ordering/recovery/error tests and the existing host regression's exact query assertions cover the moved boundary. The workflow revision is `number` (Prisma Int); malformed bigint input remains a rejecting test. The dashboard file ceiling follows its actual reduced size.
- Independent review found that regular-expression scanning missed commented/template-literal imports. The bounded conflict-contract guard now reuses the existing TypeScript AST approach through one typed module-reference helper, also shared with account-metadata host checking. New fixtures cover import types, static templates, comments, import-equals and computed imports. Legacy broad checks are not represented as whole-workspace transitive certification.
- The legacy `scripts/check-architecture-boundaries.mjs` entry is retained for this localized correction; the extracted new helper is TypeScript and included in `tsconfig.tooling.json`. This does not claim that the remaining legacy checker or its classic parser has migrated.
- The dependency qualifier verified the eight intended npm release coordinates. Its first updater failed because SDK Growth Authority deliberately retains Foundation 1.6.0 plus exact tarball evidence. The corrected updater preserves that one exact historical pin, rejecting drift, while targeting Foundation 3.1.0 at the root. No upgraded application manifests or fabricated lockfiles have been accepted.
- Current executor availability: no usable local execution environment. GitHub connector access works; independent source review and GitHub Actions are available. A queued job is not a blocker or a pass.
- There is a separate concrete toolchain prerequisite: the maintained Engineering Quality Standard requires compiler and embedded parser implementations >=7.0.2. The root classic `typescript@6.0.3` is still loaded by architecture/layout checks and the hosted-workflow recovery oracle; Next/ESLint/formatter compatibility also needs its owning qualification. PRs #967/#969/#971–#975 migrate compiler CLI batches and explicitly retain classic API consumers, so their green CI cannot establish parser compliance. Do not run old parser/compiler gates, silently weaken the rule or label that evidence as TS7 conformance. Preserve the separate owners and finish unaffected work.
- The isolated dependency workflow now qualifies the published GM consumer with exact native TypeScript 7.0.2 before a fail-closed toolchain preflight, which runs before workspace installation/lifecycle. It cannot commit unqualified pins/locks if that preflight fails.
- Full application native typecheck, current guard fixtures, format/build, real PostgreSQL/action/browser acceptance, final-head review and protected merge are still required. Draft/queued/skipped/action-required checks are not passing evidence. Production rollout remains out of scope.

The delivered source scope is a bounded vertical slice, not a claim to have completed the original 12–22k planning envelope or the repository-wide architecture remediation. Count actual semantic/ownership work separately from tests, policy, generated bytes and lockfiles.

## Objective and counting rule

Complete a substantial, bounded, behavior-preserving architecture remediation: remove proven core-to-infrastructure leaks, move application decisions to their feature owners, enforce the new boundaries, and qualify currently published Engineering Foundation/Get Modular dependencies. Preserve the feature-first modular monolith.

Planning envelope: 12,000–22,000 uniquely touched lines of relevant source, tests and executable policy over the completed coherent batch, with a preference for at least 10k if genuine ownership work warrants it. This is NOT a quota to manufacture churn. Record separately relocated production source, semantic edits, tests, policy/CI and manifests/lockfile; relocation counted once. Never pad volume with broad formatting, generated files, duplicated adapters, empty facades or unrelated rewrites. If safe work is smaller, report its true size.

## Baseline / overlap inventory

- Previous architectural refactor PR #810 already merged: workflow CAS outcomes; API/worker publication policy; application/composition exports for workflow provisioning, review-config, audit log and provider setup; provider setup storage and finite publication ownership. Do not repeat.
- Previous provider integration PR #914 already merged. Do not redo its contracts.
- Open PR #959 changes 172 files: provider setup UI, account controls, Gateway/native provider integration, review-action-v2-production-composition.ts and architecture/foundation/provider-seams.yaml. These exact paths and provider policies are EXCLUDED from parallel edits. Check its file list before integration; reconcile rather than overwrite.
- Open PRs #967, #969, #971–#975 change TypeScript 7 compiler routing. This batch does NOT change their compiler scripts or transplant their work. Open #976 fixes current GM 0.7 Foundation consumer qualification; integrate/reconcile rather than independently reimplement or overwrite scripts/provider-foundation.
- Other open API/worker reliability PRs #960, #962, #965, #970 require file-by-file overlap checks. No force-push to their branches.
- Current ReviewRouter pins: engineering-foundation 2.1.0, Get Modular Core/Assembly 0.7.0, Conformance 0.5.0, Resources 0.2.1. As of this review, upstream GitHub source manifests report Foundation 3.1.0, Core/Assembly 0.8.0, Conformance 0.5.2, Resources 0.2.2, FMS 0.3.2. Upstream source versions are NOT evidence the same release exists at npm stable dist-tags or is compatible. Verify registry artifacts, peer contracts and minimum-release-age before changing pins.

## Lane A: Action Control Plane contract ownership (first implementation)

Evidence: packages/features/conflict-runtime/src/domain/conflict-runtime.ts imports four domain-only values via the broad @reviewrouter/features-action-control-plane root. That root exports Prisma, JOSE and HTTP adapters. The facade hides the intended published-language boundary.

Implement exactly one narrow public domain-contract subpath from Action Control Plane exporting only the four consumed contract values (schema, type, advisory context, summary limit); migrate the one core consumer. Do not remove legacy root exports until an independently inventoried consumer migration. Update the existing Action v2 exact export-map checker to accept only this named new path; enforce that this new facade cannot import/re-export infrastructure, composition, interface, transport DTO, other features or framework modules. Do not weaken exact existing OIDC, v2/contract-source or protocol checks. Add a rejecting negative fixture for the contract facade; verify source and production conditional exports and the emitted file. No schema, tokens, auth or protocol behavior changes.

Acceptance: reference identity and exact schema behavior unchanged; action control plane/conflict runtime focused tests and architecture checker pass; negative mutant fails; emitted production subpath exists and resolves.

## Lane B: dashboard setup workflow application ownership

Evidence: apps/web/app/dashboard/actions.ts ~3,979 lines. createSetupPullRequestMutation ~488 lines and confirmSetupPullRequestMergedMutation ~996 lines mix trusted host request, admission, provider/workflow policy, persistence, GitHub transport and outcome mapping.

Before extraction, inventory all real consumers and existing feature ports and snapshot observable behavior in focused tests: authorization before effects, repository/workspace identity, revision, rate limit, entitlements, current attempt/lease, audit, external PR, cache invalidation/redirect and lost-response recovery. Move only coherent application policy to existing workflow-provisioning/provider-setup owner. Keep FormData/Next session, response/redirect and cache in the host; Prisma and Octokit in infrastructure adapters. Reuse settled CAS outcomes from #810 rather than inventing new retry, generic repository, service locator, new feature flag or framework. Extract and commit one use case before the next; preserve effect ordering and exact idempotence.

Acceptance: real PostgreSQL + existing GitHub in-memory/replay fixture for stale older attempt, successful new attempt, external PR already created but DB settlement uncertain, postcommit audit failure, cross-workspace denial and duplicated delivery. Browser/Next wrapper smoke verifies same form and redirect. Never claim success from a skipped fixture.

## Lane C: Action-v2 context attestation composition cleanup

Evidence: API context-attestation ~3,854 lines, execution-evidence ~3,101 and investigation ~3,089 contain mixed orchestration and host adapters. Avoid separate production-composition because #959 is changing it.

Select one contiguous, high-risk decision in apps/api/src/review-action-v2-context-attestation-composition.ts and move it into its existing owner review-context-attestation (or the actually owning published feature). First add characterization tests. Domain receives immutable facts; application receives only owned typed ports. Keep HTTP mapping, token decoding/signature verification, database transactions and authorized session in the adapter/host. Do not change exact permit, tenant, generation, sequence, expiration, own-operation or history fences. No new service, registry, runtime assembly, schema migration or implicit retries. Follow with another coherent operation only if overlap and regression evidence remain safe.

Acceptance: negative tests for missing/current/obsolete head, replay, permit/context mismatch, failed history, activation absence, concurrency and provider failure; selected API + worker + PostgreSQL suite with synthetic signed GitHub; no behavioral drift.

## Lane D: executable narrow boundaries and FMS/GM integration

Adopt executable rules only for selected contexts actually touched by A–C: action-control-plane, conflict-runtime, workflow-provisioning, review-context-attestation/review-executions as relevant. Domain/application cannot reach infrastructure/composition/HTTP/Prisma/Next/Fastify/JOSE or GM assembly. Host adapters use explicit exported composition paths. Use existing Foundation/FMS checker and current import parser instead of second graph engine. Test value and type imports, re-export, import types, literal dynamic imports, source and production condition. Provide rejecting fixtures. Do not claim whole-workspace FMS conformance from bounded adoption. Fixed private helpers use static imports/factories; Get Modular graph nodes only for independently assembled capabilities.

## Lane E: exact compatible version upgrades (required before merge)

1. Read upstream release notes/peer contracts for Foundation 2.1→3.1 and Get Modular Core/Assembly 0.7→0.8 (plus Conformance 0.5.2 and Resources 0.2.2), FMS version currently adopted, npm manifest/dist-tags and package integrity.
2. First coordinate with PR #976 and retain its historical 0.2 consumer evidence byte-for-byte. Make the current-version consumer fixture/receipt qualify actual installed version without fake artifact identity.
3. Use an atomic exact-pin upgrade commit with real pnpm 11-generated frozen pnpm-lock.yaml; no fabricated lock integrity entries or unbounded ranges. Explicitly maintain security overrides and release age exceptions only where reviewed.
4. Preserve Foundation bounded v1 adoption unless a newer closed-workspace topology can be proved compatible. No silent capability switch to v2/v3, no disabling negative tests. Avoid editing provider-seams.yaml until #959 integration.
5. Run frozen install, foundation:check, foundation:assert-dev-only, foundation:assert-registry, foundation:qualify, foundation:qualify-memory/statistics, modular:qualify, FMS checks, native TypeScript 7 typechecks and rejecting mutants. If compatible packages/registry/Node/pnpm cannot be obtained, DO NOT commit unqualified pin changes. Record a precise compatibility/availability no-go and handle the version upgrade as a separate dependency PR; do not falsely mark it complete.

## Steps and commit order

P0. DONE research: current baseline, source manifestations and overlapping open/merged PRs inspected.

P1. Push this plan and open a Draft PR immediately. Critique it in four passes before full extraction and record repairs below.

P2. Make a small, provable Lane A contract-ownership commit, including source/production export paths and negative boundary contract. Push immediately; focused local checks as available. Do not combine dependency upgrades.

P3. Characterize selected dashboard workflows with existing fixtures; extract the first coherent use case, update hosts and tests and push. Repeat second only after reviewing the first.

P4. Characterize and extract one Action-v2 context-attestation application decision; push independently with tests and no provider-related overlap.

P5. Coordinate #976; qualify exact version upgrades with genuine registry artifacts, regenerate frozen lockfile and push atomic dependency update after compatibility proofs.

P6. Execute focused source and emitted checks, strict TS 7, existing architecture:check and negative tests, lint/format, PostgreSQL/Next browser scenarios and the required affected real E2E. Track actual pass/failure/skips, test selection and HEAD; do not mistake static review for execution.

P7. Review pass 1: SOLID, real owner and import/ABI. Pass 2: security, auth order, effect ordering, CAS/lease, provider custody and transaction recovery. Pass 3: tests/oracles, rejection mutants, false positives and integration/CI. Fix all critical/high findings and rerun affected gates. Counter-review final diff, inspect relevant PR threads.

P8. Only at the end, inspect exact-HEAD CI once, resolve actual failures, ensure required jobs and E2E success on that HEAD (queued/skipped != PASS), verify no unmerged overlapping changes, make PR ready and squash-merge. Verify merged main. Do not disable protections or treat a draft as merged/deployed. No production deployment requested.

## Four pre-implementation critique passes

1. Duplication/parallel ownership: #810 and #914 are merged; #959, #967–#976 have active owners. **Repair:** file overlap exclusions, narrow phase boundaries, no reimplementation or force updates.
2. Architecture and overengineering: risk of creating many graph nodes and duplicated injection layers. **Repair:** use existing feature ports and static factories, narrow only published boundaries; no new generic framework.
3. Behavioral security: migration can change authorization, durable settlement, credentials, repeat delivery and replay. **Repair:** characterize first; fail-closed behavior, preserve authoritative fences and exact order of effects; no DB schema changes.
4. Evidence/churn: 10k-line volume and passing checks can be misleading. **Repair:** count relocations separately; negative mutants, production ABI, real PostgreSQL/browser E2E; real exit status, exact HEAD, no skipped/queued pass claims.

## Current evidence, limits and definition of done

- Upstream versions above verified from repository package manifests; published npm artifacts not yet qualified.
- Existing #810 main and #914 main integrations confirmed. Open #976/#959/file-level overlaps inventoried.
- Current GitHub connector can write code, but the current execution container cannot resolve github.com and has no gh/pnpm/Node 26 repository checkout. **Until an actual checkout is available, local or E2E tests cannot truthfully be claimed PASS.**
- Completion requires (1) coherent feature-owned policy, (2) guarded source/production public ABI, (3) verified compatible exact dependency pins/frozen lock if available, (4) measured substantive diff without padding, (5) focused + integration + affected end-to-end evidence on the exact final SHA, (6) resolved critical/high review findings, (7) final review and merge protection, (8) merged-main verification. Draft PR or documentation commit alone is NOT completion.

## Executed checkpoint P2 (2026-11-23): source-level proof, not E2E

Commits pushed as they were prepared:

- d3af7256: plan + opened draft #977.
- a609ff34: new narrow Action Control Plane conflict-runtime subpath, explicit package conditions, architecture guard and rejecting fixtures.
- 02e9ae6b: move the 72-line schema/constant owner out of the eager domain aggregate; the facade now re-exports only that pure owner.
- 74306562: format narrow checker and fixtures.
- 8e5049a9: runtime identity/strict parsing regression tests.

Read-only comparison against main verifies that the extracted source block is byte-identical after trimming; the original public builder function body is byte-identical; the consuming domain resolves only the narrow public subpath, and its facade imports exclusively the new domain owner. Conditional package exports target real source and emitted production paths. PR file-path intersection is empty with current #959, #976, #970. These are STATIC SOURCE proofs, not build/test assertions.

### Important P3 characterization discovery before any large source move

- apps/web/app/dashboard/actions-codex-rotating-contract.test.ts reads actions.ts verbatim and slices exact function markers, including provisionPendingRepositoryOwnedWorkflow, createSetupPullRequestMutation, confirmSetupPullRequestMergedMutation and resolveCodexRotatingProvisioningActionRef. These source-bound checks assert active vs candidate SHA selection, attestation ordering and the unique writer-policy callsites. A blind extraction would silently break the oracle or require weakening it. Do not simply delete these markers; first replace them with equivalent executable owner/host contract tests and retain the original tested semantics.
- Existing test owners: actions-workflow-provisioning-recovery.test.ts (1,437 lines), actions-hosted-workflow-recovery.test.ts (2,303 lines), actions-codex-rotating-contract.test.ts (263 lines). They cover authorization-before-side-effects, unknown/head-changed/wrong-base, hosted/repository-owned activation, writer version and workflow attestation. Reuse these instead of a fresh E2E framework. Any source-marker fixture migration must be reviewed as a semantic test change, not automatic textual replacement.
- No production actions.ts source edited yet. The target for P3 remains one coherent use case only once the exact external effect order and PostgreSQL/browser oracles can actually be executed.
- Exact dependency upgrade not committed: npm registry and a real pnpm install/frozen lockfile are unavailable in the current execution container. Upstream source versions are noted but are not npm artifact evidence. Do not present this as an updated dependency set or a successful local test.

### P2 review observations

Round 1 (public API): a pure facade pointing at the legacy aggregate still loaded unnecessary feature roots — repaired by moving the owned schema itself.
Round 2 (source identity): extracted block and unchanged builder compared exactly against baseline; no new parser/serializer behavior introduced.
Round 3 (boundary tests): malformed/extra contract exports and direct eager-root consumer imports are rejected by fixtures; a runtime identity/strict parse regression test has been added, but execution is still pending.
Round 4 (integration scope): no overlapping paths with current #959, #976, #970; do not claim cross-version runtime compatibility or finished CI solely from this static inspection.

## P3 first bounded policy extraction (2026-11-23)

Commit `bafdf7b2165454439df685044d651d489b33d024` immediately pushed. `workflow-provisioning` now owns the pure managed workflow option admission predicate in `src/domain/managed-workflow-setup-options.ts`; the existing `createSetupPullRequestMutation` invokes it at the same position **after** host-qualified runtime/entitlement/rate-limit reads and **before** provisioning. No authorization, source selection, GitHub request, database transaction, audit or external side effect moved. Existing transport and workflow style types reused. Root feature export is additive, and there is no new package, container, config flag or framework.

Regression suite added as `packages/features/workflow-provisioning/src/tests/managed-workflow-setup-options.test.ts` (12 named positive/negative cases covering Gateway provider API, rotating, hosted and CI-secret modes). A separate in-memory V8 comparison of the legacy expression vs extracted expression exhaustively checked all 40 transport/style/discussion/runtime-available combinations: zero mismatches. **This is expression-level simulation only, NOT a Vitest, TypeScript, local integration, or browser E2E PASS.** Open #959 and #976 changed-path intersection remained empty after the commit. Avoid moving the entire `actions.ts` function before source-marker tests are replaced by equivalent executables.

### Remaining gates (not performed)

- Affected Vitest tests, real TypeScript build, production condition import and standalone emitted contract ABI checks.
- `architecture:check` and rejected-mutant qualification.
- Exact GitHub commit CI and applicable PostgreSQL/Next browser E2E.
- Safe, real registry-verified Foundation 3.1.0 and Get Modular 0.8.0 upgrade, integrity and real pnpm-generated frozen lockfile.
- Substantive high-risk ownership extraction of the much larger workflow/admission slice, final reviews, merge. Current Git diff is far below the intended 12–22k lines; no completion or merge claim.

The user explicitly prefers pushing every cohesive change immediately and postponing broad CI checks until the end of coding instead of repeatedly polling queued runners. Preserve this order, but do not drop required final E2E or branch protections.

## Direct-session continuation, source review and remaining E2E (2026-11-23)

Owner explicitly disabled the scheduled automation: implement and push directly; do not treat automation status as evidence. The automation was disabled through the task API. Keep Draft #977 until exact-HEAD checks and artifact qualification pass.

Additional pushed slices:

- `c4bc58ee`: feature-owned classifySetupPullRequestHead() preserving null/missing/changed/historical merged observation; 12 focused cases, with the API still responsible for independently verifying the actual installed workflow and current database attempt.
- `e85abb7c`: feature-owned isCurrentWorkflowSetupAuthority() preserving all current-repository/attempt/head/branch/URL/workflow predicates; all existing reads and final CAS stay in Next/Prisma; 17 focused cases including transfer and revision mismatch.
- `4ce5ddab` + `438205e9`: type-only conflict-runtime consumers no longer import the mixed Action root except two explicitly allowed legacy runtime adapters; additional source boundary negatives; fix the checker to await its async scan.
- `ecf0f92a`: format focused recovery fixtures.
- `16bae4ad` + `7eeb482d`: context-gateway lifetime/key configuration admission moved to existing feature domain with invalid-key/TTL matrix, API wrapper and error identifier unchanged.

### Source-level review pass A: semantics

The dashboard head and workflow-attempt predicates are exact logical extractions: host still obtains identity and session authority first, reads Prisma in the same order, checks the same fields before activation, and uses its existing atomic final settlement. The owner returns Boolean/classification only. There are no new externally visible errors, provider policies, database queries, migrations, feature flags or retry paths in these helpers. The context gateway receives the same numeric/key-size checks and error code before effects. This is a source review, **not** recorded passing test execution.

### Source-level review pass B: authorization, secrets, concurrency

- Do not move the dashboard actor/entitlements before repository resolution; do not bypass the installation/tenant selection or `assertCurrentBinding()`.
- The workflow authority helper is a precondition, **not** the final authority; Prisma compare-and-swap remains mandatory. Its observed current attempt is passed by the trusted database adapter, never directly by the browser.
- Do not convert historical PR observation into proof of installed workflow. Continue independently checking exact content/SHA, source and actor before the final write.
- Do not move context gateway crypto/session secret or lease/receipt checks into a general shared package; no provider secret or token logged in tests.
- Negative cases require unexpected workspace, installation transfer, stale attempt/revision, changed PR head/base, artifact mismatch and expired/invalid context configuration to fail closed.

### Source-level review pass C: artifact, source/build and strict version migration

**New blocking discovery:** `action-dist/conflict-runtime.cjs` is a committed generated bundle (~530 kB at the baseline) with byte-level source parity checked by `scripts/build-conflict-runtime.ts --check` and CI `pnpm action:artifact:check:smoke`. Lane A changes runtime source imports, so this bundle is **not yet qualified and must be rebuilt** with exactly the pinned esbuild/Node/pnpm toolchain. Do NOT claim that the unchanged artifact matches, and never manually edit its minified contents. Required procedure:

1. Build a clean checkout of the full branch with CI pinned Node 26.11.1, pnpm 11.28.7 and approved frozen dependencies.
2. Run `pnpm action:build` twice; verify deterministic identical `action-dist/conflict-runtime.cjs` bytes, unchanged and approved `action-dist/index.cjs` when appropriate, and absence of machine paths or secrets.
3. Commit source-generated bundle bytes and immediately push. Run `pnpm action:artifact:check` and the existing bundle's preflight-fail-closed tests, then all affected E2E.
4. Do not attempt to fabricate the bundle via source string changes, a manual base64 paste, ad hoc GitHub write-token CI, or a stale artifact from another HEAD.

**Runtime constraint:** this session has read/write GitHub connector access but the terminal lacks a checkout of this repository, Node 26/pnpm 11, npm/GitHub DNS, and its installed 1,000+ workspace dependencies. The installed system Node is 22.16.0. Consequently no local `pnpm`, test, emitted bundle or PostgreSQL E2E verdict can be asserted. GitHub CI triggered by pushes was QUEUED when inspected; skipped auxiliary workflows are explicitly not PASS. Do not turn draft into ready or merge based solely on these source reviews.

### Final exact-HEAD acceptance sequence once a qualified checkout is accessible

Required in order, using the final actual source and lockfile:

1. `pnpm install --frozen-lockfile` under the exact pinned Node/pnpm and no untrusted script changes.
2. `pnpm --filter @reviewrouter/features-action-control-plane build`, `pnpm --filter @reviewrouter/features-conflict-runtime typecheck`, `pnpm --filter @reviewrouter/features-workflow-provisioning typecheck`, `pnpm --filter @reviewrouter/features-review-context-attestation typecheck` and actual API/Web/worker typecheck.
3. `pnpm architecture:check` including negative boundary mutants, applicable feature/GM/Foundation qualifications, and exact public exports in production mode.
4. `pnpm vitest run scripts/check-architecture-boundaries.test.ts packages/features/action-control-plane/src/tests/conflict-runtime-contract.test.ts packages/features/workflow-provisioning/src/tests/managed-workflow-setup-options.test.ts packages/features/workflow-provisioning/src/tests/setup-pull-request-head.test.ts packages/features/workflow-provisioning/src/tests/workflow-setup-authority.test.ts packages/features/review-context-attestation/src/tests/gateway-session-configuration.test.ts`.
5. `pnpm vitest run apps/web/app/dashboard/actions-workflow-provisioning-recovery.test.ts apps/web/app/dashboard/actions-hosted-workflow-recovery.test.ts apps/web/app/dashboard/actions-codex-rotating-contract.test.ts scripts/build-conflict-runtime.test.ts`. These exercise the actual Next actions, GitHub fixtures, stale attempts and checked-in CLI bundle.
6. Real PostgreSQL/HTTP/browser and selected Review Action v2 context gateway E2E under existing controlled fixtures. No synthetic fixture may be described as live GitHub/provider qualification.
7. Full affected `pnpm build`, `pnpm lint`, `pnpm format:check`, artifact checks, protocol checks and any required dependency/CodeQL/security checks. Count _only_ real test passes, no skips/queues.
8. Final independent review, fix all high/critical findings, confirm no #959/#976 overlap, merge latest main, run final exact-HEAD CI/required gates, squash-merge and verify merged-main. Never override release/deployment policy. Merge is not deployment.

### Dependency upgrade still pending, not silently omitted

Upstream GitHub manifests show Foundation 3.1.0 and Get Modular Core/Assembly 0.8.0, Conformance 0.5.2, Resources 0.2.2. Public jsDelivr additionally lists Foundation 3.1.0, but neither that nor GitHub source proves the exact npm tarball integrity and full compatibility. Current root manifest + lockfile remain pinned to old versions. The upgraded set needs a genuine pnpm-generated frozen lockfile and the precise Foundation bounded policy and Get Modular current-consumer contract qualification. The existing #976 consumer fixture must be preserved/updated in coordination; do not bypass it or disable the failing tests.

Plan state at this checkpoint: **P1 complete, P2 code pushed but E2E and bundle build incomplete, P3 selected pure recovery policies pushed but full real-host acceptance incomplete, P4 one bounded context gateway policy pushed but real API E2E incomplete, P5–P8 pending.**
