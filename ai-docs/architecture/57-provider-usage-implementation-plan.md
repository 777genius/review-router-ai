# Учёт расхода провайдеров: Gateway/sub2api и GitHub Secrets/runner

Статус: план реализации, после отдельного прохода `plan-improve` и `q`.
База: `origin/main` `bb277462bed5135a838b20d07eeae69034562bd8`, 2026-10-21.
Отдельный план: [публичный каталог моделей](58-public-provider-model-catalog-plan.md).
Новая самостоятельная фаза: [нативные лимиты аккаунтов в Accounts](60-account-native-limits-implementation-plan.md).
Она имеет собственную приёмку и оценку остатка; не расширяет исходную приёмку
ledger/двух транспортов этого плана и не входит в каталог моделей.

## Результат и границы

Создать `packages/features/provider-usage` внутри текущего приложения. Модуль
владеет правилами учёта, своей таблицей фактов и проекцией, дедупликацией,
полнотой данных и отчётами. Оба источника входят в результат: Gateway/sub2api
и прямые вызовы runner с GitHub Secrets. Показывать расход по workspace,
провайдеру, модели, подключению, запуску и периоду, включая неуспешные попытки.
Содержимое запросов, ответов и секреты в модуль не попадают.

Это модуль монолита с собственной ответственностью и PostgreSQL-таблицами.
Не добавлять отдельный процесс, брокер, распределённые транзакции или универсальную
платформу метрик. Достаточная точка будущего выноса: версионированный контракт
приёма событий, собственные таблицы, порты записи/отчётов и отсутствие чтения
внутренних таблиц соседями. Эксплуатационный вынос потребует отдельной задачи.

Остаток подписки и дата сброса не вычисляются из количества токенов. В UI
различать измеренный расход, оценочную стоимость и реальные upstream quota/balance,
если источник их действительно сообщает. Новая система биллинга, списание денег,
лимитирование запусков и произвольный внешний SDK ingestion в эту задачу не входят.

## Проверенное текущее состояние

| Место                                                                                   | Что переиспользовать / чего оно не доказывает                                                                                                              |
| --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `review-evidence/src/domain/review-observation.ts`                                      | `safeUsage` имеет nullable input/output/total, но observation только `Success`; это не полный журнал расхода                                               |
| `review-investigations/src/application/use-cases/commit-attested-investigation-turn.ts` | Известны turn/attempt, input/cache/output/reasoning, actual model; учёт после принятия turn теряет rejected/failed spend                                   |
| `apps/api/src/review-run-gateway-relay.ts` и `review-run-gateway-preparation.ts`        | До `preparation.request` создаётся `rr-request-*`; есть auth/run context и `not_dispatched`/`effect_unknown`. SSE сейчас передаётся непрозрачно            |
| `codex-oauth-rotating/src/action/github-action.ts`                                      | Использует внешний `@777genius/subscription-runtime` и packaged engine; успешный `turn.completed` не равен всем underlying API attempts                    |
| `action-control-plane/.../exchange-github-oidc-token.ts`, `review-run-control`          | Доверенная привязка к workspace/repository/run/runAttempt/authorization из OIDC и серверного состояния                                                     |
| `features/outbox`                                                                       | Идемпотентные неизменяемые сообщения, collision detection, fenced retry/dead-letter. Переиспользовать после durable ingest                                 |
| Vendored `@agent-teams/account-gateway`                                                 | Есть `/contracts`, `/http`, `/get-modular`; в текущем фасаде нет API журнала usage/limits. Наличие upstream sub2api endpoint не добавляет его в этот фасад |

Пути feature-пакетов в таблице относительны `packages/features/`.
Успешные evidence/checkpoint totals сохраняют свою прежнюю семантику. Не менять
их в authoritative финансовый журнал и не суммировать поверх per-call данных.

