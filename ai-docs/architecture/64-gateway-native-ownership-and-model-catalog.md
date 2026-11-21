# Account Gateway как обёртка над Sub2API: владение логикой и каталог моделей

Статус: план и реализация в одной поставке (три PR); production-активация не входит.
Дата: 2026-11-16. Продолжает [63](63-coding-plans-and-grok-implementation-plan.md).
Версия плана 3: учтены три независимых ревью (архитектура, безопасность dispatch, повторная проверка пути запроса).

## 1. Принцип (правило для всех агентов)

Account Gateway - тонкая обёртка над Sub2API. Логика провайдера живёт в одном месте.

| Слой         | Репозиторий                         | Владеет                                                                                                                          | Не делает                                                                                      |
| ------------ | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Native       | `agent-teams-ai/sub2api-standalone` | HTTP к провайдеру, парсинг, протокольные codecs, квалифицированный каталог моделей, admission запроса, custody-расшифровка ключа | -                                                                                              |
| Gateway      | `agent-teams-ai/account-gateway`    | Контракты, identity, fences, лимиты, политика                                                                                    | Свои HTTP-вызовы к провайдерам, копии каталогов, парсеры                                       |
| ReviewRouter | этот репозиторий                    | Потребление контрактов Gateway, UI, review-конфиг                                                                                | В режиме Gateway: знание URL и протоколов провайдера; список моделей профиля (его даёт native) |

Правила:

1. Нужна возможность провайдера - сначала искать готовое в Sub2API (`pkg/*`, `service/*`) и вызывать его. Нового кода провайдера вне native не писать.
2. Если в native нет - расширять форк, а не обходить в Gateway или RR.
3. Один факт хранится один раз. Список моделей профиля - одна таблица в native; Gateway и RR получают его через контракт.
4. Модель попадает в каталог только при подтверждении, что она входит в план (документация провайдера или реальная квалификация). «Провайдер вернул её в `/models`» подтверждением не считается.

Область правила - подключения через Account Gateway. За RR остаются repository/model policy и run admission (контракт [53](53-account-gateway-implementation-contract.md)). Известные исключения вне этого правила: прямой режим `kimi_code_api_key` (`review-configuration.ts`, `provider-catalog.ts`) хранит модель `k3-256k` в самом RR; публичный каталог моделей (`public-model-catalog.ts`) читает `models.dev` и OpenRouter для описаний и цен; RR знает семантику reasoning для MiMo и Codex. Новых таких мест не добавлять.

## 2. Что показало исследование

- Sub2API умеет живой `GET /models` по ключу аккаунта (`service/upstream_models.go`, `SyncUpstreamModelCatalog`) и метаданные `models.dev`. Это путь обычных admin-аккаунтов.
- В защищённом пути Gateway образцы разные: OpenRouter - публичный `/models` без ключа; Codex - живой `GET /models` с расшифровкой OAuth-токена внутри native (`native_gateway_account_models.go`); NVIDIA - каталог, зафиксированный в native (`readNVIDIABuildAccountModels`). Для API-key планов подходит последний образец.
- Почему не живой `/models` для планов с ключом: (а) правило 4 - ответ `/models` не доказывает принадлежность модели к плану; (б) нужны платные ключи, а реальных запросов к платным планам мы не делаем; (в) ключ API-key профиля сегодня расшифровывается только на границе dispatch (`custody.authorization`) и в сборщике квоты; чтение каталога ключ не расшифровывает, и это свойство сохраняем.
- Состав планов по документации провайдеров (проверено 2026-11-16 по официальной документации провайдеров):
  - GLM Coding Plan: «All plans support GLM-5.3» и GLM-5.3-Flash; запросы GLM-5.2/5.1 перенаправляются на GLM-5.3 (`docs.z.ai/devpack/overview`). ID `glm-5.3` используется самим Sub2API (`billing_service.go`, `useModelWhitelist.ts`).
  - MiniMax M Plan: из текстовых - «M3.1 Flash» на всех уровнях (`platform.minimax.io/docs/m-plan/faq`). Прочие M-модели относятся к PAYG.
  - Kimi Code, Grok subscription: подтверждения состава сверх квалифицированной модели нет.
