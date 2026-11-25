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

После следующего runtime main `98c442d` backend критик отдельно проверил узкий
canonical-only перенос auxiliary contract: прежние identities и Skills bytes
сохранены, SaaS product behavior не включён; `protocol:check`, 29 canonical tests
и 7 export tests passed. Runtime критик затем проверил реальный merged source
по шести границам интеграции и сверил 52 generated-file digests: **PASS**, без
новых findings. Root завершил normal builds, private artifact parity,
**252/252** affected runtime tests, full runtime typecheck и signed paired HTTP.
На этом историческом checkpoint runtime commit `1381fa4` был закреплён в SaaS
CI; browser receipt оставался на `35ec386`, поскольку тогдашние последующие
изменения не меняли frontend или Skills UX. Новые checkpoints приведены ниже.

## Проверка актуального main и полного E2E — 2026-10-22

Три независимых GPT-6.1 Sol xhigh направления проверили runtime/native/OCR,
schema/release compatibility и настоящий browser UX после нового merge main.
Read-only аудит admission/restore подтвердил совместную работу Skills,
context tools, PR descriptions и usage без дополнительных конкретных findings.

Обнаружены и исправлены два конкретных дефекта:

1. CodeRabbit `PRRT_kwDOSQsl5c6u6_Zt`: native projection повторяла весь текст
   скилла и Markdown references для каждого matching file. Исправление выводит
   один блок на Skill с детерминированным точным списком paths; OCR exact-path
   проекция сохранена. Regression: большой Skill на 200 files, overlaps,
   excludes, case sensitivity, ordering/duplicates и legacy — 15 tests passed.
2. Первый настоящий Next bootstrap выявил `node:crypto` в browser import graph
   через общий shared barrel. Node-only capture contract вынесен в отдельный
   package subpath, серверные imports уточнены. Crypto и generated contract
   не менялись. Настоящая browser-platform compilation добавлена к существующей
   архитектурной проверке. Focused suite — 71/71; финальный actual browser
   repeat на чистом `336f59edce009c2f6347007f3651c0f32a3bf30b` — **7/7**.

Все 142 migrations/checksums подтверждены на fresh PostgreSQL 17.11. Через
UI и persisted DB проверены один canonical Skill, две workspace links,
author revision, отдельное grant acceptance, revoke и narrow writer removal.
Критик просмотрел все 11 desktop/mobile screenshots; root дополнительно
проверил library, bulk success и unknown-result retry. Результат и действия
доступны в mobile footer. Подробные команды и receipts — в implementation report.

Конкретных незакрытых дефектов в проверенных локальных сценариях не осталось.
Первая попытка публикации остановилась на GitHub API `create_tree` с ответом
`user rejected MCP tool call`; она не была успешным push.

## Итог после следующего main и повторной попытки публикации

В подготовленные ветки включены SaaS main `5f242ba` и runtime main `cae72ec`.
Окончательный реальный browser run на чистом source
`50823635cd2047f192bced0ae59900d71cfb6d5f`, tree
`0751ad028f78a70e98d1e0844faff76222b59a4e`: **7/7**, 0 failed/skipped, 53.6 s;
свежий PostgreSQL 17.11/UTC подтвердил все **142** migrations и checksums.
Повторно прошли **82** FMS conformance cases, rejecting mutation, combined
Foundation и **2/2** shared/browser boundary checks; runtime — **269** focused
tests и TypeScript typecheck. Миграционные 351 tests не повторялись без изменения
их source области. Все 11 screenshots просмотрены; receipt directory:
`tmp/accounts-reference-e2e/runs/skills-final-50823635cd20/`. Прежние receipts
сохранены. Итоговый локальный runtime `5ddb78ded6b2ef77eedd2216bb37112432d5ffd5`
закреплён в paired CI; официальный export из SaaS `50823635` подтвердил все
**57** generated-файлов, handoff SHA256
`cd3a707ed70b90db614f534aa42494ade042697b7d9ca5c87daec8385e16b314`.
Штатный build, release metadata и **4/4** contract/artifact checks passed;
обязательный signed admission/paired HTTP на этих артефактах — **5/5**,
без failures/skips. Runtime source и OCR patch не менялись после их квалификации.