У upstream sub2api на проверенном commit
`7da09cab4e875463baa79fc150adde700c5438df` usage встроен в обработку запросов:
есть модельные ID, request ID, token/cache buckets, стоимость и задержки.
Панельный `GET /api/v1/usage` авторизован и использует page pagination;
это не анонимный endpoint и не надёжный курсор изменений. `/v1/usage` относится
к quota/balance ключа, а не к полному журналу. Версию и доступный контракт реально
установленного native runtime предстоит квалифицировать в шаге 1.

## Границы по `q`

- Domain: идентичность расхода, состояния, единицы, правила конфликтов и полноты.
  Application: приём фактов, сверка источника, построение отчёта.
- Consumer-owned ports: `UsageStore` с атомарным приёмом факта/проекцией,
  `UsageReportReader`, `UsageSourceReader` для сверки. Поддержку limits вынести
  в отдельный узкий reader; не заставлять runner реализовывать её пустышкой.
- Infrastructure: Prisma, адаптер native/sub2api, runner telemetry parser,
  outbox. API/worker/web composition задают конкретные реализации и авторизацию.
- Domain/application не импортируют Prisma, Next/Fastify, внешние SDK,
  Get Modular или Foundation. Соседние features используют только публичный API;
  событие accepted review является одним источником сведений, не владельцем ledger.
- Каталог моделей остаётся в `review-providers`. Для оценки стоимости usage
  запрашивает нормализованный price snapshot через собственный потребительский
  порт. Не копировать модели провайдеров и не создавать обратный импорт каталога.

## Шаг 0. Совместимые библиотеки и границы

Общий prerequisite для двух планов; выполняется один раз, с ограниченным scope.
Нынешняя установка инструментов не означает автоматической активации правил.

1. Зафиксировать точные registry-артефакты, SRI и публичные exports. Проверено
   2026-10-21: текущие кандидаты Core/Assembly 0.7.0 и Foundation 2.1.0.
   Get Modular source использует минимум TS 7.0.2; совместимость consumer
   declarations 0.7 с TS 6 отдельно не подтверждена. RR использует TS 6.0.3
   и pnpm 10.33.0.
   Старые примеры из plan 51 не считать текущим контрактом.
2. Для этого seam выбрать опубликованную пару `@get-modular/core@0.2.0` и
   `@get-modular/assembly@0.2.0`, совпадающую с зависимостями установленного
   Gateway SDK. Это осознанная совместимая кандидатура, а не рекомендация
   автоматически брать latest. На exact packed artifacts подтвердить сборку
   RR-потребителя с TS 6.0.3, ESM и `skipLibCheck: false`. Если она не проходит,
   остановить только подключение библиотеки и оформить конкретную совместимость
   как prerequisite; не скрывать ошибку через `any`/skipLibCheck и не переносить
   весь проект на TS 7 в рамках этой фичи.
3. Foundation `2.1.0` подключить только как dev dependency. Ему нужен pnpm
   `>=11.17 <12`; до установки сделать отдельный ограниченный toolchain PR:
   закрепить поддержанный Node (включая SDK floor `>=24.21 <25` либо
   `>=26.10 <27`), точный pnpm 11.x, согласовать CI/Docker/operator bootstrap
   и lockfile. Квалифицировать существующую установку/сборку; не выполнять
   массовые несвязанные обновления зависимостей. Без этого шага не объявлять
   Foundation принятой в RR.
4. Использовать Get Modular для двух реальных composition capabilities:
   `providerUsage` и `providerModelCatalog`. Внутри связать store/source reader/
   use case через типизированные contracts, factories и явные bindings.
   Для выбранной версии 0.2 публичные entrypoints: `defineModule`, `required`,
   `compileComposition` из core; `assemblyFor`, `CapabilityContract`,
   `bindFactory` и `prepare({composition, factories, roots})` из assembly.
   Не копировать `declareModule`/`defineContract`/`group` из руководства версии 0.7.
   Экспортировать отдельную server-only `/composition` surface. Не заводить
   module node на каждый parser, модель или арифметическую функцию.
   Публичный бизнес-API остаётся RR-owned. Сборка одна на host/process с его
   штатным shutdown, без новой lifecycle платформы. SDK handles 0.2 не передавать
   в assembly 0.7; APIs разных поколений не смешивать.
   В prerequisite проверяется минимальный consumer fixture; production wiring
   добавляется вместе с соответствующим use case в feature PR, без пустых модулей.
