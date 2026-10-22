# Нативные лимиты аккаунтов: реализация в Accounts

Статус: L1/L2 реализованы для qualified Codex cached-read; production не активирован.
База планирования RR: `origin/main` `7656c0ef3fcfc415d486dd767e525df49444b0bc`, 2026-10-22.
Применён `q`: ответственность `provider-accounts`, отдельная capability чтения,
существующие composition/UI seams. Документ не разрешает деплой или вход в аккаунты.

Исходный Codex checkpoint 2026-10-22: native [PR 61](https://github.com/agent-teams-ai/sub2api/pull/61)
и Gateway [PR 67](https://github.com/agent-teams-ai/account-gateway/pull/67) merged.
[SDK provenance](../../vendor/account-gateway/account-limits-provenance.json)
закрепляет source commits, migration 252, archive SHA/SRI и controlled joined
native → Gateway → SDK → RR acceptance. Cached reads не делают provider/inference
вызовов. Gateway CI этого checkpoint прошёл; native GitHub Actions тогда возвращал 422
disabled, поэтому его exact-source hosted gates записаны отдельно, без заявления
о GitHub CI. Актуальные сведения о Claude и его проверках — в документе 61
и текущем SDK provenance.

L3 не включён: `quotaOnlyRefresh=false`. Расширение для Claude описано в
[Claude account limits](61-claude-account-limits.md): оно использует отдельный
qualified OAuth lifecycle и пассивный источник. Остальные профили без qualified
principal lifecycle остаются unsupported. Legacy native extra без provenance
остаётся unknown; RR connection без подтверждённого authorization epoch остаётся
unavailable. Эти состояния не заменяются предположениями из credentials или stats.

## Результат и scope

В Accounts владелец видит полученные от native Gateway окна подписочного лимита:
сколько процентов использовано, сколько осталось, когда ожидается сброс и когда
источник наблюдал эти сведения. Первый поддержанный профиль - Codex OAuth.
Остальные профили честно сообщают `unsupported`, пока нет их квалифицированного
источника. MiMo/OpenRouter API key не получают «подписочный остаток» из токенов.

Это самостоятельная фаза после [плана 57](57-provider-usage-implementation-plan.md),
а не незаметно добавленная часть его исходной приёмки. Ledger измеряет обращения
ReviewRouter; native quota описывает общий upstream account/subscription, включая
другие workspace и внешние обращения. [Каталог моделей](58-public-provider-model-catalog-plan.md)
не сообщает quota или entitlement выбранного аккаунта. Статус live-проверок обоих
транспортов плана 57 учитывать отдельно; этот план не закрывает pending verification.

В scope: безопасное cached чтение, нормализация, авторизация владельца, Accounts UI,
отдельное явное quota-only обновление при наличии квалифицированной capability.
Не входят: биллинг, inference admission/failover, прогноз числа оставшихся запросов,
native quota history, reset/purchase credits, новый OAuth flow, изменение Action/
runner, публичного каталога или rollout device sign-in. На момент подготовки
production SaaS/API 197 / RR schema 139 и отдельные Gateway/native pins остаются
своими операционными состояниями; новый код main/schema 140 не означает их активацию.

## Что проверено в настоящем sub2api frontend

22 октября 2026 через `gh` и локальный source checkout прочитаны две ветки main:

| Repository               | Точный commit                              |
| ------------------------ | ------------------------------------------ |
| `agent-teams-ai/sub2api` | `0af8920708992ea707971b347cb23ca361501954` |
| `Wei-Shaw/sub2api`       | `dba770d56a0ee0ae5bad1b3dc5e11614d323163c` |

Сравнены файлы, а не только README. В обоих снимках Codex-ветка
`frontend/src/components/account/AccountUsageCell.vue` передаёт `five_hour` и
`seven_day` в `UsageProgressBar.vue`; там показаны utilization, progress и countdown.
Frontend использует ответ account `/usage`, а не напрямую raw `extra`. Рядом
показываются локальные `window_stats.requests/tokens/cost/user_cost`. Оценка полной
стоимости окна вычисляется как `window_stats.cost * 100 / utilization`; это
экстраполяция локального учёта, не долларовый лимит подписки. В RR такую оценку
и локальный request count не переносить в quota. Полезный образец UI - компактные
параллельные строки окон с процентом, reset и отдельным действием обновления.

`frontend/src/types/index.ts`, `CodexUsageSnapshot`, подтверждает поля
`codex_5h_used_percent`, `codex_7d_used_percent`, соответствующие
`*_reset_after_seconds`, `*_reset_at`, `*_window_minutes` и
`codex_usage_updated_at`. `*_used_percent` означает использованную долю.
`*_reset_at` в этом snapshot - строка RFC3339, не epoch milliseconds.
Legacy `codex_primary_*`/`codex_secondary_*` неоднозначны: тип окна определяет
duration. Backend `OpenAICodexUsageSnapshot.Normalize()` сравнивает durations,
при единственном duration использует порог 360 минут, а без обоих делает legacy
предположение primary=7d, secondary=5h. RR не должен превращать это предположение
в подтверждённую длительность. В quota body `rate_limit.*_window.reset_at` и
`fetched_at` - другие поля, числовые Unix seconds; `limit_window_seconds` также
в секундах. Нормализация raw полей принадлежит только source-owned native adapter;
SDK передаёт canonical DTO, RR не повторяет её по raw `extra`.

Есть существенные ограничения существующего образца:

- `AccountUsageCell.vue` кеширует ответ на 5 минут. Обычное чтение
  `/admin/accounts/:id/usage` по умолчанию active; `getOpenAIUsage()` при missing/
  stale/rate-limited snapshot может вызвать `probeOpenAICodexSnapshot()`, который
  делает POST inference. Кнопка active query использует `source=active&force=true`.
  `source=passive` там предназначен для Anthropic, не универсальный Codex cached read.
- Тот же `getOpenAIUsage()` создаёт utilization=0 при наличии одних локальных stats,
  а `buildCodexUsageProgressFromExtra()` обнуляет utilization после reset. Его
  `updated_at` создаётся при чтении и не доказывает время quota observation.
  Этот агрегированный ответ не годится как авторитетный источник RR quota.
- `OpenAIQuotaResetCell.vue` объединяет query, credits и reset. Даже handlers
  `QueryQuota`/`RefreshQuota` вызывают `NotifyOpenAIAutoResetCredit`, а `QueryUsage`
  может восстанавливать Agent Identity task. Не переиспользовать эти handlers как
  «безопасное обновление лимита» и не переносить reset controls в RR.

Для quota-семантики файлы `UsageProgressBar.vue`, `types/index.ts`,
`api/admin/accounts.ts`, `utils/accountUsageRefresh.ts`, backend
`account_usage_service.go`, `openai_gateway_service.go`, `openai_gateway_usage.go`
и `openai_quota_service.go` одинаковы в двух checked commits. Общий frontend
`AccountUsageCell.vue` отличается в иных, не Codex ветках. Это source evidence,
не доказательство доступности этих APIs в установленном RR native runtime.

## Граница по `q` и существующие места подключения

В `packages/features/provider-accounts` добавить небольшой normalized view и
use case чтения лимитов. Его consumer-owned `AccountLimitsReader` обслуживает
Accounts, не `UsageStore`, ledger ingestion и не общий provider transport.
Отдельная capability `AccountLimitsRefresher` требуется только явному действию
обновления. Runner и providers без quota не реализуют фиктивный `getLimits()`.

`infrastructure/gateway` валидирует canonical SDK DTO и отображает его в RR-owned типы;
domain/application не импортируют HTTP SDK, Prisma, Next или upstream `extra`.
Host composition собирает adapter и use case. Расширить существующий
`provider-accounts/src/composition.ts` и серверную сборку
`apps/web/src/server/personal-account-composition.ts`; для нового typed capability
использовать принятую Get Modular 0.2 сборку по образцу `provider-usage/composition`,
без изменения существующих Accounts use cases. Не создавать
второй module runtime, интерфейс для каждого formatter или отдельный сервис.
В существующий scoped Foundation профиль добавить затронутую границу, без
repository-wide adoption, обновления библиотек или новой проверки архитектуры.

Серверные точки первого экрана: `accounts-overview.ts`,
`personal-canonical-accounts.ts`, `account-gateway-accounts.ts` и RSC
`account-gateway-accounts-section.tsx`. Дополнить безопасную `AccountView`
проекцией limits. `account-usage.ts`/`AccountUsageLine` сейчас означают, где аккаунт
выбран для reviews/CI secrets; сохранить этот смысл. Credentials CI secrets
не доказывают identity конкретного account row и не дают источник quota.

## Контракт native facade: обязательная внешняя зависимость

На базе RR выше `apps/web/package.json` закрепляет private device-sign-in SDK
из `vendor/account-gateway`; его `/contracts` и `/http` declarations не имеют
limits API. Наличие admin endpoint в sub2api не добавляет capability в фасад.
До RR adapter source owners `agent-teams-ai/sub2api` и `agent-teams-ai/account-gateway`
должны доставить следующий versioned контракт через их штатные source/SDK pins:

1. `account-limits/v1` cached read для точно авторизованного owner/account/profile.
   Вход - server-derived ownerRef, accountRef, profileId и expectedAuthorizationEpoch;
   source owner сам разрешает текущую physical generation. Произвольный numeric
   native account ID или generation из browser не принимается.
   Отдельный capability handshake различает cached-read и quota-only-refresh.
2. Чтение не обращается к провайдеру, не вызывает inference, reconnect, token/task
   repair, auto-reset notification, reset-credit redemption и не меняет account state.
   Источник - сохранённый raw quota snapshot с настоящим observation timestamp,
   без `window_stats` и reader-generated zero/reset inference. Missing raw snapshot
   возвращается как unknown, а не как нулевой использованный лимит.
3. Per-account результат - `snapshot | unknown | unsupported | unavailable`.
   Snapshot содержит monotonic safe-integer revision для этой physical generation,
   непрозрачный server-only principalVersion, observation provenance,
   `account | subscription` scope и до 8 окон. Каждое окно
   содержит стабильный source window ID/limit family, reported duration в секундах
   или null, nullable finite nonnegative usedPercent, UTC observedAt/resetAt или
   null и normalization basis `duration | legacy_alias | unknown`. Никаких PII,
   native IDs, raw JSON, credentials, reset-credit IDs/counts или денежных оценок.
4. Не смешивать обычный Codex, Spark/metered-feature buckets и primary/secondary
   aliases. Для первого среза отдавать только доказанную обычную Codex family;
   неизвестную dimension не выдавать за общий лимит аккаунта. Сохранять provenance
   duration-based и legacy mapping; conflicting canonical/alias values - unknown
   affected window с безопасной причиной, не выбор по удобству UI.
   Единственный владелец нормализации - source-owned native adapter: он переводит
   raw aliases/durations, RFC3339 offsets, Unix seconds и relative reset в canonical
   windows/UTC instants. SDK несёт этот контракт. RR проверяет canonical DTO и
   рассчитывает display/freshness, не читает raw `extra` и не повторяет heuristics.
5. Cached read bounded: до 100 аккаунтов запроса, до 256 KiB ответа, deadline 3s;
   per-account partial failures. RR передаёт только текущую страницу (обычно 25),
   не всё inventory. При отсутствии batch - ограниченная concurrency 4 и общий
   page deadline 3s; поздний ответ не задерживает Accounts и не меняет другой scope.
6. Quota-only refresh - отдельный POST только по явному действию владельца,
   если handshake подтвердил capability. Он делает только upstream quota query
   и запись нормализованного display snapshot; не вызывает перечисленные в п. 2
   эффекты, inference billing/debit или покупку credits. Обычный audit и display
   cache write допустимы и описаны контрактом. Token refresh разрешён только если
   действующий credential lifecycle явно гарантирует и описывает его эффекты;
   иначе истёкшие credentials оставляют snapshot stale, без скрытого repair.
   Существующие `/usage` и quota/reset handlers не являются реализацией
   этого контракта. Допустимо выделить source-owned безопасное query ядро без
   admin-handler side effects; новый микросервис не нужен.
7. Refresh ограничен одним quota query, deadline 15s, single-flight
   для account+physical generation и серверным интервалом не чаще 30s. Повторный concurrent
   вызов присоединяется к тому же результату; превышение частоты даёт safe retryAt.
   Не запускать скрытые retry inference/auth. Неизвестный результат не вызывает
   повторную отправку автоматически. Подтверждённый quota response возвращается
   с cache-persisted status; старую revision он не перезаписывает. При storage
   failure допустим ephemeral snapshot текущего экрана с явным «не сохранено»,
   а после reload снова видна прежняя observation с прежним as-of.
8. При несовпадении generation/owner/profile, удалении или reconnect вернуть safe
   conflict/denied без старого snapshot. Raw provider errors не выходят за native
   boundary. Версионированный контракт, SDK archive/SRI и fixtures квалифицировать
   до adoption; не обходить SDK прямым admin HTTP/native DB из RR web.

Здесь generation означает неизменяемую physical birth identity native account,
заменяемую reconnect/promotion, как уже определено в
[контракте 53](53-account-gateway-implementation-contract.md#2-private-http-and-persisted-identity).
`authorizationEpoch` - отдельный owner authority fence: reconnect/global disable
его меняют; `metadataRevision`/RR mirror revision - только CAS метаданных. В native
`native_gateway_oauth_refresh.go` engine credential version явно независим от
birth generation и authorizationEpoch. Rename и обычная OAuth access-token rotation
того же principal не сбрасывают quota snapshot и не обновляют его as-of.
Facade должен доказать привязку quota observation к этой identity, не к изменяемому
token version или label. Если текущий SDK/raw cache этого не гарантирует, это L1
prerequisite; до него возвращать unknown, не угадывать identity.
Смена authorizationEpoch отклоняет старый awaited request и очищает browser view;
новое разрешённое чтение с текущим epoch может вернуть прежнюю observation только
если owner и physical principal остались теми же. Нельзя переносить её через
reconnect к новому principal или считать revocation новым разрешением.

Если безопасный refresh пока не реализован, checkpoint cached read/UI поставляется
с capability=false и без кнопки обновления у провайдера. L1/L2 имеют самостоятельную
приёмку; optional L3 учитывается отдельно и не блокирует завершение cached UI.
Не обещать владельцу явное обновление до qualification соответствующей capability.

## RR DTO, время и числовая семантика

RR использует discriminated result `snapshot | unknown | unsupported | unavailable |
restricted`. Только snapshot имеет windows, scope и source metadata. Browser DTO
содержит connectionId и display fields, без ownerRef/accountRef/epoch/source IDs;
revision для UI - непрозрачный display token, не полномочие для команд.
`restricted` объясняет отсутствие quota у shared row без обращения к native.
`unsupported` означает квалифицированное отсутствие quota у профиля; несовместимый
или ещё не поставленный SDK/capability - `unavailable`, missing snapshot - `unknown`.
Разрешённый lifecycle token refresh из п. 6 имеет собственный существующий budget;
он не даёт права повторять quota query или чинить identity.

- Для окна с used=37.5 показать «использовано 37.5%; осталось 62.5%».
  remaining=`max(0,min(100,100-used))`; это производное, не второй native факт.
  Used>100 допустим как reported overage: сохранить значение, bar ограничить 100%,
  remaining=0. Не округлять до вычисления remaining. NaN, infinity, отрицательные
  значения и невалидные типы - unknown affected field, не zero/clamped source value.
- `null`/missing used означает unknown. Ноль показывается только если источник
  действительно сообщил 0. Присутствие local request count, reset или HTTP 429
  не доказывает процент. Частичное окно остаётся видимым с неизвестными полями;
  отсутствие второго окна не создаёт его нулевую копию.
- Подписи «5h»/«7d» разрешены при доказанной duration 18 000/604 800 секунд.
  Другая известная duration получает своё фактическое имя; legacy alias без
  duration - «окно primary/secondary, длительность неизвестна», не выдуманные 5h/7d.
  Дубли alias/canonical одного source window не рисуются вторым лимитом.
- Canonical resetAt/observedAt из SDK - UTC ISO instants; RR валидирует их форму,
  не распознаёт повторно raw Unix/relative поля. Правило source-owned normalizer:
  relative reset_after_seconds допустим только с исходным observedAt того же окна,
  reset=observedAt+seconds. Ноль relative допустим; отрицательное/небезопасное время
  неизвестно. Абсолютный reset приоритетен; при несогласии с relative более 60s
  source возвращает reset unknown с reason, used сохраняется. Browser эти поля
  форматирует и считает countdown, но не строит новый authoritative reset.
- `as-of` - настоящий observedAt; fetchedAt RR хранится отдельно и не освежает
  snapshot. Freshness вычислять серверными часами: stale при возрасте >=5 минут,
  после reset или при неизвестном as-of. Timestamp >serverNow+60s не trusted:
  as-of unknown/stale, без отрицательного возраста. Старые значения сохраняются
  только для той же generation и видны как последние известные, не как текущие.
- По достижении reset не обнулять used и не объявлять новый лимит доступным.
  Показать «ожидается обновление после сброса» с последним observation. Countdown
  локально переводит строку в stale при reset/возрасте, не выполняет network refresh.
  Показывать абсолютный reset/as-of с выбранным
  timezone и UTC offset; в SSR первый текст в UTC, browser-local формат только
  после hydration, чтобы даты и тексты не расходились.

## Доступ, жизненный цикл и cache isolation

Лимит общего account может раскрывать активность во всех workspace. Поэтому в
этой фазе numeric quota доступен личному владельцу в Your accounts и owner/admin
владельца organization account. Получатель personal/operator share, даже admin
получающего workspace, видит только `restricted` («лимиты видны владельцу»).
Workspace member не получает global quota через право запускать review. Общая
operator analytics - отдельная существующая authorization, не новый обход.
Организация, куда personal account расшарен, не становится его владельцем.

Use case выводит target из текущих server-side connection ownership/membership
и canonical account mapping. Browser передаёт только локальный connectionId/
authenticated context. Проверить до remote read и повторно после await: owner,
membership, source state, profile, authorizationEpoch и principalVersion.
При suspend можно показать cached
snapshot владельцу с пометкой suspended; refresh только active account без pending
reconnect/delete. Tombstoned/deleted account не возвращает quota. Свежий reconnect
не наследует прежний snapshot. Ошибки denied/not-found не раскрывают чужие IDs.

Нативный cache имеет key account+physical generation, с текущим owner/epoch guard;
engine credential version и metadataRevision в этот key не входят. RR не вводит собственную
Prisma quota history или persistent cache. HTTP/browser ответы private/no-store;
не использовать Next shared fetch cache. Browser React Query key включает текущий
authenticated scope и connectionId; logout/workspace switch удаляет старые queries.
На reconnect/delete/role change/share revoke cancel/remove affected limit queries
и обновить page. Поздний ответ проверяет captured scope/generation display token
и не возвращает старую цифру на новое подключение. Ни логи, ни errors не содержат
upstream response body, auth headers, email, account IDs или других tenant labels.

## UI и data flow

1. RSC/server loader после действующей authorization получает текущую Accounts
   страницу и cached limits только разрешённых owned rows. Изолировать failures:
   неизвестный лимит не скрывает аккаунт и не ломает остальной экран. SSR содержит
   безопасные значения для первого paint без обязательного client fetch.
2. Рядом с существующей account identity/status добавить компактный общий
   `AccountLimitsLine`: отдельная строка для каждого окна, used/remaining, тонкий
   progress, reset и as-of. Переиспользовать `packages/ui` Button/Badge и текущие
   shared primitives; Progress wrapper добавлять только если нужен повторно.
   Не копировать Vue компонент, nested cards, stats badges или reset controls.
   Прогресс имеет label/aria-valuenow только при известном числе; stale/error
   различимы текстом. Tooltip не единственное место с as-of. Mobile переносит
   строки, без горизонтального overflow; фокус и keyboard action доступны.
3. Нужные состояния: loading initial section; snapshot fresh; snapshot stale;
   partial window; unknown («ещё нет данных»); unsupported («профиль не сообщает
   лимиты»); unavailable («источник недоступен»); restricted. Refresh failure
   сохраняет разрешённый snapshot/as-of и безопасную ошибку. Ничто не показывает
   100% remaining, unlimited или дату «сейчас» на основании отсутствия данных.
4. Интерактивное чтение через React Query: маленький typed key
   `['account-limits', authenticatedScope, connectionId]`, adapter functions отдельно
   от UI, `initialData` из SSR, `staleTime: 30_000`, `retry: false`. Per-account query
   владеет limits: извлечь SSR projection при hydration, а client page cache хранит
   inventory без отдельной изменяемой копии limits. SSR unknown
   тоже гидратируется; не запускать автоматический refresh при mount/focus/reset.
   Никакого interval polling; явное «перечитать сохранённые данные» использует
   cached reader. Если часть account row уже в page query, limits остаётся одной
   authoritative query projection, без второй редактируемой local-state копии.
5. При разрешённом quota-only refresh показать отдельную кнопку «Обновить у
   провайдера». POST/server action повторяет owner authorization, same-origin/CSRF
   и серверный rate limit; кнопка блокируется пока запрос pending/retryAt. Mutation
   не повторяется автоматически и не обещает обновления если capability недоступна.
   Успех обновляет exact account-limits query; UI другого разрешённого account view
   получает invalidation только своего account key, ledger/catalog не затрагиваются.
6. В `provider-usage-view.tsx` заменить literal `Quota / limits: unknown` на
   пояснение «Account limits are shown in Accounts» с локальным переходом к Accounts.
   Не агрегировать account percentages по workspace/model/date range и не помещать
   глобальный snapshot в member/operator usage DTO. Ссылка не раскрывает скрытый
   account и не даёт дополнительных прав целевому loader.

## Поставка, проверки и приёмка

| Checkpoint    | Самостоятельный результат                                                         | Зависимости / статус                                              |
| ------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| L1            | Source-owned cached-read contract, безопасные raw snapshots, SDK fixtures/archive | Source merged; archive и joined acceptance квалифицированы        |
| L2            | RR normalized reader, authorization и Accounts cached UI                          | Реализовано; PostgreSQL, UI/browser и joined acceptance прошли    |
| L3 (optional) | Quota-only native refresh + RR owner action и acceptance                          | Отдельная safe capability, L1/L2; не использовать старые handlers |

Каждый checkpoint начинается от актуального main, обычный PR/CI, около 2 000 changed
LOC без generated/lockfiles; не разрывать authorization/cache invariant. Rollback
отключает capability/read UI, не меняет ledger facts, credential state или producers.
Qualification проверяет фактический native/SDK pin; deployment идёт отдельным
когерентным batch по существующему release runbook. Подготовка этого документа
не включает source implementation, provider requests, входы, миграции или деплой.

Проверки выбирать по наблюдаемому риску, без тестов getters/исходного текста:

- Native contract fixtures: cached read делает ноль upstream calls; отсутствующий
  snapshot плюс local stats остаётся unknown; reset не производит zero. Refresh
  делает quota query без inference, auth/task repair, auto-reset и redemption.
  Проверять точный expected отказ несовместимой capability и owner mismatch.
- Source-owned normalizer table: swapped primary/secondary durations, legacy без
  duration, conflicting aliases, отдельная Spark family, RFC3339 offset/Unix seconds,
  relative reset с observation и без него. RR contract/domain table получает уже
  canonical windows: zero/37.5/>100/null/invalid, only-one-window, boundary reset,
  stale/future clock и used/remaining inversion. Expected values заданы fixture,
  не вычислены проверяемым normalizer. Rename и обычный token refresh сохраняют
  snapshot; reconnect/generation change отклоняет прежний.
- Server integration на disposable PostgreSQL/реальном Accounts mapping:
  personal owner/organization admin/member/shared recipient/cross-tenant ID,
  membership loss/reconnect/delete во время awaited read, неподдержанный SDK,
  page limit и частичный timeout. Отдельно проверить отсутствие global quota в
  shared/member payload и необходимость текущего owner permission для POST.
- UI harness: SSR first paint, unknown/unsupported/restricted, stale после reset,
  частичный snapshot, keyboard/mobile, denied refresh, storage-failed refresh,
  два одновременных клика и scope switch до ответа. Проверить semantic text и
  отсутствие скрытого upstream fetch при mount/focus/countdown; не snapshot разметки.
- Joined native/Gateway/RR acceptance использует controlled provider fixtures и
  existing disposable harness, реальные HTTP contracts и generation fencing.
  До заявления о production native quota отдельно нужен bounded read-only smoke
  на установленной квалифицированной версии; inference/login/reset не prerequisite.

Focused Vitest + scoped provider-accounts/web typecheck, `pnpm architecture:check`,
принятые Foundation checks и обязательные lint/build/CI актуального PR. Native/SDK
имеют source-owned contract tests. Docs-only PR проверяет формат, ссылки и diff;
новые unit-тесты ради документа не добавлять. Тяжёлые проверки выполнять hosted.

Исходная оценка реализации до этой фазы, без generated/lockfiles:

| Scope                      | RR production / tests | Native/Gateway/SDK production / tests | Всего handwritten |
| -------------------------- | --------------------- | ------------------------------------- | ----------------- |
| L1/L2 cached UI            | 500-800 / 250-450 LOC | 250-500 / 150-250 LOC                 | 1 150-2 000 LOC   |
| Optional L3, дополнительно | 150-300 / 100-200 LOC | 150-300 / 100-200 LOC                 | 500-1 000 LOC     |

Общий диапазон с L3 1 650-3 000 handwritten LOC, из них 1 050-1 900 production.
Это оценка новой фазы, не изменение измеренного остатка плана 57. Ориентир усилий:
L1/L2 2-4 инженерных дня, L3 ещё 1-2 дня, без очереди source-owned release/CI и
production qualification; уверенность 7/10. Риск интеграции средний, с верхней
границей 1-2 дополнительных дней при отсутствии principal-generation provenance.
Главный риск -
безопасный quota-only source seam и principal-generation provenance: если их
нет в raw snapshot, сначала исправить owner source, не реконструировать в RR.
Уточнить диапазон после L1 qualification, не подгонять код под LOC.

L1/L2 готовы, когда владелец получает реальные observed native windows, shared
пользователь не получает global quota, missing/stale/reset не выглядят как свободный
лимит, и все гарантии подтверждены на exact native/SDK/RR связке. L3 готов отдельно,
когда квалифицированный refresh делает только разрешённые эффекты и обновляет тот
же account snapshot. Код в main, поставленный артефакт, активация и production smoke фиксируются
отдельно. Ни завершённый ledger, ни успешный review не закрывают эту приёмку.

## Зафиксированные источники

- Fork frontend: [AccountUsageCell.vue](https://github.com/agent-teams-ai/sub2api/blob/0af8920708992ea707971b347cb23ca361501954/frontend/src/components/account/AccountUsageCell.vue),
  [UsageProgressBar.vue](https://github.com/agent-teams-ai/sub2api/blob/0af8920708992ea707971b347cb23ca361501954/frontend/src/components/account/UsageProgressBar.vue),
  [CodexUsageSnapshot types](https://github.com/agent-teams-ai/sub2api/blob/0af8920708992ea707971b347cb23ca361501954/frontend/src/types/index.ts),
  [admin accounts API](https://github.com/agent-teams-ai/sub2api/blob/0af8920708992ea707971b347cb23ca361501954/frontend/src/api/admin/accounts.ts).
- Upstream comparison: [AccountUsageCell.vue](https://github.com/Wei-Shaw/sub2api/blob/dba770d56a0ee0ae5bad1b3dc5e11614d323163c/frontend/src/components/account/AccountUsageCell.vue),
  [UsageProgressBar.vue](https://github.com/Wei-Shaw/sub2api/blob/dba770d56a0ee0ae5bad1b3dc5e11614d323163c/frontend/src/components/account/UsageProgressBar.vue).
- Backend authority: [cached fields/probe/aggregate](https://github.com/agent-teams-ai/sub2api/blob/0af8920708992ea707971b347cb23ca361501954/backend/internal/service/account_usage_service.go),
  [duration normalization](https://github.com/agent-teams-ai/sub2api/blob/0af8920708992ea707971b347cb23ca361501954/backend/internal/service/openai_gateway_service.go),
  [header-to-snapshot mapping](https://github.com/agent-teams-ai/sub2api/blob/0af8920708992ea707971b347cb23ca361501954/backend/internal/service/openai_gateway_usage.go),
  [quota query and units](https://github.com/agent-teams-ai/sub2api/blob/0af8920708992ea707971b347cb23ca361501954/backend/internal/service/openai_quota_service.go),
  [query/refresh handler effects](https://github.com/agent-teams-ai/sub2api/blob/0af8920708992ea707971b347cb23ca361501954/backend/internal/handler/admin/openai_oauth_handler.go),
  [OAuth refresh: independent credential version](https://github.com/agent-teams-ai/sub2api/blob/0af8920708992ea707971b347cb23ca361501954/backend/internal/service/native_gateway_oauth_refresh.go).
