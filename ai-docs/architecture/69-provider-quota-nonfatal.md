# Квота провайдера одного ревьюера не роняет ревью

Статус: план v2 (учтено независимое ревью v1). Дата: 2026-11-17. Две поставки: SaaS (`review-router-ai`) и runtime (`777genius/review-router`). Деплой не входит. Меняет решение [multi-reviewers](../plans/2026-10-28-gateway-multi-reviewers.md) («required reviewer failure → incomplete»), там добавлена ссылка сюда.

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

Правило принятия живёт в runtime, сервер сверяет его со своими слотами. Нужны обе поставки. Новый класс сбоя не нужен.

## 3. Правило

Required-слоты ревьюера пропускаются (skip), только если одновременно:

1. Ревьюера остановил сбой класса `CapacityUnavailable`, который Gateway подтвердил как исчерпанную квоту (`providerQuota()` классификатора). Квота принадлежит аккаунту, поэтому пропускаются все ревьюеры этой allocation, кроме уже остановленных по другой причине.
2. Хотя бы один другой ревьюер выполнил все свои required-слоты.

Никогда не skip: все ревьюеры упали; auth, config, admission, deadline, неизвестный исход; scope `run`; одиночный ревьюер; эвристика 429 без подтверждения Gateway. Если кроме skip остался невыполненный слот другого ревьюера, ревью остаётся `partial`. Порог согласия (`inlineMinAgreement`) не меняется.

Один владелец ответа «квота или недоступность»: `ProviderInvocationFailureClassifier`. `classify() === CapacityUnavailable` - широкий класс, его может использовать режим fallback ([67](67-provider-interaction-mode.md), поставка 2). `providerQuota()` - узкое подтверждение, только оно даёт skip в параллельном режиме.

## 4. Runtime (второй PR)

1. Порт классификатора получает `providerQuota?(context)`; реализация - тот же `confirmedProviderQuota`.
2. При `CapacityUnavailable` квота прикрепляется к `ReviewScopedInvocationFailure`; дорожка запоминает её для ревьюеров этой allocation.
3. После дорожек чистая функция `providerQuotaSkippedVotes` считает skip. Эти слоты не входят в `requiredExhaustedWorkSlotIds`, проекция считает их необязательными, `incompleteCauses` их не содержит. Неудачный ревьюер остаётся в знаменателе («1 of 2 review providers failed», `1/2`).
4. Finalize отправляет `allowPartial: true`, если есть skip. Проекция при этом сообщает `coverage.state: complete`.
5. Summary и check: «Reviewer `<model>` was skipped: OpenRouter request quota exhausted (0 of 1000 requests remaining). Try again after ...». Для полностью упавшего ревью текст прежний.
6. Пересобрать `dist`, как требует репозиторий.

## 5. SaaS (этот PR)

1. `deriveCoverageState(slots, producerCoverageComplete)`: все required-слоты выполнены, или проекция Action сама сообщает полное покрытие и хотя бы один ревьюер выполнил все свои required-слоты. Покрытие Action берётся из envelope (`coverage.state`) в `ProductionFinalizationFactsAdapter`; это и есть bounded CoverageCandidate из [48](48-revision-aware-review-evidence-plan.md) (Transaction and recovery rules, п. 3).
2. Старый runtime с открытыми слотами всегда присылает `coverage.state: partial`, поэтому для него поведение не меняется.
3. Подсказка в `gateway-reviewer-roster.tsx` у строки OpenRouter `*:free` (существующий `isFreeModel`): у бесплатных моделей дневной лимит, при исчерпании ревьюер пропускается, если другой ревьюер завершил ревью. Только текст.

## 6. Совместимость и последствия

- Протокол, envelope, миграции и relay не меняются.
- Порядок: SaaS, потом релиз и pairing runtime. Новый runtime со старым SaaS получит `partial`, как сегодня: `allowPartial: true` не даст отказа finalize.
- Completed со skip ведёт себя как обычное полное ревью: inline-комментарии, check, merge gate по находкам выполненных ревьюеров, сдвиг snapshot. Артефакт не отличает skip от полного покрытия, причина видна только в тексте summary и check. Принимаем осознанно.
- Если основной ревьюер (первый) пропущен, его необязательные lifecycle- и description-слоты тоже не выполнятся. Прежние находки останутся непроверенными, как при любом сбое этих слотов. Auto-resolve при этом не сработает.
- `restoreOnly` не видит квоту: она хранится в памяти транспорта. Итог безопасный, `partial`.

## 7. Отвергнутые варианты

- Свой серверный факт квоты (relay пишет его в `ReviewRunGatewayAllocationExecution`, finalize сверяет). Это независимая проверка «именно квота», но нужна миграция. Миграция здесь тянет закреплённые checksum в schema handoff (`render-schema-handoff-policy.mjs`, `render-historical96-checkout.mjs`, rehearsal-скрипты) и согласованную раскатку. К тому же расхождение runtime и сервера давало отказ finalize. Защищает только от бага runtime, а не от злоумышленника: runtime - закреплённый producer. Сервер и без этого гарантирует главное: ревью без хотя бы одного полностью выполненного ревьюера не станет полным.
- Новая причина `terminalizeWorkSlot` в протоколе: перегенерация протокола в двух репозиториях и парный релиз.

## 8. Тесты

SaaS: `deriveCoverageState` (skip засчитан; проекция partial; никто не завершил; у завершившего нет required). Runtime: оркестрация (квота даёт skip; неподтверждённая ёмкость, auth и квота у всех дают partial), проекция со skip (полное покрытие и строка summary).

## 9. Риски и что не входит

- 429 у NVIDIA и других провайдеров Gateway сейчас отдаёт как `upstream_failure` без `providerQuota`, такой ревьюер не пропускается. Расширение возможно через атрибуцию в Gateway, правило менять не придётся.
- Если квота кончилась у всех ревьюеров, причина в summary по-прежнему «Admission policy limited this review» плюс точная строка про квоту. Это прежнее поведение, отдельная задача.
- В истории дашборда нет места для причин по ревьюеру: там будет «Completed», причина видна в summary, check и step summary Action.
