# Целостная настройка провайдера и репозитория

Дата: 2026-10-26. База: `4c8f2804b5e53795ec8dd51d51d3b3b6c7d28188`.
Статус на 2026-10-27: основной план v3 влит пользователем в PR #717; сохранение `TMPDIR` для migration child влито в PR #720. Повторная лёгкая визуальная проверка и исправления описаны в разделе 10. Обязательная real-app E2E-квалификация остаётся незавершённой: 0 accepted passes.
Продолжение [исправления API-provider UX](2026-10-26-provider-settings-ux.md), PR #712.

## 1. Цель и критерий простоты

Пользователь понимает, где заканчивается сохранение профиля и где заканчивается настройка конкретного репозитория. Codex в GitHub Secrets является способом подключения внутри существующего repository setup, а не самостоятельным мастером с собственной готовностью. Открытие формы не меняет состояние подключения.

Сохраняем существующие страницы, provider registry, общий диалог, repository stepper, серверную авторизацию и readiness. Не строим универсальный wizard, новый onboarding service или новую систему состояний. Изменения сосредоточены в представлении, навигации и явных действиях пользователя.

## 2. Карта текущего продукта

| Раздел                        | Ответственность                                                                                             | Что не означает завершение этого шага                                           |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Repositories                  | Выбор провайдера для конкретного репозитория, setup PR, merge, подключение credential и проверка готовности | Сохранение выбора ещё не означает установленный workflow и доступный credential |
| Providers                     | Переиспользуемые профили: credential source, модель, workspace default, использование                       | Добавление профиля/default не устанавливает секреты во всех репозиториях        |
| Accounts (`/dashboard/setup`) | Подключение аккаунтов и API-ключей к ReviewRouter, доступ workspace, reconnect                              | Подключённый аккаунт ещё нужно выбрать для ревью                                |
| Model (`section=policy`)      | Workspace default и поведение ревью                                                                         | Не является отдельным способом хранения credentials                             |

Каноническое место завершения: `/dashboard?section=repositories&workspace=<id>&repository=<owner/repo>`. Параметр repository уже раскрывает нужную строку из доступного серверу списка. Для workspace-result ссылка ведёт в Repositories того же workspace без выдуманного target.

Существующий API-key continuation Providers → Accounts → Providers передаёт проверяемые `provider/storage/workspace/repositoryIds`. Сохраняем его и защиту от чужого target. Hosted Pool и GitLab имеют отдельные ограничения; в этом изменении их не перестраиваем.

## 3. Подтверждённые проблемы

1. `RotatingProviderDelivery` автоматически POST-ит `setup-command` при открытии. Это мутация: issuance может перевести активный Codex provider в `setup_pending`. Просмотр подключения должен быть чтением.
2. `Verify setup` сейчас требует предварительно полученную команду, хотя backend умеет проверить/активировать уже установленное подключение самостоятельно. Возврат после merge не должен начинать reseed.
3. `expiresAt` не показан. Это **срок начала команды**, а не срок жизни уже запущенного installer: после fetch действует отдельное ограниченное окно восстановления. Нельзя автоматически заменять команду по таймеру.
4. Modal повторяет общий маршрут настройки и использует `rotatingPreparationOnly`, вычисленный по старому provider summary. При выборе нового Codex или переходе из другого entrypoint инструкции могут описывать не тот этап.
5. Repository stepper показывает пользователю внутренние `namespace`, `seed`, `activation` формулировки.
6. Workspace save/default закрывает форму без понятного следующего шага; несколько подписей обещают начало ревью раньше подготовки репозитория.
7. Claude использует правильный общий secret delivery, но последовательность «выполните команду / сначала получите токен» стоит разделить. Названия subscription-вариантов перегружены.
8. Accounts отправляет выбирать подключения в Models, хотя Providers уже является каталогом профилей.
9. Два optimistic consumer (`repository-setup-progress-panel` и `repository-setup-optimistic-status`) сейчас способны показать Ready после подтверждения секрета даже до merge workflow. Это относится к общей корректности onboarding и исправляется минимальным presentation guard.

## 4. Целевой пользовательский маршрут

### 4.1. Репозиторий — основной путь

Пользователь раскрывает Setup у репозитория. Общий Provider dialog выбирает источник и модель; credentials открываются как подзадача этого же setup. Создание/merge workflow остаются в существующем stepper. После работы с credential явная ссылка **Back to repository setup** возвращает к той же раскрытой строке и актуальным серверным данным.

Для GitHub API-ключей и Claude сохраняем порядок setup PR → merge → Add secret → Check GitHub setup. Для Codex сохраняем требуемый протоколом порядок: подключить credential → создать/merge setup PR → проверить подключение. В stepper это объясняется обычными словами, без нового отдельного списка глобальных шагов в modal.

### 4.2. Codex — открыть, проверить или явно подключить

