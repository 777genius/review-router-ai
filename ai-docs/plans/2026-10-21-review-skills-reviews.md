# Review Skills — журнал трёх раундов критики

Три направления: architecture/DDD/data/tooling, runtime/OCR/protocol, frontend/authorization/UX. Критики GPT-6.1 xhigh по запросу пользователя. Каждый раунд проверяет исправленную после предыдущего редакцию.

## Раунд 1

Reviewed commit: 917b773. Три независимых критика, verdict changes requested. Все изменения внесены в следующую редакцию до round2.

| Направление / finding | Исправление |
| --- | --- |
| Architecture: existing destination row lock нарушал общий порядок | Prelock полного candidate workspace set до runtime fence; новый source → retry, не out-of-order lock |
| Architecture: grant generation не связан с acceptance | acceptedGrantVersion + expectedGrantVersion; regrant требует нового Accept |
| Architecture/UX: membership и repo-manager authority противоречили | Явные library/read и assignment-read authorities; current DB admin либо live SCM writer; без local override |
| Architecture: partial capability migration | Перечислены все shared/release/private/manual OCR strict readers, roundtrip/absence fixtures |
| Architecture: attachment replay/storage | Immutable new-row attachment, mappings, winner restore без изменения replay key; ownership FK уточнены |
| Architecture: endpoint namespace | Companion /api/action/v2/skills, generated descriptor и bounded errors |
| Runtime: corrected OCR builder менял historical rr.3 | Явная captured legacy/capability ветка и byte-identical ruleText/identity fixture |
| Runtime: mutable capture denial обгоняет admitted winner | Повтор original lookup перед denial; concurrency acceptance |
| Runtime: prepared seams могли терять Skills | Таблица trusted capability/bundle для каждого entrypoint, missing-input reject |
| Runtime: scope/Git grammar не определена | Один glob dialect, frontmatter/ref subset, discovery/depth/byte bounds |
| UX: revoked row раскрывает fresh metadata | Отдельная generic unavailable projection без source head read |
| UX: write-actor E2E шёл через admin shortcut | Narrow GitHub HTTP protocol fixture, настоящие session/guard/DB |
| UX: Git preview обещан без read path | V1 roots/status/discovery diagnostics; полный web blob preview исключён явно |
| UX: author/link, target discovery, 1001/unknown outcome | Edit original, exact opaque destination input, сохранение selection/unknown completion, plain import preview |

Не принята рекомендация требовать membership для SCM writer: существующая product authority поддерживает repository-only users. Это оформлено как отдельная узкая read/write capability, а не расширение workspace library.

## Раунд 2

Редакция после round1 передана тем же трём направлениям для проверки исправлений и исполнимости.

## Раунд 3

Ожидает исправлений второго раунда. Проверить конкретные сценарии и исполнимость.

## Проверка реализации

Отдельна от review плана. Команды, результаты и ограничения записываются после выполнения.
