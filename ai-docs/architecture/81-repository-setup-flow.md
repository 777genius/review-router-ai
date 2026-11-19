# Настройка репозиториев: первый запуск и большие списки

Статус: план v5 (учтены ревью 1-4, §7). Дата: 2026-11-18. База: `origin/main` `ae18f9e87`. Только Web: без миграций, флагов, изменений worker и Gateway.

## 1. Факты (код и prod, только чтение)

- Prod: 8 из 9 активных установок App - на «all repositories». Четыре внешних workspace (372, 41, 15 и 12 репозиториев): 0 провайдеров, 0 событий аудита, 0 setup PR. Дошли ли они до дашборда, неизвестно, но дальше выбора провайдера никто не прошёл. 777genius: 460 репозиториев (352 выбраны и не в архиве), 19 настроены, 71 событие setup PR - всё по одному.
- Сводка (`dashboard-workspace-page.tsx:2127`) считает «Need setup» всё, что не ready, включая невыбранные, архивные и GitLab. Отсюда «Ready 5 / Need setup 455» янтарём (`:2049`). Порядок строк `selected desc, fullName asc` (`prisma-repository-connection-repository.ts:211`), видны первые 24 (`:706`).
- Порядок шагов в текстах неверен. `getting-started/page.tsx:61-78`, тост `app_installed` (`dashboard-copy.ts:168`) и ADR-014 ставят репозиторий раньше провайдера. Код требует провайдера первым (`resolve-review-configuration.ts:74`). При этом «Create setup PR» в строке без провайдера активна (`repository-setup-progress-panel.tsx:563-575`) и падает с `review_provider_selection_required`.
- Merge ловит webhook (`apps/api/src/github/prisma-setup-pull-request-merge-handler.ts`) и ставит `configured`. Но у Gateway `runtimeCompatibility` остаётся `unknown` до confirm из дашборда (`review-runtime-readiness.ts:209`, авторизация в `actions.ts:2527`). Поэтому `setupStep` (`effective-provider-readiness.ts:189-217`) откатывает строку на «1 of 4 - verification needed». «Нужна проверка» вычисляется в трёх местах UI (`repository-setup-progress-panel.tsx:114`, `dashboard-workspace-page.tsx:2607`, `:2633`).
- Разбор `setup=` повторён трижды (`dashboard-workspace-page.tsx:3364`, `search/route.ts:333`, `repository-live-search.tsx:708`). Тип, сопоставление и сериализация фильтра продублированы (`repository-search.ts`, `repository-live-search.tsx:37`, `:495`, `:668`). Предикат `github && selected && !archived` повторён в `dashboard-workspace-page.tsx:1334, 2402, 2453`. Route `/api/dashboard/repositories/search` продукт не вызывает с #697.

## 2. Состояния

Одна чистая функция `repositorySetupState` в новом `apps/web/src/features/repository-setup/repository-setup-state.ts` (по doc 37). Входы - уже собранные факты readiness (`step`, health, `workflowUpdateRequired`, готовность lane Gateway, статус чтения аккаунтов). Поле `readiness` в `dashboard-repository-readiness.ts` заменяется на `state`. Удаляются `repositorySearchReadiness` и мёртвый `summarizeWorkspaceHealth`. Сводка `summarizeWorkspaceSetupReadiness` переезжает в этот модуль. Проверки по порядку:

| Условие                                                                                                                         | Состояние                           |
| ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| не `isRepositoryAvailableForSetup` (GitLab, не выбран, архив)                                                                   | `unavailable`: вне счётчиков, внизу |
| health tone `danger` или `setupNeedsAttention` (закрытый PR, удалённая ветка, failed create)                                    | `attention`, как сейчас             |
| lane Gateway заблокирован (§3), либо lane готов, шаг `provider` и аккаунты прочитаны успешно                                    | `attention`                         |
| step `ready`                                                                                                                    | `ready`                             |
| нет записи provisioning и `setupStatus=not_configured`                                                                          | `not_set_up`: нейтрально            |
| остальное: PR открыт, проверка, обновление workflow (в том числе после смены провайдера), шаг провайдера, сбой чтения аккаунтов | `setting_up`                        |

