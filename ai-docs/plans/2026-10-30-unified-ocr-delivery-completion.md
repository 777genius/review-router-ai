# Unified OCR: complete the delivery boundary

Status: three plan-review rounds and the second implementation review returned
GO. The delivery pair is committed locally. The maintained six-file controlled
paired suite passed 44/44 and actual Next desktop/mobile acceptance passed 2/2.
GitHub authentication and the local Docker gate remain blocked as recorded below.

## Goal and initial observed baseline

Finish the remaining implementation needed to deliver the already qualified
Unified OCR scenario through the ordinary release and registration path. Keep
the existing common runner, verifier, accounting, recovery and App publisher.
The owner confirms that there are no users: no new migration, backfill, rollout
framework, product flag or compatibility platform belongs in this change.

Inspected SaaS main is `6ff48750ca17e8a01fe12975530f44e8e769e511`; inspected
Action main is `b5f12764d62d0e70e48beff416027e7001c5068b`. The previous qualified
N/A4 pair and merged PRs #718/#346 remain historical evidence. Current SaaS main
also contains provider-catalog and Statistics changes; those changes are not
part of this implementation, and previous N results do not qualify them.

The approved plan was committed as
`cc3b46290ab9b04f831cfcc402b0d24b546305be`. The implemented local pair is SaaS
`5b9da7f6fd94198bd7216ce8f18ef112da35d283` and Action
`4db644c798326cb52d86e4762cabdd24bca2b8c6`. The canonical CI Action pin now selects
`4db644c798326cb52d86e4762cabdd24bca2b8c6`; N/A4 results remain historical.
No current-pair remote publication or merge has occurred.

Read the repository AGENTS files, the maintained Engineering Quality Standard,
the release source of truth, the existing Unified OCR plan and deployment task.
This plan supplements those records; it does not replace their release gates.

## Initial confirmed gaps

1. The seven-route production-runner fixture injects `modelDispatchProfile`.
   Normal Action release verification/generation/checking, registration
   projection and the operator candidate parser omit or reject it. The runtime,
   domain, persistence, attestation and materializer already support it.
2. The committed Action catalog approves `ocr-managed-v5` / `1.13.1-rr.6`, but
   it does not declare internal route defaults, protocols, limits or aliases.
   These approvals cannot be inferred from a profile name or catalog label.
3. Production bootstrap requests the fixed GitHub release asset
   `ocr-v1.13.1-rr.6/opencodereview-linux-amd64`. An HTTP HEAD request returned
   404 on 2026-10-30. The existing native candidate workflow only uploads a
   seven-day CI artifact. No repository native release publisher was found.
4. Ordinary Action release runs `npm ci` (whose prepare script minifies dist)
   before the committed-artifact identity smoke. Unlike CI, it does not restore
   tracked dist first. Its later build cannot fix this earlier test input.
5. Actual-Next acceptance records `--expected-revision` without enforcing it;
   its revision lookup can substitute an unrelated working-directory HEAD.
   The existing Unified OCR browser workflow has no manual dispatch trigger.

## Bounded implementation

### A. Preserve explicit producer policy through release and registration

