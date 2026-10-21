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

Отдельна от review плана. Команды, результаты и ограничения записываются после выполнения.
