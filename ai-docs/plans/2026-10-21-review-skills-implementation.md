# Review Skills — реализация и результаты проверок

Дата: 2026-10-21. [SaaS PR #635](https://github.com/777genius/review-router-ai/pull/635) · [Runtime PR #297](https://github.com/777genius/review-router/pull/297).

Документ дополняет [пошаговый план](./2026-10-21-review-skills.md), [три раунда критики](./2026-10-21-review-skills-reviews.md) и [ADR-031](../decisions/031-review-skills-content-and-captured-execution.md). Он фиксирует выполненное и фактически наблюдавшиеся результаты; статус удалённого CI нужно смотреть отдельно в PR.

## 1. Пользовательский результат

- Раздел **Skills перед Memory** в обычной и компактной навигации. Библиотека изолирована по viewer/workspace; карточка строки показывает автора, источник и использование в разрешённых репозиториях текущего workspace.
- Редактор с Name, Description и обычным Markdown textarea. Save сразу создаёт неизменяемую ревизию. CAS конфликт сохраняет draft; закрытие с несохранёнными изменениями требует явного решения. Есть import/export текстового `SKILL.md`.
- Только исходный автор с текущим членством в source workspace может менять текст. Это проверяет сервер, включая прямой повтор чужого server action. Автор может сохранить оригинал из связанной библиотеки; обновляются source и destination caches.
- **Add from workspace** создаёт canonical ссылку, без копирования. Для администратора обоих workspace grant и accept выполняются одной операцией. Разные администраторы используют source Grant и destination Accept. Перевыданное разрешение требует нового Accept.
- В списке репозиториев общий selection provider поддерживает страницы, фильтры и все совпавшие exact IDs. Manage skills открывает Add/Remove, поиск, таблицу с отдельными operation checkboxes и Assigned k/N. Add сохраняет прочие назначения и существующие scopes; Remove снимает только выбранные связи.
- Тот же assignment сценарий доступен из библиотеки через Repositories. У отдельного репозитория доступны пути применения и явное подключение Git roots. Bulk ограничен 1000 репозиториями; превышение не теряет selection. Потерянный ответ после commit допускает точный безопасный повтор.
- Repository-only SCM writer получает узкий экран назначения. Он не получает текст скиллов, всю библиотеку, sharing или usage других приватных репозиториев. Отозванные зависимости показываются как unavailable и остаются доступны для Remove.

## 2. Карта реализации

| Область             | Основной код                                                                         | Решение                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| Feature context     | `packages/features/review-skills/src`                                                | Domain, application, narrow ports, Prisma adapter и curated composition exports              |
| Общий язык          | `packages/shared/src/review-skills-contract.ts`                                      | Одна строгая схема capture, bounds, canonical JSON, digest и scope dialect                   |
| Хранение            | migrations `000136_review_skills`, `000137_review_skills_capture`                    | Originals/revisions/grants/links/bindings/sources; immutable private run attachment          |
| Admission           | `packages/features/review-run-control`, `apps/api/src/review-run-skills-snapshot.ts` | Consumer port, original-first restore, сериализуемая revalidation и bounded retry            |
| Transport           | `apps/api/src/review-run-skills.ts`                                                  | Run bearer + пустой body, bounded no-store companion, без произвольного workspace/repo input |
| Web                 | `apps/web/app/dashboard/*skill*`, `apps/web/src/features/review-skills`              | Session-owned actor, безопасные DTO, query isolation, общие application commands             |
| Runtime             | paired `src/review-skills`                                                           | Один immutable input и materialization до engine branch/cache                                |
| OCR                 | paired `tools/ocr/patches/0010-managed-review-skills-exact-paths.patch`              | Реальный формат parser, case-sensitive exact paths и pre-dispatch inventory                  |
| Архитектурные gates | `scripts/review-skills-tooling`, `architecture/review-skills`                        | Реальные GM/Foundation/FMS проверки только новой области                                     |

Применён существующий feature-first DDD/Clean Architecture из ADR-005. Get Modular используется для двух borrowed host inputs и одного application module. Пользовательские скиллы остаются данными. Нет generic transaction framework, нового plugin runtime, service locator или миграции всего проекта на GM. DRY обеспечивается общими assignment/capture/scope операциями и официальным генератором опубликованного контракта.

Production build сохраняет штатный TypeScript 6.0.3. Дополнительный gate явно устанавливает isolated TypeScript 7.0.2 и запускает `typecheck:native`; production Docker не зависит от локального opt-in install. Foundation tooling имеет отдельные pnpm 11.25.0/lock и использует существующие четыре точных version exceptions. Текущий root pin — pnpm 11.28.7; isolated native compiler package отдельно сохраняет pnpm 10.33.0. Установка nested tooling не подменяет root lockfile.

## 3. Инварианты, проверенные в реализации

**Изменение текста и времени запуска.** Новое ревью фиксирует текущие immutable revisions и настройки. Retry/restore/renew уже принятого ревью возвращают прежние bytes, даже после Save или revoke. Следующее ревью с отозванной назначенной зависимостью получает явный отказ до cache reuse/inference. SQL trigger также запрещает замену attachment.

**Гонки.** Простого `FOR UPDATE` parent row оказалось недостаточно для старого Serializable snapshot, ожидающего revoke. Каждая Skills mutation после полного упорядоченного lock set физически обновляет parent `Workspace.updatedAt`; stale admission получает SQLSTATE 40001. Проверка с двумя настоящими непривилегированными LOGIN roles воспроизводит snapshot-before-blocked-prelock и доказывает отказ stale transaction. Prisma 7 adapter nested error обрабатывается по точному коду, не по тексту сообщения.

**Права БД.** Release provisioning сужает grants: API читает Skills; web получает необходимые INSERT и точные UPDATE columns, DELETE только bindings; worker не читает Skills. Closed gate очищает также column grants. Ограниченный NOLOGIN-owned `rr_review_skills_repository_lock` даёт web нужную row-lock операцию без права изменять repository identity. Test-only grant в stock migrations fixture воспроизводит authority его production owner, не выдаёт web лишних прав.

**Исторические миграции.** Новые 136/137 зарегистрированы как точная checksum-pinned пара поверх неизменённого predecessor manifest. Managed92/historical96 сначала проверяют полный checkout, затем используют прежние проекции и identities. Неполная пара, изменённый SQL, повреждённый prefix и неизвестный future tail отклоняются. Прежние protected manifests/policies/pins не заменены.

**Git и движки.** Git bodies и Markdown references читаются только из зафиксированного trusted base commit в runtime. Изменение `SKILL.md` внутри проверяемого PR не переопределяет его проверку. Оба движка получают одинаковую проекцию подходящих инструкций; OCR сохраняет built-ins и не отправляет неразрешённые файлы в model calls. Изменение текста, scope или materialized resources меняет execution/cache identity. Legacy отсутствие capability сохраняет старые identities.

## 4. Фактически выполненные проверки

Группы пересекаются; числа ниже нельзя складывать в общее количество уникальных тестов.

| Проверка                                                            | Наблюдавшийся результат                                                                            |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Shared captured contract и scopes                                   | 24/24 passed, включая control characters и сохранённый empty-capture golden                        |
| Feature, actual-role PostgreSQL ACL, release grant/gate regressions | 48/48 passed, 6 files                                                                              |
| Signed admission + paired captured HTTP delivery                    | 5/5 passed на настоящем PostgreSQL                                                                 |
| Обязательный paired CI invocation после финального экспорта         | 1/1 выбранный тест passed; остальные 4 намеренно отфильтрованы                                     |
| CP focused authorization/profile/route regressions                  | 59/59 passed                                                                                       |
| Official export/handoff regressions                                 | 7/7 passed                                                                                         |
| Existing direct OpenRouter paired E2E                               | 2/2 passed                                                                                         |
| Web navigation/search/selection/transport regressions               | 22/22 passed, 5 files                                                                              |
| Финальный real-browser run на чистой PostgreSQL 18.4                | 7/7 passed, 0 failed, 0 skipped; все 138 migrations применены                                      |
| Fresh PostgreSQL 17.10 gateway/config + migration workflow          | 21 passed, 1 отдельный H test выключен штатным env gate; все 138 migrations применены              |
| Historical/release classification regressions                       | 303/303 passed, 6 files                                                                            |
| Historical79 provider-scope PostgreSQL contract                     | 33/33 passed, 0 skips; PostgreSQL17.10, 82 historical migrations, без SQL80+ и Skills columns      |
| Historical89 executable closure и preparation                       | 53/53 passed, включая alternate-checkout и отказ до effects при изменении Skills ACL helper        |
| Scoped GM/Foundation/FMS                                            | Passed: 82 FMS cases, namespaces/wiring oracle и реально отвергаемая mutation dependency direction |
| Existing architecture boundaries                                    | Passed: 574 domain/application files                                                               |
| Official protocol gate                                              | Passed: deterministic/current generated bytes и связанные build/typechecks                         |
| SaaS Action build и официальный artifact smoke                      | Passed: source parity обоих `action-dist` artifacts                                                |
| Runtime real OCR CLI loopback                                       | 10/10 passed; проверены actual main/plan request bodies, built-ins, scopes и inventory             |
| Runtime final Skills + required OCR CLI batch                       | 21/21 passed                                                                                       |
| Independent runtime Skills/native/OCR adapter suites                | 52/52 passed                                                                                       |
| Runtime paired lifecycle и committed artifact                       | 58/58 passed                                                                                       |
| Runtime direct-provider setup и approved profile selection          | 45/45 passed                                                                                       |
| Runtime три исходных failure files из полного CI                    | 49/49 passed вместе: artifact smoke, setup preview и exact workflow action audit                   |
| Runtime full lint/typecheck/normal build                            | Passed; lint 0 errors, 398 существующих warnings                                                   |
| SaaS ESLint всех изменённых TS/TSX/MJS                              | Passed                                                                                             |

### Браузерная квалификация

Финальный run `skills-qualified-03c94f3`: **7 passed, 0 failed, 0 skipped**, 1.2 минуты. Точный код `03c94f32ce4a5147336681502742e4385c1827d5`, source delta SHA256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` — пустой. Отдельная исходно пустая roleless PostgreSQL 18.4/UTC применила все 138 migrations. Предыдущие прерванные средой/исправленной фикстурой запуски не подменяют этот успешный receipt.

Семь сценариев: create/mobile/Save/CAS/nonauthor server denial; inert import/export; 125 repositories и mixed counts/pages/deltas; сохранение 1001 IDs с блокировкой Apply; потеря ответа после commit и exact retry; canonical sharing и сохранение через destination с refresh обоих workspace; repository-only writer, revoke/privacy и Remove. Receipt содержит 5 signed App installation-token POST и 5 collaborator-permission GET.

Локальные воспроизводимые receipts: `tmp/accounts-reference-e2e/runs/skills-qualified-03c94f3/{result.json,migrations.log,playwright-result.json,skills-github-requests.json}`. Пять actual desktop/mobile screenshots находятся в `browser-artifacts` этого run; layout и sticky footers проверены визуально. Test database остановлена, data/logs сохранены; временный `next-env.d.ts` возвращён к tracked baseline.

Harness использует настоящий Next, signed synthetic session, production server actions и PostgreSQL; GitHub App JWT/token/collaborator-write protocol проходит через отдельный loopback HTTP fixture. Это не production login или permission bypass. Chromium 153.0.8010.0 получен из закреплённого `@sparticuz/chromium@153.0.0`, потому что стандартная Playwright загрузка в этой среде возвращала пустой архив. Это явно отражено в executable override и receipt.

### Воспроизводимые команды

Из SaaS checkout с установленными зависимостями и отдельными TEST databases:

```sh
CI=true pnpm skills:tooling:prepare
pnpm skills:architecture
pnpm --dir scripts/local-checks/native install --ignore-workspace --frozen-lockfile
pnpm --filter @reviewrouter/features-review-skills typecheck:native
REVIEW_SKILLS_TEST_DATABASE_URL="$SKILLS_PG_URL" REVIEW_SKILLS_REQUIRE_PG=1 pnpm skills:test
REVIEW_SKILLS_ADMISSION_TEST_DATABASE_URL="$ADMISSION_PG_URL" \
  REVIEW_SKILLS_REQUIRE_ADMISSION_PG=1 REVIEW_SKILLS_REQUIRE_PAIRED=1 \
  REVIEW_ROUTER_ACTION_SOURCE_DIR="$ACTION_SOURCE_DIR" \
  pnpm exec vitest run apps/api/src/review-run-skills.postgres.test.ts
pnpm protocol:check
pnpm action:artifact:check:smoke
```

`SKILLS_PG_URL`/`ADMISSION_PG_URL` должны указывать на отдельные disposable PostgreSQL 17+ fixtures; не на production. Миграции применяются до тестов. Полные setup/commands браузера — в `scripts/accounts-reference-e2e/README.md`, opt-in `--skills-fixture`. Для root-команд используется текущий repository pin 11.28.7; Skills tooling выбирает собственный pin 11.25.0, а isolated native compiler package — 10.33.0.

В runtime actual CLI gate требует собранный binary и `REVIEWROUTER_OCR_REQUIRED=1`; точная команда есть в `docs/review-skills.md`. Отсутствие fixture при required flags вызывает failure, а не успешный skip.

## 5. Исторический checkpoint identities и CI

Следующие identities относятся к checkpoint до последующих merge main. Актуальная локальная квалификация и границы публикации приведены в заключительном разделе; исторические receipts сохраняют исходные SHA.

- SaaS functional integration checkpoint после повторного ревью: `35ec3863c62b13095efdcc0083a180cea7ad6eba`. Историческая квалификация выше выполнена на `03c94f32ce4a5147336681502742e4385c1827d5`; новый receipt приведён ниже.
- Paired runtime checkout: `1381fa481bfba3755bf9135b243486505b5c2563`; этот immutable SHA установлен только в paired CI lane. Published hosted-pool baseline и stable tags не перемещены.
- Canonical contract source: `8626bae253410668557829b95d1b6a45c6e76adc`; official handoff digest `ca4fe0e788d97bb56a55bbbab434a0de6c6ca39d1fc0dc54031dc6618ffe5d4b`.
- OCR Linux amd64 binary: `0553daafe39d7a9d7608f0d37b26d55c11d07b9d5bbfc5b36b0778f9cd9f3df5`, pinned upstream `8eb83340a487b1150af00701b94f01af97e4b4d6`, Go 1.26.9, rr.4 и десять patches.

CI теперь содержит отдельную Skills PostgreSQL fixture, scoped tooling/native compiler gates и signed HTTP proof после verified paired checkout. Runtime CI собирает настоящий OCR в temporary directory, сравнивает полный manifest и запускает существующий Jest с required binary. Browser qualification остаётся явным локальным real-browser lane; автоматического browser CI pass этот документ не заявляет.

Ранние remote runs обнаружили и помогли исправить generated-parser lint, stale Action artifact, current migration count, неизвестный additive checkout tail, неустановленный opt-in compiler в Docker и ошибочное `--ignore-workspace` у nested tooling. Их failure не выдаётся за финальный pass. Полный Docker PG16→PG17 rehearsal и все remote jobs оцениваются по финальному SHA в GitHub; локальные bounded proofs не заменяют их.

Следующий полный прогон выявил оставшиеся compatibility assumptions: historical79 Prisma fixture выбирала новое SQL137 поле; historical89 executing-source closure не включала импортируемый Skills ACL helper; runtime smoke/setup ожидали единственный прежний профиль, а audit table не содержала добавленный exact setup-go pin. Исправления сохраняют старую схему, проверку всех reviewed executable bytes, оба профиля и точные action SHA/use counts. Все затронутые suites повторно прошли, как указано в таблице; это не утверждение о полном remote CI pass.

## 6. Границы выпуска

Поддержаны Gateway OCR/native и verified direct OpenRouter. Older Secrets/Hosted без admitted-input seam сохраняют legacy producer; назначения Skills вызывают `skills_engine_unsupported`. Это явно показано в runtime transport matrix.

Формат v1 — текст и ограниченные Markdown references. Нет запуска scripts, установки dependencies, новых tool permissions, transitive sharing, marketplace, ручного Publish/semver или двусторонней Git/web sync. Provenance подтверждает передачу инструкций, но не доказывает соблюдение каждой инструкции моделью.

Production deployment, публикация release assets и регистрация новых qualified producer profiles выполняются существующим release process после review. Правильный порядок: additive DB/server → новый qualified runtime/profile → включение назначений для поддерживаемых репозиториев. Слияние PR само по себе не выполняет production deploy, публикацию release assets или регистрацию producer. Production credentials в этой работе не изменялись.

## 7. Повторное ревью, авторство и финальная визуальная квалификация

По дополнительному запросу пользователя три независимых критика **GPT-6.1 Sol
xhigh** проверили backend/authority, runtime/OCR и действующий frontend. Четыре
P2 опубликованы inline в PR: partial repository discovery, потерянный shortcut
Markdown reference, assignment после обычного Save и скрытый bulk feedback.
Все четыре исправлены; подробности и pre-existing non-blocking наблюдение
сохранены [в журнале ревью](./2026-10-21-review-skills-reviews.md). Backend и
runtime критики независимо проверили исправления друг друга.

Дополнительные выполненные проверки:

| Проверка                                                                  | Результат                                                                                                                                          |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Adapter и действующие dashboard permission guards                         | 26/26 passed                                                                                                                                       |
| Actual PostgreSQL partial-proof regression                                | 1 выбранный case passed: только разрешённый target в discovery, bulk на два targets запрещён, 0 bindings; 7 соседних tests намеренно отфильтрованы |
| Runtime parser, generated contract и rebuilt production artifact          | 16/16 passed после нового official handoff                                                                                                         |
| Runtime после merge текущего main с compact review comments               | 77/77 Skills/contract/artifact/reviewer-summary tests; full typecheck и normal build passed                                                        |
| Signed HTTP paired delivery после обновления runtime                      | 1 выбранный case passed, 4 соседних tests намеренно отфильтрованы                                                                                  |
| Runtime full typecheck, changed-file lint/format, normal Action/CLI build | Passed; qualified Go binary и context-gateway bytes не изменялись                                                                                  |
| Web и browser-harness TypeScript, formatting/diff checks                  | Passed                                                                                                                                             |
| Финальный real-browser run `skills-visual-qualified-35ec386`              | **7/7, 0 failed, 0 skipped, 0 flaky**, 63.42 секунды                                                                                               |

Последний browser receipt относится точно к
`35ec3863c62b13095efdcc0083a180cea7ad6eba`; source delta SHA256
`e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`
означает пустой source delta. Новый отдельный кластер PostgreSQL 17 применил все
138 migrations без переиспользования cluster-level roles. Browser — Chromium
153.0.8010.0 из закреплённого `@sparticuz/chromium@153.0.0`. Следующий checkpoint
`6a62b57` обновил только этот отчёт, review log и paired CI pin. Последующая
contract-only совместимость описана отдельно ниже; web/Skills UX код не менялся.

Проверены реальные desktop/mobile экраны, включая 390×844, keyboard/focus,
dirty close, Create continuation, Save/CAS и сохранение через linked original.
При заполненной таблице selected count, success, unknown-result error и exact
retry находятся в видимой закреплённой области. Root дополнительно просмотрел
финальные screenshots success/retry/library, без генерации макетов.

Canonical sharing проверен через UI и PostgreSQL: Alpha и Bravo содержат ссылки
на один `rr-e2e-skill-shared`, автор редактирует его через destination, оба views
получают revision 2. Следующий privacy case намеренно создаёт revision 3 и
доказывает, что revoked consumer не видит новый private description. Итоговые
63 original rows = 61 seed + 2 явных Create; linking не добавляет копий.

Receipts и фактические screenshots:
`tmp/accounts-reference-e2e/runs/skills-visual-qualified-35ec386/` — `result.json`,
`playwright-result.json`, `migrations.log`, `post-run-db-proof.txt` и
`browser-artifacts/`. Тестовые app/кластеры остановлены; generated `next-env.d.ts`
возвращён к baseline, одноразовый exploratory spec удалён. Использованы реальные
Next/session/actions/PostgreSQL и изолированный GitHub App HTTP fixture;
production OAuth, live SCM и платный model inference не заявляются.

Author/committer feature commits исправлены на подтверждённый GitHub identity
владельца по его запросу; GitHub связывает новые commits и review comments с
`777genius`. Metadata rewrite сохранил каждый исходный tree. Старые SHA в
исторических receipts не заменены задним числом. Новый runtime handoff получен
штатным export из reachable source, а не ручным редактированием generated files.
Оба PR переведены в **Ready for review**. Полный runtime CI на предыдущем head
`13b66b2` завершился успешно; статус новых remote runs проверяется отдельно.

Во время финальной проверки runtime main продвинулся до `b4d8bd5` (compact
review comments, версия 1.0.189). Его изменения сохранены merge commit
`cf7c7b1`; единственный конфликт source map решён штатной пересборкой. Отдельный
критик подтвердил сохранение обоих source sets и соответствие 13 embedded
source-map entries исходникам. Первый повтор paired HTTP test остановился до
сценария на SQLSTATE 53100 (shared disk full); после удаления наших package/build
caches и сжатия остановленных TEST кластеров с сохранением полных архивов
повтор прошёл. Это environment failure, не успешный initial run.

Замеченный на одном desktop screenshot Next dev badge разобран по логу: лишний
`caret-color: transparent` временно добавляет Playwright screenshot API во время
hydration. Та же сигнатура была в предыдущем baseline; соответствующего
application style нет. Это известный screenshot-timing artifact harness,
не дополнительное доказательство product markup defect. Новые продуктовые
изменения для его скрытия не вносились.

## 8. Совместимость с конкурентным runtime main

Runtime main затем получил PR #299 (`98c442d`) с optional AI PR descriptions.
Его public consumer уже использует auxiliary canonicalizer из SaaS source
`929d0d883c59e33c86fdc16ca5195211116531db`, тогда как отдельный product PR #638
ещё не входит в SaaS main. Чтобы новый официальный Skills export не удалял
существующий runtime contract, перенесена только необходимая декларативная
часть источника и генератора.

Изоляция выполнена явно: private contract-only literal вместо изменения
production `ReviewTaskKind`; domain/base normalizers по-прежнему отвергают
`pr_description`. Не добавлены execution/publication policy, application
services, UI, migrations или зависимости отдельной фичи. Runtime consumer
получает оба контракта через обычный source export.

Сравнение с предыдущими 51 generated files: 48 byte-identical, изменены только
barrel/companion declarations/manifest, добавлены два auxiliary files, удалений
нет. Все прежние manifest fields, schema/base/investigation/negotiation и golden
digests сохранены. Auxiliary TypeScript, golden fixture и companion file точно
совпадают с `929d0d`; Skills contract и supporting agent profile не менялись.
Полный receipt — `tmp/review-skills-unified-protocol-identity-proof.json`.

Независимый backend критик выполнил official `protocol:check` (две deterministic
generations, protocol build, control-plane/API typechecks), **29/29** generated,
evidence canonicalization и release-manifest tests, **7/7** official export tests.
Проверки доказывают и сосуществование двух экспортов, и отсутствие enablement
новой задачи в существующей SaaS domain normalization.

Root выполнил normal `action:build` и `action:artifact:check:smoke`; оба прошли.
Tracked private bundles пересобраны из этого источника, source parity подтверждён.

Official export из committed source `8626bae` сохранён в runtime перед merge
`98c442d`. Merge commit `1381fa481bfba3755bf9135b243486505b5c2563` содержит обе
фичи. Source conflicts не было; generated bundles/source map пересобраны обычной
командой, сохранён combined official handoff. Независимый runtime критик сверил
все 52 generated-file digests и шесть integration seams: capture до engine/cache,
cache identity обоих движков, native finding/investigation prompts, OCR exact
rules с очищенным background, отдельные description slots/canonicalizer и
сосуществование contracts/profiles. Конкретных дефектов в этих границах не найдено.

Финальный affected runtime batch — **252/252, восемь suites**: Skills, contract,
rebuilt production entrypoint, OCR/native adapters, parent runner, description
generation и control-plane adapter. Full typecheck, normal build и diff checks
прошли. Signed paired HTTP на том же rebuilt runtime — **1 selected test passed**,
четыре соседних cases намеренно отфильтрованы. Receipts:
`tmp/skills-unified-main-paired-http.log` и runtime
`tmp/skills-unified-main-{build,typecheck,tests}.log`. Paired CI pin обновлён
на этот immutable merge commit; новый remote CI оценивается отдельно.

## Промежуточная E2E-квалификация 2026-10-22

Для зафиксированной ниже квалификации main `debd50e6a5b940cdbebb253f4483da5b81d71a7a` объединён с
Skills. Сохранены новые provider usage, context tools, полная реализация
PR description и все их migrations. Более ранний раздел про contract-only
изоляцию описывает исторический checkpoint, до принятия этих фич в main.
Текущий полный каталог содержит **142 неизменённых SQL migrations**; его digest
`sha256:8c53b7407b5f4b53a92c5554c8024f24792f67ed993016b4f585564a110a03f7`.
Два различных имени `000136_*` сохранены. Классификатор Skills проверяет точную
пару имён/checksums и известный predecessor, затем использует существующие
проверки main; неизвестный tail не принимается.

Первый запуск настоящего Next на `35d79c78b5c8a35d70d4f5e78999390ffa0c8878`
обнаружил ошибку browser/server boundary: новый клиент context tools импортировал
общий shared barrel, а тот реэкспортировал Node-only Skills hashing с
`node:crypto`. Исправление выделяет явный package subpath
`@reviewrouter/shared/review-skills-contract` для серверных потребителей и
оставляет общий barrel совместимым с браузером. Канонический контракт и его
байты не изменены; полифилл, новая зависимость или изменение crypto не добавлены.
Регрессия проверяется настоящей esbuild browser compilation общего entrypoint.

Повторная полная квалификация выполнена на чистом committed source
`336f59edce009c2f6347007f3651c0f32a3bf30b`, tree
`ccef621791bd726b7e00691e379cb22671b8d21a`:

| Проверка                                                         | Наблюдаемый результат                                                                                              |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Real Next/session/actions + PostgreSQL + Chromium                | **7/7**, 0 failed, 0 skipped, 48.5 s                                                                               |
| Свежий PostgreSQL 17.11 / UTC                                    | Все **142** migrations завершены; каждый checksum совпадает с SQL в checkout                                       |
| Ссылочная модель                                                 | Один canonical Skill, две ссылки из других workspace; revision 2 автора сохранена на оригинале                     |
| Grants и отзыв                                                   | Отдельное принятие grant version 1; revoke переводит другой grant в version 2; последующий private head не раскрыт |
| Repository-only writer                                           | Удалена только выбранная revoked binding; соседняя binding сохранена                                               |
| GitHub App HTTP fixture                                          | 5 signed installation-token POST и 5 collaborator-permission GET                                                   |
| Desktop/mobile UX                                                | Проверены 11 screenshots; summary, результат, exact retry и действия доступны в footer                             |
| Browser-boundary / Skills / admission / generated-contract tests | **71/71**                                                                                                          |
| Migration/release/handoff tests                                  | **351/351**; дополнительно реальный PostgreSQL gateway test passed                                                 |
| Signed admission и HTTP companion → public runtime               | **5/5**, без пропусков                                                                                             |
| Engineering Foundation / FMS                                     | 82 shared conformance cases, rejecting mutation и все scoped checks passed                                         |
| API и web typecheck                                              | Passed на Node 26.11.1; web потребовал штатный увеличенный Node heap                                               |
| Shared/private Action build и artifact parity                    | Passed; оба private bundles byte-identical соответствующим public runtime bundles                                  |

Семь браузерных сценариев включают Create/Save/CAS/nonauthor denial,
text-only import/export, 125 repository targets с pagination и mixed counts,
предел 1001 выбранного ID, потерю ответа после commit с exact retry, canonical
sharing/author edit и repository-only remove после revoke. Это настоящий
application/database/browser путь с изолированным внешним HTTP fixture;
production OAuth/SCM/provider/model traffic не запускался.

Receipt directory:
`tmp/accounts-reference-e2e/runs/skills-merge-336f59edce00/`.
Сохранены `qualification-receipt.json`, `result.json`, `playwright-result.json`,
`migration-receipt.json`, `sharing-db-receipt.json`,
`skills-github-requests.json`, 11 screenshots и полный synthetic DB dump.
Source delta при запуске пустой, SHA256
`e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.
Неуспешный первый bootstrap и его dump сохранены отдельно, а не заменены
успешным receipt. Сгенерированный harness-файл `next-env.d.ts` возвращён к baseline.

Paired runtime candidate этого checkpoint:
`260ae157d9dcce6fa8603e5140676510fb98f176`. Он объединяет тогдашний main
`1fd5503e4e1104ff3898a05cdcae80070251a951` со Skills и исправляет новое
CodeRabbit замечание о многократном повторении native Skill body. Каждый Skill
теперь передаётся один раз с отсортированным списком точных matching paths;
OCR сохраняет отдельную exact-path проекцию. Passed: **221** focused runtime
tests, production entrypoint artifact **1/1**, full typecheck, normal build и
**10/10** required actual OCR rr.4 CLI tests. Два отдельно gated historical
rr.3/MCP tests остаются явно пропущенными, не засчитываются в эти результаты.

Официальный combined export содержит 57 файлов и ссылается на reachable-in-branch
local source `35d79c78b5c8a35d70d4f5e78999390ffa0c8878`; все file digests и
байты сверены с этим commit. Handoff digest:
`de0c5a57101aac450d7bb9e4c7c3acc2452490509ebca4e5ca6cd44d70c19863`.
Более позднее исправление package boundary не меняет generated contract.

Commit `8e8e5ac` после этого checkpoint изменил только отчёт, журнал замечаний
и paired CI pin. Первая попытка публикации остановилась на GitHub API
`create_tree` с ответом `user rejected MCP tool call` без дополнительной причины.
Это историческая попытка; последующая интеграция и итоговый статус приведены ниже.

## Финальная локальная квалификация и статус публикации — 2026-10-22

SaaS main `5f242ba2187b7085c3f5f4b5466e90029dce909a` и runtime main
`cae72ec70b84cb20a93021d51f1c8a3e0426b17a` включены в подготовленные ветки.
Сохранены account dialog, usage redrive, shared dialog feedback, incomplete-review
summary и deadline-bounded provider-lane waiting. Новые изменения main не меняют
каталог из 142 migrations или канонические contract bytes.

Окончательный browser run выполнен на чистом committed SaaS source
`50823635cd2047f192bced0ae59900d71cfb6d5f`, tree
`0751ad028f78a70e98d1e0844faff76222b59a4e`:

| Проверка                                              | Результат                                                                        |
| ----------------------------------------------------- | -------------------------------------------------------------------------------- |
| Real Next/session/actions + PostgreSQL + Chromium     | **7/7**, 0 failed, 0 skipped, 53.6 s                                             |
| Свежий PostgreSQL 17.11 / UTC                         | Все **142** migrations завершены, все SQL checksums совпадают, rolled back — 0   |
| Engineering Foundation / FMS                          | **82** conformance cases, rejecting mutation и combined scoped checks passed     |
| Shared boundary / browser compilation                 | **2/2**                                                                          |
| Runtime после интеграции нового main                  | **269** focused tests и TypeScript typecheck passed                              |
| Итоговые runtime contract / production artifact       | **4/4**, штатный build и release metadata check passed                           |
| Signed admission и paired HTTP на итоговых артефактах | **5/5**, 0 failed/skipped, оба required flags включены                           |
| GitHub App fixture / визуальная проверка              | 5 signed token POST, 5 permission GET; просмотрены 11 desktop/mobile screenshots |

Receipts и synthetic DB dump сохранены в
`tmp/accounts-reference-e2e/runs/skills-final-50823635cd20/`.
`qualification-receipt.json`, `result.json` и `migration-receipt.json`
подтверждают source SHA, пустой source delta и результаты выше. Сохраняются также
sharing DB receipt, HTTP trace, screenshots и прежние успешные/неуспешные runs.
Во время screenshot зафиксирован один hydration warning с единственным отличием
`caret-color:transparent`, временно добавленным установленным Playwright
screenshotter; наблюдение и Next log сохранены, продуктовый input этого атрибута
не задаёт. Прежние 351 migration/release tests повторно не запускались, поскольку
последний main не менял проверяемую schema/classification область.

Окончательный локальный runtime commit —
`5ddb78ded6b2ef77eedd2216bb37112432d5ffd5`; он закреплён в paired CI pin.
Официальный export использует SaaS source `50823635cd2047f192bced0ae59900d71cfb6d5f`
и published runtime base `1381fa481bfba3755bf9135b243486505b5c2563`.
Все **57** generated-файлов побайтно совпадают с canonical source; handoff SHA256
`cd3a707ed70b90db614f534aa42494ade042697b7d9ca5c87daec8385e16b314`.
Обязательный final HTTP suite сохранён в `tmp/final-new-main-http.log` и
`tmp/final-new-main-http-results.json`. Прежний runtime `260ae157` и export
из `35d79c78` остаются историческими checkpoints. После browser checkpoint
изменены только этот отчёт, журнал замечаний и paired CI pin; продуктовые
исходники соответствуют проверенному `50823635`.

После явного разрешения пользователя автономно закончить публикацию, CI и merge
повторный GitHub API `create_tree` снова вернул `user rejected MCP tool call`.
Причина сверх этого сообщения инструментом не сообщена. Дальнейшие внешние
записи прекращены; завершение ограничено локальными commits и готовыми bundles.
Remote SaaS head остаётся `520ef97b2ec0328769a270deee15351155110293`, runtime —
`1381fa481bfba3755bf9135b243486505b5c2563`. Новый remote CI, ответ/resolve native
review thread и merge обоих PR не выполнены. Успешные проверки старых remote
heads не выдаются за CI подготовленных commits. Production deploy и release
операции не запускались.

## Возобновление публикации и актуальная совместимость — 2026-10-23

Предыдущий раздел фиксирует историческую остановку. После повторного разрешения
пользователя публикация через отдельные immutable blobs и SHA-only tree успешно
обновила SaaS PR до `e1cec4a1364915ac47516fb81efc9bc70e253677`; GitHub связал
author/committer с аккаунтом `777genius`. Старый неопубликованный runtime pin
заменяется после публикации нового согласованного runtime.

В текущую подготовку включены SaaS main
`296ddc0327b7dfc762c31b5b1d39e5461a41c12c` и runtime main
`ea3759af489d8e431f72c398d0c1f98ba810b7cd`. Сохранены Memory projections,
account limits, schema compatibility slots, comparison baseline, bounded OCR
background, context-tool receipts и provider usage. Официальная генерация
объединяет новый legacy schema slot и Skills contract; generated output вручную
не редактируется.

Новый inventory содержит **143** migrations, SHA256
`036310f316485a0fd3392a72ddb29c79b781d3451b055c506d59f102c136074b`.
Managed92 и historical96 identities сохранены. Добавлен только точный main141
predecessor; regression сохраняет прежний Skills/main142 manifest и отвергает
неизвестные/повреждённые каталоги. Все migration SQL bytes сохранены.

Исправлены причины последнего удалённого CI: формат двух release tests и точный
allowlist четырёх уже закреплённых Get Modular registry artifacts в private
dependency installer. Неизвестные package/version, ranges, URLs и executable
YAML configuration по-прежнему отклоняются.

На этой подготовке прошли **327** migration/release tests (2 opt-in skips),
**26** installer tests, **58** Skills/protocol/export tests (8 PostgreSQL opt-in
skips), deterministic `protocol:check` с API typecheck и **82** shared FMS cases
с rejecting mutation. Runtime source прошёл **193** focused tests, полный
TypeScript typecheck и ESLint; финальные **15** Skills tests отдельно проверяют
исправление native duplication и побайтную совместимость OCR.

Независимый критик не нашёл новых P1/P2 в merge-sensitive admission/restore,
companion authority, schema slots, dashboard, Foundation и browser harness.
Исторические browser receipts выше не являются проверкой нового 143-migration
checkout. Его свежие browser/paired/real-OCR результаты и окончательные
опубликованные pins фиксируются следующим checkpoint после исполнения.

## Итоговая квалификация 143-migration checkout — 2026-10-23

Этот checkpoint заменяет прежние локальные результаты только для актуального
checkout; все предыдущие receipts и остановки публикации выше остаются
историческими. Настоящий browser run выполнен на чистом committed source
`fe16d1f75f91b042c9ba3a9c77bd130fa93fe394`, tree
`e655b029dde3c00534e9e321ccbd0a8e39a5cc17`. Опубликованный SaaS API commit
`7900c92cde056d3f4320beec13c8f7a84cb79d16` имеет **тот же точный tree**;
проверенный source и опубликованный checkpoint побайтно совпадают. Harness
получил `--expected-revision fe16d1f75f91b042c9ba3a9c77bd130fa93fe394`; начальный и
окончательный source delta после возврата generated `next-env.d.ts` пустые,
SHA256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.

| Проверка                                                   | Наблюдаемый результат                                                                                                                                              |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Actual Next/session/server actions + PostgreSQL + Chromium | **7/7**, 0 failed, 0 skipped, 0 flaky; 70.45 s                                                                                                                     |
| Fresh PostgreSQL 17.10 / UTC                               | Preflight: 0 public tables, нет migration table, только synthetic bootstrap role; затем **143/143** migrations finished, все checksums совпадают, 0 rolled back    |
| Migration inventory                                        | `sha256:036310f316485a0fd3392a72ddb29c79b781d3451b055c506d59f102c136074b`                                                                                          |
| Signed GitHub App HTTP fixture                             | **5** installation-token POST с проверкой App JWT и **5** collaborator-permission GET                                                                              |
| Визуальная проверка                                        | Все **11** desktop/mobile screenshots просмотрены; root дополнительно проверил desktop library и mobile bulk result; конкретных продуктовых UX-дефектов не найдено |
| Signed admission + paired HTTP                             | **5/5**, 0 skipped, оба required flags включены; отдельный свежий PostgreSQL 17 cluster, все 143 migrations применены                                              |
| Required actual managed OCR rr.4 + Skills                  | **10** actual CLI integration cases + **15** Skills cases = **25/25**, 0 skipped                                                                                   |
| OCR MCP qualifier                                          | **2/2** на отдельно одобренном exact rr.3 binary                                                                                                                   |
| После официального export                                  | **25/25** в четырёх contract/production-entrypoint/runtime-bundle/release-metadata suites; full TypeScript typecheck и штатный build прошли                        |

Семь browser scenarios подтверждают Create/Save, отмену dirty-close, CAS conflict
с сохранением draft и явным reconciliation, настоящий replay server action другим
current source admin, text-only `SKILL.md` import/export, все 125 repository IDs,
mixed assignment counts, pagination/search selection, additive Add/Remove, отказ
для 1001 выбранного target и exact retry после потери ответа уже committed Apply.
Сохранены настоящие session/authorization/DB пути. GitHub transport ограничен
подписанным loopback fixture; production OAuth/SCM/provider/model traffic и
production database не использовались. Эта квалификация не является live
provider или native account-lifecycle доказательством.

Canonical sharing проверен через UI и persisted DB: `rr-e2e-skill-shared`
остаётся одним original с двумя workspace links; author revision 2 сохранена на
original и видна из linked workspace. Отдельный grant для `rr-e2e-skill-002`
принят destination с version 1. Revoke другого grant увеличивает его до version 2;
последующий private source head revision 3 не раскрыт repository-only writer.
Этот writer удаляет только выбранную revoked binding; соседняя binding на
`rr-e2e-repo-rr-e2e-org-alpha-002` сохраняется. Mobile editor Save/Close, summary,
bulk result, refresh и exact-retry actions читаются и доступны в footer; дополнительные
колонки таблиц доступны через horizontal scroll.

Квалификация выявила две причины ложных browser failures и сохранила их evidence:

- Disposable Chromium package содержит Lambda-oriented `fonts.conf`, указывающий
  на отсутствующие каталоги. Static control воспроизвёл zero-height text и failed
  WOFF2 load; исправление путей только в `/tmp` вернуло шрифты. Product source,
  dependencies и auth не менялись. Использован exact `@sparticuz/chromium@153.0.0`,
  Chromium `153.0.8010.0`, Playwright `1.64.1`; pinned browser CDN ранее вернул
  zero-length invalid ZIP, поэтому применён документированный executable override.
- `openLibrary` ждал только видимый SSR heading и мог отправить fill/click до
  hydration: trace показывал отсутствие соответствующих POST. Четыре строки в
  `skills.spec.ts` теперь ожидают существующий
  `html[data-dashboard-layout-ready="true"]`, как уже делает repository helper.
  Это harness-only fix в `fe16d1f`; bounded canonical-link regression прошёл
  **1/1**, затем выполнен свежий полный **7/7** run выше. Harness typecheck и
  `git diff --check` прошли; test hooks или ослабление product checks не добавлены.

Основной receipt directory:
`tmp/accounts-reference-e2e/runs/skills-final-pg17-fe16d1f75f91/`.
В нём сохранены `qualification-receipt.json`, `result.json`,
`playwright-result.json`, `runtime.json`, `boot-report.json`,
`fresh-cluster-preflight.json`, `migration-receipt.json`, `sharing-db-receipt.json`,
`skills-github-requests.json`, `visual-inspection-receipt.json`,
`migrations.log`, `next-app.log` и полный `synthetic-post-run.dump`.
Все 11 screenshot paths и их digests перечислены в visual receipt; среди них:

- `browser-artifacts/skills-Skills-real-Next-an-d9278-nauthor-admin-server-denial/skills-library-desktop.png`,
  `skills-library-mobile.png` и `skills-editor-mobile.png` в той же директории;
- `browser-artifacts/skills-Skills-real-Next-an-21b59-kill-pages-and-delta-remove/skills-bulk-result-mobile.png`;
- `browser-artifacts/skills-Skills-real-Next-an-6cd1b-retries-the-identical-delta/skills-bulk-unknown-mobile.png`;
- `browser-artifacts/skills-Skills-real-Next-an-2a720--only-and-author-edit-route/skills-linked-edit-saved-desktop.png`.

Неуспешные/частичные attempts и их synthetic dumps сохранены отдельно:
`tmp/accounts-reference-e2e/runs/skills-fresh-pg17-64ad9b16446c/` и
`tmp/accounts-reference-e2e/runs/skills-fresh-pg17-fonts-64ad9b16446c/`.
Bounded follow-up находится в
`tmp/accounts-reference-e2e/runs/skills-hydration-followup-64ad9b16446c/` и не
выдаётся за fresh migration proof. Final paired receipts:
`/tmp/review-skills-paired-finish-oct23/paired-all-five.log`,
`paired-results.json` и `migrations-isolated.log` в той же директории. Runtime
receipts в соседнем checkout `../review-router-skills/tmp/`:
`runtime-ocr-official-build.log`, `runtime-ocr-required-final-escalated.log`,
`runtime-ocr-native-mcp.log`, `runtime-final-official-export-artifacts.log`,
`runtime-final-official-export-typecheck.log` и
`runtime-final-official-export-gateway-check.log`.

Официальный combined export использует опубликованный canonical SaaS source
`7900c92cde056d3f4320beec13c8f7a84cb79d16` и expected published runtime base
`1381fa481bfba3755bf9135b243486505b5c2563`. Проверены **58 canonical generated
files + 1 handoff manifest = 59 files**. Handoff SHA256:
`560c6b7986cad36e1c1c57c59e077b7fc6f4bf5bb8c653896afd7271ad5dfe6a`.
Generated output получен штатным exporter, вручную не исправлялся. Ранее
зафиксированные scoped web/installer/migration/Foundation результаты сохраняют
свою область проверки и не подменяют свежие E2E receipts этого раздела.

На момент этого checkpoint runtime candidate существует локально как
`c7114856816ae087b66f720b697b0798b0a05af9`, tree
`e1e2a331338e02c14d8169819db020872b34a489`; его публикация выполняется отдельно.
Этот раздел **не утверждает**, что candidate уже опубликован, его remote CI
прошёл или оба PR merged. Окончательные remote pins/CI/merge должны быть
зафиксированы после наблюдаемого завершения этих операций. Production
deploy/release в рамках данной локальной квалификации не запускались.

## Финальная публикация paired runtime — 2026-10-23

Qualified runtime опубликован как
`ce30aaa2d1d318ac80d15a290b1f4b2dabc45c54`, exact tree
`e1e2a331338e02c14d8169819db020872b34a489`. Он побайтно совпадает с локальным
`c7114856816ae087b66f720b697b0798b0a05af9`, на котором завершены gates выше.
SaaS CI теперь использует этот опубликованный immutable pin вместо временного
main pin без Skills transport. Canonical export source остаётся
`7900c92cde056d3f4320beec13c8f7a84cb79d16`; последующие SaaS commits меняют
только qualification documentation и paired CI pin, без изменения product code.

GitHub connector ограничивает один запрос 16 MiB, поэтому oversized
`dist/index.js.map` опубликован через одноразовый content-bound Actions job.
[Run 39986618190](https://github.com/777genius/review-router/actions/runs/39986618190)
завершился успешно: штатный build подтвердил точный map blob
`acecb9e11d4239a573cdfc36b1c8261d7d698871` и полный qualified tree до push.
Final cleanup commit удалил временный workflow; опубликованный runtime содержит
ровно проверенное дерево. Required CI и build policy не ослаблялись.

Native duplication замечание получило
[ответ с fix и evidence](https://github.com/777genius/review-router/pull/297#discussion_r4361967861)
и закрыто через owner account `777genius`. Commit author/committer также
соответствуют owner identity. Окончательные remote required checks и merge
отслеживаются в [runtime PR #297](https://github.com/777genius/review-router/pull/297)
и [SaaS PR #635](https://github.com/777genius/review-router-ai/pull/635), отдельно
от локальных qualification receipts. Production deploy/release не входят в эту
публикацию feature branches.
