# Review Skills — журнал трёх раундов критики

Три направления: architecture/DDD/data/tooling, runtime/OCR/protocol, frontend/authorization/UX. Критики GPT-6.1 xhigh по запросу пользователя. Каждый раунд проверяет исправленную после предыдущего редакцию.

## Раунд 1

Reviewed commit: 917b773. Три независимых критика, verdict changes requested. Все изменения внесены в следующую редакцию до round2.

| Направление / finding                                              | Исправление                                                                                                  |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| Architecture: existing destination row lock нарушал общий порядок  | Prelock полного candidate workspace set до runtime fence; новый source → retry, не out-of-order lock         |
| Architecture: grant generation не связан с acceptance              | acceptedGrantVersion + expectedGrantVersion; regrant требует нового Accept                                   |
| Architecture/UX: membership и repo-manager authority противоречили | Явные library/read и assignment-read authorities; current DB admin либо live SCM writer; без local override  |
| Architecture: partial capability migration                         | Перечислены все shared/release/private/manual OCR strict readers, roundtrip/absence fixtures                 |
| Architecture: attachment replay/storage                            | Immutable new-row attachment, mappings, winner restore без изменения replay key; ownership FK уточнены       |
| Architecture: endpoint namespace                                   | Companion /api/action/v2/skills, generated descriptor и bounded errors                                       |
| Runtime: corrected OCR builder менял historical rr.3               | Явная captured legacy/capability ветка и byte-identical ruleText/identity fixture                            |
| Runtime: mutable capture denial обгоняет admitted winner           | Повтор original lookup перед denial; concurrency acceptance                                                  |
| Runtime: prepared seams могли терять Skills                        | Таблица trusted capability/bundle для каждого entrypoint, missing-input reject                               |
| Runtime: scope/Git grammar не определена                           | Один glob dialect, frontmatter/ref subset, discovery/depth/byte bounds                                       |
| UX: revoked row раскрывает fresh metadata                          | Отдельная generic unavailable projection без source head read                                                |
| UX: write-actor E2E шёл через admin shortcut                       | Narrow GitHub HTTP protocol fixture, настоящие session/guard/DB                                              |
| UX: Git preview обещан без read path                               | V1 roots/status/discovery diagnostics; полный web blob preview исключён явно                                 |
| UX: author/link, target discovery, 1001/unknown outcome            | Edit original, exact opaque destination input, сохранение selection/unknown completion, plain import preview |

Не принята рекомендация требовать membership для SCM writer: существующая product authority поддерживает repository-only users. Это оформлено как отдельная узкая read/write capability, а не расширение workspace library.

## Раунд 2

Reviewed commit: 06b50bf. Architecture/runtime: P1 первого раунда закрыты, новых blockers нет. Frontend: один read-contract gap. Исправления перед round3:

- Добавлены loadSkillAccess, listSkillRepositoryTargets, loadRepositorySkillSettings с точными authority/versions; unavailable rows входят в Remove choices.
- Create continuation только для workspace members; repository-only actor не получает заведомо forbidden control.
- Добавлен scoped consumer-module-profile с standard pins/governed paths и независимыми namespace/wiring expectations.
- Prelock проверяет полноту parent rows и active state. Добавлена authority-demotion/live-SCM-loss acceptance.
- HTTP body bounded read до parse; OCR allowlist до grouping/dispatch, не post-filter.

## Раунд 3

Reviewed commit: 3fbeabb00c3e320262365a4847139269f5297eb9. **Все три критика: GO для реализации**, без оставшихся planning blockers.

- Architecture: stale grant acceptance, source/destination lock ordering with new source, author departure vs consumption, immutable winner; минимальная scoped GM/Foundation adoption.
- Runtime: legacy rr.3, supporting empty capture, missing-input rejection, prepared native seam, exact-base references, pre-dispatch inventory.
- Frontend: create/assign continuation, canonical link/Edit original, repo-only authority/unavailable Remove, pagination/filter/1001 bounds, keyboard/mobile.
- Frozen backend API и runtime execution input переданы между lanes. Это approval плана, **не заявление о завершённой реализации или успешных E2E**.

## Проверка реализации

Отдельна от review плана. После реализации критики повторно проверили код и границы интеграции; существенные находки закрыты до финальной квалификации.

