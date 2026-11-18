# Один стек аккаунтов: что на самом деле дублируется

Статус: план v4 (учтены три раунда ревью), реализован. Шаг 3 (обновление страниц организации) и скрытие нижней кнопки «Refresh connections» уже вошли в #901, поэтому в реализацию 77 они не попали. Дата: 2026-11-18.
Основа: main `ae18f9e87` и план 76 «Один список подключений» (`76-single-connections-list.md`, PR в работе). Строки указаны по main; после rebase на 76 они сдвинутся.

## 1. Вердикт

- Убрать один из стеков целиком (слить протоколы операций, один рендерер строк): **DROP**. Хранение уже одно, клиентский движок уже один, а слияние протоколов не меняет ни одного шага пользователя.
- Один набор действий и одно обновление в строках общего списка: **DO**. Маленький PR после 76, около -30 строк в продукте.
- Повторный вход для личного Codex: **DEFER** (§8). Это единственное различие в возможностях, которое возникло из-за двух стеков.
- Флаг `REVIEW_ROUTER_PERSONAL_ACCOUNT_SHARING_ENABLED` и старый список организации без личных подключений: **DEFER**. Флаг читают api (`selectBinding`), workflow-provisioning и скрипты.

## 2. Карта: что одно, а что действительно два раза

- **Таблицы - одни.** `ProviderAccountConnection` (владелец `ownerUserId` или `ownerWorkspaceId`), `WorkspaceAccountBinding`, журнал `PersonalAccountOperation` (`schema.prisma:123-178,219`). Миграции не нужны. Hosted pool (`HostedCodex*`, `hosted-pool-account-card.tsx`) - отдельный стек, вне темы.
- **Домен.** Агрегат - подключение (`ProviderAccountConnection`, владелец: пользователь или workspace). Привязка к workspace - отдельный агрегат со своей ревизией и fence. Правила использования и снятия (`selectBinding`, `assertWorkspaceUseOwner`, `revokeWorkspaceAccountBinding`) уже лежат в `packages/features/provider-accounts`.
- **Операции - два протокола по владельцу.** Workspace: `createAccountsAdapter` (`account-gateway-accounts.ts:400-1682`), операции Gateway по `operationRef`. Личное: журнал RR (`createDisabledPersonalAccountsAdapter` `:1685-2082`, `personal-canonical-accounts.ts` на 1016 строк, use cases пакета). Disable/Enable/Remove уже общие (`account-lifecycle*`).
- **Клиентский движок - один.** `AccountGatewayControls` с `managementScope` (connect, OAuth, квитанции, rename, ключ) и общий `AccountLifecycleControls`. Две копии в секции - это два экземпляра одного компонента.
- **Строки - два рендерера.** Свои - `PersonalAccountControls` (1790 строк, вместе с журналом доступа), остальные - `WorkspacePersonalAccounts` (656). Оба собраны из общих частей. Третий, старый - собственный список движка (`account-gateway-account-controls.tsx:1191-1299`), он появляется только без личного сервиса.
- **Снятие из workspace.** Два server action: `detachGatewayAccount` (движок) и `detachWorkspaceOverviewAccount` → `detachWorkspaceUse` (обзор; путь выбирается по владельцу, `personal-account-composition.ts:630-670`). Оба сходятся в `revokeWorkspaceAccountBinding` или `detachRecipient`. В клиенте на одной строке два пункта (§3).

Почему не сливать дальше. Перевод connect/rename/reconnect подключений workspace на журнал RR - это переписывание работающего OAuth и ключевого входа: около 1300 строк адаптера. Шаги пользователя от этого не меняются, а [62](62-provider-connection-architecture.md) (строка 48) запрещает переписывать рабочие потоки ради симметрии. Один рендерер тоже не нужен: в личном workspace P обзора X нет, и свои строки всё равно рисует `PersonalAccountControls`.

## 3. UX: что нашла проверка

Зонд vitest на main: `WorkspaceAccountsPanel`, admin, подключение организации, привязанное к X. В меню строки «Rename», «Update API key», «Remove from this workspace», «Remove from this workspace». Кнопка «Access» стоит в самой строке. Если доступен lifecycle, в меню есть ещё «Disable» и «Remove connection…» (`account-lifecycle-controls.tsx:53-56`). 76 этих мест не меняет.

- Первый «Remove from this workspace» приходит из `renderActions` движка (`:1012-1027`). Он снимает подключение сразу, без подтверждения, и пишет «Workspace use detached; gateway fence pending.».
- Второй приходит из меню обзора (`workspace-personal-accounts.tsx:171-182`) и открывает подтверждение.
- «Access» (`:527-547`) открывает то же подтверждение. В нём всегда текст «Your personal account and other organizations stay unchanged», даже для подключения организации или подключения ReviewRouter. Участник без прав видит этот диалог с неактивной кнопкой.
- Обновление. На main вверху вкладки X стоит ↻ движка организации, а внизу кнопка обзора «Refresh connections». 76 прячет панель движка организации (`hideToolbar`) и ставит наверх ↻ личного движка. Этот ↻ перечитывает обзор, но не страницы движка организации. Это регрессия 76: после снятия через обзор строка пишет «Not added to this workspace», а в меню остаётся устаревший «Remove» движка вместо «Add to this workspace», пока страницу не перезагрузят.