Сбой чтения не поднимает строку до `attention`. Принятое ограничение, оно есть и сейчас: при сбое чтения аккаунтов Gateway ready-строки уходят в `setting_up` (`dashboard-provider-setup-readiness.ts:57`). Модуль владеет ещё `isRepositoryAvailableForSetup` (заменяет три копии выше; предикат «может управлять» без проверки GitHub - другое правило, его не трогаем), значениями `setup=attention|setting_up|ready|not_set_up`, их разбором и сериализацией, сопоставлением фильтра и порядком: `attention`, `setting_up`, `ready`, `not_set_up`, `unavailable`, внутри по имени. Порядок применяется один раз на странице. Выбранный в URL репозиторий, как и сейчас, первый (`:2377`). Раскрытая строка в URL не попадает, поэтому после `router.refresh()` она может переехать, в большом workspace - и за первые 24. Это принимаем: состояние строки видно в фильтре. Мёртвый route удаляется. Таблицу паритета из `route.test.ts:574-700` переносим в `dashboard-repository-readiness.test.ts`. `setup-status-authority.test.ts:53` и `review-runtime-readiness.spec.ts` переходят на страницу.

План 82 (шаг 5: перенос сводки и удаление `summarizeWorkspaceHealth`) пересекается с этим. Владелец - 81, из 82 шаг снимается.

## 3. Шаг после merge (только Gateway)

Правило заменяет только последний `return "setup_pr"` в `setupStep` (после `if (input.workflowCurrent) return "provider"`, `effective-provider-readiness.ts:215`). Тест «Gateway waits for its review authorization» (`effective-provider-readiness.test.ts:212`) не меняется. Условие: `setupStatus=configured`, провайдер Gateway, lane ещё не заведён (статус readiness «authority/identity missing»; точный набор сверить в `provision-gateway-review-v2-repository.ts:161-195`), нет `workflowUpdateRequired` → `merge_setup_pr`. Заблокированный lane (`paused`, `draining`, `legacy_migration_required`, `safety_blocked`, `authority_invalid`) уходит в `attention` строкой таблицы §2. Остальные `unknown` (rotating Codex, legacy `v1`, смена провайдера, не-Gateway без реестра релизов) не меняются. Gateway без реестра и без lane тоже попадает на шаг 2: действие то же, «Verify setup».

Домен отдаёт один флаг `verificationNeeded`; три места UI читают только его. Шаг 2 в этом случае: одна кнопка «Verify setup» (та же confirm, что «I merged it»), подсказка «Merged. Verify the workflow to start reviews.», сводка «2 of 4 - verify setup». На шаге 1 кнопки нет. Автоопроса нет: refresher не трогаем. Каждый confirm Gateway - это 11+ запросов к GitHub и запись аудита при блоке, а выигрыш - один клик.

## 4. Решения

| Идея                                                                                | Вердикт                  | Почему                                                                                                                                    |
| ----------------------------------------------------------------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Состояния, счётчики, порядок, один владелец фильтра                                 | DO                       | 455 ложных тревог, свои репозитории внизу, три копии разбора                                                                              |
| Шаг после merge без отката                                                          | DO                       | Человек смёржил и видит «1 of 4»                                                                                                          |
| Блок первого запуска, тексты, «Create setup PR» без провайдера выключена с причиной | DO                       | Здесь уходят новые workspace; тексты противоречат коду                                                                                    |
| Пакет «создать N, смёржить N, проверить N»                                          | DEFER, §6                | Внешние до шага 2 не доходят; один репозиторий после сортировки и так вверху                                                              |
| «Review all repositories»                                                           | DROP                     | Ревью нужен workflow-файл в каждом репозитории: сотни PR или правила организации (платный GitHub, legacy workflow). Переключатель бы врал |
| Авто setup PR при установке App                                                     | DROP                     | PR в чужих репозиториях без выбора - спам и CI-минуты                                                                                     |
| Авто default-провайдер                                                              | MERGE в тему провайдеров | Правило provider setup                                                                                                                    |
| Org-wide режим (`CODEX_AUTH_JSON`, 0 строк в prod)                                  | DEFER, отдельная уборка  | Принят в ADR-014. Удалять UI, пакет, worker и документы вместе, с поправкой к ADR; таблицу без миграции                                   |

## 5. UX до и после (новый пользователь, App на 372 репозитория)

До: тост «pick one» → «Ready 0 / Need setup 372» янтарём → «No default provider» → 24 строки «No provider yet / 1 of 4 - setup PR needed». Getting started: «сначала setup PR». Начнёшь с репозитория - «Create setup PR» нажимается и падает. После merge строка откатывается на «1 of 4», нужно раскрыть её и нажать «Verify setup».

После:

