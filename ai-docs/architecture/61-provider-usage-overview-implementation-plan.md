# Provider usage: overview, графики и модели

Статус: готов к реализации; production-код в рамках подготовки плана не менялся.
Выполнены три запрошенных последовательных прохода по `plan-improve` и `q`:
round 1 - исправлены три P2 (harness path, filtered Runs scope, 401/403 cache);
round 2 - исправлен P2 о rolling/custom Refresh; round 3 - GO без находок и
вынужденных изменений. Notes: `tmp/usage-overview-delivery/plan-review-round{1,2,3}.md`.

База: `origin/main` `dfda0b41`, ветка `feat/provider-usage-overview`, 2026-10-22.
Рабочий checkout: `/Users/belief/.codex/worktrees/provider-usage-browser-acceptance/review-router`.
Принятый образец: [overview-approved.png](../design-references/provider-usage/overview-approved.png),
ограничения образца: [README](../design-references/provider-usage/README.md).

## Результат и границы

В существующем разделе Usage пользователь сразу видит за выбранный период:

- четыре компактных KPI без отдельных тяжёлых карточек: известные токены,
  измеренные provider requests, distinct review runs и известную стоимость;
- дневные stacked bars по провайдерам с переключением Tokens / Requests / Cost;
- top 3 requested models для выбранной метрики;
- таблицу Models / Runs, фильтры периода, provider, requested model и route;
- короткую строку о неполноте/свежести и раскрываемые подробности.

Сохранить существующую чёрную/cyan тему, shell, workspace navigation и responsive
поведение. Образец задаёт композицию, а не данные: не переносить проценты роста,
coverage percentage, «completed runs», суммы/подписи или выдуманный billing.
Default Usage показывает `purpose=review`; Diagnostics выбираются отдельным
компактным переключателем Review / Diagnostics. Оба режима используют тот же
отчёт, но их totals не смешиваются. В diagnostics подписывать KPI «Runs», не
выдавать их за review activity. Binding/run search и сырые observations оставить
в раскрываемых деталях; они не занимают основной filter bar.

Вне scope: quota/subscription windows (план 60), тарифы/биллинг, previous-period
comparison, ingestion, provider execution, новый source, Action/runtime/SDK,
миграции, таблицы materialized totals и общий dashboard framework. Редизайн
operator UI не входит; общие DTO/reader остаются совместимы с его авторизацией.
Нельзя выдавать fixture browser E2E за проверку live providers или установленного
Action. Исходная квалификация планов 57/58 завершена; эта UI-задача не повторяет
её и не заменяет новым fixture evidence.

## Что установлено по исходникам

| Место                                            | Фактический контракт и следствие                                                                                                                                                                                                     |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `provider-usage/application/report-usage.ts`     | `report()` агрегирует полный период до `after`/`limit`; суммы currency/basis точные decimal через bigint. `groups` имеют provider/model/day, но provider там observed fallback, model только observed; route и run rows отсутствуют. |
| `domain/usage.ts::selectReportFacts`             | Correlated bounded summary заменяет неполных детей; полные дети заменяют summary; unbounded summary не складывается с calls. Это единственный выбор token/cost authority.                                                            |
| `prisma-usage-store.ts::PrismaUsageReportReader` | SQL tenant/member scope; `provider` фильтрует `identity.provider`, `actualModel` хранится отдельно. `report()` читает весь разрешённый период, `read()` пагинирует calls.                                                            |
| `aggregateUsage`                                 | `providerAttempts` использует call/dispatched facts; `logicalRuns` считает distinct ненулевые runId по `attemptRows`. Group logicalRuns неаддитивны. Prepared run может существовать без измеренного request.                        |
| `application/ports.ts` / reconciliation          | Максимум запроса 366 суток, `0 < limit <= 100`; ledger удаляет observations старше 365 суток. Это не гарантия полного покрытия этих 365 суток.                                                                                       |
| Web report / API / component                     | SSR уже проверяет членство, личного владельца и active workspace. API каждый раз повторяет проверку. React Query имеет typed key, AbortSignal, staleTime 30s; frontend/API allowlist пока не имеют model.                            |
| Source checkpoints                               | `coveredFrom/asOf` относятся к reconciliation source; не доказывают полноту каждого provider/day/actor. Direct coverage сейчас ошибочно выводится из текущей страницы; это заменить period-level фактом.                             |
| Browser harness                                  | `scripts/accounts-reference-e2e/src/tests/provider-usage.spec.ts` уже проверяет >100 calls, auth, workspace switch и lag на настоящем Next + PostgreSQL/Chromium без реальных credentials. Расширить его.                            |

