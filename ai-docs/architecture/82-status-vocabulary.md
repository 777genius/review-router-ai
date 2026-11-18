# Словарь статусов в дашборде: узкий проход вместо общей системы

Статус: план v4 (R6, учтены четыре ревью-раунда: §9). Дата: 2026-11-18. Только web, без сервера, БД, env и миграций. Отдельный небольшой PR после merge [76](76-single-connections-list.md), поверх его колонки Status; в 76 не вливается, чтобы не расширять его ревью.

## 1. Инвентаризация

Четыре темы, у каждой уже есть один владелец правила:

| Тема | Слова | Владелец |
| --- | --- | --- |
| Здоровье подключения | Ready, Confirming change/connection, Removing…, Outcome not confirmed yet, Details could not be refreshed, Disabled, Retired, Needs attention, Unavailable | `accountStatusInfo` (`accounts-copy.ts:52`) + `AccountStatusLine` (`account-status-icon.tsx:54`) |
| Свежесть данных | Outdated (лимиты), «Model list is up to date / Showing the last model list», «list may be out of date» (скан) | `account-limits-line.tsx`, `provider-model-catalog.tsx`, `repository-scan-status.tsx` |
| Покрытие расхода | Not reported, Reported/Estimated, Free model, Included in subscription, «N calls with incomplete token data» | `provider-usage-format.ts`, `provider-usage-tables.tsx` |
| Готовность репозитория | Ready, Needs setup, Needs attention (+ label/summary/nextAction) | `dashboard-repository-readiness.ts:83-87`, `repository-health-view.ts` |

Слова разных тем различаются по делу: «Not reported» у расхода значит «источник не дал число» и не равно «Unknown». История и статистика имеют своих владельцев (`history-presentation.ts`, `statistics-presentation.ts`). «Not added here» уходит в 76 (строка `WorkspaceUseLine`).

Дефекты:

1. «Outcome not confirmed yet» стоит в Status строки, когда никакой операции нет: Gateway не прочитан или его данные не сошлись с локальной копией (`accounts-overview.ts:206-220, 286-293`; `personal-canonical-accounts.ts:282-286, 319-325, 810-818`). Пользователь ищет операцию, которой не было.
2. Запасной список (`account-gateway-account-controls.tsx:1257-1286`) показывает сырой enum (`<Badge>{account.state}</Badge>`: «quarantined», «staging», «tombstoned»), бейдж «Binding locally denied; remote fence pending» / «Workspace binding ready» / «Binding revoked» и абзац «Logical denial only; credential erasure and transport cleanup are unverified». Это нарушает `ai-docs/design/frontend-workflow.md:23-24` (внутренние имена не для продуктовых экранов). Список виден, если личный шаринг выключен (`readPersonalAccountSharingEnabled`, например self-hosted) или `workspaceAccess` упал (`account-gateway-accounts-section.tsx:35-53, 252`).
3. Порядок выбора статуса строки (ошибка чтения → удаление → подтверждение → `accountStatusInfo`) написан дважды: в 76 это `personal-account-controls.tsx` и `workspace-personal-accounts.tsx` (номера сверить после rebase). Пользователь этого не видит; это DRY.
4. Мёртвое параллельное правило `summarizeWorkspaceHealth` (`repository-health-view.ts:126-174`) вызывает только тест, и бакеты у него другие, чем у живой `summarizeWorkspaceSetupReadiness` (`dashboard-workspace-page.tsx:2127`). Diagnostics печатает всегда нулевое «/ 0 unknown» (`:1818-1820`). Мёртв `accountStatus()` (`accounts-copy.ts:79`).

## 2. Вердикт