5. В Foundation принять ограниченный `architecture.source-dependencies` v1
   профиль для новых usage boundaries и изменяемого catalog seam с реальными
   roots/entrypoints/production-test ownership. Реализовать `foundation:check`,
   `foundation:assert-dev-only`, `foundation:assert-registry` через поддержанные
   команды `agent-teams-foundation check`, `assert-dev-only`, `assert-registry`.
   Подключить к существующему architecture/CI gate. Проверить разрешённый импорт,
   запрещённые value/type imports и неизвестный source внутри принятого scope.
   Foundation не должна попасть в runtime graph/types/browser bundle.

Уточнение при реализации 2026-10-21: опубликованная Foundation 2.1.0 v2
отвергает частичную область pnpm workspace с
`WORKSPACE_PACKAGE_OUTSIDE_PACKAGE_ROOTS` (`apps/api/package.json`). Её v2
контракт требует покрыть все workspace packages и их sources. Поэтому для
двух feature seams принят публичный v1 профиль той же версии Foundation:
он проверяет реальные roots/entrypoints, value/type imports, неизвестные sources
и production/test ownership без фиктивного workspace и общей миграции.
Отрицательные проверки выполняются установленным CLI на реальном workspace;
v2 adoption остаётся отложенной до поддержки такого scoped режима upstream.

Проверка Get Modular должна доказать не только types: правильный binding даёт
работающий use case, отсутствующий/несовместимый binding отвергается до I/O,
завершение освобождает только созданные этой композицией ресурсы. Domain tests
не требуют module runtime. Не добавлять Docs Protocol, global corpus migration,
новую архитектурную проверялку импортов или repository-wide adoption.

## Единица учёта и контракт фактов

Единица - один фактически отправленный provider request/attempt. Logical review,
agent turn, HTTP relay request и usage event - разные идентичности. Для CLI,
который сообщает только общий turn total, поддержать `granularity: turn` с
явным покрытием; не выдавать его за per-call данные и не складывать с уже
учтёнными вложенными вызовами. Целевой результат для двух транспортов - capture
на provider transport seam; ограниченный источник в отчёте виден как partial.

Для смешанного покрытия summary содержит точный parent scope и закрытый диапазон
turn/attempt sequence либо полный manifest child call IDs. Для одной области
отчёт выбирает одну форму: final summary, пока не доказано полное покрытие
детьми; после полного набора - child facts. Частичный child subtotal показывается
отдельно и не прибавляется к summary. Если summary нет, показывается только
известная часть child usage с partial. Если границы summary не доказаны, формы
не объединяются: summary остаётся отдельно reported, в per-call итог входят
только коррелированные дети с пометкой неполноты. Не вычислять остаток вычитанием
несопоставимых totals. Поздние дети/summary correction пересчитывают выбор формы
детерминированно. Число provider attempts берётся только из child lifecycle,
а не из одного summary; API/UI различают measured и reported granularity.

Версионированный безопасный факт содержит:

- Source instance, event ID, revision, schema version, hash нормализованных
  bytes; время события и приёма. Envelope не включает произвольный upstream JSON.
- Внутренний call ID, parent turn/invocation, attempt ID и непрозрачные ссылки
  workspace/repository/run/runAttempt/authorization/binding. Сервер сверяет scope
  и derive actor из доверенной авторизации; upstream account ID не является user ID.
- Requested provider/model, observed actual provider/model, маршрут
  `gateway | direct`, runtime type, service tier, terminal outcome/dispatch effect,
  duration и TTFT, если измерены. Не определять actual model по имени аккаунта.
- Nullable input/output/cache read/cache write/reasoning/total, точная семантика
  buckets, provenance и `complete | partial | unknown`. Денежные значения:
  decimal с валютой, basis, timestamp/source и price version.

