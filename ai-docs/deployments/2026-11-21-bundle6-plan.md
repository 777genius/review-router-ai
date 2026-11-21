# План шестого пакетного выката: native `14f500eb`, Gateway 116, ReviewRouter `9c52c250` (#914, миграция 000160)

- Task ID: `2026-11-21-bundle6-plan`
- Статус: **план, ничего не выкачено**. Это процедура для будущего выката по
  решению владельца, а не разрешение на него.
- Основание плана и приведённые ниже версии и замеры — снимок расследования
  21 ноября. Перед любым применением заново сверить состояние прода, состав
  пакета, зависимости, миграции и проверки точного целевого SHA; этот снимок
  не подтверждает текущее состояние или готовность более новых изменений.
- Цель: одним пакетом выкатить работу по сведениям нативных аккаунтов и новым
  способам подключения ([#914](https://github.com/777genius/review-router-ai/pull/914),
  `9c52c250`), её producers в native и Gateway, и всё, что к этому моменту
  смержено и не выкачено. Порядок: Caddy allowlist -> native -> Gateway ->
  ReviewRouter (миграция, затем образ). Публичный Action не выпускается.
- Состав (подробно и с доказательствами в разделе "Компоненты"):
  - native `14f500eb4db78b47b5d028a8a811ec62b348ac92` (sub2api #103 поверх
    прода `f10a3801`), Go 1.27.3, нативные миграции 260, 261, 262;
  - Gateway 116: `account-gateway` main `44bf7ae0` (runtime равен `be63f2e0`,
    #116), без миграций и без новых зависимостей;
  - две строки allowlist в Caddy management site (`/v1/account-info/read`,
    `/v2/provider-connection-capabilities`), через `apply-domain.sh`;
  - ReviewRouter на всех четырёх ролях: `a02b1607` (bundle 5) + #914
    (`9c52c250b279f81470703b35fae0e787880a08ea`, миграция
    `000160_personal_credential_import_method`). Пока план писался, в `main`
    вошли #955 (`9f11eec1`, 15:11 UTC) и #958 (`91c14404`, 15:12 UTC), без
    миграций; по рекомендации D5 образ строится из текущего `main` после его
    зелёного CI. Всё про миграцию и совместимость ниже относится к #914.
- Покрывает task record
  [native account info imports](2026-11-19-native-account-info-imports.md).
- Не входит: публичный Action (не нужен), FILE/producer/`workflow-v1` (не
  меняются), апстрим-синк native `2d5f681a` (см. решение D1), активация
  профилей Anthropic/Gemini (решение D4), Hindsight derivative из #914,
  публикация SDK в registry.
- Last updated: `2026-11-21`.

## Вердикт

План подготовлен; выкат запрещён до закрытия всего списка go/no-go и свежей
сверки состава с целевым SHA и фактическим окружением. В частности, остаются:

1. Caddy allowlist management site. Сейчас он отвечает `404` на оба новых пути
   SDK. Новый Web читает `/v2/provider-connection-capabilities` на каждом
   открытии Connections и без 404-fallback, поэтому без этой правки после
   замены образа страница подключений сломается у всех.
2. Операторы native/Gateway для этого окна: это **не** "только константы", как
   в bundle 3. Нативный оператор 105 проверяет ровно 318 строк ledger и
   говорит "no backup or migration"; здесь нужен оператор по образцу
   `gateway106-native95-20261114` (остановленный дамп, `ApplyMigrations`,
   ledger 318 -> 321). Нужен независимый ревью оператора и dry run.
3. Решения владельца D1-D5 (ниже). Рекомендация: native `14f500eb`, импорт
   Codex включается сразу (флагов нет), откат образа/Gateway/native возможен
   только до первой операции импорта.

Плюс условие по времени: окно отката bundle 5 должно быть закрыто (открытый
вопрос про `invalid_response` на `sdk_request` на 245, см. go/no-go), иначе
изменения Gateway 116 и вопрос bundle 5 будет не развести.

Миграция 000160 нужна и безопасна (33 строки, 176 kB, бэкфилл не нужен,
старый образ с ней работает). Подробно ниже.

## Состояние окружений

| Target                                          | Сейчас (2026-11-21 13:25-13:50 UTC)                                                             | Цель bundle 6                                                                  |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| production native                               | native 105 `f10a3801`, бинарь `d6ecc3d2`, `native-ttl-f10a380-20261120`, ledger 318             | native `14f500eb`, ledger 321 (260, 261, 262)                                  |
| production Gateway                              | Gateway 115 `gateway115-1dce5c3-native102-20261117`, активен с 2026-11-20 07:00:50, 0 рестартов | Gateway 116 из `44bf7ae0` (runtime = `be63f2e0`)                               |
| Caddy management site                           | `review-router-account-gateway-management.caddy` SHA256 `b827c750`, без двух новых путей        | те же правила + `/v1/account-info/read` `/v2/provider-connection-capabilities` |
| production database                             | ledger 168 (последняя `000159`), 0 незавершённых                                                | ledger 169 (`000160`)                                                          |
| production API/Web/worker/scan                  | `a02b1607`, образ `sha256:8d9dd8f3`, FILE 73, refs `e0e5f8fa` (245)                             | `9c52c250`, FILE 73 и refs 245 без изменений                                   |
| public Action / FILE / producer / `workflow-v1` | `v1.0.245` = `v1` = `workflow-v1` = `e0e5f8fa`, FILE 73, producer 245                           | без изменений                                                                  |

## Базовая линия (read-only, 2026-11-21 13:25-13:50 UTC)

Все SQL шли в `BEGIN READ ONLY; SET LOCAL TIME ZONE 'UTC'; ... ROLLBACK`.
Секреты не печатались: `service.json`, `config.before` и значения env не
читались, токены оставались внутри контейнера.

- Роли: четыре контейнера на `8d9dd8f3` (ревизия `a02b1607`), старт
  12:31:42, 0 рестартов. На ролях нет `REVIEW_ROUTER_CONVERSATION_QUALIFICATION`
  и `REVIEW_ROUTER_GATEWAY_INTERACTION_RUNTIME_SHA` (проверены только имена
  ключей), поэтому смена `conversation-source-stamp.json` в #914 ничего не
  требует. Web уже имеет `REVIEW_ROUTER_ACCOUNT_GATEWAY_MANAGEMENT_ORIGIN/TOKEN`,
  нового env #914 не вводит.
- Native: процесс `native-ttl-f10a380-20261120/bin/account-gateway-native`,
  SHA256 `d6ecc3d2633a44dc`. БД `ag_service_entry_native_484307d1867ab37b69a3d388adb9dc29` в
  контейнере `review-router-account-gateway-pg17-484307d1867ab37b69a3d388adb9dc29` (PostgreSQL
  17.10): 19 MB, ledger 318 (последний `259_gateway_nvidia_build_chat_profile.sql`),
  28 аккаунтов (13 живых), `usage_logs` 0 строк, 17 OAuth connect intents
  (только `browser`/`device_code`: 5 completed, 4 expired, 8 unknown),
  таблиц 260 ещё нет.
- Gateway kernel (`ag_service_entry_kernel_484307d1867ab37b69a3d388adb9dc29`, схема `ag_kernel`): 13 active,
  4 disabled, 9 quarantined аккаунтов; 12 операций `unknown` (9 create,
  3 reconnect, исторические); операций с `credentialImportMethod`: 0.
- RR БД: 1 778 MB, 11 соединений, долгих транзакций нет; ledger 168; 70
  registered и 132 revoked producers. `PersonalAccountOperation`: 33 строки,
  176 kB; 7 зависших `connect/oauth-begin/submitted` (2026-10-20 ... 2026-11-10),
  последняя активность 2026-11-16 23:22; строк с `ingress='credential-import'`
  0; колонки `credentialImportMethod` и функции
  `rr_personal_credential_import_guard` нет. Права у `reviewrouter_api/web/worker`
  табличные (`SELECT, INSERT, UPDATE, DELETE`), значит новая колонка покрыта
  без новых GRANT.
- pgBackRest: последний full `20261121-054806F` (error=false); таймер каждый
  день около 04:48 UTC.
- Capabilities v1 через установленный SDK из Web (только id и форма, без
  секретов): 8 профилей (`openai-responses-apikey-v1` MiMo, OpenRouter, Kimi,
  GLM, MiniMax, NVIDIA, Codex OAuth, Grok), SHA256 ответа
  `73728bd50fe1457e`. Это эталон для сравнения после Gateway 116.
- Caddy: живой management файл равен `gate4-20261120/caddy-management-original`
  (`b827c750`), `review-router.caddy` равен `caddy-original` (`d9c2b239`).
  Прямой запрос к `/v2/provider-connection-capabilities` через этот site
  возвращает `404` с пустым телом, то есть ответ Caddy, а не Gateway.
- `apply-domain.sh` на хосте (SHA256 `24b22dbc`, 4 409 байт) отличается от
  `777genius/platform-infra:deploy/review-router/apply-domain.sh`
  (`9f32a88c`, 4 170 байт) строкой 90 (и лишней пустой строкой в конце): в репозитории нет восьми путей
  capabilities/limits/models, которые прод уже использует.
- Владелец всех 119 таблиц native и роль, под которой native работает: `rr_dmin`
  (сессия native идёт под ней же).
- Диск прода: 34 GB свободно (97 %), 246 образов. Worker host: 19 GB свободно.

## Компоненты: что, откуда и как (вопрос 1)

### Native

- Прод: `f10a3801` (#105). Первые родители `main` в
  `agent-teams-ai/sub2api-standalone`: `f10a3801` -> `14f500eb` (#103,
  сведения аккаунтов и импорты) -> `2d5f681a` (standalone #1, синк апстрима
  Wei-Shaw).
- `f10a3801..14f500eb`: 1 коммит, 95 файлов, +6 719/-328, миграции 260-262,
  `go 1.27.3` в `backend/go.mod`. Дерево `14f500eb` (`7020bcf7`) **равно**
  дереву `af418a6a` (проверено `git rev-parse ^{tree}`), на котором прошли
  шестипровайдерная квалификация #914 ("Gateway c5 / RR901 / Native af418") и
  CI Gateway #116. CI Gateway #117 (`NATIVE_COMMIT: 14f500eb`) тоже зелёный.
- `14f500eb..2d5f681a`: 930 файлов, +68 291/-4 661, ещё 5 миграций апстрима
  (249 `CREATE INDEX CONCURRENTLY` на `usage_logs`, 250, 251 x2, 252), `go 1.27.4`
  (апстрим-коммит `202e23b2`), изменения в OpenAI/Codex/Grok/scheduler
  inference-пути. Квалифицирован только CI Gateway #118 (native clients и
  full-stack/load на `2d5f681a`, зелёные), шестипровайдерным RR-прогоном не
  проверялся.
- Для #914 нужен только `14f500eb`. Рекомендация: native `14f500eb` в этом
  пакете, апстрим `2d5f681a` отдельным native-only выкатом (решение D1).
- Сборка на worker host, как native 105 (bundle 3): официальный
  `go1.27.3.linux-amd64.tar.gz` (SHA256 `65efbc80`, совпадает с go.dev),
  `go mod verify`, `CGO_ENABLED=0 -trimpath -ldflags='-s -w' ./cmd/account-gateway`,
  две сборки с раздельными кэшами дают одинаковые байты; `go test -tags unit`
  для `internal/gatewaytransport` и Gateway/native/NVIDIA/catalogue/chat/stream/
  OpenRouter/models/account info/import тестов `internal/service`. Бинарь
  кладётся root-owned в
  `/srv/platform/artifacts/review-router/account-gateway/releases/native-info-14f500e-<дата>/bin/account-gateway-native`.
- Toolchain 1.27.3 выбран потому, что на нём собраны native 105 и
  квалифицированное дерево; `go 1.27.3` в `go.mod` допускает и сборку 1.27.4.
  Не проверял, есть ли в 1.27.4 исправления безопасности; если есть, собрать
  `14f500eb` на 1.27.4 из custody ниже (тесты те же).
- Если владелец выберет `2d5f681a`, цифры процедуры другие: toolchain из
  `/srv/workers/TEST-sub2api-deps-20261121/toolchain/go` (`go version go1.27.4`,
  tarball SHA256 `7226736c2339719c` равен `go-expected.sha256`); ожидающих
  миграций 8, а не 3 (`249_add_usage_logs_api_key_cost_index_notx.sql`, `250_*`,
  два `251_*`, `252_*` по имени идут раньше 260), одна из них `_notx`
  (`CREATE INDEX CONCURRENTLY` на пустой `usage_logs`), ledger 318 -> 326.
  Оператор и no-go тогда считают 326 и 8 файлов. Готовый
  `account-gateway-native-main2d5f681` (86 814 880 байт) там же **не
  использовать**: флаги и воспроизводимость не записаны, собрать заново дважды.
  Остальная часть плана написана для `14f500eb`.
- Свап: как всегда, native выбирается только `native.executable` и
  `native.sha256` в `service.json` (Gateway release native не пинует). Новые
  поля конфига native (`anthropicApi`, `geminiApi`) `omitempty` и не нужны.
  Откат: вернуть `config.before`. БД native не откатывается (см. ниже).

### Gateway

- Прод: Gateway 115 = `1dce5c32`. В `main` после него: `be63f2e0` (#116,
  runtime), `8764ef4d` (#117, CI/доки), `44bf7ae0` (#118, CI/доки).
  `git diff --stat be63f2e 44bf7ae -- packages/account-gateway services/account-gateway/src`
  пустой, значит runtime и SDK у #116 и `main` одинаковые. Собирать из
  `44bf7ae0` (текущий `main`, его CI проверял и `2d5f681a`).
- Зависимости не менялись: `pnpm-lock.yaml` и `pnpm-workspace.yaml` между
  `1dce5c3` и `44bf7ae` без изменений, в `package.json` поменялись только
  списки тестов. Release tree строится как Gateway 112/115: дерево зависимостей
  gateway115, все tracked файлы равны merge tree, пересборка
  `packages/account-gateway/dist`, `test:domain` (с `test/account-info.test.ts`),
  `tests/account-info.test.ts`, `tests/account-models.test.mts`, manifest.
  Имя: `gateway116-44bf7ae-native14f-<дата>`.
- SQL-миграций в Gateway нет. Новое поле `credentialImportMethod` хранится в
  JSON intent операции (`services/account-gateway/src/postgres.ts`).
- Конфиг: новых обязательных полей нет; `/v1/account-info/read` разрешён
  ролям `management` и `consumer-control` (`facade.ts`), они уже есть.
- PR-проверки #116 (head `c5cc638a`), #117, #118 зелёные: package A,
  kernel B, pinned native clients, full-stack E2E и bounded load (7 lanes),
  CodeQL. На `main` после merge запускается только CodeQL.
- Деплой: остановить unit, сменить drop-in (WorkingDirectory и `serve.ts`) на
  release gateway116, `daemon-reload`, старт, `READY_FENCED`. Откат: вернуть
  `dropin.before`.

### SDK

- RR берёт SDK из репозитория, не из registry: `apps/web`, `apps/api` и
  `packages/features/provider-usage` указывают на
  `vendor/account-gateway/agent-teams-account-gateway-0.1.0-native-imports-f2690a3c9cfd.tgz`,
  целостность закреплена в `pnpm-lock.yaml`.
- SHA256 архива `34562d43668a1ca0` равен
  `vendor/account-gateway/native-account-info-sdk-provenance.json`; исходник
  `f2690a3c` по `packages/account-gateway` и `services/account-gateway/src`
  побайтно равен `be63f2e0` и `44bf7ae0` (пустой `git diff --stat`).
- Отдельный публичный релиз SDK **не нужен** ни для сборки образа, ни для
  работы.

### Образ ReviewRouter

- `git log a02b1607..origin/main` = только `9c52c250` (#914). Миграций в
  диапазоне одна, `000160`. Dockerfile, `deploy/hetzner`, ACL-генератор
  `scripts/run-codex-rotating-release-migration.mjs` и
  `scripts/check-runtime-db-privileges.mjs` не менялись. Код `apps/api` и
  `apps/worker` в #914 не менялся (только тесты), но API, worker и scan
  получают новый архив SDK (в нём, например, свои лимиты ответа по методам в
  `transport.ts`) и runtime `ar`, пересобранный TS 7. Основная смена в Web и
  пакете `provider-accounts`.
- Main CI на `9c52c250` (run 44877576086) зелёный целиком: Quality, Static,
  Source and Certification, DB Contract and Migration Checks, Self-hosted E2E,
  Dedicated Release Authority PG17, Managed migration PG17 (три варианта),
  **Full private PG16 to PG17 rehearsal**, Hosted runtime OCI build, Quality
  Gates; отдельно P115, C1, operator grants S, Memory.
- `@vioxen/subscription-runtime` переходит с `777genius/ar@83a7329f` на
  `c7543bc7` (ar #85, merge в ветку `chore/rr-runtime-83a-maintenance`,
  компиляция TS 7). В `action-dist/index.cjs` от этого поменялась одна строка
  notice, код бандла тот же.
- Сборка: `deploy/hetzner/release.sh build <целевой SHA>`: текущий `main` с
  #955 и #958 по D5 (сейчас `91c144044ca3c74d044303e19109ea3531b4dc6a`) или
  `9c52c250b279f81470703b35fae0e787880a08ea`.

### Action

- Не нужен. #914 меняет в `action-dist/index.cjs` только строку
  third-party notice. Публичный `main` = `c31f0adb` (автосинк от #914 поверх
  `e0e5f8fa`), отличие только в этом комментарии; `v1.0.245` его не содержит,
  digest producer manifest считается от `dist/index.js` и не меняется. FILE 73,
  producer 245, `v1` и `workflow-v1` остаются.

## Миграция 000160 (вопрос 2)

Файл: `packages/platform/db/prisma/migrations/000160_personal_credential_import_method/migration.sql`.

- Что делает (одна транзакция): `ADD COLUMN "credentialImportMethod" TEXT`
  (nullable, без default), пересоздаёт `PersonalAccountOperation_intent_shape`
  с единственным отличием от 000134: `ingress IN ('api-key-create',
'oauth-begin', 'credential-import')`; добавляет
  `PersonalAccountOperation_credential_import_shape`; функцию
  `rr_personal_credential_import_guard()` и триггер `BEFORE UPDATE`, который
  запрещает менять метод. Тот же шаблон, что у 000140 (`oauthMethod`), уже на
  проде.
- Данные прода: 33 строки, 176 kB. Ни одна строка не имеет
  `ingress='credential-import'`, значит обе CHECK выполняются для всех строк
  (новая `intent_shape` шире старой). Блокировка `ACCESS EXCLUSIVE` на 33
  строки занимает миллисекунды; риск только в ожидании чужой транзакции на
  этой таблице, поэтому migrate идёт в тихом окне (долгих транзакций сейчас 0).
- Бэкфилл не нужен: все существующие строки созданы до появления импорта,
  `NULL` для них верен по смыслу. Данные не переписываются.
- Старый образ после миграции (окно между migrate и swap, а также откат):
  Prisma читает и пишет явными списками колонок; raw SQL старого образа по
  этой таблице выбирает только `"id"` и условия (`git grep` по `a02b1607`),
  `SELECT *` нет; старый код не пишет `credential-import`, триггер срабатывает
  только при смене метода. Значит `a02b1607` работает на схеме 169, как
  `0c67c3e0` работал на 158/159 (rollout 2026-11-17).
- Обратимость: down-миграция не нужна и не делается (правило
  [release.sh](../../deploy/hetzner/README.md#rollback): миграции не
  откатываются). Точка восстановления: свежий pgBackRest full перед migrate.
- Нужна ли она: да. Личный журнал операций должен хранить выбранный метод,
  чтобы неоднозначный исход импорта восстанавливался без повтора обмена токена
  и чтобы intent импорта не совпадал с browser/device. Варианты без миграции
  хуже: положить метод в `oauthMethod` нельзя (CHECK `oauth_method_shape`
  допускает только `device_code`, старые читатели приняли бы импорт за
  browser/device); только `ingress` не покрывает reconnect (у reconnect
  `ingress IS NULL`); хэш intent необратим. Одна nullable колонка с
  неизменяемым значением - минимальная форма. Прослоек совместимости нет.
- ACL: `release.sh migrate` после миграции применяет canonical ACL нового
  образа; он отзывает у ролей EXECUTE на функциях, но триггерной функции это
  не нужно (так же работает `rr_personal_oauth_method_guard` из 000140).
- Граница отката: как только появится строка с `credentialImportMethod IS NOT NULL`,
  старый образ уже нельзя ставить: в `a02b1607` `toIntent`
  (`prisma-personal-account-operations.ts:49-52`) вызывает
  `snapshotPersonalIntent`, который отвергает всё кроме `api-key-create` и
  `oauth-begin` (`personal-account-operations.ts:78`), а reconnect-импорт
  (у него `ingress IS NULL`) старый код примет за обычный reconnect.
- Staging: правило базы данных в
  [release process](../operations/07-environments-and-release-management.md#database-release-rule)
  просит migrate и smoke на staging. Как и в выкатах 2026-11-17, его заменяют
  CI-репетиции на точном `9c52c250`: DB Contract and Migration Checks, Full
  private PG16 to PG17 rehearsal и Managed migration PG17.

### Нативные миграции 260, 261, 262

- 260: новая таблица `gateway_account_info_snapshots`, sequence, функция и
  триггер `AFTER UPDATE OF deleted_at ON accounts` (28 строк).
- 261: колонки импорта в `gateway_oauth_connect_intents` и пересоздание
  CHECK. Проверено на всех 17 строках прода: методы, redirect, device shape и
  новая `material_shape` выполняются 17/17; безымянный CHECK на
  `material_envelope` найден ровно один (`SELECT ... INTO STRICT` пройдёт);
  удаляемые именованные CHECK существуют.
- 262: `CREATE OR REPLACE FUNCTION gateway_native_account_guard()` с двумя
  новыми кортежами официальных API; для текущих профилей правила те же.
- Как применяются: **native-бинарь Gateway сам миграции не выполняет**
  (`backend/internal/gatewaybootstrap/server_linux.go:140` в `14f500eb`: "Never
  migrate native SQL"; раннер `applyMigrationsFS` вызывают только `InitEnt`
  в `repository/ent.go:139` и `setup.go:388`, то есть `cmd/server` и утилиты,
  не `cmd/account-gateway`). Поэтому оператор сам запускает
  `repository.ApplyMigrations` из исходника `14f500eb` (маленькая Go-программа
  в custody, как migrator native 95 с его `migratorHash`) на остановленном
  native под ролью `rr_dmin`. Это владелец 118 из 119 таблиц, функции
  `gateway_native_account_guard`, которую заменяет 262, и роль runtime
  native; право CREATE на схему `public` у неё есть (проверено read-only).
  До старта нового бинаря оператор требует ledger 321 и checksum трёх файлов;
  checksum в ledger считается от `strings.TrimSpace` содержимого
  (`migrations_runner.go:189-197`), не от байтов файла. Без этого `14f500eb`
  молча стартует на 318 и упадёт на первом чтении сведений или импорте.
  Раннер (`migrations_runner.go:176-231`) идёт по встроенным файлам и чужие
  строки ledger не проверяет; после миграции сверить, что новая таблица и
  sequence принадлежат `rr_dmin`.
- Каждый файл идёт в своей транзакции (`migrations_runner.go:258-259`). Если
  упадёт второй или третий, ledger останется 319 или 320 под gate. Не
  стартовать `14f500eb` и не снимать gate. Config ещё не переключён, Gateway
  остаётся 115, БД не откатывается. Старт native 105 и снятие gate допустимы
  только после проверки его совместимости с фактической частичной схемой;
  без неё разбирать причину и восстанавливаться вперёд под gate.
- Native 105 ledger не смотрит вообще, поэтому стартует на схеме 321; его SQL
  ожидаемо совместим (добавочные объекты, старые писатели удовлетворяют новым
  CHECK), но запуском не доказан. Проверка по желанию (30-45 мин, worker
  host): в одноразовой копии `f10a3801` положить три файла 260-262 из
  `14f500eb` в `backend/migrations/` (они встраиваются через `go:embed`) и
  прогнать интеграционные тесты репозитория 105 (`native_gateway_oauth*`,
  `native_gateway_account*`) на пустых одноразовых базах: тесты сами требуют
  пустую базу и применяют встроенные миграции, так код 105 проверяется на
  схеме 321. Если не сделано, откат native после миграции считается
  fix-forward под gate, как у native 95 (`gateway106-native95-20261114`);
  дамп до миграции хранится.
- Репетиция на копии (рекомендую, 15 мин, на прод-хосте): дамп native БД
  (19 MB) снять как `postgres` в контейнере PG17 (`pg_dump -Fc`; в 2026-11-01
  роль приложения не смогла прочитать одну таблицу), проверить
  `pg_restore --list`, восстановить в одноразовый PG17 без сети и прогнать там
  тот же migrator. Это проверяет и миграции на реальных строках, и дамп,
  который в окне B будет последней мерой. Одноразовую базу удалить сразу.

## Порядок и совместимость (вопрос 3)

### Почему native первым, а не последним

Заметка "deploy native LAST" относилась к 2026-11-17: native #101/#102
расширял границу ответа (до 512 моделей), и сначала должны были обновиться
потребители (Gateway 112 и SDK в RR). Здесь зависимость обратная:

- Gateway 116 отдаёт **и v1, и v2** capabilities из нового приватного пути
  native `/private/native/v1/account-capabilities`
  (`services/account-gateway/src/facade.ts:1586-1605`,
  `service-assembly.ts:297`, `native-client-discovery.ts:31-51`). Gateway 115
  строил v1 статически из своих профилей (`facade.ts:1534-1540` в `1dce5c3`).
- Старый RR (`a02b1607`) прощает в v1 только `404`
  (`apps/web/src/server/account-connection-catalog.ts:50-57` в `a02b1607`).
  Gateway 116 на native 105 получит `NativeFailure("invalid_readback")` вместо
  404, и страница Connections у старого RR сломается.
- Новый RR (`9c52c250`) читает v2 без fallback на v1 и без терпимости к 404
  (`account-connection-catalog.ts:141-153`), то есть ему нужен Gateway 116 и
  открытый путь в Caddy.

Итог: Caddy allowlist (в любой момент до замены образа) -> native -> Gateway ->
миграция 000160 -> образ RR. Откат строго в обратном порядке.

### Матрица

| Native     | Gateway | Caddy            | RR         | Результат                                                                                                                                                                                                                                                                                     |
| ---------- | ------- | ---------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 105        | 115     | старый или новый | `a02b1607` | Сегодняшнее состояние. Новые пути в Caddy никто не вызывает.                                                                                                                                                                                                                                  |
| `14f500eb` | 115     | любой            | `a02b1607` | Ожидаемо нормально, запуском не проверено: Gateway 115 не вызывает новые пути native; миграции добавочные; импорт не рекламируется (v1 Gateway 115 статический). Промежуточное состояние окна B и цель отката Gateway.                                                                        |
| 105        | 116     | любой            | любой      | **Сломано**: v1 и v2 capabilities падают, Connections недоступны. Не допускать; при откате сначала Gateway, потом native.                                                                                                                                                                     |
| `14f500eb` | 116     | любой            | `a02b1607` | Ожидаемо нормально, это промежуточное состояние и цель отката образа. Старый SDK получает v1-проекцию из native; v1-схема SDK в #116 не менялась, но совпадение проекции с прод-набором профилей запуском не проверено, поэтому сверка v1 с эталоном `73728bd5` по полям обязательна (шаг 2). |
| `14f500eb` | 116     | **старый**       | `9c52c250` | **Сломано**: v2 -> `404` от Caddy, Connections и Add provider падают у всех. Сведения аккаунтов (`/v1/account-info/read`) деградируют мягко (`account-metadata-service.ts:137`, `restricted`).                                                                                                |
| `14f500eb` | 116     | новый            | `9c52c250` | Цель. Codex показывает импорт RT и auth.json (create и reconnect), Anthropic/Gemini не показываются (не сконфигурированы в native).                                                                                                                                                           |
| `14f500eb` | 115     | любой            | `9c52c250` | **Сломано**: нет v2 в Gateway 115.                                                                                                                                                                                                                                                            |

Модели аккаунтов: новый SDK допускает `function_and_custom` для
`native_catalog`, но native отдаёт его только официальным API-профилям
(`native_gateway_model_catalog.go:73-81` в `14f500eb`), которых в проде нет,
поэтому старый SDK не получит незнакомого значения.

### Где откат перестаёт быть безопасным

Флага, выключающего импорт, нет (по правилу проекта новых флагов не делаем):
native рекламирует импорт Codex, если настроены OAuth connect и dispatch
(`native_account_capabilities_linux.go:13`, `native_gateway_account_capabilities.go:67`),
а RR пропускает его только для `openai-codex-oauth-responses-v1`
(`connection-capabilities.ts:88`). После первой операции импорта:

- образ `a02b1607` нельзя вернуть (см. 000160);
- Gateway 115 нельзя вернуть (JSON intent с `credentialImportMethod`);
- native 105 нельзя вернуть (intents `refresh_token`/`auth_json`).

Перед любым откатом проверить, что импортов не было ("три нуля"):

```sql
-- RR (review_router_dimy)
SELECT count(*) FROM "PersonalAccountOperation" WHERE "credentialImportMethod" IS NOT NULL;
-- Gateway kernel (ag_service_entry_kernel_484307d1867ab37b69a3d388adb9dc29)
SELECT count(*) FROM ag_kernel.operations WHERE intent ? 'credentialImportMethod';
-- native (ag_service_entry_native_484307d1867ab37b69a3d388adb9dc29)
SELECT count(*) FROM gateway_oauth_connect_intents WHERE method IN ('refresh_token','auth_json');
```

Считать при остановленных писателях, иначе между замером и откатом кто-то
успеет начать импорт: для Gateway и native под gate (admission закрыт), для
образа после остановки новых ролей и до старта старых (импорт пишет только
Web). Повторять все три проверки непосредственно перед каждым шагом отката
и удерживать соответствующую блокировку писателей между замером и действием.
Если её нельзя удержать, откат не выполнять. Все три `0`: откат по шагам
ниже. Иначе только fix-forward на
`9c52c250` или его потомке (граница reader из task record, `19ef44c0`).

Отношение к task record #914 ("reader first, writer later"): при выборе
рекомендации D2 отдельная фаза "читатель есть, импорт выключен" убирается, писатель
появляется вместе с читателем, до канарейки. То, от чего эта фаза защищала,
всё равно не случится: fleet-overlay останавливает все старые контейнеры до
старта любого нового
([fleet-overlay README](../../deploy/hetzner/fleet-overlay/README.md), строка 5),
а импорт пишет только Web, так что старый читатель рядом с новым писателем не
работает ни секунды. Это записано и в task record.

## Правило тихого окна

Строгое, как в bundle 5 (запись в [PR #956](https://github.com/777genius/review-router-ai/pull/956)): `busy=0` в 8 подряд
15-секундных замерах (живые executions, `in_progress` ReviewRouter-раны
репозиториев с execution за 3 дня, outbox, publication claims/attempts/
operations, completion processes по `createdAt`, progress publications,
investigation turns и leases); не в xx:07-xx:10; каждая сессия БД с
`SET LOCAL TIME ZONE 'UTC'`; упавший или зависший замер и разрыв больше 40 с
сбрасывают счёт; команда apply делает ещё один замер на хосте и отказывает,
если он не нулевой. Для этого пакета добавляется:

- окно B (native+Gateway): kernel idle (open, occupied, inflight, cleanup 0),
  нет операций kernel в `pending` моложе 15 минут, нет native connect intents
  в `prepared`/`entered`;
- окна B и C: нет строк `PersonalAccountOperation` с `updatedAt` за последние
  15 минут (идущий вход в аккаунт).

## Шаги

Custody под `/srv/platform/projects/review-router/releases/` (root, 0700).
Секреты печатать нельзя; проверки по SHA256.

### 0. Подготовка (прод не меняется)

1. Заморозка состава: `git log a02b1607..origin/main`. Если к этому моменту
   смержен [#955](https://github.com/777genius/review-router-ai/pull/955)
   (смержен в 15:11 UTC) и решение D5 = брать, целевой SHA =
   новый `main`, иначе `9c52c250`. Миграций кроме `000160` в диапазоне быть
   не должно (`git log -- '**/migrations/**'`).
2. RR: отдельный прогон typecheck/Vitest на worker не нужен, если целевой
   SHA = `9c52c250` (main CI 44877576086 прошёл на нём целиком, Action не
   выпускается). Если в состав вошёл #955, нужен зелёный main CI нового SHA
   (при очереди runners: Quality и DB на worker host, как в bundle 4).
3. Native `14f500eb` (или `2d5f681a` по D1) по описанию выше; SHA256 бинаря
   записать; положить root-owned на прод. Плюс репетиция миграций на копии
   дампа (раздел "Нативные миграции").
4. Gateway release `gateway116-44bf7ae-native14f-<дата>` по описанию выше,
   manifest, `source-runtime.tar.gz`; положить на прод.
5. Образ: `release.sh build <sha>`; проверить ревизию, что внутри
   `apps/web/node_modules/@agent-teams/account-gateway` указывает на
   `native-imports-f2690a3c9cfd.tgz`.
6. Caddy-кандидат: копия живого management файла, где в обоих блоках
   `@sdk path` добавлены `/v1/account-info/read /v2/provider-connection-capabilities`;
   кандидат строки 90 `apply-domain.sh`. Прогнать копию скрипта с выводом во
   временный каталог (без `sed -i` по живым файлам и без reload) и сравнить
   все шесть результатов: три env-файла (`runtime-web.env`, `runtime-api.env`,
   `runtime-worker.env`) и два Caddy файла (`review-router.caddy`,
   `review-router-www.caddy`) должны совпасть с живыми; management файл
   `review-router-account-gateway-management.caddy` должен равняться кандидату.
   PR в `777genius/platform-infra`,
   выравнивающий строку 90 с хостом и добавляющий два пути (решение D3).
7. Операторы (независимый ревью обязателен, это не замена констант):
   - native+Gateway: по образцу `gateway106-native95-20261114` (stop, свежий
     остановленный дамп native БД, `repository.ApplyMigrations` с проверкой
     `onlyPending` = ровно `260_gateway_account_info.sql`,
     `261_gateway_oauth_credential_import.sql`,
     `262_gateway_official_api_profiles.sql` и их checksum из исходника,
     ledger 318 -> 321, CAS `native.executable`/`native.sha256`, start,
     `READY_FENCED`), затем часть `upgrade-gateway115.mts` (drop-in на
     gateway116, start, `READY_FENCED`). Проверки как раньше: profiles (8),
     native accounts (28), kernel rows, autorestart, `NRestarts`;
   - `prepare` и `plan` без эффектов.
8. Ожидаемые отличия v1 и v2 посчитать заранее по сохранённому эталону
   `73728bd5` и коду `44bf7ae`/`14f500eb`, записать в custody. Уже известно
   по коду: у MiMo `tools` было `function`+`function_and_custom`, станет
   `function`; у OpenRouter было `none`, станет `function`
   (`provider-connection-capabilities.ts:13-27` в `1dce5c3` против
   `native_gateway_account_capabilities.go:42` в `14f500eb`); порядок
   `authMethods` у Codex другой. RR использует `tools` из capabilities только в
   UI (`provider-model-options.ts:93-97`: есть ли вызов инструментов), запуск
   ревью читает модели аккаунта, не capabilities; это принятое изменение UI,
   канарейка его не проверяет. Остальные поля восьми профилей по коду
   совпадают (второй круг ревью сверил provider id, plan, region,
   `completionInputKind`, `reconnect`, `limitsContract`, `availability`).
   Профиль пропадает из v1/v2, если его модели нет у native
   (`provider-connection-capabilities.ts:24` в `44bf7ae`, у Gateway одна модель
   на профиль, `service-assembly.ts:283`): заранее сверить по **именам**
   ключей конфига native (без значений), что для всех восьми профилей есть
   свой раздел (`openRouter`, `nvidia`, coding plans, OAuth/Grok) с той же
   моделью. При повторной базовой линии сохранить в custody полный JSON v1 (в
   нём нет секретов), по одному SHA256 поля не сравнить.

### 1. Caddy allowlist (окно A, короткое)

Тихое окно желательно (reload Caddy мягкий, но через этот site идут живые
ревью). Custody `caddy-sdk-routes-<дата>` (root, 0700): копии
`apply-domain.sh`, трёх генерируемых Caddy файлов и трёх
`/etc/platform/projects/review-router/runtime-env/runtime-{web,api,worker}.env`
(в них секреты, только копия и SHA256). Скрипт делает `sed -i` по этим
env-файлам (строки 12-22): при неизменном `domain.env` байты должны остаться
теми же, но это проверяется, а не предполагается. Поменять строку 90 на
хосте, запустить `/etc/platform/projects/review-router/apply-domain.sh`
(без `--recreate`).

Проверки: три env-файла (SHA256, владелец root и mode те же: fleet-overlay
требует private файлы, `fleet-overlay.mjs:107-116`), `review-router.caddy` и
`review-router-www.caddy` с прежними SHA256 (иначе стоп и откат), management
файл равен кандидату, `caddy validate` прошёл, reload ok.
Из Web-контейнера через установленный SDK: profiles 8, v1 SHA256 =
`73728bd5` (Gateway 115 не изменился); `/v2/provider-connection-capabilities`
теперь отвечает JSON-ошибкой Gateway 115, а не пустым `404` Caddy.

Откат: вернуть файлы из custody, `caddy validate`, `systemctl reload caddy`.

Важно: **не** запускать `apply-domain.sh` из `platform-infra` до
выравнивания: его строка 90 удалит восемь путей, которыми прод пользуется
сейчас.

В конце шага 1 спланировать свап-контроллер: `release.sh swap <sha>` без
`--apply` (только три ключа идентичности релиза, ExtraHosts те же).
Контроллер снимает env-файлы ролей, а шаг 1 их перезаписывает; CAS сверяет
содержимое (`fleet-overlay.mjs:578-583`), так что при равных байтах ранний
план тоже прошёл бы, но планировать после шага 1 проще и надёжнее.

### 2. Native и Gateway (окно B, под admission gate)

После шага 1 собрать новую gate custody `gate5-<дата>` из **текущих** живых
Caddy файлов (оператор gate восстанавливает "original"; старая `gate4` вернула
бы allowlist без новых путей). После restore сверить SHA256 обоих живых файлов
с новым original.

1. Строгое окно + kernel idle, gate apply.
2. Native: stop, свежий дамп, `ApplyMigrations` под `rr_dmin`, проверка до
   старта (ledger 321, ровно три новых файла с checksum, владелец новых
   объектов `rr_dmin`), switch config, start, `READY_FENCED`.
3. Gateway: stop, drop-in gateway116, `daemon-reload`, start, `READY_FENCED`.
4. Внутри gate оператор читает на `127.0.0.1` `/v1/profiles` (8),
   v1 и v2 capabilities: в v2 у Codex методы `browser`, `device_code` и два
   `credential_import`; Anthropic/Gemini нет; NVIDIA `enabled`.
5. Gate restore. Ожидаемое время fence: до двух минут (у 11-17 было 34 с без
   миграции).

Проверки после gate:

- v1 из Web-контейнера (старый SDK) через Caddy: тот же набор из 8
  профилей; у каждого `authMethods` как множество, `availability`,
  `completionInputKind`, `limitsContract`, `reconnect` и id моделей равны
  эталону. Допустимы подписи и заранее записанные отличия из шага 0.8
  (`tools` у MiMo и OpenRouter, порядок методов). Любое другое отличие или
  пропавший профиль: откат Gateway.
- v2 и `/v1/account-info/read` через Caddy из одноразового контейнера нового
  образа (`--add-host api.reviewrouter.org:172.19.0.1`, env только через
  root-only файл на хосте, удалить сразу): v2 `200`,
  `contract: provider-connections/v2`; account-info для одного существующего
  аккаунта: печатать только `status` и статусы полей, **никаких значений**
  (email, тариф). Сразу после старта поля скорее `unknown`: native заполняет
  снимок обычным maintenance, без отдельного скрипта.
- `/ready` 200, Gateway active, `NRestarts` 0, нет новых классов ошибок в
  журнале Gateway.

Откат (только при трёх нулях, посчитанных под gate): под свежим gate сначала Gateway
(`dropin.before`, `daemon-reload`, start), затем native (`config.before`,
start). БД native не откатывается; если native 105 не поднимется на ledger
321, это fix-forward на `14f500eb` под gate, восстановление из дампа только
как последняя мера.

### 3. ReviewRouter: миграция и образ (окно C)

1. `release.sh backup` (свежий pgBackRest full, вне строгого окна).
2. Строгое окно (с правилом про `PersonalAccountOperation`).
3. `release.sh migrate <sha>`: `000160`, ledger 168 -> 169, 0 незавершённых,
   canonical ACL, worker grant (`worker can update fullName = t`).
4. Сразу apply спланированного контроллера (`fleet-overlay apply`, detached,
   как в bundle 5). Старые контейнеры станут `*-before-ovl-<ts>`.
5. `release.sh verify <sha>`: роли, ревизия, рестарты, права БД через
   worker, `/ready`. Как 2026-11-17, он может остановиться на старых
   `installation.sync_requested` dead letters с ошибкой прав (до этого
   выката); это не стоп, если новых нет.
6. Проверки: четыре роли на новой ревизии, 0 рестартов, FILE 73 и refs 245
   прежние, `/ready` и Web 200, нет строк ошибок; в логе Web нет ошибок
   чтения capabilities и `accounts_unavailable`; в журнале Gateway видны
   чтения `/v2/provider-connection-capabilities` и `/v1/account-info/read`
   без отказов.

Откат (три нуля считать после остановки новых ролей и до старта старых):
rollback preflight из целевого образа (`a02b1607` поддерживает канал 245),
stop новых, вернуть
`*-before-ovl-<ts>` (образ `8d9dd8f3`, FILE 73, refs 245), env из
`snapshot.json` контроллера. Миграция остаётся.

### 4. Приёмка

| Проверка                             | Как, без реальных подписок                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Что не увидеть вживую                                                                                              |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Native и миграции                    | `READY_FENCED`, ledger 321, ровно три файла с checksum, таблица `gateway_account_info_snapshots` есть                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Работа native 105 на схеме 321                                                                                     |
| Capabilities                         | v1 равен эталону по полям; v2 200, импорт у Codex, нет Anthropic/Gemini                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |                                                                                                                    |
| Сведения аккаунтов                   | `/v1/account-info/read`: только статусы; через 1-2 цикла maintenance часть полей Codex станет `known` (значения не печатать)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Правильность email/тарифа на экране и ограничения для заёмщика проверяет владелец под своим входом                 |
| Connections UI                       | Ответ сервера без 5xx, нет `accounts_unavailable` в логах                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Отрисовка сведений и диалог Add provider с вариантами импорта видит только вошедший пользователь (владелец, Brave) |
| Импорт Codex RT/auth.json, reconnect | Только наличие методов в v2; приёмочный импорт владельца на одноразовом аккаунте делается **последним**, после зелёной канарейки и чистых логов, и с этого момента откат только вперёд                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Реальный импорт без настоящего refresh token невозможен; владелец может сделать его на одноразовом Codex-аккаунте  |
| Обычное ревью                        | Канареечный PR на `777genius/rr-codex-rotating-e2e` (канал `workflow-v1` = 245 не меняется, пинить caller не нужно): один run на ревизию, App publication, одна progress-строка и одна сводка, модель из `ReviewEvidenceObservation`; плюс живой трафик (social-monitor). В bundle 5 канарейка шла на NVIDIA nemotron. Пути Codex OAuth dispatch/refresh, Grok и coding plans канарейка не трогает, они проверены только квалификацией `af418a6a`: несколько часов смотреть native и Gateway (ошибки OAuth refresh, число quarantined аккаунтов против базы 9, `gateway_native_response_failure`) и частоты `relayCode`/`invalid_response` на execution против базы bundle 5 |                                                                                                                    |
| Миграция 000160                      | ledger 169; `SELECT count(*) FROM "PersonalAccountOperation" WHERE "credentialImportMethod" IS NOT NULL` = 0 до первого импорта                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |                                                                                                                    |

После приёмки: запись выката `2026-11-2x-bundle6.md` и статус task record.

## Что ещё едет (вопрос 5)

Сверено 2026-11-21 13:40 UTC, обновлено в 15:40 UTC:

- review-router-ai: `a02b1607..origin/main` = #914 (`9c52c250`), #955
  (`9f11eec1`, runner starvation: worker и пакеты
  review-executions/review-progress, без миграции, откат мягкий; см. D5) и
  #958 (`91c14404`: тексты страниц и лендинга в Web, README, одна SVG; без
  миграции). `git diff 9c52c250 origin/main -- packages/platform/db/prisma/migrations`
  пустой. Main CI на `9f11eec1` отменён следующим push, на `91c14404` в
  15:40 стоял в очереди: нужен зелёный CI этого SHA до сборки. Открыты: #956
  (запись bundle 5, docs), #920 и другие Draft. Dependabot PR нет.
- account-gateway: #116 (runtime), #117, #118 (CI/доки). Dependabot #76
  (fast-uri) не смержен, не едет.
- sub2api-standalone: `14f500eb` (#103) и `2d5f681a` (#1, апстрим); см. D1.
  Dependabot npm на standalone падает (pnpm проект), это отдельный follow-up.
- 777genius/ar: #85 (`c7543bc7`) приезжает внутри образа RR через lockfile.
  Dependabot #77, #82, #83, #84 не смержены.
- 777genius/review-router: `c31f0adb` (только notice), релиз не нужен.
- 777genius/platform-infra: нужен новый PR по строке 90 (D3). #503
  (инвентарь worker) к проду не относится.
- Не едут: Hindsight derivative patch из #914 (меняет рецепт отдельного
  образа памяти, контейнеры `reviewrouter-memory-prod-v1-*` не трогаем),
  активация Anthropic/Gemini, публикация SDK.

## Риски по убыванию

1. **Caddy 404 на v2** после замены образа: Connections и Add provider
   ломаются у всех. Снимается шагом 1 и проверкой v2 через Caddy до окна C.
2. **Неверный порядок native/Gateway**: Gateway 116 на native 105 ломает v1 и
   v2. Снимается порядком и откатом в обратном порядке.
3. **Изменения inference-пути native** даже в `14f500eb` (Codex OAuth
   dispatch/refresh, NVIDIA chat bridge, responses fallback): регрессия
   ревью. Смягчение: дерево равно квалифицированному `af418a6a`, CI Gateway
   #117, канарейка, откат под gate. Для `2d5f681a` риск заметно выше
   (930 файлов апстрима).
4. **Точка невозврата**: первый импорт делает откат образа, Gateway и native
   недопустимым. Смягчение: проверка трёх нулей перед откатом, решение D2.
5. **Оператор с миграцией**: новый код оператора, ошибка в нём может оставить
   fence дольше. Смягчение: ревью, dry run, abort-admission из gate custody.
6. **Дрейф `apply-domain.sh`**: запуск версии из `platform-infra` удалит
   восемь путей. Смягчение: D3, сравнение хэшей сгенерированных файлов.
7. **Native 105 на схеме 321 не проверен запуском**: откат native может
   потребовать fix-forward. Дамп до миграции хранится.
8. **Миграция 000160**: малый риск ожидания блокировки; окно и нулевые долгие
   транзакции.
9. **Диск 34 GB (97 %)**: новый образ и release tree. Гейт: не меньше 25 GB
   свободно перед сборкой; старые образы отката не удалять.
10. **Очередь GitHub runners**: влияет только на канарейку (раньше ждали
    5-40 минут); релиза Action нет.
11. **Сведения появляются не сразу** (`unknown` до maintenance) и видимость
    для заёмщика живьём не проверить без второго пользователя.
12. **Первый живой обмен refresh token пройдёт на проде.** Если OpenAI
    ротирует RT при обмене, импорт токена, которым пользуется локальный
    Codex CLI, может разлогинить этот CLI. Это продуктовое поведение, не
    сбой выката: сказать об этом в UI-тексте позже; приёмочный импорт
    владелец делает на одноразовом аккаунте последним шагом приёмки.
13. **Изменения `apply-domain.sh` касаются env ролей** (`sed -i` по
    `runtime-*.env`): если байты изменятся, fleet-overlay откажет на CAS.
    Снимается проверкой SHA256 и планом свап-контроллера после шага 1.

## Решения владельца

D1. Какой native выкатывать.

- (Рекомендую) `14f500eb`: ровно то, что нужно #914, Go 1.27.3, 3 миграции,
  дерево совпадает с квалифицированным. Надёжность 8/10, уверенность 8/10.
- `2d5f681a`: плюс апстрим (930 файлов, Go 1.27.4, ещё 5 миграций), только CI
  Gateway #118. Надёжность 6/10, уверенность 7/10.
- Отложить весь пакет. Надёжность 9/10 для текущего прода, но #914 стоит;
  уверенность 9/10.

Апстрим при рекомендации идёт отдельным native-only выкатом со своей
канарейкой.

D2. Импорт Codex включается сразу и без флага.

- (Рекомендую) Принять: флаги проекту не нужны, импорт прошёл browser-кейсы
  на синтетическом upstream (живой обмен с OpenAI не проверялся); откат
  допустим до первого импорта (три нуля), потом только вперёд. Импорт
  доступен пользователям сразу после замены образа, поэтому любой импорт
  пользователя до конца канарейки (20-60 мин) тоже закрывает откат; это
  принимается. Приёмочный импорт владельца на одноразовом Codex-аккаунте идёт
  последним, после зелёной канарейки. Надёжность 8/10, уверенность 7/10.
- Принять, но попросить пользователей не пользоваться импортом сутки
  (организационно). Надёжность 7/10, уверенность 6/10.
- Убрать импорт из UI отдельным PR до выката. Против правил (лишний код и
  потом обратная правка). Надёжность 7/10, уверенность 8/10.

D3. Как менять allowlist Caddy.

- (Рекомендую) Строка 90 `apply-domain.sh` на хосте (+2 пути), прогон
  скрипта с проверкой хэшей трёх файлов, и PR в `platform-infra`, который
  выравнивает файл с хостом. Надёжность 9/10, уверенность 9/10.
- Править сгенерированный `.caddy` руками. Файл помечен "do not edit by hand",
  следующий прогон скрипта откатит правку. Надёжность 5/10, уверенность 9/10.
- Только PR в `platform-infra` и деплой оттуда. Сейчас нет такого пути
  выката на хост, и версия там отстаёт. Надёжность 6/10, уверенность 6/10.

D4. Anthropic/Gemini API-профили.

- (Рекомендую) Не в этом пакете: нужен `anthropicApi`/`geminiApi` в
  конфиге native, `providerProfiles` в Gateway и проверка с реальным ключом.
  Надёжность 9/10, уверенность 9/10.
- Включить сейчас без реального ключа. Надёжность 5/10, уверенность 7/10.

D5. #955 (runner starvation, plan 88), смержен в 15:11 UTC (вместе с ним
в `main` пришёл #958, только тексты Web).

- (Рекомендую) Брать: образ из текущего `main` после зелёного CI, и добавить
  проверки #955:
  тесты `apps/worker/src/review-v2-*` и review-executions, а в приёмке
  отметить, что очередь без runner канарейка воспроизвести не может.
  Откат у него мягкий: старый worker не берёт события
  `review.requested_start_notice`, они остаются pending
  ([его record](https://github.com/777genius/review-router-ai/pull/955)).
  Надёжность 7/10, уверенность 7/10. Чуть ниже второго варианта по
  надёжности, но экономит отдельный выкат worker, а правило владельца -
  пакеты, не мелкие выкаты; откат у #955 мягкий.
- Не брать: собрать образ из `9c52c250`, #955 и #958 оставить следующему
  пакету вместе с апстримом native. Меньше изменений в одном окне.
  Надёжность 8/10, уверенность 7/10.

## Оценка времени

- Подготовка: 3-4 ч (worker: native две сборки и тесты 30-40 мин, Gateway
  release 30 мин; репетиция миграций native на копии 15 мин; операторы и их
  ревью 1,5-2 ч; образ 5 мин; Caddy-кандидат, сухой прогон `apply-domain.sh`
  и PR 20-30 мин; по желанию тесты native 105 на схеме 321 30-45 мин).
- Окно A: 10 мин. Окно B: ожидание 0-40 мин, fence до 2 мин. Окно C:
  backup 5-10 мин, ожидание 0-40 мин, migrate и swap 3 мин.
- Приёмка: канарейка 20-60 мин из-за очереди runners, затем наблюдение
  за native и Gateway несколько часов (OAuth refresh идёт по своему
  расписанию) и приёмочный импорт владельца последним.
- Итого 5-8 ч, реально рабочий день. Без релиза Action очередь GitHub
  влияет только на канарейку и PR документации.

## Go/no-go

- [ ] Решения D1-D5 приняты владельцем.
- [ ] Повторная базовая линия: прод на `a02b1607`, Gateway 115, native 105,
      ledger 168/318, 0 импортов, пары хэшей Caddy как выше; полный JSON v1
      сохранён в custody; частоты `relayCode`/`invalid_response`,
      companion failures и `ambiguous_outcome` на execution сняты как база.
- [ ] Окно отката bundle 5 закрыто решением владельца: условие из записи
      bundle 5 ("if it repeats on 245 and not on 244, use rollback step 1"
      про `invalid_response` на `sdk_request`) не сработало. Иначе bundle 6
      ждёт: Gateway 116 меняет тот же участок API -> Gateway, и два открытых
      вопроса нельзя будет развести.
- [ ] Репетиция миграций native на копии дампа прошла, дамп читается
      `pg_restore --list`; по именам ключей конфига native все восемь
      профилей имеют свою модель.
- [ ] Сухой прогон `apply-domain.sh` во временный каталог: пять файлов равны
      живым, management равен кандидату.
- [ ] `a02b1607..main` без неожиданных миграций; main CI целевого SHA зелёный.
- [ ] Native: две сборки дают одинаковый SHA256, тесты прошли.
- [ ] Gateway release: tracked файлы равны `44bf7ae0`, тесты прошли.
- [ ] Операторы прошли независимый ревью, `prepare`/`plan` без эффектов.
- [ ] Образ собран, ревизия верна, SDK в образе нужный.
- [ ] Свободно не меньше 25 GB на `/`.
- [ ] После шага 1: v1 = `73728bd5`, v2 через Caddy доходит до Gateway.
- [ ] После шага 2: v1 равен эталону по полям, v2 200, account-info 200 со
      статусами.
- [ ] Свежий pgBackRest full без ошибки перед migrate.
- [ ] Rollback sets bundle 5 и custody на месте.
- [ ] Env-файлы ролей после шага 1 с прежними SHA256; свап-контроллер
      спланирован после шага 1.
- [ ] No-go: любой отказ `READY_FENCED`, ledger не 321/169 (частичный
      ledger native: ветка "упало на середине"), v1 отличается сверх
      записанных в шаге 0.8 отличий, v2 не 200, рестарты ролей, новые классы
      ошибок или рост частот относительно базы.

## Что хранить

- Rollback sets: новые `*-before-ovl-<ts>` (образ `a02b1607`), bundle 5
  `*-before-ovl-20261121122821519` и `*-before-file73-retained`, более
  старые по записям bundle 3 и 4.
- Custody (root, секреты): `caddy-sdk-routes-<дата>`, `gate5-<дата>`,
  `native14f-gateway116-<дата>` (`config.before`, `dropin.before`, дамп native
  до 260, receipts), `main-<sha8>-migrate-<дата>`, `fleet-overlay-<sha8>-*`,
  плюс custody bundle 5 (`fleet-overlay-a02b1607-vSzoMhlE`,
  `coordinated245-20261121`) до закрытия окна отката.
- Release native 105 (`native-ttl-f10a380-20261120`) и Gateway 115
  (`gateway115-1dce5c3-native102-20261117`) не удалять.

## Пины отката (обратный порядок)

Перед любым шагом: три нуля импорта (раздел "Где откат перестаёт быть
безопасным"), заново под удерживаемой блокировкой писателей непосредственно
перед действием. Producers 245 и 244 остаются зарегистрированными, каналы не
трогаются. При частичной миграции native (ledger 319/320) действовать по
ветке из раздела "Нативные миграции": сохранить gate, Gateway 115 и не
откатывать БД; native 105 запускать только после проверки совместимости с
фактической частичной схемой, иначе fix-forward под gate.

1. Образ `9c52c250` -> `a02b1607`: rollback preflight, stop новых, три нуля,
   вернуть `*-before-ovl-<ts>`, env из `snapshot.json`. Миграция 000160
   остаётся.
2. Gateway 116 -> 115: под свежим gate `dropin.before`
   (`gateway115-1dce5c3-native102-20261117`), `daemon-reload`, start.
3. Native `14f500eb` -> 105: под gate `config.before`
   (`native-ttl-f10a380-20261120`, `d6ecc3d2`). БД native не откатывается;
   fix-forward, если 105 не поднимется.
4. Caddy: вернуть файлы из `caddy-sdk-routes-<дата>`, validate, reload.
   Можно не откатывать: лишние пути старому RR не мешают.
5. Ниже действуют пины [bundle 5](https://github.com/777genius/review-router-ai/pull/956) (раздел Rollback pins).
