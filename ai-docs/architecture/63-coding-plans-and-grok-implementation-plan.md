# Kimi, GLM, MiniMax и Grok: план подключения через Account Gateway

Статус: реализация и E2E идут; документ задаёт требования, а не подтверждает merge или production activation.
Дата проверки исходников и официальной документации: 2026-10-23.
Основа: [архитектура подключений по Q](62-provider-connection-architecture.md).

Проверенные checkout: ReviewRouter `ff944225405e0021cc3b6c0b30ebc6c7c91f9789`,
Account Gateway `36027f164c149a4fff4a2eff16c557f360650853`,
native sub2api `e0acd64002de0cce6ea6fe25e3f13bb2fd8d674f`.
Два последних SHA обозначают исследованные исходники, а не установленную production-версию.
Пути native и Gateway ниже относительны к соответствующим репозиториям.

## 1. Результат и границы

В существующем Accounts пользователь выбирает Kimi Code, GLM Coding Plan,
MiniMax M Plan либо Grok. Первые три подключаются ключом подписки, Grok - через
провайдера OAuth. После подключения доступны существующие Access, Models,
замена ключа/повторный вход и удаление. Нового мастера настройки репозитория нет.

Каждый первый slice квалифицирует один регион, одну конкретную модель и один
upstream transport. Снаружи сохраняется `openai-responses` через нейтральный
Gateway caller. Добавление модели/региона не включает остальные автоматически.
Текст и toolset выбранного существующего RR agent profile входят в slice;
обычные function tools обязательны. Если этот agent отправляет custom/freeform
tools, адаптер обязан сохранить их семантику существующим codec и доказать
полный tool round trip; одного простого SDK text-запроса недостаточно.
Image/audio/video, computer use,
произвольные URL, cookie/password import и собственные CLI провайдеров не входят.

Параллельно ведутся три key-plan адаптера, Grok и общий UI. Общие контракты
фиксируются один раз; готовый провайдер доставляется независимо от остальных.
Подключение, выполнение review и доступность числовой квоты - отдельные capabilities.
Неопределённое окно квоты скрывает только неподтверждённые цифры этого окна,
если вход, transport и остальные окна независимо квалифицированы.

### Минимальный маршрут реализации

Минимальный общий контракт, четыре provider lanes и общий UI параллельно.
Каждый lane сразу включает свой collector/normalizer лимитов; это не отдельный
проект после подключения. Расширение SDK и private ports делать только под
фактический consumer.
Старые аккаунты и формы работают без переноса данных и повторного входа.

**Миграция — часть обычной поставки.** В RR применить существующим runner
`000142_optional_gateway_reasoning` перед новым кодом: два `DROP NOT NULL`
для reasoning columns, без изменения значений/defaults. Новые providers используют
существующие таблицы аккаунтов. В native расширить только constraints, мешающие
новой identity, обычными additive migrations; прежние migrations не менять.
Backfill, dual-write, compatibility bridge, новый runner и пользовательские шаги
не нужны. При ошибке остановить rollout; при откате кода оставить nullable columns
и закрыть новые profiles существующей deployment policy.

Проверить миграцию один раз в существующем PostgreSQL harness: прежнее reasoning
сохранено, defaults работают, qualified модель без reasoning сохраняется и читается.
Не повторять эту общую проверку для каждого provider.

Один существующий joined harness доказывает цепочку, browser E2E - пользовательский
flow; дополнительные tests нужны только для непокрытых parser/lifecycle рисков.
Не добавлять новый framework, отдельный этап общего ресёрча, обязательную переписку
с провайдерами, повторные review/CI или «полную миграцию на новую платформу».
Существенную неизвестность проверять внутри соответствующего lane; она не задерживает
остальные три. Ограничения доступа и фактические required checks сохраняются.

## 2. Конкретные ограничения подписок

Фраза «вход простой» относится к передаче ключа. Ограничения нужно сопоставить
с конкретным tool, ключом и ownership; отсутствие названия ReviewRouter в списке
само по себе не доказывает запрет запуска поддержанного Codex через relay.
Это проверка provider lane по актуальным правилам, без пользовательской анкеты
и без выдуманного требования всегда получать отдельное письменное разрешение.

| Провайдер       | Подтверждено сейчас                                                                                                                                           | Условие включения в нашем продукте                                                                                                                                                                                                 |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Kimi Code       | Ключ для сторонних coding tools; собственные продукты и командные интеграции документация направляет в Open Platform; требуется честная идентичность клиента. | Подтвердить именно автоматические review через наш relay и выбранную ownership/sharing модель. Новые Go не имеют coding-квоты; Plus+ и legacy отличаются.                                                                          |
| GLM Coding Plan | Codex официально поддержан. Usage Policy запрещает account sharing/multi-user access; Team Plan выдаёт каждому участнику отдельный key/seat.                  | Первый slice - персональное использование владельцем через реальный Codex. Один plan account не выдавать организации/пулу. Hosted relay сопоставить с фактическим сценарием, без автоматического запрета только из-за названия RR. |
| MiniMax M Plan  | Допускаются совместимые AI tools; продукт предназначен для индивидуальной интерактивной работы, для production рекомендован PAYG.                             | Проверить серверные автоматические review и sharing; generic совместимость не равна подтверждению всех этих сценариев. Это неопределённость, а не утверждение о запрете любой автоматизации.                                       |
| Grok            | Есть официальный OAuth для subscription inference и сторонних tools.                                                                                          | Подтвердить разрешённый client/redirect, entitlement модели и personal/team principal для нашего deployment.                                                                                                                       |

