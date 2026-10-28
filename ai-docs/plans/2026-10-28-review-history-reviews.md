# Reviews: журнал review плана и реализации

Все делегированные агенты: GPT-6.1 Sol, xhigh. План:
`2026-10-28-review-history-implementation.md`.

Три круга ниже исполняются последовательно: findings → исправленный план → новый
круг. Записи отражают реальные замечания, не предполагаемые approval. Финальный
code review и выполненные тесты фиксируются отдельно от review документа.

## Круг 1 — точность контрактов и риски

Статус: завершён; замечания внесены в план перед кругом 2.

Три критика независимо прочитали actual Markdown и current source. Агенты:
`lifecycle_plan`, `read_side_plan`, `ux_impeccable`, GPT-6.1 Sol xhigh.

### Lifecycle: 4 P1, 3 P2

- L1: originating intent может быть удалён раньше execution. Добавлено persisted
  `historyDispatchAttempt` рядом с execution root и retention regression.
- L2: coverage activation не должна зависеть от первого готового writer. Уточнены
  binary flag, no-op до DB activation, явный общий cutover и skip old roots.
- L3: freeze всех completion outcomes, включая completed-superseded,
  not-applied reasons, stale-visible и partial publication. Mapping и precedence
  добавлены; неизвестное не выдаётся за success.
- L4: source IDs нельзя сортировать как версии. Проверка исходного prepare/link
  показала несколько законных candidates одного attempt. Принят минимальный
  source-owned winning binding в существующем Run ledger и atomic execution
  snapshot при intent link. Highest generation не подменяет admission authority.
- L5: unprojected source rows отделены от readable projection; count удалён.
- L6: requestedAt закреплён за DB acceptance clock после PR lock, не delayed ingress.
- L7: перечислены semantic capture fields; heartbeat/wake/claim-only изменения
  не создают событий. Rollback квалифицируется на каждом из трёх owner seams.

### Read/auth/architecture: 2 P1, 5 P2

- R1: PostgreSQL suite мог skip в CI. Названы required env, explicit command,
  existing CI wiring и fail-without-prerequisite при qualifying invocation.
- R2: CMS claim требовал реального scoped adoption gate. Добавлены точные paths,
  command chains и rejecting pin/path/unowned-boundary/import fixtures.
- R3: allocator не является projection/count; nullable visible fields и projected
  filter закреплены, public count исключён.
- R4: зафиксированы canonical repository value, options order, filters и coverage
  union; connection/name не используется как identity.
- R5: UTC calendar-day boundaries сохраняются в cursor, не пересчитываются при
  midnight continuation; refresh создаёт новые bounds.
- R6: search закреплён как simple-dictionary AND prefix tokens, bounded input,
  exact numeric PR path, matching GIN и numeric index; actual SQL plan matrix
  включает options и selective/common/missing search.
- R7: auth и data read выполняются в одной RepeatableRead transaction с честной
  request-snapshot семантикой.

### UX/frontend: 2 P1, 5 P2

- U1: repo26+ должен быть доступен. Выбран один searchable paginated repository
  control с pinned selection внутри существующего primitive, без drawer.
- U2: initial SSR seed привязан к URL filters и только matching first page;
  mounted search, debounce/abort и Back/Forward явно включены.
- U3: list pagination заменяет 25 строк; history append добавляет пять.
- U4: coverage date видна также при populated list, понятной короткой копией.
- U5: Try loading again отделён от persisted review failure; нет намёка на rerun.
- U6: закреплены focus/scroll/aria-controls/polite announcements для pagination
  и disclosure, без отдельного focus-management framework.
- U7: заморожены ровно три Impeccable references с license/notice; исключён
  ненужный run count. Owned workflow приоритетнее generic upstream examples.

Отвергнутые расширения: indefinite event journal, alias merge manager, continuous
repair loop, полная установка Impeccable engine, дополнительные status filters,
поллинг-manager, новый UI framework. Эти подсистемы не нужны для принятых гарантий.

## Круг 2 — adversarial сценарии и scope

Статус: завершён; все material findings внесены перед кругом 3.
Критики: те же три GPT-6.1 Sol xhigh, повторный review исправленного actual plan.

