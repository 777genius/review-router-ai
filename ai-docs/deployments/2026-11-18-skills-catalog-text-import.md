# Skills catalog adds agent-style skills as text: deployment

- Task ID: `2026-11-18-skills-catalog-text-import`
- Goal: "Browse skills" adds real catalog skills that carry agent settings
  (`allowed-tools`, `version`, nested `metadata`) or link to other files, as
  text, after an acknowledgement that names what is left out. Skills that cannot
  be text at all (over 32 KB, no readable header, invalid content) show the
  reason and a link to the exact source instead of a vague error. The editor's
  SKILL.md import follows the same rules. The check accepts a missing linked
  file as the only gap, so such skills no longer end in "Could not complete
  check".
- Affected services/targets: ReviewRouter Web (server actions and UI) and the
  skills-scan worker (report policy). The scanner service is unchanged. No migration, configuration or Gateway change.
- Implementation PR/issue: [ReviewRouter #904](https://github.com/777genius/review-router-ai/pull/904),
  plan [84](../architecture/84-skills-flow-audit.md).
- Implementation reference: the merge commit of that PR.
- Dependencies: none.
- Last updated: `2026-11-18`.

## Environment status

| Environment / target | Status      | Actual deployed version / image      | Last verified (UTC) | Evidence / next step / blocker                                                                  |
| -------------------- | ----------- | ------------------------------------ | ------------------- | ----------------------------------------------------------------------------------------------- |
| staging              | `pending`   | Not verified                         | Not verified        | Web and skills-scan worker rollout.                                                             |
| production           | `installed` | `7c176ef7`, image `sha256:a2c03f03…` | 2026-11-19 15:56    | [rollout 7c176ef7](2026-11-19-rollout-7c176ef7.md). Live catalog check (steps 2-3) not run yet. |

`pending` means no verified completion is recorded, not that deployment was
observed to be absent. Use the [status contract](README.md#status-contract).

## Applicability and prerequisites

- The release contains the merge commit of this task.
- Production facts before rollout (read-only, 2026-11-18): zero catalog
  candidates and zero scans; the skills-scan worker and scanner containers run
  idle. Scan, add and assign have therefore never run on production.

## Ordered rollout

1. Ordinary rollout of Web and the skills-scan worker through the
   [release process](../operations/07-environments-and-release-management.md).
   No migration and no activation step.
2. Live check in a disposable workspace: open Browse skills, preview a popular
   skill with `allowed-tools` and `references/*.md` links (for example
   `addyosmani/agent-skills` `security-and-hardening`), check it, confirm the
   acknowledgement, add it and assign it to a disposable repository; then one
   review on that repository shows the skill as applied.
3. Preview an oversized skill (for example `anthropics/skills` `skill-creator`)
   and confirm the reason text and the GitHub link.

## Verification and completion

`deployed` needs steps 1-3 on the environment: a candidate row and a completed
static scan appear, the skill is created and assigned, the scan worker logs a
processed job, and the review run uses the skill. A failed scan or a vague error
in the dialog means not deployed.

## Retry, partial completion, and rollback

All steps are repeatable. Rolling back Web and the skills-scan worker to the previous image restores the
old refusals; no data needs conversion. Skills added in between stay valid text
skills.

## Related links

- [Plan 84](../architecture/84-skills-flow-audit.md),
  [catalog security plan](../plans/2026-10-27-skills-catalog-security.md).
- Browser acceptance: `.github/workflows/skills-browser.yml`
  ("Catalog real checked import", "Skills real Next").

## Execution log

| Time (UTC)   | Environment          | Operator   | Actual version / image | Step and observed result | Evidence | Next action                 |
| ------------ | -------------------- | ---------- | ---------------------- | ------------------------ | -------- | --------------------------- |
| Not executed | staging / production | Unassigned | Not verified           | Not started.             | None     | Roll out with the next Web. |
