# Добавить провайдера одним шагом

Статус: план v5 (учтены ревью v1-v4), реализации нет. Дата: 2026-11-18. База: `origin/main` `ae18f9e87` и план [76](76-single-connections-list.md) (PR в работе, merge раньше). Опирается на [66](66-connect-attaches-to-current-workspace.md) и [70](70-all-providers-in-all-workspaces.md).

## 1. Как сейчас

Пользователь хочет «ревью через NVIDIA». Он owner или admin в workspace X, подключений нет.

1. Providers → «Add provider» → Provider: NVIDIA Build. Диалог пишет «After connecting, return here to choose its model» и даёт ссылку «Connect account» (`provider-setup-dialog.tsx:1808-1832`).
2. Переход на `/dashboard/setup?keyProvider=nvidia…`. Сам открывается «Add account», владелец по умолчанию «organization» (`connection-setup-continuation.ts:68`). Сверху баннер «Connect an account, then use Access…» (`api-key-setup-return.tsx`), хотя после 66 Access не нужен.
3. Ввести ключ → Connect → квитанция → «Make available and continue» (`ConnectionSetupContinuation`, `account-gateway-account-controls.tsx:1316-1437`) → `router.push` на Providers. Диалог открывается заново по URL (`dashboard-workspace-page.tsx:1338-1453`), Account выбран сам. Выбрать Model → «Add and make default» → Done.

Итого: около 10 действий, 2 перехода, 3 диалога. Пользователь сталкивается с понятиями Connection, Owner, Make available и Access, хотя хотел три вещи: провайдер, ключ, модель. Обратный путь держится на URL-намерении (`keyProvider`, `keyStorage`, `keyWorkspace`) и пяти кусках кода. Диалог - 2521 строка, из них `ProviderChoiceStep` - 1453 (`:720-2173`). E2E этого пути (`api-key-storage.spec.ts:389`) уже устарел (дрейф описан в 70, §5) и в CI не входит.

## 2. Решение (только web, без миграций и флагов)

1. В диалоге выбран источник `gateway_binding` (ReviewRouter storage). Если подходящих подключений нет, вместо ссылки сразу показывается форма подключения этого провайдера. Если подключения есть или список неполон (`gatewayInventoryIncomplete`), рядом с Account стоит «New connection», он открывает ту же форму. Форма липкая: её не убирают ни перечитывание списка (`loading`), ни смена состояния. Пока в контексте есть nonce, `choose()` диалога (карточки профилей и default, select «Provider», хранилище) заблокирован: иначе форма перемонтируется и код устройства пропадёт (`deviceHandoffs` живёт в state `Controls`, `:545-550`).
2. Форма - существующий `AccountGatewayControls connectOnly` в личном scope с `addToWorkspace` из 66. Новой логики подключения нет: OAuth (device code, browser), ключ, квитанция, nonce в sessionStorage и attach остаются где были.
3. Сборка, один владелец. Клиентская `PersonalConnectPanel` (модуль account-gateway) получает `scope`, имя workspace, связанный `addToWorkspace` и необязательную первую страницу. Она же владеет текстом 66 §4 до подключения («You own this connection. It is added to <workspace> as soon as it connects.»): он уходит из `accounts-add-dialog.tsx:108-109`, а вариант `ConnectAccountDialog` (`account-gateway-account-controls.tsx:1473`) сводится к нему.
   - Без первой страницы панель читает её один раз при монтировании через существующий action `listPersonalGatewayAccounts` (`personal-account-actions.ts:107-114`; он сверяет `context` со scope сессии). Пока идёт чтение, показывается строка загрузки. Лишнего чтения Gateway при загрузке страницы нет.
   - Bootstrap не заменяется, пока панель смонтирована. Свой `queryClient` она не передаёт: работает общий `optionsCache.client`, и `refresh` (после 76 - `refreshPersonalAccountViews`) обновляет список Account в диалоге.
   - Connections строит через панель `personalConnect` из уже прочитанного `management.page`. Dashboard отдаёт её через контекст на секциях с диалогом (`wantsProviderDialog`).
