# Balanced Memory Design References

These PNG files retain the approved design for the Balanced Memory manager.
The manager is temporarily paused as described below; the PNGs and accepted
ADR-025 are preserved as historical design authority for its future return.

## Current product state — 2026-10-22

The owner explicitly requested a static under-development Memory section while
the memory engine adapters are integrated. This temporarily supersedes ADR-025's
active manager layout, without rewriting the accepted decision or its reference
images. See [the implementation plan](../../plans/2026-10-22-memory-engine-adapters.md).

- The authenticated dashboard and guarded preview share one server-rendered
  development notice. They expose no memory records, forms, mock controls,
  mode links or export link. Old mode/status parameters do not restore them.
  The notice uses the existing Badge and icon, one page heading, a short purpose
  statement and a clear availability message, without nested cards or setup
  controls.
- Dashboard memory reads and the policy simulator are not executed. All stale
  server/client memory mutation actions authenticate their workspace and then
  refuse the request without changing memory or revalidating the dashboard.
- Existing canonical records, internal lifecycle/recovery paths and the
  protected backend export remain available. This is a dashboard pause, not a
  runtime memory service flag or a deletion of existing records.
- Current browser QA covers the actual dashboard, old query parameters and the
  guarded preview at 1440x1000, 900x1100 and 390x844 in both dark and light themes.
  On 2026-10-22, `pnpm memory:qualify-browser` passed all 30 cases with a signed
  test session and real database membership authorization, including the compact
  dashboard footer merged from main. The application's temporary read-only role
  had no privileges on any of the four Memory tables. There were no memory API
  requests, external browser requests, browser errors, forms or horizontal page
  overflow. All twelve captures were visually checked: the notice is readable
  without clipped content or controls. Visual review found and corrected a
  mobile stylesheet forcing dark colors in light mode. The qualifier now checks
  actual theme surfaces and the notice's composited text colors; its minimum
  measured contrast was 7.2882:1. This is focused notice QA, not a full
  accessibility audit.
  See [the reproducible browser harness](../../../scripts/memory-e2e/browser-README.md)
  for commands, artifact locations and the development-server/schema-preparation
  limits of this evidence.

The manager layout and verification matrix below describe the retained design,
not the currently available UI.

## Files

| File                                  | Size      | Purpose                                                                        |
| ------------------------------------- | --------- | ------------------------------------------------------------------------------ |
| `memory-management-concept-board.png` | 1823x863  | Overall direction: quiet operational dashboard, dense scanning, no hero screen |
| `knowledge-base-split-reference.png`  | 1236x1640 | Main knowledge base: scope rail, grouped list, detail panel                    |
| `suggestion-inbox-reference.png`      | 1096x1640 | Pending suggestions: review queue, risk flags, approve/reject/edit flow        |
| `operational-table-reference.png`     | 1312x1640 | Admin mode: dense table, filters, row actions, pagination                      |

## Retained manager contract (paused)

- The first viewport must be the working memory manager, not a landing page.
- Preserve the split-dashboard feel: filters, list/table and detail surfaces are
  siblings, not cards inside cards.
- Use existing shared UI primitives before creating memory-only controls.
- Keep status/scope/risk chips visible in list, inbox and table modes.
- Include empty, loading, error, permission-denied, stale-version and over-quota
  states inside the same layouts.
- Destructive actions must use confirmation dialogs and explain retention impact.
- If implementation discovers a better UX, update this README or the PNG
  reference in the same change as the code.

## Retained manager verification (paused)

Before the UI is considered done, capture screenshots for:

- desktop 1440x1000;
- tablet 900x1100;
- mobile 390x844.

Compare those screenshots against the PNG references above and document any
intentional deviation in the implementation notes.

Design QA matrix:

| State              | Required screenshot/check                                      |
| ------------------ | -------------------------------------------------------------- |
| normal data        | knowledge split, suggestion inbox and admin table              |
| empty workspace    | same layout density, no marketing/landing screen               |
| permission denied  | read-only state with disabled mutation controls                |
| over quota         | quota banner and safe actions without blocking export/delete   |
| stale edit         | conflict/version dialog and recovery path                      |
| indexing degraded  | search degradation indicator without implying memory data loss |
| destructive action | confirmation dialog with retention impact                      |
| mobile             | list/detail flow without clipped actions or overlapping chips  |

Suggested artifact paths:

- `tmp/design-verification/memory/desktop-knowledge.png`
- `tmp/design-verification/memory/desktop-suggestions.png`
- `tmp/design-verification/memory/desktop-table.png`
- `tmp/design-verification/memory/tablet-knowledge.png`
- `tmp/design-verification/memory/mobile-list.png`
- `tmp/design-verification/memory/mobile-detail.png`

## Implementation Notes

Historical 2026-05-12 verification pass (before the dashboard pause):

- Preview URL: `/dashboard/memory-preview`.
- Preview guard: `REVIEW_ROUTER_ENABLE_MEMORY_PREVIEW=1`; without the flag the
  route returns `notFound()`.
- Data source: deterministic synthetic fixtures only. No DB, auth cookie, source
  code, diff, prompt or production memory is read by the preview route.
- Browser captures were refreshed to all suggested artifact paths above at
  `1440x1000`, `900x1100` and `390x844`.
- Memory preview layout audit passed across knowledge, suggestions, table,
  empty, read-only, over-quota, stale-edit and indexing-degraded states at
  mobile/tablet/desktop sizes:
  `REVIEW_ROUTER_UI_AUDIT_ROUTES=... REVIEW_ROUTER_UI_AUDIT_VIEWPORTS='mobile:390x844:mobile,tablet:900x1100,desktop:1440x1000' pnpm web:ui-audit`.
- Edge-state smoke checks passed for empty, permission denied/read-only, over
  quota, stale edit and indexing degraded states.
- Clean-profile browser captures rendered without preview-route failures after
  fixing a disabled-dialog hydration mismatch. A persistent local dev profile can
  still emit unrelated stale NextAuth JWT cookie noise before the preview route
  renders.

Intentional implementation choices:

- The dashboard keeps the reference split layout. Knowledge and suggestion modes
  use left scope rail, center work area and right policy/detail panel.
- Table mode uses the reference operational shape with left filters and a wide
  dense table. The policy/detail panel is hidden in table mode to prevent overlap
  and keep scan density. The main grid and table shell use explicit `min-w-0`
  containment so table overflow stays inside the table scroller on mobile.
- Memory badges are compact labels in this feature, not large action-like pills.
  Real actions continue using shared `@reviewrouter/ui` Button/FormSubmitButton
  and shared Dialog primitives.
- The right policy panel includes an admin-only policy simulator. It keeps the
  reference structure, uses synthetic fixed fixtures only and does not collect
  real memory body, source comment, diff, prompt or model output.
- Export CSV remains disabled in this slice. Disable/delete/edit flows are live
  and keep confirmation dialogs with retention impact.

Token notes to capture during implementation:

- background/surface/border/text/muted/accent colors;
- danger/warning/success/status chip colors;
- focus ring token;
- table row height, toolbar height and detail panel width;
- mobile breakpoint behavior and minimum action target size;
- any intentional deviation from existing `packages/ui` tokens.

Reference update rule:

- update PNG and README in the same change when the design direction changes;
- keep one source-of-truth screenshot per mode instead of accumulating stale
  variants;
- do not accept implementation screenshots as new references until overflow,
  focus, contrast and permission states are verified.