Канонически `inputTotal` включает cache-read/cache-write, `outputTotal` включает
reasoning. Cache/reasoning являются подмножествами, их повторно не прибавлять
к total. OpenAI inclusive input и sub2api non-cache input нормализуются разными
адаптерами; subdivision неизвестна, если источник дал только total. Не подставлять
ноль. Проверять безопасные целые неотрицательные значения и согласованность
сумм лишь при известной семантике всех частей. Cache write 5m/1h - разновидности
одного bucket, не два дополнительных total. Оценивать цену по раздельным
непересекающимся billing buckets, иначе стоимость неизвестна.

`estimatedCost` - расчёт по price snapshot на момент запроса; `sourceReportedCost`
сохраняет смысл upstream (например, sub2api charge), не называется подтверждённым
списанием провайдера. Не пересчитывать историю по свежим ценам. Без цены, currency,
модели или нужного tier/bucket сумма неизвестна; подписочный расход токенов не
превращать в денежное списание. Historical backfill не оценивается сегодняшней ценой.

## Дедупликация, изменения и хранение

1. `UsageSourceFact` хранит уникальный `(sourceInstance, eventId, revision)`.
   Повтор с тем же hash - no-op; с другим hash - конфликт, не overwrite.
   `UsageCall`/проекция имеют уникальный внутренний call ID и tenant scope.
   Коррекции источника принимаются новой revision с сохранением provenance.
   Revision - положительный source-local integer для одного event, сравниваемый
   численно. Поздняя меньшая revision хранится, но не становится current.
   Source/call/tenant linkage и единицы неизменяемы. Исправлять можно usage,
   observed actual model, cost, измеренные времена и outcome с явным correction
   reason; изменение identity требует отдельного conflict resolution, не overwrite.
2. Runner назначает `usageOperationId` для логического transport operation и
   передаёт в versioned relay contract как непрозрачное metadata поле, привязанное
   сервером к текущему invocation. RR продолжает создавать свой `rr-request-*`
   внутри admission loop перед каждым native request и сохраняет mapping
   `(invocation, usageOperationId) → native requestRefs`. Это разные ID.
   Native добавляет отдельный upstreamAttemptRef на каждый фактический dispatch;
   call identity - `(nativeSourceInstance, requestRef, upstreamAttemptRef)`.
   Локальный admission retry с `not_dispatched` не создаёт consumed call.
   Runner узнаёт mapping через безопасные relay metadata/receipt, не назначает
   native ID и не требует изменения непрозрачных SSE bytes. Для direct route
   transport создаёт свой operation/attempt ID в namespace producer instance.
   Usage report retransmit сохраняет ID; новая реальная отправка - новый attempt.
   Correlation metadata не меняет существующую политику inference retries и
   не является новым execution permission или обещанием replay результата.
3. Для Gateway расходом владеет native usage observation; runner дополняет
   контекст, но его total не складывается с native total. Для direct route
   владельцем является provider transport/runtime telemetry. Совпадение
   моделей/времени/токенов не доказательство одного запроса.
   Приоритет применяется к целому usage snapshot с известной семантикой, не
   случайному набору полей разных sources. Lifecycle observation владеет dispatch
   effect, native - Gateway usage/cost, runtime - direct usage, runner - UI context.
   Конкурирующие revision атомарно обновляют только поля своего authority;
   расхождение двух supposedly authoritative terminal фактов видимо как conflict.
4. Некоррелированный старый sub2api fact не добавлять к attribution-отчёту
   tenant по догадке. Сохранить в закрытой сверке как unattributed с причиной;
   не суммировать в «весь расход» поверх уже учтённой копии. Historical import
   ограничен доказанной областью владения. Не обещать полный backfill старых run.