4. Права решает одно правило. Панель есть, если работает личный сервис (на prod `REVIEW_ROUTER_PERSONAL_ACCOUNT_SHARING_ENABLED=1`, проверено read-only в контейнерах web и api). Форма показывается, только если `source.personalAccountDecision.allowed`: правило `personalOwner` (`provider-management-policy.ts:116-120`), то есть владелец P или owner/admin X. Иначе выводится его причина через `deniedText`, без ссылки: подключение, которое здесь не добавится, участнику не нужно. При выключенном сервисе остаётся простая ссылка на Connections, без автопродолжения.
5. Контекст `ConnectTarget { provider, empty, nonce, setNonce, onConnected }` живёт в модуле account-gateway, чтобы account-gateway не зависел от диалога. Его даёт диалог.
   - `Controls` сужает `enrollmentProfiles` до этого провайдера (одно правило - `setupProviderForGatewayProfile`).
   - `ConnectionForm` прячет свой select «Provider», если профиль один. `AccountForm` прячет выбор хранилища и ссылку на GitHub.
   - Активный nonce берётся из контекста, а не последний сохранённый; `reserveNonce` вызывает `setNonce`. «Add another account» и «Hide» вызывают `setNonce(null)`: после `rejected` (неверный ключ) форма открывается снова, Provider разблокирован. При лимите 8 nonce - ссылка на Connections вместо «hide old results».
6. Только при наличии `ConnectTarget`, получив от attach `attached`, `Controls` сам делает `dismiss(nonce)`, вызывает `setNonce(null)` и один раз `onConnected(bindingId)`. Повторное «New connection» открывается чистым, а квитанция не занимает лимит. Диалог пишет у Account «Connected and added to this workspace» и переводит фокус на Model. Текст квитанции (`:2270`) не меняется. Attach в P вызывается только при наличии `ConnectTarget`: `attachConnected` отвечает там по binding, созданному connect (`personal-connect-attach.ts:112-115`). Страница Connections в P не меняется.
   - `attached` получает `bindingId`, это id `WorkspaceAccountBinding` (тот же, что `account.binding.id` в диалоге, `gateway-model-account-options.ts:347`). Он берётся из `connect.binding`, `previous.binding?.id` и `result.value.operation.bindingId`; при `available` без id ответ `not_attached("unavailable")`. `hasActiveBinding` (count) заменяется на `activeBindingId` (Prisma `findFirst`, select id).
   - Диалог ставит `draft.bindingId`. `useGatewayModelAccounts` дочитывает выбранные binding за пределами первой страницы (`:911-915`). Пока binding ждёт fence и не читается (`provider-account.ts:237`), висит «Finishing connection…». Опрос только запроса `account-option` этого binding (не всего списка, чтобы не мигала строка загрузки) каждые 3 секунды до минуты, потом кнопка «Try again»; пустого select нет. При `not_attached` показывается текст из 66, выбора нет.
7. Модель. Одна чистая функция `suggestedModel(options, provider)` в `provider-model-options.ts`: `defaultModel` каталога провайдера (Codex, OpenRouter, MiMo, Kimi), если он среди доступных вариантов; иначе единственный вариант; иначе пусто. Она заменяет оба правила «одна модель» (`:1182-1183`, `:1870-1871`) и применяется реактивно, пока модель пуста и пользователь её не трогал: каталог Codex приходит позже (`gateway-model-account-options.tsx:258-267`). «Use as workspace default» уже включён, когда default нет (`:889`).
8. Подсказка о дубле (в `ConnectionForm`, у неё уже есть `accounts`) только при `empty` - форма открылась сама, потому что в X нет готовых подключений этого провайдера. Если в первой странице личных подключений есть активное этого провайдера, оно в X не готово. Тогда над формой стоит «You already have <name>. Add it to this workspace in Connections» со ссылкой на `#your-accounts`. Повторный вход Codex рискует карантином дубля (74, п.1).
9. Удаляется обратный путь: ссылка «Connect account» и тексты про возврат в диалоге; `api-key-setup-return.tsx` и `connection-setup-continuation.ts` целиком; `ConnectionSetupContinuation` и `renderSetupContinuation`; назначение `"accounts"` у `apiKeySetupHref`; намерение на секции setup (чтение аккаунтов `dashboard-workspace-page.tsx:1008-1012`, ссылки hub nav `:1318-1324` становятся обычными `dashboardSectionHref`); `setupIntent`, `initiallyOpenConnect` и `ApiKeySetupContext.intent` у Connections, `initiallyOpen` и `initialOwnership` у `AccountsAddDialog`.

   Намерение `providers` с веткой `reviewrouter` в `initialChoice` остаётся: его создаёт «Add with different storage» (`provider-list.tsx:662`). Намерение `repositories` тоже остаётся.