- При открытии читать существующий `useProviderSecretStatus` с rotating auth mode. Этот read уже проверяет exact readiness и не выдаёт команду. Не использовать `setup-recovery.status=ready` как доказательство подключения.
- Показать проверенное подключение, отсутствие подтверждённой готовности или невозможность прочитать статус. `missing` не доказывает, что credential отсутствует: он может ждать merge.
- Для rotating Codex при открытии получать актуальный read, не выдавать cached результат за новую проверку. Перед issuance/recovery сбрасывать старое confirmation/success, отменять или игнорировать начатый до мутации status-read. После ответа обновлять точный repository/auth-mode query и существующую серверную проекцию родителя. При потере ответа оставлять явный неизвестный исход; старый кеш не восстанавливает зелёный статус. Check, issue и recovery не выполняются одновременно.
- **Check GitHub setup** доступен без issuance и вызывает существующий confirmation endpoint. Он проверяет workflow/credential activation, а не ответ модели. Успех использует существующие scoped events и query invalidation.
- **Get setup command** вызывается только явным действием. Для уже подключённого состояния переподключение — вторичное явное действие с объяснением, что оно заменяет подключение и требует повторного завершения setup. Никаких мутаций при mount, refetch, смене tab, таймере или открытии деталей.
- Последствие объясняется до нажатия: **сам запрос новой команды** может приостановить прежнее подключение, ещё до выполнения команды в терминале. Сетевой неизвестный исход не равен отсутствию серверной мутации. Повтор recovery сохраняет тип операции и request ID до определённого результата.
- После выдачи показать команду, название репозитория и **Start this command by …** в локальном времени браузера. После deadline объяснить: не начинали — запросите новую; уже запущена — дайте ей закончить и продолжите setup. Не скрывать команду и не прерывать installer по клиентским часам.
- Запрос новой команды остаётся ручным и проходит текущую серверную проверку. Не обещать продление: сервер может вернуть ту же действующую команду, ожидание или recovery_required.
- Если пользователь уже выполнил команду, приоритет у возврата в repository setup и проверки после merge. Не создавать новый credential ради проверки.
- Сохранить явное recovery acknowledgement, стабильный request ID для повторной попытки, запрет конкурирующих действий и обработку поздних ответов. После неизвестного результата сети не заявлять, что сервер ничего не изменил.
- Maintenance, mutation conflict, recovery и operator-required показывают соответствующее следующее действие. Не предлагать автоматическое recovery или бесконечный retry.

### 4.3. Убрать вторую модель прогресса

Предпочтительный минимальный вариант: убрать presentation-only `rotatingPreparationOnly` и условный повтор полного workflow в credential modal. Modal всегда объясняет собственную задачу, а точный следующий шаг определяется существующим repository stepper после возврата. Таким образом не нужно добавлять новый lifecycle API, передавать копию изменяемого workflow state или размораживать выбранный target.

Если критики обнаружат обязательную потребность в stage-specific copy, использовать только уже разрешённый сервером setup stage; никогда не вычислять его по старому provider name. Identity открытого target и выбранный bulk-набор должны оставаться зафиксированными.

Подтверждение credential может обновить его статус, но продвигает общий repository setup в Ready только когда workflow уже завершён. На `setup_pr`/`merge_setup_pr` оба существующих optimistic consumer сохраняют незавершённый workflow-шаг и запрашивают актуальные серверные данные. Применить один небольшой общий guard к текущему effective step, включая уже полученный merge event; не создавать вторую readiness-модель и не менять backend confirmation policy. Refresh с тем же исходным step не должен оставлять ложный зелёный статус.

### 4.4. Providers и Accounts

- В Providers/default заменить обещание немедленного ревью точным описанием назначения профиля.
- После workspace add/default — компактное подтверждение сохранения и ссылка **Finish repository setup**. Это результат существующего диалога, не новая страница/wizard. Один repository продолжает переходить в credential step; bulk сохраняет существующий result список.
- При переходе к workspace-result перевести focus на его заголовок или основное действие. Закрытие использует обычный focus return общего Dialog. Ссылка к конкретному репозиторию вызывает настоящую навигацию/обновление серверного состояния, даже если URL совпал; простого скрытия устаревшего modal недостаточно.
- В Provider picker: **Claude Code · GitHub Secrets**, **Codex · GitHub Secrets**. Поддерживаемые источники не меняются. Отдельная короткая подпись объясняет token для Claude и repository-only/automatic refresh для Codex. Не добавлять фиктивный выбор storage и не называть session «API key».
- Claude: сначала получить token, затем выполнить подготовленную команду сохранения, затем проверить secret availability. API-key instructions используют те же общие компоненты.
- Accounts cross-link ведёт в Providers с сохранением workspace. Существующий targeted API-key return остаётся приоритетным и сохраняет repositoryIds.
- Если API-провайдеру разрешён только один storage, начальный выбор должен попадать в доступный вариант. Это локальная коррекция выбора, без изменения policy.
- Явный разрешённый incoming storage intent сохраняется. Если оба варианта недоступны, показать причины и держать save disabled, не выбирать запрещённый источник автоматически.

