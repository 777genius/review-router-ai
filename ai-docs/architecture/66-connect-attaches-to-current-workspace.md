# Подключение из workspace сразу добавляет его в этот workspace

Статус: план v2 (учтено независимое ревью v1) и реализация в одном PR; деплой не входит.
Дата: 2026-11-17. Решение владельца: да. Продолжает [56](56-personal-account-organization-sharing-plan.md), раздел 4 («Attach personal A в X»): подключение, начатое в X, считается явным выбором X.
Обновление 2026-11-17: проверка personal-only и причина `personal_only` удалены, GLM добавляется как любой профиль ([70](70-all-providers-in-all-workspaces.md)). Упоминания GLM personal-only ниже - история.

## 1. Проблема

- Личное подключение (Codex, NVIDIA, GLM и другие через Account Gateway) всегда принадлежит пользователю. `finalizeConnect` создаёт ему binding только в личном workspace P (`personalOwnerUserId = U`).
- P скрыт в выборе workspace, если у пользователя есть workspace с репозиториями или установками (`filterVisibleDashboardWorkspaces`). Пользователь подключает аккаунт, находясь в организации X, но аккаунт попадает в невидимый P. Чтобы им пользоваться в X, нужен отдельный шаг Access или Add to workspace.
- UI показывает P как отдельное место: чип «Personal» ведёт на `?workspace=<P>`. Если P скрыт, `selectDashboardWorkspace` откроет другой workspace. В Access есть строка «Personal workspace · Your account» и текст «Your personal access is permanent».

## 2. Что меняется

1. Новая серверная операция `attachConnected(workspaceId, connectNonce)` (`personal-connect-attach.ts`, собирается в `personal-account-composition.ts`, вызывается server action `attachConnectedPersonalAccount`). Своей логики записи у неё нет: состояние меняет только существующий `sharing.attach`. Дальше по цепочке идут `adapter.attach`, `attachPersonalAccount`, `PrismaPersonalAccountOperations.attach`, и запись остаётся durable `PersonalAccountOperation` с действием `attach`. Новой таблицы, миграции и флага нет.
2. Порядок операции:
   - прочитать connect-операцию актора: `store.readOperation(actor, nonce)`, только `action = connect`, `phase = applied`, source с `ownerUserId = actor`;
   - `workspaceAccess(workspaceId)` (уже есть): workspace активен, актор в нём состоит;
   - X - это личный P актора: binding уже создал connect, ответ `attached`, если он `available` и указывает на X;
   - `isPersonalOwnerOnlyProfile(profile)`: `not_attached: personal_only`, attach не вызывается;
   - актор не owner/admin X (`canDetach = false`): `not_attached: not_permitted`, attach не вызывается;
   - nonce attach детерминированный: UUID версии 8 по RFC 9562 из sha256(`rr-connect-attach-v1`, connect nonce, X). Сначала читается сохранённая квитанция по этому nonce. Если она есть, она окончательна: при `available` ответ `attached`, при отозванном binding `removed`, иначе (source приостановлен или меняется) `unavailable` с повтором. Новый кортеж в этом случае не отправляется;
   - иначе `sharing.attach` с этим nonce, `predecessorBindingId = null` и текущей ревизией source. Если пришёл `conflict`, проверяется, есть ли активный binding (X, source) (Prisma `count`): есть - `attached`, нет - `unavailable`.
3. UI:
   - Намерение привязано к X на клиенте. Перед запросом свежего connect рядом с nonce в sessionStorage записывается X (`…:connect-workspaces`). Список nonce общий для всех workspace пользователя. Поэтому attach выполняется, только если записанный X совпадает с текущим. Rename, reconnect и nonce без записи (в том числе сохранённые до деплоя) никогда не добавляются.
   - В `OperationReadback` при `applied` операция вызывается один раз (`useMutation`). Ответ: «Added to this workspace» либо причина (personal-only, только owner/admin, удалено после добавления). «Try again» есть только у `unavailable` и `not_connected`. После успеха обновляются уже существующие ключи: `refresh` (страницы аккаунтов, `refreshRelated`, `optionsCache`).
   - Точки входа, когда текущий workspace - не P: диалог Add account (путь «You · personal account») и вкладка своих подключений (`ConnectAccountDialog`). В обеих текст до подключения говорит, что подключение будет добавлено в этот workspace. Участник без прав подключает на второй вкладке, потому что диалог Add ему не показывается, и видит причину.
   - В Access убраны строка «Personal workspace · Your account» и текст «personal access is permanent». Чип «Personal» больше не ведёт в скрытый P: в «Available in» перечислены только реальные workspace, а P показан под своим именем и только когда он текущий. Без workspace пишется «Not shared»; для personal-only по-прежнему «Personal use».

## 3. Что переиспользуется