10. Новое (хост липкой формы, «New connection», «Finishing connection…») сразу пишется в `gateway-credential-section.tsx`, а не в `ProviderChoiceStep`. Существующие select Account, Load more и автовыбор остаются на месте: state у них общий с диалогом.

## 3. Идея C (автосоздание провайдера после подключения)

Как побочный эффект на странице Connections - нет:

- подключение ради лимитов или для другого workspace молча создаёт провайдера и default, и репозитории начинают тратить чужой платный ключ или подписку (у GLM это нарушение условий, 70);
- `defaultModel` есть не у всех: у NVIDIA, GLM, MiniMax и Grok его нет (`provider-catalog.ts:112-175`), а первая из сотни моделей - плохая догадка;
- это третья мутация после connect и attach, со своими частичными сбоями, и новая связь provider-accounts → review-config.

Внутри диалога - да, через п.7: модель и default предвыбраны, нужна одна явная кнопка «Add and make default». Это безопасно, человек видит, что сохраняет.

## 4. По провайдерам

| Провайдер              | Сегодня                                                  | После                                                                                   |
| ---------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Codex                  | Gateway OAuth (device code, browser) или GitHub rotating | Gateway в одном диалоге: код и ожидание в нём, модель по каталогу. GitHub без изменений |
| OpenRouter, MiMo, Kimi | Gateway-ключ или GitHub Secrets (managed или вручную)    | Ключ в диалоге, модель по каталогу. GitHub-пути без изменений                           |
| NVIDIA, GLM, MiniMax   | Только Gateway-ключ                                      | В диалоге, модель выбирает пользователь (у NVIDIA живой список, 68)                     |
| Grok                   | Gateway OAuth browser со вставкой кода                   | В диалоге: вкладка входа, код вставляется в диалог                                      |
| Claude Code            | GitHub Secrets (подписка) или managed key                | Без изменений: Gateway нет, путь уже в одном диалоге                                    |
| Hosted pool            | Не входит в диалог, выбирается в Accounts                | Вне объёма                                                                              |

После (NVIDIA, X): «Add provider» → NVIDIA → ввести ключ (имя подставлено) → Connect → «Connected and added to this workspace», подключение выбрано → Model → «Add and make default». Около 6 действий, 0 переходов, 1 диалог.

## 5. Владельцы правил

Подключение, OAuth, квитанция и attach - `account-gateway-account-controls.tsx` и `personal-connect-attach.ts` (правила connect/attach не меняются: добавляется `bindingId` в ответе и связь с `ConnectTarget`). Связь профиля с провайдером - `setup-provider.ts`. Предложенная модель - `provider-model-options.ts`. Сборка личного connect и текст 66 §4 - `PersonalConnectPanel`, одна для Connections и диалога; `ConnectTarget` - account-gateway. Можно ли подключать здесь - `personalOwner` в `provider-management-policy.ts`. Сохранение провайдера и default - существующие `createProviderProfile` и `saveProviderRoster`.

## 6. Шаги (один PR после merge 76)