## 5. Граница изменений и архитектура

### В scope

- `apps/web/app/dashboard/provider-setup/`: общий диалог, credential delivery, API adapter, результат сохранения и подписи списка.
- `apps/web/src/features/provider-setup/`: маленькие существующие presentation helpers/labels при необходимости.
- `dashboard-workspace-page.tsx`, `repository-setup-progress-panel.tsx`, `repository-setup-optimistic-status.tsx`, section copy: согласованные ссылки/инструкции и общий небольшой guard против ложного Ready до merge.
- Существующие frontend/route tests и `scripts/provider-setup-visual`: узкие сценарии и снимки.
- Этот план, протокол двух кругов критики и фактическая квалификация.

### Вне scope

- OAuth/token/secret formats, issuance/recovery policy, epoch/fence/nonce/claim semantics, refresh и runtime; новые endpoints и DB migrations.
- Workflow ABI, Action pins, OIDC, GitHub App publication, реальный секретный material и настройки production.
- Перенос credentials между GitHub и ReviewRouter; новая storage capability; объединение Hosted Pool/GitLab с обычным provider flow.
- Перестройка sidebar, Pages/Accounts architecture, универсальная framework-абстракция, новые зависимости.
- Изменения соседних PR по Memory/Skills/CI. Основание ветки обновляется с сохранением их изменений.

**Правила реализации:** переиспользовать shared UI; чтения через существующий React Query adapter, чувствительную одноразовую команду держать только в памяти открытого компонента. Не помещать её в query cache, URL, local/session storage или логи. Серверные решения не дублировать в браузере. API вызовы/response validation — в существующем client adapter. Не смешивать persisted profile, secret metadata, workflow readiness и inference success.

## 6. Проверки и реальные границы E2E

### Критичные frontend/contract проверки

1. Открытие, повторное открытие и статусный refetch Codex дают ноль issuance/recovery POST; готовое подключение не сбрасывается.
2. Проверка после merge работает без получения команды; failure/unknown не создают Ready.
3. Выдача только по нажатию; показ deadline; истечение/возврат вкладки не отправляют POST. Начатая команда не объявляется отменённой.
4. Fetched/recovery_required, maintenance, conflict, network ambiguity; acknowledgment не выставляется автоматически; повтор recovery сохраняет request ID; параллельные действия блокируются.
5. Поздний ответ не попадает в другое открытие/репозиторий; одноразовая команда очищается при закрытии.
6. Создание workspace profile/default сохраняет идентичность и указывает реальный следующий шаг; API-key branch и bulk остаются корректными.
7. Настройка другого provider → Codex до setup PR не использует устаревшие инструкции; возврат открывает верный репозиторий.
8. Сохранить проверки authz, repository-only, существующих manifest/recovery/readiness контрактов. Не расширять тесты всей системы без конкретного риска.
9. Ready → explicit issue/recovery → not-ready/неизвестный сетевой исход + поздний pre-issue read: прежний Connected/Confirmed не возвращается; актуальная отдельная проверка может восстановить успех.
10. API-key и Claude secret confirmation на `setup_pr`/`merge_setup_pr` не продвигает ни pill, ни панель, ни settings gate в Ready; повторный server refresh с тем же step не меняет этот результат. После настоящего merge/подходящего текущего шага успешное подтверждение продолжает работать.

### Браузер и визуальная проверка

Переиспользовать `scripts/provider-setup-visual`: реальные Next, PostgreSQL 17, подписанные sessions, server actions, профиль/настройки/авторизация; внешний GitHub — существующая ограниченная metadata fixture. Выполнять последовательно, с конкретным `--only`, без всей декартовой матрицы.

- Claude: repository row → provider choice → Add secret; missing не Ready; контролируемый secret найден → check → после reload сохранённое состояние корректно.
- Workspace add/default → подтверждение → Repositories того же workspace; сохранение не объявляет неподготовленный workflow готовым.
- Codex: настоящая repository UI, существующие command/recovery endpoints перехватываются для детерминированных состояний; exact request counters, deadline через browser clock, retry/recovery, read-only reopen, verify without issue, scoped return. Confirmation на неподготовленном fixture проходит настоящий сервер и обязан отказать без ложного Ready. Синтетическая команда нефункциональна. Это browser state acceptance, не live OAuth/rotation.
- Обычный seeded `providerSetupState=configured` недостаточен для rotating readiness. Позитивные Connected/Verify-success и stale-cache races квалифицируются отдельно в component tests с явно контролируемым status/confirm adapter; backend positive activation/readiness — существующими contract tests. Не выдавать синтетический optimistic success за end-to-end активацию. Не расширять seed до новой native lifecycle системы.
- 6–8 значимых screenshots: 1440/390, светлая/тёмная темы; Codex initial/issued/deadline/recovery, Claude instructions, workspace next step и repository progress. Проверить overflow, длинную команду, scroll, focus/keyboard, loading/error/disabled.
- Прогнать относящиеся к границе реальные server route/manifest/recovery tests отдельно. Нативная авторизация/rotation не меняются; не строить новый native fixture ради UI и не заявлять новое live-подключение без такого прогона.

