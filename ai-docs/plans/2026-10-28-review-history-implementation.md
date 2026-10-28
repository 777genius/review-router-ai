# Reviews: план реализации и границы scope

Дата: 2026-10-28. Статус: принят после трёх кругов review; реализация выполнена
и прошла локальную квалификацию. Фактические результаты и найденные при
реализации поправки записаны в [журнале review](2026-10-28-review-history-reviews.md).
База исследования и реализации: `418c0ff848443d7a3a0553be22eb63c45a51f53b`.
Ветка: `feat/review-history-20261028`. Все делегированные исследователи,
критики и исполнители используют **GPT-6.1 Sol, xhigh**.

Этот документ описывает один законченный product slice. План, проверки
архитектуры и результаты тестов — разные виды evidence; план сам по себе не
означает, что реализация или runtime уже квалифицированы. Фактические результаты
будут добавлены после реализации. Замечания трёх кругов сохраняются в
`2026-10-28-review-history-reviews.md` рядом с планом.

## 1. Пользовательский результат

В dashboard появляется раздел **Reviews**. Пользователь видит pull requests,
для которых ReviewRouter принял запуск review в текущем workspace. Одна строка
соответствует одному PR: название, номер, репозиторий, состояние последнего
review и время его запуска. Предыдущие review раскрываются прямо под строкой.

Главный сценарий: открыть Reviews → найти нужный PR → понять, выполняется ли
review, опубликован ли результат или требуется внимание → при необходимости
раскрыть историю либо открыть PR на GitHub. Интерфейс не требует понимать
execution, outbox, dispatch attempt, lease, revision или внутренний request ID.

Успешный расчёт без подтверждённой публикации не показывается как завершённый
review. Состояние review не выдаётся за одобрение кода, отсутствие замечаний или
состояние merge самого PR.

## 2. Входит в эту реализацию

- Отдельная backend feature `packages/features/review-history` и соответствующая
  web feature `apps/web/src/features/review-history`.
- История новых поддерживаемых GitHub v2 запусков с момента включения capture,
  включая ожидание, выполнение, публикацию и ошибки до создания execution.
- Один PR в списке независимо от количества явных повторных review; статус
  последнего логического запуска. Внутреннее восстановление dispatch продолжает
  тот же логический запуск.
- Серверный первый экран; список по 25 PR; раскрытие по 5 запусков; продолжение
  через cursor. Никакой загрузки всей истории для начального экрана.
- Поиск по сохранённым названию PR, номеру и репозиторию; фильтры репозитория,
  состояния и периода последнего запуска. Семантика поиска закрепляется в §8.
- URL для воспроизводимых фильтров; понятные loading, empty, no-results,
  unavailable, access-denied и retry состояния.
- Tenant isolation всех серверных чтений и client cache; сохранение истории в
  исходном workspace при disconnect/transfer.
- Durable compact run ledger, PR summary, транзакционный capture через
  существующий outbox и отдельная идемпотентная проекция существующим worker.
- Scoped Get Modular composition и исполняемые проверки новых границ.
- Общие рекомендации Impeccable для frontend проекта с закреплённым источником,
  без engine/hooks и без новой runtime-зависимости.
- Проверки рискованных правил, реальные PostgreSQL и браузерные сценарии,
  визуальный review desktop/mobile, draft PR, финальный review и merge после
  обязательных проверок актуального head.

## 3. Явно вне scope

- Board, вкладка Issues caught, issue counters, approval/verdict, merge status,
  графики и точные totals при произвольных фильтрах.
- Отдельная страница review/PR, полные отчёты, transcripts, код, diff, findings,
  prompts, скачивание или экспорт. Стабильные идентификаторы остаются пригодны
  для будущей страницы, но будущая страница сейчас не создаётся.
- Кнопка запуска нового review, отмена review, массовые операции, уведомления.
- Полная реконструкция удалённой исторической информации, угадывание lineage по
  SHA, перенос истории между workspace, обещание «все review за всё время».
- Покрытие GitLab direct, legacy health, certified fork и иных путей без
  подходящего квалифицированного source seam.
- Новый микросервис, брокер, Redis, Elasticsearch, общий event-sourcing framework,
  бессрочный event journal, универсальный continuous reconciler или snapshot API.
- Миграция всех существующих модулей на новый CMS, смена toolchain, auth,
  существующих runtime/Action/OIDC контрактов или publication decision logic.
- Production deploy, выпуск версии и перемещение release tags. Merge следует
  существующему release process и сам по себе не заявляет production activation.

При конфликте сроков и корректности уменьшается продуктовый scope, а не
ослабляются tenant isolation, publication truth, ordering или atomic capture.

## 4. UX и язык интерфейса

### 4.1. Экран

Использовать существующие dashboard shell, typography, цвета, spacing, theme и
компоненты `@reviewrouter/ui`. Не строить новый design system. Основная область —
короткое описание, компактные фильтры и спокойный список с разделителями, без
вложенных карточек. Контролы должны переноситься на узком экране; горизонтальный
скролл всего viewport недопустим.

Строка содержит ссылку-название PR, `#number`, репозиторий, текстовый badge статуса,
время последнего запуска и отдельную кнопку раскрытия истории. Ссылка и disclosure
не вкладываются друг в друга. Disclosure имеет `aria-expanded`, доступное имя с
номером PR и клавиатурный focus. Цвет дополняет текст, а не заменяет его.

