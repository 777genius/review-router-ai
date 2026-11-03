# Current-source evidence for conversational Memory

- Scope: selected-message grounding inside the existing parent and extraction
  SDK calls; no new service, flag, account selection, model call or deadline.
- Successor to [conversational Memory](2026-10-29-conversational-memory.md).
  Reviewed grounding and closed SDK diagnostics through frozen `286804783` shipped
  as ordinary code in `v1.0.226` / `6e6a0f078`. Qualification and the interaction
  pin remain unset; code rollout is not automatic-learning qualification.
  Future [merged PR800](https://github.com/777genius/review-router-ai/pull/800) at
  `9a6b1a974`, preview digest `7972021e…`, has source QA and bounded diagnostic evidence, with full tuning unavailable;
  it is not installed or qualified.
- Dependencies: normal [release process](../operations/07-environments-and-release-management.md),
  actual selected Account Gateway connection and the existing native backend.

| Environment | Status        | Actual version                                      | Remaining work                                                                                          |
| ----------- | ------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| production  | `in_progress` | `6e6a0f078` / official `v1.0.226`, image `0114caaa` | See current R1 evidence and remaining scope below.                                                      |
| self-hosted | `pending`     | No genuine release capability issued                | Qualified source/runtime artifact, normal distribution and actual stock installation/update acceptance. |

## Observed failures and repair boundary

Full tuning run `ea67cde1-3224-4d19-bf4c-22104d28caff` on `3fa922cef`
completed all 50 events. Report SHA256:
`a1842308bc4eb897d03d675bf31fe6c02cd8f09266a9a735faef974bbaac6c7c`.
Owner-delegated agent review covered all 50 events and 23 body versions. The
official score is **FAIL**: three unauthorized-effect observations, zero missing
required effects or bound violations; precision 22/23, recall 20/21,
supported answers 12/12. Score SHA256:
`cbfcde272beb90485a21c055cb60a79be0fcee3ea6165bd1db4c2edb43a268e1`.

Extraction re-emitted an older fact ahead of the current message's new fact.
The next exact confirmation correctly saved the actual first proposal, leaving
the intended new fact missing. Separately, a plain factual message caused an
unrequested maintained create as well as automatic retention. Its duplicate
survived later exact mutation of the automatic entry. Do not disguise these as
style issues, broaden Forget to remove other IDs, or credit the wrong fact.

The successor requires a bounded literal excerpt of the selected current message
for each extracted statement and each noncanonical model-proposed action. Local
decoders reject wrong-origin evidence and remove it before the existing domain
contract. Exact authored commands retain the existing server override after SDK
JSON syntax and closure checks. Actor, target, revision, currentness, settings,
limits and one-shot fences remain independent.

Literal membership proves origin only. It does not prove semantic entailment or
that an excerpt requests a memory operation. Actual model qualification must
still expose incorrect fact selection or unrequested actions. No keyword intent
classifier, second model verifier or output repair is introduced.

Run `604d5ff6-3bab-46d7-b911-6750852b6437` on `8b6b53e03` reached all
50 events but remains **UNAVAILABLE**. Report SHA256:
`027c81a1d869971509225ec84449bac9a54300aa057d39c11e61c6aed3807914`.
The earlier two semantic errors were absent in this observation. One clear
contextual endorsement yielded no fact, and one completed answer was withheld by
a final currentness check. It receives no publication credit. Original execution
completed and closed with about 69 seconds remaining; current configuration,
account and catalog checks are healthy, which does not establish the past cause.
No official score or protected run followed.

The next source adds one generic cross-reply factual-adoption example and bounded
closed currentness-denial diagnostics. Existing checks, read order and static
optional-catalog behavior are unchanged; no extra metadata request, grace period,
retry or authority fallback is introduced. Throwing diagnostic sinks cannot
change the decision. Old outcomes remain preserved.

## SDK settlement diagnostics

Source `2a8777fc1` passed 165 affected contracts but its first cold tuning run
`804f53cd-8b22-409e-ad5e-999d9599fbea` stopped at event 34 when a child
exhausted the original 90-second admission. The original native transport has
closure acknowledgment and completed cleanup; its provider outcome remains
unknown. Partial review found no new semantic defect in the 33 available events.

One independently scoped cold measurement on the same immutable source,
`cf40a3aa-cad3-4e9c-82fe-f1c459f9b6c6`, stopped at event 2. The parent
was withheld after 14.1 seconds with an unknown effect and no recovered output.
Native complete usage, applied close, physical acknowledgment and later cleanup
do not recover the output or prove semantic success. This was not the original
90-second expiry. The currentness diagnostic `cleanup_pending` also covers an
unsettled inference effect; it does not establish that SDK close failed.

The diagnostic successor retains only the SDK's closed failure code, actual
execution-presence boolean, effect and cleanup enum alongside the processing ID.
It excludes provider bodies, errors, traces, accounts and usage. The optional
observer cannot change authority, persistence, request count or settlement; its
throws and rejections are isolated. A first-event observation is retained in the
evaluation report separately from currentness denial. There is no request retry,
deadline change or fallback. Remote SDK/policy tests pass 104/104 with zero skips,
strict API/evaluation types, lint/format and generated metadata checks pass.
The fresh three-event `contextual-units` diagnostic on `286804783` completed
all parent and extraction calls with closed cleanup and no SDK failure code.
The endorsement yielded no retained fact and the linked question abstained on
empty memory, so semantic qualification remains pending. This bounded run is
explicitly ineligible for a full tuning score. Neither unavailable full run has
an official score or protected-run credit.

## Pending contextual-adoption clarification

The source-only successor narrows the prohibition on treating proposals as
established behavior to **unadopted** proposals. It explicitly separates a literal
current adoption quote from its single concrete technical referent in the checked
discussion. The existing ambiguity abstention, quote validator, source authority,
schema, model, one-call bounds and original deadline remain unchanged. This is a
behavioral hypothesis from the three-event run, not a demonstrated semantic fix.
At source preparation it had no fresh model evidence. The later bounded diagnostic
and unavailable T1 below do not establish successful qualification or activation.

Future reliability reporting describes three separately rubric-scored tuning
observations and retains the actual reviewer names. Owner-delegated agent review
must identify itself as agent review, without claiming human or external
independence. The legacy `AWAITING_HUMAN_RUBRIC` status and all scoring gates remain
unchanged. After source checks, use one fresh bounded diagnostic before any three
full tuning observations on the same frozen source/model/corpus; partial and
filtered reports cannot substitute for complete scored runs. Protected r3 remains
unconsumed until the required tuning evidence and review are ready.

## Ordered verification and delivery

1. Review both boundaries and run affected real PostgreSQL/SDK contracts, schema,
   strict types, scoped lint/format, source-stamp and generated-verifier checks
   remotely. Preserve failed attempts and exact source hashes. No heavy local
   processes are authorized.
2. Run the two observed regression scenarios on the actual selected connection,
   then complete fresh tuning and its bound owner-delegated semantic review and
   official score. Partial diagnostics never establish qualification.
3. Use the independently authored and peer-reviewed fresh r3 protected set only
   after tuning passes and source is frozen. Tuning objects and thresholds remain
   unchanged; protected coverage is nonweakened. No r2 protected model run occurred,
   but Root accidentally inspected two snippets while reading the wrong line
   range. Retain that exposure record and make no fully unseen r2 claim. Root
   receives only fresh-set metadata before its checkpoint.
4. Deploy the qualified source through the ordinary protected release process to
   every relevant writer. Preserve installed native state, opt-outs, selections
   and all unresolved outcomes. Do not reboot native services merely to create
   acceptance evidence or replay an unknown request.
5. Prove the normal App-first event path in the existing disposable repository:
   selected review account inheritance, actual contextual learning/recall,
   confirmation settings, edit/delete, replies-off, caps and settled redelivery.
   Verify the configured App bot is the author. Keep fixture config89/workspace21
   FREE inheritance; never restore its superseded Codex config87.
6. Only then author the genuine strict v2 source/runtime-bound capability and
   distribute it through the normal release path. Exercise stock first install,
   same-directory update and the configured-URL explicit resume. Keep logical
   Forget exclusion distinct from signed physical completion; reuse established
   proof where unchanged rather than fabricate new receipts.

Current actual model evidence concerns the selected OpenRouter/Nemotron FREE
pair. Exact profile/model applicability is enforced. No claim is made that
arbitrary Codex or other model selections are qualified; explicit selections are
never silently changed. Bounded discovery found no current Codex primary among
the 256 inspected owned selected repositories, which is not a global availability
or account claim.

## Failure, rollback and completion

No capability, protected score or production activation is issued by source
checks or an ordinary merge. Preserve old FAIL/UNKNOWN evidence. Rollback follows
the release runbook and retains native generations, commands and cleanup debt;
never grant an unqualified source or reprepare an unknown identity to recover.
Record exact deployed source/image, real qualification/App evidence and completed
self-hosted distribution before changing either environment to `deployed`.

## Production R1 /226 — 2026-11-03

The [shared R1 release and environment evidence](evidence/2026-11-03-memory-production-r1-226.json) records official application source `6e6a0f078`, image
`0114caaa…`, all four running roles with zero restarts, and verified 226 producer/channel adoption.

The reviewed grounding and closed-diagnostic implementation through frozen 286
is ordinary code shipped in 226, not automatic-learning qualification. PR800, merged as `3475220dc`, has observation source `9a6b1a974` and preview
digest797; it remains undeployed. Its later diagnostic
and unavailable T1 below grant no semantic PASS, H3 checkpoint, capability or
genuine self-hosted artifact/HTTPS acceptance.

Staging remains unchanged and unverified by this production batch.

## Future PR800 source observations — not production activation

The `9a6b1a974` diagnostic `337e04c1` observed all three selected events with
correct current adoption and linked recall. It remains forced `UNAVAILABLE`
and ineligible for qualification, not a full tuning result. Report SHA256:
`051079524e58b1834510e94faebe0e2ec19d81f7672f3587725ce4d27a371d36`.

Full T1 `03a6e14c-6b4c-470e-b370-b4a5f3c01183` then stopped
`UNAVAILABLE` at 2/50 events when a child reached the inherited shared processing
deadline in `response_started` with cleanup pending. The original parent/shared
processing budget was 90 seconds; after the parent, the child had only 73,572 ms
remaining at creation, not a new 90-second budget. Subsequent exact read-only
reconciliation observed that child fenced at 06:05:44.484878 UTC, its sole
request still `effect_unknown` with transport unoccupied and closure ACK at
06:05:44.537954, and cleanup done at 06:05:45.722374. Provider result and usage
remain UNKNOWN; closure does not recover output or permit replay. Reconciliation
summary SHA256: `56866c16d7fb86e34f5f0f134c9207049d8abe34b9ba3f3ad8d34497997a0ec8`.
No T2, T3 or H3 followed. Neither result grants quality PASS, a capability or an
interaction pin. The installed R1 source remains 6e; future PR800 is not deployed.

PR800 merged as `3475220dc05b6b6918dab1b20abfffaf8fbb5f1a` at
06:34:05 UTC after successful full
[CI41588766562](https://github.com/777genius/review-router-ai/actions/runs/41588766562)
on tested head `eaef9e81e506f4de5e00a51fbf8c3f578e235c7a`. The tested and
merged trees match. All 104 staged source files and the nine-file feature diff
remain unchanged from the observed source; the diagnostic/T1 observations stay
bound to `9a6b1a974`. No model rerun followed the base merge. The merged source
is not deployed: production remains ordinary R1 at6e, without qualification or
an interaction pin.
