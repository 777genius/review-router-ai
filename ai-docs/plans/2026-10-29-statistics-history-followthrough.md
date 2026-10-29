# Statistics, Usage и Reviews: доверие к данным и переход между разделами

Статус: **v5 — план принят после пяти настоящих кругов критиков и исправлений;
ожидает plan-only commit/push до начала реализации**. Дата: 2026-10-29. База:
`a678f21ee5ed640be26b653018c9242c42513063`, main после merge PR #742.
Рабочая ветка: `feat/statistics-history-followthrough-20261029`.
Пользователь разрешил подготовить и отправить план, провести пять кругов review,
затем выполнить реализацию, проверки, frontend review и исправления до завершения.
Публикацию плана, commits, PR, CI и merge координирует основной агент.
Журнал фактических замечаний: [reviews](2026-10-29-statistics-history-followthrough-reviews.md).

## 1. Результат и границы

Пользователь должен уверенно вернуться к своему отчёту, изменить фильтр даже после
ошибки и перейти от найденной проблемы к истории соответствующего PR. Отчёт не
должен повторно показывать уже запрещённый SSR seed или называть время чтения
доказательством полного поступления данных.

Это один ограниченный вертикальный срез существующего dashboard:

1. Устойчивое закрытие Statistics после 401/403; изоляция Usage по actor,
   server-derived effective access и SSR seed.
2. Сохранение доступных фильтров и Previous после обычной ошибки Statistics и
   Reviews, с отдельным поведением при отказе в доступе.
3. URL-состояние Statistics для 7/30/90 дней и severity: SSR, reload, Back/Forward.
4. Честная подпись времени формирования отчёта и понятное ограничение свежести.
5. Issue → Reviews по исходным workspace + SCM identity + PR, с корректным
   отсутствием History projection и сохранением внешней ссылки на PR.
6. Индексированный выбор Usage summary/children без изменения accounting и
   ограниченное измерение на воспроизводимом наборе.

Не входят новые flags, schema/migrations, зависимости, analytics builder,
run-health метрики, отдельная detail page, общий repository filter Statistics,
новые провайдеры и источники, historical backfill, новый retry/monitoring сервис,
materialized totals и переделка полного SQL report path Usage. Не выдавать
попытки/стоимость/AI findings за success rate, экономию или подтверждённые баги.

PR #742 уже находится в базе: не реализовывать повторно исправленный retry storm.
Внешний Gateway `review_run_authorize` HTTP 500 / `ambiguous_outcome` остаётся
инцидентом с неустановленной причиной. Этот план не объявляет его исправленным.
Prelease-классификация отложена в отдельный follow-up, вне этой ветки/PR (§7).

## 2. Установленные исходные контракты

| Поверхность       | Факт исходников                                                                                                                     | Следствие                                                                           |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Statistics ledger | `review-statistics` сохраняет successful settlement и first-recorded lineage; transactional outbox, idempotent projector, tenant FK | Сохранить writer/counting/UTC/retention; не переписывать на History                 |
| Statistics report | `asOf` — время чтения; coverage — activation/source qualification, не projection watermark                                          | Поменять доказуемую подпись; не заявлять, что backlog проверен                      |
| Statistics cache  | Actor/workspace/seed уже в query key; denial только local state                                                                     | Сохранить scope и добавить долгоживущие безопасные denial markers                   |
| Usage cache       | `providerUsageKey(workspaceId, filters)`, denial — reference equality локального report                                             | Добавить actor/access/seed и server-derived response scope                          |
| History cache     | `history-scope.tsx` хранит boolean rejected seed и had-denial для QueryClient lifetime                                              | Использовать проверенный смысл и узкий shared helper в web, без deep imports        |
| Identity          | Statistics repositoryId — connection ID; History repository filter — SCM identity                                                   | Передавать сохранённую SCM identity явно; имена/текущий binding не являются ключами |
| Периоды           | Statistics фильтрует `settledAt`; History — latest request time/latest PR status                                                    | Переход к PR без date/status фильтра; не обещать совпадение KPI                     |
| Usage report      | `query(q,false)` читает полный период до 366 дней; limit100 только для output                                                       | Это P2 scaling risk, не измеренный OOM; полный SQL read остаётся известным долгом   |
| Usage policy      | Каждый summary сканирует calls и использует `manifest.includes`; manifest ≤10000                                                    | Убрать повторный поиск через индекс, сохранив authority/conflict semantics          |