В раскрытии — пять последних логических review, от нового к старому, с датой и
состоянием; `Show more` загружает следующую порцию. Первую загрузку обозначает
локальный skeleton. Ошибка истории не скрывает остальной список, кроме отказа
в доступе, который закрывает весь feature scope.

Фильтры: search, repository, status, date. Repository — один searchable control
на существующем Base UI primitive, с подгрузкой следующих 25 options внутри popup,
закреплённым выбранным значением и `All repositories`. Так доступны repository
26+ без второго поиска на странице и без отдельного mobile drawer. Status имеет короткие пользовательские
группы `All`, `In progress`, `Completed`, `Needs attention`; date — `Any time`,
`Last 7 days`, `Last 30 days`, `Last 90 days`. Reset видим при изменённых фильтрах.
Нет двойного поиска, board toggle и пустых будущих кнопок. При изменении фильтра
cursor и раскрытия сбрасываются; пользователю не показываются старые результаты
как будто они соответствуют новому фильтру. Основной список заменяет видимые 25
строк: `Previous / Page N / Next`, без общего числа страниц. Только раскрытая
история добавляет по пять строк через `Show older reviews`. Refresh возвращает
список на первую страницу и сбрасывает disclosure/cursors. После явного Next/
Previous перевести focus/scroll к заголовку списка после успешной загрузки;
disclosure имеет `aria-controls` и сохраняет focus при раскрытии; Show older
reviews оставляет полезный focus рядом с продолжением. Изменения страницы/ошибки
объявляются через короткий polite status region; фильтры остаются mounted.
Отложенная pagination response переводит focus только если это всё ещё активное
действие и пользователь не ушёл в другой control; filter change отменяет запрос
такого focus move. Те же правила применяются к history continuation.

### 4.2. Статусы и честность

| Факт системы                                                   | Текст для пользователя | Группа фильтра  |
| -------------------------------------------------------------- | ---------------------- | --------------- |
| Запрос принят, исполнение ещё не началось                      | Queued                 | In progress     |
| Review выполняется                                             | In progress            | In progress     |
| Вычисление завершено, ожидается подтверждённая публикация      | Publishing             | In progress     |
| Полный review с подтверждённым успешным результатом публикации | Completed              | Completed       |
| Частичный результат/незавершённое review                       | Incomplete             | Needs attention |
| Подтверждённая ошибка запуска, выполнения или публикации       | Failed                 | Needs attention |
| Отменённый или заменённый новым запуск                         | Stopped                | Needs attention |
| Итог публикации нельзя подтвердить                             | Result unconfirmed     | Needs attention |

Mapping текущего completion owner заморожен отдельно от пользовательской копии:
`completed` и `completed_superseded` → Completed (успешная публикация уже была);
`partial_completed` → Incomplete; `publication_not_applied` с причиной
`publication_superseded_no_effect` → Stopped, с `publication_failed_no_effect` →
Failed; `publication_stale_compensated` → Stopped; `publication_stale_visible` →
Incomplete; `blocked_publication_unknown` → Result unconfirmed. Nonterminal
`awaiting_publication`, `publication_in_progress`, `awaiting_snapshot` → Publishing.
Завершённое/partial вычисление без terminal completion evidence тоже Publishing.
Неизвестная допустимая комбинация не угадывается как успех: Result unconfirmed.

Домен владеет приоритетом фактов; frontend не объединяет технические enum.
`Completed` не означает `Approved`. Вспомогательный текст ошибки даёт следующий
шаг — открыть pull request или повторить загрузку — и не раскрывает stack trace,
внутренние error codes, credentials или служебные идентификаторы. Для сбоя
загрузки использовать `Try loading again`; для сохранённого Failed review —
`Open pull request`, если действие показывается. Refresh обновляет сведения,
а не запускает review повторно.

Если title отсутствует, показать `Pull request #123`, не пустое место. Metadata
считается непроверенным текстом: экранировать, не рендерить HTML/Markdown.
Ссылки формировать из проверенного GitHub origin, сохранённого fullName и PR number.
Длинные названия и имена репозиториев не должны ломать layout. Время имеет
однозначную абсолютную дату в tooltip/доступном тексте; период фильтра определяется
в UTC. Не смешивать время обновления статуса и время нового запуска.

Пустой workspace: `No reviews yet` и короткое объяснение, где появятся review.
Пустой результат фильтра: `No matching reviews` + `Clear filters`. Недоступная
история не равна нулю review. Граница покрытия показывается спокойной строкой
также у заполненного списка: `Review history available since October 28, 2026`,
без технического описания capture. Короткий help поясняет, что здесь сохраняются
поддерживаемые GitHub review; не обещать любую транспортную интеграцию. До включения capture
использовать отдельное unavailable состояние.

### 4.3. Impeccable

Источник: `pbakaus/impeccable`, версия 4.8.0,
commit `8409a564d1baee90b2dde4f7a8f06288838e3921`.
Выбран ровно документационный subset `skill/reference/operate.md`,
`skill/reference/craft-floor.md`, `skill/reference/harden.md`, `LICENSE`,
`NOTICE.md` и локальный provenance manifest. Добавить небольшой project-owned frontend workflow и design context под
`ai-docs/design`, сослаться на него из `AGENTS.md`. Сохранить точные upstream
references и license/notice для выбранных текстов, обозначив адаптацию.

