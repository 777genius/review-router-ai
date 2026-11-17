# Остатки после независимой проверки main (2026-11-17)

Статус: план и исправления, версия 2 (учтено ревью). Деплой и релиз Action не входят. База: RR `6b2d65822`, Gateway `d0c0af6`, runtime `3a256b15`.
Не входит: сортировка Runs, прогресс сканирования (план 73), первый запуск (план 74).

## G1. Gateway: обрыв потока после заголовков не виден (P2)

- Доказательства: `services/account-gateway/src/facade.ts`, catch после `res.headersSent` делает `markUnknown`, `abort`, `destroy` без строки лога. Запрос `c220b075`: native `complete`, effect `effect_unknown`, Caddy `unexpected EOF`. Транспорт (#112) пишет ошибки тела и `settle_*`, но не собственные шаги facade; после них генератор закрывается через `return()`, а `#settle(interrupted)` молчит.
- Исправление: локальный эмиттер в `facade.ts` (импорт `native-failure-diagnostics.ts` запрещён границей `private-facade`). Строка `gateway_facade_stream_failure`, фазы только для шагов facade: `relay_chunk`, `relay_write`, `relay_terminal`; плюс `kernel_code` и `request_ref`, без текста. Остановку в теле транспорта и незавершённый settle транспорт уже пишет: второй строки нет. Уход клиента не пишется (ответ уже `destroyed`). Остаётся без строки обрыв через `closeAllConnections` при остановке сервиса.
- Тесты: `facade-postgres` (лимит вывода - одна строка `relay_chunk`, отмена клиентом - ни одной), `facade-ingress` (срок - одна строка транспорта и ни одной от facade).
- Выкатка: вторая поставка, шаг Gateway после RR, вместе с #113/#114. SDK не меняется.

## R1. Usage опрашивает отчёт бесконечно (P2)

- Доказательства: `provider-usage-view.tsx` опрашивал каждые 30 с при `unknown > 0 || partial > 0`; `unknownWeight` (`usage-contribution.ts:63-64`) считает и окончательные вызовы без отчёта. На prod их ~79 (аудит 72, 4.6).
- Исправление: отчёт отдаёт `latestPendingAt` - самый поздний `occurredAt` засчитанного вызова с весом unknown/partial (SQL-агрегат totals и эталон в памяти). Web опрашивает, пока ему меньше часа. Готовой константы нет; час намного больше `requestTimeoutMs` relay на prod (180 с, верхняя граница схемы 1 ч) с задержкой сверки. Refresh остаётся.
- Тесты: эталон, паритет SQL на PG17, опрос в Web (свежий - да, старше часа - нет).

## R2. CI на main красный (P2)

- Доказательства: Quality Checks #896: `scripts/build-codex-rotating-action.test.ts:107`, бандл не равен закоммиченному; разница - `reviewerPlanContract` v2 из #892.
- Исправление: `node scripts/build-codex-rotating-action.mjs`. В runtime `action-dist/index.cjs` те же байты (`bf86e2d5…`); его обновит `Sync Public Action Runtime` после зелёного CI на main. `conflict-runtime.cjs` не трогаем.

## R3. Согласованность политик Gateway (P2)

- Доказательства: relay policy (`REVIEW_ROUTER_ACCOUNT_GATEWAY_RELAY_POLICY`) и run policy (`REVIEW_ROUTER_ACCOUNT_GATEWAY_POLICY`) независимы; 2026-11-16 NVIDIA была только в relay. Тот случай (`review-run-runtime-snapshot.ts:518`) уже 422 после #884. Остался `:537`: профиль connection не равен сохранённому - `null`, на authorize 500.
- Исправление: (а) API не стартует с `review_run_gateway_relay_profile_unapproved:<ids>`, если run policy задана и в ней нет профиля relay (ID не секрет). Следствие: профиль больше нельзя держать «только для проб» в relay, как 2026-11-15; добавлять в обе политики сразу. (б) `:537` даёт `gateway_profile_unapproved` (422), комментарий порта уточнён. `:533` (binding недоступен) - не профиль, без изменений.
- (в) Проверка при сохранении не сделана: Web не знает run policy. Копия env в Web расходится с API (шаг 1 triage менял только API), а нужный канал - новый подписанный эндпоинт API. Это не малое изменение, решение за владельцем.
- Риск выкатки: до деплоя read-only сверить, что все профили relay есть в run policy, иначе новый API не стартует.

## R4. Откат первой поставки (P3)

- Доказательства: шаг 1 отката в записи coordinated rollout устарел и не отзывает producer 240, не возвращает `v1` и FILE 67. Старый образ `0c67c3e0` принимает `reviewerPlanProfile` только с `planVersion: 1` и бросает `producer_reviewer_plan_profile_invalid`, когда разбирает строку 240 (БД, FILE 68, в том числе при отзыве).
- Исправление: в записи: каналы назад на 239, ожидание прогонов на 240, поиск закреплений на `v1.0.240`, отзыв 240 на новом образе, FILE 68 -> FILE 67, preflight, затем образ; запись экстренного переноса `v1`. Убраны устаревшие «in progress»/«branch head» в записях второй поставки.

## R5. Причина в summary (P3)

- Доказательства: runtime `run-t0-review-orchestration.ts`, `markExhausted` по умолчанию ставил `admission_limited` оставшимся слотам остановленного ревьюера; summary писал «Admission policy limited this review» при квоте или сбое провайдера.
- Исправление (runtime): причина слотов следует `stopReason`: `admission_limited` (оба enum), `investigation_deferred`, `deadline_reached` сохраняются, остальное - `attempt_budget_exhausted`. Terminal reason прежний, но строка `::error::` меняется на `required_work_exhausted`; e2e RR принимает обе. Действует с релизом Action после 240.