**Admin X, до:** «...» на строке организации показывает два одинаковых пункта. Первый молча снимает подключение. «Access» ведёт к подтверждению с неверным текстом.
**Admin X, после:** меню выглядит как Rename, Update API key, Disable, Remove connection…, Remove from this workspace. Последний пункт открывает подтверждение. После подтверждения строка пишет «Not added to this workspace». В меню есть «Add to this workspace»; он активен, когда Gateway подтвердит снятие. Remove connection удаляет подключение везде, Disable приостанавливает его везде. Снятие убирает подключение только из X.
**Участник X:** до изменения на каждой чужой строке была кнопка «Access» с неактивной кнопкой внутри. После на чужих строках только «Choose for reviews», если он доступен. Права не меняются.
**Обновление:** один ↻ вверху перечитывает весь список. Свои строки не меняются: «Access» там открывает настоящий менеджер доступа.
**Кому хуже:** admin, который снимал подключение через «Access» в два клика, теперь делает три (меню, пункт, подтверждение).

## 4. Владельцы правил

- **Можно ли снять привязку:** решают use cases `revokeWorkspaceAccountBinding` и `detachRecipient`. Для показа пункта сервер отдаёт `allowedActions` с `detach` (`accounts-overview.ts:318-321`) и `workspaceAccess().canDetach`.
- **Кто рисует пункт «Remove from this workspace»:** список, который рисует строку. В общем списке это `WorkspacePersonalAccounts`. В старом списке без личного сервиса это собственная разметка движка (`:1288-1295`). Туда пункт переезжает из `renderActions`, поэтому отдельное условие не нужно. Там снятие остаётся без подтверждения: это редкий запасной путь.
- **Что перечитывает обновление списка:** решает одна функция `refreshPersonalAccountViews` (`personal-account-controls.tsx:75-111`). Меняется одно условие на `:96-99`: `key[0] === "gateway-accounts" && key[2] === "page" && (includeOwnPages || key[1] !== canonicalScope)`. Параметр `includeManagement` переименовывается в `includeOwnPages`, потому что его смысл меняется. Цена: каждая квитанция шаринга в X добавляет одно чтение страниц организации. Так в обновление попадают страницы движка организации, без повторного чтения своих страниц и без квитанций. Квитанции Gateway и `personal-accounts/*/operation` не перечитываются: OAuth device-code опрашивается по своему интервалу. Селектор lifecycle (`account-lifecycle-controls.tsx:143-162`) намеренно шире, потому что меняет и квитанции при удалении. Его не трогаем, это другое правило.
- **Общий клиент:** все три экземпляра (личная панель, движок организации, обзор) берут клиент `GatewayModelAccountsProvider` (`dashboard-workspace-page.tsx:1055-1079`). Обзор берёт его, только если совпадает scope (`gateway-model-account-options.tsx:46-51`): у обоих он равен `personal-<sha256>`. Если scope расходится, обзор работает на приватном клиенте и обновление молча не срабатывает. Это ограничение есть уже сейчас; ниже оно закрыто тестом.
- **Тексты:** одни в `accountsCopy`, по типу владельца. Тип вычисляет одна функция, вынесенная из `AccountOwner` (`account-owner.tsx`, появляется в 76) и используемая там же: `owner.kind` и `owner.isViewer`, без них `origin`, без обоих - общий текст «Reviews in this workspace stop using it.».
  - Организация: «Reviews in this workspace stop using it. The connection stays here; add it back after the gateway confirms the change.»
  - Личное подключение другого участника: «Reviews in this workspace stop using it. Only its owner can add it back.» Своё (`owner.isViewer`; видно, если личный список не загрузился): «You can add it back from your connections.»
  - Подключение ReviewRouter (`origin: operator`): «Reviews in this workspace stop using this ReviewRouter connection. Only ReviewRouter can add it back.» Вернуть его может только admin операторского workspace (`workspace-account-bindings.ts:136-165`).
  - Квитанция: «Removed from this workspace.» и ожидание подтверждения Gateway вместо «Access revoked locally…».

## 5. Шаги (после merge 76, rebase на него)

