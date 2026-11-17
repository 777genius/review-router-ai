# Квота провайдера одного ревьюера не роняет ревью

Статус: план v3 (учтены ревью v1 и замечание security review к v2: сервер сам проверяет исключение). Дата: 2026-11-17. Две поставки: SaaS (`review-router-ai`) и runtime (`777genius/review-router`). Деплой не входит. Меняет решение [multi-reviewers](../plans/2026-10-28-gateway-multi-reviewers.md) («required reviewer failure → incomplete»), там добавлена ссылка сюда.

## 1. Проблема

На проде политика с двумя ревьюерами: OpenRouter `nvidia/nemotron-3-ultra-550b-a55b:free` и NVIDIA Build. Snapshot v4 ставит `required: true` каждому ревьюеру (`review-run-runtime-snapshot.ts`). OpenRouter вернул дневную квоту `0 of 1000`, его слоты остались невыполненными, сервер вывел покрытие `partial` (`deriveCoverageState`), публикация ушла в режим «только summary»: без inline-комментариев и check, job красный. Готовый результат NVIDIA фактически потерян.

## 2. Где что решается

| Что                        | Где                                                                                                                                         |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Подтверждённая квота       | Gateway → relay: код `provider_quota_exhausted` + `providerQuota`; runtime `confirmedProviderQuota` (`provider-quota.ts`)                   |
| Класс сбоя                 | runtime `ProviderInvocationFailureClassifier`: квота и эвристика 429/rate limit → `CapacityUnavailable`, auth → `AuthenticationUnavailable` |
| Остановка ревьюера         | runtime `run-t0-review-orchestration.ts`: `ReviewScopedInvocationFailure`; квота даёт scope `allocation`                                    |
| required/partial в runtime | `requiredExhaustedWorkSlotIds`, `production-review-projection.ts` (`requiredAssignments`, `complete`)                                       |
| Итоговое покрытие          | SaaS `deriveCoverageState` в `decideExecutionFinalization`                                                                                  |
| Текст                      | runtime `reviewer-summary.ts`; `providerQuotaMessage` раньше показывался только для неполного ревью                                         |

Новый класс сбоя не нужен. Runtime решает, что пропустить, сервер независимо проверяет это по своим фактам. Нужны обе поставки.

## 3. Правило

Required-слоты ревьюера пропускаются (skip), только если одновременно:

1. Ревьюера остановил сбой `CapacityUnavailable`, который Gateway подтвердил как исчерпанную квоту, и relay сам записал этот факт на allocation. Квота принадлежит аккаунту, поэтому пропускаются ревьюеры этой allocation, кроме уже остановленных по другой причине.
2. Хотя бы один другой ревьюер выполнил все свои required-слоты.

Никогда не skip: все ревьюеры упали; auth, config, admission, deadline, неизвестный исход; scope `run`; одиночный ревьюер; эвристика 429 без подтверждения Gateway. Если остался невыполненный слот другого ревьюера, ревью `partial`. Порог согласия (`inlineMinAgreement`) не меняется.

Один владелец ответа «квота или недоступность»: `ProviderInvocationFailureClassifier`. `classify() === CapacityUnavailable` - широкий класс, его может использовать режим fallback ([67](67-provider-interaction-mode.md), поставка 2). `providerQuota()` - узкое подтверждение, только оно даёт skip.

## 4. SaaS (этот PR)

1. Миграция `000158`: `ReviewRunGatewayAllocationExecution.providerQuotaExhaustedAt TIMESTAMP(3) NULL`. Guard 152 фиксирует только identity-колонки. Миграция зарегистрирована в schema handoff (checksum-bound tail checkout163, как 157).
2. Порт привязки: `recordProviderQuotaExhausted` (ORM `updateMany`, пишет один раз, нет строки - `false`) и `providerQuotaExhaustedAllocations`.
3. Relay, catch дорожки v4-ревьюера: при `providerQuota` сначала запись, потом ответ. Не записалось - ответ без `providerQuota`; код и scope прежние.
4. `ProductionFinalizationFactsAdapter` отдаёт `coverageExceptions`: голоса ревьюеров snapshot v4 с записанной квотой на их allocation и заявку проекции (`coverage.state === complete`).
5. `deriveCoverageState`: все required-слоты `satisfied`; либо каждый открытый слот терминальный (`exhausted`/`cancelled`, не `pending`/`leased`) и принадлежит голосу с записанной квотой, другой голос выполнил все свои required-слоты, и проекция сама заявляет полное покрытие. Заявка проекции только сужает: без факта сервера она ничего не открывает. Старый runtime с открытыми слотами шлёт `partial`, для него ничего не меняется.
6. Подсказка в `gateway-reviewer-roster.tsx` у строки OpenRouter `*:free` (существующий `isFreeModel`). Только текст.

## 5. Runtime (второй PR)

1. Порт классификатора: `providerQuota?(context)` через тот же `confirmedProviderQuota`.
2. При `CapacityUnavailable` квота прикрепляется к `ReviewScopedInvocationFailure`; дорожка запоминает её для ревьюеров этой allocation.
3. Чистая функция `providerQuotaSkippedVotes` считает skip. Затем открытые required-слоты пропущенного ревьюера закрываются существующей командой `terminalizeWorkSlot` (`exhausted`); ошибка - ревьюер не пропускается.
4. Skip-слоты не входят в `requiredExhaustedWorkSlotIds`, проекция считает их необязательными, ревьюер остаётся в знаменателе («1 of 2 review providers failed», `1/2`). Finalize шлёт `allowPartial: true`: несогласие сервера даёт `partial`, а не отказ.
5. Summary и check: «Reviewer `<model>` was skipped: OpenRouter request quota exhausted (0 of 1000 requests remaining). Try again after ...».
6. Пересобрать `dist`.

## 6. Совместимость и последствия

- Протокол и envelope не меняются. Порядок: SaaS с миграцией, потом релиз и pairing runtime. Новый runtime со старым SaaS получит `partial`, как сегодня.
- Completed со skip ведёт себя как обычное полное ревью: inline, check, merge gate по выполненным ревьюерам, сдвиг snapshot. Артефакт не хранит skip отдельно; причина видна в summary и check. Принимаем осознанно.
- Пропущенный основной ревьюер не выполнит и свои необязательные lifecycle- и description-слоты: прежние находки останутся непроверенными, auto-resolve не сработает.
- `restoreOnly` не видит квоту (память транспорта) и даёт `partial`.

## 7. Отвергнутые варианты

- Доверять заявке проекции без своего факта (v2): меньше кода, но клиентское утверждение открывает покрытие. Отклонено security review.
- Новая причина `terminalizeWorkSlot` в протоколе: перегенерация протокола в двух репозиториях и парный релиз.

## 8. Тесты

SaaS: `deriveCoverageState` (skip засчитан; заявка без факта, открытый не-квотный слот, `pending`, `leased`, никто не завершил, partial-проекция остаются `partial`); relay отдаёт `providerQuota` только после записи. Runtime: оркестрация (skip и закрытие слота; ёмкость без подтверждения, auth, квота у всех, сбой закрытия дают partial), проекция со skip.

## 9. Риски и что не входит

- 429 у NVIDIA и других Gateway сейчас отдаёт как `upstream_failure` без `providerQuota`, такой ревьюер не пропускается.
- Если квота кончилась у всех, в summary по-прежнему «Admission policy limited this review» плюс строка про квоту (прежнее поведение).
- В истории дашборда нет места для причин по ревьюеру: там «Completed», причина в summary, check и step summary Action.
