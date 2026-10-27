# Memory authority and complete provider

The feature exposes provider-neutral application ports and `MemoryKnowledgeService`.
The complete provider owns current approved statements, topic membership, facts,
observations, indexing and retrieval. Router stores approval, authorization,
source applicability, revision and durable delivery metadata. Current content is
never reconstructed from Router's database.

[ADR031](../../../ai-docs/decisions/031-complete-memory-provider.md), the
[replacement plan](../../../ai-docs/plans/2026-10-23-hindsight-memory-replacement.md)
and the [private Hindsight runbook](../../../deploy/hindsight/README.md) define
ownership, qualification and activation requirements.

## Public boundary

`@reviewrouter/features-memory` exports domain/application contracts, policy,
permission ports, the service and historical usage retention. Hosts construct
`createMemoryKnowledgeRuntime` through server-only `./composition` and supply an
authenticated `MemoryKnowledgeAccessPort`. Concrete metadata adapters are exposed
through `./infrastructure`. Native SDK imports stay inside the Hindsight adapter.

Workspace/repository/user scopes are security boundaries. Topics organize entries
without granting access. Stable writable entries differ from read-only historical
native observations. An observation never silently repeals an approved rule.
An exception names an active workspace rule in the same workspace.

Only explicit distilled approved statements enter the provider. Raw comments,
threads, diffs, code and excerpts are not provider ingress. Trusted host adapters
check source metadata and current source visibility/applicability. Promotion to
workspace scope requires broader authority and protects private provenance.

## Commands and delivery

A command UUID binds its full normalized input, expected application revision,
approval, source cursor, provider generation and profile. Changed-input UUID reuse
is a conflict. Topic changes preserve content approval revision. Unchanged text
preserves its original native statement time.

Prisma admission reserves quotas, source cursors, revision and scope epoch with
IDs-only transactional outbox work. A bounded immutable approved envelope exists
only while delivery is unresolved; verified terminal settlement purges it. No
read/list/recall/export path uses this envelope as current knowledge.

Claims become unknown before provider I/O. Expired claims observe the same UUID.
Resubmission is disabled by default and allowed only within an explicitly
qualified native UUID-retention profile. A process exit after claim but before
native submission is still an unknown dispatch: lease expiry alone cannot prove
that no external mutation occurred. With resubmission disabled, it remains
visible operator debt rather than silently submitting again. Revocation disables
resubmission. An expired envelope leaves visible fenced operator debt, not a successful write or
proof of remote absence. Recovery schedules command IDs into the existing outbox.
All ten retired v1 event types are audited and quarantined for explicit operator
disposition; they are not translated into new-provider writes.

Runtime excludes retired/expired entries; authorized management/export can read
retained inactive content. Forget immediately fences every body-bearing read.
Native acceptance or generic operation completion does not publish unverified
text and does not complete physical forget. Cleanup remains pending until exact
trusted host evidence is verified against the current paused maintenance epoch.

## Maintenance and review admission

A shared database permit spans bounded native writer/observer transport. Exclusive
pause waits for these transports and advances a durable generation-wide epoch.
The native cleanup profile additionally requires complete executor/session drain,
operation and history inventory, and absence verification after restart.
During this pause, cleanup resets the affected bank's derived observations and
history through the native public API, including orphan history from old source
revisions. Other approved documents and source facts are preserved; surviving
sources reconsolidate after restart. Empty derived history is verified before
restart, followed by scoped absence and surviving-source checks afterwards.
Verified cleanup also closes an immediately preceding unresolved write together
with Forget, so an expired delivery envelope cannot permanently block deletion.
Neither command may have an active claim, and the signed receipt must still match
the exact entry revision, provider generation and paused maintenance epoch.

Runtime retrieval has a hard two-second bound and degrades to an empty bundle.
Bodyless receipts capture exact approved revisions and scope epochs. The review
lease transaction checks current authority, repository/source availability,
policy and maintenance before charging an inference attempt. Stale input consumes
no attempt. A previously issued lease retains its admitted immutable context on
exact replay.

## Qualification and historical disposition

`.github/workflows/memory-projections.yml` runs **Memory authority and delivery**:
real PostgreSQL17 command authority, API admission races, historical execution
lease contracts, and persisted outbox-to-worker delivery. All four suites must
execute with zero skipped tests. Native Docker/image qualification is separate;
unit tests and source inspection do not establish a native-image runtime pass.

The custom canonical engine, Prisma lexical fallback, Infinity adapter, projection
worker and obsolete UI have been removed. Historical migrations and old data and
receipt tables remain for explicit migration, remote cleanup and audit review.
They are not a runtime content source. A new provider generation does not prove
old remote data was physically deleted.
