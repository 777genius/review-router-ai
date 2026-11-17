# Режим взаимодействия ревьюеров: вместе или по очереди

Статус: план v3 (учтены два раунда независимого ревью). Поставка 1 (этот репозиторий) реализуется сразу; поставка 2 - отдельный межрепозиторный проект.
Дата: 2026-11-17. Меняет для режима fallback правило «не продвигать соседа и не выбирать запасную модель» из [плана нескольких ревьюеров](../plans/2026-10-28-gateway-multi-reviewers.md): запасной ревьюер появляется только по явному выбору пользователя.

## 1. Как работает сейчас (исследование)

- Политика хранит упорядоченный список `providers` (stored schema 4, `review-policy-document.ts`). Runtime-конфигурацию (schema 3, `review-configuration.ts`) строит `resolveEffectiveReviewPolicy`. Индекс 0 - primary: описание PR, lifecycle, `SYNTHESIS_MODEL`.
- Несколько ревьюеров в одном прогоне SaaS допускает только all-Gateway roster: снимок v4 (`captureMultiple`, `apps/api/src/review-run-runtime-snapshot.ts`) захватывает всех и ставит каждому `required: true`. Direct и Hosted Pool требуют ровно одного провайдера.
- Ансамбль исполняет публичный runtime `777genius/review-router`: для v4 - `RunT0ReviewOrchestration` (lane на ревьюера, `maxParallelReviewers`), для env-пути - `core/orchestrator.ts` и `LLMExecutor.execute`. Находки объединяются, `inlineMinAgreement` задаёт согласие. В runtime уже есть `FALLBACK_PROVIDERS` с другой семантикой (замена на health-check и бесплатные модели); путь direct v2 его отвергает.
- SaaS-финализатор (`deriveCoverageState`, `review-executions`) считает ревью полным, только если каждый required-слот satisfied.
- Вывод: таймаут, 429, auth- или model-ошибку в середине прогона видит только runtime, а SaaS отметит слот упавшего ревьюера как непокрытый. Настоящее переключение требует согласованных изменений протокола, runtime и покрытия в `review-executions` (поставка 2).

## 2. Модель (поставка 1)

- Владелец: `review-configuration.ts` - `reviewProviderModes = ["parallel", "fallback"]`, схема, тип `ReviewProviderMode`, `defaultReviewProviderMode`.
- Хранение: поле `providerMode` в документах workspace и repository рядом с `providers`. Хранится только `"fallback"`; отсутствие = `parallel`. Существующие документы, версии и digest не меняются, миграции нет. `providerMode` без `providers` - ошибка схемы.
- Режим принадлежит списку: эффективный режим берётся из документа, чей `providers` эффективен. Override репозитория заменяет список вместе с режимом; «Use workspace reviewers» снимает оба.
- Запись идёт через доменные `withProviderSelections` (новый режим или режим документа) и `withProviderRoster`/`providerRosterOf`. Режим задаёт только редактор списка (`manage-provider-rosters.ts`). Сохраняют режим: формы review settings (поле исключено из `WorkspaceReviewSettings`/`RepositoryReviewSettings`), одиночные операции (default, назначение, удаление одного ревьюера), операторская запись reasoning effort и переключение Hosted Pool (оба копируют унаследованный список вместе с режимом). Очистка списка снимает режим. Смена одного только режима считается сменой выбора: проходит ту же авторизацию профилей (`sameProviderRosters`) и пишется в аудит (`metadata.providerMode`).
- Материализация отдаёт три факта эффективного списка: `config` - что исполняет прогон; `rosterConfig` - тот же конфиг со всеми ревьюерами, ровно как его исполнил бы parallel (с сохранёнными лимитами); `selections` в порядке `rosterConfig.providers`; `providerMode`. В parallel `config === rosterConfig`. В fallback с 2+ ревьюерами `config.providers = [первый]`, `execution = { providerLimit: 1, providerMaxParallel: 1, inlineMinAgreement: 1 }`.
- Новых полей в runtime-конфигурации и снимках прогонов нет: `config` fallback-списка - обычный конфиг одного провайдера. Поэтому откат кода не ломает уже допущенные прогоны и учёт usage (снимки неизменяемы).
- Digest, `revisionToken` и сверка снимков считаются по `config`. Правка только хвоста повышает версию, но не digest. CAS записи сверяет digest `config`; хвост проверяется валидатором до транзакции, а внутри неё - материализацией и `assertGatewaySelections` (узкое окно для каталога и agent profile принято).
- Проверки при записи (`EffectiveReviewConfigurationValidatorPort`), смене модели профиля, `assertGatewaySelections` и подгрузка Gateway-аккаунтов дашборда идут по `rosterConfig`. Допустимость fallback-цепочки совпадает с parallel-списком (сегодня - только Gateway для нескольких ревьюеров), её лимиты остаются валидными для обратного переключения.

## 3. Семантика выполнения в поставке 1

- `parallel`: поведение и байты runtime-конфигурации прежние.
- `fallback`: в прогон уходит только первый ревьюер - обычный одиночный прогон; его `requiredHealthy` работает как у одиночного провайдера. Остальные не запускаются и не тратят квоту. Сознательное расширение: список из нескольких Gateway в fallback проходит пути для одного провайдера (v3-снимок, `codex_gateway_single_provider_required`), env прогона - `REVIEW_PROVIDERS` с одним ревьюером и `PROVIDER_LIMIT=1`.
- Чего ещё нет: при сбое первого ревьюера ревью падает. UI говорит это прямо.
- Fallback-список из одного ревьюера в конфиге неотличим от parallel; режим виден в документе и в `providerMode`.

## 4. Поставка 2: переключение при сбое (целевая семантика)