Основные evidence paths: `packages/features/review-statistics/src/infrastructure/`,
`apps/web/src/features/review-statistics/`, `apps/web/app/dashboard/provider-usage-*`,
`packages/features/provider-usage/src/{domain/usage.ts,application/report-usage.ts}`,
`apps/web/src/features/review-history/interface/history-scope.tsx` и
`packages/features/review-history/src/adapters/outbound/history-read-sql.ts`.

## 3. Cache scope и отказ в доступе

### 3.1 Общие гарантии

Небольшой web-owned helper допустим в существующем shared client/application
слое `apps/web/src/`; он хранит только boolean tombstones и собирает typed scope
keys. Это не query framework и не импорт внутренних компонентов History.
Сначала прочитать текущие History tests и сохранить их гарантии; не менять
History только ради унификации, если перенос увеличивает риск.
Markers и purge/cancel prefixes сохраняют feature namespace: Usage scope change
не очищает unrelated Statistics/History; helper не превращается в общий cache manager.

Каждая query/mount identity включает actorId, workspaceId и свежий SSR seedId.
Usage дополнительно включает effectiveAccess `admin | member`, полученный из
того же server authorization decision, которым ограничены данные. Browser не
передаёт actor/access как authority и не выводит их из role labels/URL.

При 401/403 немедленно скрыть все данные scope, остановить polling/queries,
отменить находящиеся в полёте reads и убрать payload из cache. Boolean marker
отклонённого seed сохраняется на время жизни QueryClient; cached RSC remount
того же seed не возвращает initialData. После denial более старые cached seeds
не принимаются как новая авторизация. Восстановление требует нового server
read/seed и подтверждения authenticated scoped API. UUID не задаёт возраст seed:
при actor/workspace had-denial любой ранее невстреченный seed считается
непроверенным, SSR initialData не показывается до успешного API read с совпавшим
server-derived scope. Boolean had-denial не удаляется при новом успехе; уже
отклонённые seed остаются закрытыми. Просто возврат membership или смена фильтра
не открывают old seed.
Отказ в workspace A не блокирует авторизованный B. Запоздавший ответ A не может
попасть в B или снять denial.

### 3.2 Изменяемые seams

- Statistics: `interface/statistics-view.tsx`, `adapters/statistics-api.ts` и
  их tests. Сохранить scope purge и server seed из `review-statistics-section.tsx`.
- Statistics HTTP adapters возвращают web-owned envelopes:
  report `{scope:{actorId,workspaceId},report}`; issues
  `{scope:{actorId,workspaceId},page}`. Scope берётся из того же signed-in server
  context, что reader call; actor/access не становятся query params authority.
  `apps/web/src/server/review-statistics.ts` и оба protected route обновляются
  вместе с API client/tests. Framework-free StatisticsReport не меняется.
  Оба client adapters сверяют server-derived actor/workspace на каждом200 с
  captured expected scope **до** возврата payload React Query. Mismatch закрывает
  прежний scope и требует fresh authorized server seed, как Usage; bare report
  не может служить подтверждением actor после had-denial. Private/no-store
  сохраняется. Tests проверяют200 с чужим actor/workspace для report и issues.
- Usage: `apps/web/src/server/provider-usage-report.ts`,
  `apps/web/app/api/dashboard/provider-usage/route.ts`,
  `apps/web/app/dashboard/dashboard-workspace-page.tsx::ProviderUsageSection`,
  `provider-usage-api.ts`, `provider-usage-model.ts`, `provider-usage-view.tsx`.