- Общая модель статусов и один компонент Status на все темы: **DROP**. Владельцы есть, словари честно разные; общий компонент стал бы объединением тонов, иконок и видов без пользы для пользователя и задел бы ~20 файлов других задач.
- Подсказки «почему + что сделать»: **DROP**. Сервер не отдаёт причин, а действия зависят от custody, профиля и прав (`account-lifecycle.ts:62-66`, `account-gateway-account-controls.tsx:961-981`); текст был бы неправдой для части строк.
- Переименование «Needs attention» для `quarantined`: **DROP**. Причин карантина несколько (дубль, несовпадение identity, потерянный ответ), а сам он окончательный; «Not confirmed» читалось бы как «подождите».
- Узкий проход по дефектам 1-4: **DO**, примерно +35 / -100 строк. Видимая польза только у 1, 2 и «0 unknown»; 3 и остальное 4 - гигиена, так и подписано.

## 3. Путь пользователя до и после

- Данные подключения не сошлись или Gateway не ответил. До: «? Outcome not confirmed yet», пользователь ищет свою операцию. После: «? Status unknown» - честно, без несуществующей операции. Новых действий не обещаем.
- Self-hosted без шаринга. До: «quarantined», «Binding locally denied; remote fence pending», абзац про erasure. После: та же иконка и слова, что в основном списке, плюс «Used in this workspace» / «Not added to this workspace» из 76. Пока у привязки (active или revoked) ждёт fence: «Confirming change», а не ложное «Ready». Подсказка заблокированной кнопки Add «Workspace binding in progress — please wait.» (`account-gateway-account-controls.tsx:943-944`) видна и после detach, где описывает обратное действие; она становится «Confirming change - try again later.». Основной список в этом редком случае без операции пишет «Unavailable» (`accounts-overview.ts:227, 287-292`); полного паритета нет, у запасного списка нет `readiness`, и это осознанно. После detach («Workspace use detached; gateway fence acknowledged/pending», `:915`) одно сообщение «Removed from this workspace.» для обоих вариантов: локальный revoke записан до доставки fence (`account-gateway-accounts.ts:1574-1589`), ожидание видно по статусу строки. Обрыв ответа при Add («Binding status is unavailable. Refresh Accounts.», `:872`, это `onError` записи, добавление могло пройти) → «Could not confirm adding to this workspace. Refresh to check.».
- Diagnostics: исчезает всегда нулевое «0 unknown».
- Хуже никому: Ready, Confirming, Removing, Disabled, Retired, Needs attention не меняются; новых строк в узкой колонке Status (`accounts-grid.ts:5`) нет.

## 4. Границы и владельцы

- Слова и вид статуса подключения: только `accountStatusInfo` и `pendingStatusCopy` в `accounts-copy.ts`.
- Порядок статуса строки: одна чистая функция `connectionRowStatus({ account?, refreshFailed, lifecycle, pendingChange })` там же; её вызывают оба списка 76 и запасной список. Комментарий у `pendingStatusCopy` обновить: там теперь не только переходы.
- Использование в workspace: только `bindingWorkspaceUse` и `WorkspaceUseLine` из 76 (`account-workspace-use.tsx`). Своего правила нет.
- Отрисовка: только `AccountStatusLine`. Ничего нового в `packages/ui` и `src/shared`.
- Сводка готовности репозиториев: живая `summarizeWorkspaceSetupReadiness` (со страницы) и её тип `WorkspaceHealthSummary` (из `repository-health-view.ts:13`, вместе с нужным ему тоном) переезжают в `dashboard-repository-readiness.ts` («The one composition of readiness facts»), который уже раскладывает строки по бакетам из `repository-search.ts`. Не в `repository-health-view.ts`: это дало бы цикл (на уровне типов) через `repository-search.ts:3` и снова смешало бы здоровье с бакетами. Страница - серверный компонент и уже импортирует этот модуль.

## 5. Шаги

