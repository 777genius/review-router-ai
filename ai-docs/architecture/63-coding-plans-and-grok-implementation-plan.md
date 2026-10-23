# Kimi, GLM, MiniMax и Grok: план подключения через Account Gateway

Статус: план реализации, код интеграций не реализован этим документом.
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
Неопределённая схема квоты отключает только её отображение, если вход и transport
независимо квалифицированы.

## 2. Обязательное уточнение исходной оценки

Фраза «вход простой» относится к передаче ключа. Она не доказывает, что все
персональные подписки разрешают автоматические SaaS-ревью и совместное использование.
Проверка intended use выполняется в provider lane, без пользовательской анкеты.

| Провайдер       | Подтверждено сейчас                                                                                                                                           | Условие включения в нашем продукте                                                                                                                                                           |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Kimi Code       | Ключ для сторонних coding tools; собственные продукты и командные интеграции документация направляет в Open Platform; требуется честная идентичность клиента. | Подтвердить именно автоматические review через наш relay и выбранную ownership/sharing модель. Новые Go не имеют coding-квоты; Plus+ и legacy отличаются.                                    |
| GLM Coding Plan | FAQ ограничивает подписку официально поддержанными tools/products; ReviewRouter в опубликованном списке не найден.                                            | До подтверждения нашего сценария не включать подписочный профиль. Использование Codex как движка само по себе не доказывает допустимость SaaS-посредника.                                    |
| MiniMax M Plan  | Допускаются совместимые AI tools; продукт предназначен для индивидуальной интерактивной работы, для production рекомендован PAYG.                             | Проверить серверные автоматические review и sharing; generic совместимость не равна подтверждению всех этих сценариев. Это неопределённость, а не утверждение о запрете любой автоматизации. |
| Grok            | Есть официальный OAuth для subscription inference и сторонних tools.                                                                                          | Подтвердить разрешённый client/redirect, entitlement модели и personal/team principal для нашего deployment.                                                                                 |