- Server adapter предоставляет report вместе с actorId/effectiveAccess;
  SSR host добавляет новый random seed. HTTP response передаёт server-derived
  scope metadata вместе с report, чтобы account switch или admin→member downgrade
  нельзя было незаметно принять в старую broad-access query.
- При несовпадении response scope с ожидаемым скрыть/удалить прежний scope,
  не принимать payload в его key, запросить свежий authorized server seed.
  Новые props с другим actor/access/seed перемонтируют consumer синхронно:
  предыдущий admin report не должен попасть даже в один render нового member.
- Любой async completion проверяет captured actor/workspace/access/seed против
  активного mounted scope до side effects. Поздний403 от старого admin seed после
  принятия нового member seed не закрывает/не очищает member scope и не принимает
  старые данные; cleanup старого request ограничен его собственными ключами.
- Сохранить текущую session authorization и member actor filtering на сервере;
  operator API и domain UsageReportQuery не становятся client authority.

Регрессии: denied remount, older seed после observed denial, новый authorized
seed, actor switch внутри того же workspace, admin→member, workspace switch,
late success/late403, lazy issue403 и Usage polling после отказа. Assertions
проверяют видимые секретные fixture labels и реальные query identities.

## 4. Управление фильтрами, ошибками и URL

### 4.1 Statistics

Добавить небольшой pure URL codec рядом с
`apps/web/src/features/review-statistics/application/statistics-presentation.ts`.
Параметры dashboard: `statisticsDays=7|30|90`,
`statisticsSeverity=all|critical|major|minor|unknown`; defaults 30/all.
Одинаковая bounded validation используется SSR и browser. API сохраняет свой
существующий `days`/`severity` контракт. Ровно0 или1 значение каждого известного
dashboard-параметра: duplicate, пустая строка, whitespace, иной регистр, `07`,
`7.0`, знак/экспонента и неизвестный discriminator дают invalid URL, без coercion.
Незнакомые несвязанные query parameters сохраняются. Invalid URL не запускает
report query; показывает safe validation и явный `Reset statistics filters`.
Reset удаляет все occurrences двух известных params, устанавливает default30/all
и сохраняет workspace/section/unrelated params/hash. Это работает и из SSR
fallback: Retry не является единственным выходом из invalid shared URL.

`DashboardSectionContent` передаёт params в `ReviewStatisticsSection`; при
преобразовании Next searchParams сохраняются **все** значения `string[]` через
append, а не collapse к первому. Strict codec видит SSR duplicates как browser.
Section
читает фильтр до `loadStatisticsReport(workspaceId, filter)` и seed соответствует
этому фильтру. Filter change обновляет только Statistics params, сохраняя
workspace/section/прочие несвязанные query params/hash; defaults удаляются из URL.
Back/Forward восстанавливает UI/query filter один раз, без navigation loop и
двойного fetch. Reload/shared URL сразу имеет правильный SSR report.

Severity и Period controls рендерятся из accepted filter state вне условного
`query.data`; обычные loading/400/500 не уничтожают возможность изменить фильтр.
Invalid URL даёт понятный recoverable state/default recovery, а не чужие/случайные
данные. 401/403 закрывает данные и disables controls согласно denial contract.
Смена периода/severity и accepted refresh сбрасывают issue cursor/repository
scope; обычная ошибка не уничтожает cursor stack. `Previous` должен оставаться
доступен после ошибки следующей страницы, если есть предыдущая, даже когда
`query.data` отсутствует. Error+retry не заменяет navigation.

### 4.2 Reviews

