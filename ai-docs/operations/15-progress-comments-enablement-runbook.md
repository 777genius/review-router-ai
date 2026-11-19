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

- **Включать только для канарейки безопасно для всех, кроме самой канарейки.** Остальные 1098 pending строк publisher не выберет, в GitHub по ним ничего не уйдёт. Promotion будет менять их в БД, на GitHub это не влияет.
- **Первый прогон без подготовки:** по 33 строкам будет `GET` и `suppress` без записи. На 7 открытых PR канарейки появятся новые комментарии "Assembling results" к давно законченным review, и такими они останутся. Вред небольшой, репозиторий одноразовый, но канарейка перестаёт быть чистым сигналом.
- **Расширять allow-list (новые репозитории или `*`) без истечения backlog нельзя.** Устаревшие "Assembling results" и "Failed" появятся на открытых PR, в том числе на чужих (padelapp-club). Отменить это трудно.

## 4. Backlog: варианты (не запускать без апрува)

1. **(Рекомендую) Закрыть строки канарейки одним guarded UPDATE.** Эффект тот же, что у `suppress`, без GitHub. Запускать при флаге 0, в сессии владельца БД (как в `deploy/hetzner/db-grants/README.md`). Перед расширением тем же запросом закрыть строки целевых репозиториев с отсечкой на момент расширения. Новый review на том же PR поднимает `desiredVersion` и снова открывает строку, поэтому живой прогресс не теряется. Надёжность 9/10, уверенность 8/10.

   ```sql
   BEGIN;
   UPDATE "ReviewProgressPublicationV1" p
      SET "publishedVersion" = p."desiredVersion", "lastErrorCode" = 'review_progress_backlog_expired', "updatedAt" = now()
     FROM "RepositoryConnection" r
    WHERE r."id" = p."repositoryConnectionId" AND lower(r."fullName") = '777genius/rr-codex-rotating-e2e'
      AND p."desiredVersion" > p."publishedVersion" AND p."claimId" IS NULL AND p."updatedAt" < now() - interval '1 hour';
   -- Ожидается UPDATE 40 (сверить с SELECT count(*) по тем же условиям). Иначе ROLLBACK.
   COMMIT;
   ```

2. Ничего не трогать в БД, принять 7 устаревших комментариев в канарейке и удалить их руками. Для расширения не годится. Надёжность 6/10, уверенность 9/10.
3. Отсечка по возрасту в коде (пропускать строки старше N часов). Это правильнее надолго, но сейчас лишнее. Можно вернуться к ней при расширении. Надёжность 8/10, уверенность 6/10.

## 5. Канарейка: шаги

**Предусловия:** апрув владельца. На prod образ с #821 (`061f04bc` это так). Выполнен вариант 1 из раздела 4, и SELECT показывает 0 pending строк канарейки. Записан baseline: pending по репозиториям и `max("lastPublishedAt")` вне канарейки. Параллельно не идёт другой релиз.

**Смена env** одним прогоном `deploy/hetzner/fleet-overlay` (`set`, роль worker; пересоздаётся весь флот, короткий простой, старые контейнеры `*-before-ovl-*`):

- `REVIEW_ROUTER_PROGRESS_REPOSITORIES`: только канарейка, `review-router-saas-e2e` убрать;
- `REVIEW_ROUTER_HOSTED_PROGRESS_COMMENT_WRITES`: 1.

`PROGRESS_PROJECTION_CAPTURE` и `PROGRESS_FILE_COVERAGE` не трогать.

**Шаги:**

1. После apply: worker running, 0 рестартов. Поля `progress*` в итоге maintenance не `null`. Первые проходы дают `progressClaimed` 0.
2. Один review в канарейке: новый PR или новый коммит в переиспользуемый PR 135. Ожидается ровно один комментарий `review-router-ai[bot]`. Он обновляется, пока идёт review (до 90 с), и приходит в Complete или Complete with gaps примерно за 30 с после App summary. В строке `publishedVersion = desiredVersion`, `lastErrorCode` пуст.
3. Новый коммит посреди review: тот же комментарий обновляется на месте, без дубля.

**Что смотреть 24 ч:** в логах worker коды `review_progress_*`, особенно `snapshot_invalid`, `pagination_inconclusive` и `github_*`. Рост `progressFailed`. Распределение `lastErrorCode` в канарейке. Вне канарейки не должно появиться ни одной строки с `lastPublishedAt` или `commentId` после момента включения.

