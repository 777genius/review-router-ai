# Все провайдеры доступны во всех workspace

Статус: план v2 (учтено независимое ревью v1) и реализация в одном PR; деплой не входит.
Дата: 2026-11-17. Решение владельца (окончательное): любой провайдер можно подключить, добавить и использовать в любом workspace. Отменяет правило «GLM только в личном workspace владельца» из [63](63-coding-plans-and-grok-implementation-plan.md) и его применение в [66](66-connect-attaches-to-current-workspace.md).

## 1. Что было

Профиль `glm-coding-global-responses-apikey-v1` (только он; Kimi и MiniMax не ограничены) признавался «personal-only» функцией `isPersonalOwnerOnlyProfile` в `provider-account.ts`. Точки применения:

| Слой          | Место                                                                                                                                                                                                                                                                                                                                                                     |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Использование | `assertProfileUseAllowed` в `selectBinding`: снимок прогона, review config, conversation policy, model settings, probe, installed confirmation, выбор модели в дашборде                                                                                                                                                                                                   |
| Привязка      | `assertProfileShareAllowed`: `attachPersonalAccount` и `PrismaPersonalAccountOperations.attach` (Access, Add и автодобавление из 66), `changeBinding` и `compareAndSetBinding` (аккаунт workspace), `changeOperatorWorkspaceAccountGrant` (operator pool)                                                                                                                 |
| Дашборд       | `connection.personalOnly` (`account-connection-catalog.ts`, `gateway-model-account-options.ts`), причина `personal_only` (`personal-connect-attach.ts`), фильтры профилей и «Personal use» в `account-gateway-account-controls.tsx`, `personal-account-controls.tsx`, `connection-setup-continuation.ts`, `accounts-add-dialog.tsx`, `account-connection-presentation.ts` |

Native (`agent-teams-ai/sub2api`) и Gateway (`agent-teams-ai/account-gateway`) правила не содержат: поиск по `origin/main` (personal owner, personalOnly, owner-only, sharing) ничего не нашёл, контракт `provider-connections/v1` флага не несёт, `ACCOUNT_GATEWAY_OWNERSHIP.md` о нём молчит. В БД правила нет: миграции не упоминают профиль, «personal-only guard» в 124 - это запрет вернуть отозванный личный binding и проверка владельца и цели операции. Меняется только RR.

## 2. Решение

1. Удалить `isPersonalOwnerOnlyProfile`, `assertProfileUseAllowed`, `assertProfileShareAllowed` и все вызовы. Профильной политики владения не остаётся, флагов тоже.
2. Удалить поле `personalOnly` из `ConnectionCapabilities` и `completion`, причину `personal_only` из `ConnectWorkspaceAttachment`, тексты «Personal use», фикстуры с `personalOnly`.
3. Дашборд: GLM есть в подключении от имени workspace, у личного GLM есть Access и Add to workspace, автодобавление из 66 работает для любого профиля.
4. Не меняется: attach только своего source и только в workspace, где актор owner/admin (`workspaceAccess`, `lockMember` под блокировкой, триггер 124); при использовании `assertWorkspaceUseOwner` (даритель owner/admin X либо владелец P); потеря роли отзывает grants; чужой P не цель; operator grant требует admin operator workspace; квоты видит только владелец.

## 3. Данные и совместимость

- Миграции нет. Существующие GLM bindings лежат только в P и остаются валидными.
- `personalOnly` нигде не хранится: `completion` сервер строит при каждом чтении, представление OAuth живёт в React state, sessionStorage держит только nonce и workspace.
- `vendor/account-gateway/grok-code-130ca3f00dcc-rr-qualification.json` («GLM personal-only access and receipt») - неизменяемое доказательство прошлой квалификации, его не правим.

## 4. Поставка, деплой и откат

- Один PR в RR. Деплой api и web одним релизом; если раздельно, сначала api. Web раньше api: GLM добавится в X, но старый api откажет при захвате снимка (`selectBinding`), ревью получит отказ binding, утечки нет.
- 66 и 70 выкатывать одним релизом. Иначе GLM, подключённый из X между релизами, получит «cannot be added», а после выкатки 70 при следующем показе статуса тихо добавится в X: `ConnectWorkspaceAttach` повторяет attach при монтировании, а отказ `personal_only` не сохраняется.
- Откат api/web возвращает запрет. GLM bindings в организациях и operator grants GLM остаются записями, но старый `selectBinding` их не исполняет: ревью репозиториев, чей review config указывает на такой binding, падают с отказом binding до смены конфига. Перед откатом найти такие конфиги (review config X с `gatewayProfileRef` GLM) и переключить их или принять отказ. Отозвать binding в X можно через Detach (у старого UI нет Access для GLM).

## 5. Тесты

- Переписать тесты старого запрета на новое поведение: `binding-policy` (таблица по всем профилям подписок, включая GLM: донор owner/admin в X исполняется, member и `null` - отказ), `use-cases` (bind GLM workspace, operator grant GLM доходит до записи, attach GLM в организацию доходит до Gateway и store), `personal-connect-attach` (GLM добавляется в X, member - `not_permitted` без attach), UI-квитанция GLM без «Personal use», e2e `subscription-connections.spec.ts`.
- Регрессия прав: member и чужой source отклоняются (`personal-connect-attach`, `binding-policy`); тест `use-cases` «GLM selection requires the actual personal owner» остаётся без изменений.
- Прогон: typecheck, eslint, prettier, vitest web/api по затронутым файлам, `node --test` пакета provider-accounts. PostgreSQL-наборы не запускаются: SQL и store не меняются, кроме удалённой проверки профиля.
- E2E подписок (`--isolated-pglite --subscription-fixture`) запущен и падает на первом шаге, до изменённых проверок: его `keyForm` ищет пункт меню «Connect with API key», которого в текущем UI нет (спецификация не менялась с #714, в CI не входит). Это старый дрейф, не следствие этого PR; чинить его - отдельная задача.

## 6. Риски

- Условия Z.ai: «Account sharing or multi-user access is prohibited.» и «Accounts with more than three violations may be banned.» ([GLM Usage Policy](https://docs.z.ai/devpack/usage-policy), проверено 2026-11-17). Ревью из организации на личном ключе подпадает под это. Operator pool с GLM-ключом делает один ключ общим для всех workspace-получателей, это ещё более явное multi-user использование. Решение принято владельцем; риск блокировки ключа несёт его владелец. MiniMax рекомендует PAYG для production (63), у Kimi серверные ревью не подтверждены; запрета в коде у них и не было.
- Участники X видят имя подключения GLM и выбирают его в review config, как любой личный binding. Ключ и квоты им не видны.
- Конкурирующие правки в `account-gateway-account-controls.tsx` и тестовых фикстурах: rebase перед merge.