- R2-read-1: fixed UTC window терялся при возврате на первую страницу. Добавлен
  opaque window token на существующем cursor codec с null position; сохраняется
  при Previous/refetch и меняется лишь при explicit Refresh/filter change.
- R2-read-2: разные captured names давали duplicate repository options. Сначала
  canonical dedupe по latest projected metadata, затем search/paging; выбранный
  URL repository возвращается отдельным `selected`, независимо от options page.
- R2-read-3: late old event мог переписать title/search текущего PR. Все summary
  metadata/search fields обновляются только вместе с selected latest run.
- R2-UX-1: invalid shared URL мог скрыть controls. Предусмотрены safe validation,
  сохранение input и Clear filters, отдельные от пустого результата и outage.
- R2-UX-2: slow pagination могла украсть focus. Focus move разрешён только для
  актуального действия, пока пользователь сам не перешёл в другой control.
- R2-lifecycle: completion-before-binding нельзя считать невозможным по текущему
  API. Added completion snapshot при binding и узкий optional execution-row gate
  перед completion create/apply; единый lock order исключает Exec/Completion
  inversion и пропуск concurrent initial completion. Новая lock framework не нужна.
- R2-lifecycle-2 (P1): allocator/projection могли брать PR/Run в обратном порядке.
  Заморожен PR → Run для projector и multi-run registration; single-run capture
  не запрашивает PR lock после Run. Добавлен один real concurrency case.
- R2-lifecycle-3 (P2): hash seed должен совпадать с direct source fact, а не outer
  intent envelope. Source cursor/hash reducer общий для seeds/direct events;
  recovery не может сбросить уже выбранный winning binding.

У UX и read критиков нет оставшихся P1; UX approved после двух указанных
уточнений. Full Impeccable engine не требуется, документационный subset принят.
Lifecycle critic считает контракт готовым после трёх указанных bounded fixes;
все три внесены без новых таблиц, framework или publication logic.

## Круг 3 — реализуемость и критерии приёмки

Статус: завершён. Три критика GPT-6.1 Sol xhigh независимо приняли исправленный
план без оставшихся material P1/P2 в своих областях.

- `lifecycle_plan`: accepted for implementation. Проверены durable lineage,
  winning binding, seed/direct hash equivalence, execution/completion serialization,
  PR → Run order, activation, retained-outbox replay. Новых подсистем не требуется.
- `read_side_plan`: accepted for implementation. Проверены canonical ownership,
  projected visibility/latest metadata, repository options/selected value, UTC window,
  RepeatableRead access gate, required PostgreSQL и scoped CMS enforcement.
- `ux_impeccable`: accepted for frontend implementation. Проверены filter recovery,
  delayed focus guard, repository26+, cache privacy, понятный bounded UI и inert
  Impeccable integration. Дополнительные UI/проверки каждого компонента не нужны.

Freeze: три history tables, три nullable lineage columns, narrow source hooks,
existing worker/outbox, одна feature и четыре UI filters. Во время реализации
реальный обнаруженный дефект исправляется с targeted regression; scope не растёт
из-за необязательных рекомендаций или предположений о будущем.

## Финальный review реализации