- Переход к следующему: lane не дал принятого результата по своим слотам из-за квоты (429, `provider_capacity_unavailable`), auth провайдера (`provider_authentication_unavailable`), таймаута попытки, недоступной модели (`model_settings_unavailable`, 404), bootstrap-сбоя движка, исчерпания попыток structured output. Точную границу для `allocation_unavailable` (исчерпан бюджет против отзыва binding) зафиксировать кодами.
- Стоп без переключения: найденные проблемы и блокирующий вердикт, отмена, supersede или смена ревизии, отзыв авторизации прогона, общий дедлайн, run-scope ошибки.
- required/optional: цепочка - одна required-единица покрытия. Ревью полное, если один член цепочки покрыл все свои слоты; если упали все - failure. Публикуются находки только этого ревьюера, agreement = 1. Per-reviewer `requiredHealthy` в fallback не используется. Нужно решить: кто primary для описания PR после переключения и какой бюджет времени у каждого члена при общем `RUN_TIMEOUT_SECONDS`.
- Изменения: снимок v4 захватывает цепочку и режим; reviewer plan v2 и новый профиль продюсера. Gate по capability обязателен: старый runtime молча применяет незнакомые env-ключи (`isSafeRuntimeEnvKey` - запрет, а не разрешённый список) и запустил бы ансамбль. Далее: `RunT0ReviewOrchestration` - lanes по порядку и пропуск после успеха; `deriveCoverageState` - покрытие цепочки по vote lanes; env-путь - последовательный режим; workflow provisioning учитывает хвост. Парный релиз и регистрация продюсера - по release source of truth. После этого ветка «только первый» из раздела 3 удаляется.
- Промежуточный вариант без runtime (не входит в поставку 1): при admission брать первого допустимого члена цепочки (binding активен, модель в каталоге, лимит не исчерпан) через существующий `capture(..., reviewerIndex)`; выбор должен быть детерминированным для сверки снимка.

## 5. UI

- Редактор ревьюеров (`gateway-reviewer-roster.tsx`), общий для workspace и репозитория. `SelectField` «How reviewers work together»: «Together, in parallel» (по умолчанию) и «Fallback in order». Подсказка под селектом:
  - parallel: «Every reviewer checks each pull request and their findings are combined.»
  - fallback: «Only the first reviewer runs. Any others wait below, in order, as backups. Automatic switching to the next one when a review fails is not available yet.»
- Fallback: кнопки «Move reviewer N up/down» (`Button` + иконки, работают с клавиатуры), бейдж «Primary» у первого и «Fallback» у остальных; Max parallel и Inline agreement скрыты. Parallel: как сейчас, без кнопок порядка (так просил владелец).
- Форма workspace review settings в fallback не показывает parallel-лимиты, сохранённые значения уходят скрытыми полями. Форма репозитория уже считает ревьюеров по эффективному `config`.
- Редактор открывается с режимом своего списка: workspace, собственный список репозитория или унаследованный; массовое назначение начинает с parallel. Сводки в списке провайдеров режим пока не показывают.
- View-модель (`provider-setup-view.ts`) отдаёт режим workspace и каждого репозитория. Визуальные правила - [frontend workflow](../design/frontend-workflow.md).

## 6. Совместимость, миграция, откат

- Без миграции БД, без новых runtime env и без новых полей в runtime-конфигурации и снимках.
- Откат кода затрагивает только документы с `providerMode`: старый код их не прочитает (strict schema), цели получат `resave_required`. Перед откатом обрезать такие списки до первого ревьюера (поведение не меняется) или откатываться вперёд. Не переключать их в parallel: это запустит ансамбль и умножит расход квоты.

## 7. Проверка

- `review-config`: хранение (только fallback, отказ без `providers`), материализация (`config` с одним ревьюером, `rosterConfig` с сохранёнными лимитами, env одного провайдера), наследование режима со списком, сохранение режима формой настроек и операторской записью, отказ при невалидном запасном ревьюере, Hosted Pool по всей цепочке. Неизменность parallel проверяет существующий тест: конфиг и digest равны описанному литералу (не зашитому хэшу).
- Web: редактор (селект, порядок, скрытые поля, payload, режим наследующего репозитория, «Use workspace reviewers» без режима).
- `tsc` для `review-config`, `workflow-provisioning`, `apps/web`, `apps/api`; eslint и prettier по изменённым файлам; vitest затронутых наборов. Postgres-тесты писателей (там проверяются `assertGatewaySelections` и новые поля результата) и E2E прогона локально не запускались, их покрывает CI.

## 8. Вне объёма

Поставка 2 и релиз runtime; смешанные цепочки Gateway + direct; веса, отдельные таймауты, drag-and-drop.

## 9. Риски

- Пользователь ждёт переключения, а в поставке 1 его нет. Смягчение: явная подсказка в UI.
- Выход поставки 2 изменит поведение сохранённых fallback-списков (запасные начнут запускаться): описать в changelog.
- Откат кода после сохранения fallback-документов (раздел 6).

## 10. Ревью

| Раунд | Ревьюер               | Блокирующее                                                                                                                                                            | Решение                                                                                                                                                                                |
| ----- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | opus-reviewer (xhigh) | хвост в неизменяемых снимках ломает откат; нет режима в результате (падение Hosted Pool, тихий parallel); хвост не проверяется; неверное утверждение про env; текст UI | хвост не попадает в runtime-конфиг; `rosterConfig` и `providerMode` в результате; проверки по `rosterConfig`; исправлены env-текст и подсказка                                         |
| 2     | opus-reviewer (xhigh) | нет (approve with nits)                                                                                                                                                | смена одного режима проходит авторизацию; тест на валидацию хвоста и UI-тесты; аккаунты дашборда по `rosterConfig`; массовое назначение с parallel; текст подсказки; уточнения в плане |
