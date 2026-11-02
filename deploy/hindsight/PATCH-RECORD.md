# Native diagnostic hardening record

Owner: ReviewRouter maintainers; primary accountable maintainer **@777genius**.
Profile: `approved-source-v1`. Native source: Hindsight **v1.1.0**,
`a5a619b5ca59c5c39e0f96be6f7a31fabd136bd5`.
Dependency-lock SHA256:
`bbd9c8232906ea947c8fdc4096f75d2e778b921af5bdeac09f553495f81f9666`.

The original approved-source hardening is a bounded patch of diagnostic sinks.
That part changes no extraction,
embedding, graph, ranking, consolidation, source update, cancellation, retry
classification or task scheduling algorithm. Original exceptions remain intact
for native classification; only diagnostic rendering and stored error strings
change. `hardening.patch` is the exact upstream diff, generated from pinned
preimage hashes by `prepare-hardening.ts`. Unexpected source or lock changes
fail preparation rather than silently applying a fuzzy patch.

## Scoped strict-preview successor

The derivative now also includes `prepare-strict-preview.ts` and
`strict-preview.py`, applied to the same exact reviewed native revision. This is
a separate, opt-in **dry-run-only** execution-control patch. Normal approved
statement retain, chunks storage, consolidation, ranking and existing generation
behavior remain unchanged.

Requests with `strict_preview: true` require one complete extraction chunk and
one provider. They disable native content-validation and transport retries,
propagate output overflow without automatic splitting, reject dropped/partial
facts, and return the `X-Hindsight-Strict-Preview: v1` marker only after complete
success. An empty fact list is successful only after a completed native abstention.
The patch does not extract, verify or deduplicate facts in Router.

The source fixture executes the actual patched extraction functions for overflow
above and below the old split floor, malformed/partial/dropped output and genuine
abstention. The real Docker/API qualification additionally observes the provider
call count with nonzero configured retain retry defaults. Selectable source and
read-only context carry the existing private sentinel, so the normal native
logging/database sink checks cover this transient source class as well. Its raw
bodies must never become document or async-operation payloads.

These controls are prerequisites, not activation evidence. The transient source
profile remains unavailable until the exact final image, runtime privacy canary,
model/mission/source-fidelity quality and product admission profile have their
own qualification receipts. The portable adapter requires that deployment binding;
a source fixture or a configuration flag alone never qualifies it.

## Sinks covered

| Sink                                                   | Qualified profile treatment                                                                                                                      |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Python logging, warnings, traceback/extras             | Metadata event `module:line`, severity and exception class; no interpolated message, traceback, arbitrary extras or tenant context               |
| Uncaught Python/thread exceptions                      | Fixed event and exception class; no exception text/source-line dump                                                                              |
| API error and validation bodies                        | Existing HTTP status preserved; fixed safe code; bounded numeric Retry-After retained                                                            |
| Native readiness DB errors                             | Exception class only, alongside existing pool counts/timings                                                                                     |
| Worker/API startup                                     | Database connection location/credentials omitted; cleanup exception class only                                                                   |
| Native task failures/retry history and parent copies   | Fixed stored error code or exception class; raw provider response/traceback excluded                                                             |
| Native PostgreSQL link errors                          | Logger path replaces three direct traceback print calls                                                                                          |
| LLM traces, bodyful audit, OTel content, request dumps | Explicitly disabled; bank audit also disabled by adapter profile                                                                                 |
| PostgreSQL server diagnostics                          | `log_statement=none`, `log_min_messages=PANIC`, `log_min_error_statement=PANIC`, both parameter length limits `0`; verify actual resolved values |

This profile sacrifices free-form native diagnostic text and normal PostgreSQL
ERROR/DETAIL log messages. Native HTTP statuses, operation states, retry timing,
module/line/class events, health/pool metrics, counters and latency metrics remain
available. Operators use those safe signals to locate failures. Do not enable
verbose SDK/provider/SQL diagnostics on a real-data deployment to investigate a
failure. The independent DB server logging policy is necessary: suppressing SQL
statements alone does not suppress values embedded in ERROR/DETAIL messages.

## Build identity and evidence

The workflow resolves `ghcr.io/vectorize-io/hindsight-api:1.1.0` to an immutable
manifest digest, verifies the release revision label, checks every changed base
file's preimage bytes inside the image, then copies the bounded patched files.
It verifies every resulting file against the generated manifest and confirms the
running package resolves to that patched directory. No package installation or
dependency resolution occurs in the derivative build.

`runtime-inputs.json`, `hardening-manifest.json` and `evidence.json` record the
resolved base/PG identities, source/lock/changed-file hashes and tested derivative
image ID. API, two overlapping workers, cleanup API and restarted services must
all use that exact derivative ID. An image ID identifies local tested bytes;
publishing requires a registry manifest digest and a repeat test of the exact
published image. A source-only check is not that receipt.

**Current status:** runtime qualification is a CI gate, not a claimed successful
run. This checkout does not contain a production image digest or a production
deployment receipt. Real-model quality, egress selection, production capacity,
restore rehearsal and live product review acceptance remain independent gates.

## Removal condition

Open a focused upstream issue/PR containing the exact sink diff and synthetic
sentinel reproductions. No upstream issue number or acceptance is claimed here.
Remove the patch when a pinned upstream release removes the relevant content,
credential, persisted error and HTTP echo paths, and the **same** failure corpus
passes against its final immutable API/worker image. Prefer that upstream release
over extending this patch. Any change to semantic algorithms requires a new
architecture decision and fit review rather than growing this diagnostic patch.