В `apps/web/src/features/review-history/interface/history-view.tsx` и связанных
page controls отделить Previous/navigation от successful page body. Ошибка page2
не лишает пути обратно к page1 и не меняет frozen windowToken; обычный Retry
повторяет тот же cursor/window, explicit Refresh создаёт новый window.
Существующий filter URL codec и SSR/error policy сохраняются. Не включать новые
фильтры или пересчитывать PR totals. Проверить page1→page2error→Previous,
retry same cursor и Back/Forward при ошибке.

## 5. Время отчёта и issue → Reviews

### 5.1 Честное время

В `statistics-view.tsx` заменить `updated <asOf>` на `Report generated <asOf> UTC`.
Коротко сообщить, что recent reviews may appear after background processing.
`currentComplete` продолжает означать source/history coverage, не delivery lag.
Не показывать неподтверждённый synced-through time/green freshness badge и не
добавлять новый backlog query в этом срезе. Существующие partial/unavailable
source notices и Diagnostics сохраняются. Empty copy: `No recorded published
reviews in this period yet`, без утверждения об отсутствии реальных публикаций.

### 5.2 Identity и public mapping

Добавить `scmRepositoryIdentityId` к `StatisticsIssue` и reader select/map из
сохранённой fact row. `repositoryId` сохраняет прежнее значение connection ID
для существующего issue drilldown; не переименовывать его незаметно.

History предоставляет public authorized bounded lookup на своём reader port:
`resolvePullRequests({actorId,workspaceId,pullRequests:[{scmRepositoryIdentityId,
pullRequestNumber}]})`, raw array длиной0..25 до dedupe;26 даже одинаковых entries
отклоняются до projection query. Валидировать SCM identity существующим History identifier
validator и PR как integer1..2147483647, затем dedupe. Результат содержит только
запрошенные readable projected PR identities/IDs данного workspace; отсутствующие
не являются ошибкой. Авторизация, active workspace и projected/readable predicates
совпадают с History list. Одна batch query вместо N+1. Не читать History SQL
напрямую из web или Statistics infrastructure. Изменяемые файлы History:
`domain/history.ts`, `application/ports/history-reader.ts`,
`adapters/outbound/prisma-history-reader.ts`, public exports при необходимости.
Текущий Get Modular composition получает расширенный порт через существующие
контракты, без нового graph/service и deep imports.

Каждый lookup, включая raw empty input, no coverage и unavailable, сначала
вызывает существующий `authorizeHistory` внутри той же RepeatableRead transaction,
что coverage/projection read. Bound/validation не заменяют авторизацию. Только
после успешной authorization lookup проверяет History capture coverage.
Отсутствие `capture_v1` не
открывает даже оставшиеся rows: available(empty) означает history not recorded
для этой ссылки. Readable PR требует `latestRootRequestId`, `projectedAt`,
`latestStatus`, `latestRequestedAt` non-null, как listPullRequests. Реальные PG
регрессии: no coverage, projected-null/incomplete summary, foreign workspace,
валидный target, raw26 duplicates и invalid PR; server tests различают
denied, dependency unavailable и not_recorded.

Web server adapter `loadStatisticsIssues` получает страницу25 от Stats reader,
вызывает public History lookup и формирует узкий web-owned issue presentation
DTO с optional `historyHref`. Shared client type этого DTO находится в web
feature application/adapter layer, не импортирует server-only module. Domain
Statistics не зависит от History. Ответы по-прежнему private/no-store.