Использовать рекомендации о ясной иерархии, typographic rhythm, accessibility,
понятной копии, минимуме декоративных рамок, корректных состояниях и visual polish.
Не устанавливать upstream engine, hooks, автозапуск браузера, глобальные команды,
детекторы или правила выбора моделей. Это закреплённое использование подходящих
design guidelines, а не заявление о полной установке Impeccable CLI.

## 5. Владение и архитектурные границы

| Владелец                              | Ответственность                                                         | Не его ответственность                  |
| ------------------------------------- | ----------------------------------------------------------------------- | --------------------------------------- |
| Existing request owner                | Новые запросы, retry/rerun lineage, source transition                   | Read-side SQL и UI                      |
| Existing execution owner              | Execution state и версия, progress hook                                 | Решение об успешной публикации          |
| Existing completion/publication owner | Публикация и её подтверждённый итог                                     | Дублирующий lifecycle в Reviews         |
| Review History domain/application     | Compact fact contract, status projection policy, reader/projector ports | Prisma, Next, GitHub SDK, Get Modular   |
| Review History infrastructure         | SQL ledger/capture/projector/reader, hashes, cursor                     | Session extraction и React state        |
| Composition/hosts                     | Typed wiring, borrowed DB, auth actor, worker handler                   | Бизнес-логика статусов                  |
| Web feature                           | Список, фильтры, disclosure, cache lifecycle, пользовательская копия    | Сборка доменного статуса из source enum |

Порты — узкие function properties по конкретным потребностям. Не вводить generic
repository/service manager, базовые entity classes, DI container поверх Get Modular
или отдельный graph node на mapper/endpoint/parser. DTO остаётся небольшим.

Минимальный layout: `domain`, `application/ports`, `application/use-cases`,
`adapters/outbound`, `composition`, `index.ts`, `testing`. Названия директорий
согласовать с CMS профилем; внешние feature consumers используют только public
entrypoint. В host-specific capture adapters допустима трансляция фактов owners,
но не импорт их приватных internals из domain.

## 6. Identity, порядок и схема

Ключ PR: `(workspaceId, scmRepositoryIdentityId, pullRequestNumber)`. Рename и
reconnect в том же workspace не создают второй PR. Номер PR не уникален без
repository identity. Workspace сохраняется навсегда как исходный owner истории.

Логический запуск имеет `rootRequestId`. Новый пользовательский запуск получает
новый root, даже для того же SHA. Внутренний dispatch recovery сохраняет root и
увеличивает уже существующий `dispatchAttempt`. `supersededByRequestId` само по
себе не доказывает retry: replacement pending request может быть новым review.
Не объединять по SHA, execution generation или времени.

Добавить nullable `historyRootRequestId` к `ReviewRequestedIntent` и
`ReviewExecutionV2`, а также nullable `ReviewExecutionV2.historyDispatchAttempt`.
Полученный intent разрешается до prepare execution, поэтому root и attempt
передаются сразу; поздняя alias merge система не нужна. Persisted attempt нужен
для capture после удаления исходного intent. Старые null-root
записи остаются вне полного capture coverage, пока нет доказанной корреляции.

Три новые таблицы:

1. `ReviewHistoryCoverage`: версия capture и durable время его включения.
2. `ReviewHistoryPullRequest`: opaque стабильный id, canonical PR key, небольшой
   source-owned per-PR sequence allocator, минимальная сохранённая metadata и
   projected latest run pointer/status/time для списка.
3. `ReviewHistoryRun`: immutable root, canonical PR key, исходный connection id
   как provenance, выделенный run sequence, время принятия запроса, компактная
   metadata; mutable cursors/states/hash каждого source stream и итоговый статус.

Счётчик на одном PR выделяется под транзакционной блокировкой только для нового
root. Retry наследует sequence. Это локальная сериализация одного PR, а не
глобальная блокировка всех пользователей. Ledger identity и sequence создаются
в winning source transaction. Проектор меняет только проекционные поля.

Source insert создаёт immutable ledger metadata; `projectedAt`, run status и
latest summary до первой проекции nullable. List читает только PR с projected
latest pointer, history — только projected runs. Источник не меняет visible latest.
Public run count не вводится: source sequence не выдаётся за projected count.

Run/PR не имеют cascading FK к execution, artifacts, connection или outbox:
обычная очистка operational rows не удаляет пользовательскую историю. Workspace
остаётся authoritative tenant parent; при его физическом удалении допустим cascade
в рамках существующей политики. Soft-deleted workspace недоступен немедленно,
независимо от сохранности строк.

Последний запуск определяется sequence, а не порядком доставки/завершения события.
Старая завершившаяся работа меняет свою строку, но не заменяет более новый run в
summary. Для сортировки списка использовать время принятия выбранного запуска и
стабильный id, никогда updatedAt проекции. Durable `requestedAt` означает время
принятия нового root: database clock после получения per-PR lock в winning
registration transaction. Не наследовать задержанный ingress occurredAt. Sequence
является порядком запусков внутри PR; timestamp нужен для отображения/общего списка.

History lock order: PR row → Run. Проектор сначала блокирует canonical PR, затем
обновляет Run и summary. Registration, выделяющая новый root, берёт PR lock до
любых history-run writes, включая predecessor supersession capture. Single-run
source paths без PR writes могут брать только Run после operational locks; они
не должны затем запрашивать PR lock. Это исключает цикл allocator/projection без
дополнительного глобального lock manager.

## 7. Capture, projection и metadata