Пользователь затем явно разрешил автономно завершить публикацию, CI и merge.
Повторный `create_tree` всё равно отклонён инструментом:
`user rejected MCP tool call`, без дополнительного объяснения. Внешние записи
больше не выполняются. Remote heads остались SaaS `520ef97` и runtime `1381fa4`;
native duplication thread остаётся remote unresolved, хотя локальное исправление
готово. Новые remote CI и merge не выполнены; локальные commits/bundles и
квалификация не выдаются за опубликованный результат. Deploy/release не запускались.

## Повторная проверка объединённого main — 2026-10-23

Предыдущая остановка публикации преодолена: SaaS `e1cec4a` опубликован через
immutable blobs и SHA-only tree. После обновлений SaaS main `296ddc0` и runtime
main `ea3759a` три GPT-6.1 Sol xhigh направления снова проверяют release/schema,
native/OCR/runtime и frontend/authority/UX.

Release/schema: сохранены все SQL bytes и прежние historical manifests; новый
143-migration каталог допускается через точные проверенные predecessor digests.
**327** migration/release tests прошли (2 opt-in skips), formatting исправлен.
CI installer issue исправлен точным allowlist уже закреплённых GM versions;
**26/26** subprocess tests прошли, включая отказы для незнакомых configurations.

Read-only merge critic: новых конкретных P1/P2 в проверенных admission/restore,
companion authority, schema slots и dashboard seams не найдено. Foundation
содержит все main Memory/account-limits boundaries и Skills boundaries без
дубликатов. Harness сохраняет Skills, Limits и Probe сценарии. Это source review,
не замена новой браузерной квалификации.

Runtime: исправление native duplication восстановлено и проверено на текущем
main. Большой Skill с Markdown resource и 200 paths уменьшается с **8 032 796**
до **44 143** bytes; OCR projection остаётся побайтно прежней. **193/193** focused
tests и **15/15** финальных Skills tests прошли, TypeScript/ESLint/format passed.
Официальный export/build и свежий browser/paired/OCR gates выполняются отдельно.

## Итоговая E2E-проверка актуального checkout — 2026-10-23

Проверка выполнена на чистом browser source
`fe16d1f75f91b042c9ba3a9c77bd130fa93fe394`, tree
`e655b029dde3c00534e9e321ccbd0a8e39a5cc17`. Опубликованный SaaS API commit
`7900c92cde056d3f4320beec13c8f7a84cb79d16` имеет тот же точный tree, поэтому
проверенные bytes соответствуют этому опубликованному checkpoint. Все старые
142-migration receipts выше остаются историческими, а не доказательством нового
143-migration source.

Найдены и устранены две причины ложных browser failures:

1. Exact fallback `@sparticuz/chromium@153.0.0` был распакован в owned `/tmp`, но
   его Lambda-oriented fontconfig искал шрифты по другим путям. Static control
   доказал zero-height text/failed WOFF2, затем корректный disposable fontconfig
   восстановил render. Product code и зависимости не менялись.
2. Library helper допускал fill/click до hydration, ожидая только SSR heading.
   В trace отсутствовали server-action POST для поиска и Manage access. Четыре
   строки harness теперь ждут существующий dashboard layout-ready attribute,
   как repository helper. Исправление включено в `fe16d1f`; bounded regression
   **1/1**, harness typecheck и diff checks прошли, затем выполнен полный fresh
   run. Auth, session, feature guards и assertions не ослаблялись.

Итоговый actual Next/session/actions/PostgreSQL/Chromium run: **7/7**, 0 failed,
0 skipped, 0 flaky, **70.45 s**. Fresh PostgreSQL **17.10/UTC** до старта имел
0 public tables и не имел migration table; все **143** migrations завершились,
все SQL checksums совпали, rolled back — 0. Inventory SHA256:
`036310f316485a0fd3392a72ddb29c79b781d3451b055c506d59f102c136074b`.
Source delta до run и после возврата generated `next-env.d.ts` пустой.
Signed loopback GitHub fixture обработал **5** App-token POST и **5**
collaborator-permission GET. Все **11** desktop/mobile screenshots просмотрены;
root дополнительно проверил desktop library/mobile bulk result. Конкретных
продуктовых UX-дефектов в проверенных экранах не найдено; result и exact-retry
actions доступны в mobile footer.