5. Состояния: prepared → dispatched → completed/failed/cancelled/unknown.
   `not_dispatched` не потребляет provider call; `effect_unknown` и оборванный
   stream не означают нулевой расход. Поздний usage закрывает unknown/partial.
   Отдельная реальная retry attempt получает новый ID и учитывается отдельно.
   Retry доставки того же факта сохраняет ID. Out-of-order старый факт не
   откатывает terminal state; исправление terminal - только новой correction revision.
6. Приём факта, обновление проекции и событие для дальнейшей обработки фиксируются
   одной DB transaction; ACK только после commit. При конкуренции source/runner
   unique constraints и повторное чтение защищают от двойной записи. Network
   exactly-once не обещается. Отчёты сначала SQL по индексированным проекциям,
   без materialized aggregates, требующих отдельной системы коррекций.
7. Добавить Prisma models/migration в `packages/platform/db/prisma/schema.prisma`:
   факты, вызовы/проекции, source checkpoint и ingestion conflicts. Индексы
   `(workspaceId, occurredAt, provider, actualModel)` плюс call/source uniqueness.
   Retention фактов 90 дней, проекций 365 дней. Runner/report artifact replay
   разрешён до 7 суток после завершения invocation; native reconciliation -
   до 30 суток, native journal хранится минимум 35 суток. Источник revision
   correction относится к своему original event; correction вне окна становится
   отдельной видимой операцией сверки, а не тихим автоматическим import.
   Dedupe tombstones хранить 400 суток от последней принятой revision; просроченные
   события отвергать до insert с кодом `usage_report_expired`/`source_window_expired`.
   Нельзя повтором пересоздать удалённую projection. При удалении workspace удалить/обезличить
   согласно существующей deletion policy, включая spool/outbox projections.

## Шаг 1. Gateway/sub2api

1. Зафиксировать установленный native runtime/SDK pin и доступные usage facts.
   Расширить source-owned фасад: безопасное наблюдение одного запроса и
   bounded `listUsage(afterCursor, limit)` для сверки, с request correlation,
   token semantics, corrections/completeness и непрозрачным cursor. Нужны
   owner-side изменения и SDK archive; перечислить их как часть поставки.
   Не импортировать напрямую native DB и не копировать master credentials в web.
2. На фактическом request seam сохранять prepared/dispatched identity и итог
   вне зависимости от принятия review. Для dashboard Test connection использовать
   тот же recorder с `purpose: diagnostic`, чтобы диагностика тоже учитывалась.
   Локальный admission отказ с `not_dispatched` регистрирует отказ, но не расход.
3. Source-owned adapter читает sub2api token/cost metadata там, где владеет
   upstream запросом, и публикует безопасные durable facts. Не пересылать prompt,
   raw logs и upstream credentials. Если upstream usage очередь best-effort,
   локальная запись lifecycle не маскирует потерю actual tokens: completeness partial.
4. Сверка в существующем worker через outbox: initial import только с момента
   активации, последующие страницы до captured high-water mark, bounded batches,
   checkpoint после durable записи всей страницы. Повтор страницы безопасен.
   Lease/fence запрещают двум pollers продвинуть один checkpoint независимо.
   При ошибке ограниченный retry с backoff, затем видимый dead-letter/lag.
5. Панельный sub2api page API нельзя выдавать за monotonic change feed: если
   он нужен внутри native adapter, читать закрытые UTC интервалы с overlap,
   сортировкой/дедупликацией, а cursor/late correction гарантию обеспечивать
   своим durable журналом. Нельзя терять вставки/поздние corrections между страницами.
   Отсутствие такой гарантии явно снижает coverage, а не рисует полный отчёт.

## Шаг 2. GitHub Secrets и runner

1. Изменить owning provider transport в `@777genius/subscription-runtime`,
   public Action v2 source и wrapper по существующему
   [контракту handoff](../operations/review-action-v2-contract-handoff.md).
   Только SaaS-код не видит скрытые CLI retries; считать этот внешний patch
   обязательной зависимостью для per-call coverage. Не редактировать один dist.