### 7.1. Source transaction

Capture выполняется в той же транзакции, что и подтверждённый source transition.
Новый root/sequence, компактный self-contained event и source state либо
сохраняются вместе, либо откатываются вместе. Здесь нет сетевого запроса, поискового
индекса UI, вычисления read summary или generic reconciliation.

Event v1 содержит immutable run identity/sequence/workspace/PR, source kind/id,
source version, dispatch attempt, occurredAt, компактное состояние и сохранённую
display metadata. Bigint передаётся канонической десятичной строкой. Idempotency
key включает source kind, source id и version; payload collision проверяется.
Один run не имеет единственного общего `lastVersion`: версии разных owners и
request successors несравнимы. Retry successor version 1 после predecessor
version 7 является допустимым следующим фактом.

Использовать существующие central intent update/create seams и execution
progressCapture seam, компонуя history capture с текущим progress capture.
Выключение progress не должно выключать Reviews capture. Completion capture
должен видеть meaningful create/wake/transition, а не только существующий
success-only Statistics settlement hook. Текущую Statistics семантику сохранить.
Подключить оба API intent store: обычную v2 composition и отдельный store hosted
prelease gate, через который создаётся GitHub Actions manual rerun и фиксируется
admission rejection. Оба используют один writer из общего production root.
Meaningful fields: state, approved safe reason, admission decision,
execution/finalized binding, publication attempt, snapshot receipt и recovery
attempt. Claim, heartbeat, retry scheduling, retention и lastWakeup сами по себе
не создают события. Initial completion create захватить атомарно, обычный wake
без semantic change не требует новой транзакционной framework-обвязки.

### 7.2. Projection

Existing outbox worker доставляет факт новому handler. В одной транзакции:
проверить immutable identity, применить только новый source cursor, пересчитать
статус run и условно обновить PR summary. Duplicate delivery не создаёт строки,
не увеличивает count и не откатывает статус. Equal-version conflicting payload
сигнализирует collision; более старое событие не регрессирует новую версию.

Больший dispatchAttempt выбирает новую попытку и обесценивает display facts
предыдущей попытки; меньшее значение не меняет selected attempt. При одинаковом
attempt intent sourceId обязан совпадать, другой id — collision, не lexical sort.
Версии сравниваются только внутри kind + sourceId + attempt. Execution и completion
имеют независимые cursors. Multiple execution IDs одного attempt допускаются
prepare owner при разных startIdentityHash; highest generation не является
окончательной history authority. На существующем Run ledger хранить source-owned
`boundExecutionId` и `boundDispatchAttempt`. Успешный intent admission link в той
же транзакции фиксирует единственного winner и self-contained snapshot execution
в binding fact. Взять execution row lock до history-run lock/записи binding, чтобы
snapshot не пропустил конкурентный execution transition. Binding event включает
также существующий completion snapshot, если он уже есть. Для предотвращения
пропущенного completion create и обратного lock order optional infrastructure hook
completion owner берёт тот же execution row gate **до** create/apply mutation.
Реальная PostgreSQL-проверка уточнила механизм: intent binding работает в
Serializable transaction, поэтому одного `SELECT FOR UPDATE` недостаточно для
обновления уже открытого snapshot. Completion gate делает no-op MVCC UPDATE
существующего `historyRootRequestId`, только если durable history run существует.
Логические execution version/state/timestamps не меняются. Устаревший binding
получает serialization conflict; только `linkAdmission` повторяет свою локальную
транзакцию до трёх раз. Незавершённые source/history/outbox записи откатываются
вместе. Не менять глобальный isolation level, таймауты или publication logic.
Общий порядок: execution → completion (если нужен) → history Run. Binding не
захватывает completion row после Run; удерживая execution gate, читает согласованный
snapshot. Это узкий source transaction hook, не новая система блокировок и не
переписывание completion decision logic. Пока binding нет, отображается intent Queued;
подготовленные кандидаты и их компенсации не определяют visible execution status.
После binding принимать только выбранный execution/attempt; чужой candidate
игнорируется как неподтверждённый, не collision. Recovery разрешён owner только до
binding и никогда не очищает уже выбранного winner ради продолжения recovery;
явный rerun имеет другой root. Последующие captures используют durable
history binding и persisted execution lineage, а не prunable intent. Если binding
snapshot приходит после более новой версии execution, он не откатывает cursor.
Cursor hash embedded seed вычисляется из нормализованного source snapshot
`kind + sourceId + attempt + sourceVersion + safe facts`, без outer intent-binding
envelope/capture time. Seed и direct source event проходят один reducer; одинаковый
source version/facts является duplicate, даже если envelope отличается.
В рамках selected attempt accepted completion facts имеют приоритет над execution,
execution — над intent phase. Не выбирать «успех» при неизвестной публикации.

Проектор использует event payload и durable history ledger, без загрузки уже
удалённых execution/artifacts. Нет бессрочного отдельного event journal: replay
поддерживается из retained outbox. После очистки outbox остаётся компактная
история; восстановление всех промежуточных событий после их удаления не обещается.
Повторная обработка/восстановление использует существующие retries/dead letters и
явную ограниченную operator procedure.

### 7.3. Display metadata

Existing GitHub eligibility gateway уже получает PR через GitHub API. Передать
его bounded nullable title и существующий repositoryFullName к capture; не
выполнять дополнительный HTTP запрос на каждую строку списка. Title не входит в
canonical request identity/hash и не влияет на дедупликацию запуска.

