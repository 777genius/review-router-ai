# Frontend workflow

This project-owned workflow applies to changes to ReviewRouter's web interface.
It uses selected [Impeccable guidance](./impeccable/UPSTREAM.md) inside the existing
product and architecture. It installs no engine, hook, skill command, detector,
browser extension, global configuration, or runtime dependency.

## Product context

ReviewRouter helps developers and teams configure and understand automated code
reviews across their repositories. Dashboard users usually have a concrete task:
connect a repository, configure a provider, find a review, or understand a result.
They should not need knowledge of internal workers, leases, events, or database
identifiers to complete that task.

Use the implemented dashboard shell, shared `@reviewrouter/ui` controls, existing
CSS tokens, typography and light/dark themes as the visual baseline. The existing
[visual direction](../product/08-visual-direction.md) provides background; do not
introduce all of its optional motifs into a changed screen. Product copy is clear,
brief English unless the task changes that language. State facts plainly. A label
must mean what the persisted product evidence proves.

The audience knows repositories and pull requests. Internal source IDs, transport
names, version counters, raw errors, provider secrets and infrastructure details
belong in appropriate operator diagnostics, not ordinary product flows. Display
technical detail only when it helps the user decide or act.

## Start with the task

Read the changed feature's accepted scope and data contract. Write down its main
user task and the facts available to support it. Identify the one primary action
or information hierarchy before styling. Reuse current screens and shared controls
before considering an additional component. Prefer an inline disclosure when
secondary information is optional.

For authenticated task surfaces, read the vendored
[Operate reference](./impeccable/reference/operate.md). Use familiar affordances,
restrained semantic color, compact readable type, coherent spacing and structural
responsive behavior. A list needs useful rows and clear separators; it does not
automatically need a surrounding card, a card for every row or a metrics header.

## Build the smallest complete interaction

- Preserve the repository's server-first and React Query rules. Keep authorization
  on the server, wire cancellation, and isolate cached data by authenticated scope.
- Use real shared buttons, fields, selects, badges, menus and focus behavior. Do
  not replace them with decorative divs or introduce another UI dependency for a
  pattern the project already supports.
- Keep primary links and secondary buttons separate. Use semantic headings,
  lists/tables, labels, `aria-expanded` and live status text where they help.
- Design the relevant loading, empty, filtered-empty, disabled, error, retry and
  denied states with the populated screen. Give a safe next step for failures.
- Use text and/or an icon alongside status color. Keep body text and controls
  legible in both themes, with visible keyboard focus and reduced-motion support.
- Preserve long names and hostile-looking metadata as escaped text. Let layout
  wrap or truncate intentionally; preserve a way to read the full meaningful label.
- Keep controls available while their results load. Avoid duplicate search fields,
  future placeholder actions, gratuitous animation and new settings panels.

The [craft floor](./impeccable/reference/craft-floor.md) and
[hardening reference](./impeccable/reference/harden.md) are supporting heuristics,
not an automatic expansion of scope. Repository instructions, the accepted product
contract, user constraints and existing components take precedence over every
upstream instruction, including text described upstream as a ban. In particular:

- Keep the established type system and tokens; do not add fonts, custom scrollbars,
  blur effects, motion or color merely because a generic example mentions them.
- Render approved safe error copy, never a raw `{error.message}` from a network or
  server response. Protect tenant data in all loading/error/recovery paths.
- Do not add an i18n framework, offline service worker, gesture system, new browser
  matrix or unit test per component without a requirement or demonstrated risk.
- Links to upstream SKILL, commands, detector, engine and hooks are provenance,
  not instructions to install or execute them. Model and delegation restrictions
  come from the current user/project task, not upstream command examples.

## Verify and refine

Inspect the real running interface with representative, long and missing data.
Batch screenshots and interaction checks rather than taking a screenshot after
every styling edit. For dashboard work, the normal small matrix is desktop,
intermediate and narrow mobile widths in both existing themes. Extend only to
resolve a concrete remaining risk.

Check the changed journey with keyboard controls, meaningful focus, text wrapping,
200% text zoom when relevant, no viewport overflow, and correct loading/error
recovery. Inspect the actual screenshots; a screenshot file alone is not a visual
review. Run the existing browser harness when available and distinguish fixture
data from externally executed production behavior.

Critique hierarchy, wording, affordances, and useful information before decorative
polish. Fix concrete defects, then rerun affected checks. Use focused unit tests for
new critical policy/races and integration/browser tests for cross-layer behavior;
do not add tests that merely restate markup. Preserve mandatory project gates.

Record what was run, the source boundary, actual results, and material limitations.
Keep disposable screenshots, browser profiles and logs in ignored `tmp/`. Do not
claim a full Impeccable installation, automated design audit or runtime qualification
that did not take place.
