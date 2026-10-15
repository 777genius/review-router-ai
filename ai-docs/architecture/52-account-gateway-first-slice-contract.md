# Account Gateway: First-Slice Dispositions and Evidence

Date: 2026-10-03. DOC PLAN corrections accepted; dated runtime evidence below
qualifies only its named candidate and scenario. Sole normative authority:
[contract 53](./53-account-gateway-implementation-contract.md) (include
its exact bytes/digest in every implementation packet). [50](./50-reusable-account-gateway-and-personal-pool.md)
preserves vision and [51](./51-account-gateway-modular-implementation-plan.md)
owns delivery order. Historical readiness/evidence below is NONNORMATIVE.

## Normal production review failure - 2026-10-14 (NONNORMATIVE)

Production SaaS `6dd3bed59ded93defad3a91148bddff7a481bdb3` with published
Action `b1719b8742a8e0c07be238255cec65c5f0c8a334` passed service health and
ordinary repository setup. Fresh disposable [run 38553188388](https://github.com/777genius/rr-selfhost-direct-v2-e2e-20260730t120036z/actions/runs/38553188388),
attempt 1, approved review head `99e768ba54b48f338ebe7599ac5db7af1ad626c9`,
failed: three provider requests completed, a fourth retained `effect_unknown`,
and no final parsed review or App publication was accepted. Terminal receipt
SHA256 `1fc94276f7dc474e49e275102e1ab2a4495ecafcd4e0957a15f22d555c0dab9c`
records PARTIAL, revoked authorization, expired lease, fenced native execution,
cleanup DONE and zero occupied transports; exact native per-request closure ACK
remains unverified. Neither cleanup nor completed requests proves successful review.

Selected lease receipt SHA256
`a98af3ddf66eba84291f02e7545b9a410f459af5e054ce9e837365e9051c5d1a`
proves expiry exactly 600000 ms after acquisition; sanitized CI records Codex
CLI abortion 13 ms after that expiry, while the authorization deadline remained
in the future. Investigation identified an acquisition-anchored API renewal
bound despite the domain's now-relative duration checks. Renewal correction and
agent runtime-budget alignment require focused regression, independent review,
normal delivery and a fresh ordinary E2E. This checkpoint qualifies no fix or
whole-plan completion. Failed effects and prior evidence remain retained;
no replay of the failed invocation is permitted.

## Production delivery correction - 2026-10-12

Production acceptance remains incomplete. Disposable run
[38280189965](https://github.com/777genius/rr-selfhost-direct-v2-e2e-20260730t120036z/actions/runs/38280189965),
attempt 1, head `ef92ea8c96fdc6bfbc4b697c45d094eaefbafb4e`, failed before agent
execution with HTTP 403 / `review_request_intent_required`. It supplies no
provider tools, final review or publication proof.

The correction aligns the keyless caller with the existing durable dispatcher:
dispatch-only ingress, the three request/PR/head inputs and request-correlated
run title. API admission reuses the existing PR-size policy and durable intent
CAS before rereading the bound admitted intent. Canonical revision, release and
live authority checks remain required; no direct admission write or legacy
grant fallback is introduced. Historical failed intents remain unchanged;
recovery uses a fresh normal intent after the coherent release.

Action [PR 257](https://github.com/777genius/review-router/pull/257), head
`76d17acb06239b37037f3ed545d0a4ed09ad8f25`, prepares version 1.0.160 from
`325a4b16a33ae2dac7664cd026428b74272902f4`. Normal HOST build, metadata,
installer syntax and diff checks passed. Independent source/artifact review
accepted the six version-only postimages, including Action entrypoint SHA256
`e94383d10435c9e908e280458f994cf880d7f353ad0a8be46f5eacdbcfbdaa73`.
PR CI passed and PR 257 merged as `cc4aaec036d518f714691de3c8f84b7cb9f7f254`.
Normal Action release run
[38291736945](https://github.com/777genius/review-router/actions/runs/38291736945)
was dispatched once on that merge. The final nine-file control plane correction patch
SHA256 is `ffddb122e29901a247a055e898c7be0e0de957ddc7603fb32439e3de10808bed`;
176 nearest tests passed without skips, both API and feature typechecks passed,
and independent source review accepted it. These facts do not qualify paired
release, deployment or fresh production E2E.

Action release run 38291736945 subsequently passed; both `v1.0.160` and `v1`
resolve to `cc4aaec036d518f714691de3c8f84b7cb9f7f254`. The published entrypoint
matches the independently reviewed SHA256 above. control plane and production acceptance
remain pending.

control plane PR 559 CI run `38292719590`, head
`bc8539683f0cdd4b8ff8f23d1f5b5ac07ab54529`, failed one stale workflow fixture
that still expected pull-request ingress; 10,239 other unit tests passed and
496 were skipped. The corrected dispatch fixture passed all 67 focused tests
without skips and independent source review. Separately, Quality Gates never
started because GitHub reported an account billing lock. Remaining Linux jobs
are being routed through the already configured `CI_LINUX_RUNNER`, preserving
the external-fork boundary, macOS lane and every required check. Neither this
repair nor previously passed jobs proves a green new head or production E2E.

The production repository UI also exposed a missing Gateway display-readiness
branch: its existing binding was ignored in favor of legacy secret setup.
The bounded correction uses the current active, unfenced binding and exact
profile/model catalog for row and summary readiness, preserving actual health
failures and linking setup to Accounts. Twelve readiness tests, existing policy
and setup-panel tests, and web typecheck passed on the corrected source. Live
UI acceptance remains pending deployment. macOS CI on head `eb7f78c0` was again
denied before runner startup by the same GitHub billing lock.
That head's CI run `38295846597` also failed mandatory certification upload
because GitHub artifact storage quota was exhausted. Later quality steps were
skipped; a complete CI PASS is not established. Further qualification requires
restored artifact capacity and billing availability, with evidence gates intact.

Independent source review of this correction retained an existing limitation:
required-mode authorization renewal after execution links the intent as
`Dispatched` is denied by the base admission path. The default 60-minute token
TTL and shorter default execution budget do not require that renewal. The
accepted 20-minute D-long receipt proves operation after initial OIDC expiry,
not operation beyond authorization TTL; longer-than-TTL runs are not qualified.

## Accepted MiMo long OIDC and Action release - 2026-10-11

The [finite D-long receipt](../../docs/release-evidence/account-gateway-d-long-20261011.json)
has SHA256 `1eb6db1c1310ec566167de2bb83182970f9011ec81273fd88a8c87e661536850`
and verdict **PASS** for TEST server 20m/caller 25m. Run `38096112096`, attempt 1,
head `214df7feece682ca423433e5c8574bc470c4d23b`, used TEST Action
`2515a08bd761cc61e7f2aa354326d26530f10a57`, installed API
`2986b337c0faee9eeb3832020e307f8c3db80385`, Gateway
`77e4028070108fce0017a33df12e51c9f75abb55` and native
`d746e0cd43bc0e2de19f79f45fb6a10d00973a32` / ELF SHA256
`9902daad3393dd5c2a7071ddae9bdad4f785cf9e1046878b70496d8de458fa72`.

- Twelve authenticated, untainted successful MCP dependencies and an actual
  MiMo model match precede the strict nonempty accepted final artifact (2463 B),
  completed coverage and same-head App publication (check `114343658768`, SUCCESS).
- Original OIDC expired at 23:50:32 UTC; continuation was observed at 23:50:33.524
  and review completed at 23:54:20.037 on October 10. After the October 11 server
  deadline 00:05:35, the request at 00:05:36.965 returned 401. Nonempty execution,
  request and status sets remained unchanged, with three completed requests.
- Execution closed, occupancy 0, lease released and slot satisfied; all 21
  histories were retained, including the previous 20. Genuine gpt-6.1-sol/xhigh
  independent audit accepted this bounded receipt; report SHA256
  `baf3b5a4fa49c6d958ca3124ebb687368154afc98939f94ef9e43ab1455fd7a5`.

Accepted source-equivalence report SHA256
`f326143464b583bb45d62d0220d44fba2452cd7defbed301a555b21934685c76`
joins the shared production orchestration/transport/tools/final/publication
boundary to Action `daabf92413aa0667053f169cac320279f77b9e74`; TEST timing and
generated artifacts remain distinct. Normal Action release run
[38097430688](https://github.com/777genius/review-router/actions/runs/38097430688)
completed SUCCESS. Published [v1.0.157](https://github.com/777genius/review-router/releases/tag/v1.0.157)
and stable `v1` both resolve directly to that commit, tree
`974a03fcef8ff65338e52d87a36aa422fe8a1f61`; published `dist/index.js` is 4341414 B,
SHA256 `50a9f0bf435b29d2b797098c46dc449ee2287d650483621f13eefedb2412f475`.
At that checkpoint, the five CI pair fields consumed that verified release tuple.

This receipt does not qualify production timing/policy, memory, all-provider
D-final, protected OAuth F, legacy retirement G, native exact-head CI or control plane
deployment/release. Those gates and contract 53 remain unchanged; earlier failed
receipts retain their original outcomes.

## Delivery acceleration decision - 2026-10-11

Execution policy only; contract 53 remains the sole normative acceptance authority.

- Prioritize MiMo/OAuth tools, validated final review, same-head App publication
  and coherent Action/control plane release. Reuse accepted bounded D-long evidence within
  its recorded scope.
- Stop the separate RAM lane, including the existing optional
  `TestGatewayNativeMiMoMaximumCopy32` observer/client fixture. No RAM probes,
  new measurements or new maximum-body copy-risk tests in this finish. Preserve
  its original FAIL and all failed/unqualified receipts; this stop does not
  qualify numeric memory gates for D-final.
- Reuse accepted exact-source review, CI, built artifacts and lockfile-bound
  dependency caches when the relevant source and dependencies are unchanged.
- After a necessary fix, verify the smallest unproven boundary; retain normal
  mandatory CI and independent review for the final candidate.
- Reuse owned runtime fixtures and disposable repositories. Preserve unknown
  effects and replay protection; necessary bounded TEST runs require fresh
  source/authority checks and no automatic replay after an unknown outcome.
- Required lifetime/cleanup, ordinary transport closure, actual OIDC and
  custody/restore checks, actual tools, a nonempty validated final, same-head
  publication and the normal release process remain required. Keep external
  CI restrictions explicit; missing or failed checks are not PASS.
- No new SDK/platform abstractions, architecture/provider expansion or optional
  coverage work is planned for this finish.

## Finish priorities - 2026-10-11

- MiMo live tools/final/same-head App publication is already evidenced by run
  `38096112096`; reuse that result unless relevant source or configuration changes.
- Execute OpenRouter and native Sub2API Codex OAuth qualification in parallel.
  Keep release preparation as a third lane, with one owner for each lane.
- Stop further RAM experiments. Preserve historical failed receipts and the
  accepted optional MaximumCopy32 exclusion; do not silently convert failures to
  passes. Continue only the required lifetime and cleanup checks.
- Action transport diagnostics and its two review fixes use the existing five-case
  TLS fixture. After independent review, perform one changed-source build and one
  new-head CI watch before merge. Reuse the resulting artifact across consumers.
- Publish Action 158 before updating the five paired control plane CI pins. Use the actual
  immutable tag commit and generated public Action bundle digest, not placeholders.
- An expired OAuth intent is not a successful enrollment. Preserve its operation
  history and reconcile through the supported lifecycle before a fresh login.
- Production qualification requires an authorized existing credential/execution
  path. Do not work around a rejected credential transfer using another executor.

## Retention evidence reconciliation - 2026-10-11

Gateway Checkpoint B run `38119199177` passed at exact source
`c598146dfc63113635e4bfd6efd8df7cd10fe127`. Both Node 24.21.0 and 26.10.0
jobs passed the unfiltered `postgres.test.ts`, `management-postgres.test.ts`
and `facade-postgres.test.ts` command, dump/restore client preparation and
container cleanup. The current PostgreSQL tests cover deadline-based payload
compaction, preservation of unknown effects/occupancy/pending fences, restore,
replay proofs and saturation. Critical replay/history/readback/fence/native
facts are retained indefinitely under saturation; redundant payload compaction
requires the approved deadline, terminal effects, exact closure and completed
cleanup. Reuse this exact-source qualification instead of another retention run.
This evidence does not establish production custody or complete E/F/G.

## Action 158 publication - 2026-10-11

Action PR `777genius/review-router#254` merged as
`4cb00b4598974bc8fb5feafc1b1699ca76ca32af` after required CI run `38128268126`
and independent review of the observer rejection and duplicate-diagnostic fixes.
Release run `38128645739` passed; immutable tag `v1.0.158` resolves to that
commit. The public `dist/index.js` SHA-256 is
`166ab590292c76ea78b2015dfda71aacf91be963b0b94f7c04f9c7883c18a814`.
control plane five-field CI pairing PR [548](https://github.com/777genius/review-router-ai/pull/548)
merged normally as `1f10d0c327f0a16c9d9114fd8a331bb386a82761`, preserving
`d349cb19243426c7873cab2c529233f7c3a29e21` and reviewed component
`fc28708689efe1185b9ef8a9d9b639ce4606cbee`. Exact-head CI `38129571872`
passed all ten enabled jobs; the private PG16→17 rehearsal was intentionally
skipped on the component PR and is not final release evidence. The existing
verifier accepted the clean published Action checkout, tag, commit and bundle;
independent review accepted exactly the five metadata pins.
This publication and pairing qualify the Action artifact and source stack,
not production deployment or native Codex OAuth F; the OpenRouter receipt below
qualifies only its recorded E scenario.

## Accepted OpenRouter nano E receipt - 2026-10-11

The [finite E receipt](../../docs/release-evidence/account-gateway-openrouter-nano-20261011.json)
has SHA256 `4102911dadc93bc3ddb784e882271d246fdc47231ae22d539689280273be7133`
and verdict **PASS** for disposable PR2. Run `38131140682`, attempt 1, head
`fc227ccbc9fd5092e27a1c582af8f22174f495a8` used published Action158
`4cb00b4598974bc8fb5feafc1b1699ca76ca32af`, producer release
`rr-openrouter-published158-oct11` and model `openai/gpt-5.4-nano`.
The receipt pins native `82a6c219414996c8780b20d057629a5cd97da7f4`, Gateway
`c598146dfc63113635e4bfd6efd8df7cd10fe127`, API
`2986b337c0faee9eeb3832020e307f8c3db80385`, their installed digests and the
runtime/identity/policy readiness tuple observed at `2026-10-11T10:11:47.506Z`.

- Authenticated context v3 recorded fourteen successful operations: twelve file
  reads, canonical inventory and a git fact, with no confinement taint or terminal
  failure. The server accepted a 2149 B observation and a strict nonempty 8857 B
  finalized projection with one finding and completed coverage.
- Workflow succeeded; App bot review `5482899040` was published at the same head.
  Durable history contains 25 executions with all 24 older states preserved.
- Slot satisfied, lease released, kernel execution closed, six requests completed
  and occupied transports zero. Collectors made no additional provider calls.

This is profile-specific tools/final/App/closure acceptance, not production
installation, native OAuth F, G custody or RAM qualification. Context had zero
changed-path witnesses; contract 53 requires profile tools/final/publication,
not a mandatory changed-path tool for this E scenario. Historical run `381242`
retains its UNKNOWN network cause; preissue `78280` issued no effect and its
failed subguard remains UNKNOWN. Old unknown scopes were not replayed.
Contract 53 and the remaining release gates are unchanged.

## Source promotion and production qualification order - 2026-10-11

Contract 53 requires G after D+E+F and exact release gates; it does not require
production G before merging qualified source to protected main. Follow the
[release runbook](../operations/07-environments-and-release-management.md):
component review/CI → qualified final source main merge → exact-main CI →
trusted release artifacts → disabled-dispatch installation/staging → actual G
custody and retirement → real-user activation. Reuse the exact-main CI run for
both required PostgreSQL jobs; no component-PR skip qualifies that release.
The existing main-CI Action sync and GitLab `v1` image publishers remain active;
relay disablement does not suppress their artifact publication effects.
Provider auto-deploy stays off. The supported runtime deploy requires its
normal immutable image/attestation and trusted migration evidence first.

A fixed read-only migration-history preflight in the existing approved GitHub
credential holder is source preparation, not native production custody. Its
protected-main source and runner reachability remain prerequisites; do not
reroute credentials or bypass the rejected production DSN transfer. Native
installation authority/assets and actual dump/restore with new issuer and
quarantine, key rotation/readback/erase, old admission/refresh/grants closure,
sole refresh writer and retained unknown effects remain required before new
real-user work. No source receipt or disabled staging waives those checks.

## Accepted composed evidence and main source checkpoint - 2026-10-11

The following accepted receipts qualify their original scenarios and source
tuples. They preserve earlier failures and unknown effects; they are not new
provider calls or production custody evidence.

- **C3 Accounts and batch UI:** actual Chromium attempt 15 at
  `8485056518a1f7995936440d513283e1326d48d0` qualified the two disposable
  repositories `1317214237` and `1317220367`: conflict/applied per-target CAS,
  preserved selections and
  truthful partial result after RSC refetch, unchanged secret names and exact
  configuration restoration. Receipt `c1e52d1b479a216f8f13190a857b5c52227aac64bea7ba6b4c585ce169329986`,
  scenario `0defd48032257089e39cda0a989c689adc6fdb4210fec9d845e8dd70a58aea35`
  and cleanup `e5f755797f29861c310bdd7dda050760250bb221ff6a42844862655f7f6a9f41`
  are SHA256 bindings. Cleanup removed the browser profile and test rows;
  the canary binding was intentionally retained. Accepted source-impact receipt
  `b4deb97d2e2bd42cb1fd0bcf561fc4b76ad71fcec68be15ffee268568688dad6`
  binds the original proof to ROOT899. Bounded follow-up source inspection
  permits reuse across PR550 and main below: from ROOT899, the
  Accounts/batch production paths remain unchanged; the only web delta is the
  Node26 OAuth test storage-realm repair. This is reuse of attempt 15, not a new
  main-head browser run or acceptance of the pending public OAuth callback UI.
- **Numeric closure and cleanup, non-RAM:**
  `fixture.actual.public.json` SHA256
  `a2c5b53dbd6b91d290f0bb3fc27a4f2def0e75b2e773487fd8a4e8446825cfaf`
  records one selected test PASS, no replay/build/provider call, and the existing
  45000 ms automatic-closure and 5000 ms cleanup-settlement assertions passing.
  Per-bound durations were not emitted. Final occupancy is zero; the execution
  scope and cgroup are absent. One unknown effect remains retained alongside
  three completed requests. The previous failed nonce remains historical.
  This qualifies neither RAM/MaximumCopy32 nor production erasure.
- **E OpenRouter:** the finite nano receipt linked above remains accepted at
  its original native/Gateway/API tuple and published Action158. It proves
  authenticated tools, strict nonempty final review, same-head App publication
  and exact closure; it is not rerun or relabelled to the newer native source.
- **S composed operator workspace:**
  `S-composed-acceptance.actual.public.json` SHA256
  `498a73a57a940b2bf99ead6fe3492bbb6c0d8ca1a393db6694747e086ef4ab71`
  records original invocation `40010` EXIT0 and exactly one selected PASS with
  no failed or pending tests. Genuine Go/Node/PostgreSQL with controlled TLS
  proved the canonical operator owner, persisted X/Y grants, shared cap one,
  ungranted denial, X revoke with Y live, held original ACK and continuous SQL
  showing no early release, then Y completion. Final SQL retains X unknown and
  spent, Y completed, two pre-dispatch denials and global occupancy zero; the
  execution scope and cgroup are absent. The shared ACK peer is a fixture-only
  correction, SHA256 `4159d5eed8ea55f44c6121d07ae8ff75c9f5eb0483f0f58f653d8be72c48ac3b`.
  This bounded profile made no real-provider calls and claims no erasure.

The numeric and S receipts both pin Gateway
`d73861a85e2a581b4006738a085036219a62af53`, native
`82a6c219414996c8780b20d057629a5cd97da7f4` and native ELF SHA256
`866c342af8234676ad34b4e38ac24c016b011ab8b64833a5c93c380a6f874640`.
Their historical pins remain distinct from native PR33's qualified source
`3d3ea7a40a2bff649a241025a935f8136fa9fe5e`, normal merge
`135fd7dee9ab1d93552709a05805d01867ce3c0b` and CI `38132249332` PASS.
Gateway PR44 merged as `16e1cc992e0447040faa6fbb4354a85c5000efbf` with both
CI runs `38131753903` and `38131753934` PASS; its production service/SDK
source remains equivalent to accepted `c598146dfc63113635e4bfd6efd8df7cd10fe127`.
Platform installation-source PRs `777genius/platform-infra#455` and `#456`
merged as `8e30074b68275193ed1e2836fe57054dbc1838be` and
`4c73b0868ef223d02236f2d4c1d1a310944737d5`. They prepare inactive installation;
neither source merge establishes production native custody or activation.

control plane PR550 merged as `924c7c5d88483ecc7fd24e00baacaadfc85a66a2`, preserving
current-main contributor history and the reviewed operational source pins.
ROOT PR490 then merged normally as
`d9d8dc89ee04143dcd9ad1d067a96af160a10086`, parents
`62ba30e90a6e644be7cd2a2a6dc451e85a77d780` and
`f70ff158e071944b053f8c785f0f827b1b6d0b94`, tree
`72aeee652736fe964a5faa212c4a68dcb28eb118`, after all ten enabled exact-head
PR CI jobs passed. Private PG16-to-17 was intentionally skipped on that PR;
the automatic protected-main run `38139493237`, attempt 1, then passed all
eleven jobs, including the private rehearsal and Dedicated Release Authority
PG17 contract. Both release-gate manifests bind this exact commit/run/job;
their archive digests match GitHub metadata. The paired Action artifact binds
control plane `d9d8dc89ee04143dcd9ad1d067a96af160a10086` to published Action
`4cb00b4598974bc8fb5feafc1b1699ca76ca32af`. This qualifies the recorded source
checkpoint; a later final F/docs release candidate requires its own exact-SHA
trusted CI evidence under the unchanged release contract.

Public-user native OAuth F remains incomplete: the localhost callback SSH spike
does not prove ordinary user enrollment through the RR UI, and the bounded
callback-completion component has its own qualification. Production G
installation/custody, new-issuer restore/quarantine, rotation/readback/erase and
retirement remain required before activation. Accepted D-long, C3, E, numeric
closure and bounded S do not waive these gates. RAM STOP and the MaximumCopy32
exclusion remain unchanged; unknown effect ledgers and old failures stay retained.

## Opus 5.5/xhigh finding dispositions

Every finding is resolved at plan level individually; the table records accepted
correction, justified alternative or explicit dependent gate, not runtime PASS.
Links are to the sole normative text. Existing B2/W5/C1 ownership is unchanged.

| Finding | Disposition and concrete decision                                                                                                         | Scope / dependency                                                                                                                                                                        | Nearest meaningful future observable test                                                                                                |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| P0-1    | Alternative to Redis spent-ticket authority: sole kernel SQL claim via Go reserved-entry admit callback; no TS preclaim                   | B2/B3, [53 §3](./53-account-gateway-implementation-contract.md#3-one-durable-admit-and-replay-protection)                                                                                 | Real duplicate POST/callback, restart and lost/delayed ACK: max one upstream entry, sealed reservation zero                              |
| P1-1    | Accepted positively attested rejected_before_dispatch; spent allowance and exact occupancy closure separate                               | Additive kernel/SDK patch before B gate, [§4](./53-account-gateway-implementation-contract.md#4-effects-allowances-and-closure)                                                           | Postclaim store:true/entered=false vs lost settlement; zero entry, later safe request vs unknown fence                                   |
| P1-2    | Accepted binding-id policySubject/pending fence; alternative retains independent policy/binding revisions                                 | C2, [§5](./53-account-gateway-implementation-contract.md#5-product-binding-policy-and-mirrors)                                                                                            | Pause X/Y, detach X+ACK, resume: X denied/Y runs; crash/delayed ACK; settings next-run pin                                               |
| P1-3    | Accepted relay-only bounded local admission_limited+not_dispatched wait                                                                   | C2/D, [§6](./53-account-gateway-implementation-contract.md#6-relay-wait-ci-trust-and-ui)                                                                                                  | Two invocations/cap1 each completes once; wait exhausted busy; partial stream/new-ID fence                                               |
| P1-4    | Accepted birth UUID vs internal refresh version; alternative keeps auth epoch independently owned                                         | F, [§2](./53-account-gateway-implementation-contract.md#2-private-http-and-persisted-identity)                                                                                            | Actual OAuth refresh mid-tool-loop same row/epoch; reconnect old authority denies                                                        |
| P1-5    | Accepted explicit S operator workspace + special grant; own BYOK independent                                                              | S after D, [§8](./53-account-gateway-implementation-contract.md#8-qualification-retention-and-delivery)                                                                                   | Granted succeeds, paid/ungranted denied; same physical cap and X revoke/Y unaffected                                                     |
| P1-6    | Accepted managed-row AEAD envelope/server-only outside-DB key and scoped AAD                                                              | Real-user release; F extends all OAuth paths, [§7](./53-account-gateway-implementation-contract.md#7-custody-and-account-lifecycle)                                                       | Actual DB/cache/dump/export plaintext absence, rotate/readback quarantine and restored-epoch denial                                      |
| P1-7    | Accepted CI misuse/source disclosure limits; alternative preserves inspected RR fork policy rather than blanket ban                       | C2/D, [§6](./53-account-gateway-implementation-contract.md#6-relay-wait-ci-trust-and-ui)                                                                                                  | Existing allowed/denied event classification, privileged head denial, head/attempt mismatch, master absence/close; scrub not job secrecy |
| P2-1    | Justified alternative: retain mandatory E and F prerequisites for G; OpenRouter is owner goal                                             | G after D+E+F, [§8](./53-account-gateway-implementation-contract.md#8-qualification-retention-and-delivery)                                                                               | Retirement stale grant/workflow/refresh denial only after exact E/F qualification                                                        |
| P2-2    | Justified alternative: retain encrypted short-TTL transient intent until equivalent crash/readback/erase custody is actually proved       | B3a/F, [§7](./53-account-gateway-implementation-contract.md#7-custody-and-account-lifecycle)                                                                                              | Crash/lost-create-ACK finds single exact generation; no second create; expiry erases ciphertext                                          |
| P2-3    | Accepted dedicated single fixed private engine; no per-org admin/scheduler or second Concurrency limiter                                  | B3/D, [§2](./53-account-gateway-implementation-contract.md#2-private-http-and-persisted-identity), [§4](./53-account-gateway-implementation-contract.md#4-effects-allowances-and-closure) | Assembled listener exposure and private cap behavior; old process prevents new start under real Linux lock                               |
| P2-4    | Accepted system-owned repo/config binding admission without synthetic user actor                                                          | C2/D, [§5](./53-account-gateway-implementation-contract.md#5-product-binding-policy-and-mirrors)                                                                                          | Real run registration succeeds with server authority; stale/revoked original config denies                                               |
| P2-5    | Accepted revoke+ACK -> cleanup+erase -> tombstone -> owner deletion                                                                       | C2 and H deletion, [§5](./53-account-gateway-implementation-contract.md#5-product-binding-policy-and-mirrors)                                                                             | Actual owner delete pending with occupied stream, completes after exact closure/erase; Y history retained                                |
| P2-6    | Accepted TTL/tombstone policy; concrete numeric bounds derived at D, not invented now                                                     | D-final/release, [§8](./53-account-gateway-implementation-contract.md#8-qualification-retention-and-delivery)                                                                             | Expired safe records GC; unknown/occupied/pending-fence and restore-reachable tombstones retained                                        |
| P2-7    | Accepted retain existing full saved-envelope checks; no renewal interface/authority expansion                                             | B3/C2, [§2–3](./53-account-gateway-implementation-contract.md#3-one-durable-admit-and-replay-protection)                                                                                  | Reuse accepted full-envelope PG evidence; changed field/deadline or stale epoch at real composed admit denies                            |
| P2-8    | Accepted mirror refresh after mutation/readback and Accounts GET with safe revision CAS                                                   | C2/C3, [§5](./53-account-gateway-implementation-contract.md#5-product-binding-policy-and-mirrors)                                                                                         | Out-of-order actual readbacks cannot replace newer safe metadata or grant use                                                            |
| P2-9    | Accepted controlled credential/profile staging then explicit first canary; alternative rejects generic401 NoEffect or implicit paid probe | B3/D, [§7](./53-account-gateway-implementation-contract.md#7-custody-and-account-lifecycle)                                                                                               | Staging cannot infer; only qualified non-inference check; lost/401 actual transport never grants replay                                  |
| P2-10   | Accepted single concise normative 53, evidence separation and exact contract in every packet                                              | DOC PLAN/main packet assembly                                                                                                                                                             | Light link/line/coverage/hash checks; main compares supplied base and accepted packet digest                                             |

## Primary acceptance owners (no newly qualified product scenarios)

| Scenario                              | Expected evidence / nearest boundary                                                                                                                  |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Package/static graph                  | Install the exact archive outside the source tree; public exports/type closure; correct graph; invalid slot/missing factory rejected before effects   |
| Consumer/owner denial                 | Real facade+DB denies foreign references/role and unsupported profile, with zero native dispatch                                                      |
| Create/reconnect lost acknowledgement | Native adapter fault injection leaves one owned candidate; readback/quarantine; no duplicate row or silent activation                                 |
| Rename vs reconnect                   | Metadata rename preserves execution identity; reconnect revokes old authority and new calls use only the promoted generation                          |
| Native ID reuse/restore               | Stale route cannot select a different physical account; old permission denied                                                                         |
| Revoke race                           | Pause between RR admission and gateway claim, acknowledge fence, resume: no dispatch; already claimed effect retained                                 |
| Long run/deadline                     | Request after OIDC mint expiry and before approved deadline succeeds; after deadline or revoke denies new dispatch                                    |
| Cancel/partial SSE/crash              | Unknown outcome retained; no inference replay, duplicate publish or second refresh writer; cleanup after supervisor loss/restart                      |
| UI batch                              | Two disposable repos, per-target CAS and truthful partial status; saved selection/result survives refetch; server bindings change without key copying |
| Real RR CI                            | Actual CLI spawn, tools, final parsed review and publication at approved head; missing final answer is failure; no master in CI/logs/artifacts        |

Reuse existing disposable repositories after fresh App/permission inspection:
`777genius/rr-selfhost-direct-v2-e2e-20260730t115357z` (ID 1317214237) and
`777genius/rr-selfhost-direct-v2-e2e-20260730t120036z` (ID 1317220367).
Both were freshly read through `gh` as unarchived E2E sandboxes on 2026-10-02.
No inference, workflow dispatch or repository mutation occurred in this review.

## Current primary evidence - 2026-10-04

### 2026-10-05 delivery continuation

- Accounts PR500 is merged into integration PR490 at `9e3a1360`, preserving its
  reviewed checkpoints. Full current CI `37294738338` passed. Independent P72
  approved production; the final `0c1a11dd` changed handoff whitespace only.
  This is an integration-branch checkpoint, not production deployment.
- Action PR241 current `cfbac4d7` passed full CI `37296954336` and independent
  P79 source review. Meaningful types/build/artifact metadata passed; the two
  nearest suites passed 84/84, zero skips, including nine actual HTTP/process
  lifecycle cases. Three SCM cancellation probes fail under mechanically
  extracted old constructor/hook/sleep behavior and pass current source; this
  comparison is not a full old-checkout run. Full provider/App E2E is unproved.
- Server runtime-config PR502 `136cafcd` passed independent P80 source review,
  meaningful feature types/lint/format and 99/99 nearest tests, zero skips.
  Old production rejects the new valid saved-gateway acceptance scenario.
  Current full CI remains pending. The allowed workflow path issues no run
  capability and cannot replace OIDC, binding or executable release checks.
- P78 keyless Action workflow and P81 generated server caller are isolated
  hosted writers on account-v, `gpt-6.1-sol/high/default`, without fast mode.
  Their output has not yet been accepted. D-min/D-final/S/E/F/G remain required;
  H sharing remains deferred. No release is published.

- The SDK remains 341 physical TypeScript lines. Accepted package/kernel/native/
  Node/RR ownership/config foundations do not imply product E2E completion.
- Native bootstrap/closure is accepted at `045c24ce`; the independently reviewed
  CI-only SKIP-guard correction is merged at `0a88c37f`. Production Go is unchanged
  between qualified source `7253363a` and that correction's merge tree.
- Gateway transport/authority PR8 is merged at `b7948792`. Actual native Responses
  Go/Node/PostgreSQL assembly source `5faa7702` passed controlled qualification:
  1/1, zero skips, encrypted create/readback/erasure, two requests in the SAME OPEN
  execution at concurrency one, authenticated physical-close ACK, wrong-role denial
  and exact launcher retirement. Independent source APPROVE and current CI passed;
  PR9 is merged at `da8b8030` with the same tree. This upstream is controlled,
  not a real Codex/MiMo/OIDC/parser/App publication receipt.
- RR C2b source `daf0141b` has independent source APPROVE and current CI success;
  PR495 is merged into the integration stack at `4540552f`, preserving ancestry
  and tree. Actual effort preservation: BEFORE 27/28 with one failure, AFTER
  28/28 without skips; web typecheck passed. Guarded private PG16-to-PG17 rehearsal
  was SKIPPED, not accepted as passed.
- Live backend App credential/HTTP component qualification on 2026-10-04 used the
  production `@octokit/app@16.1.2` dependency and strict typecheck. App `3586778`
  authenticated; both listed E2E repositories have active installation `130833075`
  with PR/issue write permission. Zero installation tokens, dispatches, repository
  writes or model requests. The earlier helper's JWT via GH_TOKEN HTTP401 was a
  diagnostic auth-scheme error, not evidence of an invalid private key.
- D-min remains unqualified: actual T0/OIDC, agent tools, nonempty parsed final
  review and same-approved-head App publication are still required. D-final/S/E/F/G
  remain required; H sharing is deferred. Full goal remains active, no release.

## Historical primary evidence - 2026-10-03

- Native W5 raw guard6008eaa5, main-qualified postformat patch7be954dc and owner ef36a8a9:
  four pinned Go suites PASS; same new tests fail behavior on oldfa16 with successful compilation.
  Exact fullCI37116107145, native37116107047 and security37116107020 PASS.
  Independent exact-source review remains pending; no native runtime/provider/product receipt.
- C1 catalog raw5920, qualified patch5c6248a0 and owner16594567 on root490:
  216 catalog +16 auth +8 actual PG cases PASS, fresh full116 SQL.
  CI37116108945 C1 and fullCI37116108967 selfhost/release/build checks PASS, but
  Unit tests found three stale full115 fixture expectations. Their bounded correction and final
  exact-head CI/review remain pending. Historical96/managed92 authorities remain unchanged.
- B2 timed-out rawf832 was mechanically retained as UNQUALIFIED owner be978224.
  Main actual partial-source type/domain and27/27 PG PASS at that exact checkpoint.
  Finish delta873be837 changes handoff and legacy test only; final tests/review/CI pending.
- Root490 remains draft; all product/D acceptance scenarios remain unqualified.
  No provider key, auth bytes, inference, deployment or legacy retirement occurred here.

## Historical gate interpretation - 2026-10-03

A/package-static graph is accepted source/installed-artifact evidence; no new
product scenario is marked PASS. Merged kernel1ea is a private foundation.
Native fa16 CI is source proof with four open F defects; terminal W5 patch is
unaccepted pending main qualification. Terminal C1 catalog still needs fresh
migration117/full-schema and exact review/CI. C1 auth16/PG8/historical31 are
historical source receipts. B2 is active in another owner lane. B3 report is a
plan, not Linux/native closure implementation. No new provider/daemon/deploy/
retirement receipt exists here. D-min tools/final/publication precedes full UI;
D-final additionally requires UI batch, measured enforced bounds and long OIDC.

RR policy inspection for P1-7: current `action-control-plane` domain admits
pull_request and pull_request_target in its explicit event vocabulary and
selected repository/workflow checks. `prelease-codex-rotating-oauth` resolves
pull_request_target PR identity through a workflow-run verifier, and
`prepare-certified-fork-review` validates a server-bound fork prompt packet.
Those actual source paths contradict a blanket “forks unsupported” assumption;
they do not by themselves qualify new gateway grants. C2/D must preserve the
applicable current App-first policy and run source-classification tests.

## NONNORMATIVE historical readiness and evidence

The original readiness prose and chronological receipts are retained below
with section headings nested under this NONNORMATIVE evidence section, including hashes, failing setup, REQUEST_CHANGES, old NOT_RUN states
and historical fast modes. They describe their dates/candidates, not current
runtime availability. References to contract 52/vision 50 as runtime authority are
historical; contract 53 exclusively supersedes them. Future worker terminal state
is not acceptance. No historical PASS becomes a new product-scenario PASS.

### Readiness assessment - 2026-10-03

The first slice has enough specification to implement A and investigate B
without inventing product policy. It is not yet a frozen specification for
every native adapter, database transaction or capacity setting. Keep these
bounded decisions in their implementation packets; do not expand the platform
or postpone A while collecting unrelated future-profile evidence.

| Remaining decision                              | Required output before dependent work is accepted                                                                                                                                                   |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B: native physical identity and generation pin  | Exact engine API/patch and persisted identity proof, tested against deletion/reuse, reconnect and lost acknowledgement; inability to prove identity denies dispatch                                 |
| B/C: concrete persistence and RR policy mapping | Selected existing-compatible DB/tooling, migration/unique constraints, atomic claim/fence/promotion transactions and RR membership/binding fields; real concurrent DB tests, not only HTTP fixtures |
| D: capacity and lifecycle bounds                | Numeric enforced request/output/buffer/concurrency limits, approved deadline and cleanup target, with repeated-burst and supervisor-loss evidence on the pinned candidate                           |

Assessment: **8/10 for implementing the first vertical slice**, not production
readiness. The remaining details are bounded decisions below, resolved before
their dependent acceptance gates. They are not reasons to add a general plugin
platform, a second scheduler or migration of the old subscription pool.

Required implementation details from current review and CI evidence:

- Capture trusted consumer, command intent and native acknowledgement proof
  primitives before any await. A mutable caller object must never change the
  durable owner or physical execution/cleanup target during a DB lock wait.
- Every additive RR migration must register its exact checksum in the current
  checkout catalog and the explicit checkout-only exclusion set. Preserve all
  admitted historical manifests and the immutable historical96 rehearsal.
- Keep local transport occupancy until close acknowledgement, including revoke,
  crash and supervisor loss; permanently spent request/token allowance is a
  separate durable fact. Derive numeric capacity limits from the isolated
  workload and enforce them before D acceptance.
- Prove a real CLI run with tools, a final parsed review and publication at the
  approved head. A green workflow alone cannot satisfy that scenario. Include
  denial after deadline/revoke and operation after the OIDC mint has expired.

Concrete B persistence decision (implementation packet, 2026-10-03): dedicated
PostgreSQL 17.10, numbered SQL migrations and pg/@types/pg 8.23.1, verified from
the registry. No ORM or shared RR writes. The domain owns account/effect policy;
the PostgreSQL adapter owns atomic claims, CAS and durable cleanup. Real parallel
connection tests are required before acceptance; the choice alone is not proof.

Deployment clarification: the dedicated persistence boundary does not require
a separate PostgreSQL server. Reuse one shared PostgreSQL instance; do not create
a database per worker, user or workspace. Use a separate logical test database
only when an empty-schema or destructive test would otherwise interfere with
another run. Reuse populated fixtures for continuation; do not reset or replay
their migrations. There is no legacy user-data migration requirement for this MVP.

Native B candidate uses opt-in private `RegisterGatewayNativeRoutes`, an
immutable native UUID/generation and creation identity, plus a fresh exact-row
check before one transport dispatch. Candidate patch `64912046` passed actual
Go compilation/HTTP tests and PostgreSQL 17.10 shape, erasure, tombstone and
two-session locking tests against stock source `96f4c115`. This selects a
concrete implementation path. Subsequent independent xhigh review requested
six corrections: mutation before the managed-account guard, timestamp equality,
false completion in the legacy bridge, reasoning-cache namespace collision,
multiline SSE parsing and completion waiting for upstream EOF. None is waived
by the earlier passing tests. The default-tier native repair job owns these
corrections; exact fixed-code regression/review, facade composition and live
provider use remain required. Stock route registration is not changed by the
candidate, and these tests do not qualify production deployment.

A documentation adoption is deliberately scoped to actual docs/ and package
READMEs. The supported Docs Protocol 0.6.2 catalog cannot express a repository-root
README collection. Root README remains bootstrap-owned; this limitation is
explicit in COMPOSITION and does not imply repository-wide protocol coverage.

Checkpoint A was merged as account-gateway PR 1 on 2026-10-03, commit
`07234f6064e202ed0d6a00922b8b3cca40a5bcad`. Independent xhigh approval covered
40 actual source fingerprints, all verified against reviewed head `226a0907`;
exact-head CI run `37087576311` passed. The merge tree equals that reviewed tree.
The private durable kernel prototype separately passed 2 domain and 9 real
PostgreSQL tests, but its opaque-attempt/binding/full-limit wire bridge is still
required. These are checkpoint results, not A–D product acceptance.

Current qualification update, 2026-10-03: the selected-result SDK correction
was merged as PR 2, commit `83f0c7ca236d27b8576853c0b6a44d8b8e8d2283`.
Independent `gpt-6.1-sol/xhigh/default` review approved the actual source; all
59 public-file fingerprints matched reviewed head `9c7a97d9`. Exact-head CI
`37094694480` passed. A new hosted sandbox passed all 25 tests and two installed
outside consumers; the applied-result regression failed on the earlier schema.

Historical kernel PR 3 head `5f07a18be3e5650495bd0b942b09f9438df50309` fixes the
active-worker lease and restore-generation cleanup defects found on `8cc30167`,
plus the smaller source/test issues. A fresh assembled-code sandbox passed
15 of 15 actual PostgreSQL cases and all 26 root tests. Two new behavior cases
failed against the old production implementation. Exact-head CI runs
`37099157508` and `37099157453` passed. Independent
`gpt-6.1-sol/xhigh/default` review requested two additional fixes: classify
an expired in-flight owner before another request can claim spare concurrency,
and snapshot an account command before awaiting a transaction. All 69 reviewed
source fingerprints matched the exact Git tree. Remediation also freezes the
trusted consumer ID across awaits. Merge is not yet approved.
Current kernel head `aea6ed03` fixes those two findings and trusted-consumer
capture. Fresh PostgreSQL qualification passed 18/18 without skips; all three
new mutation/lost-owner regressions failed on old `5f07a18b`. Exact-head CI
`37103989743` and `37103989738` passed. Independent xhigh/default review,
bound to all 69 exact Git-tree fingerprints, requested one additional repair:
`acknowledgeCandidate` must snapshot its native proof before waiting for the
transaction. F3 is fixed in owner head `9f0f65bb`: all 19 actual PG cases passed, and the
one new proof-mutation case failed on unchanged `aea6ed03`. Exact-head CI
`37107294989` and `37107295009` passed. Final independent xhigh/default review
approved the bounded kernel; all 69 public-file fingerprints and the complete
tracked path set matched that exact Git tree. PR 3 was merged as
`1ea091f87443fa2d20b391dd0aaddbd5f1d44d89`; its tree equals reviewed `9f0f65bb`.
GitHub author is `777genius` with the owner's email and the squash message
retains `Refs #1`. B2 starts from this merged main, not a dirty spike checkout.
The private kernel is not yet a running facade/native service.

Native repair `1fa66c61` passed native/ordinary Go tests, the actual standalone
Redis repository test and actual HTTP/Redis isolation. Fresh real HTTP/PostgreSQL
still returned 409. A separate synthetic sandbox established the cause:
stock migration 175's billing trigger inserts
`openai_long_context_billing_enabled: false` before the private generation
trigger, violating its strict seven-key allowlist. The Go normalizer correction
alone was insufficient. A narrow native migration correction must preserve
ordinary billing-trigger behavior and private identity guards. A separate
sandbox experiment excluding private markers from the stock billing trigger
passed the actual HTTP/PostgreSQL test and all eight nested cases. This proves
the proposed direction; it does not qualify the future worker patch or fork.
Exact repaired-code qualification and independent review remain required.
Actual ambiguous-field regression also failed on the earlier native boundary
and passed on `1fa66c61`, including zero transport entries for duplicate policy
keys. This proof does not close the pending token-cap/profile gate.

The two isolated remediation jobs finished in `gpt-6.1-sol/high/default`.
Native guarded candidate `1359a3d1` preserves ordinary billing defaults while
excluding private marker rows from stock billing normalization. Its actual Go
native/ordinary checks and fresh HTTP/PostgreSQL test passed, including all
12 nested cases: ordinary SQL/repository billing behavior, both private
profiles, exact private extras, malformed marker denial and identity guards.
Standalone and HTTP Redis tests passed on dedicated empty fixtures. SQL shape
and concurrent locking qualification, canonical fork commit and independent
fixed-code review remain required; no facade or live-provider acceptance is
implied by these native boundary checks.

C1 returned guarded patch `3a5aed10` from the isolated RR `account-gateway-v1`
code workstream at canonical main `f0c18bf7`, with
`gpt-6.1-sol/high/default`. Its bounded scope is owner/connection/binding
persistence and existing workspace authorization. Main qualified pinned frozen
installation, full Prisma generation/validation, typecheck/build, architecture,
seven lightweight cases and six real PostgreSQL scenarios after all 115 SQL
migration files. The initial historical CONCURRENTLY fixture failure was fixed
by using actual psql, without changing historical SQL. PR 488 head `1a9fa9c8`
passed dedicated CI `37104443106` and the existing self-host E2E job. Full CI
found an unregistered current checkout catalog; its correction now passes all
205 affected catalog tests, preserving old manifests. Owner correction head `96b0b8b3`
is pushed. Independent review of `1a9fa9c8`, bound to all 22 exact fingerprints,
found R1 tenant command/nested-actor mutation across authorization awaits and
R2 adapter scope/revision/metadata mutation across transaction waits. The bounded
high/default repair returned guarded patch `58303820`, integrated as owner
`9e1e581f`. Fresh main qualification passed lint/type/build, architecture and all
16 auth/fixture cases. Old production with the new tests failed nine auth cases.
Separate new PostgreSQL17.10 clusters applied all115 SQL files: two new nested
adapter cases failed on old production; the fixed candidate passed all8 cases
including root, with zero skips. These remain receipts for the pre-reconciliation
candidate, not proof for a later numbered migration.

Full CI `37107000439` found a historical through79 fixture returning the new
`Workspace.personalOwnerUserId` through current Prisma. Owner `613ad69d6`
limits fixture create/delete output to `id`; all31 actual historical PG cases
then passed on a new cluster with the stock CI role-provisioning sequence.
The initial isolated harness omitted that earlier CI role provisioning; its
handoff refusal is retained as a setup failure, not a product failure or PASS.
Both repair commits are pushed to PR488.

Main advanced to `e47607f4` and released another migration numbered116. Primary
merged that exact main into preparation `e4597001` and renumbered our never
released provider migration to117, preserving its SQL bytes. Published main
catalog authority was retained. A separate medium/default worker now registers
117's exact checksum, adds the new24-extension manifest, preserves old0..23 and
historical96, and reconciles current test catalogs. Final new-source full-schema
qualification, exact-head CI and independent xhigh review remain required before
merge; no production migration occurred.
Provider mutations, Accounts UI, repository configuration, OIDC and actual CI
publication are later C/D work; the C1 exit status cannot close those gates.

The reusable native source now has an explicit home:
`agent-teams-ai/sub2api`, a public fork of `Wei-Shaw/sub2api`.
Its `release/account-gateway-v0.2.11` baseline is pinned to `96f4c115`;
no private-native change has been merged there yet. Generated spike patches
are qualification artifacts, not a second runtime source authority. Production
composition will pin the independently reviewed fork commit/image. Upstream
latest stable was v0.2.13 on inspection; moving from the qualified baseline
requires focused compatibility/security qualification, not a silent upgrade.

Canonical native PR 2 head `d70ddf46` passed focused CI `37100218591`.
Independent review of `719c61e9` requested five repairs, with all 30 source
fingerprints verified: case-folded policy aliases, strict buffered completion,
checked buffered delivery, consistent terminal decoding and private diagnostic
suppression. Head `d70ddf46` changes only inherited CI SHA pins relative to that
review. Full CI additionally found five errcheck violations, a bulk-update test
stub regression and existing Axios production audit failures. These gates are
not waived by focused native success; both PRs remain open.

Native owner head `fa16ac72` now fixes all five review findings and the
errcheck/API stub problems. Actual native/ordinary/API Go contracts, fresh
HTTP/PostgreSQL12 nested cases and dedicated Redis repository/HTTP checks pass.
New behavioral tests fail on old `d70ddf46` with no compilation failure,
covering all five independent defect categories. A minimal actual pnpm-generated
Axios1.20 lock correction passed frozen install, typecheck, all302 critical
frontend cases and the unchanged audit exception policy; no Axios advisories
remain in the fresh audit. Existing unrelated advisories are not declared fixed.
Full exact-head CI `37107359703`, Security `37107359682` and native qualification
`37107359658` passed. Independent xhigh/default review of `fa16ac72` requested
four additional bounded corrections. All 36 changed and 16 supporting public
fingerprints matched the exact Git tree; this is not an approval:

- Private legacy dispatch must bypass ordinary Fast-policy transformation.
  A global ordinary `missing`/`force_priority` rule must not inject priority
  into an admitted default-tier private request. Preserve the ordinary rule.
- Qualify decoded critical response members before terminal delivery: native
  buffered `status`, SSE event `type`/`response` and nested response `status`.
  Duplicate or aliased names, including escaped names and either duplicate
  order, must yield unknown effect rather than successful completion. Preserve
  unrelated tool/user payload fields.
- The private legacy scanner must process complete, bounded SSE events, join
  data lines and require the blank-line delimiter. Two JSON chunks in one event
  and an unfinished DONE event cannot complete; one valid multiline JSON event
  must work. Preserve the ordinary scanner's compatibility behavior.
- Before legacy conversion completes, function-call indices must be dense
  `0..n-1`. Reject `{1}` and `{0,2}` without completed/DONE; accept out-of-order
  fragments `{1,0}` when both final calls are preserved.

The high/default W5 worker owns these native service fixes and actual transport
regressions. Main must qualify the fixed candidate and run the new cases on old
production where possible, then obtain a new exact-source xhigh review.
No native facade, provider traffic or production bootstrap is enabled.

B2's separate high/default packet owns only the private kernel. It makes the
existing server `maxConcurrent` bound an account-wide occupied-transport ceiling
across executions, including old generations and fenced/closed executions,
while retaining each execution's narrower approved limit. Claim and counting
share consumer serialization. Unknown effect, expiry, revoke or credential
erasure do not free occupancy. Exact private closure proofs and cleanup-owner
descriptors allow confirmed local transport closure after lease loss without
refunding spent allowance or changing unknown effects. Migration 001 stays byte
identical; numbered 002 and real concurrent PG tests qualify this contract.
Actual supervisor/transport closure remains a B3/D acceptance requirement.

E/F remain separate profile qualification, especially protected OAuth custody
and refresh. Neither SDK success nor MiMo BYOK closes those gates. The estimate
in plan 51 remains a range; implementation evidence may revise it. Completion
is measured by the acceptance scenarios below, not by generated LOC or a
worker's successful exit.

#### Historical plan51 readiness provenance

### Implementation readiness

This is a detailed architecture/delivery plan, not a frozen implementation
specification for every checkpoint. A can begin with public artifact and module
qualification. [First-slice execution contract](./52-account-gateway-first-slice-contract.md)
now supplies the proposed wire/storage, account-operation, bounded run/deadline
and restart-cleanup defaults for A–D. Freeze its schemas in A and prove the
native mapping/reconciliation in B before exposing execution in C/D.
OAuth protected custody and numeric capacity acceptance remain explicit later
decisions. These require actual evidence before their checkpoints can pass.

Independent 2026-10-03 readiness audit found two concrete omissions, now specified
in contract52: preparation/readback must return the selected safe account/epoch,
and initial MiMo tokens is a native per-request output/reasoning cap with
conservative request-slot accounting. The SDK result-schema correction and
actual native cap qualification remain required implementation gates.

Readiness review provenance: the 2026-10-02 hosted attempt used
`gpt-6.1-sol/high/default` and ended `partial / task_timeout` without report
artifacts. Its generic continuation was rejected with
`project_control_broker_required`; the job is no longer running. It is not a
completed independent review. Contract 52 is coordinator-authored; post-change
independent SDK review has now passed at exact head `226a0907`; PR 1 merged as
`07234f60`. Native review requested six fixes. Facade/RR and live product E2E
remain NOT RUN. Current evidence belongs to contract 52 and the execution ledger.

#### Historical provider documentation and B3 source references

MiMo Responses documentation observed 2026-10-03 described output+reasoning
1–131072 tokens, usage.output_tokens and incomplete cap exhaustion:
https://mimo.mi.com/docs/en-US/api/chat/responses . This is a documentation
candidate, not qualified Token Plan endpoint/model capacity.
Official Codex guide updated 2026-09-22 and observed 2026-10-03:
https://mimo.mi.com/docs/en-US/tokenplan/integration/codex-configuration .
Its Token Plan native Responses/model-catalog claim needs real D qualification.
Historical bridge is separate and never fallback after unknown dispatch.

The read-only Opus source packet includes vision-and-review-task.md,
opus-plan-review.md, review-decisions.md, context/q.md, context-manifest.json,
all source snapshots and b3-native-lifecycle-plan.md. B3 specifies inherited-lock
closure, not an existing universal supervisor platform. Its source pins1ea/fa16
are supplied provenance; no new Git identity is observed by this worker.
Main previously read LGPLv3 text at pinned96f4c115 per review-decisions.md;
license/distribution support is still a release gate, not legal approval.

Historical C inspection source: `f0c18bf7759c030f311cf21050d6a61718e9dcd4`
(2026-10-03); its schema/catalog/config source comparison matched earlier99f5e97c.
This retains the original full identifier, not a fresh HEAD observation.

#### Second-consumer architecture research, 2026-10-06

Independent `gpt-6.1-sol/xhigh` research is recorded in
[plan 54](./54-account-gateway-second-consumer-and-quota-plan.md).
Owner clarification: RR retains user/workspace-owned accounts; the second
product has a separate administrator-owned pool. Reuse covers service code,
images and SDK, not upstream accounts or cross-product grants. Separate service
configuration is the initial path; a shared-pool adapter is deferred. The second
product owns user/device authentication and quota reservations. Request
credits remain a proposal, not an accepted billing unit. This is a follow-up
after the current RR slice: no runtime or product gate is qualified, and contract
53 plus the RR provider/tools/final/App critical path remain unchanged.

#### Actual execution update, 2026-10-06 14:50 UTC

- RR PR512 merged as `9322ca52a971b8e766450c4ad715c7f4adbb0c2a` into the
  integration branch. Merge preserves parents `589a9700` and `d94f938d`,
  independently reviewed source checkpoints, owner identity and `Refs #490`.
  Current CI `37474111598` passed all six applicable jobs. This is an
  integration checkpoint, not provider or production acceptance.
- Native PR21 merged as `ad74e5318a6cafb7cfbe61e83176f34b13f853d1` after
  current CI and the real populated-PG SQL247 provider-profile rollback case.
  No production migration or provider inference follows from that proof.
- Action PR241 head `cac00289fdadc6e10a59ff4193967324d682a749` has independent
  xhigh PASS and current CI `37480158659` SUCCESS. The sole whole-PR finding,
  inconsistent MiMo reasoning effort in runtime/manifest identity, is fixed.
  One new ready-event canary `37481750236` is queued for disposable PR3 at
  approved head `47b30f3401ce3a505584116d95dd14a7c5731825`. Its original
  witness is configured under fresh nonce `d7fc4b1d-c0a6-4773-be3e-7e3953dcf7b1`;
  producer `rr-dmin-mimo-effort-cac-oct6` received an actual registration ACK.
  Old witness retired with typed ACK and exit0. No new tools/final/App receipt
  exists yet; old CodeRabbit/App comments cannot qualify this canary.
- ROOT service fixture nonce `60f74746e89fc589464a35dceb8216c9` passed source,
  SDK and canonical Go bridge compilation, then failed before creating its
  database pair. Read-only same-PG diagnosis proved PostgreSQL's address text
  is `127.0.0.1/32`; `host(inet_server_addr())` yields the expected
  `127.0.0.1`. Only the two address projections are being repaired. The failed
  nonce and compiler output remain retained; no migration/test PASS is claimed.
- Full UI public closure now has genuine distribution bytes built from locked
  upstream commit `83a7329f4383b05ac5c39356b79f82f029182d42`, with independently
  accepted helper delta `53fd83f3`. Actual ROOT preparation and browser flow
  remain pending. OAuth refresh source candidates are frozen for independent
  review; composed operator-pool tests are repairing premature-closure
  observation and unsafe fixture deletion findings.

Full profile-specific tools + nonempty final + same-head App qualification
remains **0/3**. Norm53 is unchanged; D-final, S, E, F and G remain required.

#### Actual execution update, 2026-10-06 15:20 UTC

- Canary `37481750236` at approved `47b30f34` actually ran Codex, then failed
  on HTTP502. App bot `reviewrouter-local-777genius[bot]` published the failed
  advisory `6019123928` and an error status for that same head. No tools/final
  qualification follows. Gateway close readback was UNKNOWN; no inference
  replay has been issued. Read-only current-DSN binding matched the live service
  to the inspected kernel, which contained zero executions/requests/occupancy;
  exact failure-layer and closure classification remain under investigation.
- Gateway PR18 merged as `1d62e5ef89caabd6217eb5daf73ec6d7b9e6da4b` with accepted
  source and current CI. Its tiny test-import repair subsequently received the
  required independent xhigh PASS, report SHA256
  `0bf517110e3afa09c5f03662b63006819d409b0bd8e5aadd8d5c82b1531619bb`.
  This does not qualify the composed S scenario.
- TS refresh `0d91f094` received independent xhigh source PASS. Native refresh
  fixture repair `65df7101` received xhigh PASS after using the actual descriptor
  qualification proof. Actual credential-free native repository and service
  compilation passed; bootstrap compilation failed on a test-local identifier
  collision. Only that collision is being repaired; actual PG refresh remains
  pending and product OAuth is not qualified.
- UI ROOT preparation materialized its dependency closure, then failed at final
  module resolution: CommonJS resolution rejected import-only and CLI package
  entry points. Read-only Node24 ESM/actual-CLI resolution proved the finite
  existing dependency set; a bounded resolver correction is under review.
  No full browser flow or private UI/provider acceptance is claimed.
- The ROOT service fixture address correction is source-reviewed. Before a new
  execution, a second exact pin issue was caught by a real read-only PG query:
  `server_version` contains a Debian suffix, while `server_version_num` is exactly
  `170010`. The bridge guard is being changed to that exact numeric pin, without
  widening the accepted PostgreSQL version or creating another fixture yet.

Full provider tools/final/App qualification remains **0/3**. These source and
controlled-test checkpoints keep the full goal active; no production deploy,
release, legacy retirement or second-consumer implementation is implied.

#### Actual execution update, 2026-10-06 15:30 UTC

- Trusted PRIMARY qualification of native refresh `65df7101` actually passed
  at 15:23:40 on existing populated F4 PostgreSQL, with the isolated refresh
  case and controlled signed-HTTP containment case. No skip, database creation,
  migration replay or paid provider call occurred. Original-attempt/lost-ACK,
  no-second-entry and held-COMMIT assertions ran; source remained frozen.
- TS refresh composed `144d862f` / tree `60d39b11` passed all three selected
  real-PG/HTTP F-refresh cases, with zero failed/skipped/cancelled tests. They
  proved transaction release before callback, current generation, and grant
  replacement during a real SQL wait. Public PRIMARY projection is retained
  at `/tmp/rr-ts-refresh-pg-primary-receipt-oct6.json`; existing rows remained.
- MiMo pre-preparation failure now has a concrete policy mismatch: the approved
  authorization deadline spans six hours, but the actual run-control grant
  permits one hour. At CLI entry the remaining deadline exceeded the grant by
  17,972,545 ms. Current source rejects this before kernel preparation; no
  successful prepared session explains the UNKNOWN close result. The old
  captured authorization is immutable and revoked; new server deadline policy
  is being aligned before a fresh capture. No old inference was replayed.
- Owner corrected second-consumer scope: RR user/workspace accounts and the
  second product's administrator-owned accounts stay in separate pools. Reuse
  is the SDK, service implementation and images, initially separate product
  deployments. The 350-650 LOC shared-pool adapter is optional deferred scope,
  not a prerequisite. Corrected54 consistency was independently read and checked.

Native/TS controlled refresh PASS is not live protected OAuth qualification.
Full provider tools/final/App remains **0/3**, with D-final/S/E/F/G unfinished.

#### Actual execution update, 2026-10-06 15:55 UTC

- Native refresh bootstrap `a0f21a07` passed the two existing controlled HTTP
  cases after the test-only identifier correction. Native refresh PR22 is
  separately under current-head CI and independent review of its lint-only
  correction; controlled refresh evidence does not establish live OAuth E2E.
- PRIMARY ROOT service fixture `89eec684`, nonce
  `bd55d00490fc4b22be859d91496c79f6`, passed source/bridge/migration preparation
  then failed the real lifecycle test after 31.6 seconds. Retained SQL readback
  shows cleanup done, old occupancy released and `effect_unknown` preserved.
  Those facts do not make the whole fixture PASS. Diagnosis is checking the
  saved fenced-session remint assertion against the facade admission guard;
  no production repair or provider replay is qualified by that diagnosis.
- PRIMARY public UI closure preparation actually passed with resolver candidate
  `c76436f1` and the required Node ESM resolver flag. The previous partial and
  all 28 module directories were retained before placement. This is dependency
  preparation, not browser interaction, private product UI or provider E2E.

Full provider tools/nonempty final/same-head App qualification remains **0/3**.
Owner pool clarification remains in corrected54; no shared upstream pool or
second-product implementation was added to this RR scope.

#### Actual execution update, 2026-10-06 16:35 UTC

- Native refresh PR22 merged as `1fc9840b69b9e5076c51c1c9c9824e1c198dea9d`
  after accepted independent review and current CI. The ordinary
  `cmd/account-gateway` daemon was actually built from accepted source
  `32a7014edd422be4ad81875288ad1139eabfcb03`, whose tree equals the merge.
  ELF SHA256 `1fb04340e90bb31e332631c7842fa7e43dd05d4c13b0a66ffeb2d08d23df9e8a`;
  build1823 exited 0. This is a normal daemon artifact, not a test binary,
  and no new daemon/provider execution follows from the build.
- Gateway PR21 fenced-original readback first candidate received independent
  REQUEST_CHANGES: restored issuer eligibility, a fabricated fixture close
  transition, and an existing SQL regression expectation. The three-path
  repair is active; existing failures and old effect facts remain retained.
  Gateway PR20 current CI passed, but its concrete shutdown/refresh race
  finding is being fixed before merge. Neither component is declared ready.
- Authorization deadline correction passed 13 nearest cases and actual API
  typecheck, retaining old six-hour and tiny-max RED evidence. Independent
  current-source review is active; no fresh paid canary has been launched.
- [Research55](./55-account-ui-reuse-and-personal-sharing-review.md) recommends
  finishing the existing RR React UI. The general Sub2API Vue admin panel
  uses engine-admin authority and does not supply RR workspace authorization
  or serve protected gateway accounts. Personal-catalog/org attachment stays
  the explicit H follow-up; provider source forms do not prove runtime support.
  The research created documentation only, not another UI implementation.

Full tools + nonempty final + approved-head App publication remains **0/3**.
No production deploy/release, shared cross-product pool, or H implementation
is implied. Native macOS notification for completed research was submitted
once; actual visible banner delivery was not independently observed.

#### Owner sharing scope update, 2026-10-06

The owner now authorizes a separate parallel personal-account organization
sharing lane H. First deliver a detailed q-based plan, independently reviewed
in two gpt-6.1-sol/xhigh rounds with findings corrected, then implement in its
own bounded PRs. Canonical user-owned accounts may be attached to several
organizations; rename/reauthorization updates the canonical source, not copies.
This extends the previously deferred H work explicitly. It does not silently
change Norm53, delay the existing D/S/E/F/G acceptance, or merge RR accounts
with the separate second-product administrator pool. Planning starts from
current source9322, with documentation owned by its separate coordinator.

#### Actual execution update, 2026-10-06 17:47 UTC

- Gateway PR21 merged as `e7a09cb5cc3ece67c4fad453b8bfdf8db58802ed`
  after all three independent findings were corrected, current CI passed,
  and final delta review accepted. Saved fenced-session readback preserves
  original authority; restored issuer eligibility is checked again before
  a capability is returned. Admission remains denied for fenced sessions.
- Gateway PR20 merged as `363e4d426ffc5a7bb7dd9b0c8d76dbbd9dd7002f`,
  retaining parent e7 and independently accepted source e2aac3. The new
  shutdown regression actually failed against old production on retained
  PostgreSQL/controlled HTTP (five requests instead of four) and passed
  against the repair, including real SQL lock-release assertion. No new
  database, migration replay or paid inference was needed. Current six
  checks passed and the review thread was resolved before merge.
- D PRIMARY nonce `7e5c4078c5b9eb1725680fdab7eb8bad` failed during
  `native_canonical_migration_build`: compiler stderr explicitly reports
  `no space left on device`. This is not a lifecycle-test failure or a
  timeout diagnosis. The owned build scope exited; artifacts and logs remain
  retained. Database presence has not been read. A minimal helper repair
  is being prepared to make the migration bridge independent of embedded
  database names/connection targets and reusable by exact source/artifact pins.
  Source inspection confirms that its historical DSN is passwordless; the
  blocker is the fixed old database target, not an embedded password.
- S preparer is receiving the three concrete source-review repairs: manifest
  authentication of the native archive, executable dependency custody, and
  a bounded temporary HTTPS enrollment peer. Its composed real SQL test
  remains unchanged and has not run. The E six-file fixture passed eleven
  nearest cases/typecheck/format checks; independent full-source review is
  actually running. Neither fact qualifies live provider E2E.
- H remains plan-only. The dedicated planner is actually running through
  account u with gpt-6.1-sol/xhigh and default service tier. Two independent
  review rounds and corrections remain required before implementation.

Full provider tools + nonempty final + same-head App publication stays **0/3**.
No production deployment, release or legacy retirement follows from these
source and controlled regression checkpoints.

#### Current execution checkpoint, 2026-10-06 18:30 UTC

- RR PR513 merged as `90472623e8857d28d97cc4cbfa2a6e0507c92039` after
  independent source review and all six applicable current-head CI jobs passed.
  Its tree equals qualified `6decf911`; merge preserves the integration ancestry.
  Optional `REVIEW_ROUTER_REVIEW_V2_MAX_AUTHORIZATION_LIFETIME_MS=3600000`
  applies before a new authorization capture. Previous captures are immutable;
  no new provider attempt or runtime update has occurred.
- D retained read-only database-catalog check found neither database of failed
  nonce `7e5c4078c5b9eb1725680fdab7eb8bad`. The reusable migration helper's first
  review requires two repairs: verify dependencies before public compilation,
  and prove compiler/process closure before publishing artifacts. Neither
  public compilation nor another ROOT SQL fixture is approved yet.
- S source repair passed types but review found that plain Node cannot load
  the unchanged Vitest/source-import graph. A single authenticated recipe
  using existing Vitest/Vite dependencies is being prepared; no new test matrix
  or database is required. Full composed S acceptance remains pending.
- E management-profile capability preserves existing unrestricted RR callers
  and can restrict a fixture token to OpenRouter before account effects.
  The nearest HTTP case genuinely failed against old production, then passed
  with the repair; exact source review is active. Current-source fixture
  initialization is also being repaired to reject unsupported historical
  closures before protected writes. Live OpenRouter acceptance remains pending.
- H first plan exceeded the requested core scope. Its original draft is
  retained; the same xhigh planner is separating required sharing from optional
  lifecycle/platform features. Two independent xhigh reviews and corrections
  remain mandatory before its separate plan PR and implementation.

Full provider tools, nonempty final and approved-head App publication: **0/3**.
Norm53 is unchanged; no production deployment or release is qualified here.

## NONNORMATIVE production170 successor evidence - 2026-10-15

This dated successor supplements the historical states above; it does not mark
the whole contract complete. The [finite production170 receipt](../../docs/release-evidence/account-gateway-production170-20261015.json)
records the exact runtime, approved head, observations and primary receipt digests.
Earlier failures and UNKNOWN outcomes remain unchanged.

Production runs SaaS `6d7478f523199699ff93eaed1add12d25ca59aeb`, immutable image
`sha256:89ebafa749ac0c7ed8fbc9593dc533e1fd4b36ee4bbb263ef0055fb48157d0d8`,
Action `ce8106e02c475e31b93b29e0a55151e2af803a8f`, Gateway
`4f334cbdf75ece216ed14a6fa0ead25b80a2f3fb` and approved native compatibility
source `d7181e38e292594ea2245224ea6d735d3b748bf3`. Both 170 fixes passed focused
regressions, independent review and required CI before normal release/apply.
Whole upstream-main native runtime qualification is not claimed.

App setup PR13 merged as `2bd79747ef9e0843ee4aac0e11a313fc8735d5dd` in the
existing disposable `777genius/rr-selfhost-direct-v2-e2e-20260730t120036z`.
One marker push requested one ordinary App-dispatched review of PR2 at
`705049c7159a3ae1ed10fca44c78d890b9250468`; no manual workflow dispatch or
automatic paid retry. Run `38664268518/a1` used MiMo `mimo-v2.6-pro`, high
reasoning, fast mode off, with credentials remaining server-side.

The accepted authenticated manifest records 14 successful tools, complete=true,
confinementTainted=false and no terminal failure. The normalized observation has
3574 bytes, one finding and zero quality flags; finalized coverage is completed.
Raw agent-final bytes were not measured. App review 5526985883 and
inline 4278122640 were published at the exact approved head. The major finding
targets `src/cart.js:6`. Workflow exit 1 with `review_merge_gate_failed` is the
configured blocking-finding conclusion after completed review/publication,
not an infrastructure-failure classification.

The context session accepted its seal after 1507350ms (25min7s), beyond the old
20-minute limit and before the original approved expiry. This is actual changed
boundary evidence for the lifetime and rolling-lease fixes. Execution completed,
slot satisfied, lease released and authorization revoked. The exact kernel
execution is closed, all four requests completed, cleanup done and occupied
transports 0. This is durable closure joined to the qualified ACK-gated
implementation; a separately captured native ACK is not claimed.

The user's canonical Codex account was freshly reauthorized under its original
operator owner and is ACTIVE, revision 5/authorization epoch 3, with a new native
birth. Old erased-generation/ownership history is retained. Complete Codex
authorization opens immediately after fresh enrollment/reconnect; the former
Operation readback section is now Connection status. Padel use still awaits the
already requested specific browser confirmation for its supported S operator
grant. The duplicate quarantined Padel account was not activated or transferred.

Earlier D-long, E OpenRouter, F Codex, joined G custody, UI batch/S grants,
controlled deletion and retention proofs remain accepted within their original
qualified scopes, not relabeled as current 170 runs. RAM remains
owner-stopped/unqualified; H personal sharing is deferred; production deletion
is NOT_RUN. Whole-plan completion remains withheld for the pending Padel use
result and final joined delivery record. No additional RAM, restore, provider or
long-run probe was required for this evidence join.

### Confirmed Padel canonical Codex use - 2026-10-15

The earlier pending-confirmation state above is historical. After the user's
specific confirmation, one normal UI grant succeeded at binding revision1.
Fresh Padel Accounts shows the canonical Codex account ACTIVE / WORKSPACE
BINDING READY. A scoped read-only SQL proof verifies exactly one canonical
connection under its original operator owner and exactly one active Padel
binding to that same connection, policy/binding revision1 with no pending fence.
The [finite receipt](../../docs/release-evidence/account-gateway-production170-20261015.json)
retains this proof and its digest. No second OAuth enrollment, account copy,
principal transfer, provider canary or default provider change was performed.

This is the existing S operator-use mechanism, not the deferred H personal
multi-organization sharing feature. Authorization, metadata and account-global
capacity belong to the one canonical account; per-workspace bindings remain
separate. The deployed UI currently shows the common label and readiness but
has no explicit shared-account/owner badge. That display limitation does not
create separate accounts or permissions. The original duplicate quarantined
Padel enrollment remains denied and was not silently activated.

Production170 review/publication and the requested canonical Padel use are now
delivered. Prior D/E/F/G and retention/lifecycle evidence keep their original
scopes; RAM remains owner-stopped/unqualified, H deferred, and unrestricted
whole-Norm53/D-final memory qualification is not asserted.