Если путь не располагает title, использовать известную metadata того же canonical
PR либо nullable fallback. Не обогащать старую историю через current binding
другого workspace. PR title считается снимком на момент review; отдельный поток
обновлений для title-only webhook/merge state сейчас вне scope.

## 8. Read API, SQL и масштабирование

Публичные read operations:

- `listPullRequests({actorId, workspaceId, filters, cursor?})` → items ≤25,
  nextCursor, coverage state.
- `listRuns({actorId, workspaceId, pullRequestId, cursor?})` → items ≤5, nextCursor.
- `listRepositories({actorId, workspaceId, q?, cursor?, selectedRepositoryId?})` →
  options ≤25, nextCursor и отдельный `selected: RepositoryOption | null`.

PR row DTO: opaque id, `scmRepositoryIdentityId`, repository display name,
PR number/title/URL, latest status, latest requestedAt. Run row: opaque id,
requestedAt, status. Repository option: `scmRepositoryIdentityId` как value и
same-workspace captured `fullName` как label; order `(lower(fullName), id)` с тем же
tuple в cursor. Сначала выбрать единственный label каждого canonical repository
по latest projected review, с tie-break по стабильному PR id; лишь затем option
search и pagination. `selected` определяется независимо от option search/page
по тому же историческому scoped источнику. Не обращаться к current connection
binding. Дополнительная projection table для options не нужна. Не отдавать
служебные source IDs, access metadata, raw error objects или ненужные поля.

Filters: `q` (bounded string), `repositoryId` (canonical SCM id или null),
`status` (`all | active | completed | attention`), `days` (`null | 7 | 30 | 90`).
Coverage — union `{state: 'unavailable'}` либо
`{state: 'available', availableSince: ISODate, supportedSource: 'github_v2'}`;
available-empty отличается от unavailable, complete all-source history не обещается.
Server-only normalized filter также содержит `from`, `until`. Период — UTC calendar
days включая сегодня: начало дня N−1 суток назад включительно, начало завтрашнего
UTC дня исключительно. Boundaries вычисляются один раз для первой страницы;
Ответ первой страницы возвращает opaque `windowToken` с preset/bounds/scope,
пригодный и без continuation position. Все страницы цепочки, возврат на первую
и background refetch используют этот token; он входит в query key. Cursor
continuation связан с тем же window, bounds не пересчитываются в полночь.
Explicit Refresh/новый filter удаляет window и начинает новые bounds. Это
переиспользование cursor codec с null position, не отдельный snapshot subsystem.
Эти timestamps не делают projection
замороженным snapshot.

Reader сначала проверяет текущий доступ, затем разбирает scoped cursor/IDs и
читает данные. Каждый запрос фильтруется по workspace в SQL. История принимает
opaque PR id вместе с workspace и не находит чужую строку по одному id.
Authorize и read выполняются в одной RepeatableRead transaction: доступ оценивается
на snapshot этого запроса. Это не обещание отзыва уже отправленного ответа задним числом.

Latest выбирается в PR projection до status/date/search filtering. Все display/
search поля PR, включая title, repository name и generated search vector, принадлежат
projector и меняются вместе с selected latest run. Старый run/event не переписывает
metadata/search текущего PR. Source-owned allocator/provenance отделены. Запрос не
выполняет window/DISTINCT ON всей таблицы запусков, чтобы вычислить последний.
Основные индексы: workspace + latest requestedAt/id; repository variant;
status variant; history workspace + PR + run sequence. Page queries используют
limit+1, не OFFSET и не COUNT(\*) всех совпадений.

Поиск: положительный integer либо `#integer` → точный PR number с индексом
`(workspaceId, pullRequestNumber, latestRequestedAt, id)`. Иначе строка до 200
символов, до восьми Unicode letter/digit tokens; punctuation — разделитель,
токены lowercase, между ними AND, каждый token prefix. Dictionary PostgreSQL
`simple`; generated/stored tsvector из title + repositoryFullName с GIN точно
совпадает с выражением reader. Пустые tokens дают пустой search; превышение лимитов
возвращает safe validation error. Формировать tsquery параметризованно из этих tokens.
Не обещать произвольный infix substring search, не добавлять внешнюю search service
или обязательный pg_trgm extension. Проверить фактический reader SQL и query plan
на representative объёме, включая много данных другого workspace: first page,
continuation, selective/common/missing tokens, exact number и repository options.

Cursor связывает endpoint, actor, workspace, все нормализованные filters и PR id
для run history. Это не authorization token; подписывающая инфраструктура не
нужна, потому что каждый запрос проходит новый access gate и scoped SQL. Строго
ограничить размер и формат cursor и входных параметров.

Пагинация live: новый запуск может переместить PR выше текущей страницы. Refresh
начинает с первой страницы; client дедуплицирует id только при append истории. Не выдавать
`asOf` mutable projection за настоящий snapshot. Global exact totals не нужны.

API/worker stateless; coordination и progress находятся в PostgreSQL и existing
outbox leases. Новые replica могут выполнять ту же работу с idempotency/fencing.
Не добавлять in-memory global map, локальный status authority или обязательную
sticky session. Вертикальный предел БД всё равно существует; performance claims
ограничиваются реально проверенным объёмом и профилем запросов.

## 9. Tenant isolation и client cache

