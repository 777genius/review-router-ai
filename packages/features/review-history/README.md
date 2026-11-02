# Review History

## Feature card

- Purpose: keep a compact, private record of accepted supported GitHub v2 review
  runs and show each PR's latest logical review without loading full reports.
- Parent: ReviewRouter; this is a top-level feature.
- Publishes: History reader; host-only transactional capture, projector and
  explicit activation ports through the checked composition root.
- Consumes: the host's borrowed Prisma client and committed owner facts.
- Modules: one cohesive History module and one borrowed database input.
- Sub-features: none.
- Expected growth: new qualified source adapters and read presentation.
- Likely split seams: a demonstrated independently replaceable source adapter or
  a separately owned read policy; helpers alone are not modules.
- Split signals now: 1/12 modules, 0/20 application use cases, depth 1/3.

The root owns construction only. It never opens, queries, activates, or disposes
the borrowed database. Source capture and the existing outbox handler own their
normal operations after construction. Ports use own function properties.

See [ADR-032](../../../ai-docs/decisions/032-review-history-scoped-composition.md)
and the [scoped profile](../../../architecture/review-history/consumer-module-profile.json).
The public `contracts` subpath contains only browser-safe domain DTOs, statuses,
and safe errors. Prisma and Get Modular remain behind `composition`.
