# Statistics / Usage / Reviews: журнал review плана и реализации

План: [2026-10-29-statistics-history-followthrough.md](2026-10-29-statistics-history-followthrough.md).
База v1: `a678f21ee5ed640be26b653018c9242c42513063` (main после PR #742).
Все делегированные агенты — GPT-6.1 Sol, xhigh.

Пять кругов выполняются последовательно: actual plan → независимые findings →
исправленный actual plan → следующий круг. До завершения всех пяти кругов и
plan-only push код не реализуется. Автор не объявляет review успешным заранее.
Final code/frontend review и реальные проверки записываются отдельно.

## Revision ledger

| Revision | Содержание                                                                                                                               | Фактический статус                                  |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| v1       | Первый ограниченный план по аудиту; cache/auth, controls/URL, honest copy, public History lookup, Usage policy index                     | Frozen; два actual round1 review получены           |
| v2       | Исправлен round1: seed trust/API validation, strict URL reset, History failure/coverage/raw bounds; prelease вынесен; resources уточнены | Frozen; два actual round2 review получены           |
| v3       | Исправлен round2: always-auth RepeatableRead lookup, typed dependency allowlist/rollback, feature namespaces; resources уточнены         | Frozen; два actual round3 review получены           |
| v4       | Исправлен round3: Statistics scope envelopes200 и adapter check, History403 translation, SSR duplicate arrays                            | Frozen; два actual round4 ACCEPT получены           |
| v5       | Round4 accepted; уточнены browser QueryClient lifecycle и настоящий Prisma post-auth rollback; resources обновлены                       | Frozen; два actual round5 FINAL ACCEPT, план принят |

Frozen v1 SHA256: `5d51ea2ba7ec533cf7479b32b87e965ddd769da0706474be52e0caca243268bd`.
Frozen v2 SHA256: `17a81bc4de8abbbdaba12ff033fbf0d85c35e119e1abe1bb64d8ce5155b15b6f`.
Frozen v3 SHA256: `8cadfcedddc95b29fe97dcf2cdeab1abb254b7e0195bc2d8f018446245920cb1`.
Frozen v4 SHA256: `fdd9f1a79403bd48787c57a259e7fdd0d5370983ea394f2e27aa21f27e043403`.
Frozen v5 для final review SHA256: `84c3c23bcc619fc23e5fcf37b331c2b878286fae6dfa46920f2d87a1ae27d73f`.
После final acceptance изменён только status header плана, принятые контракты
не менялись. Это не новый substantive revision.

## Круг 1 — контракты, авторизация и достижимость

Статус: **завершён; findings внесены в v2 до round2**. Два независимых критика
прочитали actual v1/current source: `statistics_history_ux_audit` (A,
frontend/auth) и `critical_runtime_audit` (B, data/contracts), GPT-6.1 Sol xhigh.

| ID           | Severity / finding                                                                                                                                                    | Решение и revision                                                                                                                                                                        |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1           | P2: random UUID не доказывает, что seed новый; had-denial требует API-validation также для unseen cached seed. Late old-admin403 не должен закрыть новый member scope | Принято: §3.1 explicit had-denial/API trust, §3.2 captured active identity check и isolated old-request cleanup                                                                           |
| A2 / B1      | P2: absent History и dependency failure нельзя сливать;403 требует закрытия scope, не partial data                                                                    | Принято: frozen v1 уже имел late taxonomy clarification; v2 сохраняет `linked/not_recorded/temporarily_unavailable`, auth-before-dependency fallback и distinct server regressions (§5.2) |
| A3           | P2: invalid/duplicate URL policy и выход из SSR error недостаточно конкретны; Retry может зациклить invalid URL                                                       | Принято: §4.1 rejects duplicate known params/coercions, invalid не fetches; explicit Reset30/all удаляет occurrences с сохранением unrelated URL scope                                    |
| A4 / B scope | Scope cut: недоказанная optional prelease классификация расширяет batch и не объясняет Gateway500                                                                     | Принято: §7 только отдельный follow-up/task/PR; удалён optional code tail из implementation/gates/estimates                                                                               |
| B1 coverage  | Lookup обязан учитывать capture coverage и те же readable predicates, что History list                                                                                | Принято: §5.2 `capture_v1` gate + latestRootRequestId/projectedAt/latestStatus/latestRequestedAt; actual PG no-coverage/incomplete/foreign tests                                          |
| B2           | P2 bounded-input clarification:≤25 distinct не ограничивает raw duplicates; PR нужен positive32bit                                                                    | Принято: §5.2 raw array0..25 до dedupe,26duplicates reject; existing identifier +1..2147483647 validation                                                                                 |

Root resource correction, не critic acceptance: pinned pnpm prune был выполнен
после inventory без active pnpm, освобождены469MB unreferenced CAS; примерно620MB
свободно. Dependencies/worktrees не удалялись. Root-only offline hardlink install
в процессе; его успех и выполнение browser/build не заявлены. План разрешает
контролируемую поддерживаемую cleanup, запрещает shared cleanup при installs и
ручное удаление unknown worktrees; hosted fallback сохраняется.

## Круг 2 — исправленный план и adversarial scenarios

Статус: **завершён; clarifications внесены в v3 до round3**. Те же два GPT-6.1
Sol xhigh критика прочитали exact frozen v2 и Round1 dispositions.

- A: ACCEPT, новых material must-fix нет. Маленький guard принят: feature namespace
  сохраняется в boolean markers/purge; Usage scope не чистит Statistics/History.
- B: прежние B1/B2 resolved, Usage semantics accepted. Два уточнения приняты:
  no-coverage/empty/unavailable paths тоже authorizeHistory в том же RepeatableRead;
  post-auth projection dependency имеет явный typed code allowlist, unknown bugs
  пробрасываются; rollback sentinel не проглатывает aborted SQL transaction.
  Добавлены membership-failure, synthetic-programming и admitted-dependency tests.

Root operational update: exact pnpm11.28.7 install completed13.1s;886 packages,
3downloaded,1068 policy checks passed, no lock change. dfAvail снова0 от shared
pressure. Offline Prisma generation пока не завершена (sandbox EPERM/status0
не признаётся успешным generation). Это environment receipts, не waiver gates.

## Круг 3 — source/composition и ограничение scope

Статус: **завершён; findings внесены в v4 до round4**. Те же два GPT-6.1
Sol xhigh критика прочитали frozen v3/current source.

- B: ACCEPT, новых material findings нет; previous raw bounds/auth/typed fallback
  clarifications resolved. Дополнительный code scope не требуется.
- A: P2 — Statistics promise server-derived scope match нельзя выполнить на
  нынешнем bare report/page response. Принято: §3.2 конкретные web envelopes
  `scope.actorId/workspaceId + report/page`, adapter check до cache на каждом200,
  без domain Report/authority params и с прежним no-store.
- A implementation note: `HistoryAccessError` сейчас не распознаётся
  statisticsErrorStatus. Принято: явный перевод в StatisticsAccessError и
  route-boundary403/no-payload regression (§5.2).
- Root/author source clarification: Next SSR string[] duplicates нельзя silently
  collapse к первому при URLSearchParams conversion. §4.1 требует append всех
  occurrences для того же strict codec, что в browser.

## Круг 4 — проверяемость и frontend recovery

Статус: **завершён; A ACCEPT и B ACCEPT**, новых material must-fix нет. Те же
два GPT-6.1 Sol xhigh критика проверили frozen v4 и dispositions.

- A подтвердил Stats envelopes, before-cache check, SSR duplicate/reset и
  History403 route boundary. Browser extension должна сохранить QueryClient
  при cachedBack/remount и реальном role change; reload недостаточен.
- B подтвердил контракты/guards. Для typed dependency classifier требуется хотя
  бы один настоящий Prisma/PG post-auth projection failure/rollback, не только
  synthetic error. v5 уточняет owned lock/short session timeout fixture без shared
  DB/global role/settings и без расширения feature scope.

Root environment receipt: Prisma7.8.0 generation прошла1.86s через существующий
local non-require-isolated helper; unshare unsupported, строгий CI не ослаблялся.
TS7.0.2 install прошёл21 policy entries и завершается. statfs UID0 около1.5GB
включая reserved, dfAvail0; local browser readiness не заявляется.

## Круг 5 — финальная согласованность и readiness

Статус: **завершён; A FINAL PLAN ACCEPT и B FINAL PLAN ACCEPT**. Оба GPT-6.1
Sol xhigh критика прочитали actual frozen v5 и предыдущие dispositions;
неразрешённых material findings по плану не осталось.

Оба verification reminders проверены и сохранены: cachedBack/реальный DB role
change при живом QueryClient и хотя бы один настоящий owned-session Prisma/PG
post-auth projection timeout/rollback. Feature scope/контракты не расширены,
prelease follow-up исключён. Это пятый фактический plan-review response каждого
критика, **не** approval реализации и не результат tests/browser/CI.

## Plan-only publication

Статус: **pending — accepted plan awaiting plan-only publication**. Commit/PR,
push receipt и head SHA заполняет основной агент после фактической публикации.
Пять actual rounds завершены; реализация начнётся только после этого push.

## Реализация, проверки и final critics

Статус: не начата. Никакие тесты, browser scenarios, CI, merge или deployment
этим документом пока не объявлены прошедшими. Implementation receipts,
ограничения среды и последующие material findings записываются по факту.