## Контракт данных и `q`

Все правила authority, группировки, distinct counts и money принадлежат
`packages/features/provider-usage`. Next и charts получают готовый RR-owned
read model. Recharts не импортируется в domain/application. Web форматирует
числа/даты/цвета, управляет controls и отображает состояние; не восстанавливает
period totals из observations, групп дневного отчёта или DOM.

Добавить к `UsagePeriodReport` отдельное additive поле `overview`, не менять
смысл существующих `totals`, `groups`, `rows`, `nextCursor`:

- `daily`: UTC day + requested provider + `UsageTotals`;
- `models`: requested provider + requested model (`string | null`) + route,
  totals и список наблюдённых actual models с признаком unknown observations;
- `topModels`: до трёх provider/requestedModel aggregates для tokens, requests
  и каждого currency/basis cost bucket; routes объединяются в feature, порядок
  по метрике убывает, равные значения разрешаются provider/model key;
- `runs`: первая страница настоящих run aggregates: runId, first/last occurredAt,
  requested provider/model identities, observed-model annotations, routes и
  `UsageTotals`; `nextRunCursor` отдельно от observation `nextCursor`;
- `facets`: requested providers и пары provider/requestedModel из того же
  авторизованного структурного периода до provider/model фильтров;
- period-level `hasDirectObservations` и число observations без runId для
  честных деталей. Последние не превращаются в фиктивный run.

Точная форма имён полей обратима, но эти значения и их scope обязательны.
`UsageFilters`/`UsageReportQuery` получают `model?: string` и `runAfter?: string`.
`model` - exact `identity.requestedModel`; null остаётся видимым в All models
как «Unknown requested model», без sentinel, который мог бы совпасть с реальным
ID. `provider` сохраняет exact `identity.provider`: это выбранный route provider,
а не inferred upstream `actualProvider`. Dropdown подписан «Requested model»;
Models колонка и top-model heading явно говорят requested. При наличии actual
model он показывается вторичной строкой «Observed: …»; requested не становится
observed при отсутствии телеметрии. Несколько observed значений перечислить в
деталях; не объединять aliases разных providers в один row.
Новые строковые filters валидировать как bounded exact IDs (непустые, до 256
символов, без control characters); неизвестный валидный ID даёт пустой отчёт.

Порядок обработки отчёта:

1. SQL ограничивает workspace/actor/active scope, UTC `[from,to)`, route, purpose,
   bindingId и runId. Этот набор не должен расширяться при построении facets.
2. Один раз выполнить `selectReportFacts` на полном полученном наборе, сохранить
   selected token/cost rows и исходные attempt/run rows.
3. Применить requested provider/model predicates к обоим наборам независимо,
   затем тот же `aggregateUsage(selectedRows, attemptRows)` для period и каждого
   overview bucket. Не фильтровать model до authority selection: это может
   превратить полный child manifest в неполный и вернуть summary повторно.
   Перенести provider dimension predicate из SQL report-path туда же, сохранив
   его прежнее requested значение; `read()` сохраняет свои фильтры/пагинацию.
4. Token/cost summary относится к своей identity и своему occurredAt; requests
   относятся к identity исходных calls. Не распределять summary сумму по детям,
   моделям или дням. Поэтому bucket может иметь tokens без измеренных requests
   или requests с неизвестными tokens. Не выводить одно из другого.