1. Rebase на main с 76. Если 76 уже свёл порядок статуса в одну функцию, шаг 3 пропустить.
2. `accounts-copy.ts`: строковый статус при `readiness: "unknown"` и при незагруженной строке → «Status unknown». Тексты диалогов жизненного цикла («Outcome not confirmed yet. Check the original operation.») не трогаем: там операция есть. Удалить `accountStatus()`.
3. `connectionRowStatus` вместо двух инлайн-цепочек. Единственная смена поведения: если у строки идёт локальное не-delete действие, а сервер уже показывает pending delete, будет «Removing…» вместо «Confirming change».
4. Запасной список: убрать бейджи (`state`, привязка; бейдж происхождения всегда пуст, `view()` не задаёт `origin`) и абзац про erasure, поставить `AccountStatusLine(connectionRowStatus({ ..., pendingChange: account.binding?.fencePending }))` и `WorkspaceUseLine(bindingWorkspaceUse(account.binding))`. Короткий абзац для `quarantined` («could not be confirmed») оставить. Переписать сообщения `:872, :915` и подсказку `:944`. Номера строк сверить после rebase на 76 (там список ещё и при `!management`).
5. Перенести `summarizeWorkspaceSetupReadiness` в `dashboard-repository-readiness.ts`, удалить `summarizeWorkspaceHealth` и её тест-кейс (`repository-health-view.test.ts:46`), убрать `unknown` из `WorkspaceHealthSummary` и строки Diagnostics.

## 6. Тесты

- Unit-таблица `connectionRowStatus` + `accountStatusInfo` по краям приоритетов (не полное произведение): ошибка чтения, delete, локальное действие, `pendingChange`, каждый `readiness`, каждый `state`, нет `account`; плюс случай из шага 3.
- Компонентный тест запасного списка: нет текстов enum `state` и слов «fence»/«binding» ни в тексте, ни в `title`, в том числе после detach и обрыва Add; active + `fencePending` даёт «Confirming change» и «Used in this workspace»; revoked + `fencePending` даёт «Confirming change» и «Not added to this workspace».
- Сводка репозиториев: подсчёт и подпись по готовым бакетам (правило бакетов уже покрыто в `repository-search.test.ts:8-15`).
- Затронутые тесты на Hetzner (`personal-account-controls`, `workspace-personal-accounts`, `account-gateway-account-controls*`, `repository-health-view`, `account-lifecycle-controls`), `tsc`, lint. Стенд `scripts/accounts-reference-e2e`: спеки с «Retired» (`accounts-reference.spec.ts:550`, `subscription-connections.spec.ts`) и скриншот строки «Status unknown».

## 7. Деплой

Только web-образ, без миграций и env. Запись в `ai-docs/deployments/` при реализации. Выкатывать с ближайшей партией.

## 8. Вне рамок

- Слова расхода и «Outdated» у лимитов (лимиты ведёт 76 §3).
- Карточки hosted pool: свой домен («Cooling down», «Needs reconnect»).
- Бейдж «Account unavailable» в Providers (`provider-setup/provider-list.tsx:281-285`) сливает revoked, disabled и quarantined в один `available: boolean` (`provider-list-view.ts:169-171`). Честное слово требует менять серверную view model. Кандидат для задачи про список провайдеров.
- Подписи здоровья репозиториев, история, статистика, новые цвета и иконки.

## 9. Что поменяли ревью

- Раунд 1: убраны подсказки «почему + что сделать» (действия зависят от custody, профиля и прав; `canManage` не значит владение); правило «used по fence» заменено на `bindingWorkspaceUse` из 76.
- Раунд 2: отказ от «Not confirmed»; исправлено «Ready» у active + fence в запасном списке; убран параметр `notAdded` (конфликт с 76); сводка репозиториев переехала в `dashboard-repository-readiness.ts` вместо цикла импортов.
- Раунд 3: убрана ложная фраза о паритете с основным списком; в шаг 4 добавлены сообщения detach и ошибки привязки; тип сводки переезжает с функцией; `pendingChange` вместо `sourcePending`; таблица тестов по краям приоритетов.
- Раунд 4: `:872` - это обрыв ответа при Add, а не ошибка чтения, текст исправлен; подсказка `:944` добавлена в шаг 4; одно сообщение detach для обоих вариантов fence; уточнено, откуда переезжает тип сводки.
