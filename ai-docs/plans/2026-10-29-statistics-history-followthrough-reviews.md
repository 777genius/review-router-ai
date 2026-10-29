# Statistics / Usage / Reviews: журнал review плана и реализации

План: [2026-10-29-statistics-history-followthrough.md](2026-10-29-statistics-history-followthrough.md).
База v1: `a678f21ee5ed640be26b653018c9242c42513063` (main после PR #742).
Все делегированные агенты — GPT-6.1 Sol, xhigh.

Пять кругов выполняются последовательно: actual plan → независимые findings →
исправленный actual plan → следующий круг. До завершения всех пяти кругов и
plan-only push код не реализуется. Автор не объявляет review успешным заранее.
Final code/frontend review и реальные проверки записываются отдельно.

## Revision ledger

| Revision | Содержание                                                                                                                               | Фактический статус                                  |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| v1       | Первый ограниченный план по аудиту; cache/auth, controls/URL, honest copy, public History lookup, Usage policy index                     | Frozen; два actual round1 review получены           |
| v2       | Исправлен round1: seed trust/API validation, strict URL reset, History failure/coverage/raw bounds; prelease вынесен; resources уточнены | Frozen; два actual round2 review получены           |
| v3       | Исправлен round2: always-auth RepeatableRead lookup, typed dependency allowlist/rollback, feature namespaces; resources уточнены         | Frozen; два actual round3 review получены           |
| v4       | Исправлен round3: Statistics scope envelopes200 и adapter check, History403 translation, SSR duplicate arrays                            | Frozen; два actual round4 ACCEPT получены           |
| v5       | Round4 accepted; уточнены browser QueryClient lifecycle и настоящий Prisma post-auth rollback; resources обновлены                       | Frozen; два actual round5 FINAL ACCEPT, план принят |

Frozen v1 SHA256: `5d51ea2ba7ec533cf7479b32b87e965ddd769da0706474be52e0caca243268bd`.
Frozen v2 SHA256: `17a81bc4de8abbbdaba12ff033fbf0d85c35e119e1abe1bb64d8ce5155b15b6f`.
Frozen v3 SHA256: `8cadfcedddc95b29fe97dcf2cdeab1abb254b7e0195bc2d8f018446245920cb1`.
Frozen v4 SHA256: `fdd9f1a79403bd48787c57a259e7fdd0d5370983ea394f2e27aa21f27e043403`.
Frozen v5 для final review SHA256: `84c3c23bcc619fc23e5fcf37b331c2b878286fae6dfa46920f2d87a1ae27d73f`.
После final acceptance изменён только status header плана, принятые контракты
не менялись. Это не новый substantive revision.

## Круг 1 — контракты, авторизация и достижимость

Статус: **завершён; findings внесены в v2 до round2**. Два независимых критика
прочитали actual v1/current source: `statistics_history_ux_audit` (A,
frontend/auth) и `critical_runtime_audit` (B, data/contracts), GPT-6.1 Sol xhigh.

| ID           | Severity / finding                                                                                                                                                    | Решение и revision                                                                                                                                                                        |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1           | P2: random UUID не доказывает, что seed новый; had-denial требует API-validation также для unseen cached seed. Late old-admin403 не должен закрыть новый member scope | Принято: §3.1 explicit had-denial/API trust, §3.2 captured active identity check и isolated old-request cleanup                                                                           |
| A2 / B1      | P2: absent History и dependency failure нельзя сливать;403 требует закрытия scope, не partial data                                                                    | Принято: frozen v1 уже имел late taxonomy clarification; v2 сохраняет `linked/not_recorded/temporarily_unavailable`, auth-before-dependency fallback и distinct server regressions (§5.2) |
| A3           | P2: invalid/duplicate URL policy и выход из SSR error недостаточно конкретны; Retry может зациклить invalid URL                                                       | Принято: §4.1 rejects duplicate known params/coercions, invalid не fetches; explicit Reset30/all удаляет occurrences с сохранением unrelated URL scope                                    |
| A4 / B scope | Scope cut: недоказанная optional prelease классификация расширяет batch и не объясняет Gateway500                                                                     | Принято: §7 только отдельный follow-up/task/PR; удалён optional code tail из implementation/gates/estimates                                                                               |
| B1 coverage  | Lookup обязан учитывать capture coverage и те же readable predicates, что History list                                                                                | Принято: §5.2 `capture_v1` gate + latestRootRequestId/projectedAt/latestStatus/latestRequestedAt; actual PG no-coverage/incomplete/foreign tests                                          |
| B2           | P2 bounded-input clarification:≤25 distinct не ограничивает raw duplicates; PR нужен positive32bit                                                                    | Принято: §5.2 raw array0..25 до dedupe,26duplicates reject; existing identifier +1..2147483647 validation                                                                                 |

Root resource correction, не critic acceptance: pinned pnpm prune был выполнен
после inventory без active pnpm, освобождены469MB unreferenced CAS; примерно620MB
свободно. Dependencies/worktrees не удалялись. Root-only offline hardlink install
в процессе; его успех и выполнение browser/build не заявлены. План разрешает
контролируемую поддерживаемую cleanup, запрещает shared cleanup при installs и
ручное удаление unknown worktrees; hosted fallback сохраняется.

## Круг 2 — исправленный план и adversarial scenarios

Статус: **завершён; clarifications внесены в v3 до round3**. Те же два GPT-6.1
Sol xhigh критика прочитали exact frozen v2 и Round1 dispositions.

- A: ACCEPT, новых material must-fix нет. Маленький guard принят: feature namespace
  сохраняется в boolean markers/purge; Usage scope не чистит Statistics/History.
- B: прежние B1/B2 resolved, Usage semantics accepted. Два уточнения приняты:
  no-coverage/empty/unavailable paths тоже authorizeHistory в том же RepeatableRead;
  post-auth projection dependency имеет явный typed code allowlist, unknown bugs
  пробрасываются; rollback sentinel не проглатывает aborted SQL transaction.
  Добавлены membership-failure, synthetic-programming и admitted-dependency tests.

Root operational update: exact pnpm11.28.7 install completed13.1s;886 packages,
3downloaded,1068 policy checks passed, no lock change. dfAvail снова0 от shared
pressure. Offline Prisma generation пока не завершена (sandbox EPERM/status0
не признаётся успешным generation). Это environment receipts, не waiver gates.

## Круг 3 — source/composition и ограничение scope

Статус: **завершён; findings внесены в v4 до round4**. Те же два GPT-6.1
Sol xhigh критика прочитали frozen v3/current source.

- B: ACCEPT, новых material findings нет; previous raw bounds/auth/typed fallback
  clarifications resolved. Дополнительный code scope не требуется.
- A: P2 — Statistics promise server-derived scope match нельзя выполнить на
  нынешнем bare report/page response. Принято: §3.2 конкретные web envelopes
  `scope.actorId/workspaceId + report/page`, adapter check до cache на каждом200,
  без domain Report/authority params и с прежним no-store.
- A implementation note: `HistoryAccessError` сейчас не распознаётся
  statisticsErrorStatus. Принято: явный перевод в StatisticsAccessError и
  route-boundary403/no-payload regression (§5.2).
- Root/author source clarification: Next SSR string[] duplicates нельзя silently
  collapse к первому при URLSearchParams conversion. §4.1 требует append всех
  occurrences для того же strict codec, что в browser.

## Круг 4 — проверяемость и frontend recovery

Статус: **завершён; A ACCEPT и B ACCEPT**, новых material must-fix нет. Те же
два GPT-6.1 Sol xhigh критика проверили frozen v4 и dispositions.

- A подтвердил Stats envelopes, before-cache check, SSR duplicate/reset и
  History403 route boundary. Browser extension должна сохранить QueryClient
  при cachedBack/remount и реальном role change; reload недостаточен.
- B подтвердил контракты/guards. Для typed dependency classifier требуется хотя
  бы один настоящий Prisma/PG post-auth projection failure/rollback, не только
  synthetic error. v5 уточняет owned lock/short session timeout fixture без shared
  DB/global role/settings и без расширения feature scope.

Root environment receipt: Prisma7.8.0 generation прошла1.86s через существующий
local non-require-isolated helper; unshare unsupported, строгий CI не ослаблялся.
TS7.0.2 install прошёл21 policy entries и завершается. statfs UID0 около1.5GB
включая reserved, dfAvail0; local browser readiness не заявляется.

## Круг 5 — финальная согласованность и readiness

Статус: **завершён; A FINAL PLAN ACCEPT и B FINAL PLAN ACCEPT**. Оба GPT-6.1
Sol xhigh критика прочитали actual frozen v5 и предыдущие dispositions;
неразрешённых material findings по плану не осталось.

Оба verification reminders проверены и сохранены: cachedBack/реальный DB role
change при живом QueryClient и хотя бы один настоящий owned-session Prisma/PG
post-auth projection timeout/rollback. Feature scope/контракты не расширены,
prelease follow-up исключён. Это пятый фактический plan-review response каждого
критика, **не** approval реализации и не результат tests/browser/CI.

## Plan-only publication

Статус: **published before implementation**. Plan-only commit:
`625855482368ac187c213e84883824f64a61a3cb`; origin branch verified by
`git ls-remote`. [Draft PR #743](https://github.com/777genius/review-router-ai/pull/743)
opened with that exact plan-only head. The first source edit happened after
the remote verification and draft creation.

## Реализация, проверки и final critics

Статус: реализация начата. Root owns Usage policy, documentation and integration;
the three existing GPT-6.1 Sol xhigh agents own frontend, History/Statistics
backend, and the existing browser qualification extension. Final code review,
required CI, merge and deployment are not yet claimed.

### Usage policy measurement

The bounded opt-in script compares the previous scan policy with the indexed
selector on 10,000 calls / 1,000 summaries, including complete, missing,
wrong-invocation, partial and unbounded families. Node24.22.1; one warmup and
three serial measured samples. All outputs were deeply equal: 7,500 selected,
2,800 partial children, 100 unbounded summaries.

- Previous scan: 302.934 / 312.903 / 257.796 ms.
- Indexed lookup: 10.314 / 8.784 / 8.050 ms.
- Production source SHA256:
  `9eb51d7121ecea2c3b0a8afafced76da354d9e050595ce973c3711ed5e22873c`.

This measures the pure selector only, not SQL, full-period materialization,
aggregation, concurrent users or total request latency. No timing threshold is
added to CI. The reproducible script is
`scripts/provider-usage-e2e/benchmark-selection.ts`.

The final selector keeps a direct return for reports without summaries, avoiding
an unused call index on that common path. Focused policy, whole-period accounting
and composition suites passed **27/27** tests (Vitest4.1.10, 0.853s); the prior
bounded typecheck/build and ESLint pass also completed. Final repository gates
and independent code critique remain pending.

### Local qualification resources

The first fresh PG17 initdb under owned `/tmp` failed with ENOSPC: unprivileged
PostgreSQL cannot use filesystem blocks reserved for root. Its failure log was
retained. A separate small owned tmpfs PG17.10 cluster then initialized and
started successfully on loopback; all existing migrations through000152 applied.
The empty fully migrated browser database is also the template for isolated
History reader tests; those suites and the browser must run serially.
No shared database or unknown worktree was changed or deleted. A narrow hosted
browser qualification remains available if local compiler/browser capacity is
insufficient. A failed or unexecuted check is not counted as a pass.

### Backend implementation and regression evidence

- Public History lookup, stored Statistics SCM identity, server scope envelopes,
  canonical links, absence/unavailability distinction and History403 mapping
  are implemented through existing public feature ports/composition.
- Final backend reader/lookup/server/API batch: **35 passed**, one unrelated
  optional volume case skipped, across five files. Statistics PostgreSQL and
  History capture/composition batch: **20 passed**, one optional volume case
  skipped, across three files. These skips do not qualify volume behavior.
- A real owned PG17.10 projection lock plus a 500ms reader-session timeout
  produced Prisma7's actual `P2010` structured adapter cause with PostgreSQL
  `57014`. The test verifies authorization, `ROLLBACK`, and successful reuse of
  the same max-one-connection pool. Unknown errors and auth-read failures still
  propagate; no diagnostic message matching is used.
- History and Statistics native typechecks, focused lint and the existing
  History architecture gate passed. The new lookup moved into a small outbound
  adapter to preserve the existing 300-line reader limit; no gate was relaxed.
- Root's integrated import-boundary check passed for 593 domain/application
  files; the existing web-host CMS source profile also passed.

### Frontend regression evidence and implementation hardening

- The nine-file focused frontend/API batch passed **91/91** tests. After forcing
  validation of already-cached unseen seeds, the two affected component suites
  passed **39/39**. History's final 400/500 pagination recovery suite passed 5/5.
- Scoped frontend lint and formatting passed. Native web typecheck was killed
  by the environment (`SIGKILL`, no type diagnostics); it is **not** counted as
  a pass. The narrow hosted browser workflow includes the existing pinned
  compiler setup, Next route type generation and full web typecheck.
- Code inspection found two bounded recovery details within the accepted
  guarantees: missing/null authenticated envelopes must close the old scope,
  and repeated malformed responses across fresh seeds must not create an
  automatic refresh loop. The helper adds only a boolean recovery budget;
  manual Refresh and permanent had-denial/rejected-seed markers remain.
- A fresh cache entry for an unseen seed after denial must not suppress the
  matching API validation. Untrusted report queries therefore use staleTime0
  while remaining hidden. The regression prepopulates that fresh cache.
- The old-request lifetime guard uses layout-phase cleanup, closing the gap
  between a new committed scope and passive-effect cleanup. Its final targeted
  Statistics/Usage suites passed **41/41** with changed-file lint/format passing;
  no broader local compiler retry occurs.
- Initial ordinary SSR failures retain the parsed Statistics filters through
  the same feature-owned controls; authorization denial remains separate.
- Final §4.1 alignment: accepted Refresh clears issue repository selection;
  ordinary failure preserves it. The completion checks the layout-phase active
  scope and the captured interaction revision, so it cannot clear a newer
  filter, browser-navigation or repository intent. The final Statistics suite
  passed **22/22**, including success/failure and late-new-selection regressions;
  changed-file lint, formatting and whitespace checks passed.

### Independent code critiques before hosted qualification

All critics use GPT-6.1 Sol xhigh and inspected source independently of its author.
These preliminary results do not approve a missing browser run or required CI.

| Critic                     | Inspected scope                                                            | Result / disposition                                                                                                                                                                      |
| -------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| statistics_backend_critic  | History/Statistics backend, server/API, Usage selection and benchmark      | No material findings; final source and CI evidence still pending.                                                                                                                         |
| statistics_frontend_critic | Scoped cache lifecycle, web DTO validation, URL/error recovery and UX copy | No material findings in inspected source; final layout-guard revision and visual evidence still pending.                                                                                  |
| statistics_e2e_critic      | Real fixture/schema/UI contracts, browser journeys, cleanup and workflow   | P2 closed after independent re-review: held responses now use bounded lifecycle waits, explicit handler-error propagation and normal owned cleanup. No remaining material source finding. |

The browser proof deliberately separates same cached-seed remount from the
component-only unseen-seed cases, and confirmed member isolation from the
component first-render guard. A cancelled held request proves cancellation, not
execution of a late-completion guard. Receipts record delivered versus cancelled
outcomes. The browser workflow and twelve viewport/theme captures remain pending.