2. Для Codex/OpenAI/MiMo/OpenRouter и Claude runner собирать safe telemetry
   каждого доступного запроса/attempt, включая nonzero exit и отказ/retry/abort.
   На старом CLI/runtime без такого hook принять turn summary отдельно с partial
   coverage. Его cumulative counters преобразовывать в snapshot/revision, не
   добавлять каждый повтор как новый расход. Не реконструировать prompts из logs.
3. Добавить versioned usage report к control-plane сессии, отдельный от финального
   review artifact. Scope определяет OIDC/run authorization; клиент не выбирает
   workspace/user/foreign binding. Проверять numeric repo ID, run attempt,
   разрешённый provider invocation, payload hash и capability только на usage ingest.
   При истечении lease поздний факт не даёт права нового запуска: безопасная
   доставка идёт через ограниченный report-only recovery по тому же run identity.
   До истечения execution authorization выдать отдельный ingest grant: только
   запись usage для фиксированных numeric repo/run/runAttempt/invocation,
   producer release digest и approved immutable workflow/job identity. Grant
   сервер хранит отозваемым; expiry 7 суток после закрытия invocation, до него
   ограничен 8 сутками от issuance и продлевается только действующей execution
   authorization, в пределах штатного maxRun. Нельзя получить
   такой grant заново по одному run ID. Использовать отдельную audience/capability,
   запретить inference, secret read, publication и выбор другого scope.
4. Producer пишет небольшой safe spool до сетевой доставки, сохраняет event ID
   при retry, отправляет bounded batch и удаляет только ACKed bytes. Ограничить
   batch/spool и выводить статус неполноты при overflow, не сохранять raw logs.
   Временный API отказ не должен повторно запускать inference или проваливать
   успешно полученный review исключительно из-за аналитики.
5. GitHub job всегда пытается flush в cleanup. При полной потере runner прочитать
   safe report artifact из того же проверенного GitHub run через существующий
   App-owned доступ, повторно проверить scope/hash/schema и replay window.
   Artifact имеет фиксированное имя `reviewrouter-usage-v1-<invocation>-<runAttempt>`,
   версионированный manifest, ordered event hashes и подпись producer. До запуска
   trusted runtime генерирует ephemeral Ed25519 keypair и регистрирует public key
   вместе с ingest grant после текущей OIDC/workflow authorization. Private key
   остаётся в runtime; подписанный safe spool/artifact не содержит его/grant token.
   Import сверяет подпись с сохранённым ключом, grant, approved workflow/job,
   producer digest, invocation и 7-day window. Один hash/имя artifact/принадлежность
   run недостаточны. Доверие к прямым сведениям - уровень авторизованного runtime
   producer, не независимая сверка с биллингом провайдера.
   Artifact содержит только usage DTO, не секреты и не review output. Жёсткая
   потеря runner до сохранения всё ещё допускает unknown; UI показывает coverage.
6. Старые Action/runtime pins продолжают запускаться без нового поля: строка
   «телеметрия недоступна», не нули. Обновление Secrets workflow следует T0 v2
   и immutable approved pin; не переключать на legacy workflow ради статистики.
7. При workspace deletion отозвать grants, запретить ingest/import с terminal
   `usage_scope_deleted`, исключить source checkpoint из дальнейшей сверки и
   удалить safe artifacts по существующей deletion policy. Share/membership
   revocation запрещает новые execution, но допускает report-only facts о уже
   зарегистрированных dispatch в пределах их прежнего scope и replay window.
   Это не возвращает отозванному пользователю доступ к чтению отчёта.

## Шаг 3. Отчёты и доступ

Первый экран - server loader после текущей workspace authorization. Период по
умолчанию 30 дней, UTC `[from,to)`, максимум 366 дней на запрос; отображать
часовой пояс. Группировки provider/model/day, фильтры route/binding/run/purpose,
page size до 100. Запросы ограничены tenant и параметризованы. Различать число
logical runs и число provider attempts, не считать accepted turns числом запросов.