## 6. Откат

`fleet-overlay` `set` `REVIEW_ROUTER_HOSTED_PROGRESS_COMMENT_WRITES` в 0 или возврат контейнеров `*-before-ovl-*` этого прогона. Запись в GitHub прекращается только после пересоздания worker. Чинить данные не нужно: claim истекают через 25 с, строки остаются согласованными, backlog снова растёт (capture включён). Нельзя откатить уже опубликованные комментарии. Комментарий review, который шёл в момент отката, застынет в промежуточном состоянии. Владелец удаляет его руками (он admin канарейки).

## 7. Go / no-go

- **GO для канарейки:** выполнены все предусловия, allow-list состоит ровно из канарейки.
- **Сразу откат:** запись вне канарейки. Дубль комментария. Комментарий без терминала дольше 5 мин после App summary. Всплеск `snapshot_invalid` или `pagination_inconclusive`. Растёт `progressFailed`.
- **Расширение** решается отдельно и требует: не меньше 3 чистых review в канарейке, включая supersession; смёрженный и выкаченный #920 (Draft, fence пагинации комментариев); закрытый backlog целевых репозиториев. Для чужих workspace это видимое новое поведение на их PR, то есть продуктовое решение.

## 8. Dead letter `installation.sync_requested`

**Что ловит verify.** Проверка в `scripts/check-runtime-db-privileges.mjs` смотрит permission dead letters только за 7 дней. Её 9 событий относятся к одной установке: организация agent-teams-ai (`129733005`), 2026-11-14 20:47 – 2026-11-15 21:47, до возврата гранта 2026-11-17. Сами выйдут из окна **2026-11-22 21:47 UTC**. Retry scan их не уберёт: он создаёт новое событие (ключ на установку и минуту), старые dead letter остаются.

**Отдельная группа:** 6 активных установок, у которых последнее событие dead letter. После #898 они видят "Repository scan failed" и Retry scan:

| Установка (workspace)         | Причина                                                                                | Сейчас                                                    | Действие                                                      |
| ----------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------- |
| agent-teams-ai `129733005`    | permission denied (грант вернули)                                                      | 45 repo, успех 11-13, изменения 11-14/15 мимо             | Владелец (участник): Retry scan                               |
| padelapp-club `132585208`     | `codex_oauth_runtime_referential_update_forbidden`, исправлено миграцией 000133 (#608) | 22 repo                                                   | Владелец (участник): Retry scan                               |
| 777genius user `128841731`    | GitHub `Not Found` при выдаче токена                                                   | 0 repo, в дашборде скрыта (берётся `130834037`, 460 repo) | Ничего: ретрай снова упадёт; строка устарела, чистка отдельно |
| mahdiansyahja-sys `163589516` | permission denied for sequence (исправлено)                                            | 0 repo, продуктом не пользовался                          | Пользователь сам: Retry scan                                  |
| chadalanlester `135326125`    | permission denied for table (исправлено)                                               | 12 repo на 07-05                                          | Пользователь сам                                              |
| ibotpafos `158042724`         | как у padelapp-club (исправлено)                                                       | 15 repo                                                   | Пользователь сам                                              |

**Механизм.** Retry scan и Refresh repos вызывают `requestInstallationSyncClientAction`. Нужен участник workspace с правом изменений и entitlement. Есть rate limit, lease lock и аудит. Обработчик заново сверяет весь список репозиториев установки с GitHub. Повтор безопасен; репозитории, которых установка больше не видит, помечаются removed. Сейчас это безопасно: 7 проверок прав worker в verify проходят. Retry из списка outbox (`retryDeadLetter`) здесь не подходит: у sync-событий нет `workspaceId`. Скрипта оператора нет. Ручной requeue (2026-10-31) повторять без отдельного апрува не стоит.

**Verify.** Самое маленькое изменение: никакого. До 2026-11-22 21:47 UTC считать строку "9 / `installation.sync_requested` / latest 2026-11-15 21:47:43" известной базой в записи релиза. Если нужно раньше и строже: в `permissionDeadLetterQuery` не учитывать dead letter, после которого есть `processed` событие того же `type` и `aggregateId`. Это около 4 строк и 1 тест; тогда verify очистится сразу после Retry scan в agent-teams-ai. Ручку с датой baseline не добавлять.