Failure contract: History access denial превращается в общий403 Statistics
issues request, а не в пустой lookup; validation/programming ошибки не скрываются.
Web adapter явно преобразует `HistoryAccessError` в `StatisticsAccessError` до
`statisticsErrorStatus`: текущий mapper иначе вернул бы500. Route-boundary test
проверяет настоящий History-denial path →403 и отсутствие issue payload/links.
History port возвращает discriminated `available(items) | unavailable`:
`unavailable` разрешён только для dependency failure самого projection lookup
после успешной authorization; auth-read failure остаётся ошибкой. Допущенный
узкий allowlist storage errors: Prisma `P1001/P1002/P1008/P1017/P2024` и `P2010`
только с SQLSTATE `57014`; classifier проверяет typed Prisma error и safe code,
не message substring. Любой иной/unknown/programming/validation error пробрасывается.
Признанная ошибка только projection SQL оборачивается typed dependency sentinel;
transaction сначала откатывается, затем outer reader возвращает unavailable.
Нельзя swallow SQL error и считать aborted transaction успешным read. Tests:
membership query failure не degraded; synthetic programming error не degraded;
post-auth admitted dependency возвращает unavailable после rollback. Web DTO различает
`linked | not_recorded | temporarily_unavailable`. При временной недоступности
показать Stats issues и внешние PR links с короткой safe подсказкой/retry, без
History links; это не «история отсутствует». Никакого blanket catch вокруг всей
операции и никакой передачи raw errors. Проверить distinct403/temporary/empty
сценарии; отказ supplemental lookup не переоткрывает уже denied Stats scope.
Хотя бы один recognized post-auth failure/rollback проверяется настоящим
Prisma/PostgreSQL, а не только synthetic error: owned disposable fixture держит
projection lock, отдельная test session имеет короткий statement_timeout;
authorization проходит, projection получает реальный57014, transaction откатывается,
lookup возвращает unavailable. Timeout/lock ограничены этим fixture/session;
никаких production/shared DB, global settings или shared role изменений.

Href использует `section=reviews`, выбранный workspace, `reviewRepository=<SCM
identity>`, `reviewSearch=<PR number>`, без `reviewDays` и `reviewStatus`.
Текущие Statistics параметры не переносятся как ограничения History.
Показывать отдельный `Review history` action только для readable projection;
если её нет, сохранить внешний `PR #N` и нейтральную короткую подсказку об
отсутствии записанной истории. Не вести пользователя на заведомый400 repository
filter и не показывать raw identity. History может позже стать недоступна: её
страница повторно авторизует read и показывает существующее empty/error/denied
состояние; lookup не является разрешением. Никакой новой capture activation.

Проверить два repositories с одинаковым PR number, rename/unbind, foreign
workspace, absent/hidden projection, delayed projection, newer failed run после
старого successful review и расхождение availableSince. Переход объясняет PR,
не обещает равенство Statistics KPI числу History rows.

## 6. Usage: только индексированный policy lookup

Изменение принадлежит
`packages/features/provider-usage/src/domain/usage.ts::selectReportFacts`.
Один раз построить индекс calls по callId; bucket сохраняет все entries и их
исходный порядок. Для каждого summary находить кандидатов по manifest ID,
проверять точные parentScope + invocationId. Результат children сохраняет
прежний порядок исходного calls (в том числе при иной последовательности manifest).
Не терять duplicate entries из public pure-function input и не менять equality,
completeness/unknown, выбранный summary, partialChildren/unboundedSummaries.
Global overlapping child manifest остаётся `usage_authority_conflict`, включая
отсутствующих children. Сначала authority selection, затем provider/model filter.
Money decimal/bigint, null vs0, attempt denominator и distinct runs неизменны.

Tests в существующих `src/tests/usage.test.ts`/`usage-overview.test.ts` проверяют
неполные/полные/missing/wrong-scope children, overlap, unbounded summary, duplicate
projection input, input/manifest order, filters и exact decimal/null semantics.
Не писать только mirror test нового Map. Показать эквивалентность прежней
семантики на небольших содержательных adversarial fixtures.

Добавить bounded opt-in performance evidence к существующему test/support seam:
например 10000 calls и 1000 summaries с небольшими manifest, один serial process,
warmup и несколько measured runs, actual input/result counts и elapsed time.
Не запускать baseline с огромным L/C/S; не вводить flaky wall-clock CI threshold.
Сравнить старый/новый policy на одном fixture через локальную reference helper
только в qualification scope; включить missing/partial family. Если resources
недостаточны — уменьшить набор и честно записать границу, не объявлять load test.
Отдельно документировать, что full-period JSON materialization до366 дней и
unbounded cardinality не исправлены. Не LIMIT-обрезать totals и не добавлять
таблицы, rollup/service или DB rewrite в эту ветку.