1. `account-gateway-account-controls.tsx`: перенести снятие из `renderActions` в собственную разметку движка.
2. `workspace-personal-accounts.tsx`: убрать кнопку «Access» и нижнюю «Refresh connections». Диалог открывается только из пункта меню и только с допустимым запросом. Заголовок «Remove from this workspace?», кнопка «Remove», тексты из §4. Диалог переезжает в `AccountRowMenu`, как в lifecycle, и получает `finalFocus` на кнопку меню (`useAccountMenuReturnFocus`). Если строка после снятия исчезла, фокус уходит на ↻ списка.
3. `personal-account-controls.tsx`: условие из §4 в `refreshPersonalAccountViews`. Регрессию вносит 76, поэтому об этом сообщается оркестратору для PR 76. Шаг отпадает, если после 76 `refreshPersonalAccountViews` уже перечитывает страницы организации. Вернуть ↻ движка организации недостаточно: меню устаревает после снятия через обзор уже на main (`:96-99` перечитывает только свои страницы), а ↻ лишь позволял это обойти.
4. `accounts-copy.ts`: тексты из §4. `accountsCopy.access` остаётся для своих строк.
5. Запись в `ai-docs/deployments/`: 77 выходит тем же релизом web, что 76, или сразу после него.

## 6. Тесты

- Регрессионный тест в отдельном файле под настоящим `GatewayModelAccountsProvider`: замоканы только модули server actions (`./account-gateway-account-actions`, `./account-lifecycle-actions`), клиентские модули настоящие. Сценарий: строка организации, admin. В меню ровно один «Remove from this workspace». Подтверждение вызывает `detach` один раз, затем `listGatewayAccounts` вызывается повторно, и в меню есть «Add to this workspace». Участник: на чужой строке нет ни «Access», ни «Remove».
- ↻: страница организации и личная страница перечитываются по одному разу, квитанции не перечитываются.
- Тексты по трём владельцам, включая строку без `owner`.
- Обновить `workspace-personal-accounts.test.tsx:87,90,93,190,199,202,218,246,283,332,348,387`. Тесты `:381,393,557`, которые нажимают нижнюю кнопку, теперь запускают `refreshPersonalAccountViews`. Их scope меняется на `${personalScope}:workspace:…`. Фокус после закрытия диалога проверяется. Добавить проверку, что собственный список движка показывает снятие (oauth-тест).
- E2E `accounts-reference`: вместо `.last()` проверить `toHaveCount(1)` у «Refresh connections». Новый сценарий: admin снимает подключение организации из X и видит «Not added to this workspace». Затем ждёт, пока «Add to this workspace» станет активным (fence подтверждён), и возвращает подключение этим пунктом: `changeBinding` сохраняет id привязки. SQL в `finally` остаётся запасным путём, потому что привязку используют `gateway-connection-probe.spec.ts:128` и `gateway-account-models.spec.ts:188`. Так проверяется `detachWorkspaceUse` в настоящем Next: функция живёт в замыкании composition.
- Прогон на Hetzner: затронутые vitest, typecheck, eslint, prettier и этот E2E.

## 7. Деплой и откат

Меняется только web. Данных и миграций нет, серверные права и протоколы не меняются. Выкатка вместе с 76 или сразу после. Откат - откат web.

## 8. Вне объёма

- Слияние протоколов и перенос use cases подключений workspace в пакет: DROP (§2).
- Две пагинации (движок и обзор). Видны только у организации с более чем 25 подключениями.
- Четыре чтения одних таблиц, которые идут последовательно в `account-gateway-accounts-section.tsx`: свои строки и строки организации читаются из Gateway дважды за рендер. Замеров на проде нет, отдельная задача.
- `$queryRaw` в `accounts-overview.ts`: не эта задача.
- Личный Codex (DEFER). Каталог профилей собирается дважды: у личного Codex `canReconnect: false` (`personal-account-composition.ts:121-138`), у Codex workspace - `true` (`account-gateway-accounts.ts:441-462`). Второе условие - `personal-canonical-accounts.ts:156-158`: OAuth-профилю нужен `connection`. Путь пользователя: у личного Codex истёк вход, а «Refresh Codex sign-in» нет. Приходится удалить подключение, подключить заново и снова добавить во все workspace. Сначала нужно проверить, поддерживает ли Gateway повторный OAuth-вход для роли consumer-control. После этого владелец единого каталога - `account-connection-catalog.ts`.

## 9. История ревью

- v1 → v2: снятие из обзора не перечитывало страницы движка; личный Codex вынесен в вердикт; поправлено утверждение про одну серверную точку; расширены тесты; меню показано целиком.
- v2 → v3: таблица заменена списком (prettier); регрессия обновления отнесена к 76; дополнены тесты и E2E; описан общий клиент; выписаны тексты по владельцам.
- v3 → v4: вместо переноса селектора lifecycle - одно условие в `refreshPersonalAccountViews` (квитанции не перечитываются); текст для подключения ReviewRouter говорит, что вернуть его нельзя; «Add to this workspace» ждёт fence; фокус после диалога. Раунд 4 (APPROVE WITH NITS): диалог в меню строки, переименование `includeOwnPages`, отдельный файл теста, возврат привязки через UI в E2E.
