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

Статус: реализация ещё не начата.

## Выполненная квалификация

На момент создания плана тесты новой фичи ещё не исполнены.
