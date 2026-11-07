# ReviewRouter — план интерактивных PR-команд (lean UX)

**Дата:** 2026-11-07 · **Статус:** design only, после критических проходов; **не** разрешение на реализацию всего списка.  
**Репозитории:** [ReviewRouter AI](https://github.com/777genius/review-router-ai) (`main` `9a416dfb`), [GitHub Action](https://github.com/777genius/review-router) (`main` `41f9c3e6`).  
**Связанные задачи:** [#823 — PR commands](https://github.com/777genius/review-router-ai/issues/823), [#824 — minAgreement](https://github.com/777genius/review-router-ai/issues/824), [Action Draft PR #372](https://github.com/777genius/review-router/pull/372) (`100fce1b`, ещё не считается выпущенным).  
**Рамка:** GitHub-first; без второго бота, нового сервиса, универсального command framework, новых feature flags и автоматических изменений кода.

## 1. Решение коротко

**Не реализовывать 15+ команд ради паритета с CodeRabbit.** Первая ценность — *понятно вызвать проверку и обсудить конкретную находку*, используя уже существующие сервисы ReviewRouter. Большая часть похожих функций либо уже доступна через GitHub/дашборд, либо требует обширной новой архитектуры.

**Предлагаю в первой волне:** (1) завершить и проверить `help` + `review` + честную справку о `status` на базе PR #372; (2) сделать ответы на вопросы и «объясни» внутри существующих review threads удобными **без отдельного AI-командного движка**. При наличии пользовательского спроса — следующий маленький шаг `fixed`/проверка исправления; top-level `ask` только если inline-диалоги явно недостаточны.

**Не делать в первой волне:** `full review`, `pause/resume`, специализированные `review security/tests/performance`, `second opinion`, `fix`, `fix-ci`, `generate tests`, `add docs`, `changelog`, `diagram`, `plan`. Не потому что они невозможны, а потому что значительная часть — отдельные продуктовые возможности с более высокой ценой и риском.

**UX по умолчанию:**

1. У пользователя есть надёжная текстовая форма `/rr help`, `/rr review`; упоминание работает только с реально проверенным login установленного GitHub App. Строка `@reviewrouter` в комментарии сама по себе **не доказывает**, что существует такой GitHub-аккаунт и пользователь получит notification.
2. В ответ на inline finding пользователь просто пишет «Почему это ошибка?» / «Это уже исправлено?» — не обязан изучать 15 команд. Явное `/rr explain` можно оставить необязательным коротким синонимом, только если это даёт улучшение UX.
3. Каждая дорогая или изменяющая состояние команда явно говорит, что она делает, кому доступна, была ли поставлена в очередь, какой SHA проверяется, и где находится результат. Не публиковать ложное «готово» из факта успешного enqueue.
4. В `help` показывать **только реально доступные на установленном runtime** команды, а не весь бэклог.

## 2. Что подтвердил ресёрч

### Конкуренты: полезные механики, а не каталог для копирования

- **CodeRabbit** различает incremental `review` и full-from-scratch `full review`, поддерживает `pause/resume`, `fixed`, `summary`, `configuration`, `help` и чат через упоминание. В документации специально ограничены позиции команд (top-level vs thread), одна команда на сообщение, команды в code fence игнорируются; реальные handles могут отличаться. Есть также `resolve/approve` и запись фиксов — **не повод** сразу повторять их автоматические write-действия. [Официальный reference](https://docs.coderabbit.ai/reference/review-commands), [управление review](https://docs.coderabbit.ai/guides/commands).
- **PR-Agent** даёт `/review`, `/ask`, `/describe`, `/improve`, `/add_docs`, `/generate_labels`, `/update_changelog`, `/help`; конфигурацию можно увидеть через `/config`. Команды помогают открыть возможности, но часть пересекается с уже существующими ReviewRouter PR descriptions/дешбордом. [Официальные tools](https://docs.pr-agent.ai/tools/), [usage/automation](https://docs.pr-agent.ai/usage-guide/automations_and_usage/).
- **GitHub** имеет два разных источника комментариев: top-level PR comment — `issue_comment`, inline reply — `pull_request_review_comment`; для второго события и fork PR действуют отдельные permissions и ограничение секретов. Нельзя просто переиспользовать inline-путь для top-level Q&A без самостоятельной проверки GitHub source/authorization. [GitHub Actions events](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows).

**Проверка ценности, а не доказанный спрос:** баллы полезности ниже — инженерные гипотезы. Нет аналитики реальных пользовательских запросов/сравнительного UX-теста, поэтому решение о дорогостоящих функциях должно приниматься по обратной связи, а не по числу команд у конкурента.

### Текущее состояние ReviewRouter — это важно для цены

| Существующий механизм | Файл/контракт | Следствие |
| --- | --- | --- |
| `skip`, `unskip`, `status`, `review`, `@codex review` | `review-router/src/github/interaction.ts`, `parseInteractionCommand` | `status` означает **журнал override**, НЕ результат ревью; `review` уже запускается с role-check и expected head SHA. |
| Текущий Draft-срез `help`, `@reviewrouter` aliases | `review-router` PR #372 | Нельзя считать shipped: ещё нужны корректный runtime `dist`, green CI, release/pin/E2E. Не создавать параллельный аналог этой фичи. |
| Старый inline discussion flow | `review-router/src/github/discussion.ts` | Ответы в review-thread есть, но mode/provider могут быть выключены. Не запускать отдельный агент для `explain`. |
| Managed Gateway conversation | `review-router/src/github/conversation.ts`; `review-router-ai/packages/features/conversations` | Уже есть idempotency, verified source, exact revision, freeze/claim/publication. **Однако** поддерживаются inline события и только qualifying Gateway; обычная conversation может **инициировать memory actions/learning**. «Read-only ask» требует явно запретить эти side effects. |
| Manual review command API | `review-router-ai/apps/api/src/review-v2-request-command-routes.ts` | Вход допускает только `skip`, `unskip`, `review`, не содержит режима `full`, `security` или `focus`. Алиас `full review` сейчас был бы ложью. |
| Review history / progress | `packages/features/review-history` и `packages/features/review-progress` | Статусы `queued/running/completed/incomplete/failed/unconfirmed` и coverage уже выражены; не заводить собственную базу статусов для `/rr status`. |
| PR description updater | `packages/features/review-publishing/src/v2/domain/review-pr-description.ts` | Уже есть markers и merge блока без перезаписи авторского текста. `summary` — повторное использование, но генерация по команде потребует отдельного безопасного run. |
| Согласование голосов | `review-router/src/analysis/consensus.ts` | `minAgreement=2` пока не является строгим hard quorum для одиночных model findings; отдельно #824. Не обещать «подтверждено двумя» в `second opinion` до исправления семантики. |
| Release/activation | `review-router/docs/review-action-v2-development.md` | Изменённый `.ts` сам по себе **не** обновляет выпущенный `dist/index.js`. Action runtime и SaaS protocol должны быть выпущены и активированы совместимо. |

**Главный архитектурный разрыв:** `account-gateway` interaction workflow сейчас принимает только inline `pull_request_review_comment` (включая комментарии в thread), а top-level `issue_comment` идёт по другому/legacy маршруту. Поэтому «добавить top-level `ask` regex-строчкой» не работает и может нарушить custody privacy boundary.

## 3. Конкретный пользовательский контракт (узкий)

| Место в GitHub | Что пишет пользователь | Что нужно показать |
| --- | --- | --- |
| PR conversation | `/rr help` | 4–6 поддерживаемых действий, ссылка на docs; **без модели**. |
| PR conversation | `/rr review` | `Review requested for HEAD abc123` (или «нет доступа/настройки»), без обещания full; ссылку на Actions/Check когда есть подтверждённый ID. |
| PR conversation | `/rr status` | Существующие override-данные и **явный** текст «execution status: see GitHub Checks / ReviewRouter history». Не называть ledger полным health status. |
| ReviewRouter inline thread | «Почему это ошибка?», «Какая альтернатива?», «А тест?» | Один ограниченный read-only ответ с исходным контекстом; если обсуждения отключены — один короткий точный notice, не бесконечный retry. |
| ReviewRouter inline thread | «Я исправил, перепроверь» | **Сначала** предложить `/rr review` текущего PR; отдельную команду `fixed` добавлять только при наличии безопасного targeted revalidation. |
| Где угодно в чужом issue / обычном коде / code fence | `@reviewrouter review` | Никаких inference, API mutations или случайного запуска. |

Команды уровня **контроля бюджета/состояния** (review, pause/resume, full review) — только writer/maintain/admin после GitHub permission и workspace policy. Read-only `help` можно для любого человеческого автора комментария к верифицированному PR; вопрос к модели — только PR author или writer+ в первой версии, с квотами, чтобы не создавать бесплатный публичный chat endpoint. Доступ к `config` должен быть безопасно ограничен; секреты, account IDs, tokens, provider gateway bindings нельзя раскрывать.

**Синтаксис:** каноническая `/rr <command>` — одна команда целиком в начале комментария; опциональный `@<verified-installed-app-login> <command>`, case-insensitive. Реальные реплики на inline findings — естественный язык; не заставлять пользователя писать `/rr ask` там, где диалог уже работает. Прочие команды и аргументы не интерпретируются через «почти совпало». Одно действие на GitHub comment, edited/delivered events идемпотентны. Никакой произвольной `--config` из пользовательского текста, shell, path globbing и unchecked YAML.

## 4. LOC и продуктовая ценность по каждой команде

**Метод подсчёта:** ориентировочные **новые/существенно изменённые рукописные строки** в обоих репозиториях вместе, **включая** целевые тесты и документацию. Не включает generated `dist`, sourcemap, lockfile и механические переформатирования. Диапазоны — не измеренные трудозатраты и не обещание; указаны отдельно **общие 160–320 LOC** на базовые правила parser/permissions/identity/preflight/anti-replay, если соответствующий фундамент из #372 не покрывает их. **Строки не складывать дважды**: каждая следующая команда переиспользует базу и предыдущие контракты. При отдельном backend для top-level chat разброс большой.

| Команда/функция | Польза 1–10 | Доп. LOC (с тестами) | Сложн. 1–10 | Решение | Что на самом деле нужно сделать |
| --- | ---: | ---: | ---: | --- | --- |
| `/rr help` + корректный mention | 9 | **45–130** | 2 | **Сделать, #372** | Проверить фактический App login, availability, no-model response, preflight, docs. |
| `/rr review` + mention alias | 9 | **30–110** | 3 | **Сделать, #372** | Reuse exact-head request/permissions; честный ack, no double dispatch. |
| `explain` **в inline thread** / обычный вопрос | 9 | **60–180** | 3–5 | **Сделать UX, без нового движка** | Reuse managed/legacy conversation; read-only intent, ограничить memory side effects; корректное состояние «off». |
| `/rr status` (корректная справка + ссылка) | 7 | **70–180** | 3 | **Минимум, без дублирования GitHub** | Ledger + link to Checks/history; полный агрегат ниже отдельно. |
| `status` (живой агрегат с coverage) | 7 | **260–560** | 6 | Отложить до запроса | Authorized history/progress reader, latest head, partial/unknown. |
| `config` (read-only summary) | 4 | **120–260** | 4 | Пока ссылка в Dashboard | Redacted effective settings + inheritance, запрет приватных полей. |
| `ask` **в top-level PR** | 7 | **650–1 300** | 8 | **Не в MVP; отдельное решение** | Новый проверенный issue_comment source/публикация, read-only purpose, no memory writes, context budget, idempotency, release. |
| `fixed` **в inline thread** | 8 | **550–1 100** | 7 | Кандидат P1 | Revalidate one finding against exact current HEAD through existing lifecycle; без blind resolve. |
| `full review` (действительно с нуля) | 6 | **750–1 500** | 8 | Отложить | Новый протокол режимов, обход replay/reuse, полная coverage, идемпотентность и лимиты. |
| `review security` | 5 | **550–1 150** | 7 | Отложить | Typed focus в capture/manifest, scoped result, no false All Clear; можно сначала через Dashboard review rules. |
| `review tests` / `review performance` | 4 | **90–250 каждая** *после* focus-механизма | 5 | Не запускать три самостоятельные реализации | Единый typed focus; отдельные focus-профили только если были реальные запросы. |
| `summary` / `describe` | 5 | **300–650** | 6 | Отложить | Независимый rerun существующего description generator + marker CAS, не трогать авторский текст. |
| `suggest fix` **как GitHub suggestion** | 7 | **280–650** | 6 | P1 при достаточной точности spans | Valid exact diff hunk, line-range, safe suggestion; ничего не пушить. |
| `second opinion` | 5 | **700–1 500** | 8 | Не сейчас | Один целевой дополнительный reviewer, отдельный бюджет, правильный quorum и прозрачная provenance. |
| `pause` + `resume` | 4 | **650–1 250 вместе** | 8 | Отложить | Persist PR-scoped switch, gate automatic admission, ownership, resume semantics, migration/tests. |
| `fix` (автоматически меняет код) | 5 | **1 800–3 600** | 10 | **Не делать сейчас** | Другая write-authority/sandbox/branch checks/approval; новые угрозы. |
| `fix-ci` | 4 | **2 200–4 500** | 10 | **Не делать** | CI logs/custody, edit/run/retry approvals, branch protections, отдельный продукт. |
| `generate tests` (только предложения) | 5 | **400–850** | 6 | Низкий приоритет | Bounded test suggestion w/ references, без коммита. Auto-write: **1 000–2 200**. |
| `add docs` / `docstrings` | 3 | **400–850** | 6 | Не делать сейчас | Разрешённые файлы/язык, комментарий или suggestion вместо записи. |
| `update changelog` | 3 | **500–1 050** | 7 | Не делать | Version/release ownership, conflicts, manual approval; лучше обычный development workflow. |
| `diagram` / `plan` | 3 | **250–600 каждая** | 5 | Не делать | Отдельная генерация для узкого кейса; обычный вопрос в чате покрывает большинство запросов. |
| `skip` / `unskip` | 8 | **0–80** | 2 (UX) | Уже есть | Только проверить discoverability и не сломать signed ledger. |

**Проверка оценки:** самая маленькая команда не обязательно самая нужная; дешёвый `help` целесообразен, но 15 дешёвых алиасов = шум. Самая полезная «магия» — быстрый качественный ответ на вопрос в существующем thread, а не ещё один список команд. `full review`, `fixed` и `second opinion` требуют **семантических** изменений, не только парсера; поэтому их оценки на порядок больше алиасов.

### Рекомендуемый бюджет и порядок (не сумма всего каталога)

- **Slice A — завершение #372:** ещё **~80–200 LOC** поверх уже написанного в Draft (замена ложного/неверифицированного mention-handling, регрессии, справка/ack). Если делать с чистого main — help + review + совместимая маршрутизация, плюс shared foundation ≈ **230–500 LOC**. Не дублировать работу #372.
- **Slice B — inline questions/explain:** **~60–180 LOC** если достаточно существующей qualified conversation и конфигурации; **+200–450** при необходимости строго развести read-only prompts и memory-side effects. **Эта добавка обязательна, если существующий путь может мутировать memory**. Не выдавать за «60 строк», пока не сделан safety-аудит.
- **Slice C — польза после обратной связи:** выбрать **одну**: targeted `fixed` **550–1 100 LOC**, или top-level `ask` **650–1 300 LOC**, или лучшее `status` **260–560 LOC**. Не запускать все одновременно.
- **Нет решения на будущее** о суммарных 6–12 тысячах строк до измерения реального спроса/стоимости.

## 5. Как именно реализовать выбранные команды

### A. `help`, `review` и aliases — добить существующий Draft #372

1. **Action parser / ingress:** в `src/github/interaction.ts` оставить allowlisted parser; изменить matcher так, чтобы `@<handle>` принимался **только** для проверенного App login/установленного профиля. Не хардкодить глобально фальшивый mention; `/rr` всегда независим от имени бота. Указания из строки комментария не должны менять provider/model/CI-настройки. Сохранять поддержку legacy `@codex review` в существующих установках с явно документированным переходом, не обещать `@codex` как реальную метку ReviewRouter.
2. **Preflight:** в `src/main.ts` отделить детерминированные команды от discussion. Команда `help` не должна восстанавливать CLI/OAuth, вызывать модель, выделять ревьюерский бюджет, создавать память или повторно публиковаться при GitHub redelivery.
3. **Permission/identity:** для `review` reuse `ReviewInteractionHandler.handleManualReviewCommand` + SaaS `/api/action/v1/review-requests/manual` (проверить роль `write/maintain/admin`, полный current head SHA, repo installation, event source, entitlements). Изменённые комментарии не должны порождать новый review при том же comment ID; дополнительный прогон — новый комментарий/явный retry.
4. **Ответ:** `help` — короткая таблица только реально доступного в **этом** runtime; `review` — `queued`, `already queued`, `unavailable`/permission denial с точным объяснением, не `review completed` и не `full review`.
5. **Coverage:** unit parsing (case, whitespace, Unicode, mention handle, code blocks, quotes, malformed arguments, bot loops), integration action preflight + request port; real PR comment/edited delivery; rebuilt `dist` and pinned installer workflow E2E.

**Избежать «сервиса команд»:** один small typed union/pure parser рядом с существующей interaction ingress. Сложные режимы не добавлять в этот срез.

### B. Inline Q&A и объяснение (`explain`/обычный текст) — главный UX-приоритет

1. **Не создавать отдельный AI tool.** Использовать `src/github/discussion.ts` для legacy compatible installations и `src/github/conversation.ts` → `packages/features/conversations/src/application/process-conversation.ts` для квалифицированного account-gateway. В первую очередь проверить, где runtime доступен реально, а не только присутствует в коде.
2. **Семантика:** ответ только на видимую human reply под **верифицированным ReviewRouter finding**. Отвечать на запросы объяснить причину, альтернативу, предложить тест. Не выдавать speculation за доказанный баг. Отсутствие достаточного diff/context → `не могу подтвердить` с точным описанием отсутствия.
3. **Read-only строго:** команда `explain` и явный информационный вопрос не должны менять review verdict, состояние GitHub thread, память или знания проекта. В managed flow есть ветки maintained memory/automatic learning, поэтому выбрать узкий **purpose/read-only answer** или сделать явное запрещение действий/обучения именно для информационного запроса, с регрессионным тестом. **Существующие отдельные явные memory-команды и квалифицированное обучение на фактических высказываниях сохраняются:** нельзя их глобально отключить ради FAQ. Скрытого `remember`/`forget` от слова «объясни» быть не должно.
4. **Публикация:** использовать имеющуюся prechecked provenance и reply claim/reconciliation, same SHA/source revision, per-thread budget, no bot loops. Не сохранять raw source/credentials в control plane; managed SaaS может транзитно читать ограниченный, разрешённый thread/context для ответа (это иной privacy boundary, явно описать его пользователю).
5. **UX:** никакой обязательной команды для вопроса; короткая подсказка под finding «Ответьте на комментарий, чтобы уточнить» только если discussions поддерживаются и включены. Не плодить notice-комментарии от каждого вопроса, когда capability unavailable.
6. **E2E:** вопрос по реальному inline finding, follow-up, user с недостаточными правами, отключённый provider, изменённый/удалённый комментарий, head updated, дубли webhooks, partial review, сохранность memory/no mutation.

**Стоп:** если для правильного read-only purpose требуется больше контрактных изменений, чем ожидалось, сначала решить privacy/semantic boundary отдельным ADR, а не «облегчать» интеграцию небезопасным обходом.

### C. `status` — только то, чего не видно в существующем GitHub UI

1. В первой итерации **не менять значение существующего** `/rr status` (signed skip/unskip ledger); назвать его в help «finding overrides» и дать ссылки на GitHub Checks и ReviewRouter History.
2. Если пользователи реально просят статус внутри комментария, расширять через существующие `review-history`/`review-progress` authorized readers: current head SHA, queued/running/completed/incomplete/failed/unconfirmed, last updated, coverage complete/partial, URL. Не новый schema и не второй cache.
3. Никакого вывода `All Clear` при `incomplete`/`unknown`, никакого угадывания from queued. Тесты stale SHA, отсутствующих historical данных, cross-workspace access, storage lag.

### D. `fixed` — точечная проверка **одной** находки, а не массовый auto-resolve

1. Команда доступна **только reply конкретному finding**; finding ID/fingerprint/parent source берётся из доверенного marker + GitHub API, не из текста пользователя.
2. Текущие head/base SHA и уже существующие review-lifecycle/revalidation contracts определяют, можно ли сказать `fixed`, `still present`, `cannot verify`. Изменённая строка и исчезнувший старый span не являются доказательством исправления.
3. Если verifier нужен новый model invocation: применить текущую quota/authorization + bounded current-head context, не повторять весь PR review. Review finding при отсутствии полноценного quorum не auto-resolve. **Первый выпуск read-only report**, изменять thread status только позднее при отдельном acceptance.
4. `skip/unskip` ledger остаётся источником human override; `fixed` не эквивалентен `/rr skip`. Тесты same head, stale head, source branch changed, false positive, two reviewers conflict, fork and replay.

### E. Высокая стоимость / deferred: как делать, только если будет спрос

| Возможность | Минимальная корректная реализация (не только parser) | Причина отложить |
| --- | --- | --- |
| `ask` в PR conversation | Новый validated `issue_comment` source + GitHub App read path, pure read-only Q&A purpose, bounded PR/head context, no automatic memory learning, publisher/idempotency/quote limit, policy + account gating. | Текущая managed conversation работает с **inline**, source расширяется не бесплатно. |
| `full review` | Typed `review_mode=full` в SaaS ingress/runtime manifest; fresh coverage всех eligible changed files, отказ от reuse по запросу, price/cap fences, результатов и старых threads; фиксировать смысл full. | Один новый alias врёт пользователю, если старые incremental snapshots возвращаются. |
| `review security/tests/performance` | Typed allowlisted review intent, provider policy/extra instructions as untrusted policy *data*, scope evidence и `focused review ≠ full coverage`. Не принимать raw options, paths из comment как shell. | Иначе легко породить ложную полноту ревью. |
| `pause/resume` | PR-scoped auditable persisted state, gate **automatic** ingress только, manual review остаётся доступен; resume не запускает неизвестные paid jobs повторно. | Дополнительная durable lifecycle policy, гонки с текущими run. |
| `summary` | Reuse existing description synthesis + protected `<!-- review-router-summary -->` block; compare-and-swap latest PR body/head, сохранение пользовательского текста. | Уже есть описания PR; UX-выигрыш невелик. |
| `config` | Read-only sanitized projection из существующей effective policy, ссылка в Dashboard. | Дублирует конфиг интерфейса, риск утечки приватных provider/account деталей. |
| `suggest fix` | Совместимый `suggestion` только на реально изменённых lines текущего HEAD, проверка range/witness, отсутствие записи в ветку. | Неверные patch ranges подрывают доверие. |
| `second opinion` | Targeted secondary reviewer of **одного** finding, separate vote provenance, квоты, conflict report, no implicit hard quorum до #824. | Существующие multi-reviewers и optional critics уже покрывают часть случаев. |
| `fix` / `fix-ci` | Отдельный trusted write workflow, branch access policy, proposed diff preview, user confirmation, protected paths, no model-suggested shell execution by default, runnable E2E; never covert auto-commit. | Отдельный продукт и серьёзная security поверхность. |
| `generate tests`, `add docs` | Начинать как bounded text/patch suggestion, не редактировать репозиторий; подтверждение человека. | Модельный output часто дешевле получить обычным coding assistant. |
| `changelog`, `diagram`, `plan` | Сначала редкая prompt-команда с read-only ответом; перманентные artifacts/branch writes только при доказанном спросе. | Недостаточно пользы для отдельного product surface. |

## 6. Пошаговая реализация и E2E-гейты

**Не создавать общий umbrella PR с 15 командами.** Следующие PR — отдельные, небольшие; каждый имеет свой реальный пользовательский сценарий и строгую границу.

| Этап | Изменения / граница | Предварительная оценка | Условие перехода |
| --- | --- | ---: | --- |
| **A0** | Завершить существующий Action Draft #372, не дублировать его: help/verified mention aliases, справка/short ack, тесты, rebuild `dist`, docs. | остаток 80–200 LOC | CI + disposable PR command E2E, exact pin/release; rollout не заявлять до подтверждения. |
| **A1** | Улучшить inline discussions (вопросы/explain без спецсинтаксиса), выровнять managed/legacy UX и read-only boundary. | 60–180, +200–450 при memory isolation | Реальный inline thread reply; модель/публикация/replay/privacy E2E. |
| **A2 (по спросу)** | Точечный `fixed` с evidence; без авторезолва. | 550–1 100 | Проверка истинно исправленного/неисправленного в disposable PR на current HEAD. |
| **B (опционально)** | Top-level `ask` **или** rich status, выбирается после наблюдения использования. | 650–1 300 **или** 260–560 | Capability + authorization + no-memory-mutation + E2E; no false success. |

Обязательные проверочные сценарии в каждом затронутом пути:

- **Parser:** exact command, bot/self loop, code fence, blockquote, HTML, multiple commands, malformed options, prefix collision (`review-security`), case/Unicode, unknown command. Никогда не запускать «близкую» команду по случаю.
- **Identity & access:** автор PR, writer, maintainer, admin, outsider, fork, removed installation, unrelated repository, stale workspace, deleted comment.
- **Replay:** GitHub retry/редактирование, lost response from create, parallel delivery, same comment ID vs new comment ID. Не удваивать inference, charge, GitHub публикацию или queue intent.
- **Correctness:** current head, partial/incomplete, provider disabled, missing snapshot, selected account unavailable, old thread, unverified finding marker, history reader lag.
- **Privacy/security:** no secret values in notices, no raw source stored in control plane, no command-to-shell, no `pull_request_target` checkout untrusted PR, no memory mutation from read-only question, no untrusted role from payload.
- **Release:** Action source test + committed `dist/index.js` validation, release manifests/compatibility, generated caller pin, real disposable PR end-to-end, post-merge verification; do not infer production activation from a source commit.

## 7. Критические проходы и правки плана

> **Честность метода:** в доступной рабочей среде нет делегирования отдельным модельным агентам-критикам. Ниже — три **раздельных критических анализа** одного ассистента с разными критериями, со сверкой кода и официальной документации; это **не** независимый multi-model review и **не** E2E. Замечания уже включены в финальную редакцию.

### Раунд 1 — продукт/UX: «Копируем CodeRabbit вместо работы пользователя»

- **Возражение:** исходная идея «все 15 команд» создаёт learning curve и шум в GitHub.  
  **Правка:** P0 сжат до `help`, уже имеющегося `review` и естественного inline-диалога. Остальное — по demand.
- **Возражение:** `status`/`config` дублируют существующие checks/dashboard.  
  **Правка:** первый `status` — честная ссылка и существующий override ledger; rich status только после подтверждения спроса; `config` пока не строить.
- **Возражение:** новые алиасы `@reviewrouter` не обеспечивают настоящее упоминание.  
  **Правка:** `/rr` — канонический fallback; mention только для проверенного реального GitHub App login.

### Раунд 2 — security/privacy: «Read-only вопрос неожиданно меняет память»

- **Возражение:** существующий managed conversation умеет proposals/learning и зависит от Gateway qualification. Простой `/rr ask` через тот же handler может давать побочные эффекты, которые пользователь не ожидал.  
  **Правка:** выделить **read-only purpose/no-memory-action**, запретить silent learning; оценка для inline увеличена на стоимость isolation; top-level `ask` отдельно.
- **Возражение:** `issue_comment` и inline conversation имеют разные trust и source identity.  
  **Правка:** top-level `ask` не включать в P0 и не делать «переадресацию» через inline без проверенного источника.
- **Возражение:** бот в public repo может стать платным общедоступным чатом.  
  **Правка:** AI Q&A сначала PR author/maintainers, квоты + существующие provider/entitlement checks.

### Раунд 3 — architecture/quality: «Маленькая команда может оказаться дорогим новым runtime»

- **Возражение:** `full review` в текущем request API не имеет mode и не гарантирует обход reuse.  
  **Правка:** defer и выделить 750–1 500 LOC; alias строго отклонять до реального end-to-end full path.
- **Возражение:** `fixed` не должен автоматически делать `skip`/resolve и считать отсутствие old span исправлением.  
  **Правка:** первую версию только read-only evidence/verdict с fallback `cannot verify`.
- **Возражение:** PR #372 уже открыт, а `dist` и release — отдельная гарантия.  
  **Правка:** plan-first, не создавать второй implementation PR, считать feature unfinished до Action E2E.
- **Возражение:** дублирование parser, auth, state machine и schema приводит к оверинжинирингу.  
  **Правка:** повторное использование existing ports/ledger/conversation/history, один bounded parser, никакого нового сервиса или общей DSL.

**Оставшиеся неопределённости до реализации:** реальный App login в каждой установке; customer-профили managed Gateway; полнота актуального PR #372 CI/release; точная возможность read-only Q&A без нового inference contract; наличие фактического спроса на top-level chat. Поэтому LOC — диапазоны, финальный scope каждого среза должен быть закреплён в маленьком implementation PR после source audit.

## 8. Критерий готовности и решение о продолжении

Считать MVP завершённым только когда установленный пользователь:

1. Пишет `/rr help` и получает правильные возможности своей установки.
2. Пишет `/rr review` с ролью writer+, видит достоверную очередь/отказ, а ReviewRouter действительно проверяет правильный HEAD.
3. Отвечает на конкретный inline finding обычным вопросом и получает корректное, ограниченное доказательствами пояснение без скрытой memory mutation.
4. Видит честный `incomplete/unknown`, если ревью неполное, и не получает ложное `All Clear`.
5. Проходит GitHub disposable PR E2E на **точном выпущенном Action и caller workflow**; CI, release, rollout и post-merge состояния зафиксированы отдельно.

После этого собрать **минимум 5–10 реальных обращений/отзывов** (можно через существующий feedback, без новой аналитической платформы) и решать, что из `fixed`, top-level `ask`, `status`, `full review` действительно нужно. **Не добавлять расширения по умолчанию**.

## Источники

**Конкуренты и GitHub:** [CodeRabbit commands](https://docs.coderabbit.ai/reference/review-commands), [CodeRabbit guide](https://docs.coderabbit.ai/guides/commands), [PR-Agent tools](https://docs.pr-agent.ai/tools/), [PR-Agent usage](https://docs.pr-agent.ai/usage-guide/automations_and_usage/), [GitHub Actions event model](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows).

**Код ReviewRouter:** [Action interaction parser](https://github.com/777genius/review-router/blob/main/src/github/interaction.ts), [Action managed conversation](https://github.com/777genius/review-router/blob/main/src/github/conversation.ts), [SaaS conversation source](https://github.com/777genius/review-router-ai/blob/main/apps/api/src/action-conversation-source.ts), [SaaS conversation processor](https://github.com/777genius/review-router-ai/blob/main/packages/features/conversations/src/application/process-conversation.ts), [manual request API](https://github.com/777genius/review-router-ai/blob/main/apps/api/src/review-v2-request-command-routes.ts), [review status model](https://github.com/777genius/review-router-ai/blob/main/packages/features/review-history/src/domain/history.ts), [progress model](https://github.com/777genius/review-router-ai/blob/main/packages/features/review-progress/src/domain/review-progress.ts), [description merge](https://github.com/777genius/review-router-ai/blob/main/packages/features/review-publishing/src/v2/domain/review-pr-description.ts), [Action release contract](https://github.com/777genius/review-router/blob/main/docs/review-action-v2-development.md).