Access policy соответствует строгому Statistics read gate: workspace active и
personal owner либо фактический member shared workspace. Authenticated actor
берётся из server session. Repo manager mutation authority, URL, opaque id и
видимость workspace в navigation не заменяют этот gate.

Применить одинаковую политику к SSR, list, history, repository options, каждой
cursor continuation. `delete_pending`, `deleted`, не-owner personal workspace,
отозванное membership и другой tenant всегда запрещены. Не различать существование
чужого PR через ошибки до авторизации.

Disconnect не стирает историю и не переносит её новому owner. Новые review после
transfer принадлежат новому workspace. Чтение старой истории требует доступа к
старому workspace; новые private metadata туда не поступают.

Первый экран загружает server loader с теми же нормализованными URL filters.
`initialData` применимо лишь к matching first-page query key, никогда к другому
filter/cursor. Search input остаётся mounted; debounce 300 ms, superseded fetch
abort, Back/Forward согласованно восстанавливает controls и results. Использовать
30-second staleTime, чтобы не дублировать hydration request.
Invalid URL/filter/search не убирает controls: сохраняется введённый текст,
показывается safe validation copy (`Try a shorter search`) и Clear filters.
Невалидный filter не отображается как no-results или infrastructure failure.
Interactive reads используют typed React
Query keys и adapter functions: feature + actor/workspace + authorized seed id +
filter/PR/cursor. Один источник server data; не копировать query results в local
state. Browser fetch имеет signal и `cache: no-store`; private endpoints не кэшируются
shared CDN. Содержимое одного workspace никогда не служит placeholder другого.

При actor/workspace switch отменить запросы и удалить departed scope cache;
сбросить раскрытия. Любой 401/403 от list/history/options закрывает весь текущий
Reviews scope, убирает seed и cached rows и запрещает позднему ответу/старому seed
восстановить их. Новый разрешённый SSR seed после refresh может восстановить экран.
В QueryClient сохраняются только boolean-маркеры отказа для seed и actor/workspace.
Отказанный seed не оживает при unmount/remount. После замеченного отказа другой
закэшированный SSR seed тоже не считается разрешением: list и repository seed
ожидают новый успешный API read с обычной проверкой доступа. Это не новый cache
service, не хранение приватных данных и не протокол временных меток.
Polling в этой версии не вводится: явный Refresh и стандартный refetch-on-focus
без отдельного poll manager. Cached successful results допустимы при transient
refresh failure только для точно того же scope/filter/page с явным уведомлением.

## 10. Get Modular и проверяемые границы

Новый scope принимает CMS и module authoring guide из Get Modular commit
`7a7c4c54add9ccc06509423d7b89bcfc037227b1`, не изменяя adoption других features.
Сохранить scoped ADR/profile с точными digest/blob, production root и путями.
Текущие runtime pins core/assembly `0.7.0` сохраняются; conformance `0.5.0` и
его resources peer `0.2.1` используются только в dev qualification.

Composition содержит contracts, static declaration/module, group и root. Один
осмысленный history module предоставляет нужные Reader/Projector/Capture
capabilities. Host передаёт borrowed Prisma/ports; lifecycle kernel и собственное
resource ownership для существующей БД не вводятся. Complete contract descriptor
unions сохраняются; разные imported bases не скрывают конфликты ID/revision.

Проверки: реальный root smoke, независимый wiring oracle, namespace/layout,
rejecting fixture неверного направления импорта и type-only утечки. Они должны
исполняться CI-командой нового scope. Plain installed package или запись в profile
не считается conformance. Existing architecture boundary gate продолжает работать.

Scope enforcement: `architecture/review-history/consumer-module-profile.json`,
owning ADR и `scripts/review-history-tooling/check.ts` перечисляют ровно
`packages/features/review-history/src` и фиксированные host/web adapters.
Существующий Foundation проверяет imports; маленький collector проверяет реальные
source/layout records только этого feature. Blocking command
`pnpm history:architecture` включён в `architecture:check`; genuine composition
tests и strict types — в `modular:qualify`. Rejecting fixtures должны отвергать
missing root/path, unknown unowned production module, изменённый CMS pin/digest,
удалённую или no-op blocking command chain и value/type import в неверном направлении.
Web/API/worker capture adapters записываются как отношения этого scope; новая
workspace-wide архитектурная framework не создаётся.

## 11. Rollout, coverage и восстановление

Порядок: additive migration → совместимый новый handler/worker → обновление всех
source writers → явное включение capture и UI. Миграция обязательна до запуска
нового binary: добавленные nullable operational Prisma columns означают, что
выключенный flag не обеспечивает совместимость нового Prisma с прежней схемой.
Это записать в runbook, не обещать old-schema safety, которую код не обеспечивает.

Когда capture binary flag disabled, hosts не устанавливают callbacks и обычный
review не обращается к history tables. Когда hooks enabled, но coverage row
отсутствует, callbacks no-op. После готовности всех API/worker writers выполнить
единственную idempotent activation insert `capture_v1` с database clock. Первый
готовый процесс сам ничего не активирует. Новая registration transaction, увидевшая
activation, сохраняет root/ledger/initial event вместе. Последующие callbacks
захватывают только root с уже существующим durable history run; old roots не
становятся задним числом частично покрытыми, даже если lineage columns заполнены.

Неудача активного capture откатывает исходный transition; мониторить существующие
ошибки/lag/dead letters. Handler зарегистрирован независимо от capture/UI flag и
publisher credentials, чтобы уже принятые события продолжали обрабатываться после
выключения producers/UI. Explicit activation command документируется в runbook и
выполняется в этой работе лишь на disposable test database.