5. Distinct runIds считать по полному соответствующему набору, а не суммой
   `groups[].totals.logicalRuns`. Review runs KPI берётся из period totals.
   Не утверждать, что run завершён: lifecycle calls не доказывает run outcome.
6. Runs группировать до пагинации. Стабильная сортировка по opaque runId, после
   `runAfter`, максимум `limit ?? 100`, cursor - последний runId при наличии
   следующего. Run totals, provider/model identities, observed annotations и
   first/last timestamps используют только rows, прошедшие те же structural и
   requested provider/model filters, что и отчёт. Все такие calls участвуют,
   даже когда observations заняли несколько страниц/дней. Исключённые фильтром
   providers/models обратно в run не подтягивать.
   Observation cursor остаётся независимым. Не показывать общее число страниц,
   если контракт его не возвращает.

Разделять selected spend и attempt rows при группировке необходимо: нынешние
`groups` считают requests по selected rows и могут потерять suppressed calls.
Не исправлять это суммированием старых groups в браузере. Сохранить существующие
exports/DTO consumers, обновив их типизированные fixtures под additive поле.
Для operator reader сохранить его workspace-admin authority transaction и не
открывать tenant endpoint для cross-workspace отчёта.

## Деньги, пустые дни и период

- Tokens используют `tokens.total`, input/output - inclusive buckets. Не
  складывать cache/reasoning поверх input/output и не восстанавливать total при
  null. Known zero `0` отображается как zero, неизвестное как «Unknown».
- Стоимость остаётся decimal string по `(currency,basis)`. KPI при одном bucket
  показывает его единицу и basis; при нескольких показывает отдельные короткие
  subtotals. Никогда не складывать USD/EUR или estimated/source_reported.
- В Cost режиме при нескольких buckets появляется компактный selector
  currency/basis. Один и тот же bucket применяется к daily/top-model bars.
  Порядок выбора детерминирован, предыдущий выбор сохраняется, пока существует.
  При отсутствии costs - честное empty state, а не нулевая долларовая диаграмма.
  Ранжирование/sum decimal выполняется в feature; перевод в number допустим
  только для масштаба SVG с finite guard. Tooltip/KPI берёт точную строку.
- `unknownCostCount`, partial/unknown и unknown token values остаются видны.
  Не считать optional cache/TTFT null отдельной «потерей total tokens» и не
  превращать существующий `unknownTokenValues` в coverage percentage.
- Перечислить UTC дни, пересекающие `[from,to)`, с отметкой частичных start/end.
  День без observations - gap с «No observations; coverage unknown», не
  подтверждённый zero. День с requests, но неизвестными token/cost значениями,
  сохраняет marker/tooltip и unknown status. Нулевая высота известного zero не
  должна скрывать его accessible значение. Не дорисовывать положительные bars.
- Presets 7/30/90 суток; default 30 суток как текущий rolling UTC API interval.
  Для одного запроса фиксировать один `now`; текущий UTC день входит частично
  до этого `now`, что явно указано рядом с периодом.
  Custom dates видимы как inclusive календарные даты UTC, адаптер переводит
  end date в начало следующего UTC дня. Preview показывает точный `[from,to)`.
  Неполный/некорректный draft не отправляется: inline validation, Apply disabled.
  Запрос >366 суток, invalid или reversed - 400; не clamp молча.
- Указать retention 365 суток и ограниченность наблюдений, если выбран более
  ранний start. Не выдавать отсутствие уже удалённых данных за zero usage.
  Reload и выбор rolling preset получают новый согласованный interval. Manual
  Refresh при активном preset фиксирует один новый `now`, сдвигает обе границы
  на выбранные 7/30/90 суток и сбрасывает оба cursors; запрос идёт через новый
  query key. При custom dates Refresh сохраняет interval и refetch текущего
  key. Фильтрация/пагинация и background polling используют зафиксированный
  interval, polling сам окно не сдвигает. Часовой пояс браузера и DST не меняют
  day bins.

