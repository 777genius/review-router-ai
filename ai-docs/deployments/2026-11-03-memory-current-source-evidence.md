# Current-source evidence for conversational Memory

- Scope: selected-message grounding inside the existing parent and extraction
  SDK calls; no new service, flag, account selection, model call or deadline.
- Successor to [conversational Memory](2026-10-29-conversational-memory.md).
  The frozen `3fa922cef` implementation may ship in the separate coherent R1
  batch; it does not contain this successor and remains unqualified for automatic
  learning. No release/image is assigned to the successor yet.
- Dependencies: normal [release process](../operations/07-environments-and-release-management.md),
  actual selected Account Gateway connection and the existing native backend.

| Environment | Status    | Actual version                                | Remaining work                                                                                          |
| ----------- | --------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| production  | `pending` | Core `57cc1513`; this successor not installed | Source checks, fresh quality qualification, normal coherent release and installed-App acceptance.       |
| self-hosted | `pending` | No genuine release capability issued          | Qualified source/runtime artifact, normal distribution and actual stock installation/update acceptance. |

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
