# Один список подключений в workspace

Статус: план v3 (учтены ревью плана и ревью кода) и реализация в одном PR; деплой не входит (меняется только web).
Дата: 2026-11-18. Решение владельца: личный доступ и личный workspace - одна сущность, подключение сразу добавляется в текущий workspace ([66](66-connect-attaches-to-current-workspace.md), [70](70-all-providers-in-all-workspaces.md)). На странице Connections вместо вкладок «For this workspace» и «All <login> connections» нужен один список текущего workspace.

## 1. Проблема

`AccountGatewayAccountsSection` в общем workspace X собирает `AccountsWorkspaceTabs`: вкладка X (`WorkspaceAccountsPanel` → `WorkspacePersonalAccounts`, данные `overview`) и вкладка своих (`PersonalAccountsPanel` → `PersonalAccountControls`). Своё подключение, уже добавленное в X, видно в обеих вкладках, а Edit, Update key, Reconnect, Disable и Remove есть только во второй. Страница одна: `/dashboard/setup`, вкладка Providers > Connections ведёт туда же.

## 2. Решение (права и запись не меняются)

1. `accounts-workspace-tabs.tsx` удаляется. Секция: заголовок «Connections», одна строка пояснения, один список с одной шапкой «Account / Owner / Status».
2. Порядок в списке: панель (Add account у owner/admin X, Connect account у участника, ↻) → квитанции подключения → свернутое «Share multiple connections» → шапка → свои строки → квитанции действий организации (только после такого действия) → строки X → «Refresh connections»/«Load more» обзора → «Load more personal accounts» и «Recent sharing requests». Пустое состояние одно: «No connections yet.», если нет ни своих строк, ни строк X.
3. Каждое подключение показывается один раз. Свои личные подключения рисует `PersonalAccountControls`, у него уже есть Edit, Update key, Reconnect, Disable/Enable, Remove, Access и лимиты. Остальные строки X (организация, operator, личные других участников с @handle) рисует `WorkspacePersonalAccounts` следом.
4. Сопоставление по id. Строка обзора получает `sourceId` только для подключений самого зрителя (`accounts-overview.ts`). Это id его собственного подключения, он и так виден в его списке; доступ и запросы не меняются. Обзор прячет свою строку, только если первая часть действительно показала этот источник (набор id передаётся контекстом). Если личный список не загрузился, строка остаётся в обзоре.
5. Состояние - вторая строка в колонке Status: «Used in this workspace» или «Not added to this workspace».
   - Строки X: `binding.state === "active"` (заменяет «Not added here»).
   - Свои: чистая функция по закэшированному обзору X (тот же ключ React Query, без второго запроса): есть строка с этим `sourceId` - used, в том числе пока binding ждёт fence после Update key или Reconnect; обзор загружен целиком без ошибок, строки нет и сводка доступа не называет X - not added; иначе состояние не пишется (так binding вне каталога обзора не превращается в «Not added» с предложением добавить).
   - У своей строки из обзора берутся строка расхода и «Choose for reviews».
6. Действия своих строк. «Add to this workspace» (открывает существующий Access, X в нём первым) - только при not added и live роли owner/admin X (`recipient.canDetach`). Участник видит «Only workspace owners and admins can add connections here.» и Access. Убрать из X - «Remove access» в Access, как сейчас. Owner - «You» с аватаром зрителя через общий `AccountOwner` (`account-owner.tsx`). Чипы «Available in» остаются только в личном workspace P.
7. Единый режим включается, только когда роль в X прочитана. Без неё (`recipient` или личный сервис недоступны) остаётся прежний состав без вкладок: список организации, под ним личный список.
8. Подключение и обновление. «Add account» стоит в панели списка вместо «Connect account» (слот `connectEntry` у `AccountGatewayControls`). У участника параметры `keyProvider…` открывают «Connect account». `refresh` личного `AccountGatewayControls` всегда обновляет `sources`, сводки и обзор X (`refreshPersonalAccountViews`), включая экземпляр в диалоге Add. Панель обёртки организации внутри списка скрыта (`hideConnect` → `hideToolbar`), ↻ остаётся при ошибке. Экземпляр `connectOnly` не стирает лимиты при замене bootstrap: строк он не рисует, а стирание сбрасывало свежие лимиты соседнего списка. Квитанция подключения из диалога Add видна и в списке: экземпляры одного владельца сообщают о новых nonce событием в той же вкладке. Панель получает `key` workspace, поэтому смена workspace начинает с чистого состояния.
9. Ссылки: якорь `#your-accounts` остаётся на списке. `connectionSetupContinuation().view` удаляется. «Use an existing connection» и «Manage workspace access» в диалоге Add закрывают диалог, список уже под ним (контекст переезжает в `accounts-add-dialog.tsx`). В 66 §2.3 отмечается, что вкладки своих подключений больше нет.

## 3. Лимиты Codex «Outdated» (доп. задача)

Карточка Seventeen показывает наблюдение 2026-11-04 21:08 (5h 0%, 7d 22%), хотя #880 обновляет устаревшие лимиты при открытии. Обновление при открытии одинаково работает в обоих списках, но только если чтение отдало `refreshAvailable`. Это поле считается из discovery `account-limits-refresh/v1`: на каждый запрос новый клиент, холодный HTTP-вызов и гонка 250 мс. Проигрыш даёт молчаливое «Outdated», а кнопка тогда только перечитывает сохранённое. Второй молчаливый путь - обновление прошло, а окна всё ещё устаревшие. Исправление: discovery кэшируется в процессе по (role, origin) на 10 минут, старый ответ служит, пока идёт перепроверка, ошибка не кэшируется. Если обновление прошло, а самое новое наблюдение не стало новее, карточка пишет причину рядом с ↻. Без прод-доступа точную причину для этого аккаунта не подтвердить.

## 4. Тесты и риски

- Unit: функция состояния (used, used при fence, not added, неполный обзор, ошибка); список (свои с «You», чужие после них, своя строка обзора скрыта и не скрыта при ошибке личного списка, пустое состояние, admin и участник); кэш discovery (один вызов на два экземпляра, ошибка не кэшируется, перепроверка); строка причины после обновления. Обновить тесты вкладок, `connection-setup-continuation`, oauth-тест «Manage workspace access».
- E2E `scripts/accounts-reference-e2e`: хелпер региона указывает на «Connections»; прогон затронутых тестов на изолированном PGlite, если хватит диска.
- Риск: диалог Add и личный список смонтированы вместе и оба могут вызвать автодобавление последнего connect; сервер идемпотентен по nonce (66).