- Вывод: реально расширяется только GLM (`glm-5.3` рядом с якорем `glm-5.3-flash`). Kimi, MiniMax, Grok и NVIDIA остаются с одной моделью и не получают нового пути отказа.

## 3. Решение

### 3.1 Native (`agent-teams-ai/sub2api-standalone`, `backend/internal`)

Новый файл `service/native_gateway_model_catalog.go`:

- `gatewayCodingPlanModelIDs(profile)` возвращает свежий срез моделей только для профилей с более чем одной квалифицированной моделью (сейчас GLM: `glm-5.3-flash` (якорь, первым), `glm-5.3`); для остальных - `nil`, допустим только якорь. Функция вместо глобальной `map`, чтобы allowlist нельзя было расширить снаружи.
- `GatewayCodingPlanCatalogProfile(profile)`: у профиля каталог больше якоря (это и есть «профили с каталогом» в таблице ниже).
- `GatewayCodingPlanModelAdmitted(profile, model) bool`: профиль с каталогом - членство; иначе - равенство якорю из существующих констант.
- Общий статический reader: вынести тело `readNVIDIABuildAccountModels` в `readStaticCatalogAccountModels(ctx, in, before, source, models)`; профиль берётся из `in.ProfileID` и сверяется с `before.Profile`. NVIDIA вызывает его со своим литералом и `source: "nvidia"` (поведение не меняется), GLM - с `source: "native_catalog"`. Ключ не расшифровывается, кэша нет, `ExpiresAt` = `FetchedAt` + 1 минута, как сейчас.

Места привязки модели (проверены ревью), все должны использовать одну функцию:

| Место                                                                                                                                            | Правка                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `service/native_gateway_provider_responses.go:136-147` (`ValidateGatewayNativeProviderResponsesBounded`/`gatewayNativePrepareProviderResponses`) | три `case` с константами заменить вызовом `GatewayCodingPlanModelAdmitted`                                                                                                                                                                                                      |
| `service/native_gateway_identity.go:299` (admission `forwardGatewayRoute`)                                                                       | равенство `body.model == route.Model` для профилей с каталогом заменить `GatewayCodingPlanModelAdmitted`; `GatewayNativeAPIKeyProfileValid(route...)` остаётся (якорь)                                                                                                          |
| `gatewaytransport/http.go:111,122-126`                                                                                                           | для профилей с каталогом читать `model` из payload (как Codex/OpenRouter) и проверять `GatewayCodingPlanModelAdmitted` до `h.reserve`; это значение идёт в `requestedModel`, то есть в метку usage. `wire.go:310` не меняется: он сравнивает с уже проверенным `requestedModel` |
| `native_gateway_identity.go:379-381` и финальная граница (~499-518)                                                                              | заполнить `state.requestedModel` для профилей с каталогом и перепроверить каталог и совпадение `model` payload до `custody.authorization`                                                                                                                                       |
| `GatewayAccountModelsReader.Read`                                                                                                                | ветка GLM: static reader                                                                                                                                                                                                                                                        |

Не менять (там остаётся якорь): `identity.go:71-75` (`SameGatewayNativeDescriptor`), `:203` (`Extra[GatewayModelExtraKey]`), `http.go:104`, `registry.go:280`, `gatewaybootstrap/config.go:273`, `handler/admin/native_gateway_identity.go:102-105`, `GatewayNativeCodingPlanProfileValid`. Тест: `GatewayNativeCodingPlanProfileValid(glm, url, "glm-5.3")` остаётся `false` (якорь - только flash).

### 3.2 Gateway (`agent-teams-ai/account-gateway`)

