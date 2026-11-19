# 15. Включение progress-комментариев (#821) и старые dead letter скана репозиториев

Статус: решения для владельца, ничего не включено и не перезапущено. Факты: код `main` `50e966d06`, prod `061f04bc`, read-only SQL и `gh` на 2026-11-19 17:30 UTC.

## 1. Как работает publisher (по коду)

- Runtime создаётся только при `REVIEW_ROUTER_HOSTED_PROGRESS_COMMENT_WRITES=1` и непустом `REVIEW_ROUTER_PROGRESS_REPOSITORIES` (`review-v2-production-runtime.ts`, `createHostedReviewProgressRuntime`). Env читается при старте worker. API и scan worker эти ключи не читают.
- Allow-list стоит в самом SQL выбора строки (`repositoryCohortPredicate` в `review-progress-claim-eligibility-policy.ts`). Строки других репозиториев не выбираются и не claim-ятся, запросов в GitHub по ним нет. `*` означает все репозитории.
- Перед каждым POST/PATCH/DELETE gateway делает `GET pulls/{n}`. Если PR не open или head не равен `activeHeadSha`, ошибка `stale_head` без ретрая, строка закрывается через `suppress` (`publishedVersion = desiredVersion`, `lastErrorCode = review_progress_stale_head`), в GitHub ничего не пишется. Если репозиторий не selected, archived или установка не active, строка откладывается на 60 с без записи. Фильтра по возрасту и механизма истечения нет.
- Статус `complete` ставит только `promoteSettledExecutions`, и только для review, завершившихся в проходе worker, где runtime уже существует. Пока флаг 0, а capture включён, каждый успешный review навсегда остаётся в `assembling`. Так и копится backlog. После включения старые строки терминала не получат никогда.

## 2. Данные prod

- Worker: `PROGRESS_PROJECTION_CAPTURE=1`, `PROGRESS_FILE_COVERAGE=1`, `HOSTED_PROGRESS_COMMENT_WRITES=0`, в `PROGRESS_REPOSITORIES` одна запись `777genius/review-router-saas-e2e` (там `selected=false`, 1 pending).
- `ReviewProgressPublicationV1`: 1221 строка, 1138 pending и due (растёт на 4-59 в день), 0 claim. Последняя публикация 2026-09-17, всего публиковалось 84 строки.
- Возраст pending: меньше 1 дня 4, 1-7 дней 76, 7-30 дней 663, больше 30 дней 395. Исход: 554 без терминала (`assembling`), 538 `failed`, 29 `complete`, 15 `complete_with_gaps`, 2 `superseded`.
- 25 репозиториев. Больше всего у `777genius/agent-teams-ai` 218, `777genius/review-router-ai` 169, `777genius/social-monitor` 164, `agent-teams-ai/get-modular` 149, у сторонней `padelapp-club/monorepository` 68 pending.
- Канарейка `777genius/rr-codex-rotating-e2e`: 40 pending (PR 51-140, 38 `assembling`, 2 `failed`). По GitHub 33 из них на закрытых PR. 7 на открытых PR с тем же head: 82, 83, 84, 101, 103, 133, 135.

## 3. Вердикт

- **Только канарейка: для чужих репозиториев безопасно.** Остальные 1098 pending строк publisher не выберет, в GitHub по ним ничего не уйдёт. Promotion в БД начнёт закрывать только новые завершённые review всех репозиториев, старые строки не трогает. Общий риск для всех один: ошибка фазы `review_v2.progress_*` переводит весь цикл worker на `errorDelayMs` (`outbox-worker-loop.ts`), и тогда review и outbox идут медленнее.
- **Первый прогон без подготовки:** по 33 строкам будет `GET` и `suppress` без записи. На 7 открытых PR канарейки (все 7 в `assembling`) появятся новые комментарии "Assembling results" к давно законченным review, и такими они останутся. Вред небольшой, репозиторий одноразовый, но канарейка уже не даёт чистого сигнала.
- **Расширять allow-list (новые репозитории или `*`) без истечения backlog нельзя.** Устаревшие "Assembling results" и "Failed" появятся на открытых PR, в том числе чужих (padelapp-club). Отменить это трудно.

## 4. Backlog: варианты (не запускать без апрува)