Add one committed Action JSON policy file beside the existing agent catalog.
It declares only already supported transports, protocols, explicit v5 defaults
and finite request limits. Synthetic model names must not become release
defaults. Preserve the already selected sonnet mapping to `claude-sonnet-4-6`;
qualify the existing opus/haiku choices with exact requests for `claude-opus-4-6`
and `claude-haiku-4-5-20251001` in the existing native CLI fixture before adding
them. This corrects the fixture's undated pre-4.6 Haiku alias rather than adding
a new model family. Anthropic's [versioning documentation](https://platform.claude.com/docs/en/about-claude/models/model-ids-and-versions)
identifies the 4.6 names as pinned snapshots and the dated Haiku name as the
snapshot; its [status table](https://platform.claude.com/docs/en/about-claude/model-deprecations)
lists these IDs as active when checked on 2026-10-30. These references establish
identity, not subscription entitlement. The existing real binary/local-wire
qualification must cover each declared alias; live acceptance remains pending.
Do not upgrade to newer model generations or consult mutable aliases at runtime.
The policy is immutable with its Action commit.

Read this file from that exact commit using the existing Git artifact readers.
Determine optional absence from the exact Git-tree entry. A present entry must
be a regular `100644` blob; a read failure, nonregular entry, invalid JSON or
explicit null rejects the release. Never catch a file-read error as absence.
Use the existing shared `parseReviewModelDispatchProfileV2`; bind it to reviewed
dispatch contract bytes and the handoff digests. Cross-check default profile
refs against the committed catalog and the appropriate existing public
transport. Do not execute public TypeScript or change the frozen S2 export.

Preserve the optional profile through the existing verifier, manifest builder,
generator, strict parser, checker, registration projection and operator parser.
Historical absence remains absent. A present malformed, unbound or incompatible
profile fails; it must never be dropped or replaced with a legacy default.
The exact-commit checker rejects any changed default or limit in supplied JSON.
The same operator codec also omits the already generated `reviewerPlanProfile`:
preserve and validate that existing optional field with the current domain
parser. Do not strip it to make the new release candidate pass. This adds no
reviewer behavior or activation authority.

Expected files: Action `src/control-plane/review-model-dispatch-profile.json`;
SaaS `scripts/lib/review-action-v2-release-{manifests,verifier}.mjs`, the existing
release generator/checker, `apps/api/src/review-action-v2-operator-cli.ts`,
existing release/CLI tests, the existing native Anthropic CLI test, and at most
one narrow `.ts` validation helper.
No domain, database, admission or canonical wire-schema change is expected.

### B. Publish the exact native artifact through the existing qualification

Extend `native-runtime-candidate.yml` with a main-only manual dispatch requiring
the exact source SHA. Keep PR qualification read-only. Reuse its pinned Go
1.26.10 build, managed tests, exact v3 manifest comparison, checksums and real
OCR/auth-helper CLI tests against synthetic local wires.

Only a successful qualification may start a separate publication job. Give that
job only the required `contents: write` and artifact read permission. Bind its
download to the current run and exact source SHA; recheck the manifest, binary,
sidecar, version, platform and committed catalog identity before any write.
Require dispatch ref, expected SHA, checkout SHA and current main to agree.

After both absence checks, create the fixed lightweight tag once at the exact
qualified source SHA, without force; then create its draft release with
`--verify-tag`. Draft creation alone must not be assumed to create a Git tag.
Upload the fixed
binary filename, a sidecar naming `opencodereview-linux-amd64` and the original
MANIFEST. Read back the exact tag target and complete asset inventory, download
and compare all three remote files with qualified local bytes, then publish as
a prerelease with `latest=false`. A failed upload or verification must leave the
release unpublished. Refuse an existing tag/release instead of overwriting it.
Never use force or clobber, move
`v1`/`workflow-v1`, register a producer or activate a route in this workflow.
An uncertain/partial publication requires inspection of existing remote state;
an unchanged rerun must not replace bytes.

Mirror CI's post-install tracked-dist restoration in ordinary `release.yml`
before the identity smoke; keep the later rebuild and clean-artifact gate.
Use the existing release workflow tests and development documentation. If shell
logic becomes substantial, use one small typed script with behavioral tests;
do not invent a release service or generic framework.

### C. Make current-source browser evidence truthful and rerunnable

An explicitly supplied expected revision must be a full immutable SHA and must
match the requested source checkout before any fixture work. Read only that
checkout, requiring its Git top-level to be the requested source root rather
than accidentally discovering an ancestor checkout. A missing flag remains a
normal local run, with an honest unknown
identity for source copies. Retain historical baseline information separately.

Update the existing harness CLI/contracts/run code and a narrow source-identity
helper. Test exact match, mismatch, missing Git metadata, malformed explicit
input and unrelated cwd identity. Correct the current README's informational
mismatch description. Add manual dispatch to the existing browser workflow,
preserving its read-only permissions, disposable DB, pinned Action/OCR and
synthetic external boundaries. Do not add a second browser or E2E platform.

## Meaningful qualification

1. Extend the existing temporary-Git release pipeline test to pass committed
   dispatch policy through generation, strict parsing, exact checking and
   registration projection. Preserve its existing reviewer-plan profile too.
   Cover altered policy, invalid committed metadata,
   wrong handoff binding/default agent, nonregular/null/unreadable metadata,
   and unchanged historical absence.
2. Test the operator CLI's accepted dispatch/reviewer profiles, absence and
   rejecting cases. Reuse the
   existing downstream immutable-identity/attestation/materializer tests.
3. Test the Action release ordering and native publication boundary, including
   remote lookup failure, existing publication identity, interrupted upload,
   remote-byte mismatch and refusal to publish a partial draft. Qualify
   actual native bytes with the maintained executable suite. Static YAML checks
   alone do not prove publication or live provider acceptance.
4. Test source identity with disposable local Git fixtures before running the
   actual Next desktop/mobile lane. Inspect its resulting screenshots.
5. Adapt one existing production Gateway case to bridge the real delivery path:
   generate/check the exact paired Action manifest, pass its candidate through
   the operator parser, invoke the existing `ManageProducerReleases` use case
   with the real Prisma repository, read the stored row back, and use its
   unchanged policy/catalog in admission. Assert `ocr-managed-v5`, the rr.6
   digest and the original finite shared allowance; do not substitute the
   fixture's `ocr-paired-v2` profile or rely on direct producer-row seeding as
   registration evidence. Keep the remaining fault fixtures unchanged.
   Use the maintained paired production-runner suite and real disposable
   PostgreSQL. Retain first-head findings, next-head fixed/open/unverified/new
   outcomes, exact route/model/account, shared allowance and zero-effect replay.
   Do not multiply the whole fault matrix across every provider combination.
6. Run relevant package checks and required final CI on the final committed
   pair. Reuse unchanged historical evidence only with its original scope.

## Delivery sequence and authority

1. Record and improve this plan through three rounds with at least two critics.
2. Implement the separate policy/release and acceptance fixes in bounded file
   ownership. Review source and tests independently; fix concrete findings.
3. Commit and immediately push the plan and focused changes to draft PRs through
   gh. Freeze the new Action candidate containing the explicit policy, update
   SaaS CI's canonical `REVIEW_ROUTER_PAIRED_ACTION_REF` to that immutable commit,
   and qualify the final SaaS descendant with the existing paired and actual-Next
   lanes. Keep S2's generated source provenance unchanged. Merge only after
   the ordinary exact-pair gates and independent review pass.
4. Update the existing Unified OCR deployment record/index with exact observed
   source readiness and remaining environment steps. Do not mark deployed on
   the strength of a merge, build, manifest or synthetic qualification.
5. Native publication, producer registration, channel promotion and environment
   rollout use the existing release/deployment process and actual credentials.
   Coordinate applicable deployment work with `rr: deploy`.

The restored session currently has public Git access and an installed verified
gh 2.103.3, but no authenticated gh account (`gh auth status` reports none;
GitHub identity read returns 401). Remote writes and authenticated workflow
dispatch cannot be claimed until this access is restored. Local implementation
and controlled qualification can proceed. Never use an unrelated credential.

Designated real provider credentials have not been supplied for this task.
Live paid inference, subscription refresh/writeback, real OIDC and App-bot
publication remain separately observed acceptance steps; fixtures do not
satisfy them. Pre-activation old comments remain manual as already documented.

## Critic and implementation record

- Round 1: three independent critics requested the exact-tree presence check,
  a real registration-to-review bridge, explicit new Action pinning, draft-first
  native publication with remote-byte verification, and evidence for every
  declared Claude alias. All five corrections are incorporated above. No schema,
  migration, flag or new orchestration platform was requested or introduced.
- Round 2: acceptance critic returned GO. Registration critic found that the
  same operator codec also loses the existing reviewer-plan profile; preserve it
  using its current parser and call the real registration use case in the bridge.
  Publication critic identified draft/tag sequencing ambiguity; explicitly
  create the exact tag once before the draft, then verify it before publication.
  These narrow corrections are incorporated above.
- Round 3: all three independent `gpt-6.1-sol` / `xhigh` critics returned GO
  after reviewing the final registration, exact-source and publication sequence.
  No remaining plan blocker or additional platform/migration was requested.
- Implementation review: the exact-tree verifier initially hid an empty
  committed policy tree; a nonrecursive exact lookup and plumbing-level fixture
  now reject it. The real release bridge initially assumed a named Action
  checkout and available historical Git objects; it now handles detached input
  through a disposable named clone and the maintained workflows fetch the
  required history. It also rejects tracked or untracked original-source edits
  before importing runtime modules. Final implementation review round 2 returned
  GO after these findings were fixed.
- A final independent review of the committed pair, real paired/Next receipts
  and delivery records returned GO after qualification. It found no remaining
  material implementation blocker and preserved all remote/live gate limits.
- Local focused results: 61 release/operator/domain tests, 13 source-identity
  tests, two dirty-source tests, 24 native-publisher tests and four native CLI
  cases passed. The application build completed **48 build tasks**, not 48 test
  cases. API/worker builds and typechecks passed; these scopes are not summed
  into a unique-test count.
- Action's full Jest run passed 266 suites / 4,244 tests, failed one wrapper test
  on Docker `ENOENT`, and skipped six suites / 23 tests. Its three fresh
  PostgreSQL-container revisions could not execute. Docker CLI/daemon/socket are
  absent, capabilities are zero and rootless `uid_map` is read-only. The existing
  CI Docker gate is unchanged; the full local suite is not green. Full Action
  lint had zero errors and 398 baseline warnings; typecheck, build and committed
  dist parity passed.
- The actual delivery bridge passed from clean detached Action
  `4db644c798326cb52d86e4762cabdd24bca2b8c6` through the real release generator,
  checker, operator parser, `ManageProducerReleases`, Prisma registration/readback
  and admission, selecting exact `ocr-managed-v5` / `1.13.1-rr.6`. First-head
  publication produced four findings; the next head made four discovery and one
  verifier request under the original nine-request shared allowance, resolved
  two threads and left three unresolved. Completed replay added zero model or
  GitHub effects. These external provider/GitHub/OIDC boundaries remain
  controlled fixtures.
- The maintained six-file paired suite passed **44/44**, zero failures/skips,
  in **348.17 seconds**, on the exact local SaaS/Action pair and real pinned OCR
  binary/PostgreSQL **17.11**. It comprises lifecycle 24, Gateway multi-reviewers
  four, review-investigation seven, direct OpenRouter six, banner one and
  PR-description two. The JSON's seven suite entries include a nested describe,
  not a seventh file. All seven production routes retain four first-head
  findings, two next-head native resolves, three unresolved threads and
  completed replay with zero provider/publication/resolve effects. The focused
  registration-bridge case overlaps this lifecycle coverage and is not added to
  the count.
- Actual Next **16.2.11** / Playwright **1.64.1** passed **2/2** desktop/mobile
  cases, zero failures/skips, in **30.6 seconds**, on exact SaaS
  `5b9da7f6fd94198bd7216ce8f18ef112da35d283`. All six actual desktop/mobile,
  light/dark and empty-state captures received visual GO. Official Chrome
  **156.0.8078.79** used the existing `--browser-executable` path after the pinned
  Playwright browser download failed. Stock isolated PostgreSQL **17.11**
  applied 157/157 existing migrations with exact checksums; boot passed.
  The nonzero source-delta receipt records only Next's generated
  `apps/web/next-env.d.ts` type import change from `.next/types` to
  `.next/dev/types`; its diff was retained and the file restored. Earlier
  shared-PG-role and long-temp-path Chrome failures remain preserved environment
  receipts. Exact delta identity and local artifact paths are in the
  [deployment record](../deployments/2026-10-29-unified-ocr.md).
- Remote evidence remains blocked by absent gh authentication: identity read
  returned HTTP 401 and the immediate plan push failed with
  `could not read Username`. The fixed native rr.6 asset URL returned HTTP 404;
  its new publisher has not run remotely. No Docker gate, current-pair remote CI,
  live-provider acceptance, merge or deployment is claimed. No environment
  producer registration, channel promotion or rollout occurred. Follow the
  existing deployment record and `rr: deploy` coordination; merge authorization
  does not authorize automatic deployment.

## Owner UX follow-up: repository access and workflow updates

The owner rejected two messages in the qualified screenshots. The earlier
visual GO covered layout and behavior but missed this wording/action defect.
The harness intentionally isolates inherited environment values, but omitted
the application encryption key and GitHub discovery/cache setup. Its generated
session proves dashboard sign-in only. The screenshot therefore shows a degraded
fixture; it does not establish production misconfiguration. The real product
nevertheless exposes internal configuration and offers a refresh that cannot
repair that server state.

Keep this correction inside the existing dashboard and acceptance harness:

1. Share the repository-access presentation in the existing dashboard copy
   module. Explain user impact and a useful next step; keep backend diagnostic
   codes unchanged. Populated, empty and error-toast surfaces must not print
   environment-variable instructions, token-encryption details or raw errors.
   Encryption/OAuth-client misconfiguration offers neither refresh nor
   reconnection. Missing/revoked/expired authorization offers reconnection;
   retryable GitHub/refresh failure offers retry without claiming expiration.
   Preserve access to repositories already authorized through the workspace.
2. Explain that the installed review workflow needs an update and that the
   action prepares a pull request to merge on GitHub. Align the first step,
   helper and button; preserve verification-only behavior for unknown status,
   existing readiness fences and the existing two-PR Codex recovery sequence.
   Use no internal runtime/version terminology in this ordinary user guidance.
3. Give the runtime-readiness fixture a generated application encryption key
   and an explicitly synthetic valid permission-cache observation. Use an
   existing foreign workspace with a denied/read-only observation so no new
   repository access is granted, and assert that it remains invisible. This
   qualifies cached dashboard behavior, not live GitHub OAuth/discovery.
   Separately cover the unavailable-service presentation and actions through
   existing rendering tests; do not hide the degraded-state defect by changing
   fixture configuration alone.
4. Extend existing focused presentation/setup tests and the two actual-Next
   readiness/search cases. Inspect desktop/mobile light/dark captures and an
   intermediate layout where the changed text wraps. Preserve authentication,
   network, fresh-database and exact-source guards. Add no migration, service,
   generalized state framework, fixture platform or unrelated redesign.

Fresh main `533c040de09d2609c8ebb44474812e2b35f0e7ea` includes merged memory
work #734. Integration commit `31956e6c93623c2f4d7da1b7491cbeefe8ef3497`
preserves its client-script warmup, positive lifecycle eligibility checks,
portable memory build and deployment entry alongside this task's source guard,
registration bridge and immutable Action pin. The earlier pair's counts remain
historical; qualify the integrated candidate with current dependencies/schema.
The owner's GitHub-plugin fallback is now authorized and its account was
confirmed as `777genius`; gh remains the preferred delivery interface.

The bounded UX plan received independent GO, and product/fixture owners
cross-reviewed the implementation. Focused product qualification passed six
suites / 171 tests, native web typecheck, scoped lint and formatting. Harness
typecheck and the four existing permission-cache reader tests passed. Actual
Next and the paired suite must now run on the integrated committed candidate.

Action publication used the owner-authorized GitHub connector while CLI device
sign-in remained incomplete. Draft [Action PR #354](https://github.com/777genius/review-router/pull/354)
contains commit `ffae2adb0f1b40ff5010a783f6be2e229e1a33c5`; its tree
`9d73b38219a64814a90b379a0720e3e5f8a9e1f2` was verified equal to local checkpoint
`4db644c`. The connector cannot preserve author timestamps/commit identity, so
SaaS now pins the actual published SHA and the next paired run uses its clean
detached checkout. Earlier source counts retain their recorded scope. The
native asset, producer registration and environment rollout are still separate.