Показывать tokens, известную часть стоимости с валютой/basis, latency/TTFT при
наличии, unknown/partial/unattributed counts, covered-from и source lag/as-of.
Сумма известных значений при наличии unknown помечается «известная часть».
Не суммировать разные валюты. Diagnostics выделяются фильтром и видимым subtotal.
Quota/limits, если их сообщает native facade, показываются отдельным as-of
снимком с scope (ключ/аккаунт/подписка) и reset; без источника - «неизвестно».
Реализация полного reader subscription entitlements не prerequisite ledger.
Конкретный reader, доступ владельца, UI Accounts и безопасное обновление
определены в [плане 60](60-account-native-limits-implementation-plan.md).
Workspace usage report не имеет единого процента account quota: общий аккаунт
может обслуживать несколько workspace и внешние обращения. Его текущую строку
`Quota / limits: unknown` заменить переходом к разрешённым Accounts только при
реализации плана 60, без вывода quota из ledger totals.

Workspace owner/admin видят полный отчёт своего workspace; member - только
свои атрибутированные запуски. Общий upstream account не открывает данные
других workspace. Для запусков без известного actor данные доступны только
owner/admin. Операторский aggregate для всех пользователей доступен только
по существующей operator authorization, отдельным query path; не передавать
tenant selector из browser как полномочие. Share revoke не даёт нового
доступа к донорской истории; владение собственными historical usage facts
не требует сохранять чужие account labels/секреты.

Интерактивные фильтры/повторное чтение - React Query: typed keys рядом с feature
(`['provider-usage', workspaceId, filters]`), API adapter отдельно от компонента,
`staleTime` 30 секунд, polling только пока экран открыт и есть незавершённые
данные. Scope входит в query key; workspace switch удаляет чужой cached view.
Авторизацию всегда повторяет сервер. Использовать общие таблицы/фильтры,
без вложенных карточек и отдельной копии query data в local state.

## Порядок поставки и оценки

| PR / checkpoint | Самостоятельный результат                                        | Зависимости                                                   |
| --------------- | ---------------------------------------------------------------- | ------------------------------------------------------------- |
| 0               | Поддержанная toolchain + scoped tooling/consumer qualification   | Общий prerequisite с каталогом, без пустых production modules |
| 1               | Native usage contract и durable source correlation               | Owning Gateway/sub2api repository + qualified SDK archive     |
| 2               | `provider-usage`: домен, ingest, Prisma, outbox, Gateway adapter | 0, 1; скрыто до source qualification                          |
| 3               | Runtime/Action usage producer + безопасная доставка              | 0, 2, owning external source/release handoff                  |
| 4               | Workspace/operator отчёты и final two-route verification         | 2, 3                                                          |

Держать PR около 2 000 changed LOC, не разрывая один инвариант. Native/runtime
изменения доставляются владельцами их исходников; заранее не обещать, что
одного изменения RR достаточно. Новые таблицы additive, схема раньше writer,
чтение совместимо со старыми producers. Отключение новых producers/read UI
останавливает adoption без удаления накопленных данных; destructive down migration
не является rollback. Релизы/деплой только по существующему runbook, после
когерентного batch и проверок. Подготовка плана не включает выкладку.

Уточнённый ориентир, без generated/lockfiles: RR 2 200-3 800 production LOC,
1 000-1 700 test LOC; Gateway/runtime/Action source 700-1 400 production и
350-650 test LOC; общий library/toolchain prerequisite 250-600 handwritten LOC.
Предыдущие 1 500-2 800 production LOC на оба транспорта были оценкой без
надёжной доставки, внешнего сбора telemetry и cross-source correlation.
Диапазон уточнить после exact native/runtime qualification, не подгонять код под LOC.

## Приёмка и минимальные проверки

- Domain: повтор события, конфликт hash/revision, out-of-order correction,
  один Gateway call из двух источников, отдельная реальная retry, unknown cost,
  inclusive/cache buckets и turn-summary overlap. Утверждения независимы от
  production-функций вычисления ожидаемых totals.