## 7. Отдельный follow-up: prelease и Gateway incident

Prelease classification **не реализуется этой веткой/PR**, даже как optional
tail. Будущий отдельный task/PR сначала читает actual owner
`apps/api/src/hosted-review-prelease-gate.ts`, tests и caller mapping, доказывает
конкретное смешение typed policy refusal с dependency error и только затем
предлагает узкую правку с regression. Не blanket-map Gateway500/unknown outcome
в expected refusal и не расширять #742. Причина живого Gateway инцидента неизвестна;
этот UI/policy срез её не исправляет и не доказывает live recovery.

## 8. Проверки и frontend acceptance

Сначала focused tests на owner seams, затем required project gates. Примерные
команды уточняются по текущему package/CI без ослабления pinned toolchain:

- `pnpm exec vitest run` с изменёнными statistics/history components, URL codecs,
  server/API tests и provider-usage policy/overview/composition suites.
- Реальные PostgreSQL reader tests Statistics и History для additive identity
  select и bounded lookup, с opt-in env из существующих fixtures; qualifying
  invocation не выдаёт skipped suite за pass.
- `pnpm history:architecture`, `pnpm modular:qualify` и существующий web-host/
  Foundation boundary profile при изменении public exports/composition. Никаких
  deep feature imports; public reader methods проходят через настоящий graph.
- Обычные lint/typecheck/build затронутых feature/web,
  затем обязательные repository CI gates и `git diff --check`.

Browser: расширить **существующий** `scripts/statistics-e2e/browser-qualify.ts`
и его `history-scenario.ts`/support, не создавать новый auth/runner/server.
Loopback PostgreSQL17 `reviewrouter_statistics_test`, fully migrated schema,
temporary SELECT-only web role и synthetic genuine NextAuth session. Для Usage
переиспользовать существующий Usage fixture/scenario seam или добавить bounded
extension к тому же runner; не запускать второй тяжёлый harness параллельно.

Локальная выполнимость browser пока не доказана: root восстановил exact pinned
dependencies, но disk available снова0; старый cluster удалён,
наличие PostgreSQL17 binary не равно готовому cluster,
Chromium executable нужно проверить. Предпочесть свежий owned loopback cluster
и проверенный browser только при достаточных resources. Если локальная среда
не позволяет qualification, добавить минимальный manual/path-scoped hosted CI
job по образцу существующих setup steps, запускающий тот же statistics-e2e
runner и сохраняющий source hashes/result/screenshots/cleanup evidence. Текущий
default CI этот browser runner не запускает: зелёный CI сам по себе не доказывает
browser acceptance. Не создавать второй harness или broad CI framework; отказ
infra фиксируется как blocker, не как skip/pass. Не prune общий pnpm store во
время active installs, не удалять unknown worktrees; hosted qualification предпочтительнее
опасной чистки shared state.

Обязательные journeys: shared Statistics URL→SSR filter→change→Back/Forward→reload;
severity change503→другой severity; issue page2 503→Previous; Reviews page2
503→Previous с прежним window; observed401/403→same/older cached seed remount→no
data→fresh authorized seed recovery; Usage actor/admin→member transition и late
responses; issue→правильный Reviews PR/all runs, absent History fallback;
honest generated/empty/partial copy. Fixture browser proof не заявляет live
GitHub, OAuth provider login, Gateway или external runtime qualification.
Cached Back/remount и настоящий DB admin→member проверяются при **сохранённом
QueryClient** между переходами. page.reload сам по себе не воспроизводит этот
cache lifecycle; fresh reload используется только как отдельный recovery case.