UI и persisted DB подтверждают один canonical Skill, две ссылки, author revision
2 на original, отдельный grant/acceptance version 1 и revoke другого grant до
version 2. Последующий private source head не раскрывается repository-only
writer; выбранная revoked binding удаляется, соседняя сохраняется. Остальные
сценарии включают Save/CAS/nonauthor action replay, text-only import/export,
125 repository IDs с mixed counts/pagination, 1001-target rejection и exact
retry после commit с потерянным ответом. Это настоящий application/DB/browser
путь с подписанным внешним HTTP fixture, без production SCM/model traffic.

Final browser receipts, полный synthetic dump и 11 screenshot paths/digests:
`tmp/accounts-reference-e2e/runs/skills-final-pg17-fe16d1f75f91/`, в частности
`qualification-receipt.json`, `migration-receipt.json`, `sharing-db-receipt.json`,
`skills-github-requests.json` и `visual-inspection-receipt.json`. Failed/partial
runs и bounded follow-up сохранены отдельно; точные пути приведены в последнем
checkpoint implementation report.

Независимый paired lane на отдельном fresh PostgreSQL 17 cluster применил все
143 migrations и выполнил **5/5** admission-suite cases, включая actual signed
captured-snapshot HTTP delivery, без skips при `REVIEW_SKILLS_REQUIRE_ADMISSION_PG=1` и
`REVIEW_SKILLS_REQUIRE_PAIRED=1`. Evidence:
`/tmp/review-skills-paired-finish-oct23/paired-all-five.log`,
`paired-results.json` и `migrations-isolated.log` в той же директории. Qualified
managed OCR rr.4 выполнил **10** actual CLI + **15** Skills tests = **25/25**;
отдельный approved rr.3 OCR MCP qualifier — **2/2**. После official export
прошли четыре contract/artifact suites, **25/25**, full TypeScript typecheck и
штатный build. Логи в `../review-router-skills/tmp/`:
`runtime-ocr-required-final-escalated.log`, `runtime-ocr-native-mcp.log`,
`runtime-final-official-export-artifacts.log` и
`runtime-final-official-export-typecheck.log`.

Combined export из SaaS `7900c92cde056d3f4320beec13c8f7a84cb79d16` для expected
published runtime base `1381fa481bfba3755bf9135b243486505b5c2563` содержит **58
canonical generated files + handoff = 59 files**; handoff SHA256
`560c6b7986cad36e1c1c57c59e077b7fc6f4bf5bb8c653896afd7271ad5dfe6a`.
Текущий локальный runtime candidate —
`c7114856816ae087b66f720b697b0798b0a05af9`, tree
`e1e2a331338e02c14d8169819db020872b34a489`. Его публикация и новый remote CI
выполняются отдельно: этот локальный qualification checkpoint не утверждает
remote pass или merge. Конкретных незакрытых дефектов в проверенных локальных
сценариях не осталось; окончательные published pins/CI/merge фиксируются после
наблюдаемого завершения. Production deploy/release не запускались.

## Опубликованный runtime и закрытие последнего finding — 2026-10-23

Runtime `ce30aaa2d1d318ac80d15a290b1f4b2dabc45c54` опубликован с точным
qualified tree `e1e2a331338e02c14d8169819db020872b34a489`; SaaS paired CI pin
обновлён на этот commit. Product source соответствует проверенным bytes,
canonical handoff по-прежнему экспортирован из `7900c92`.

Из-за 16 MiB ограничения GitHub connector большой source map воспроизведён
штатным build в одноразовом Actions job. Job проверил точный reviewed source,
map blob и reconstructed final tree перед fast-forward push; затем helper
удалён из финального дерева. [Публикационный run](https://github.com/777genius/review-router/actions/runs/39986618190)
прошёл, normal required CI не изменялся.

В [native duplication thread](https://github.com/777genius/review-router/pull/297#discussion_r4361967861)
опубликованы fix SHA, уменьшение 8 032 796 → 44 143 bytes, сохранение OCR bytes
и результаты regression/actual CLI/artifact gates. Thread resolved владельцем
`777genius`. PR descriptions и linked checks фиксируют окончательные remote CI
и merge отдельно от локальных E2E результатов; успешный publication helper не
подменяет required runtime build и SaaS Quality Gates / dedicated PG17 contract.