- Тост: «Repositories appear below as soon as the scan finishes».
- Шапка: «Ready 0 · Not set up 372» нейтрально; «Setting up» и «Needs attention» только если не ноль.
- Над таблицей «Get your first review», без номеров и вычисляемых отметок:
  - «Choose a provider»: та же `ProviderLine` или существующий текст «ask an owner or admin».
  - «Then create a setup PR in a repository row and follow its steps».
- Блок виден, пока у workspace есть доступные GitHub-репозитории и ни у одного нет записи provisioning или `setupStatus` кроме `not_configured`. Признак держится на записях и не мигает от сбоев чтения. Без блока и без default-провайдера `ProviderLine` остаётся над таблицей.
- Строка со статусом политики `provider_selection_required` (не `resave_required`): «Create setup PR» и «Verify setup» выключены с причиной «Choose a provider above first».
- После merge: «2 of 4 - verify setup», одна кнопка.
- Getting started и `app_installed`: сначала выбрать провайдера, потом репозиторий. Ключ API по-прежнему добавляется после merge. ADR-014 - история.

Кому хуже: закладкам `?setup=needed` (пользователей нет). Фильтр «Needs setup» делится на «Not set up» и «Setting up».

## 6. Шаги, тесты, деплой, отложенное

1. Один PR после 76: §2, §3, блок `repository-first-run-guide.tsx`, кнопка без провайдера, тексты, tone `neutral` у `ReadinessInlineStat`, Diagnostics без «/ 0 unknown».
2. Тесты (только рискованное):
   - таблица состояний на границах;
   - URL и порядок;
   - `setupStep` для Gateway `configured` + lane не заведён (шаг 2) и заблокирован (`attention`), и неизменность для rotating, legacy, без реестра и для существующего теста ожидания авторизации;
   - панель: на шаге 2 одна кнопка «Verify setup», на шаге 1 кнопки нет;
   - видимость блока: пустой список, только GitLab, не-админ, сбой чтения аккаунтов.
     Плюс перенесённая таблица паритета, tsc, eslint, prettier, тесты live search и панели.
3. Стенд `scripts/accounts-reference-e2e` на worker-хосте: одноразовый сид 400 синтетических репозиториев в `tmp/` (не коммитим) и скриншоты до и после. GitHub-эндпоинтов setup PR в фикстуре нет, поэтому шаг после merge проверяем живьём после выкладки на существующем одноразовом репозитории.
4. Деплой: обычная выкладка web, запись в `ai-docs/deployments/`. Без миграций, флагов, worker и Gateway.

LOC: код примерно +480/-520, тесты примерно +350/-1000 (route и его тест).

Отложено, дизайн готов. Выбор до 10 → диалог (PR в каждом, запустится CI, придут уведомления) → по одному чистым async-циклом со Stop → один `router.refresh()`. «Verify N merged» в шапке таблицы: N = шаг `merge_setup_pr`, фильтр `mutationsEnabled`/`canEditSettings`, ID снимаются в начале, `setup_pr_not_merged` - «not merged yet». Лимит `setupPrAttemptsPerWorkspacePer10Minutes` = 10 проверяется после `workflowReady`, отдельный код ошибки с временем сброса. Это не больше 50 записей в минуту и 300 в час при лимитах GitHub 80 и 500. Hosted-pool путь (`actions.ts:739`) - явное исключение, плюс строка на `fair-use`. Не проверено: на что GitHub считает 500 в час - на установку или на всё App.

Вне объёма: тексты `ProviderLine`, Connections (76), удаление org-wide, `isRecoverableSetupPullRequestError` против `isSetupRecoveryIssue`.

## 7. Что изменили ревью

- 1: удаление org-wide вынесено (ADR-014); таблица состояний; пакет отложен; лимит после `workflowReady`; порядок шагов в текстах; пределы стенда; модуль в `features/`.
- 2: факт про merge исправлен (webhook); «Check merged» отложен; failed create - `attention`; блок без вычисляемых отметок; удаление мёртвого route; общий предикат доступности.
- 3: шаг после merge сужен до Gateway и одного флага; вместо «уже работал» - явные факты, сбой чтения не красит; закрытый PR остаётся `attention`; пересечение с 82; потребитель route в `setup-status-authority.test.ts`; кнопка без провайдера; «Reviewing» → «Ready».
- 4: правило шага 2 стоит после ветки `provider` и только для незаведённого lane; заблокированный lane - `attention`; одна кнопка «Verify setup» на шаге 2; автоопрос убран (стоимость confirm); кнопки выключаются по `provider_selection_required`; сид - разовый в `tmp/`.