Обязательный run фиксирует точные flow IDs и проверяет **каждый required flow = pass, required skipped = 0, pageErrors.length = 0**; все required screenshots = captured, без suspect/failed. Нулевой выбранный набор или набор из одних skips не считается успехом. Проверить `network.githubUnhandled`/`network.blocked`; неожиданные запросы исправить или явно объяснить. Сохранить exact Git revision и dirty-delta provenance. Достаточна узкая проверка manifest результата, без переписывания harness. Для ограничений памяти параметры задаются самому дочернему Next: harness намеренно очищает внешние env, поэтому parent `NODE_OPTIONS` не является доказательством эффективного heap cap.

Если среда ограничивает Next/PG, сначала использовать безопасно воспроизводимые собственные caches и последовательный запуск; не удалять чужие worktrees/evidence и не обходить проверки. Component preview может дать визуальное evidence, но не подменяет успешный app E2E. В итоговом отчёте точно разделить passed, blocked и controlled boundaries.

## 7. Последовательность работы и критерии завершения

1. Запушить этот план и открыть PR сразу; application code пока не менять.
2. **Круг критики 1:** параллельно UX/navigation, lifecycle/regression, E2E/scope. Для каждого замечания записать решение и исправить план.
3. **Круг критики 2:** повторно проверить исправленный план, особенно автоматические мутации, deadline, неизвестный статус, общий repository flow и размер изменений. Закрыть существенные замечания до реализации.
4. Реализовать небольшими коммитами: shared navigation/copy; явные Codex действия/deadline/recovery; targeted browser/contract acceptance. Пушить по готовности каждого связного изменения.
5. Запустить сфокусированные проверки и визуально просмотреть снимки. Исправить выявленные проблемы.
6. Независимое ревью итогового diff по UX, lifecycle и доказательствам; исправить все подтверждённые замечания и повторить затронутые проверки.
7. Сверить latest main и exact итоговый tree; записать результаты в PR. Не ждать очередь CI по ранее данному указанию пользователя: использовать фактическую локальную квалификацию, не подделывать checks и не менять branch protections. Если появились реальные CI failures — разобрать их.
8. Замержить обычным GitHub merge с ожидаемым head SHA; проверить main и чистоту собственного checkout. Production deploy не входит в данный запрос.

Готово, когда у репозитория один понятный маршрут завершения, просмотр Codex не мутирует подключение, deadline/recovery не противоречат серверу, profile save не обещает readiness, meaningful app/browser tests и ревью подтверждают итог. Откат — revert этого UX-коммита; форматы данных и runtime protocol не меняются.

## 8. Протокол критики и квалификации

- v1: карта текущих entrypoints и lifecycle проверена по исходникам, опубликована до реализации.
- Круг 1: три независимые перспективы (UX/navigation, lifecycle, validation). Направление принято; P1 нет. Подтверждены и включены: общий guard от Ready до merge; сброс/перечитывание status после mutating issuance и неизвестного результата; честная граница Codex browser-positive; required-flow gate без skips; focus результата; доступный storage fallback. Все три критика поддержали удаление `rotatingPreparationOnly` вместо новой модели этапов.
- v2: перечисленные замечания исправлены; передан на круг 2.
- Круг 2: все три критика дали GO, оставшихся P1/P2 к плану нет. Подтверждены простота удаления preparation-only copy, неизменность серверной политики и достаточность разделённых qualification boundaries. Дополнительно принят обязательный `pageErrors.length=0` в узком result gate.
- v3: план принят; реализация начинается после двух полных review rounds. PR #717 открыт, изменения пушатся по готовности.
- Реализация завершена в PR #717. Application source зафиксирован в `b21af247c8c5f35d64267434a83fa49e94ea2911`; последующее изменение этого документа не меняет проверенный код.
- Независимое source review: найденные P2 исправлены — native return на тот же URL теперь действительно перезагружает документ; unavailable API-provider option объясняет обе причины; старый успешный статус Codex не возвращается после rejected или offline-paused fresh read. Код получил GO; оставшихся подтверждённых P1/P2 в рассмотренном diff нет.
- Итоговая qualification decision: сохранить исходный real-app gate. Component preview дополняет проверку интерфейса, но не заменяет server-action persistence, signed-session authorization, RSC refresh и раскрытие репозитория после настоящего dashboard reload. **Merge остаётся заблокирован до успешного выполнения трёх исходных app flows.**