| Направление / finding                                                                                                              | Исправление и проверка                                                                                                                              |
| ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Admission: Serializable snapshot мог пережить ожидание revoke на неизменённом parent row                                           | Физический parent write после ordered locks; actual unprivileged web/API barrier test получает 40001, новый capture видит revoke                    |
| Producer selection: общий provider_api label не гарантировал передачу Skills старым Secrets/Hosted caller                          | Supporting preference только на verified direct OpenRouter; legacy route с назначениями получает явный отказ; signed PG positive/negative proof     |
| Admission fence терял подтверждённый direct transport при recapture                                                                | Delivery восстанавливается только из исходного защищённого snapshot с проверкой frozen configuration; signed admission/restore/renew tests проходят |
| ACL: table REVOKE не удалял существующие column UPDATE grants                                                                      | Точные grants и отдельный closed-gate column cleanup; реальные LOGIN roles доказывают denial и восстановление                                       |
| Frontend: автор мог открыть linked skill, но Save использовал destination workspace                                                | Save/conflict reload используют source identity; invalidate обоих caches; final browser подтверждает original + linked view                         |
| CI: actual OCR мог скрыто skip без binary, paired Skills test без checkout                                                         | Обязательные pinned OCR build/manifest + required flag; signed HTTP step после verified immutable paired checkout                                   |
| Additive migrations ломали исторические full-checkout validators                                                                   | Exact checksum-pinned pair поверх неизменённого predecessor; 303 regressions и независимые missing/modified/unknown-tail отрицательные проверки     |
| Production packaging/tooling: isolated compiler отсутствовал в Docker, ignore-workspace терял package exceptions, bundles устарели | Штатный production compiler + отдельный явный TS7 gate; nested workspace install; official artifact build/parity                                    |
| Historical79 fixture выбирала SQL137 field; historical89 closure пропускала новый transitive helper                                | Старый schema boundary сохранён, exact omit + reviewed executable entry; 33/33 real PG и 53/53 closure/preparation tests                            |
| Runtime compatibility tests предполагали единственный profile и старый набор workflow actions                                      | Явные legacy + Skills identities, exact setup-go SHA/use count; три исходных failure files вместе проходят 49/49                                    |

Независимый runtime review: P0/P1 в проверенной области не осталось; 52/52 Skills/native/OCR adapter tests. Независимый frontend review проверил server authority, privacy, canonical linking, exact selection/retry и inert Markdown; обнаруженный author-edit UX исправлен. Отдельный release review подтвердил сохранение managed92/historical96 identities и отклонение шести повреждённых каталогов без изменения protected baseline.

Финальный browser receipt на `03c94f32ce4a5147336681502742e4385c1827d5`: 7/7, без skips, с 138 свежими migrations. Полная таблица выполненных проверок, команды и честные пределы локального/удалённого evidence — [в отчёте](./2026-10-21-review-skills-implementation.md).

## Повторное ревью и визуальная проверка по запросу пользователя

Три независимых критика **GPT-6.1 Sol, xhigh** проверили backend/authority,
runtime/OCR и реальный frontend. Замечания опубликованы отдельными inline review
threads в PR #635 и #297 через аккаунт автора. Это AI-assisted review, не
самостоятельное человеческое approval.

| Finding                                                                                                              | Исправление                                                                                                                                                                                                                                | Проверка                                                                                                                         |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| P2: один read-only repository candidate обрывал весь список Repositories для участника с write к другому репозиторию | Только завершённый typed permission denial исключается из discovery. Transport/malformed/incomplete/identity ошибки продолжают прерывать запрос. Mutation по-прежнему требует proof для каждого selected repository под DB authority check | Adapter + dashboard guards 26/26; real PostgreSQL partial-proof case: разрешённый target виден, bulk по двум запрещён, записей 0 |
| P2: used shortcut `[checks]` с `[checks]: required.md` молча терял обязательный Markdown reference                   | Явный bounded rejection unsupported local shortcut; определения без использования, external/anchor links и code examples остаются inert                                                                                                    | Runtime Skills suite 12/12; независимая перекрёстная проверка backend критиком                                                   |
| P2: Save существующего Skill открывал новый assignment dialog                                                        | Continuation в Repositories только после Create; обычный Save закрывает редактор и показывает существующий ActionToast                                                                                                                     | Настоящий Next/PG/Chromium: Save/CAS/linked edit, screenshot после завершения анимации                                           |
| P2: результат bulk operation, selected count и retry error были ниже длинной таблицы                                 | Feedback закреплён рядом с Apply/Close; используются существующие DialogFooter и feedback slot без нового framework                                                                                                                        | Actual browser: 125 repositories, populated table, desktop и 390×844; success и exact retry остаются в viewport                  |

Backend и runtime критики дополнительно независимо проверили исправления друг
друга: blockers в изменённых границах не нашли. Визуальный критик прошёл
создание/редактирование, dirty close, canonical sharing, массовое назначение и
мобильные диалоги. Bounded draft browser проверки прошли; окончательный receipt
на committed source фиксируется отдельно в отчёте, без подмены dirty run.

Вне diff обнаружено существовавшее до фичи ограничение в
`manage-review-run-authorizations.ts`: denial при racing runtime recapture может
временно обогнать перечитывание admitted winner. Уже сохранённый snapshot не
заменяется; новый retry возвращает winner. Это pre-existing non-blocking finding,
а не выполненное в этом PR исправление; scope и accepted ADR не расширялись.

По запросу пользователя author/committer наших feature commits приведены к
подтверждённому GitHub identity. Переписаны только metadata и цепочка родителей;
каждый committed tree и незакоммиченные исправления сохранены. Исторические SHA
в предыдущих разделах обозначают реально проверенные тогда версии. Новый
handoff экспортируется штатным инструментом из reachable committed source, а
paired CI pin обновляется после нового runtime commit.

Финальный повтор после исправлений: browser **7/7, 0 skips, 0 flaky** на чистом
`35ec3863c62b13095efdcc0083a180cea7ad6eba`, новый PostgreSQL 17 cluster и все 138
migrations. Независимый runtime критик также проверил последующий merge
`b4d8bd5` из main: оба feature sets сохранены, конфликт был только в generated
source map и решён normal build. Behavioral gate: **77/77** плюс signed paired
HTTP case. Актуальные identities, receipts и границы проверки — в отчёте.
