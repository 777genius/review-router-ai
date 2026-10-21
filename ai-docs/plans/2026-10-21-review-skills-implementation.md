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

Production build сохраняет штатный TypeScript 6.0.3. Дополнительный gate явно устанавливает isolated TypeScript 7.0.2 и запускает `typecheck:native`; production Docker не зависит от локального opt-in install. Foundation tooling имеет отдельные pnpm 11.25.0/lock и использует существующие четыре точных version exceptions; root pnpm 10.33.0/lock не изменяются этой установкой.

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

`SKILLS_PG_URL`/`ADMISSION_PG_URL` должны указывать на отдельные disposable PostgreSQL 17+ fixtures; не на production. Миграции применяются до тестов. Полные setup/commands браузера — в `scripts/accounts-reference-e2e/README.md`, opt-in `--skills-fixture`. Для первого `pnpm` здесь используется repository pin 10.33.0; nested tooling сам выбирает 11.25.0.

В runtime actual CLI gate требует собранный binary и `REVIEWROUTER_OCR_REQUIRED=1`; точная команда есть в `docs/review-skills.md`. Отсутствие fixture при required flags вызывает failure, а не успешный skip.

## 5. Commit identities и CI

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

Production deployment, публикация release assets и регистрация новых qualified producer profiles выполняются существующим release process после review. Правильный порядок: additive DB/server → новый qualified runtime/profile → включение назначений для поддерживаемых репозиториев. Эти PR не выполняют merge/deploy и не изменяют production credentials.

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