### 8.1. Что реализовано

- Repositories остаётся местом завершения настройки; credential dialog возвращает к тому же workspace/repository с актуальным серверным чтением.
- Workspace save показывает отдельный результат, фокусирует его заголовок и предлагает Finish repository setup. Сохранение профиля/default не объявляет workflow готовым.
- Codex открывается через fresh status read. Check работает без issuance; connect/reconnect и recovery запускаются только явным действием. Срок начала команды, неизвестный сетевой исход и повтор recovery с тем же request ID отражены в UI.
- Query/confirmation guards убирают старый зелёный статус при мутации, ошибке свежего чтения и offline pause; операции взаимно блокируются, поздний ответ не переносится в другой target.
- Убраны preparation-only prop и повтор глобальных workflow-этапов в modal. Оба optimistic consumer сохраняют setup PR/merge шаг до действительного завершения workflow.
- Claude сначала предлагает получить токен, затем сохранить его в GitHub. Названия subscription-вариантов сокращены; Accounts ведёт в Providers; API-key storage выбирает доступный начальный вариант и сохраняет явный incoming intent.
- Backend authorization, persistence, secret formats, OAuth/rotation policy, workflow ABI и Action pins не изменялись.

### 8.2. Фактические проверки

| Проверка                                      | Результат                                                                   | Граница доказательства                                                                                                            |
| --------------------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Финальный общий targeted run                  | 202 passed, 0 failed, 0 skipped; 19 файлов                                  | Изменённые UI/state guards, Codex server contracts и qualification helpers                                                        |
| Существующий `provider-setup-actions.test.ts` | 9 passed, 0 failed, 0 skipped                                               | Policy/form/action boundary; persistence в этом наборе замокан                                                                    |
| Уникальные unit/contract проверки             | **211 passed**                                                              | Повторные прогоны helper suites в сумму не добавлены                                                                              |
| Финальный affected TypeScript                 | **exit 0**, native TypeScript 7.0.2                                         | Все 27 изменённых TS/TSX inputs, их зависимости, настоящий NextAuth ambient; tooling option `allowImportingTsExtensions` сохранён |
| Full-web TypeScript                           | Более ранний run прошёл; поздние полные runs завершились SIGKILL            | Не выдаётся за успешную full-web проверку финального tree                                                                         |
| Настоящие компоненты в Chromium               | **13/13**, 8 screenshots                                                    | 1440/390, light/dark; actual dialog/delivery/API browser adapter/React Query/shared UI/CSS/fonts; server/Next results — fixtures  |
| Ошибки component-browser                      | 0 page errors, 0 console errors, 0 external requests, 0 horizontal overflow | Проверены focus, scroll, deadline, recovery lock/retry, native same-URL reload; не server-side persistence                        |
| Три обязательных real-app flow                | **BLOCKED, 0 accepted passes**                                              | Next dashboard compilation не завершилась в доступной памяти; успешной app-квалификации нет                                       |

Component-browser проверка подтвердила: открытие/reopen/истечение времени не выдают команду; Check доступен до issuance; команда сохраняется после start deadline; recovery требует acknowledgement и блокирует close/steps/return; unknown retry использует тот же request ID. Проверены порядок Claude instructions, focus и scope workspace receipt. Native return дал `navigation.type = reload`; fixture не доказывает реальную серверную проекцию репозитория после этого reload. Все восемь снимков просмотрены; мобильный deadline снимок исправлен так, чтобы предупреждение целиком попадало в кадр.

### 8.3. Инфраструктурный блокер и provenance

Общая среда ограничена 8 GiB; значительная часть памяти занята другим workspace, в том числе около 4.7 GiB tmpfs. Чужие процессы, зависимости и рабочие каталоги не изменялись. PostgreSQL 17 и миграции disposable fixture запускались успешно. Одна ранняя попытка успела отдать настоящий dashboard HTTP 200, но ни один из required flows не завершил acceptance gate.

Во время диагностики исправлен дефект test runner: установленный Next проверяет heap override через `NODE_OPTIONS`, поэтому одного CLI `--max-old-space-size` недостаточно. Harness теперь формирует контролируемый child `NODE_OPTIONS`; два регрессионных теста используют настоящий установленный Next helper и проверяют отсутствие наследования parent options. Live environment дочернего сервера отдельно подтвердил лимиты 1280 и 768 MiB. При 1280 MiB сервер был остановлен системным OOM; при 768 MiB V8 сообщил heap out of memory. Последующие попытки также не дали app acceptance.

Применялись ограничение native Rayon concurrency, отключение необязательных dev-server source maps, последовательные запуски и cleanup только собственного generated cache. Дополнительная попытка использовала временный compiler-only delta `config.parallelism = 1; config.cache = false;` без замены routes/actions/auth/database. Точная patch SHA-256: `491218a2304e67a3892b34d3acb4fbcedfee7886c41a709b9cb2c09d513240b2`. Она также остановилась до browser flows. Этот delta и сгенерированное изменение `next-env.d.ts` восстановлены; production config в PR не меняется.