- `accountModelDiscoveryProfiles`: добавить только `glm-coding-global-responses-apikey-v1`, `source: "native_catalog"`. Kimi и MiniMax не добавляем: у них нет второй модели, а discovery добавила бы им чтение каталога на каждый запрос и режим отказа при `unknown`.
- `accountModels`: ветка `source: "native_catalog"`; capability строгая: `reasoning: z.null()`, `fast: z.null()`, `tools` только `function` (native отклоняет любой не-null `reasoning` для coding plans), `models` с `.max(8)`.
- `providerConnectionRegistry` не меняем: список моделей приходит из снимка, якорь остаётся в реестре как есть. Вторую копию списка не заводим.
- Типы: `accountModelDiscoverySource` и параметр `modelSource` в `validateResponses` расширить единым типом `AccountModelSource`; набор строгих request-полей по-прежнему только `openrouter`/`nvidia`.
- `accountModelAdmission`: поведение не меняется (при `unavailable` только якорь, при `unknown`/`unsupported` пусто) - зафиксировать тестом.
- Публичный путь `native-authority.ts:891-902` (`#publicRequestedModel`) пинит якорь только для профилей без discovery; добавление GLM в discovery снимает это ограничение, правок кода там нет.
- Joined E2E `test/native-provider-joined.ts` не расширяем: его Go-fixture принимает для GLM только якорь, usage-store в нём не подключён. Тот же путь (настоящий gatewaytransport, custody, local TLS provider) покрыт `internal/gatewaytransport/transport_test.go`, а выбор модели по снимку - тестами Gateway.

### 3.3 ReviewRouter

- Vendored tarball `@agent-teams/account-gateway`: обновить во всех потребителях (`apps/web`, `apps/api`, `packages/features/provider-usage`), `pnpm-lock.yaml`, `vendor/account-gateway/README.md`. Имя архива должно соответствовать `conversation-sdk-identity.ts` (`agent-teams-account-gateway-0.1.0-nvidia-<sha>.tgz`), provenance - `vendor/account-gateway/nvidia-sandbox-sdk-provenance.json` с контрактом `nvidia-sandbox-sdk-provenance/v1`; прежний provenance сохраняется как `nvidia-c32ef9ed3360-sdk-provenance.json`. Заново выпустить `conversation-source-stamp.json` и `conversation-verifier` (`scripts/check-conversation-source-stamp.ts --write`, `check-conversation-release-verifier.ts --write`). В архив войдёт и `0997416 fix(llm): preserve incomplete status`; по нему прогнать тесты потребителей `llm`.
- Архив собран `pnpm pack` из слитого коммита Gateway (две независимые сборки дали одинаковые байты). Постоянного CI-задания, которое выкладывает архив SDK, в Gateway нет, поэтому `artifactRun` в provenance остаётся `null`, а происхождение подтверждается коммитом слияния и воспроизводимой сборкой.
- Тип `AccountModelCatalogView.source` (расширен `AccountModelSource`) и `provider-model-options.ts`: ожидаемый источник брать через `accountModelDiscoverySource(...)` (как `gateway-model-account-options.ts` и `dashboard-provider-setup-readiness.ts`), собственный маппинг provider -> source удалить; в `gateway-model-account-options.ts` снимок без известного апстрима (нет `connection` и нет codex/nvidia/openrouter) превращается в `unknown`, а не в OpenRouter.
- `apps/api/src/provider-usage-provider.ts`: `native_catalog` называет владельца списка, а не вендора, поэтому usage по GLM остаётся `unknown`, как до каталога; иначе отчёты прогонов, идущих во время деплоя, получили бы `usage_scope_mismatch`.
- Тесты: каталог GLM в выборе модели; checkout и readiness для GLM на `snapshot`, `unavailable`, `unknown`.

### 3.4 Документы

Этот файл - единый источник; в корневых документах трёх репозиториев - короткий принцип со ссылкой (RR `AGENTS.md`, Gateway `AGENTS.md`, native `ACCOUNT_GATEWAY_OWNERSHIP.md`, так как `AGENTS.md` в форке в `.gitignore`). В [63](63-coding-plans-and-grok-implementation-plan.md) - указатель сюда.