## UI и async-поведение

Основная компоновка как в reference: заголовок/filter bar, четыре inline KPI с
тонкими dividers, широкий daily chart слева и model bars справа, ниже tabs/table,
в конце компактная status line + Details. Без nested cards. На узком экране KPI
2×2, filter controls переносятся, графики идут вертикально. Tables имеют свой
горизонтальный scroll container; страница и sidebar не расширяют viewport.

Recharts использовать только для daily stacked bars и top-model bars. Проверено
через npm registry 2026-10-22: stable `recharts@3.10.1`, peers допускают React 19.
Перед установкой повторить проверку версии, закрепить stable и совместимый
`react-is`, обновить только app dependency + workspace lock. Нужны responsive
SVG, tooltip и keyboard layer, что оправдывает библиотеку; ручной chart engine
не создавать. Models/Runs достаточно semantic HTML table и существующих
UI primitives: TanStack Table пока не нужен, server cursor не требует grid engine.
Если исполнитель добавляет сортировку, Models сортируются по полному model
aggregate, Runs не сортируются только внутри текущей страницы под видом global.

Использовать `@reviewrouter/ui` Button/SelectField и существующие dashboard
patterns. `SelectField` сейчас uncontrolled (`defaultValue`): минимально добавить
optional controlled `value` с mutually exclusive props либо применять существующий
подход remount по фильтру. Не вводить новый bespoke select. Tabs/metric buttons
с доступными именами, selected state, keyboard/focus; chart имеет краткое описание,
tooltip с UTC/provider/value/unknown status и доступную табличную альтернативу
daily данных в Details. Цвет не единственный идентификатор. Provider palette
детерминирована и общая для legend, bars и rows, неизвестный provider нейтрален.

Состояние filters/tab/metric/costBucket - локальное UI state; report хранит только
React Query. SSR `ProviderUsageSection` передаёт initialReport и точные
initialFilters (`purpose=review` + interval); `initialData` применяется только к
совпадающему ключу. API allowlist, validator и serializer одновременно включают
model/runAfter. Typed keys содержат workspace и нормализованные filters.
Сохранить staleTime 30s, AbortSignal и foreground polling только при partial/
unknown. Manual Refresh следует правилу rolling/custom выше: смена key сама
запускает один fetch, не сопровождать её refetch старого или нового key. Для
custom interval выполнить один refetch текущего key. Не запускать inference.
Filter/purpose/provider/model/date/route/binding/run change сбрасывает оба cursors;
provider change также сбрасывает model, workspace change - весь локальный state.
UI tab/metric change не сбрасывает период и не делает ненужного запроса.

При новом фильтре показывать loading для нового контекста, не старые totals как
будто они уже отфильтрованы. При transient refetch failure в том же контексте
можно сохранить последнее значение с явной stale/error подписью. API adapter
возвращает типизированную ошибку с HTTP status. При 401/403 немедленно скрыть
workspace report, отменить in-flight queries и удалить все ключи с prefix
`["provider-usage", workspaceId]`, включая другие filter/page варианты. До нового
авторизованного context/SSR report запретить повторное seeding старого
`initialReport` и запросы из прежнего context; возврат к другому фильтру не
восстанавливает данные. Это локальное поведение Usage, без нового security
framework. Другой workspace не получает placeholder/initialData прежнего; сохранить
существующую очистку foreign workspace cache. Empty interval показывает четыре
честных значения/unknown и объяснение «No measured observations», без fake bars.
Details раскрывают source windows/lag/retry, producer partial delivery,
unattributed, unbounded summaries и paginated observations. Checkpoint сведения
подписать как source-wide, не как полноту выбранной модели/маршрута.

## Ownership и порядок реализации