Единственный известный development probe `GET https://registry.npmjs.org/-/package/next/dist-tags` остаётся заблокированным и учитывается отдельно. Все остальные внешние запросы по-прежнему запрещены; required-flow validator не ослаблен и не принимает component preview вместо app runs.

Локальные receipts сохраняются под `tmp/provider-onboarding/`: `verification-checkpoint.json`, `final-all-tests.json`, `provider-action-tests.json`, `affected-typecheck-final.log`, `tsconfig.affected.json`, `preview/browser-report.json`, `preview/screens/`, `constrained-webpack.patch`. Последняя real-app попытка: `tmp/provider-setup-visual/onboarding-final-b21af24-serial/`; это failed infrastructure evidence, не успешный manifest. SHA-256 финальной affected-typecheck config: `6924ade63c91d61c70e9d17348087065ad8d33400b59d3b77aaa5939732a6c53`.

### 8.4. Незакрытая real-app квалификация

В свободной среде с disposable PostgreSQL 17 и Chromium выполнить существующий harness без изменения application source:

```sh
pnpm provider-setup:visual --flows-only --rotating \
  --only '^(flow-step3-create-attach|flow-no-default|flow-codex-repository-setup)$' \
  --require-onboarding --next-heap-mb 2048 \
  --out tmp/provider-setup-visual/onboarding-acceptance
```

`PROVIDER_VISUAL_DATABASE_URL` должен использовать loopback host и точное имя disposable database: `postgresql://<fixture-user>@127.0.0.1:<port>/reviewrouter_provider_setup_visual`. Произвольное имя базы harness отклоняет. `PROVIDER_VISUAL_BROWSER_EXECUTABLE` указывает на установленный Chromium, если он не найден автоматически; проверенный здесь runtime — Node 26.11.1. Все три flow должны быть выполнены и пройти: `flow-step3-create-attach`, `flow-no-default`, `flow-codex-repository-setup`. Далее — просмотр восьми required app screenshots, проверка manifest/provenance/network и исправление реальных замечаний при наличии. Если потребуются изменения, они проходят отдельный review и обычный merge с expected head SHA. PR #717 уже влит пользователем; это не означает прохождение оставшихся flow. Production deploy не входит в этот запрос. Очередь CI не подменяет локальную проверку; статусы checks не фабрикуются.

## 9. Опорные исходники

- `apps/web/app/dashboard/dashboard-workspace-page.tsx`: workspace sections, repository context, progress/dialog wiring.
- `apps/web/app/dashboard/provider-setup/provider-setup-dialog.tsx`: frozen target, save transitions, credential delivery.
- `apps/web/app/dashboard/provider-setup/provider-credential-delivery.tsx`: shared confirmation, Claude instructions, rotating command/recovery.
- `apps/web/app/dashboard/provider-setup/provider-setup-api.ts`: существующие status read и confirmation adapter.
- `apps/web/app/dashboard/actions.ts`: rotating readiness inspection и confirm/activation boundary.
- `apps/web/src/server/codex-rotating-setup-manifest.ts`: initial deadline, issued/fetched/consumed reuse, ready → setup_pending, fences.
- `apps/web/src/server/prisma-codex-rotating-setup-recovery.ts`: recovery ownership и сроки.
- `scripts/provider-setup-visual/{run,flows,scenarios,github-fixture,seed}.ts`: ограниченная app/browser qualification.

## 10. Лёгкая визуальная проверка 2026-10-27