- Реальный disposable PostgreSQL: конкурентные ingest одного call, атомарный
  ACK/checkpoint/outbox, падение между commit/ACK, поздняя коррекция, tenant filters,
  миграция и возврат старого приложения с новой additive схемой.
- Contract: native facade и owning runner source fixtures на success/failure/
  aborted SSE, lost usage, cumulative summaries, dropped telemetry, forged scope,
  истёкший execution lease с report-only delivery. Не принимать любой ненулевой
  exit как доказательство ожидаемого отказа.
- E2E на существующем disposable test repository: Gateway и GitHub Secrets
  запускают реальные ограниченные запросы, каждый появляется в правильном
  workspace/model/route; повтор report не меняет totals; diagnostic request
  учитывается отдельно; один retry увеличивает attempts, delivery retry нет.
  Не запускать агентские smoke/provisioning на реальном пользовательском проекте.
- UI harness: фильтры/переход workspace, unknown/lag/coverage, owner/member/operator
  права, одинаковые known totals после reload. Никаких API keys/prompt/response
  в browser payload и safe report artifact.

Команды реализации: focused `pnpm exec vitest run` по новому feature и затронутым
source seams; scoped typecheck пакетов/API/web, `pnpm architecture:check`, новые
Foundation checks, необходимые lint/build и обязательный CI актуального PR.
Action wire change также проходит текущие `pnpm protocol:check`,
`pnpm action:artifact:check` и source-owned handoff/release проверки.
Имена новых focused test files определить при реализации, существующие project
gates не заменять фиктивными source-text checks.

Цель завершена, когда работают оба транспорта и отчёты, identity не позволяет
двойной счёт и чужой tenant, недоступные сведения честно отображаются unknown,
а заявленная полнота подтверждена на установленном runtime. Если старый runtime
даёт только summary, это совместимое partial состояние, но не основание объявить
per-call coverage готовым. Отдельный микросервис для достижения цели не нужен.

## Уточнения после `plan-improve`

В план добавлены пропущенные зависимости: source-owned Gateway usage API,
instrumentation внешнего runtime/Action и toolchain qualification библиотек.
Вместо суммирования успешных reviews определены provider attempts, cross-source
correlation, partial summaries, durable ACK/recovery, nullable данные и цена на
момент запроса. Публичный каталог и subscription limits оставлены самостоятельными
ответственностями. Готовность обоих транспортов проверяется отдельно.

## Источники

- [sub2api: usage data model, зафиксированный исходник](https://github.com/Wei-Shaw/sub2api/blob/7da09cab4e875463baa79fc150adde700c5438df/backend/internal/service/usage_log.go).
- [sub2api: авторизованные routes](https://github.com/Wei-Shaw/sub2api/blob/7da09cab4e875463baa79fc150adde700c5438df/backend/internal/server/routes/user.go)
  и [page-based usage handler](https://github.com/Wei-Shaw/sub2api/blob/7da09cab4e875463baa79fc150adde700c5438df/backend/internal/handler/usage_handler.go).
- [Get Modular public source](https://github.com/agent-teams-ai/get-modular/tree/7131d0d7a6bb5dd4c3e8906ccac065c0be0e0333):
  актуальный source API 0.7 отличается от выбранной пары 0.2; проверять exports
  именно установленного registry artifact, а не копировать пример другого поколения.
- [Foundation consumer adoption](https://github.com/agent-teams-ai/engineering-foundation/blob/145a3fb20392239fe4979c9e4f06684d6af08848/docs/development/consumer-adoption.md).

## Реализованный durable ingest: уточнение outbox

Факт, проекция и checkpoint страницы принимаются атомарной PostgreSQL-транзакцией;
ACK возвращается после commit. Событие `provider_usage.fact_accepted` не публикуется:
у него нет реального подписчика, а отчёты читают уже сохранённую проекцию.
Доставка producer spool, повторная сверка и artifact recovery используют свои
существующие durable записи и реальные обработчики. Outbox следует подключать
только вместе с конкретным потребителем, без фиктивного handler и дублирования
уже выполненной проекции.
