# Свежесть лимитов: возраст вместо бейджа Outdated

Статус: план v4 после трёх ревью; реализации нет. Дата: 2026-11-18. База: [76](76-single-connections-list.md) (один список Connections, PR в работе) и #880. Только web, без миграций, без изменений Gateway/native. Ссылки ниже даны по символам и текстам, потому что 76 ещё правится.

## 1. Итог исследования

Исходная тема была шире: заменить все ручные Refresh автоматикой. Карта контролов и путей сервера показала, что почти вся автоматика уже есть:

- списки аккаунтов живут на `new QueryClient()` с настройками по умолчанию (`gateway-model-account-options.tsx:110`), inventory (`staleTime 15s`) перечитывается при монтировании и возврате во вкладку и через `extractAccountLimits` обновляет строки лимитов;
- публичный каталог моделей: TTL 30 мин на сервере, чтение после TTL само идёт к источнику, ручное не чаще раза в минуту (`public-model-catalog.ts:14-17`); каталог аккаунта читается без force при монтировании;
- Codex сам обновляет устаревшие лимиты при открытии карточки (#880).

Решения по частям:

- DO (этот план): бейдж «Outdated» → возраст наблюдения; тексты, которые просят нажать несуществующую «Refresh Accounts».
- MERGE-INTO-76: дубль «Refresh connections» под обзором (его ставит 76, ↻ панели уже обновляет обзор через `refreshPersonalAccountViews`) и тексты detach `conflict`/`denied` в обзоре. Передаётся в 76.
- DROP: тексты каталога моделей (у свежего каталога «Updated N min ago» сообщает то же, что «up to date»), скрытие «Reload saved limits» у свежей строки (кнопка исчезает под фокусом и сдвигает строку, выигрыш косметический), смена условия «Refresh personal accounts», общий модуль форматирования времени.
- DEFER: polling inventory и авто-refresh Codex при возврате во вкладку. Сначала нужна монотонность снимка по времени наблюдения (см. §7).
- Вне темы: Usage «Refresh» (ещё и сдвигает скользящее окно), «Retry scan» (действие над зависшим сканом), «Refresh GitHub access», ростер «Refresh accounts», History/Statistics.

## 2. Проблема пользователя

- П1. Через 5 минут на странице каждая строка лимитов получает жёлтый «Outdated» (`account-limits-line.tsx`, бейдж в строке окна). Выглядит как ошибка, хотя это просто возраст наблюдения; у Claude, который обновляется только после ответов модели, бейдж висит постоянно.
- П2. Тексты «The account changed. Refresh Accounts before trying again.» (`statusText`, `account-gateway-account-controls.tsx:201`) и «Binding status is unavailable. Refresh Accounts.» (:879-880) ведут к кнопке, которой нет: она называется «Refresh connections» и во вложенных списках 76 скрыта.

## 3. Правило

1. Устаревание по возрасту (≥5 мин) или неизвестный `observedAt` показывается на месте бейджа в той же строке окна приглушённым текстом «as of 12 min ago» / «as of 9 h ago» / «as of unknown time» (термин как у «As of:» в Details). Цвет ошибки не используется. Прошедший сброс по-прежнему показывает «Reset pending», возраст при этом пишется, только если устарел и он.
2. Возраст считается от `now` компонента (часы стартуют с `fetchedAt` и тикают раз в секунду), никогда от `Date.now()` в рендере, поэтому SSR и первый клиентский рендер совпадают. Без `role=status`/aria-live: текст меняется раз в минуту.
3. Подсказка бейджа «Ready describes the connection, not its remaining quota» переезжает текстом в Details (title недоступен с клавиатуры и на мобильных).
4. Кнопки не меняются: «Refresh limits» (Codex) и «Reload saved limits» видны как сейчас; refresh при открытии из #880 не меняется.
5. Тексты без несуществующих кнопок и без обещаний, что список уже обновлён: conflict → «The account changed. Check its current state before trying again.»; :879-880 → «Binding status is unavailable. Check the list before trying again.». Новых вызовов `refresh()` нет.

Владельцы: порог 5 минут сейчас записан дважды - в домене (`packages/features/provider-accounts/src/account-limits/domain/account-limits.ts`, литерал `300_000` в проекции stale) и в web (`ACCOUNT_LIMITS_OUTDATED_AFTER_MS`, `account-limits-query.ts:24`). Домен экспортирует константу, web импортирует её; если корень пакета тянет серверный код в клиентский бандл, добавить подпуть exports только для доменного модуля лимитов. Правило «устарело» на клиенте - одна `outdated()` в `account-limits-line.tsx`; форматирование возраста - локальный хелпер там же рядом с `resetText` (reset округляет вверх, возраст вниз). Инварианты [60](60-account-native-limits-implementation-plan.md) (нет авто-refresh по focus/reset, нет polling) не меняются.

## 4. Путь пользователя (до → после)

- Владелец Kimi + Codex читает страницу 10 минут. До: на 5-й минуте обе строки жёлтые «Outdated», хочется что-то чинить. После: «5h 64% left · Resets in 2h · as of 7 min ago» серым; ничего не сломано, кнопки на тех же местах. Клики те же.
- Claude утром. До: жёлтый «Outdated». После: «as of 9 h ago»; Details объясняет, что Ready - про подключение, а не про квоту.
- Конфликт при действии с аккаунтом. До: «Refresh Accounts before trying again» - кнопки с таким именем нет. После: понятный совет проверить текущее состояние.

Что хуже: ничего существенного; «as of N min ago» длиннее бейджа, на ширине 375px строка окна может перенестись (проверить скриншотом).

## 5. Нагрузка

Новых запросов нет.

## 6. Шаги (маленький PR после merge 76)

1. Домен: экспорт порога; web: `ACCOUNT_LIMITS_OUTDATED_AFTER_MS` = импорт, без второго литерала.
2. `account-limits-line.tsx`: бейдж → «as of …» по правилам 1-2; текст Ready в Details; поправить комментарий про «silent Outdated badge» из 76 и комментарий `account-limits-query.ts:23`.
3. `account-gateway-account-controls.tsx`: тексты правила 5.
4. Документы: 60 UI §3-4 (описание stale-состояния), задача в `ai-docs/deployments/`.

## 7. Тесты

- Unit `account-limits-line.test.tsx`: «Outdated» → «as of N min ago» (≥5 мин, неизвестный `observedAt`, сброс прошёл при свежем наблюдении - возраста нет); SSR/первый рендер дают одинаковый текст; переименовать тест, ожидающий бейдж.
- Unit oauth-тест с текстом «Refresh Accounts» (`account-gateway-account-controls.oauth.test.tsx:1405`).
- E2E `scripts/accounts-reference-e2e/src/tests/account-limits.spec.ts`: проверки «Outdated» (:145, :567) → «as of»; скриншот мобильной строки.
- Прогон затронутых unit, typecheck и reference E2E limits на Hetzner.

## 8. Деплой

Только web image; без миграций, конфигурации и feature flag. Откат - предыдущий image.

## 9. Найдено попутно (отдельные задачи, не здесь)

- Монотонность снимка сравнивает `fetchedAt` RR, а не время наблюдения (`account-limits-query.ts:106,172-176`): inventory при фокусе уже сейчас может перекрыть свежий refresh Codex более старым наблюдением. Блокирует будущий polling; ближе всего к 76 §3.
- `credentials_rejected` никто не выдаёт, а `forbidden`/`unauthenticated` в refresh превращаются в `generation_changed` (`account-limits-composition.ts:218-224`): отозванный вход Codex не говорит «Reconnect».
- Блокировки кнопки refresh до `retryAt` (60 §5) нет.