По запросу пользователя проверка продолжена без Next и PostgreSQL. База — `d3595c2e3e0b21ab539dea0fb7a06d35a4613faf` (`main` после PR #720). Собираются настоящие React-компоненты, shared UI, CSS и шрифты; Next navigation, server actions и API-ответы заменены явно обозначенными синтетическими fixtures. Один Chromium используется последовательно; внешние запросы запрещены.

### Найдено и исправлено

- В однострочном блоке команды кнопка Copy высотой 44 px выступала за рамку на 6 px. Общий `CodeBlock` теперь имеет минимальную высоту 60 px, сохраняя размер кнопки и отступы. Многострочные команды продолжают переноситься по содержимому.
- При отказе Clipboard API возникал необработанный Promise, а интерфейс не сообщал об ошибке. Отсутствие API и отказ теперь показывают доступное сообщение «Could not copy. Select the code and copy it manually.»; успешная повторная попытка очищает его. Исходный текст команды копируется без изменения пробелов и переводов строк.
- Во время проверки repository secret можно было выбрать organization scope. Старый ответ затем описывался как результат проверки organization secret. Эта последовательность воспроизведена в браузере. Выбор области теперь заблокирован до завершения запроса; после ответа он снова доступен и смена области очищает предыдущий результат.

Изменения ограничены `CodeBlock`, двумя условиями в `CiSecretDelivery` и четырьмя регрессионными тестами. API, авторизация, схема хранения, Codex issuance/recovery и порядок repository setup не меняются. Независимый source review — GO, без замечаний.

### Подтверждённые проверки

| Проверка                  | Результат                                               | Граница доказательства                                                                                                  |
| ------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Затронутые unit/UI tests  | 53 passed, 0 failed, 0 skipped; 4 файла                 | CodeBlock, secret delivery, общий provider dialog, Codex rotating delivery                                              |
| Affected TypeScript       | PASS                                                    | 4 изменённых TS/TSX-файла, их транзитивные импорты и существующие NextAuth declarations; полный web build не запускался |
| Основной Chromium-прогон  | 28 passed; 24 screenshots просмотрены                   | 1440/390 px, светлая/тёмная темы, настоящие компоненты с fixture-ответами                                               |
| Длинные мобильные диалоги | 4 passed                                                | Footer полностью доступен после прокрутки и получает фокус; Tab остаётся в modal после штатного переноса фокуса         |
| Ошибки браузера           | 0 page errors, 0 console errors, 0 неожиданных запросов | На основном прогоне; footer дополнительно без page errors и неожиданных запросов                                        |
| Real-app E2E              | По-прежнему 0 accepted passes                           | Три сценария из раздела 8.4 этим стендом не подменяются                                                                 |

Визуально сопоставлены MiMo и OpenRouter: одинаковые GitHub Secrets instructions, выбор GitHub Secrets / ReviewRouter, доступный переход Connect account при отсутствии аккаунта и объяснение недоступного хранения. Проверены правильные secret names, сохранение workspace/provider в ссылках, запрет неполного account save, Claude token-before-secret, отдельные verified/manual результаты, длинное имя репозитория и Codex deadline/recovery. Сохранение workspace profile по-прежнему не выдаётся за готовность репозитория.

Нагрузка ограничена короткими последовательными процессами: esbuild около 2.6 s, основной браузерный прогон 10.1 s, дополнительная проверка footer 2.4 s, четыре набора unit tests 12.4 s, affected typecheck 25.5 s. При успешных запусках счётчики cgroup OOM/OOM-kill не выросли. Удалён только собственный воспроизводимый `.next` cache; чужие процессы и каталоги не изменялись. Chromium и локальный сервер закрыты после проверок.

Receipts находятся в `tmp/provider-onboarding/light-20261027/`: `focused-tests.json`, `tsconfig.affected.json`, `final/browser-report.json`, `final/footer-report.json`, `final/screens/`. Основной browser report содержит хеши 78 входных файлов; они проверены до и после запуска. SHA-256 отчётов: browser — `71d96945c8e2b7080574318d04c94091b8ee27236a68cf57dd91543b70aa8f8e`; footer — `ccf589963467eed25964417135fc3f229b189b209f080bf99e5ea97a307e5e73`; unit — `78ca38c482c8dc492d9a1ab8855d2b6043742726f6b9cf4570dc17a2b1262a88`. Скриншоты и временный стенд не добавляются в исходники приложения.

SSH-доступ к Hetzner из этой среды ранее не подтвердился; глобальная инструкция о worker в `/root/.codex/AGENTS.md` удалена по просьбе пользователя. Успешный удалённый запуск, реальное сохранение GitHub Secrets, OAuth и backend persistence этой проверкой не заявляются.

## 11. Повторный аудит состояний и мобильного UX, 2026-10-27

По следующему запросу пользователя выполнен дополнительный ограниченный аудит на базе `818f8c83f69a8c5ec2fc0668b52607133210841a`. Scope: актуальность статуса GitHub secret, тексты ошибок managed key, локальное подтверждение repository setup, feedback Copy и переполнение provider dialog. Новых способов настройки, API, схем хранения и изменений lifecycle Codex нет.

### Подтверждённые дефекты и исправления

1. **Устаревшая доступность секрета.** Direct delivery показывал старое положительное metadata после неудачного повторного чтения; поздний запрос мог вернуть его после explicit missing. Теперь открытие вызывает свежий read, положительная сводка требует успешного завершённого чтения. Перед проверкой отменяется запрос с точным query key, metadata становится `unknown`; после неудачного результата повторяется только чтение. Явный результат проверки остаётся видимым. Настоящее успешное подтверждение не сбрасывается из-за последующей фоновой ошибки.
2. **Неверная подсказка для managed key.** Ошибки доступа больше не предлагают просто подождать. Отдельно объясняются отсутствующий secret, доступ репозитория к organization secret, список репозиториев GitHub App и Secrets permission. Для managed key не добавляется ручное подтверждение.
3. **Ready от предыдущего набора провайдеров.** Pill, ReadyGate и progress panel привязывают накопленные подтверждения к repository ID и набору ожидаемых auth modes. Смена набора сбрасывает локальную готовность уже на первом render. Новый массив, перестановка или дубли тех же значений не сбрасывают частичное подтверждение. Существующие workflow/Gateway guards сохранены.
4. **Старое Copied или сообщение об отказе.** Feedback общего CodeBlock привязан к точному тексту команды. Смена scope сбрасывает его; поздний clipboard result старой команды не меняет новую. Исходный текст для копирования сохраняется.
5. **Длинное имя ломало мобильный диалог.** Репозиторий `acme/` плюс 100 букв без разделителей давал scrollWidth 1336 px при ширине popup 305/372 px. Переносы ограничены ProviderSetupDialog и его `pre`; отдельное правило для `pre` необходимо, потому что его `break-words` перекрывало наследование. После исправления scrollWidth равен clientWidth на 320, 390 и 1440 px, Copy и footer доступны.

До исправлений воспроизведены 10 падающих regression cases и переполнение в двух мобильных viewport. Дополнительно защищено сохранение успешного explicit confirmation при последующей ошибке background read. После исправлений два независимых cross-review исходников не нашли оставшихся замечаний; отдельный визуальный review охватил мобильные и desktop состояния. Изменения ограничены пятью production-файлами, четырьмя файлами тестов и этим планом.

### Проверки финального изменения

| Проверка                       | Результат                                                   | Граница                                                                                                                                        |
| ------------------------------ | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Целевые unit/UI tests          | 103 passed, 0 failed, 0 skipped; 6 файлов                   | CodeBlock, direct/managed delivery, dialog, rotating delivery, optimistic status и progress panel                                              |
| Affected TypeScript            | PASS, native TypeScript 7.0.2                               | 9 изменённых TS/TSX roots, их реальные транзитивные импорты и NextAuth declarations; Prisma client и точный pinned runtime подготовлены штатно |
| ESLint / Prettier / diff check | PASS                                                        | Изменённые исходники и тесты; план отформатирован отдельно                                                                                     |
| Component browser              | 24 passed, 0 failed                                         | 6 direct read/race cases, 8 managed errors, 3 clipboard cases, 1 provider-switch flow, 6 geometry/focus cases                                  |
| Визуальный review              | 21 ключевой снимок просмотрен                               | MiMo/OpenRouter/Claude, светлая и тёмная темы; 320/390/1440 px для длинных диалогов                                                            |
| Browser errors                 | 0 page/console/server errors, 0 failed/неожиданных запросов | Только разрешённые локальные assets; синтетические server/API ответы                                                                           |
| Bundle provenance              | 79 исходных inputs проверены до и после                     | Настоящие React-компоненты, shared CSS и шрифты; built assets во время прогона не менялись                                                     |
| Real-app E2E                   | По-прежнему 0 accepted passes                               | Три сценария раздела 8.4 не подменяются component-browser проверкой                                                                            |

Финальная сборка fixture заняла около 1.8 s, браузерный прогон — 16.1 s, unit/UI tests — 13.6 s. Проверки выполнялись последовательно, один Chromium, без Next/PostgreSQL и без CI-очереди. Native typecheck ограничен одним потоком и GOMEMLIMIT 256 MiB; подготовка pinned runtime потребовала 768 MiB Node heap после недостаточного лимита 384 MiB. Счётчики cgroup OOM/OOM-kill остались нулевыми. Собственный browser/server закрыт, временный профиль удалён; чужие процессы и каталоги не изменялись.

Первый browser run дал 21 PASS и три ошибки самого harness: `innerText` учитывал CSS uppercase (`COPY`), а assertion ожидал `Copy`. Исправлено только чтение feedback через `textContent`; все семантические проверки сохранены. Повторный прогон того же bundle прошёл 24/24. Первый отчёт сохранён отдельно, baseline не перезаписан.

Локальные receipts: `tmp/recovery/final-focused-tests.json`, `tmp/recovery/tsconfig.affected.json`, `tmp/recovery/affected-typecheck-final.log`, `tmp/provider-audit-round2/{baseline,final}/`, `tmp/provider-audit-round2/final-first-report.json`. SHA-256: unit report — `b2c7b6c49c58d22521a27efc9563a40204dd0ecf87aeb6b1380b0b5f65ebf008`; browser report — `4d5a37b23775e30f23e7f3efa09bd09d13a9eca1338ebcb4100caffb85bdee51`; build receipt — `70346808547f97e5fafb9e01ac5ba5422e54f7e28e6a053d8d7851658c8cacc5`; affected config — `84e7a5af9269a3fe2e7966aa573677a8a1a34fdce70cf797c5348612f1140ff6`. Эти scratch-файлы могут быть очищены средой; в Git остаются результаты, границы и хеши, а не временный стенд или скриншоты. Production deploy в scope не входит.