Источники: [Kimi overview](https://www.kimi.com/code/docs/en/),
[Kimi membership](https://www.kimi.com/code/docs/en/kimi-code/membership.html),
[GLM FAQ](https://docs.z.ai/devpack/faq),
[GLM tools](https://docs.z.ai/devpack/tool/others),
[MiniMax FAQ](https://platform.minimax.io/docs/m-plan/faq),
[xAI enterprise](https://docs.x.ai/build/enterprise),
[xAI сторонняя OAuth-интеграция](https://x.ai/news/grok-kilocode).

Не маскировать ReviewRouter под другой tool и не обходить ограничения User-Agent.
Внешнее подтверждение может разрешать personal scope и не разрешать workspace
sharing: такие capabilities включаются отдельно. Не отправлять запросы провайдерам
от имени пользователя без отдельного поручения на переписку.
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

В Gateway нормализовать старые `profile`/`secondProfile`/OAuth options в один
внутренний список. Существующие конфиги остаются допустимыми; новые профили
принимаются только из закрытого registry. Общие файлы registry/config/wire
интегрирует один исполнитель; provider lanes отдают отдельные leaf definitions.

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
completion input kind, reconnect и доступность limits/sharing capabilities.
Для qualified модели добавить безопасные разрешённые reasoning/fast/tool settings;
отсутствующий capability не означает поддержку всех значений.
В ней нет client secret, token policy, upstream URL, native route или raw claims.
Она строится из того же registry, а не из второй независимо редактируемой таблицы.
RR пересекает её с deployment allowlist и живой авторизацией.

Сначала мигрировать MiMo/OpenRouter/Codex/Claude без изменения поведения.
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

### 4.2. Limits v2 для новых providers

Текущий `account-limits/v1` закрыт на семьи Codex/Claude. Не менять его смысл
или выдавать новые значения старому strict consumer. Добавить negotiated
`account-limits/v2` с отдельным typed read и сохранением v1 для старых consumers.

Сохранить generation/principal/revision fences, owner-only authorization,
наблюдённые `usedPercent`, `observedAt`, `resetAt` и unknown values. В v2 добавить
закрытые provider/window identities и period: подтверждённая duration,
месячный billing cycle либо unknown. Monthly не превращать в выдуманные 30 дней;
unit credits/tokens/requests не подменять друг другом. Browser labels - короткая
allowlisted projection (`5h`, `Week`, `Month`), без эха произвольных provider IDs.

Нормализация живёт в native, SDK валидирует wire, RR domain проецирует display.
Оба wire versions адаптируются в один consumer-facing limits port, без второй
копии правил авторизации, stale/reset и вычисления процентов.
Старые Codex/Claude сценарии и labels остаются прежними. Новый snapshot целиком
заменяет набор окон: исчезнувшее weekly окно нельзя сохранить как свежее.
Отсутствующее число не равно нулю, а пустой HTTP 200 не является валидной квотой.

Source-owned collector работает независимо от страницы: ограниченный read-only
usage/billing request, один in-flight на account generation, timeout/response-byte
bounds, cooldown и CAS при публикации. Переиспользовать native background cadence,
но перечислять только явно enrolled protected accounts через их custody scope.
Не подключать ordinary account enumeration и plaintext `Extra` к private boundary.
Collector не обновляет OAuth credential и не запускает inference как fallback.
Если нужна maintenance refresh, сначала выполняется отдельная штатная операция.

Accounts SSR/list/reload saved limits остаются cached-only: ноль provider requests,
refresh и пробных model calls. Неквалифицированная quota schema даёт unavailable
без текста в строке, как принято пользователем; рабочий transport этим не блокируется.

## 5. Kimi / GLM / MiniMax: конкретные slices

Первые профили global, по одному model. CN и другие модели добавляются такими же
явными квалификациями; selector региона показывается только при реальном выборе.
Предлагаемые IDs фиксируют семейство профиля, точный model остаётся в immutable
tuple; менять его под сохранённым profile ID без новой qualification нельзя.

| Lane    | Profile ID для первого slice               | Transport, который квалифицируем                                                                                                     | Model candidate, не обещание entitlement                |
| ------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| Kimi    | `kimi-code-global-responses-apikey-v1`     | Native Responses на `https://api.kimi.ai/coding/v1`; source уже умеет этот protocol.                                                 | `k3-256k`, проверить доступ выбранного tier и bounds.   |
| GLM     | `glm-coding-global-responses-apikey-v1`    | Существующая Chat conversion через `https://api.z.ai/api/coding/paas/v4`; не включать новый direct Responses только по документации. | `glm-5.3-flash`, подтвердить точный upstream ID/доступ. |
| MiniMax | `minimax-mplan-global-responses-apikey-v1` | Source-native Responses на `https://api.minimax.io/v1`, после проверки tool/SSE поведения.                                           | `MiniMax-M3.1-Flash`.                                   |

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
  без устойчивого schema оставляет numeric capability выключенной.
- **GLM:** existing profile не знает опубликованный сейчас Responses endpoint.
  В первом slice сохраняется проверяемый Chat bridge. Quota fixtures должны
  различать credits и другие единицы, 5h и weekly. Optional team org/project
  credentials из admin UI в MVP не переносить; team profile - отдельная квалификация.
- **MiniMax:** актуализировать имя M Plan/Subscription Key. Source использует
  legacy `/v1/api/openplatform/coding_plan/remains`, docs показывают
  `https://www.minimax.io/v1/token_plan/remains`. Квалифицировать новый endpoint
  и response fixture; не считать старый неработающим без факта. В text slice не
  включать video buckets. Правильно обрабатывать optional weekly и business errors.

Не писать «подписка никогда не тратит деньги»: Kimi Extra Usage и MiniMax credit
packs могут иметь настройки расхода на стороне провайдера. Это отличается от
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
Если разрешён только loopback handoff, capabilities декларируют manual callback URL:
после входа пользователь один раз вставляет URL в тот же диалог, как в нынешнем
Codex browser flow. Нет локального daemon, инструкции «настройте OAuth app» и
поля provider URL. Если ни один легитимный browser handoff не подтверждён, профиль
остаётся disabled; не подменять его cookie import.

Genuine device authorization - отдельный последующий slice, если browser handoff
неудобен или недоступен. [Discovery xAI](https://auth.x.ai/.well-known/openid-configuration)
подтверждает RFC8628 endpoints, но source SSO-cookie device converter не является
готовым публичным begin/poll. В первом UI не рекламировать неподдержанный device method.

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
Grok:                 Provider → Continue with Grok → return / one callback paste
```

- Расширить `AccountsAddDialog`/`AccountGatewayControls`, не создавать по странице
  на provider. Select использует capabilities; API-key-only provider не показывает
  переключатель OAuth/API key. Grok имеет одну основную кнопку входа.
- В key форме одно password-поле, ссылка «Get key», необязательное имя с готовым
  значением. Region появляется только при нескольких квалифицированных вариантах,
  без Base URL и protocol выбора. Existing owner default/personal sharing policy
  сохраняется; не добавлять новый ownership wizard и не делиться аккаунтом молча.
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

Сначала координатор фиксирует минимальные DTO/ports и leaf registration shape.
Это короткий общий checkpoint, не ожидание завершения всех adapters. С первого
дня независимые lanes исследуют entitlement/fixtures и пишут provider leaves на
согласованных interfaces; UI работает с typed fixture capabilities.

| Lane / ownership               | Изолированная работа                                                                                                          | Зависимость для интеграции                                                                         |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| A: общий контракт и интеграция | SDK schemas/capability endpoints, native private ports, registry roots/config, RR composition; отдельный limits-v2 checkpoint | Один writer общих authority/config/lock/schema файлов. Сохраняет legacy flows.                     |
| B: Kimi                        | Kimi qualified leaf, request/response fixture, key auth и Kimi quota parser                                                   | Подключается к A; eligibility и quota schema отмечаются отдельно.                                  |
| C: GLM                         | GLM Chat bridge leaf, credentials/credits fixtures, eligibility                                                               | Подключается к A независимо от B/D/E; отсутствие eligibility блокирует activation этого профиля.   |
| D: MiniMax                     | M Plan leaf, current usage endpoint/parser fixtures, Subscription Key checks                                                  | Подключается к A независимо от B/C/E.                                                              |
| E: Grok                        | Browser client/redirect qualification, durable OAuth/principal/refresh, finite transport и passive limits                     | Начинается одновременно с B/C/D; не ждёт их merge.                                                 |
| F: RR UI / browser E2E         | Existing dialog/panels, provider-specific copy/icons, mocked capability adapter и browser scenarios                           | Сначала fixture A, затем installed SDK и реальные backend adapters. Не редактирует registry roots. |

Каждый lane имеет отдельный worktree/branch и ownership. Provider definitions и
tests находятся в собственных leaf modules. Общую регистрацию, schema exports,
shared fixtures и package versions вносит A из reviewed lane patches, чтобы три
исполнителя не переписывали один registry. Никто не откатывает чужие изменения.

Тяжёлые build/PG/browser/joined проверки выполнять на hosted workers в изолированных
каталогах, портах и DB/container identities. Проверять свежие ресурсы и host identity;
нет искусственного single-heavy-job lock. Не создавать новые пользовательские чаты
вместо подзадач. Fixtures и scratch держать в ignored `tmp/`.

### Порядок merge и поставки

1. **A1:** versioned connection capabilities + минимальная registry normalization;
   миграция текущих четырёх providers на тот же безопасный contract.
2. **A2:** limits v2/collector boundary с отдельной совместимостью v1. Если numeric
   quotas ещё не квалифицированы, это не задерживает проверенный auth/transport slice.
3. **B/C/D:** каждый provider отдельным согласованным native/Gateway/RR vertical slice;
   первый готовый включается для квалифицированного scope без ожидания остальных.
4. **E:** Grok enrollment/refresh checkpoint, затем protected transport/limits;
   до второго checkpoint публично не объявлять полноценный working review provider.
5. **F:** UI может merge раньше с capabilities выключенными; включение profile
   только после installed consumer + native joined proof и controlled live canary.

PR примерно до 2 000 changed LOC; связный инвариант не разрезать ради цифры.
Основание стека мержить без потери ancestry либо своевременно перестраивать
потомков и проверять новый exact head. Не выпускать один mega-PR на все четыре.
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
| Owner/privacy         | Personal owner в workspace видит собственную quota; другие admin/member - нет. Отзыв membership/binding/revision во время await скрывает результат. Existing PG-test использует canonical detach + exact ACK, не raw state update.                                                                                                                  |
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
Quota fixtures и browser screenshots не являются доказательством настоящего входа
или provider transport: в отчёте сохранять эти границы явно.

До production activation каждого provider: допустимый intended use, один явно
тестовый реальный account, exact qualified model, контролируемый минимальный
request/tool cycle и нужный refresh/reconnect/erase proof. При ambiguous effect
не повторять провайдерский POST. Не создавать новые GitHub repos на каждый прогон;
reuse existing disposable repo. App-first публикация остаётся авторством GitHub App.

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

Genuine Grok device flow, если понадобится отдельным slice, добавит примерно
450-900 LOC с тестами. Нельзя маскировать эту неопределённость обещанием простого
переноса Vue формы или готового hosted redirect.

Первый технический checkpoint готов, когда новый профиль проходит protected
enrollment, установленный SDK, один model/tool review, safe lifecycle и browser UX.
Отдельный статус production enabled требует eligibility и live qualification.
Пустая квота не мешает рабочему review, но не объявляется работающей numeric feature.

Поставка следует [release source of truth](../operations/07-environments-and-release-management.md).
Текущий production HOLD на общий cutover не обходить ради подключения провайдера;
план не поручает менять миграционную authority, stable tags или обходить protection.
Выполнение этого документа начинается отдельным поручением на реализацию.

## 11. Источники, требующие проверки в начале provider lane

- [Kimi endpoint/model/client identity](https://www.kimi.com/code/docs/en/),
  [тарифы и окна](https://www.kimi.com/code/docs/en/kimi-code/membership.html).
- [GLM integration/endpoints](https://docs.z.ai/devpack/tool/others),
  [ограничения tools и quota](https://docs.z.ai/devpack/faq),
  [Coding Plan overview](https://docs.z.ai/devpack/overview).
- [MiniMax M Plan, usage URL и billing](https://platform.minimax.io/docs/m-plan/faq),
  [подключение других tools](https://platform.minimax.io/docs/m-plan/other-tools).
- [xAI OAuth discovery](https://auth.x.ai/.well-known/openid-configuration),
  [auth/proxy/enterprise](https://docs.x.ai/build/enterprise),
  [subscription OAuth в стороннем tool](https://x.ai/news/grok-kilocode).

До qualification не считать docs/catalog entry доказательством actual account
entitlement, работоспособности модели или согласованности старого native parser.