## 4. Вне объёма

- Живой `/models` с ключом пользователя.
- Каталоги для Kimi, MiniMax, Grok, NVIDIA: пока нет подтверждённых дополнительных моделей; код NVIDIA меняется только выносом общего reader.
- Reasoning/fast для `glm-5.3`: `null`. Когда понадобится, строить на готовых `isGLM53Model` и `normalizeGLMOpenAIReasoningEffort` в Sub2API.
- Выкладка на prod, native-бинарь и сервис: отдельный шаг по deployment registry.
- Реальные запросы к провайдерам.
- Перенос принципа в общий Engineering Quality Standard организации (`agent-teams-ai/.github`): предложить отдельно.

## 5. Порядок поставки и раскатки

Слияние: native -> Gateway -> RR (архив SDK собирается из слитого коммита Gateway).
Деплой: native -> Gateway -> RR, с проверкой между шагами. Если Gateway с discovery GLM выкатить раньше native, старый native отвечает `unsupported`, `accountModelAdmission` даёт пустой список, и запросы GLM (включая якорь) отклоняются. Kimi, MiniMax и остальные профили не затронуты. Если выкатить RR раньше Gateway, GLM тоже ломается, включая якорь: при любом статусе каталога, кроме `unavailable`, UI показывает 0 моделей, а checkout отказывает. Откат идёт в обратном порядке: RR, Gateway, затем native.
Смена SDK меняет `conversation-source-stamp`: действующая `REVIEW_ROUTER_CONVERSATION_QUALIFICATION` версии 2 перестанет совпадать, и full-thread conversations через Gateway выключатся до повторной квалификации. Деплой RR с этим архивом согласовывать вместе с повторной квалификацией. На момент написания на prod 0 подключений GLM и 0 ревью через GLM, поэтому влияние на пользователей GLM нулевое.

## 6. Проверка без платных ключей

- Native Go (`-tags unit`): снимок GLM из двух моделей; `glm-5.3` допущена на admission, transport и финальной границе, `glm-5.2` и произвольная - нет; Kimi/MiniMax - только свой якорь; NVIDIA без регрессии (существующий тест); `ProfileID` GLM при маршруте NVIDIA - `unavailable`; смена owner/generation/credentials между чтениями - `unavailable`; usage помечен фактической моделью.
- Gateway: contracts (`native_catalog`, `reasoning` не-null отвергается), `models-port`, joined E2E.
- RR: см. 3.3.
- Профиль на prod остаётся за env-фильтром `REVIEW_ROUTER_ACCOUNT_GATEWAY_SUBSCRIPTION_PROFILE_IDS`.

## 7. Риски

- `glm-5.3` не подтверждена живым прогоном с реальным ключом: допущение опирается на документацию Z.ai и ID из Sub2API. После входа в провайдера любой HTTP 4xx Gateway трактует как `ErrGatewayNativeEffectUnknown`, а не как чистый отказ; лимиты плана расходуются на стороне провайдера.
- Протокол проверялся для профиля, а не для каждой модели: native запрещает replay reasoning с `content` для GLM. Если `glm-5.3` отдаёт такие items, многоходовые ревью будут отклоняться на input admission. Mitigation: fixture-тест `glm-5.3` по тому же wire-пути; флаги протокола на уровне модели добавлять только при реальной необходимости.
- У якоря GLM появляются новые режимы отказа: каждый запрос читает каталог (в facade и в native-authority, по два authority-callback), сбой чтения даёт `unknown`, а `unknown` допускает 0 моделей, включая якорь. Каталог читается через management-слот native (бюджет 8, при переполнении 503). Наблюдать долю `unknown` и 503 после включения. Это то же поведение, что у Codex, OpenRouter и NVIDIA, а подключений GLM на prod сейчас нет.
- Три репозитория и vendored пакет: поставка идёт тремя PR по очереди.
- Overage у планов настраивается на стороне провайдера (см. 63); каталог его не расширяет.