| Файлы / ответственность                                                                                                                     | Изменение и граница                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/features/provider-usage/src/application/{ports,report-usage}.ts`, при необходимости небольшой `usage-overview.ts`, `src/index.ts` | Query model/run cursor, feature-owned aggregates/facets/exact cost ordering. Без React/Next/Recharts/Prisma imports в policy.                                                                                 |
| `.../infrastructure/{prisma-usage-store,prisma-operator-usage-report-reader}.ts`                                                            | Tenant/member/structural SQL остаются здесь; report dimension sequencing согласован с policy. Не менять ingest, schema и operator authority.                                                                  |
| `apps/web/src/server/provider-usage-{report,view-model}.ts`; tenant API `app/api/dashboard/provider-usage/route.ts`                         | Авторизация и safe DTO; никакие actor/authorization IDs, source credentials, account labels, raw projections не уходят в browser. Shared operator consumers адаптировать только для type/query compatibility. |
| `apps/web/app/dashboard/provider-usage-{model,api,view}.tsx/.ts`, небольшие `provider-usage-{charts,tables,format}.tsx/.ts`                 | UI composition/React Query, chart/table presentation. Policy не размазывается по component hooks. `dashboard-workspace-page.tsx` - только SSR default/props.                                                  |
| `packages/ui/src/select-field/*` только если нужен controlled API                                                                           | Обратимо расширить существующий shared primitive, старые потребители работают. Не добавлять feature-specific provider types в UI package.                                                                     |
| Web `package.json`, `pnpm-lock.yaml`                                                                                                        | Только обоснованная chart dependency; без обновления Next/React и посторонних библиотек.                                                                                                                      |
| Существующие usage feature/server/view tests; browser `provider-usage.spec.ts`, его локальный fixture helper                                | Проверки policy/auth/настоящего DOM, scoped fixtures и screenshots. Новые handwritten harness helpers на TypeScript.                                                                                          |

Сначала reporting contract + focused tests, затем SSR/API + UI vertical slice,
затем browser acceptance и визуальная доводка. Работать в указанном worktree,
не revert чужих изменений. Один coherent PR, ориентир до ~2000 changed production
LOC без lock/fixtures; не разрезать authority/filter contract пополам ради лимита.
Если фактический объём заметно больше, root выбирает самостоятельный additive
reporting checkpoint и зависящий UI PR до доставки, не после готового mega-PR.

## Проверка и наблюдаемая приёмка

Добавить минимальные независимые проверки реальных рисков:

1. Feature: >100 observations с totals на другой странице; run через несколько
   дней/providers/models считается один раз, run row содержит все calls,
   прошедшие выбранные filters, независимо от observation page. Выбор A/X из
   run с A/X и B/Y исключает B/Y из totals/identities/timestamps; summary
   suppression/unbounded не удваивают spend; model/provider filter после selection
   не возрождает summary; prepared/effect_unknown/known-zero/null различимы.
   Проверить exact decimal и разные currency/basis, requested != observed model.
2. Server/API: model/runAfter передаются; 366 суток допустимо, >366/invalid - 400;
   member видит только свой actor, repository-only/чужой workspace - 403;
   безопасный DTO не содержит внутренних IDs/credentials. Существующие valuable
   authorization tests сохранить, не заменять source-text assertions.
3. Component: SSR hydration exact filters, filter reset/cursor reset, быстрые
   filter changes/AbortSignal, workspace switch и 401/403 не показывают stale
   data. До revocation заполнить два filter keys, после отказа вернуться к первому:
   ни cache, ни прежний SSR report не восстанавливают скрытые данные;
   metric/cost bucket, empty/unknown и desktop/mobile loading/error controls.
   Preset Refresh с одним captured now сдвигает interval и сбрасывает cursors
   одним fetch; custom Refresh и polling сохраняют обе границы.
4. Browser: расширить существующий fixture сценарий на несколько UTC дней,
   несколько requested providers/models, observed mismatch/null, >100 calls,
   повторяющийся runId, diagnostics и multiple cost buckets. Использовать
   настоящий Next route + migrated isolated PostgreSQL 17 + Chromium. Проверить
   KPI/chart tooltip/model/run rows до и после pagination; все filters, Refresh,
   Details, member/forbidden и workspace navigation; backend payload совпадает
   с независимо заданными fixture expectations. Не ограничиваться mocked fetch.

Команды focused preflight из корня (уточнить только новые test filenames):

```sh
pnpm exec vitest run packages/features/provider-usage/src/tests/usage.test.ts apps/web/src/server/provider-usage-report.test.ts apps/web/app/dashboard/provider-usage-model.test.ts apps/web/app/dashboard/provider-usage-view.test.tsx
pnpm --filter @reviewrouter/features-provider-usage typecheck
pnpm --filter @reviewrouter/web typecheck
pnpm --dir scripts/accounts-reference-e2e run check
git diff --check
```

Browser запускать на hosted runner по существующему README/harness. Для final
acceptance нужен PG17, не PGlite; secret URL выдаёт orchestrator явным тестовым
параметром, без fallback к application DATABASE_URL:

```sh
ACCOUNTS_REFERENCE_E2E_GREP='provider usage' pnpm --dir scripts/accounts-reference-e2e run e2e -- \
  --repo-root "$PWD" \
  --database-url "$ACCOUNTS_REFERENCE_E2E_TEST_DATABASE_URL" \
  --expected-revision "$CANDIDATE_SHA" \
  --work-dir "$PWD/tmp/accounts-reference-e2e/runs/provider-usage-overview-candidate"
```

Хосту передать точный commit/patch, source ownership и scratch/cache под
job-owned `/srv/workers`; проверить machine-id/resources, не запускать provider
jobs. Сохранить один workload handle и его результат. Не трогать существующие
fixtures/roles/процессы другого задания; текущий harness требует изолированный
пустой TEST DB и контролирует global migration roles.

В том же browser pass сохранить и **посмотреть** full-page screenshots: 1440×1000,
1024×768, 390×844 и 200% layout sample 640×400 CSS @DPR2. Минимум desktop/mobile
для populated Tokens, desktop Cost с mixed buckets, mobile Runs, empty/unknown
и раскрытых Details. Harness snapshots/trace/result остаются в его разрешённом
`tmp/accounts-reference-e2e/runs/provider-usage-overview-candidate/`;
дополнительные visual notes допустимы в `tmp/provider-usage-overview/`.
Сверить с approved reference: hierarchy, плотность KPI, chart proportions,
точность/читабельность axes, legend, tab/table alignment, focus, popup placement,
отсутствие nested card clutter, page overflow и обрезанных длинных model IDs.
После исправлений повторять только затронутый сценарий; финальный связный browser
pass на фактическом candidate обязателен. Кратко сохранить visual verdict и
limitations в result receipt, не объявлять screenshot existence visual review.

Перед PR: `pnpm architecture:check`, `pnpm format:check`, `pnpm lint`,
`pnpm typecheck`, `pnpm test`, `pnpm build`, relevant runtime smoke согласно
[release source of truth](../operations/07-environments-and-release-management.md).
Тяжёлые checks предпочтительно hosted; после зелёного результата не повторять их
без изменения/нового риска. PR проходит normal CI; проверить полный required set
и exact current head, watcher через один `gh pr checks --watch` session.
Conventional commit с author/committer `iliya <iliyazelenkog@gmail.com>`.

Delivery: root интегрирует только разрешённый diff, выполняет осмысленное итоговое
code review и normal PR/CI. Деплой только после всей coherent batch; согласовать
production 198 с параллельным OCR workstream до любого deploy. Не менять его
релизные pins/schema или запускать конкурирующий production rollout. Quota/infra
blocker прекращает deploy attempts. Rollback этой фичи - revert coherent UI/report
commit и штатный redeploy; schema/ledger не меняются. Планирование не запускает
deploy, provider inference, account login или новую disposable GitHub repository.