Coverage timestamp относится к согласованному включению writers, не к началу
жизни продукта. Old/null-root и неподдерживаемые transport paths не выдаются за
покрытые. Launch не импортирует preactivation roots и не выполняет backfill;
это намеренно ограничивает coverage и убирает speculative historical lineage.
Bounded replay восстанавливает события retained outbox, без постоянно работающего
универсального repair loop. Никаких production credentials или активации production
flags в рамках локальной квалификации.

## 12. Проверки по рискам

Юнит-тесты пишутся для новой критичной политики, а не для каждого файла. Не
тестировать forwarding wrappers, basic markup, formatter или копию реализации
ради coverage percentage. Existing mandatory gates не отменяются.

| Риск                                         | Минимальная проверка                                                                                                                   |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Retry и новый review объединены неправильно  | Parameterized policy: recovery сохраняет root, явный rerun того же SHA получает новый root                                             |
| Version reset/late event ложно меняет latest | Pure policy + PostgreSQL: successor v1 после predecessor v7, reverse/concurrent delivery, старое завершение после нового запуска       |
| Ложный Completed                             | Policy: completed computation ждёт publication, partial/unknown не превращаются в success                                              |
| Потеря capture/duplicate                     | Настоящие intent/execution/completion transactions с rollback при hook failure; повторная доставка; collision                          |
| Source cleanup ломает сохранённую историю    | Сохранённый self-contained event проходит projector после удаления source rows; intent удалён до позднего execution/completion capture |
| Чужой tenant/soft deletion/revocation        | PostgreSQL на всех reader endpoints: owner/member/outsider/personal nonowner/delete_pending/deleted и revoked member                   |
| Transfer/reconnect                           | История сохраняет исходный workspace; canonical PR grouping в том же workspace; нет private metadata нового owner                      |
| Pagination/filter ошибки                     | >25 PR и repositories, равные времена, другой tenant, scope-mismatched cursor, latest-before-filter и UTC-midnight continuation        |
| Client race                                  | Два focused tests: child403 отзывает весь scope; поздний ответ после switch не возвращает departed data                                |
| SQL scalability                              | Representative actual-reader query + EXPLAIN ANALYZE BUFFERS, без хрупкого требования к конкретному plan node/миллисекундам            |
| Нарушение feature boundaries                 | Новый composition smoke/independent oracle/negative fixture и existing architecture check                                              |
| Непонятный UI                                | Настоящий браузер desktop/mobile + keyboard, screenshots, empty/error/access states                                                    |

Реиспользовать `scripts/statistics-e2e` auth/session/Next/PostgreSQL/Chromium
harness через ограниченное расширение/общий helper. Не копировать runner на 1400
строк и не создавать новый synthetic auth bypass. Browser fixtures можно сеять
непосредственно в compact history ledger: source transaction и projector отдельно
квалифицируются настоящими PostgreSQL тестами. Хотя бы один backend integration
должен пройти source → outbox → projector → reader; browser проверяет реальный
SSR/API/SQL путь. Не называть прямой fixture seed проверкой реального GitHub review.

Согласованные реальные concurrency cases: два valid prepared execution candidates
одного attempt с единственным выигравшим admission link; late higher-generation
loser не заменяет winner; binding seed гоняется с execution/completion mutation;
registration/supersession гоняется с projection одного PR. Использовать bounded
transaction barriers в DB fixture, не новый production scheduler. Embedded seed
и direct event одной source version дают duplicate по одному canonical hash.

Основной browser journey: SSR list → search/filter → page2 → expand/show more →
refresh → workspace switch. Проверить error retry, denial/recovery, long text,
keyboard focus, light/dark и минимум 390/900/1440 px. Реальные screenshots
просматриваются; устранение visual defects включено в работу.

На ограниченной машине сериализовать тяжёлые typecheck/build и browser, запускать
один Chromium context и reuse dev-server harness. Не удалять чужие проекты,
node_modules, logs или worktrees ради места. Evidence хранить в ignored `tmp/`.

### Исполняемые gate contracts

Новый DB suite: `packages/features/review-history/src/tests/history.postgres.test.ts`.
Он получает `HISTORY_TEST_POSTGRES_ADMIN_URL`, создаёт собственную disposable DB,
применяет миграции и удаляет её после проверки. Explicit qualification
`HISTORY_REQUIRE_POSTGRES=1 pnpm history:test:postgres` обязан падать без DB URL,
а не давать successful skip. Existing CI PostgreSQL Unit tests step получает обе
переменные, чтобы `pnpm test` действительно исполнял этот suite.

| Команда                                                                                    | Где/зачем                                                                                           |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| `pnpm history:architecture`                                                                | Локально и existing architecture CI gate: новый scoped CMS/FMS/profile/negative fixtures            |
| `pnpm history:test:postgres` с required flag                                               | Локально явно; suite обязателен в существующем CI PostgreSQL test step                              |
| `pnpm exec vitest run <affected paths>`                                                    | Bounded domain, source-hook, server и client-risk regressions локально; затем existing full CI test |
| `pnpm modular:qualify` и `pnpm architecture:check`                                         | Genuine new root и существующие project boundaries                                                  |
| `pnpm --filter @reviewrouter/features-review-history typecheck` и web/api/worker typecheck | Изменённые контракты и hosts                                                                        |
| `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`                            | Existing mandatory CI; locally full batch когда среда позволяет                                     |
| `pnpm build`, `pnpm runtime:smoke`                                                         | Production package exports и API/worker startup; mandatory final qualification                      |
| `node --import tsx scripts/statistics-e2e/browser-qualify.ts` с history scenario           | Настоящий локальный browser journey на disposable PostgreSQL17; README фиксирует env                |
| `git diff --check`                                                                         | Каждый законченный checkpoint                                                                       |