Источники: [Kimi overview](https://www.kimi.com/code/docs/en/),
[Kimi membership](https://www.kimi.com/code/docs/en/kimi-code/membership.html),
[GLM FAQ](https://docs.z.ai/devpack/faq),
[GLM tools](https://docs.z.ai/devpack/tool/others),
[GLM Codex guide](https://docs.z.ai/devpack/tool/codex),
[GLM Usage Policy](https://docs.z.ai/devpack/usage-policy),
[GLM Team Plan](https://docs.z.ai/devpack/teamplan),
[MiniMax FAQ](https://platform.minimax.io/docs/m-plan/faq),
[xAI enterprise](https://docs.x.ai/build/enterprise),
[xAI сторонняя OAuth-интеграция](https://x.ai/news/grok-kilocode).

Не маскировать ReviewRouter под другой tool и не обходить ограничения User-Agent.
Правила personal scope и multi-user sharing не смешивать. В первом GLM slice
разрешён только personal workspace владельца; organization/operator grants
не создаются и не принимаются при selection/admission. Ограничение проверить
сервером при attach, изменении review config и создании execution, а не только
скрыть кнопку Access. Новых GLM подключений пока нет: вводится правило создания
и использования новых accounts, без миграции старых account records.
RR application применяет эту profile policy; Gateway не получает полномочий
решать членство или роли workspace. Team Plan не отменяет правило «один seat -
один участник»; его расширение не включать в первый slice.
Не отправлять запросы провайдерам от имени пользователя без поручения на переписку.
PAYG - отдельный продукт/профиль и отдельный выбор пользователя, не fallback при
исчерпании подписки. Его реализация не добавляется молча в scope этого плана.

## 3. Что брать из sub2api, а что адаптировать

У трёх Coding Plans уже есть ordinary admin/service profiles, transport codecs
и quota services. Это не готовая protected Gateway интеграция: соответствующих
tuples нет в `gatewaytransport`, private identity и cached-limits reader.

| Задача                              | Готовый источник в native                                                                                                                                                                               | Как использовать                                                                                                                                                                                                 |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Поля формы ключа                    | `frontend/src/components/account/CreateAccountModal.vue`, `frontend/src/components/account/credentialsBuilder.ts`, `frontend/src/constants/platformCatalog.ts`                                          | Взять смысл полей и ссылки на консоли. Рендерить существующими RR components; не переносить Vue, admin-create DTO и произвольные protocol/base URL knobs.                                                        |
| Provider endpoints и режимы         | `backend/internal/service/provider_profile.go`: `ProviderProfile`, `providerProfiles`, `LookupProviderProfile`; `domain_constants.go`                                                                   | Сверить с актуальными docs, затем зафиксировать exact endpoint/model/protocol в source-owned qualified tuple. Не исполнять ordinary fallback `DefaultMode=payg`.                                                 |
| API-key mechanics                   | `account.go`: `GetCNAPIKey`, `GetAPIProtocol`, `GetCodingPlanProvider`; `anthropic_apikey_auth.go`                                                                                                      | Переиспользовать provider-specific auth scheme. Получать plaintext только внутри scoped custody lease; не читать ordinary credentials вместо custody.                                                            |
| Chat/Responses/Anthropic conversion | `openai_gateway_chat_completions.go`, `gateway_forward_as_chat_completions.go`, `openai_gateway_chat_completions_raw.go`, `openai_gateway_messages_anthropic_native.go`, `upstream_protocol_routing.go` | Взять чистые request/tool/SSE преобразования для выбранного transport. Вызвать из конечного private dispatch с существующим admission, accounting и closure. Не переносить retry/failover orchestration целиком. |
| Key-plan quotas                     | `cn_provider_quota_service.go`: `QueryUsageForAccount`, parsers; `cn_provider_balance_check_service.go`: `runOnce`/`probeQuota`; `channel_monitor_quota_fetcher.go`                                     | Взять HTTP/parsing и расписание как образец; исправить drift. Новый collector получает protected scope и записывает canonical snapshot, не `account.Extra`.                                                      |
| Customer key enrollment             | `handler/admin/native_gateway_identity.go`: `RegisterGatewayNativeRoutes`, private `/candidates`; `native_gateway_credentials.go`: `GatewayNativeCredentialCustody`                                     | Сохранить существующие Seal, scope/AAD, birth identity, candidate proof и erase. Добавить закрытые tuples и безопасную маршрутизацию, не новый customer admin endpoint.                                          |
| Grok PKCE/exchange/refresh          | `pkg/xai/oauth.go`, `repository/grok_oauth_client.go`, `service/grok_oauth_service.go`, `grok_token_refresher.go`                                                                                       | Адаптировать реальные OAuth-запросы к durable operation/custody lifecycle; исправить principal verification, описанную ниже.                                                                                     |
| Grok protocol/tools/stream          | `openai_gateway_grok.go`, `openai_gateway_grok_tool_protocol.go`, `openai_gateway_grok_sse_filter.go`, `openai_gateway_grok_chat_bridge.go`, `grok_upstream_url.go`, `grok_upstream_headers.go`         | Взять finite codecs и проверенные header rules. Отдельный private transport без hidden replay и request-path refresh.                                                                                            |
| Grok quotas                         | `grok_quota_fetcher.go`, `pkg/xai/quota.go`, `pkg/xai/billing.go`                                                                                                                                       | Пассивные headers и отдельно проверенные read-only billing observations. `GrokQuotaService.QueryQuota` целиком не использовать: fallback выполняет inference `POST /responses` с `hi`.                           |

Native Go остаётся в native; RR и SDK не получают копию provider HTTP-логики.
Обычный `AccountHandler.Create`/`CreateAccount` и Vue Grok OAuth возвращают либо
принимают административные credential structures. Публичной customer-границей они
не становятся. Не копировать plaintext token response из `useGrokOAuth.ts`.

## 4. Общая архитектура по Q

Расширить существующие boundaries из документа 62, без параллельной account platform.

- RR application владеет actor/owner/workspace, sharing, operation identity и
  authorization revalidation. Не импортирует provider HTTP/Go/SDK DTO в domain.
- Gateway владеет квалифицированным catalog, SDK wire и координацией операций.
- Native adapter владеет конкретным exchange, auth scheme, principal evidence,
  codec и quota normalization. Native custody/lifecycle сохраняют secret material,
  поколения, fencing и erasure.
- Порты раздельные: key enrollment, OAuth begin/complete/refresh, transport,
  cached limits и background quota collection. Key provider не реализует фиктивный
  OAuth refresh; замена ключа использует существующий reconnect.

Source-owned registry остаётся закрытым. У каждой записи фиксированы provider,
plan, region, native adapter, точная модель, upstream protocol/origin, request
bounds и реальные auth methods. Gateway и native независимо проверяют tuple.
Не добавлять generic произвольный URL, credential bag или runtime plugins.

Новые профили добавлять отдельными leaf definitions в закрытый registry.
Старые `profile`/`secondProfile`/OAuth options не переводить на новый формат:
для safe projection достаточно локального adapter к существующим определениям.
Общие файлы registry/config/wire интегрирует один исполнитель; перенос всех
старых flows на общий registry не входит в этот план.

Точки изменений:

- Native: `gatewaybootstrap/config.go`, `gatewaytransport/registry.go`, `wire.go`,
  `service/native_gateway_identity.go`, private candidate routes и source adapters.
- Gateway: `services/account-gateway/src/service-config.ts`, `service.ts`,
  `oauth-profiles.ts`, `native-client.ts`, `facade.ts` и один SDK schema authority
  `packages/account-gateway/src/features/facade-client/contracts/index.ts`.
- RR: `apps/web/src/server/account-gateway-accounts.ts`,
  `personal-account-composition.ts`, `gateway-model-account-options.ts`,
  `gateway-review-config-catalog.ts` и существующие Accounts controls/panels.

### 4.1. Capabilities и совместимость SDK

Добавить отдельный versioned endpoint `GET /v1/provider-connection-capabilities`
и typed SDK method. Новый контракт `provider-connections/v1` - проектируемый,
не существующий endpoint. Старый strict `/profiles` DTO не расширять полями,
которые сломают установленный SDK.

Безопасная projection содержит profile ID, provider identity/label, plan label,
region label, public protocol, qualified model IDs, поддержанные auth methods,
completion input kind, reconnect и доступный limits contract (v1/v2 либо none).
Для qualified модели добавить безопасные разрешённые reasoning/fast/tool settings;
отсутствующий capability не означает поддержку всех значений.
В ней нет client secret, token policy, upstream URL, native route или raw claims.
Она строится из того же registry, а не из второй независимо редактируемой таблицы.
RR пересекает её с deployment allowlist и живой авторизацией.

Текущие MiMo/OpenRouter/Codex/Claude сохраняют рабочие paths; capability projection
читает их metadata через adapter. Новые подключаются к ней сразу, без предварительного
перевода старых flows или records.
Только явный `404/unsupported contract` разрешает legacy discovery для старых
явно настроенных profiles; `401/403` не превращаются в fallback. Неизвестный
method/input kind не рекламировать. Новые providers требуют новой capability;
старый клиент не получает доступ к ним через permissive defaults.
В RR убрать выбор parser по условию «Claude или Codex»: форма рендерит объявленный
input kind, а SDK/native проверяют его по profile сохранённой операции. Расширить
существующую проверку authorization URL на квалифицированный Grok origin; браузер
не получает возможности задавать произвольный callback или issuer.

Provider identity не равен движку review. Сохранить существующий
`kind: codex` + `authMode: codex_account_gateway` для совместимого Gateway runtime;
не плодить auth modes/workflows для каждого vendor и не называть Kimi «MiMo».
В Accounts/Models показывать upstream provider/plan из safe projection, отдельно
от agent engine. Существующие binding/profile/model admission checks сохраняются.
Публичный каталог моделей из плана 58 не является authority на эти подключения.
В `review-reasoning-capabilities.ts` убрать permissive предположение для новых
profiles: UI и server save/admission используют те же qualified settings.
Не передавать всем Kimi/GLM/MiniMax/Grok глобальный `xhigh` и не менять сохранённое
значение молча. Новая строка получает поддержанный default; несовместимая старая
настройка требует исправления конкретного поля. Provider mapping thinking/reasoning
остаётся native policy, а не vendor conditional в React.

### 4.2. Нативные лимиты: готовые источники и необходимая адаптация

Числовые лимиты входят в каждый provider lane везде, где upstream их сообщает.
Это provider quota, не локальная статистика ReviewRouter и не PAYG balance.
Не переносить admin `Extra` в UI; переиспользовать исходные fetch/parsing helpers
и записывать их результат в существующее canonical snapshot storage.

| Провайдер       | Что уже умеет sub2api                                                                       | Что показываем и что исправить                                                                                                                                                                                                   |
| --------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Kimi Code       | `cn_provider_quota_service.go`: GET `/coding/v1/usages`, `parseKimiUsageTiers`              | 5h и legacy weekly есть; monthly текущих тарифов нужно добавить по реальному ответу. Не считать `usage` всегда weekly и первый detail всегда 5h. Неизвестный monthly не скрывает независимо подтверждённое 5h.                   |
| GLM Coding Plan | Тот же service: GET `/api/monitor/usage/quota/limit`, `parseZhipuTokenTiers`                | 5h/weekly, remaining/used и reset; различать credits/tokens. Использовать явный `unit` (3/6); не присваивать неизвестному окну тип по порядку reset. Отсутствующий percentage - unknown, не 0.                                   |
| MiniMax M Plan  | `parseMiniMaxUsageTiers`, 5h и optional weekly                                              | Переиспользовать преобразование remaining→used. Проверить один выбранный endpoint/response: текущая документация указывает `/v1/token_plan/remains`, source использует legacy path. Не опрашивать оба адреса на каждом чтении.   |
| Grok            | `grok_quota_fetcher.go`, `pkg/xai/quota.go`, `pkg/xai/billing.go`, read-only `ProbeBilling` | Week/Month из фактического billing snapshot, request/token rate limits из пассивных headers. Это разные dimensions, не выдавать rate limit за месячную квоту плана. Без наблюдения - unknown. Не использовать active `hi` probe. |

Изменение endpoint/schema проверяется одним актуальным response fixture/canary
в lane, без отдельного длительного исследовательского этапа и без обязательного
наличия публичной спецификации JSON. Сохранять только проверенные поля; неизвестные
поля не угадывать. Один неполный bucket не лишает пользователя остальных валидных
окон, а failure одного provider не отключает соседние.
Для Grok не считать встроенную free-tier константу или credential fallback
наблюдённой квотой. `observedAt` берётся из фактического fetch/headers snapshot,
а не из нового `now` при построении UI. Native значение и оценка не смешиваются.

### 4.3. Совместимость limits wire

Текущий `account-limits/v1` закрыт на семьи Codex/Claude. Сохранить этот read
для них; новые profiles используют отдельный typed `account-limits/v2` read.
Контракт выбирается по объявленной capability, без отдельного negotiation flow
и пробных запросов к обоим versions. Старый strict consumer не получает новые enums.

Сохранить generation/principal/revision fences, owner-only authorization,
наблюдённые `usedPercent`, `observedAt`, `resetAt` и unknown values. В v2 добавить
закрытые provider/window identities и period: подтверждённая duration,
месячный billing cycle либо unknown. Monthly не превращать в выдуманные 30 дней;
unit credits/tokens/requests не подменять друг другом. Browser labels - короткая
allowlisted projection (`5h`, `Week`, `Month`), без эха произвольных provider IDs.

Native нормализует provider responses, SDK валидирует versioned wire,
существующий RR domain adapter готовит display для v1/v2. Gateway cached-limits
port сохраняет единые authorization/identity/revalidation guards. Отдельный SDK
Consumer DTO или неиспользуемый normalization helper не добавлять; вычисление
процентов и stale/reset правила не дублировать. Расширение wire
не требует переписывать сохранённые snapshots или одновременно публиковать их в v1/v2.
Старые Codex/Claude сценарии и labels остаются прежними. Новый snapshot целиком
заменяет набор окон: исчезнувшее weekly окно нельзя сохранить как свежее.
Отсутствующее число не равно нулю, а пустой HTTP 200 не является валидной квотой.

Storage расширять только там, где существующая схема действительно мешает:
например, FK snapshots в migration 252 связан с OAuth qualification, а journals
245/253 закрепляют Codex client либо Claude principal. Не записывать Grok/keys
под чужой identity ради reuse. Если существующий constraint мешает новому profile, расширить его в обычной
новой migration. Новую таблицу/journal добавлять только при доказанной невозможности
сохранить нужный custody/lifecycle invariant в существующем storage; не создавать
копию на каждого provider. Прежние SQL migrations не менять.
Без backfill, массового reconnect/re-encryption, dual-write и нового migration runner.
Каталог profiles остаётся в коде, отдельные DB-таблицы для него не нужны.

Source-owned collector работает независимо от страницы: ограниченный read-only
usage/billing request, один in-flight на account generation, timeout/response-byte
bounds, cooldown и CAS при публикации. Переиспользовать native background cadence,
но перечислять только явно enrolled protected accounts через их custody scope.
После applied enrollment запланировать первый такой read-only сбор существующим
native worker; success подключения не ждёт доступности quota endpoint. Повторять
сбор по существующей cadence, без нового cron/сервиса и без пользовательских шагов.
Не подключать ordinary account enumeration и plaintext `Extra` к private boundary.
Collector не обновляет OAuth credential и не запускает inference как fallback.
Если нужна maintenance refresh, сначала выполняется отдельная штатная операция.

В v2 различать plan quota и rate-limit dimensions, отображая явные короткие labels.
Публиковать валидные окна независимо: отсутствующий monthly не убирает валидное
5h, а неизвестный тип окна не получает выдуманные duration/reset.
Accounts SSR/list/reload saved limits остаются cached-only: ноль provider requests,
refresh и пробных model calls. Если не подтверждено ни одного окна, unavailable
не добавляет текст в строке, как принято пользователем. Валидные соседние окна
показываются; рабочий transport отсутствием квоты не блокируется.

## 5. Kimi / GLM / MiniMax: конкретные slices

Первые профили global, по одному model. CN и другие модели добавляются такими же
явными квалификациями; selector региона показывается только при реальном выборе.
Предлагаемые IDs фиксируют семейство профиля, точный model остаётся в immutable
tuple; менять его под сохранённым profile ID без новой qualification нельзя.

| Lane    | Profile ID для первого slice               | Transport, который квалифицируем                                                                                  | Model candidate, не обещание entitlement                |
| ------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Kimi    | `kimi-code-global-responses-apikey-v1`     | Native Responses на `https://api.kimi.ai/coding/v1`; source уже умеет этот protocol.                              | `k3-256k`, проверить доступ выбранного tier и bounds.   |
| GLM     | `glm-coding-global-responses-apikey-v1`    | Прямой Responses `https://api.z.ai/api/v1` по официальной Codex integration; один tool/SSE контракт до включения. | `glm-5.3-flash`, подтвердить точный upstream ID/доступ. |
| MiniMax | `minimax-mplan-global-responses-apikey-v1` | Source-native Responses на `https://api.minimax.io/v1`, после проверки tool/SSE поведения.                        | `MiniMax-M3.1-Flash`.                                   |

Эти новые IDs являются спецификацией реализации, сейчас registry их не принимает.
Если выбранный direct Responses не проходит контракт, lane не включает tuple;
допустимый Chat/Anthropic bridge требует отдельной явной qualification до activation,
а не скрытой смены endpoint/protocol во время запроса.

Общий key flow: server валидирует выбранный profile/region и transient key;
существующая операция создаёт sealed candidate, проверяет exact native descriptor
и завершает обычный account lifecycle. Не класть `account_mode`, model mapping,
пользовательские headers или probes в native account как обход closed shape.
API-key principal identity остаётся scoped credential generation; email/account
провайдера показывать только при отдельном достоверном authenticated evidence.

Сохранение ключа не доказывает доступ каждой модели. Использовать существующее
readiness `unknown`, когда upstream access ещё не проверен; не выдавать это за
подтверждённую model health. Документированный read-only credential check допускается
при onboarding; неопределённый collector не является доказательством неверного ключа.
Пробный inference - только существующий явный Test connection через admission,
без нового auto-ping на сохранении/рендере. Неверный key/region/tier должен давать
короткую ошибку или непроверенное состояние, но не ложное подтверждение доступа.

Provider-specific работа:

- **Kimi:** проверить реальные quota fixtures новых и legacy plans. Source
  `parseKimiUsageTiers` сейчас считает первый detail окном 5h, а `usage` weekly;
  перенести это предположение нельзя. Нужны явные window markers, monthly/legacy
  различия, исчезновение weekly и Go без coding quota. Experimental usage endpoint
  требует проверки фактического ответа; неподтверждённые окна остаются unknown,
  независимо подтверждённые отображаются без ожидания полной схемы всех тарифов.
- **GLM:** existing ordinary profile не знает опубликованный Responses endpoint.
  Первый путь - прямой Responses по официальной Codex integration, с существующим
  Responses codec и tool round trip. Chat bridge не строить заранее; он допустим
  только при подтверждённой необходимости и отдельной qualification выбранного
  tuple, без runtime failover. Quota fixtures должны различать credits и другие
  единицы, 5h и weekly. Optional team org/project
  credentials из admin UI в MVP не переносить; team profile - отдельная квалификация.
- **MiniMax:** актуализировать имя M Plan/Subscription Key. Source использует
  legacy `/v1/api/openplatform/coding_plan/remains`, docs показывают
  `https://www.minimax.io/v1/token_plan/remains`. Квалифицировать новый endpoint
  и response fixture; не считать старый неработающим без факта. В text slice не
  включать video buckets. Правильно обрабатывать optional weekly и business errors.

Не писать «подписка никогда не тратит деньги»: Kimi Extra Usage, MiniMax credit
packs и GLM Team overage могут иметь настройки расхода на стороне провайдера.
Team overage не включается в наш первый GLM slice. Это отличается от
запрещённого автоматического переключения нашего соединения на PAYG credential.

## 6. Grok: адаптация готового OAuth

Первый профиль: `grok-subscription-responses-oauth-v1`, одна квалифицированная
модель; кандидат `grok-4.7`, а не автоматический alias `latest`.
Grok subscription inference использует `cli-chat-proxy.grok.com`, не PAYG
`api.x.ai`. Exact paths/headers закрепляет native tuple.

### Вход без лишних вариантов в UI

Первый method - browser authorization_code + PKCE S256 из source. До включения
зафиксировать допустимый client ID и redirect policy для deployment. Native default
`http://127.0.0.1:56121/callback` и публичный CLI client ID сами по себе не разрешают
произвольный hosted redirect или переиспользование клиента нашим продуктом.

Сначала использовать разрешённый automatic return callback, если он подтверждён.
Фактический browser flow Grok Build показывает одноразовый код: capabilities
декларируют существующий `authorization_code`, пользователь один раз вставляет
код в тот же диалог. Native берёт исходный state из уже зашифрованного intent
этой owner/profile/operation и выполняет прежний PKCE/CAS exchange; браузер не
хранит state или authorization URL ради восстановления callback. Выбор grammar
делается по сохранённому provider операции, а не содержимому вставленного секрета.
Старый точный loopback callback URL принимается для совместимости и по-прежнему
проверяет переданный state. Нет нового daemon, настройки OAuth app пользователем,
миграции или поля provider URL. Если легитимный browser handoff не подтверждён,
профиль остаётся disabled; не подменять его cookie import.

Device authorization в этот slice не входит; source SSO-cookie converter
не переносить как публичный вход. Первый UI предлагает один browser flow.

### Что дописать поверх native mechanics

1. Использовать private Claude/Codex enrollment/lifecycle как образец durable
   operation, custody и restart fencing; отдельный Grok exchange/refresh adapter.
   State, verifier и nonce привязаны к сохранённым owner/profile/operation, callback
   exact grammar определяется этим profile; не угадывать provider по pasted text.
2. Исправить trust gap: `applyGrokTokenClaims` вызывает только base64 JSON decode.
   Для новой границы проверять OIDC signature через fixed issuer/JWKS, `iss`, `aud`,
   `exp` и сохранённый nonce; authenticated userinfo должен соответствовать subject.
   Personal/team principal фиксируется при birth и проверяется при refresh.
   Email и непроверенный `team_id` не являются authority. Использовать проверенный
   verifier, не писать криптографическую JWT-проверку вручную.
3. Адаптировать реальный refresh grant, rotation/nonrotation refresh token,
   expiry/revocation и uncertain exchange/refresh по существующей операции/CAS.
   Ни inference, ни чтение saved limits не вызывают request-path refresh provider.
4. Новый finite protected transport использует чистые Grok codecs, headers и SSE
   filter. `forwardGrokResponses` целиком не вызывать: его retries на 400/422 и
   failover не соответствуют одному admitted provider entry. Unsupported tools,
   modalities и oversized input отвергать до decrypt/dispatch.
5. Для limits брать пассивные headers и достоверный subscription billing snapshot.
   Никогда не переносить fallback `hi` probe из `QueryQuota`. Отсутствие headers
   означает неизвестную квоту, а не free/unlimited. Billing-only collection включать
   только с отдельно квалифицированным read-only endpoint/scope.

## 7. UX: один существующий диалог

```text
Kimi / GLM / MiniMax:  Provider → Subscription key → Connect
Grok:                 Provider → Continue with Grok → one code paste
```

- Расширить `AccountsAddDialog`/`AccountGatewayControls`, не создавать по странице
  на provider. Select использует capabilities; API-key-only provider не показывает
  переключатель OAuth/API key. Grok имеет одну основную кнопку входа.
- В key форме одно password-поле, ссылка «Get key», необязательное имя с готовым
  значением. Region появляется только при нескольких квалифицированных вариантах,
  без Base URL и protocol выбора. Existing owner default/personal sharing policy
  сохраняется; не добавлять новый ownership wizard и не делиться аккаунтом молча.
  Для первого GLM profile доступен только personal owner; не предлагать organization
  owner/Access grant, запрещённые серверной profile policy. Достаточна короткая
  подпись `Personal use`, без анкеты или дополнительного подтверждения.
- Короткий helper: `Use your subscription key`. Для MiniMax явно Subscription Key,
  для Kimi - Kimi Code key. Обычный API key и его биллинг не определять по префиксу.
- Один submit in-flight; Enter/keyboard focus работают. Ошибка рядом с полем:
  `Check the key and region`. Нормализованные expired/forbidden/model unavailable
  состояния дают понятное действие, не raw provider error/stack/JSON.
- После успеха показать подключение и ссылку `Choose in Models`; выбор модели и
  использование в репозитории не запускаются автоматически. Для сохранённого,
  ещё не проверенного key state использовать `Connected`, не обещание model health.
- Замена ключа - тот же password input с `Replace key`; повторный OAuth -
  `Sign in again`. Сохранённые ключи/токены не возвращать; очищать transient input
  при успехе/закрытии/смене provider. Не хранить secrets в URL, query cache,
  localStorage, history, browser-readable operation result или диагностике.
- Existing operation readback восстанавливает safe progress после сбоя сети;
  unknown operation не приводит к автоматическому повтору обмена/записи ключа.
- В строке аккаунта короткие provider/plan/auth labels. Не более двух quota bars,
  дополнительные окна/observation time в существующем Details. Недоступный источник
  не добавляет текст; owner-only message остаётся только для настоящего получателя.
- First paint и авторизацию оставить на сервере. Новый интерактивный cache/polling
  использует существующий React Query adapter и маленькие scoped typed keys;
  secret form submit остаётся одноразовым server action, без ненужного query cache.
  После смены user/workspace/profile старые ответы и проценты не применяются.

## 8. Как делать параллельно

Координатор фиксирует минимальные DTO/ports и leaf registration shape внутри
первого provider slice. Остальные lanes сразу пишут свои leaves на согласованных
interfaces; UI работает с typed fixture capabilities. Отдельный foundation project
и предварительная миграция старых подключений не требуются.

| Lane / ownership               | Изолированная работа                                                                                               | Зависимость для интеграции                                                                                                    |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| A: общий контракт и интеграция | Минимальные SDK schemas/capability endpoints, private ports, registry/config и RR composition, включая limits wire | Один writer общих authority/config/lock/schema файлов. Не переносит все старые flows на новую архитектуру до новых providers. |
| B: Kimi                        | Kimi qualified leaf, request/response fixture, key auth и Kimi quota parser                                        | Подключается к A; eligibility и quota schema отмечаются отдельно.                                                             |
| C: GLM                         | GLM Responses leaf, credentials/credits fixtures, owner-only policy                                                | Подключается к A независимо от B/D/E. Проверяет поддержанный Codex scenario; не ждёт абстрактного внешнего approval.          |
| D: MiniMax                     | M Plan leaf, current usage endpoint/parser fixtures, Subscription Key checks                                       | Подключается к A независимо от B/C/E.                                                                                         |
| E: Grok                        | Browser client/redirect qualification, durable OAuth/principal/refresh, finite transport и passive limits          | Начинается одновременно с B/C/D; не ждёт их merge.                                                                            |
| F: RR UI / browser E2E         | Existing dialog/panels, provider-specific copy/icons, mocked capability adapter и browser scenarios                | Сначала fixture A, затем installed SDK и реальные backend adapters. Не редактирует registry roots.                            |

Каждый lane имеет отдельный worktree/branch и ownership. Provider definitions и
tests находятся в собственных leaf modules. Общую регистрацию, schema exports,
shared fixtures и package versions вносит A из reviewed lane patches, чтобы три
исполнителя не переписывали один registry. Никто не откатывает чужие изменения.

Тяжёлые build/PG/browser/joined проверки выполнять на hosted workers в изолированных
каталогах, портах и DB/container identities. Проверять свежие ресурсы и host identity;
нет искусственного single-heavy-job lock. Не создавать новые пользовательские чаты
вместо подзадач. Fixtures и scratch держать в ignored `tmp/`.

### Порядок merge и поставки

1. **A:** минимальные connection/limits contracts и registry seam, совместимые
   со старыми consumers. Они могут войти в первый связный provider PR, если diff
   укладывается в review budget; отдельные подготовительные PR не самоцель.
2. **B/C/D/E параллельно:** каждый provider - согласованный native/Gateway/RR slice,
   включая его источник лимитов. Готовый slice доставляется без ожидания остальных.
   Grok сохраняет enrollment/refresh/transport внутри своей работы; отдельное
   публичное «подключение без работающего review» не объявляется готовым provider.
3. **F:** общий UI использует тот же SDK и существующий browser harness. Включение
   profile требует native joined proof и одного controlled live canary, а не
   отдельного повторения одного и того же доказательства на каждом слое.

При поставке сначала native, затем совместимый Gateway/SDK, затем RR.
Новый profile включается только после готовности всей цепочки; до этого он
не предлагается в Accounts. Старые profiles продолжают работать на своих contracts.
При откате активации закрыть новый profile для подключения и execution admission
штатной deployment policy. Custody и journals сохранить для штатного lifecycle;
обратный перенос старых данных не нужен. Для schema changes и их проверки
действует единственный минимальный маршрут из раздела 1; отдельная rollback/rehearsal-система не нужна.

PR примерно до 2 000 changed LOC; связный инвариант не разрезать ради цифры.
Основание стека мержить без потери ancestry либо своевременно перестраивать
потомков и проверять новый exact head. Не разделять уже проверенный связный PR
только ради числа providers; новые независимые slices не собирать в один mega-PR.
Для каждой пары native/Gateway/RR фиксировать совместимые SHA и SDK version,
а не переносить dirty directories как authoritative input.

## 9. Проверки и критерии приёмки

Переиспользовать существующие тестовые границы, а не строить второй E2E framework.

| Граница               | Минимальное доказательство                                                                                                                                                                                                                                                                                                                          |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SDK/registry          | Старый strict consumer работает; новые profiles отсутствуют без capability; wrong owner/profile/region/model/URL override отклоняется до decrypt/provider entry.                                                                                                                                                                                    |
| Key custody/lifecycle | Sealed candidate, повтор одного operation ID, reconnect/erasure, конкурентный delete, late write и retained generations проверяются штатным native/Gateway lifecycle.                                                                                                                                                                               |
| OAuth Grok            | Single-use state/code; restart/concurrency; неверный issuer/audience/nonce/подпись; principal/team continuity; refresh rotation/nonrotation/revocation; неизвестный exchange не повторяется.                                                                                                                                                        |
| Protected transport   | Реальный HTTP fixture через actual native transport → Gateway → installed SDK → настоящий установленный RR agent/caller: text, его function/custom-tool round trip, streamed terminal/usage, cancel/deadline/byte bounds. Один provider entry на admitted request; два законных tool turns - два явно учтённых request, без hidden replay/failover. |
| Quotas                | Actual provider-shaped fixtures: Kimi new/legacy/monthly/no coding; GLM credits; MiniMax new endpoint/optional weekly/business error; Grok missing headers. Missing/malformed/zero различимы; old windows удаляются; stale/generation mismatch не выдаёт свежие цифры.                                                                              |
| Owner/privacy         | Personal owner в workspace видит свою quota; получатели - нет. GLM owner-only policy отклоняет organization/operator grant, чужую selection и execution даже при подделанном запросе или сохранённом binding. Membership/binding/revision loss во время await скрывает результат. Использовать canonical detach + exact ACK, не raw state update.   |
| Browser               | Все четыре connection flows, wrong key/region/tier, cancel/retry/readback, Grok manual handoff где включён, reconnect/delete и workspace switch; desktop/mobile, keyboard, минимум текста, нет overflow/secret leakage.                                                                                                                             |
| Инертные reads        | Открытие Accounts, SSR, Models catalog, Details и Reload saved limits дают ноль upstream inference, OAuth refresh и provider quota probes.                                                                                                                                                                                                          |

Точки расширения существующих suites:

- Native `internal/gatewaytransport/*_test.go`,
  `internal/gatewaybootstrap/native_gateway_joined_lifecycle_test.go`,
  `native_account_limits_test.go`, protected handler/repository tests и provider
  service parser tests. PG/Redis включаются там, где проверяется реальный adapter.
- Gateway `services/account-gateway/test/facade-ingress.test.ts`,
  `oauth-enrollment-postgres.test.ts`, `native-transport-postgres.test.ts`,
  `native-claude-joined.ts` как образец нового Grok/provider joined fixture;
  SDK contract/client tests и `pnpm qualify:consumers` для установленного пакета.
- RR `account-gateway-accounts.integration.test.ts`,
  `personal-canonical-accounts.test.ts`, `account-limits-service.test.ts`,
  `account-limits.postgres.test.ts`, controls OAuth tests и
  `scripts/accounts-reference-e2e/src/tests/account-limits.spec.ts` плюс новые
  provider enrollment сценарии в том же disposable harness.

Во время реализации выбрать focused команды по изменённой границе: native
`go test` по названным packages, Gateway package scripts build/test/typecheck и
services tests, RR `pnpm exec vitest run <affected files>` и harness run с
`--expected-revision <exact SHA>`. Затем обязательные architecture/lint/typecheck/
build и GitHub CI проекта на финальном head. TypeScript для новых рукописных
fixtures/helpers; не добавлять отдельный JS runner или новую тестовую платформу.

Существующие Codex/Claude/MiMo/OpenRouter contract regressions обязательны после
общих изменений; одинаковый успешный прогон не повторять из-за несвязанной правки.
Installed SDK qualification повторять при изменении самого package/contract;
не повторять её для каждого leaf с теми же неизменными SDK bytes. Provider-specific
joined/browser scenario всё равно проверяет новый adapter и фактическую интеграцию.
Quota fixtures и browser screenshots не являются доказательством настоящего входа
или provider transport: в отчёте сохранять эти границы явно.

До production activation каждого provider: допустимый intended use, один явно
тестовый реальный account, exact qualified model, контролируемый минимальный
request/tool cycle и нужный refresh/reconnect/erase proof. При ambiguous effect
не повторять провайдерский POST. Не создавать новые GitHub repos на каждый прогон;
reuse existing disposable repo. App-first публикация остаётся авторством GitHub App.
В том же canary проверить quota collector: безопасно зафиксировать полученные
provider windows, normalized values и последующее cached чтение без новых effects.
Если у конкретного тарифа источник не отдаёт чисел, зафиксировать отсутствие,
не запускать ещё один платный probe. Это не отдельный повтор всего E2E.

## 10. Оценка объёма и готовность

Оценка дополнительных handwritten LOC, не обещание сроков. Generated/lockfiles,
live canary preparation и внешнее согласование не включены. Shared plumbing
считается один раз; provider строки используют его и готовые codecs.

| Работа                                                           | Production LOC |   Tests LOC | Уверенность |
| ---------------------------------------------------------------- | -------------: | ----------: | ----------: |
| Shared native/Gateway/SDK + RR capabilities/limits-v2/общий UI   |    1 100-1 900 |   900-1 500 |        7/10 |
| Kimi leaf и его интеграция                                       |        300-550 |     350-600 |        6/10 |
| GLM leaf и его интеграция                                        |        250-450 |     300-550 |        6/10 |
| MiniMax leaf и его интеграция                                    |        250-450 |     300-550 |        7/10 |
| Grok browser OAuth/principal/refresh/transport, без shared части |    1 100-1 900 |   600-1 100 |        6/10 |
| Итого                                                            |    3 000-5 250 | 2 450-4 300 |        6/10 |

Порядок завершения: зафиксировать совместимые native/Gateway/SDK/RR версии →
проверить изменившиеся границы и единый joined/browser flow → required CI/review →
merge в порядке native, Gateway, RR. Уже успешные проверки неизменённых bytes
использовать повторно; новые отчёты, отдельные rehearsal и повторное согласование
плана не являются дополнительными gates. Live canary нужен для activation,
а не как повод повторно строить и тестировать весь fixture slice.

Первый технический checkpoint готов, когда новый профиль проходит protected
enrollment, установленный SDK, один model/tool review, safe lifecycle и browser UX.
Отдельный статус production enabled требует eligibility и live qualification.
Пустая квота не мешает рабочему review, но не объявляется работающей numeric feature.

Поставка следует [release source of truth](../operations/07-environments-and-release-management.md).
Текущий production HOLD на общий cutover не обходить ради подключения провайдера;
план не поручает менять миграционную authority, stable tags или обходить protection.
Реализация уже поручена; уточнение плана не требует нового согласования или
повторного старта. Готовность фиксируется проверками и merge, а не этим документом.

## 11. Проверенные источники

- [Kimi endpoint/model/client identity](https://www.kimi.com/code/docs/en/),
  [тарифы и окна](https://www.kimi.com/code/docs/en/kimi-code/membership.html).
- [GLM integration/endpoints](https://docs.z.ai/devpack/tool/others),
  [ограничения tools и quota](https://docs.z.ai/devpack/faq),
  [Codex Responses integration](https://docs.z.ai/devpack/tool/codex),
  [персональное использование](https://docs.z.ai/devpack/usage-policy),
  [отдельные Team seats](https://docs.z.ai/devpack/teamplan),
  [Coding Plan overview](https://docs.z.ai/devpack/overview).
- [MiniMax M Plan, usage URL и billing](https://platform.minimax.io/docs/m-plan/faq),
  [подключение других tools](https://platform.minimax.io/docs/m-plan/other-tools).
- [xAI OAuth discovery](https://auth.x.ai/.well-known/openid-configuration),
  [auth/proxy/enterprise](https://docs.x.ai/build/enterprise),
  [subscription OAuth в стороннем tool](https://x.ai/news/grok-kilocode).

До qualification не считать docs/catalog entry доказательством actual account
entitlement, работоспособности модели или согласованности старого native parser.
Повторять web research только по изменившемуся endpoint, правилу или новой
существенной неопределённости; не начинать каждый lane с повторения всего аудита.
