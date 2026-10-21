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
| Scoped GM/Foundation/FMS                                            | Passed: 82 FMS cases, namespaces/wiring oracle и реально отвергаемая mutation dependency direction |
| Existing architecture boundaries                                    | Passed: 574 domain/application files                                                               |
| Official protocol gate                                              | Passed: deterministic/current generated bytes и связанные build/typechecks                         |
| SaaS Action build и официальный artifact smoke                      | Passed: source parity обоих `action-dist` artifacts                                                |
| Runtime real OCR CLI loopback                                       | 10/10 passed; проверены actual main/plan request bodies, built-ins, scopes и inventory             |
| Runtime final Skills + required OCR CLI batch                       | 21/21 passed                                                                                       |
| Independent runtime Skills/native/OCR adapter suites                | 52/52 passed                                                                                       |
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

- SaaS functional integration checkpoint: `03c94f32ce4a5147336681502742e4385c1827d5`.
- Paired runtime checkout: `4aae5bd7e1c62cfa6852209ca78799d2e5e14132`; этот immutable SHA установлен только в paired CI lane. Published hosted-pool baseline и stable tags не перемещены.
- Canonical contract source: `e8d083c20c9cb2a8a0262842940538afec636088`; official handoff digest `df098a0fdd988f56388a1cb613d122592e80a43ce14ed08590c3f91256243620`.
- OCR Linux amd64 binary: `0553daafe39d7a9d7608f0d37b26d55c11d07b9d5bbfc5b36b0778f9cd9f3df5`, pinned upstream `8eb83340a487b1150af00701b94f01af97e4b4d6`, Go 1.26.9, rr.4 и десять patches.

CI теперь содержит отдельную Skills PostgreSQL fixture, scoped tooling/native compiler gates и signed HTTP proof после verified paired checkout. Runtime CI собирает настоящий OCR в temporary directory, сравнивает полный manifest и запускает существующий Jest с required binary. Browser qualification остаётся явным локальным real-browser lane; автоматического browser CI pass этот документ не заявляет.

Ранние remote runs обнаружили и помогли исправить generated-parser lint, stale Action artifact, current migration count, неизвестный additive checkout tail, неустановленный opt-in compiler в Docker и ошибочное `--ignore-workspace` у nested tooling. Их failure не выдаётся за финальный pass. Полный Docker PG16→PG17 rehearsal и все remote jobs оцениваются по финальному SHA в GitHub; локальные bounded proofs не заменяют их.

## 6. Границы выпуска

Поддержаны Gateway OCR/native и verified direct OpenRouter. Older Secrets/Hosted без admitted-input seam сохраняют legacy producer; назначения Skills вызывают `skills_engine_unsupported`. Это явно показано в runtime transport matrix.

Формат v1 — текст и ограниченные Markdown references. Нет запуска scripts, установки dependencies, новых tool permissions, transitive sharing, marketplace, ручного Publish/semver или двусторонней Git/web sync. Provenance подтверждает передачу инструкций, но не доказывает соблюдение каждой инструкции моделью.

Production deployment, публикация release assets и регистрация новых qualified producer profiles выполняются существующим release process после review. Правильный порядок: additive DB/server → новый qualified runtime/profile → включение назначений для поддерживаемых репозиториев. Эти PR не выполняют merge/deploy и не изменяют production credentials.
