# Review statistics — review record

The owner requested four sequential plan review rounds with three independent
GPT-6.1 Sol xhigh critics per round, followed by implementation reviews and E2E.
The initial research and this record are not implementation/test pass claims.

## Plan round 1 — candidate 1 to candidate 2

All three directions completed independent reviews against the same candidate.

| Direction | Material findings | Resolution in candidate 2 |
| --- | --- | --- |
| Data/security | Provisioned GitLab does not settle V2; historical availability cannot mean zero; delayed events can outlive a deleted/rebound repository. | Explicit source coverage, no invented GitLab telemetry, suppressed incomplete comparisons, durable capture boundary, immutable original tenant/connection and acknowledged deletion no-op. |
| Architecture/scale | CAS/read/capture were not specified as one transaction; worker gates could block statistics draining; synthetic TS7 checks would not qualify real builds. | Same transaction client for CAS, source, outbox and return read; independent handler registration; real affected consumers under TS7.0.2. Added deterministic earliest-event ordering, replay collision errors, Repeatable Read and named SQL qualification. |
| UX/qualification | Period/current-day/availability rules and DTO were underspecified; actor cache isolation and rejected SSR seeds needed concrete behavior; initial errors could break the whole dashboard. | Only bounded 7/30/90 presets, same elapsed previous interval, shared DTO, feature-local initial failure handling, actor/workspace keys and whole-feature cache rejection. Added exact pagination/selector rules and accessible day table/browser matrix. |

The plan retains the existing modular monolith, durable outbox and two compact
fact tables. No broker, separate service, custom GitLab reporting protocol,
historical backfill, rollup engine or unused observation subscriber was added.

## Remaining rounds

Rounds 2–4 will each inspect the prior round's revised plan. Implementation has
not started.