1. **(Рекомендую) Закрыть строки канарейки одним guarded UPDATE.** Эффект тот же, что у `suppress`, но без GitHub. Запускать при флаге 0, в сессии владельца БД (как в `deploy/hetzner/db-grants/README.md`). Число в проверке берётся из `SELECT count(*)` с теми же условиями прямо перед запуском. При несовпадении `DO`-блок откатывается целиком. Перед расширением тот же запрос для целевых репозиториев с отсечкой на момент расширения. Новый review на том же PR поднимет `desiredVersion` и снова откроет строку. Надёжность 9/10, уверенность 8/10.

   ```sql
   DO $$ DECLARE n int; BEGIN
     UPDATE "ReviewProgressPublicationV1" p
        SET "publishedVersion" = p."desiredVersion", "lastErrorCode" = 'review_progress_backlog_expired', "updatedAt" = now() AT TIME ZONE 'UTC'
       FROM "RepositoryConnection" r
      WHERE r."id" = p."repositoryConnectionId" AND lower(r."fullName") = '777genius/rr-codex-rotating-e2e'
        AND p."desiredVersion" > p."publishedVersion" AND p."claimId" IS NULL
        AND p."updatedAt" < (now() AT TIME ZONE 'UTC') - interval '1 hour';
     GET DIAGNOSTICS n = ROW_COUNT;
     IF n <> 40 THEN RAISE EXCEPTION 'expected 40 rows, got %', n; END IF;
   END $$;
   ```

2. В БД ничего не трогать, принять 7 устаревших комментариев в канарейке и удалить их руками. Для расширения не годится. Надёжность 6/10, уверенность 9/10.
3. Отсечка по возрасту в коде (пропускать строки старше N часов). На длинной дистанции правильнее, но сейчас лишнее. Вернуться к ней при расширении. Надёжность 8/10, уверенность 6/10.

## 5. Канарейка: шаги

**Предусловия:** апрув владельца. На prod образ с #821 (`061f04bc` это так). Выполнен вариант 1 из раздела 4: 0 pending строк канарейки. Записан baseline: pending по репозиториям и `max("lastPublishedAt")` вне канарейки. Параллельно не идёт другой релиз.

**Смена env** одним прогоном `deploy/hetzner/fleet-overlay` (`set`, роль worker; значения уходят и в канонический env-файл; пересоздаётся весь флот, будет короткий простой). В `REVIEW_ROUTER_PROGRESS_REPOSITORIES` оставить только канарейку, `review-router-saas-e2e` убрать. `REVIEW_ROUTER_HOSTED_PROGRESS_COMMENT_WRITES` поставить в 1. `REVIEW_ROUTER_PROGRESS_PROJECTION_CAPTURE` и `REVIEW_ROUTER_PROGRESS_FILE_COVERAGE` не трогать.

**Шаги и наблюдение.** Отдельных логов успеха у publisher нет: счётчики `progress*` в лог не выводятся. Ошибки видны в строке `ReviewRouter worker phases failed` с фазами `review_v2.progress_*`, коды — только в `lastErrorCode` в БД.

1. После apply: worker running, 0 рестартов, нет `phases failed` с `review_v2.progress_*`. Пока нет нового review, у строк канарейки не меняются `lastErrorCode` и `updatedAt`.
2. Один review в канарейке: новый PR или новый коммит в переиспользуемый PR 135. Ровно один комментарий с маркером `<!-- review-router-live-progress -->`. Он обновляется во время review (до 90 с) и приходит в Complete или Complete with gaps примерно через 30 с после App summary. В строке `publishedVersion = desiredVersion`, `lastErrorCode` и `failureCount` пусты.
3. Новый коммит посреди review: тот же комментарий обновляется на месте, дубля нет.
4. 24 ч, SQL раз в несколько часов. По канарейке: `lastErrorCode`, `failureCount` и возраст строк с `desiredVersion > publishedVersion`. Вне канарейки ни одной строки с `lastPublishedAt` или `commentId` после включения.

## 6. Откат

`fleet-overlay` `set` `REVIEW_ROUTER_HOSTED_PROGRESS_COMMENT_WRITES` в 0. Если вместо этого запускаются старые контейнеры `*-before-ovl-*`, канонический env-файл нужно восстановить из `snapshot.json` custody-каталога, иначе в нём останется 1. Запись в GitHub прекращается только после пересоздания worker. Данные чинить не нужно: claim истекают через 25 с, строки остаются согласованными, backlog снова растёт (capture включён). Опубликованные комментарии назад не забрать. Комментарий review, который шёл во время отката, застынет в промежуточном состоянии. Владелец удаляет его руками, он admin канарейки.

