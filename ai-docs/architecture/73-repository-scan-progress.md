# Прогресс сканирования репозиториев в дашборде

Статус: реализовано в PR #898; учтены независимые ревью плана и кода. Дата: 2026-11-17. База: `origin/main` `6b2d65822`. Только Web и чтение: без миграций, нового события и изменений worker.
Закрывает находку get-tok «repository sync visibility» (`2026-11-11-get-tok-onboarding.md:40`, пункт 2 в [74](74-first-run-flow-fixes.md)): вместо «Use Connect source» при активной установке - статус скана.

## 1. Проблема (воспроизведено по коду)

1. GitHub возвращает на `/setup?installation_id=…`. Как только webhook `installation` создал `GitHubInstallation`, страница сразу редиректит на `/dashboard?section=repositories&notice=app_installed` (`setup/page.tsx:78`). При `setup_action=update` редирект тоже мгновенный, а webhook `installation_repositories` может прийти позже.
2. Репозитории пишет worker по outbox-событию `installation.sync_requested` (`outbox-installation-sync-requester.ts`, `sync-installation-repositories.ts`). Пока событие не обработано, `RepositoryTable` пишет «No repositories yet … Use Connect source» (`dashboard-workspace-page.tsx:2315`) - похоже на ошибку подключения, перезагрузки нет.
3. «Refresh repos» ставит то же событие и пишет «Reload in a few seconds»; карточка организации - «Refresh repositories … if the GitHub webhook has not synced it yet»; тост `app_installed` - «Search for one repository».
4. `/setup` в ожидании webhook просит нажимать «Refresh status».
5. Сбой скана (`dead_letter`, ~1-2 мин ретраев) не виден нигде: у события нет `workspaceId`, `listWorkspaceOutboxFailures` его не видит. Без GitHub App credentials worker не берёт события вовсе - они навсегда `pending`.

## 2. Что переиспользуем

- Статус = последнее `OutboxEvent` с `type/version` события и `aggregateId=github-installation:<id>`. Индекс `(type, version, status)` покрывает только префикс; дальше фильтр по строкам этого типа (их сотни, очистки нет) и сортировка. Без миграции; EXPLAIN на prod не делал - доступа нет.
- Повтор = существующий `requestInstallationSyncClientAction` (rate limit, lock, аудит).
- Репозитории пишутся по одному в своей транзакции, поэтому при пустом списке `count` репозиториев workspace - честное «найдено»; пока worker листает GitHub, он 0 и не показывается. Итога «из N» нет.
- GitLab пишет инвентарь синхронно - асинхронного скана нет.

## 3. Решение

1. `features-github-installations`: экспорт `installationSyncRequestedEvent` и `installationSyncAggregateId` (их же использует requester) и `PrismaInstallationSyncStatusReader` - один владелец контракта события и пишет, и читает. `features-outbox` не трогаем: запрос специфичен для этого события.
2. Чистая модель `apps/web/src/features/repository-scan/repository-scan-model.ts`: `pending/processing`→scanning, `retry_wait`→retrying, `dead_letter`→failed, `processed`→completed; нет события и установке меньше 2 мин → scanning, иначе unknown. Скан старше 15 мин (аренда processing) → stalled: опрос стоп, Retry. Сводка: scanning важнее failed/stalled; slow после 2 мин. Возраст = `createdAt` БД минус время чтения web-сервера, без часов браузера.
3. Сервер `apps/web/src/server/repository-scan.ts`: активные установки с той же дедупликацией по аккаунту, что панель (функция переносится в `dashboard-workspace-model.ts`), затем статусы, затем `count` - завершённый скан целиком в счёте. На странице снимок читается до списка (иначе гонка «completed, а списка нет») и best-effort: сбой не роняет раздел.
4. `GET /api/dashboard/repositories/scan?workspace=<id>`: 401/403 по тому же правилу workspace-wide доступа, `private, no-store`.
5. Клиент: `repository-scan-api.ts` (ключ `["repository-scan", actorId, workspaceId]`), `repository-scan-status.tsx`: `useQuery` с SSR-`initialData` и `initialDataUpdatedAt`, `staleTime` 5 с, `gcTime` 0 (кэш живёт со списком, поэтому `usePrivateQueryScope` не нужен), `refetchInterval` только при scanning: `clamp(возраст/4, 3 с, 30 с)`, `refetchIntervalInBackground: false`, стоп на 401/403. При других ошибках route последний снимок «стареет» на время без успешного чтения, поэтому опрос замедляется и стопается на том же потолке 15 мин. После `notice=app_installed` - 60 с опроса раз в 5 с ради позднего webhook. Новее пришедший SSR-снимок кладётся в кэш. Если терминальный снимок (состояния, `requestedAt`, count) отличается от отрисованного - один `router.refresh()` на ключ. Компонент в стабильном слоте таблицы.

## 4. Что видит пользователь

- Пустой список: scanning - «Scanning repositories», спиннер, «N found so far», при retrying и slow по строке; failed - «Repository scan failed» + «Retry scan»; stalled - «Scan did not finish» + Retry; иначе при активной установке - «ReviewRouter does not see any repositories of X yet» со ссылкой на настройки App и Refresh repos.
- Непустой список: одна строка `border-b` - «Scanning X on GitHub…» или «Last scan failed/did not finish» + Retry.
- «Refresh repos» и Retry - один компонент поверх `DashboardActionForm` (новый `onComplete`), после успеха `invalidateQueries` точного ключа. Тосты говорят, что список обновится сам; карточка организации - один статичный текст со ссылкой на статус в списке (живого состояния у неё нет). `/setup`: `router.refresh()` с тем же backoff на видимой вкладке, до 5 мин.

## 5. Риски и не делаем

- В prod были 97 dead letter sync (#761, ACL worker). Где последнее событие установки - dead letter, после выкатки появится «Last scan failed» с Retry: это правда. Перед выкаткой - read-only проверка; Retry сработает только при гранте worker из #761.
- Не делаем: миграции и индексы, счётчик «из N», опрос для участников без workspace-wide доступа (им workspace без репозиториев не виден), диагностику «No repositories synced».

## 6. Тесты

Модель (статусы, окно 2 мин, stalled, slow, backoff, ожидание после install, ключ refresh), компонент (скан, сбой, stalled, idle, один refresh, 403, постоянный 500, Retry инвалидирует), route (400/401/403/500/200), reader и loader (порядок чтений, дедупликация), `/setup` refresher. Плюс tsc, eslint, prettier.