Статус: реализация проверена тремя независимыми критиками GPT-6.1 Sol xhigh;
подтверждённые замечания исправлены, локальные gates пройдены. Статус required CI
для итогового HEAD и merge фиксируется в [PR #730](https://github.com/777genius/review-router-ai/pull/730).

- `final_frontend_critic`: accepted, без оставшихся material P1/P2. Проверены
  whole-scope denial, list/repository seed trust, late response после смены scope,
  session-only actor, safe API errors, URL/Back, paging и реальные screenshots.
- `final_backend_critic`: accepted после исправления P1 — отдельный API intent
  store hosted prelease gate первоначально не получал capture hooks. Теперь оба
  API store используют один production history root. Manual rerun и admission
  rejection проходят через тот же atomic writer.
- `final_read_arch_critic`: accepted, без material P1/P2 в SQL authorization,
  latest-before-filter, cursors, browser contracts, реальном CMS root, Foundation
  boundaries и подключении обязательных PostgreSQL/architecture CI gates.

Реализация и targeted проверки дали дополнительные конкретные исправления:

1. PostgreSQL race test показал, что execution row lock не обновляет старый
   Serializable snapshot admission transaction. Completion gate теперь делает
   no-op MVCC UPDATE существующей lineage только для покрытого root; binding
   повторяет локальную транзакцию до трёх раз. Execution version/state/timestamps
   сохранены, новый lock manager/column/isolation policy не добавлены. Реальный
   тест проходит оба порядка completion/binding и replay в обратном порядке.
2. Component-local denial flag мог исчезнуть при Back/unmount/remount. Boolean
   markers в QueryClient блокируют отказанный seed, а любой другой старый SSR seed
   того же actor/workspace допускается только после свежего authorized API read.
   Гейт распространяется на строки, options и выбранный repository label.
3. Быстрое изменение другого фильтра до истечения search debounce теряло введённый
   текст. Repository/Status/Period теперь сохраняют текущий search вместе с выбором.
4. Repository continuation использует точный `lower(fullName)` sort key PostgreSQL,
   а не JavaScript lowercase, который может отличаться на Unicode.

Критики не предложили добавлять отдельные сервисы, таблицы или framework для этих
исправлений. Измеренное O(tenant history) чтение repository options и некоторых
no-match prefix queries принято как явная граница; проверка не выдаётся за
доказательство постоянной стоимости или неограниченной нагрузки.

## Выполненная квалификация

Локальные disposable данные, без production activation и без GitHub публикации:

- Полная реальная migration chain, включая `000151_review_history`, применена
  на PostgreSQL 17.10. Source fixtures клонируют эту полную схему.
- Source PostgreSQL: 7 cases passed, включая rollback, duplicate/reordered facts,
  recovery/manual rerun, winning candidate, source retention и реальные concurrent
  transactions. Последний source run занял 4.45 s.
- Reader PostgreSQL: 5 cases passed с volume fixture: 100 000 PR в каждом из двух
  tenants и 100 000 runs одного PR; 12 actual reader query plans. Последний run
  занял 17.91 s. План и измеренные ограничения описаны в
  [runbook](../operations/review-history.md).
- Frontend/API focused regressions: 5 cases passed, включая оба старых SSR seed
  сценария, late response и pending search. Ранее 19 focused/dashboard navigation
  cases прошли совместно; unit tests не добавлены на каждый UI wrapper.
- Финальный общий targeted batch: 10 files / 65 cases passed после исправлений.
  Включён actual app/hosted prelease wiring regression: проверяется передача
  persisted admission outcome единственному assembled writer. Ранее отдельно
  прошли 104 existing owner regression cases.
- Настоящий browser E2E passed: Next 16.2.11, Chromium 153.0.8010.0, PostgreSQL
  17.10, synthetic signed NextAuth session, временная SELECT-only роль. Проверены
  три protected API, 25 PR, repositories 26+, history 5+2, URL filters/Back,
  keyboard disclosure, invalid input, local retry, empty/unavailable, SELECT
  revocation/recovery, membership denial/recovery и workspace switch. Browser
  errors и внешних запросов нет; cleanup passed.
- Визуально проверены light/dark screenshots на 390/900/1440 px; независимый
  frontend critic также посмотрел desktop/mobile/expanded состояния. Нового
  визуального дефекта, требующего изменения scope, не обнаружено.
- Feature native typecheck, API/worker typecheck, финальный последовательный web
  typecheck и tooling typecheck passed. Повтор web проверки был запущен отдельно
  после resource SIGKILL одного перекрывающегося запуска; SIGKILL не засчитан как
  успешная проверка.
- Все звенья repository architecture gate passed. Baseline source/WEB profile,
  Foundation source directions, DEV_ONLY и REGISTRY проверены; затем последовательно
  выполнены 23 Memory, 6 Statistics и scoped History rejecting cases. Для этих
  временных mutation fixtures использован отдельный checkout с теми же 100
  изменёнными файлами: SHA-256 совпали, source mutations восстановлены. Исходное
  рабочее дерево не содержит тестовых нарушений или архитектурных исключений.
- `pnpm modular:qualify`: native typecheck и 6 files / 19 genuine composition
  cases passed, включая новый production root. Changed-file format/ESLint и
  `git diff --check` passed; lint rules не отключались.
- Historical through-000079 fixture получил только три nullable lineage columns
  как test-only bridge для current Prisma. Authority/attachment/old-binary SQL
  assertions сохранены. Сам historical contract исполняется в отдельном CI catalog;
  локальная новая source qualification использовала полную схему 151.
- Activation command запущен дважды только на disposable browser database:
  оба раза возвращён один timestamp, production не изменялся.

Локальные receipts находятся в ignored `tmp/review-history/` и
`tmp/statistics-e2e/run-2026-10-28T12-13-26.739Z-359663c5ebf0/`. Browser receipt
сохраняет hashes проверенных исходников; его `sourceCommit` относится к раннему
documentation checkpoint, потому что implementation batch проверялся до commit.
Browser fixtures не доказывают реальный GitHub launch: source capture/projector
подтверждены отдельно реальными PostgreSQL cases, а deployment/live review остаётся
операцией release процесса.

### Production и исторический Prisma fixture

Дополнительная квалификация выполнена на отправленном `ae4c25c4` без изменения
feature source:

- Все 53 workspace/API/worker production emits прошли последовательно. Next
  сначала не смог разрешить PostCSS из временного внешнего `.next` directory;
  после восстановления обычного ignored output directory только Web build был
  повторён успешно: Turbopack compile 22.7 s, Next TypeScript 79 s, 42 static pages
  и все три History API routes. Первый failed command сохранён как environment
  setup failure, а не обозначен successful full Turbo invocation.
- Финальный ESM rewrite прошёл для 540 dist files. `pnpm runtime:smoke` подтвердил
  compiled API health и worker batch; `pnpm web:smoke` — 12 pages и 2 redirects
  из настоящей production Next сборки. Все настройки synthetic, production
  credentials не использовались, процессы остановлены.
- Исторический through-000079 contract дополнительно прошёл локально: 37 tests,
  37 passed, 0 skipped. Отдельный PG17.10 cluster получил существующие 82 migrations
  и неизменённые release/handoff guards. Проверено, что lineage columns отсутствуют
  до test-only bridge и появляются ровно три после него. Cluster остановлен и
  удалён; основной History fixture cluster не менялся.
- 26 source hashes browser receipt совпали с отправленным commit. Повтор browser
  E2E при неизменных feature sources не потребовался.

Receipts: `tmp/review-history/production-qualification-receipt.json`,
`tmp/review-history/provider79-reproduction-ojDtj8/receipt.json` и
`tmp/review-history/browser-final-head-receipt.json`.

### CI: точный допуск новой migration

CI на `ae4c25c4` выявил два связанных пропуска: managed historical89 recovery
отверг новый checkout с `checkout_extension`, а Dedicated Release Authority
остановился на `private_pg17_rehearsal_migration_boundary_unclassified`. Оба
произошли до проверок самой History фичи: новый SQL был сохранён, но ещё не включён
в действующие точные границы current checkout.

Исправление добавляет checksum migration 151 и полный manifest checkout155 перед
прежней рекурсивной проверкой, классифицирует её как checkout-only для private
pre-release и historical96 readers и обновляет current-count assertions. Старые
fixtures исключают новый tail перед проверкой прежних identities. Managed92
partition побайтово совпадает с прежним результатом, historical96 manifest сохранён.
Неизвестный tail, изменённый SQL и удалённый predecessor отвергаются.

Независимый Sol 6.1 xhigh critic принял поправку и отдельно сверил hashes и реальные
reader results. 7 focused files / 349 tests passed, 0 skipped; targeted ESLint,
Prettier и whitespace checks passed. Первый запуск этих tests получил sandbox
`spawnSync EPERM`; успешным считается последовательный повтор с разрешёнными
subprocesses. Локальный Docker recovery не заявляется: обязательные CI jobs должны
пройти на новом commit. Feature source и migration SQL не менялись, повтор большого
browser/build batch не требуется. Receipt:
`tmp/review-history/migration151-admission-tests.log`.

## Фактический объём

По Git diff относительно `418c0ff848443d7a3a0553be22eb63c45a51f53b`: 3 958
добавленных строк production/activation/admission кода, 2 906
строк targeted tests/fixtures/browser harness и 418 строк architecture qualification.
Всего код, проверки и тестовые fixtures — 7 282 добавленные строки; это физические
строки diff, включая комментарии и пустые строки, а не semantic SLOC. Configuration,
lockfile, Markdown и неизменённые лицензированные Impeccable references считаются
отдельно. Эти числа не являются требованием к объёму следующей фичи.