## 7. Go / no-go

- **GO для канарейки:** выполнены все предусловия, allow-list состоит ровно из канарейки.
- **Немедленный откат:** запись вне канарейки. Дубль комментария. Комментарий без терминала дольше 5 мин после App summary. Повторяющиеся `phases failed` по `review_v2.progress_*`. Рост `failureCount` или `snapshot_invalid` / `pagination_inconclusive` в `lastErrorCode`.
- **Расширение** — отдельное решение. Нужны: не меньше 3 чистых review в канарейке, включая supersession; гейты шага 4 из `docs/operations/live-review-progress-rollout.md` (restart, duplicate reconciliation, permission loss, rate-limit cooldown); смёрженный и выкаченный #920 (fence пагинации, Draft); закрытый backlog целевых репозиториев. Для чужих workspace это новое видимое поведение на их PR, то есть продуктовое решение. Каждый шаг активации записывать в `ai-docs/deployments/2026-11-19-worker-progress-comment-refactor.md`.

## 8. Dead letter `installation.sync_requested`

**Что ловит verify.** `scripts/check-runtime-db-privileges.mjs` смотрит permission dead letters только за 7 дней. Все 9 событий относятся к одной установке: организация agent-teams-ai (`129733005`), 2026-11-14 20:47 – 2026-11-15 21:47, до возврата гранта 2026-11-17. Из окна они выйдут сами **2026-11-22 21:47 UTC**. Retry scan их не уберёт: он создаёт новое событие (ключ на установку и минуту), старые dead letter остаются.

**Отдельная группа:** 6 активных установок с dead letter в последнем событии. С #898 пять видимых в дашборде показывают "Repository scan failed" и Retry scan:

| Установка (workspace)         | Причина                                                                                | Сейчас                                                    | Действие                                                      |
| ----------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------- |
| agent-teams-ai `129733005`    | permission denied (грант вернули)                                                      | 45 repo, успех 11-13, изменения 11-14/15 мимо             | Владелец (участник): Retry scan                               |
| padelapp-club `132585208`     | `codex_oauth_runtime_referential_update_forbidden`, исправлено миграцией 000133 (#608) | 22 repo                                                   | Владелец (участник): Retry scan                               |
| 777genius user `128841731`    | GitHub `Not Found` при выдаче токена                                                   | 0 repo, в дашборде скрыта (берётся `130834037`, 460 repo) | Ничего: ретрай снова упадёт; строка устарела, чистка отдельно |
| mahdiansyahja-sys `163589516` | permission denied for sequence (исправлено)                                            | 0 repo, продуктом не пользовался                          | Пользователь сам: Retry scan                                  |
| chadalanlester `135326125`    | permission denied for table (исправлено)                                               | 12 repo на 07-05                                          | Пользователь сам                                              |
| ibotpafos `158042724`         | как у padelapp-club (исправлено)                                                       | 15 repo                                                   | Пользователь сам                                              |

**Механизм.** Retry scan и Refresh repos вызывают `requestInstallationSyncClientAction`. Нужен участник workspace с правом изменений и entitlement. Есть rate limit, lease lock и аудит. Обработчик заново сверяет весь список репозиториев установки с GitHub, поэтому повтор безопасен. Репозитории, которых установка больше не видит, помечаются removed. Сейчас это безопасно: 7 проверок прав worker в verify проходят. `retryDeadLetter` из списка outbox не подходит: у sync-событий нет `workspaceId`. Скрипта оператора нет. Ручной requeue, как 2026-10-31, без отдельного апрува не повторять.

**Verify.** Самое маленькое изменение: ничего не менять. До 2026-11-22 21:47 UTC в записи релиза считать строку "9 / `installation.sync_requested` / latest 2026-11-15 21:47:43" известной базой. Учесть, что `cmd_verify` при этой ошибке падает раньше `check_ready`, поэтому `/ready` проверять руками. Если нужно раньше и строже: в `permissionDeadLetterQuery` пропускать dead letter, у которого есть событие того же `type` и `aggregateId` со `status = 'processed'` и `processedAt > deadLetteredAt`. Это около 4 строк и 1 тест. Тогда verify станет чистым сразу после Retry scan в agent-teams-ai. Ручку с датой baseline не добавлять.