1. Rebase на 76. `PersonalConnectPanel` с ленивой первой страницей, Connections переходит на него.
2. `bindingId` в `attached`, `activeBindingId`.
3. `ConnectTarget`: фильтр профилей, скрытые select и хранилище, nonce из контекста, `onConnected`, подсказка о дубле в `ConnectionForm`.
4. `gateway-credential-section.tsx`: липкая форма, «New connection», «Finishing», блокировка `choose()`; `suggestedModel`.
5. Удалить обратный путь (п.2.9) и его тесты. Написать E2E заново.

## 7. Тесты

- Unit: `suggestedModel` (default есть, выключен, отсутствует, один вариант, поздний каталог); `attachConnected` возвращает `bindingId` в P, X, при повторе по квитанции и при `conflict`.
- Диалог: нет подключений → форма этого провайдера без второго «Provider»; `loading` во время подключения форму не убирает; после `onConnected` выбрано подключение и видна модель; участник видит только причину; без личного сервиса - ссылка; подсказка о дубле.
- Controls: `onConnected` один раз после `attached`, ни разу при `not_attached`; nonce из контекста; без `ConnectTarget` (Connections) квитанция не скрывается; `rejected` → «Add another account» → форма снова, Provider разблокирован.
- E2E `scripts/accounts-reference-e2e`: новые сценарии в одном диалоге для NVIDIA-ключа и Grok browser (фикстура уже умеет, `subscription-connections.spec.ts:51`); Codex device code - компонентными тестами (в фикстуре нет OAuth begin/poll), скриншоты desktop и mobile. Прогон на Hetzner.

## 8. Деплой и откат

Меняются только web и его server actions: без миграций и без изменений Gateway, native и api. Старые ссылки с `keyProvider` на Connections просто открывают страницу. Откат - прежний образ web; лишнее поле `bindingId` старый клиент игнорирует. Запись в `ai-docs/deployments/` делается при реализации.

## 9. Риски и что станет хуже

- Новое подключение из диалога всегда личное, а раньше в X по умолчанию предлагалось organization. Личное отзывается из X, если владелец теряет роль owner/admin (70, §2.4). Подключение организации делается на Connections («Add account», затем «Add to this workspace»), потом выбирается в диалоге: на один автопереход длиннее, чем сегодня.
- Без личного сервиса (флаг не `=1`, в `deploy/` его нет) пропадают автооткрытие формы и «Make available and continue»: остаётся ссылка. Сейчас этот режим нигде не используется.
- Диалог выше, OAuth идёт в модальном окне. Закрыть можно в любой момент: операция продолжается, квитанция и attach - на Connections, провайдер добавляется повторным «Add provider».
- Если закрыть диалог, пока ждёт device code, код пропадёт (как и при перезагрузке Connections сегодня): квитанция пишет «wait for this request to expire» (`:2326-2329`).
- Пересечение файлов с 76: `account-gateway-account-controls.tsx`, `accounts-add-dialog.tsx`, `account-gateway-accounts-section.tsx`, `connection-setup-continuation.ts`. Автооткрытие для участника по `keyProvider`, которое добавляет 76, здесь удаляется.

## 10. Вне объёма

- Разбор всего `ProviderChoiceStep` на стратегии по типу credential: DEFER. Пользователю это ничего не даёт, state общий, тесты на 2958 строк. Новый код пишется в отдельный файл (п.2.10).
- GitHub Secrets, managed key, Claude Code, hosted pool, создание подключения организации, страница Connections (76), Gateway и native.

## 11. Ревью

Четыре раунда независимого ревью. v1: липкая форма, без второго «Provider», `bindingId` от attach вместо сравнения списков, поздний каталог Codex, честные ухудшения. v2: текст 66 §4, жизненный цикл nonce, потеря кода устройства, ленивая панель вместо серверного слота, E2E без device code. v3: сброс через `setNonce`, права через `personalOwner`, без выноса существующего кода, выход из «Finishing». v4: блокировка `choose()`, точечный опрос, мелочи.
