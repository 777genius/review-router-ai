# Классы ошибок ревью на production (2026-11-17)

Статус: план и исправления. Деплой и релиз Action не входят.
Дата: 2026-11-17. Версия 2: учтено независимое ревью.
Источник: прогоны workflow `ReviewRouter` в `777genius/review-router-ai` за 2026-11-17, журнал Gateway, Caddy, логи API, read-only выборки из БД RR и kernel Gateway.
Не входит (у других задач): квота OpenRouter `:free` (план 69 задачи про квоту), режим взаимодействия политики, живой список моделей NVIDIA, снятие ограничения personal-only, отказы `review_run_authorize` 403/500 (PR #884).

## 1. Ревьюер NVIDIA: `gateway_effect_unknown`, `sse_incomplete`, `invocation_failed`

Здесь три разные причины. Обрыв потока со стороны NVIDIA не подтверждён ни разу.

- 1a. Запрос больше 1 MiB. Прогоны 44025924282 (06:39:12) и 44043494458 (09:20:27): API пишет `Request body is too large`, runtime получает 400 `invalid_request`/`not_dispatched` после 3 и 56 минут работы OCR. За сутки таких событий ровно два, оба у NVIDIA. История разговора OCR растёт с каждым ходом, а лимиты такие: `REVIEW_ROUTER_ACCOUNT_GATEWAY_RELAY_POLICY.ingressBytes` = 1048576 и `limits.requestBytes` профиля в Gateway = 1048576. Это и есть зависимость от размера PR и длительности.
- 1b. Отмену вызывающей стороной записывают как обрыв. Caddy: из 17 обрывов ответа Gateway с 23:00 UTC 15 - это `reading: context canceled`. Runtime пишет `callerAborted: true`, времена совпадают с SIGKILL (12:22:19, 12:59:29, 06:52:42). Ревьюер останавливает сам runtime: захват исполнения (п. 3), новая ревизия PR, сбой API в 06:52. Native-мост NVIDIA (`forwardResponsesViaRawChatCompletions`, строгий режим) пишет любую остановку строгого скана как `sse_incomplete`, включая отмену клиента, ошибку чтения и битый кадр.
- 1c. Обрыв в Gateway после успешного native. Запрос `c220b075` (13:01:37-13:02:07): в kernel usage `complete` (8977 входных и 2720 выходных токенов), effect `effect_unknown`, Caddy `reading: unexpected EOF`, native фазу не писал. `complete` native ставит только на полностью успешном пути, значит поток прервал Gateway после native: `#settle` в `native-transport.ts` (ожидание закрытия, квитанция не `completed`, ack) или `!response.complete`. Какая ветка сработала, неизвестно: у этих веток нет диагностики. Лимит выходных байт (8 MiB у профиля) не причина. EOF в 04:07:56 (OpenRouter, effect `completed`) - другой класс.

Что не является причиной. Таймауты Gateway: после допуска ingress-таймер и таймауты сокета снимаются, остаётся абсолютный срок допуска. Native продлевает дедлайн записи на каждой записи. У Caddy таймаутов нет. `requestTimeoutMs` relay = 3600000. Политика повторов runtime тоже ни при чём: после `effect_unknown` попытки 2 и 3 намеренно не повторяют запрос и завершаются за секунды.

Исправление 1b (native, `agent-teams-ai/sub2api`, только диагностика): каждая остановка строгого CC-скана получает свою закрытую фазу.

- Ошибка чтения или отмена - `sse_read` с `read_error_reason`, как в Responses-пути.
- Битый кадр - `sse_frame_limit` или `sse_invalid_frame`, битое событие - `sse_invalid_event`, `[DONE]` до finish - `invalid_final`.
- `sse_incomplete` остаётся только для недописанного потока.

Все значения уже есть в парсере Gateway, правка Gateway не нужна. Ответ клиенту не меняется.

Владельцу:

- 1a. По умолчанию рекомендую сжатие истории в OCR. Поднять оба лимита 1 MiB (relay policy в env API и `limits.requestBytes` профиля `nvidia-build-chat-apikey-v1` в `service.json` Gateway) можно, но это предположение: 1 MiB JSON - около 250k токенов, больше окна большинства моделей, и отказ, скорее всего, просто перейдёт в 400 от провайдера.
- 1c. Нужна закрытая фаза диагностики в `#settle` и в проверке `!response.complete` в Gateway. Без неё ветку не установить.

## 2. `review_superseded_by_newer_revision` красным

Доказательства: 44079546362, 44074467581, 44037014543, 44007902155. `v2TerminalFailureCode` в `src/codex-oauth/action.ts` возвращает код, и `core.setFailed` красит прогон.
Почему это можно изменить: прогон `workflow_dispatch` идёт на ветке по умолчанию, поэтому он не проверка PR. Merge gate - статус `ReviewRouter`, у новой ревизии свой прогон. `neutral` для job недоступен, а отменить прогон из шага без `actions: write` нельзя.
Исправление (runtime, `777genius/review-router`): для `Superseded` код не возвращается только при `workflow_dispatch`. Условие стоит на событии, а не на функции, потому что эту же функцию вызывают и прогоны `pull_request`. Прогон `pull_request` остаётся красным: это проверка head-коммита, и при смене только base нового прогона может не быть. Сводка шага по-прежнему пишет «Review superseded».
Влияние на RR: перед возвратом `Superseded` runtime сам вызывает `supersedeExecution`, исполнение не висит. Если вытеснение случилось до admission, итог `success` даёт `TerminalNotRetryable` без successor. Это допустимо: у новой ревизии свой запрос.
Активация: только после релиза Action по [07](../operations/07-environments-and-release-management.md), это шаг владельца.

## 3. `review_orchestration_execution_refresh_invalid`

Это не дедлайн и не истечение лизы. Прогоны 44078475296 и 44079546362 ревьюят одну ревизию PR 821 (head `0dbeda49`, `reviewRevisionHash` совпадает). Запрос `77381eed` (`pull_request_synchronized`) отправлен в 11:56:12, запрос `73e15a69` (`lifecycle_changed` после `ready_for_review`) появился в 11:56:22-24.
В 12:21:54 admission второго исполнения (`cce105c`, gen 173) вытеснило первое (`1e441eb`, gen 172) и отозвало его лизу (`decideExecutionAdmission`). Через 25 секунд ревьюер первого прогона получил `callerAborted`, затем `refresh_invalid`, и 19 минут работы NVIDIA пропали. Та же картина у 44006812793/44007902155 (head `07480324`, первый запрос тоже был в `awaiting_authorization`).
Причина: `decideReviewRequestedRegistration` не трогает запрос в полёте с той же ревизией, но регистрирует новый. В итоге на одну ревизию два прогона.
Исправление (RR): автоматическое событие PR (не `manual_command`) для той же ревизии, чей прогон уже отправлен (`awaiting_authorization`) и ещё в окне авторизации, регистрируется как `superseded` этим запросом. Это тот же путь, что у позднего ingress.
Это не противоречит плану 48: событие жизненного цикла по-прежнему получает ревью той же SHA, и оно стартует после события. Не появляется только второй параллельный прогон. Ручная команда и rerun остаются отдельными запросами. Если запрос в состоянии `dispatching` или `reconciling_dispatch` либо окно истекло, поглощения нет: прогон не подтверждён.
Принятые ограничения:

- Поглощённый запрос не имеет своего запасного пути. Если отправленный завершится `authorization_deadline_exceeded` или его отменит оператор, ревью этой SHA не будет до следующего события.
- Событие жизненного цикла при уже запущенном исполнении той же ревизии по-прежнему забирает его (план 48). Ручная команда во время прогона - тоже.

## 4. `required_admission_limited`

Сообщение понятное: сразу за кодом в логе идёт `OpenRouter request quota exhausted (0 of 1000 requests remaining). Try again after 2026-11-18 00:00 UTC.` Правок нет, квота - задача (a).

## 5. Прочее

`review_action_v2_revision_guard_unavailable` (44028442989, 44031057780): оба в 06:53, одновременно API писал `local_authority` и `review_invocation_lease_renew` 500. Это общий кратковременный сбой, данных для причины нет, правок нет.

## 6. Доработки 1a и 1c (версия 3, после второго ревью)

1c (Gateway, `agent-teams-ai/account-gateway`). Каждая ранняя остановка потока и его расчёта пишет `gateway_native_transport_failure` со своей фазой, по одной строке на остановку.

- `native-transport.ts`, поток: `stream_read`, `stream_deadline`, `stream_chunk`, `stream_output_limit`, `stream_response_started`, `stream_incomplete`.
- `#settle`: `settle_recovery`, `settle_closure_wait`, `settle_not_completed`, `settle_effect_conflict`, `settle_ack`.
- Финальной проверке effect в `facade.ts` своя строка не нужна: всё, что оставляет effect не `completed`, теперь пишет транспорт (`settle_not_completed` или `settle_effect_conflict`). Это наиболее вероятная ветка запроса `c220b075`. Импорт диагностики в facade дал бы цикл границ `native-transport-http` - `private-facade`.

Отмену вызывающей стороной Gateway не пишет: native уже пишет её как `sse_read` (`context_canceled`), а это около 15 событий в сутки. `#settle` при отмене (`interrupted`) тоже молчит. Эмиттер прежний (`emitNativeFailure`): только фаза, закрытый `kernel_code` и `request_ref`, без текста ошибок, заголовков и тел. Effect, закрытие и ответ клиенту не меняются.

1a (runtime). В OCR уже есть ограничение истории - потолок `--max-tokens`, по умолчанию 200000 (`task_template.json`). В managed-режиме на 60% потолка история сжимается синхронно, а на 80% предпроверка останавливает группу с классифицированной ошибкой `FailureBudget`. Путь Account Gateway этот флаг не передаёт.
OCR считает токены по cl100k. Запрос уходит только ниже 80%, а сжатие в managed-режиме начинается уже на 60%, и всё равно оба запроса превысили 1 MiB. Значит, экранированный JSON кода давал от 6.5 до ~8.7 байт на учтённый токен.
Исправление: для OCR через Account Gateway (включая дочерних ревьюеров) передаётся `--max-tokens` = 1 MiB / 12 = 87381 (`ACCOUNT_GATEWAY_BOUNDS.ocrMaxTokens`). Сжатие начнётся около 52k токенов, остановка около 70k, а это даже при 12 байтах на токен меньше 1 MiB. Preview, запуск и ключ evidence берут одни и те же лимиты. Лимиты 1 MiB не меняются, prepared route и provider API идут мимо relay и не затронуты.
Последствия: группы файлов меньше, diff файла больше ~70k токенов OCR пропустит как `too_large` (сейчас порог 160k), ключ evidence OCR в этом пути один раз изменится.
Ограничения: это граница по токенам, а не гарантия по байтам. Выше ~15 байт на токен останется прежний 400 `invalid_request`; отдельный код «запрос слишком большой» потребовал бы нового значения в контракте Gateway, RR и runtime, его не вводим. Константа повторяет серверный лимит 1 MiB: если его поменяют, её нужно пересчитать (записано в реестре деплоя).

## Порядок

PR: native -> Gateway -> runtime -> RR. Тесты: Go unit на фазы строгого скана; Jest на выход `workflow_dispatch` при `Superseded`; Vitest на регистрацию запроса той же ревизии. Деплой native и RR и релиз Action делаются отдельно, по реестру деплоя.