| Задача                | Готовое место                                                                         |
| --------------------- | ------------------------------------------------------------------------------------- |
| Права на X            | `workspaceAccess` в `personal-account-composition.ts` (`personal`, `canDetach`)       |
| Правило personal-only | `isPersonalOwnerOnlyProfile`, `assertProfileShareAllowed` (`provider-account.ts`)     |
| Запись binding        | `sharing.attach`, `attachPersonalAccount`, `PrismaPersonalAccountOperations.attach`   |
| Повтор и квитанция    | `PersonalAccountOperation` по ключу (actor, clientOperationId), `store.readOperation` |
| Обновление списков    | `refresh` в `AccountGatewayControls`, `refreshPersonalAccountViews`, `optionsCache`   |

## 4. Правило безопасности для автодобавления

Автодобавление - тот же явный attach из 56 §4: владелец выбирает X тем, что начинает подключение в X, и UI говорит об этом до подключения. Других полномочий нет.

- Источник принадлежит актору: connect-операция ищется по актору, `ownerUserId = actor`. Чужое подключение не добавить даже подделанным nonce.
- Актор - live owner/admin X: предпроверка через `workspaceAccess`, авторитетная - `lockMember` под блокировкой в `store.attach`. Участник без этих прав не может незаметно открыть другим участникам X ключ, за который платит сам: подключение создаётся, binding нет, UI говорит почему. Роль проверяется ещё раз при использовании (`assertWorkspaceUseOwner`).
- Профиль разрешает sharing: personal-only (GLM) никогда не попадает в организацию (`assertProfileShareAllowed` в use case и store). Целью не может быть чужой P (`workspaceAccess`, `lockSource`).
- Source активен и совпадает с аккаунтом Gateway (проверки `sharing.attach`).
- Идемпотентность: сохранённая квитанция окончательна. После отзыва binding повторный показ статуса доступ не восстанавливает. Если первая попытка не записалась, а потом был ручной attach и отзыв, store вернёт `conflict` из-за истории binding.
- `deletionState` X проверяет только `workspaceAccess`; `lockMember` и `lockSource` его не смотрят. Так же устроен и ручной Access, это не регрессия.
- Привязка намерения к X хранится только на клиенте. Подделанный вызов сервера даёт не больше, чем ручной Access: актор добавляет своё подключение туда, где он owner/admin.

## 5. Личный workspace не создаётся заново

Гарантию даёт `Workspace.personalOwnerUserId String? @unique` вместе с `FOR UPDATE` по `User`. P создают только `ensurePersonalWorkspaceOwner` (при входе) и `resolvePersonalWorkspace` (в личных операциях); оба ищут его через `findUnique` по этому ключу, поэтому второго P у пользователя быть не может. Новых workspace изменение не создаёт. P, на который ссылаются binding или операции, удалить нельзя (`onDelete: Restrict`). P с `deletionState` не `active` возвращается как есть. Новый P появится при следующем входе, только если старого действительно нет. Скрытие P в выборе workspace не меняется.

## 6. Тесты

- `personal-connect-attach.test.ts` (фейковые зависимости). P - без attach. GLM - `personal_only`. Участник, чужой и удалённый workspace - `not_permitted`. Чужой source - отказ. Connect не `applied` - без attach. Owner/admin - один attach с нужными полями и стабильным валидным nonce. Есть сохранённая квитанция - без нового attach, отзыв даёт `removed`. Корректно разбираются `denied` и `conflict`.
- UI (`account-gateway-account-controls.oauth.test.tsx`): добавляется только connect, начатый в текущем workspace, ровно один раз; свежий connect записывает свой workspace.
- PostgreSQL-наборы (`postgres-fences.ts`), покрывающие `store.attach`, не менялись и локально не запускались.

## 7. Вне объёма

- Автодобавление уже существующих подключений: для них остаются Access и Add to workspace.
- Подключения, принадлежащие организации: они и так создаются в X.
- Модель P, выбор workspace, данные и миграции.
- Использование GLM personal-only в организациях: это политика плана, а не UI.
- Фоновое добавление без открытого UI: connect финализируется при чтении статуса в UI, attach идёт сразу после него.
- Gateway и native не меняются.

## 8. Риски

- GLM можно использовать только в скрытом P. Если все репозитории пользователя в установках, GLM для ревью недоступен. Так было и раньше, теперь UI говорит об этом явно. Нужно отдельное продуктовое решение.
- Owner/admin подключил аккаунт в X, не прочитав текст: ключ сразу виден участникам X. Смягчение: текст до подключения и отзыв через Access.
- Если вкладку закрыть между `applied` и attach, подключение не добавится, пока статус не будет показан снова. Запись workspace живёт в sessionStorage, в новой вкладке её нет. Остаётся ручной Access.