Визуально проверить actual captures1440/900/390px в обеих темах, keyboard/focus,
200%text zoom для controls/issue actions, long/escaped labels, loading/error/
denied/empty и отсутствие horizontal overflow. Следовать
[frontend workflow](../design/frontend-workflow.md) и прочитанному vendored
Operate reference. Сохранить существующие shared primitives; без nested cards,
новых панелей или декоративного редизайна.

## 9. Пять кругов плана, реализация, CI и release

1. Два независимых GPT-6.1 Sol xhigh критика читают actual v1 и current source:
   architecture/data и frontend/auth. Записать findings с severity/evidence.
2. Автор правит actual plan и dispositions; следующий круг читает новый текст.
   Повторить **пять реальных последовательных кругов**. Нет auto-approval или
   фиктивного pass; отсутствие findings фиксируется только после ответа критика.
3. После пятого круга основной агент делает plan-only commit/push. Только затем
   начинается код. Если новые существенные ограничения обнаружены позже,
   обновить план и получить bounded re-review до зависимой реализации.
4. Реализация небольшими coherent commits: cache/auth; controls/URL/copy;
   public lookup/link; Usage policy. Prelease follow-up не входит в эту ветку.
   После каждого — risk-focused tests, без commits в чужих worktrees.
5. Финальные независимые critics читают code+tests+actual browser evidence.
   Material findings исправляются и проверяются на новой head, до zero unresolved
   material findings или явно названного внешнего blocker. Не маркировать missing
   evidence как successful.
6. Проверить свободный диск/память до installs/build/browser. После process inventory
   без active pnpm root выполнил официальный pinned pnpm store prune: reclaimed
   469MB unreferenced CAS (5654 files/45 packages), стало около620MB свободно.
   Installed dependencies и worktrees не удалялись. Затем root завершил pinned
   pnpm11.28.7 frozen-lock/ignore-scripts hardlink install за13.1s:886 packages,
   3downloaded,1068 supply-chain policy checks passed, lockfile не менялся.
   Shared pressure снова дала dfAvail0. Затем Prisma7.8.0 generation успешно
   завершилась за1.86s через существующий local non-require-isolated helper mode.
   unshare unsupported; strict CI isolation не изменена. Pinned TS7.0.2 native
   compiler install прошёл21 supply-chain policy entries, установка завершается.
   statfs UID0 показывает около1.5GB с reserved blocks, df available остаётся0;
   это всё ещё constrained среда, не доказательство local browser readiness.
   Память была
   7/8GB: не стартовать тяжёлые jobs без достаточного запаса/runner. Не чистить
   shared store при active installs, не удалять unknown worktrees/recovery, не
   менять tooling/пропускать gates. Один compiler/browser process за раз.
7. CI/run cleanup: отменять только собственные superseded runs этой ветки/PR,
   сверяя branch+SHA+run ownership; чужие и required latest-head runs сохраняются.
   Следовать обычному PR/merge process, user merge authorization сохраняется.
8. При implementation добавить deployment task по TEMPLATE и index: обычные
   web rollout, при public feature contract — coherent built consumers.
   Staging/production pending до реальных receipts. Новых
   migrations/flags/activation этот срез не требует. Не отмечать merge как deploy.
   Deployment registry и release runbook обязательны перед любым будущим rollout;
   текущая задача не разрешает unrequested production deploy.

## 10. Оценка и готовность

Ориентир, не gate: production code350–650 строк; tests/fixtures450–900; docs и
review receipts250–450. Prelease follow-up не включён в эти оценки. Пересмотреть оценку при
первом review, не добавлять абстракции ради попадания в число строк.

Готово, когда пять plan rounds записаны, actual plan pushed до кода, описанные
journeys и policy semantics проверены, normal required checks зелёные на final
head, material code/UI findings закрыты, deployment task готов и отчёт различает
локальную/fixture квалификацию, CI, merge и ещё не выполненный rollout.