Новые commands создаются вместе с implementation, не считаются уже существующими.
Browser и actual-reader volume qualification запускаются явно до merge; обычный
unit invocation не обязан делать большой volume/browser прогон на каждый commit.

## 13. Последовательность выполнения

1. Завершить план и провести три отдельных круга нескольких критиков. После
   каждого круга внести правки; журнал фиксирует замечание, решение и границу scope.
2. Закоммитить план и project design guidance, сразу push, открыть draft PR.
3. Зафиксировать shared types/SQL schema/public contracts; реализовать ledger,
   source hooks, async projection и risk-based backend tests.
4. Параллельно после стабилизации контракта реализовать reader/composition и
   web feature с SSR, authorization, URL filters, query cache lifecycle.
5. Подключить dashboard/worker/host adapters, migration/lockfile/scoped gates;
   исполнить focused checks. Коммиты группируются в законченные части и каждый
   сразу отправляется в branch; незавершённая работа не выдаётся за qualification.
6. Выполнить реальные DB и browser E2E, проверить screenshots, исправить UX.
7. Независимый финальный review критичных paths и actual diff; исправить все
   подтверждённые замечания в scope, повторить затронутые проверки.
8. Проверить актуальность main и required CI на точном head, перевести PR из draft
   в ready и merge без обхода branch protection. Если внешняя обязательная проверка
   реально недоступна — сохранить PR и назвать blocker, а не объявлять merge.

Source author, reader/composition author и web author работают в отдельных
наборах файлов; schema и public DTO имеют одного владельца, shared host wiring
согласуется до изменения. Не менять параллельно один package/lockfile без координации.

## 14. CI и Git discipline

User authorization включает commit, push, draft PR, end-to-end проверки,
исправление review и merge. Не запускать release/deploy workflows вручную.
CI уже имеет PR concurrency cancel-in-progress; после каждого нового push
проверить runs и отменить только незавершённые runs собственных предыдущих SHA
на этой ветке. Не отменять current head, main или чужую работу и не отключать
обязательные проверки.

Не вызывать manual CI dispatch на каждом коммите. Проверять coherent batch
локально и дать final head пройти required gates. Запланировать минимум
документационный checkpoint, реализацию и review fixes; фактическое число
коммитов определяется завершёнными изменениями, не quota.

Использовать pinned pnpm `11.28.7`, repository Node range и существующие scripts.
До merge нужны relevant format/lint/typecheck/test/architecture/scoped composition,
migration, build/runtime smoke и required remote gates. Полный перечень owning
правил: `ai-docs/operations/03-quality-gates.md` и
`ai-docs/operations/07-environments-and-release-management.md`.

## 15. Оценка объёма

Ориентир до реализации: production **4 100–6 600** строк; все новые tests/fixtures/
harness extensions **1 600–2 600**; всего **5 700–9 200** строк. Это диапазон,
не целевой объём и не причина создавать лишний код. Документация, upstream design
references, generated output, lockfile и vendor исключены. После реализации
отдельно сообщить фактический diff и объяснить значимые отклонения.

## 16. Критерий готовности

- Пользователь без знания внутренней архитектуры находит PR, понимает latest
  review status и раскрывает предыдущие запуски.
- Доказаны основные lineage/order/publication/tenant/cache invariants; persisted
  event не зависит от сохранности operational source rows.
- Реальная first paint/read path, migrations, bounded SQL и frontend проходят
  выбранные проверки; ограничения coverage и E2E сформулированы честно.
- План и журнал трёх кругов review закоммичены; финальные замечания обработаны;
  актуальный PR прошёл required checks и смёрджен либо точно указан внешний blocker.
- Не изменены вне scope существующие runtime/auth/release contracts и не добавлены
  инфраструктурные подсистемы без доказанной необходимости.

## 17. Источники решений

- Repository `AGENTS.md`; quality gates и release process, перечисленные выше.
- Current request/execution/completion stores и `StartReviewExecution`.
- `packages/features/review-statistics`: строгий read access, outbox/projector и
  примеры DB tests; это reference pattern, не готовая полная history implementation.
- `scripts/statistics-e2e/README.md`: реальные границы browser qualification.
- [Engineering Quality Standard](https://github.com/agent-teams-ai/.github/blob/c8f3e7ba220241f79292c84c72712653019aa1df/docs/engineering-quality-standard.md).
- [Get Modular CMS](https://github.com/agent-teams-ai/get-modular/blob/7a7c4c54add9ccc06509423d7b89bcfc037227b1/docs/architecture/common-assembly.md).
- [Get Modular authoring guide](https://github.com/agent-teams-ai/get-modular/blob/7a7c4c54add9ccc06509423d7b89bcfc037227b1/docs/guides/module-authoring.md).
- [Impeccable](https://github.com/pbakaus/impeccable/tree/8409a564d1baee90b2dde4f7a8f06288838e3921).
