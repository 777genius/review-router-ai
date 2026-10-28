# Контекстное обучение из обсуждений и общий вызов LLM

Дата: 2026-10-28. Статус: **согласованный план; текущая реализация и проверка
зафиксированы в [отчёте о выполнении](./2026-10-28-conversational-memory-implementation.md)**.
Три раунда независимой критики плана завершены; последующие три раунда ревью
реализации учитываются отдельно в отчёте.
После R3 внесено owner clarification: plain text/JSON inference напрямую через
existing Account Gateway/Sub2API, без зависимости от ar (§5/12).
После согласования владелец отдельно авторизовал реализацию end-to-end в draft PR.
Production activation требует перечисленной ниже квалификации. Исторические
accepted ADR и план 23.10 не переписываются.

## 1. Результат для пользователя и границы решения

ReviewRouter должен понимать **весь inline thread**: исходное замечание, ответы
разных людей и ботов, последовательность, исправления, текущую привязку к коду.
На новое человеческое сообщение он отвечает с учётом уже известной памяти и
сам замечает полезное долговечное знание, даже если человек не написал
«запомни». Create/update/retire/forget имеют проверяемый результат: принято в
очередь, действительно опубликовано, отозвано из новых запросов либо физическое
удаление ещё ожидается. Сообщение бота может объяснять контекст; оно не получает
право менять правила проекта.

Память нужна также расследованию PR: соглашения и предыдущие объяснения помогают
исследовать код, но не подменяют проверяемые факты о коде. Генерация description
использует только релевантные объяснения и терминологию, разрешённые для аудитории
PR. Для обоих потребителей вводится общий механизм получения/замораживания
контекста, с отдельными task policy и admission. Копии retrieval, scope policy,
жизненного цикла и provider configuration в трёх use cases не создаются.

Общий вызов LLM — небольшая application-owned capability для text/JSON
inference через existing Gateway/Sub2API, без запуска агента. Локальные TypeScript-компоненты вызывают порт в процессе. HTTP endpoint
появляется только на существующей реальной границе Action↔control plane/Gateway.
Выбранные review account/model используются там, где конкретный transport это
поддерживает. Credentials, quota, admission и исполнение по-прежнему принадлежат
существующим владельцам. Ни новый endpoint, ни одинаковое имя модели не дают
права обойти account authorization.

Поставляемое разделение:

| Ответственность                                                                         | Владелец                                                                        |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Семантическое выделение знаний, consolidation/dedup, temporal/conflict handling, recall | Нативный memory engine; сначала Hindsight                                       |
| Понимание разговора и формирование ответа                                               | Discussion use case + выбранная LLM capability; использует engine evidence      |
| GitHub source identity/revision, доверие, разрешённая аудитория, право изменения правил | Router product owners                                                           |
| Команды, CAS, replay, operation status, revocation/forget fences                        | Существующий memory feature и его durable metadata                              |
| Переносимый engine mechanism, capabilities и provider mapping                           | Один отдельный небольшой library owner; без GitHub/workspace policy             |
| Account selection, custody, auth, quota, paid dispatch и usage                          | Существующие provider-account/Gateway/Sub2API owners для нового short-call path |

Не строим Router extractor, semantic deduper, vector store, reranker, собственный
consolidator, универсальный manager или новый agent platform. Нативная способность
остаётся нативной; отсутствующая гарантия объявляется unavailable.

## 2. Проверенная исходная точка

В этом документе **S** — `777genius/review-router-ai`, **A** —
`777genius/review-router`. Docs worktree основан на S
`418c0ff848443d7a3a0553be22eb63c45a51f53b`; дополнительно проверяются изменения
S PR [#729](https://github.com/777genius/review-router-ai/pull/729), head
`a75789fc2b4cf7476d247a4b0023390307191781`, и A PR
[#349](https://github.com/777genius/review-router/pull/349), head
`8734b1dff5439bdd52d0150602cb933a123ca386`. Оба PR пока открыты. Эти commit и
локальный тест не являются доказательством установленной версии на Hetzner.

| Наблюдение сейчас                                                                                                                    | Точный owner/evidence                                                                                                                                                  | Следствие                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Memory feature уже разделяет reader/writer/observer/preview, product policy и Hindsight adapter                                      | S `packages/features/memory/src/application/ports/memory-knowledge-provider-port.ts`, `application/use-cases/memory-knowledge-service.ts`, `infrastructure/hindsight/` | Расширять существующий owner, не создавать параллельный CRUD                 |
| Preview принимает `approvedDistilledInput`; runtime query серверная фиксированная                                                    | S указанный port; `apps/api/src/review-memory-runtime.ts`                                                                                                              | Raw thread нельзя незаметно передать в старый DTO                            |
| Review memory ограничена repository + разрешённый workspace, 6/scope, 12 всего, без соседних repo                                    | S `review-memory-runtime.ts`; A `src/control-plane/review-memory-v2.ts`                                                                                                | Сохранить scope isolation; новый task не расширяет readership                |
| Discussion уже загружает все REST pages, но prompt оставляет последние 8 сообщений и обрезает body                                   | A `src/github/discussion.ts#listReviewComments`, `src/discussion/codex-responder.ts#buildPrompt`                                                                       | «Полная история уже есть» было бы неверным claim                             |
| Discussion DTO содержит login/bot/createdAt, но теряет updatedAt и stable author identity; sorting по numeric comment id             | A `src/discussion/types.ts`, `src/github/discussion.ts#buildContext`                                                                                                   | Нужен проверенный conversation snapshot, а не увеличение slice               |
| Новый reply запускается только для human reply на ReviewRouter finding; bots игнорируются как trigger                                | A `src/github/discussion.ts#preflight`, `src/main.ts#runInteractionPreflight`                                                                                          | Сначала этот конкретный inline scope; bots сохраняются в истории             |
| Remember parser — explicit RU/EN patterns/slash commands; responder возвращает intent/answer/suggested action без memory effects     | A `src/github/memory-interaction.ts`, `src/github/interaction.ts`, `src/discussion/types.ts`                                                                           | Автоматическое обучение — новая интеграция, не готовое свойство Hindsight    |
| Discussion напрямую создаёт CodexProvider и выбирает отдельные env auth/model                                                        | A `src/discussion/codex-responder.ts`, `src/main.ts#createDiscussionHandler`                                                                                           | Нельзя обещать уже выбранный review account                                  |
| Prepared review provider invocation возвращает ReviewResult                                                                          | A `src/providers/base.ts`, `src/providers/prepared-invocation.ts`                                                                                                      | Это существующая review boundary, не portable general-purpose LLM API        |
| Investigation имеет отдельные tool/session/fencing contracts; single-T0 preparation намеренно передаёт memory=null для investigation | A `src/review-investigation/application/review-agent-port.ts`; `production-t0-review-runner.ts#prepareSingleT0ReviewPlan`                                              | Сохранить agentic contract и добавить memory input во все actual paths       |
| Description уже использует primary selected model и companion lease/manifest, но memory не получает                                  | A `pr-description-generation.ts`; S `apps/api/src/review-pr-description.ts`                                                                                            | Расширить existing companion, не запустить второй произвольный provider call |

Previous local evidence: actual OCR CLI outgoing-request suite 11/11 и affected
350/350 проверяли настоящий CLI/HTTP с deterministic local inference, **не** live
качество модели. Backend suites 18 SDK + 21 runtime, после main merge 36 focused —
контекст предыдущей работы, не повторно выполненные проверки данного документа.
Новый deep audit обнаружил отдельный **P2 integrity defect** в текущем native OCR:
литералы `{{requirement_background}}` и `{{diffs}}` внутри approved memory body
повторно раскрываются после вставки `{{system_rule}}`. Реальный rr.4 CLI отправил
изменённые bytes и в plan, и в main request; deterministic loopback evidence —
`tmp/memory-conversation-plan/ocr-placeholder-probe.json`. Предыдущие delivery
тесты остаются валидными для проверенных cases, но не покрывали этот input.
**Phase 0: one-pass native template substitution и real CLI regression обязательны
до обещания exact frozen memory bytes.** Контекст полного untrusted thread не
передавать через approved-memory channel.
Развёртывание и живой review не проверены; доступа к Hetzner сейчас нет. Legacy
Render не входит в задачу.

Обязательные источники: [AGENTS](../../AGENTS.md), maintained
[Engineering Quality Standard](https://github.com/agent-teams-ai/.github/blob/main/docs/engineering-quality-standard.md)
(прочитан через GitHub, blob `5b29203935881c3be8d7148a00a11ea9b77542cb`),
[development tools catalog](https://github.com/agent-teams-ai/.github/blob/main/docs/development-tools.md)
(blob `f45a01e3d05ef14616e6753f9e7484bccb39a72d`),
[provider transport scope](../operations/provider-transport-scope.md),
[accepted replacement plan](./2026-10-23-hindsight-memory-replacement.md),
[ADR018](../decisions/018-balanced-memory-privacy-boundary.md),
[ADR021](../decisions/021-balanced-memory-authority.md),
[ADR031](../decisions/031-complete-memory-provider.md),
[complete forget](./2026-10-27-hindsight-complete-forget.md).
Adoption pins Foundation 2.1.0/Get Modular 0.7.0 не меняются от чтения current
standard. Tooling Foundation проверяет memory boundary; оно не является memory
runtime library.

## 3. Явный successor privacy и authority contracts

Новый ADR `conversational-memory-source-processing` принимается перед активацией
нового профиля. Это scoped successor §2/5–7/13 плана 23.10, raw-ingress clauses
ADR018, pending-suggestion default ADR021 и approved-source-only clauses ADR031. Старые документы остаются историческими.
Старый distilled/manual профиль продолжает действовать, пока новый профиль не
квалифицирован и не включён для конкретного workspace/repository.

| Прежний контракт                                                | Изменение только в новом профиле                                                                                                      | Сохраняемое ограничение                                                                    |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Только подтверждённые distilled statements; raw source запрещён | Разрешить проверенную полную inline conversation для native processing и memory-aware response                                        | Не превращать SaaS в общий архив customer code/prompts                                     |
| Suggestion требует Create/Update/Reject по каждой записи        | Owner включает scoped automatic-learning policy; полезные наблюдения из разрешённых человеческих источников публикуются автоматически | Новое сообщение не выдаёт себе authority и не меняет shared rule по уверенности модели     |
| `approvedDistilledInput` и metadata-only verification           | Отдельный `SourceConversation` capability, сервер проверяет и получает актуальные bodies                                              | Старый endpoint по-прежнему отклоняет raw fields; claimed hash не становится verified hash |
| Query только фиксированная approved-source                      | Для conversation task разрешён bounded transient native recall query из проверенного thread                                           | Не разрешать произвольный query field для других callers                                   |
| Одна approved запись — один native document, `chunks` profile   | Для автоматического learning использовать native semantic extraction + документируемую source identity                                | `chunks` не выдаётся за фильтр полезности/semantic extraction                              |

### Что именно transient, а что retained

1. GitHub остаётся первичным хранилищем полной истории. Action/control plane
   держат текущий проверенный snapshot в ограниченной памяти процесса до deadline;
   не пишут transcript в Prisma, outbox, audit, trace, prompt artifacts, errors или
   generic request logs. Повторная обработка читает источник заново.
2. Memory engine может получить raw conversation **только** по отдельно
   квалифицированному профилю: native extraction/dry-run выполняет semantic
   processing; на текущем conservative варианте raw input не публикуется как
   retained document. Публикуются нативно выбранные факты и безопасная provenance.
   Важно проверить provider logs/failed jobs/async operation payloads: название
   dry-run не доказывает отсутствие persistence. Пока это не доказано, профиль
   unavailable, а existing approved-input memory остаётся рабочей.
3. Если для качественной native consolidation/attribution действительно нужен
   сохранённый source document/transcript, это **отдельно раскрытый retained
   source profile**, а не скрытая реализация transient. До выбора задать audience,
   retention/TTL, export и полную deletion coverage для source, facts,
   observations/history/operations/logs/backups. Его активация не входит в первый
   transient срез и требует отдельного решения владельца.
4. Долговременно Router хранит source ID/revision/hash, author stable ID, scope,
   effect IDs, engine generation, status и policy decision. Existing bounded
   delivery envelope может хранить **выделенные факты**, пока команда unresolved;
   не сохраняет transcript. Новый scoped exception также разрешает bounded exact
   reply/action result только как unresolved publication envelope, не весь raw
   model response/events. После settled publication/terminal resolution body
   purged; digest/IDs/status остаются. Existing purge/deletion obligations сохранены.
5. Native model-egress проверяется отдельно: selected review account для ответа
   не означает, что Hindsight использует этот же аккаунт для extraction/embeddings.
   Конфигурация native LLM/embedding credentials и residency — явный operator
   owner; не копировать customer OAuth в memory engine. Не разрешён этот egress —
   automatic learning unavailable, не fallback на произвольный сервис.

Pinned Hindsight v1.1.0 имеет service-static provider/model/key/base URL;
per-bank config исключает provider/model/credentials. Поэтому product short LLM
tasks могут использовать selected review connection, а native extraction,
reflection и background consolidation **не получают её автоматически**.
Первый срез явно раскрывает operator-owned native inference configuration.
Если per-account native inference — обязательное условие активации, провести
отдельный bounded spike существующего OpenAI-compatible Gateway: native
`HINDSIGHT_API_LLM_SEND_BANK_AS_USER` передаёт opaque bank attribution, trusted
server mapping выбирает scope/account и выдаёт memory-purpose grant, включая
background work. Это source-backed возможный seam, **не квалифицированная
интеграция**. Проверить dry-run/retain/reflect/consolidation/retry attribution,
model switching, quotas/revocation и отсутствие secret/log leakage; неподдержанный
mode unavailable. Не создавать новый proxy/account platform ради этого spike.

### Автоматическое обучение и shared policy

Включённая owner policy даёт durable authority обрабатывать разрешённый класс
source messages, а не заставляет нажимать Save на каждом факте. Новое информативное
human message запускает native selection без magic phrases. Разрешённое полезное
наблюдение привязывается к автору, source revision и code commit, публикуется как
observation. Авторизация source class/scope, structure, completeness и bounds
проверяются детерминированно. Native mission должна abstain на шуме/недостаточном
подтверждении; usefulness/source fidelity квалифицируются eval, а не вымышленным
per-fact confidence threshold.
Эта классификация usefulness/conflict делается native engine, не Router regex/LLM
extractor рядом с Hindsight.

Важно: pinned native dry-run возвращает fact text/type/time/entities/chunk index,
но **не** GitHub message IDs, CRUD target, product rule kind, confidence или
approval. Нельзя скормить mixed-author transcript и приписать все факты trigger
human. Для первого native selection selectable content — новая eligible human
revision, весь chronological thread/anchor — read-only context; native mission
ограничивает selection этим источником. Source revision и thread digest
фиксируются отдельно; contamination/negation проверяются eval. Native prompt
context не является enforced provenance proof. После qualification valid bounded
outputs разрешённого selectable source автоматически публикуются по policy.
Missing structural evidence или ambiguous CRUD target дают needs_input/suggestion;
Router не добавляет semantic verifier и не требует Save для каждого факта.

Бот/неавторизованный человек может сообщить evidence и влиять на понимание ответа,
но не становится approval actor. Сведения такого источника не повышаются до
авторитетного правила. Предлагаемая политика первого среза: automatic publication
только repo-local observations из verified human maintainer messages; ordinary
contributors участвуют в контексте, их durable suggestion требует подтверждения
maintainer. При расширении класса источников менять policy явно.

Automatic observation получает explicit policy-derived authority metadata:
standing policy revision, verified source actor/revision и exact selected-body
digest. Это не фиктивная human approval от автора на модельный текст. Existing
access/command owner получает узкий source-bound automatic-observation grant;
он не может публиковать rule/exception или другой scope. Explicit authored rule
по-прежнему содержит действительный maintainer decision/target authority.

Намеренное правило/исключение можно создать или изменить из естественной фразы
maintainer, когда intent, exact target/text и аудитория однозначны; его обычное
сообщение уже является authorized decision и отдельный Save не нужен. Одно
«у нас это сделано иначе» без явного намерения изменить правило сохраняет
наблюдение, не отменяет правило. Ambiguous/destructive target требует вопроса с
кандидатами; no-op и неуспех не маскируются под «запомнил».

## 4. Полный conversation snapshot

Source reader находится в server-side conversation feature; GitHub adapter читает
через App installation. Portable memory library получает neutral content/context,
не Octokit DTO. Checked snapshot содержит stable repository/PR/thread ID,
trigger ID/revision; все сообщения с stable actor ID, display login, actor kind,
createdAt/updatedAt, reply edges, body digest/body и visibility; code anchor
path/side/line/original position, commit/originalCommit и актуальные base/head.

1. Проверить signed event, активную installation, repository/PR/trust domain,
   current trigger и actor authority; webhook body — hint. Source-processing
   profile отдельно разрешает чтение bodies. Fork policy сохраняется.
2. Прочитать **все** страницы именно inline thread: root, humans/bots, предыдущие
   ответы Router. REST pagination существует; точную thread membership/cursor
   дополнить GraphQL там, где root/reply relation недостаточна. Chronology —
   createdAt + stable ID tie-breaker; updatedAt отдельно, не sort по ID.
3. Зафиксировать revision vector `(messageId, updatedAt, bodyDigest, replyTo)` и
   membership/anchor/head digest. После пагинации и перед первым inference/native
   admission перечитать thread membership и revisions **всех** контекстных
   сообщений, не только trigger. Перед durable/public effect ещё раз проверить
   vector и current authority. Наблюдаемая drift делает результат stale; нельзя
   записать его под новыми bytes. GitHub не даёт transactional thread snapshot:
   это bounded checked frozen read, не обещание атомарности между последней
   проверкой и внешним эффектом.
4. Одна повторная сборка разрешена в том же accepted processing record/deadline
   только пока input manifest **unbound** и не было ни native preview, ни
   product-model dispatch. После final coherent assembly manifest связывается
   однократно; после binding или любого dispatch он не заменяется, preview/model
   автоматически не повторяются. Stale result не применяется; требуется новая source revision или
   явно requested reprocess. Pagination failure, missing root, permission loss,
   unresolved coherence race — `context_incomplete`, без durable selection effect.
5. Delete tombstone достоверен по signed deleted event/current source inventory;
   404 без доступа не доказывает удаления. Удаление любого контекстного сообщения
   меняет vector; удаление selected source также отзывает его auto-derived set.

Убрать `.slice(-8)` и silent truncation. Первый срез обрабатывает только целиком
помещающиеся threads; все pages прочитаны, превышение **общего** input bound
обозначается `context_incomplete/oversized`, без last-N ответа с видом полной
истории. Финальная проверка размера включает instructions, schema, anchor/code,
полную историю, recalled memory и output reserve. Нативная cross-batch reduction
для oversized histories — future optional capability, не обязательный framework
первого среза. Она требует coverage/source/deletion qualification; Router semantic
summarizer не создаётся.

## 5. Один production путь и переиспользуемая LLM capability

### Выбранный App-first Gateway путь

Выбирается **managed App-first interaction caller**: уже есть Action OIDC/session,
App comment token, source identity и reply publisher. Сейчас Gateway provisioning
отклоняет `discussionMode != off`, а current reusable interaction восстанавливает
отдельный Codex secret: это bounded new Gateway profile, не готовая возможность.
Neutral review caller/workflow ABI не меняется. Server comment-webhook→worker
alternative рассмотрена и отклонена: текущий webhook игнорирует comment events,
worker inference/source/publication authority отсутствует, а Gateway run-access
API-private. Этот путь добавил бы custody/composition вместо переиспользования.

| Шаг                            | Existing owner → bounded change                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Canonical event caller         | S `workflow-provisioning/.../provision-reviewrouter-workflow.ts`, `domain/workflow-template.ts`: Gateway branch создаёт один `.github/workflows/reviewrouter-interaction.yml` caller на qualified immutable `A/.github/workflows/reviewrouter-interaction-reusable.yml` Gateway profile; `pull_request_review_comment` types created/edited/deleted. Снять только соответствующий Gateway rejection после profile availability |
| Event/provisioning eligibility | Existing App installation/permissions и workflow source attestation; existing App manifest не обязан подписываться на server comment webhook: события принимает Actions caller. Проверить actual installed caller, event types, exact runtime/ref и current permissions; no claim от одного YAML                                                                                                                               |
| OIDC + App identity            | A `main.ts` existing runtime-config exchange/comment-token path; S `features/action-control-plane/src/domain/action-control-plane.ts`, Prisma trusted reusable refs и API mutation source-admission owners квалифицируют точный Gateway interaction source/profile. Нельзя считать старый Codex verifier достаточным                                                                                                           |
| Accepted finite task           | Новый S product owner `packages/features/conversations/src/{domain,application,infrastructure,composition}` + `apps/api/src/action-conversation-routes.ts`: authenticated `/api/action/v2/conversations/process`, `/status`, publication receipt. Source refs/processing IDs, не raw arbitrary prompts/models. Existing Prisma metadata stores finite binding; no generic workflow engine                                      |
| Checked source + memory        | CP App source adapter получает current полный thread по trusted refs и выполняет coherence/audience checks; A full-thread DTO остаётся local client context, но client transcript/hash не authority. Existing memory access/bundle/receipt service получает conversation binder                                                                                                                                                |
| One model dispatch             | A `main.ts#runInteraction`/`github/discussion.ts` инжектируют conversation client вместо env-selected Codex. CP narrow plain text/JSON adapter (no ar/agent) → current selected account owner → existing SDK `Prepare`/`ExecutionClient.request/status`, finite conversation-purpose grant                                                                                                                                     |
| Durable memory                 | Existing `features-memory` permissions/CAS/commands и `apps/worker/src/memory-knowledge-worker.ts` доставляют frozen selected statements. Worker не получает source/inference/publication authority                                                                                                                                                                                                                            |
| App reply                      | A existing `github/discussion.ts` createReply/update + comment-token custody; immutable bounded reply envelope и stable marker связываются с accepted record. A сообщает publication ID/status CP; после unknown lookup/reconcile, no blind create retry                                                                                                                                                                       |

Gateway interaction branch не устанавливает Codex CLI, не восстанавливает
`CODEX_AUTH_JSON`, не выбирает `DISCUSSION_MODEL` и не использует workflow token
для publication. Account credential остаётся server-side. Server process route
bounded/deadline-aware; `/status` только читает/reconciles accepted effect, не
переигрывает paid call. Raw transcript не попадает в persisted request payload.

Deleted event через тот же caller/session вызывает metadata-only source revoke;
не запускает LLM ради отсутствующего body. Пропущенные edit/delete/access changes
выявляет current source/coherence read перед последующим inference/effect;
новая общая automatic-source applicability branch (§7) проверяет актуальность.
Current approved/manual predicate не проверяет upstream freshness и сохраняется
для maintained records. Нет нового polling service.

Production policy разделяет `automaticLearning` и `discussionReplies`.
Сконфигурированный backend по-прежнему default-on, explicit `disabled` сохраняется.
Новый contextual profile активируется после qualification; затем supported
configured repositories обрабатывают eligible informative maintainer messages
автоматически, без per-fact opt-in. `discussionReplies=off` и cap 5/thread,20/PR
подавляют publication, **не** разрешённое learning: caller/preflight запускается
если разрешён хотя бы один gate. Automatic learning off останавливает selection,
но не обязательно memory-aware ответы. До qualified profile provisioning не
обещает Gateway discussion; legacy credentials/workflow не становятся fallback.

### Простой text/JSON port и actual SDK reuse

Выбранный seam: `conversation use case → narrow application-owned text/JSON port
→ injected Account Gateway SDK adapter → existing Gateway/Sub2API → selected upstream`.
`TextInferencePort.generate` принимает messages/instructions, optional output
schema и RequestControls (absolute deadline/cancellation); возвращает text/JSON и
наблюдаемые model/usage/effect facts. Conversation use case **над этим портом**
валидирует и мапит свой intent/answer/CRUD-result; другие short product tasks могут
использовать тот же порт. Account/model/grants/policy bound в outer adapter, не
в общем request DTO. SDK DTO, provider JSON и SSE framing остаются infrastructure;
новый public universal codec, общая LLM package, task interpreter или inference
service не создаются.

**Новая plain capability не импортирует ar, agent-task/core protocol или bridge.**
Не нужны agent/CLI process, workspace, tools, session/turn API или agent loop.
`ar` request constructor сам не запускает агента, bridge вызывает injected handler;
но даже эта package/protocol связь здесь избыточна и отменена owner correction.
Existing agentic review/investigation/local ar consumers сохраняют собственных
owners, auth/cleanup/recovery contracts и не являются prerequisite нового вызова.

| Уже реализовано                                                                                                                                                  | Reuse и bounded missing work                                                                                                                                                                                                                                         |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vendored independent `@agent-teams/account-gateway` SDK: `Prepare`, `Admission`, request identity/limits, `ExecutionClient.request/status/close`, `GatewayError` | Переиспользовать existing transport/envelopes/errors/cancel/effect semantics. SDK не зависит от ar. `NativeRequest` передаёт `Uint8Array` approved native bytes, не agent-task DTO                                                                                   |
| Current Gateway/Sub2API Responses transport                                                                                                                      | Один bounded **OpenAI Responses SSE request**, который adapter собирает в один text/JSON result. SSE — формат транспорта, не agent loop. Enum SDK с другими protocols не доказывает их CP qualification; `stream:false`/ChatCompletions для этого среза не обещаются |
| CP `review-run-gateway-preparation.ts` и relay                                                                                                                   | Review-bound authority не переиспользовать как conversation permission. Под existing account owner добавить finite conversation binding; SDK extension только при доказанном missing control, не из-за нового purpose                                                |
| Existing description prompt-only call                                                                                                                            | Reuse owning transport/parsing knowledge и реальные limits; Action-private parser не deep-import в CP. Отдельные investigation tools/session/fencing сохраняют своих owners                                                                                          |

Adapter строит plain Responses envelope: messages/instructions, empty tools,
`tool_choice:"none"`, `stream:true`, `store:false`, default service tier, explicit
qualified output format и no previous-response continuation. Получает bounded
SDK stream, принимает только успешный terminal Responses event и locally valid
schema/text; tool calls/non-text/refusal/incomplete output не запускают runner и
не считаются валидным ответом. Каждая stream drained либо cancelled.
Output schema/name и actual-model alias, terminal usage/effect evidence,
cancel/deadline/byte limits квалифицируются для выбранного profile/model; native
wire restrictions (например `codex_output_schema`) не протекают в application DTO.
Ни SDK bytes contract, ни поле JSON schema не доказывают upstream compliance.

Invocation использует captured selected review connection/model текущей repository
policy. Router выдаёт independent finite `conversation` grant с собственными
operation/attempt/request IDs и server-owned limits; existing review lease не
расходуется заново. Custody/auth/refresh/quotas/selected account остаются у
provider-account/Gateway/Sub2API. Portable request не принимает reviewRequestId,
workspaceId, credentials/baseUrl/trusted flag; product binding — outer authority.

SDK `status` возвращает **effect/status/error, не model output/model/usage replay**.
После ambiguous paid dispatch readback reconciles только исходный request effect.
Если terminal answer потерян до фиксации existing bounded publication envelope,
результат `output_unavailable/unknown`; не re-infer/new attempt, не восстанавливать
его из status и не заводить output archive. Publication retry получает точные
bytes только если unresolved reply envelope уже был сохранён (§7).

Remote границы — actual Action→CP finite conversation task и existing CP→Gateway.
Public `/llm`/arbitrary upstream proxy не создаётся. First profile — existing
Gateway/Sub2API qualified Responses path; direct OpenRouter/Secrets/Hosted новые
capabilities доступны только после их отдельной qualification, без key fallback.

### Bound budgets до admission

Server-owned начальные limits уменьшаются captured transport/profile limits:
90s total processing deadline; ≤1 product model dispatch/source revision,
≤60s call; serialized input ≤128KiB, total captured SSE response ≤256KiB,
normalized result ≤16KiB. Request allowance/concurrency=1 и меньшие byte/deadline
limits задаются существующим `Prepare.limits`. Byte/capture bounds и cancellation
ограничивают local resource consumption; cancel/deadline не доказывают, что
upstream generation уже остановилась или платный effect отсутствует.

**2 048 output tokens — requested target и reserve при assembly, не доказанный
hard upstream cap/cost ceiling.** На pinned Codex OAuth native route удаляет
`max_output_tokens`; SDK deadline/response bytes/Gateway quota не эквивалентны
лимиту paid generation tokens. Проверять весь final input + requested output
reserve/overhead against supported context window; byte limit не token guarantee.
Hard token/spend ceiling можно обещать только profile, где existing native/provider
control действительно enforcement-qualified; иначе этот promise unavailable.
Обычный one-call profile не требует ради этого нового meter/proxy/native patch.
Usage/cost записываются только по наблюдаемой terminal evidence; unknown не refund.
Недостаточно declared request/input/window/quota budget — honest unavailable/
incomplete до dispatch, без truncation, меньшей модели или нового grant.

Native side имеет **отдельный service-funded** allowance: ≤1 semantic preview
call (≤25s, ≤4 facts), ≤2 bounded recall API calls по разрешённым scopes, без
reflection/batching в первом срезе; каждый nested call делит общий absolute
90s deadline. Native extraction profile использует effective context limit,
выходной bound и max model-attempt=1; selectable source должен помещаться в один
qualified extraction chunk. Input-size check сам по себе этого не обеспечивает.

**Новый native prerequisite `strict-preview`** нужен до contextual activation.
Pinned `fact_extraction.py` при `OutputTooLongError` автоматически делит chunk,
независимо от `max_retries=0`, а ниже split floor 500 chars может вернуть `[]`
как успех. Поэтому source-only audit/config не могут квалифицировать current pin.
В hardened native owner добавить узкий режим **только dry-run**: no autosplit,
transport retries=0 и content-validation retries=0, overflow/truncated/dropped
chunk → явный non-success, никогда complete empty/partial. Success с `[]` означает
настоящую завершённую abstention. Adapter допускает complete result только exact
qualified strict native image/config; старый endpoint/profile не объявляется strict.
Это поправка control/error semantics native extractor, не Router extractor и не
новый semantic algorithm; durable chunks storage profile/generation не меняются.
Режим реализовать в native extraction/HTTP dry-run owner; provider mapping остаётся
в `context-memory/src/hindsight/`, shared/domain DTO не принимает native settings.

Один focused native fixture форсирует overflow на source выше и ниже split floor:
строго один dispatch, error/incomplete, no second half, no successful empty и
никакого retirement старого set. Проверить zero native transport/content retries
на том же fixture. Narrow patch входит в existing preview estimate; если её
реализация требует иной semantic behavior, это новый scope decision.

Recall query не даёт implicit permission на дополнительные inference. Async chunks persistence не повторяет extraction;
background consolidation оплачивается по operator native limits/concurrency/token
ceilings и не расходует/не переиспользует review grant. Долгий background process
не оправдывает сообщение «сохранено» до qualified readback. Service и product cost
метрики сообщаются отдельно; native retry/budget qualification блокирует профиль,
если обнаружены неконтролируемые дополнительные calls.

## 6. Переносимая память без потери native возможностей

Существующий `MemoryCandidatePreview` — только объявленный port; production
Hindsight adapter его сейчас **не реализует**. Native dry-run endpoint существует,
но новый input/privacy/quality profile ещё не qualified. Existing owner проверен: `@reviewrouter/features-memory` private и product-specific;
Foundation memory boundary — tooling. Central catalog не объявляет готовый
provider-neutral memory runtime. Upstream Hindsight SDK переиспользуем, но
provider-specific и не выполняет новый portable contract. Поэтому latest owner
request обосновывает scoped successor старой формулировки «не нужен ещё один
wrapper»: нужен **один небольшой purpose-named package**, а не второй Router
feature. Рассмотрен также existing `777genius/infinity-context`: alpha memory product с
canonical Postgres и capture/approval pipeline, не provider-neutral Hindsight
mechanism; его второй semantic/canonical store сюда не подключаем. Bounded
discovery не доказывает отсутствия всех private libraries; подходящий maintained
owner, если обнаружен до package creation, расширяется вместо конкурента.

Предлагаемая новая единица `context-memory` (название/registry availability ещё
проверить) — отдельный library repository/subpackage у одного владельца. Файлы
`src/contracts.ts`, `src/capabilities.ts`, `src/hindsight/`, `src/index.ts` и
README; package не зависит от Router/Prisma/GitHub/Get Modular, ar/agent-task,
Gateway SDK или product text-inference port. Native engine вызывается через свой
adapter; product inference не инжектируется для повторения его семантики. TypeScript —
достаточный transport/mapping runtime; Hindsight Python остаётся upstream native
engine. Переписывание engine на TypeScript/Rust не даёт пользы этому срезу.

У consumers остаются application-owned narrow ports и anti-corruption mapping.
Library отдаёт **раздельные** capabilities:

| Capability                           | Смысл и honest limitation                                                                                              |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Source extraction preview            | Native useful facts, explicit input source binding; semantic fidelity qualified by eval, no per-fact proof/publication |
| Exact statement retain/replace       | Только frozen selected/approved text, stable document identity, honest operation; semantic extraction не повторяется   |
| Current source read/list             | Provider-owned current body/evidence для management/export; delivery envelope не является источником current text      |
| Recall                               | Scoped evidence and native ranking; derived evidence complete/incomplete                                               |
| Reflect                              | Только при native implementation: structured answer + evidence, не custom prompt emulation                             |
| Entry mutation/operation observation | Stable writable EntryRef отдельно от derived ObservationRef; expected revision задаёт caller owner                     |
| Invalidation/retirement              | Логическое исключение и статус; не обещает physical erasure                                                            |
| Forget qualification/receipt         | Adapter-specific cleanup proofs остаются implementation, public result честно cleanup_pending/completed                |

Не тащить Hindsight bank/retain strategy/mental-model DTO в Router domain. Вместо
universal options bag — narrow capability с реальным consumer и declared
guarantees; не поддерживается — явный unsupported при composition/qualification.
Native mission/custom instructions используются для preview. Optional raw-source
semantic retain/reflection — отдельные future capabilities, не включены в первый
transient profile и не эмулируются Router prompt-ами. Native факты/наблюдения не становятся writable
Router entries по совпадению строк.

Library переносит provider-neutral mechanism и нейтральные native mappings;
Router source permissions, automatic-learning policy, revocation epochs, metadata
commands и cleanup authority остаются в `features-memory`. Не переносить весь
Hindsight adapter механически: там есть approved policy и Router-specific scopes.
Existing full-forget identity ledger/drain не заменяются общим delete API.
Первый срез сохраняет durable `router-approved-v1` chunks storage profile и
нынешнюю generation: ≤1 000 chars/entry, exact body digest/kind/revision/scope/time
readback и current fact evidence остаются прежними. Новый semantic **input**
profile квалифицируется отдельно; не менять bank generation только ради preview.
Existing approved/manual records не переучиваются/не переклассифицируются. Если
реальное storage/readback изменение всё же необходимо, отдельный controlled
migration должен перенести eligible entries unchanged, stable handles/source
lineage suppression и pending/unknown/forget debt; без dual writer/fallback.
Упаковка/версионирование+один real Router consumer и disposable ordinary external
project с injected adapter/config входят **в ту же** delivery; без org credentials,
review IDs или production data. Не создавать второй production provider ради теста.

## 7. Conversation processing, source lineage и жизненный цикл

### Stable accepted identity до переменных inputs

Product owner хранит маленький accepted processing record в существующей app DB,
не generic workflow ledger. Уникальный ключ:
`repositoryStableId + threadStableId + humanSourceId + trustedSourceRevision + purpose`.
Source revision связывает updatedAt/body digest; stable source проверяется App read.
Этот ключ принимается **до** recall/native/model и до full snapshot fingerprint.
Webhook delivery ID — transport dedupe, не semantic key.

Сначала lookup accepted record: identity и fixed child IDs (`preview`, `model`,
`memory-set`, `reply`) принимаются сразу, а input manifest остаётся **unbound**
до final coherent source/context/budget assembly. Только до binding и любого
native/product dispatch допустима одна пересборка (§4). Затем однократно связать
thread vector/anchor, policy/audience/bundle eligibility и captured account/model/
bounds; дальнейшая drift не разрешает менять manifest или повторять inference.
Повтор того же source/purpose сначала восстанавливает/reconciles эти IDs и
возвращает recorded effect/status/доступный persisted unresolved output до чтения изменившихся
dependencies. Собственный reply,
новая память или чужой последующий comment не создают новый paid attempt.
Full snapshot/model/memory hashes — immutable inputs принятого record, не его key.
Изменение human source revision или явно authorized reprocess создаёт successor;
последний не обходит source suppression/unknown effect fences. После publication
purge settled replay возвращает IDs/hash/status; historical reply bytes больше
не обещаются. Current GitHub body можно прочитать отдельно с current permission,
но deleted/edited reply не разрешает regenerate/recreate старый effect.

### Один semantic extraction и exact persistence

Implementation refinement (2026-10-28): the one product inference is admitted
against the frozen recall receipt before automatic learning reserves its cohort.
Otherwise that learning's own scope-epoch change would invalidate the accepted
input and invite an incorrect recapture/retry. Learning remains independent of
missing/malformed product output and publication gates; selected facts help the
next turn. Obtained normalized reply/action decisions are frozen before their
dependent effects. See [ADR033](../decisions/033-conversational-memory-source-processing.md).

Publication refinement: the existing publication endpoint accepts a one-use
`dispatching` claim before the first App create. Frozen vector/head, source and
current publication authority, completed output/digest and original deadline must
match; atomic `ready→unknown` permits one create. Unknown/lost claim ACK is
reconcile-only. This completes the original model admission, without a new memory
admission, account/model recapture or extension of the recall receipt's TTL/hash.

1. Checked complete thread (§4), verified actor/source policy и audience-filtered
   memory; freeze context **до** inference admission. Public inline reply получает
   только те entries/derived evidence, раскрытие которых разрешено всем readers
   PR. Для public PR conservative first policy исключает private workspace/source
   memory, если metadata не доказывает disclosure eligibility. Применить это
   **до** LLM, не просить модель скрывать уже переданный secret.
2. Eligible informative human revision передать native dry-run **один раз** как
   selectable content; полный checked thread/anchor — labeled untrusted read-only
   context. Native mission выбирает значимые поддержанные новым turn факты либо
   abstains. Schema/bounds/source identity/permission проверяет Router; source
   fidelity/usefulness — native profile quality по eval, не nonexistent confidence
   score/per-turn proof и не второй semantic verifier.
3. Успешный **полный** preview frozen: максимум 4 selected statements, каждый
   nonempty ≤1 000 chars, без Router summary/truncation. Переносим text, native
   fact type/optional dates/entities как declared preview information; в первом
   durable profile пишем только exact text, trusted statement/update timestamp и
   product source metadata. Semantic entities/event-date/native world/experience
   fidelity в chunks persistence **не обещается**. Invalid/overlimit/unknown/
   partial selection не считается успешным empty result и не перезапускает preview.
   Применяется только qualified native strict-preview (§5): current pin без fix
   не может доказать complete empty и к этому переходу не допускается.
4. Frozen selected statements → existing product authority/CAS commands → existing
   `router-approved-v1` **chunks** exact persistence/replace. Raw thread не входит
   ни в retain `content`, ни `context`, ни metadata/async payload. Второй semantic
   retain запрещён. Native engine затем сам выполняет consolidation/dedup/recall.
   Application `kind=observation` — bounded writable source entry; derived native
   `ObservationRef` — отдельный read-only result с evidence, не CRUD target.
5. Когда нужен ответ/CRUD, один existing structured conversation inference
   понимает intent и возвращает
   `answer | clarify | effect_notice | silent` + bounded authorized action intent;
   он не повторно извлекает/deduplicates facts. Полезная информация без вопроса
   может учиться молча; вопрос и однозначный natural CRUD получают ответ/status,
   когда publication разрешён. Права/target/CAS проверяются product step, model
   JSON не разрешает CRUD сам. Obvious contextual target разрешается из известных
   handles; уточнение только при реальной ambiguity.
6. Reply text и semantic action result фиксируются до внешних effects. Success
   notice строится deterministic renderer из фактических operation statuses:
   queued/processing, published/readback, unknown, revoked-for-new-admissions,
   cleanup_pending/completed. Не хранить raw model prose/prompt долгосрочно:
   bounded immutable reply output существует только как unresolved publication
   envelope, purged после подтверждённой App публикации/terminal resolution;
   hashes/IDs/status остаются для replay. Не генерировать новый текст на retry.

### Selected set и suppression без semantic matching

Расширить existing source cursor/metadata в `features-memory`: stable source
lineage `(workspace, repositoryStableId, sourceType, sourceId)` **без generation**,
current checked revision, selected auto-entry IDs, source-state/suppression epoch.
Generation-specific native bindings остаются отдельно. Никакого source text или
semantic blacklist. Set принадлежит source, а не номеру chunk/dry-run fact ID.

Для accepted complete revision создать до 4 новых deterministic child entry IDs
из processing ID+index frozen result; не угадывать old/new соответствие по тексту.
Metadata transition отзывает admission прежнего auto-set и записывает новый
**pending cohort** с checked revision/source epoch. Child commands/verified
readbacks записывают native evidence, но **не делают children body-visible**.
Только одна atomic metadata activation при всех verified readbacks переводит
полный current cohort в active. Проверяются current source/cohort ID/epoch,
expected ownership и suppression; superseded/partial/unknown cohort не активен.
Late child callback не может активировать старый cohort по одному entry CAS.
История `2→1→0`: internal replacement withdraws старый cohort, retiring native
children, новый complete cohort активируется целиком; successful empty selection
активирует empty set без native empty document. Unknown/failed/partial →
`needs_refresh`, не successful empty. Проверенная изменённая source revision
исключает прежний auto-set из новых admissions, но не означает успешной замены.

Maintained manual rules/authorized exceptions и explicitly maintained observations
не принадлежат automatic replacement set. Explicit authorized content update auto
handle атомарно **detach/promote** его в maintained ownership с command reservation
и source/cohort membership change; kind остаётся observation, если отдельно не
авторизовано rule/exception. Internal retire CAS проверяет прежние automatic
ownership/source/cohort и expected entry revision; он не может убрать явно
исправленный handle. Это deterministic ownership transfer, не semantic matching.

**Причина retirement имеет authority.** Internal source replacement/expiry cleanup
withdraws cohort и retires children без user-suppression epoch. Только explicit
authorized user retire/forget (или достоверное selected-source delete) создаёт
bodyless lineage suppression. Narrow trusted cause хранится в source transition/
command metadata; model prose и native retire не могут определить его сами.
Поэтому после обычного `2→1→0` следующий source edit остаётся learnable, а после
explicit retire — блокируется до explicit authorized relearn.

До clearing `metadata.source` при forget сохранить bodyless lineage suppression.
Проверять его перед native/paid work и снова при durable admission. Explicit user
retire/forget auto-entry запрещает re-learning source lineage через edits, новые
entry IDs/replay/generation. При multi-fact source suppress весь source для
**нового learning**; прочие уже действующие siblings не удаляются без запроса.
Explicit authorized relearn снимает suppression отдельной policy transition;
обычный replay/edit — нет. Similar independent sources не блокируются semantic
blacklist; existing complete-forget drain/history/late-callback fences сохранены.

### Одна automatic-source applicability для всех context consumers

Current `approved-memory-source-applicable.ts` намеренно не перечитывает source:
позднее edit/delete не отменяет maintained human-approved statement; at-commit
records могут быть exact-head only. Эту семантику **не менять** для старого профиля.
Новый product-owned branch `memory-source-applicability.ts` различает automatic
source-bound entry и maintained record; App source adapter, а не portable engine,
проверяет current selected source refs.

Перед freeze bundle (в том числе при recall из **другого thread**) batch-check
выбранные automatic source IDs/revisions/availability вне grant transaction,
в рамках общего deadline. Changed/deleted/unavailable source обновляет cursor,
вызывает source/cohort eligibility epoch bump и исключает entry **и все derived
evidence**, которые от него зависят. Failed source check не считается fresh.
Серверный receipt содержит checked source/cohort ID/epoch плюс имеющиеся
scope/entry/approval/generation/binding facts. Он не утверждает atomic GitHub read;
coherence/freshness проверена в указанное время, existing issued-lease rule сохраняется.

Один общий automatic-entry predicate требует checked current revision, matching
current active cohort/epoch, verified complete activation, current authority и
отсутствия revocation. Применить его к current-body/list/runtime bundle/derived
source validation и bodyless receipts. Существующие management semantics могут
показывать inactive metadata с honest state, но не объявляют pending тело current.
`memory-knowledge-service.ts`, Prisma access/store и
`apps/api/src/review-memory-admission.ts` должны использовать эту ветвь; ordinary
review, conversation, investigation и description проверяют receipt epoch под
**теми же memory-scope/source locks в authoritative grant transaction**. Никакого
GitHub/native I/O под locks, отдельного poller или consumer-specific retrieval.
Source transition/complete activation/explicit suppression/detach сериализуются
по тем же owners; superseded callbacks не clear новые epochs.

**Across-head policy:** сохранить `observedCommitSha` automatic repo observation.
Source-current active auto entries могут использоваться на следующем head только
как `historical` context, с original observed commit/time, без claim о нынешнем
коде. Тот же policy mapping применяется к native-derived evidence и всем tasks.
Existing records/profile, требующие exact-head/current-code applicability,
сохраняют этот фильтр; consumer проверяет actual code/diff прежними средствами.
Не убирать observed commit ради обхода фильтра и не строить ancestry/semantic
invalidation engine. Это admission successor, не storage migration.

| Событие/ошибка                                     | Обязательное поведение                                                                                       |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Redelivery после собственного reply+learning       | Lookup того же accepted record, прежние child IDs/output/status; no new dispatch                             |
| Non-trigger edit/delete при unchanged trigger/head | Vector drift → stale/incomplete, no effect из mixed context                                                  |
| Trigger edit                                       | Новая source revision; prior auto-set перестаёт подходить freshness; complete replacement либо needs_refresh |
| Out-of-order event                                 | Trusted current source cursor; arrival time не authority                                                     |
| Delete selected source                             | Bodyless suppression + immediate source-derived admission revoke; maintained rule не удалять молча           |
| Permission/access loss                             | Revoke eligible context; 404 не объявлять deletion                                                           |
| Ambiguous correction/forget target                 | Native recall candidates + clarification; не первый semantic match                                           |
| Forget                                             | Existing immediate body-read fence и identity-bound drain/history cleanup; suppression переживает completion |
| Late callback/unknown                              | Не clear newer fence; reconcile original identity, no hidden retry/refund/fallback                           |

Reply caps/mode проверяются только на publication этапе. Learning policy и native
budget имеют собственные gates; cap-exhausted informative turn всё ещё выбирает
полезные observations. Bots остаются контекстом, никогда новым approval actor;
собственная paraphrase Router не становится selectable source.

## 8. Investigation, description и OCR: один контекст, разные права

Review freeze/admission — уже существующий owner. Вынести **только общую**
подготовку authorized memory context и rendering fragments из consumers;
task adapters остаются разными. Bundle capture bounded и fail-open для обычного
review при disabled/unavailable; mutation authority при этом fail-closed.

**Investigation: включить.** Добавить immutable memory input в
`ReviewTurnRequest`/turn prompt и seed/manifest, провести через actual
`production-t0-review-runner.ts`, replay и tool/agent adapters. Убрать намеренный
`investigation ? null` только после server capability/manifest update. Знание —
labelled contextual evidence: правило показывает ожидаемое поведение, observation
имеет observed commit; оно не становится доказательством, что текущий код такой.
Существующая authoritative investigation grant transaction должна проверять
bodyless receipt/current eligibility атомарно перед новым grant, не отдельным
best-effort preflight. При replay новая admission проверяет source/revocation eligibility; старый hash
никогда не обозначает другие bytes. Открытое исполнение с уже выданной lease
сохраняет accepted immutable input по ADR031, без мнимого refund.

**PR description: включить read-only, отдельной audience policy.** Разрешены
repo-local/shared approved facts только если их можно раскрыть аудитории PR;
private workspace memory не попадает в публичную description автоматически.
Audience filtering применяется **до inference admission**, как для inline reply;
нельзя передать private text и надеяться на output redaction. Никакой memory learning из сгенерированной description и обратной self-reinforcing
петли. Memory объясняет термины/решения, но модель описывает только фактически
разрешённые изменения PR. Добавить hash/eligibility в existing companion
manifest/lease и safe provenance; бюджет и primary selected account сохраняются.
Memory unavailable — description без памяти либо пропуск по существующей policy.

**OCR:** повторно проверить actual installed source/schema и outgoing request,
поскольку поле в Router DTO не доказывает, что CLI его понимает. Известный fix
PR349 преобразует legacy `{id,content}` в native `{path,rule,merge_system_rule}`
только при memory. Native/OCR research report и pinned evidence приведены в §12;
они подтверждают delivery для своих cases, но выявили integrity prerequisite §2/9. Не предполагать наличие native OCR long-term learning или
discussion memory по этому request shape. Review→OCR rules delivery и durable
memory lifecycle — разные owners. Context merge должен сохранить skills/rules
precedence и exact provider-observable hash, не расширить prompt policy молча.

DRY экономия — единые scope selection, applicability, immutable memory bundle,
status/command semantics, account binding и portable engine mapping. Отдельные
prompt formatting и task audience policies намеренно не сливаются. Оценка ниже
считает интеграцию всех трёх consumers, не только legacy discussion.

## 9. Последовательные slices и точные владельцы

Все следующие paths — target changes, не claim о наличии новых файлов.

| Срез                                      | Изменения и owner                                                                                                                                                                                                                                                          | Критерий завершения                                                                                                                                                        |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0. Source-processing successor            | Новый S ADR; §3 этого плана; native input/privacy fixture, authority defaults и budgets                                                                                                                                                                                    | Raw transient processing и automatic observation разрешены явно; old approved profile/default/disable сохранены                                                            |
| 0a. OCR integrity                         | A `tools/ocr/patches/`, build/qualification manifest; native `internal/agent/agent.go` main/plan template owner                                                                                                                                                            | One-pass original-template substitution; optional blocks до data insertion; all literal placeholders сохраняются; new immutable artifact/profile и exact CLI qualification |
| 1. Portable memory                        | `context-memory/src/{contracts,capabilities,hindsight,index}.ts`, README; S `memory-knowledge-provider-port.ts`, composition/anti-corruption adapter                                                                                                                       | Native preview once + exact current source read/list/write/operation semantics; real Router + external disposable consumer; no product deps                                |
| 2. Actual Gateway conversation entrypoint | S `workflow-provisioning` caller renderer/provisioning; `action-control-plane` source attestation/Prisma trusted refs; A reusable interaction Gateway branch, `main.ts`, `github/discussion.ts`; S new conversation feature/routes/API composition                         | Exact App-first caller enters finite purpose-authorized process/status route; plain Responses SDK adapter без ar/agent; selected account/model/cancel/effects qualified    |
| 3. Full inline source/context             | S conversation application `conversation-source-port.ts`, infrastructure App source reader; existing `github/github-memory-source-verifier.ts` remains metadata-only for old profile; A `discussion/types.ts`/client mapping                                               | All pages/authors/revisions/anchor, full vector coherence and final input budget; explicit incomplete/oversized behavior                                                   |
| 4. Learning/reply/replay                  | S conversations stable accepted record + `features-memory` source cursor/lineage/CAS/commands/worker; A existing App publisher + CP receipt adapter                                                                                                                        | Informative turn learns without Save independently of reply caps; fixed effects/output; set 2→1→0, suppression survives edit/generation; truthful status                   |
| 5. Other actual consumers                 | A investigation application/turn prompt/adapters, `production-t0-review-runner.ts`, `pr-description-generation.ts`, `control-plane/review-memory-v2.ts`; S investigation grant transaction, `review-memory-wire.ts`, review/description receipt binder/contracts/admission | Separate investigation/description grants atomically admit exact task-eligible memory; audience before inference; no duplicated retrieval                                  |
| 6. Paired release                         | Owning protocol/semantic descriptors and generated A artifacts; workflow/profile attestation, Foundation seams/reject fixtures, ops docs                                                                                                                                   | Focused gates + disposable Gateway-only interaction E2E without provider secrets + native model eval before enable                                                         |

Первый coherent slice: полный fitting thread → eligible memory recall → native
preview once → existing exact chunks → следующий contextual ответ выбранным
review account. Тот же accepted record содержит silence/effect status. Initial
lifecycle/admission/cohort/suppression fences обязательны **до enable**; последующее
расширение correction/forget UX и остальных consumers не даёт исключения из них. Не оставлять старый
несовместимый conversation writer активным на той же Gateway конфигурации.
Already admitted review runs сохраняют прежний contract; task capabilities
активируются только для exact qualified caller/runtime. Банк/profile/generation
не мигрируют без фактического storage incompatibility (§6).

Native OCR fix — bounded prerequisite, не Router escaping/blacklist. После patch
проверить обычную template expansion, literals во всех replacement values, actual
plan/main с noSkills и exact-path Skills, второй main round и затронутую compression
boundary. Current exact-path selection/additive built-ins сохраняются; noSkills
inventory не объявляется exact allowlist. Existing review admission/restoration
не переписываются: issued lease может завершить immutable input, restore не
получает новое inference право под старым hash.

## 10. Проверки и EVALS по реальным рискам

Не тестировать каждую DTO-функцию/helper. Доказательства выбираются по риску
перепутать authority, account, tenant, историю или факт эффекта.

| Риск                                            | Минимальное независимое доказательство                                                                                                                                                                      |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Вход реально недоступен Gateway                 | Disposable repo с installed canonical interaction caller, OIDC и App publication; informative created/edited, deleted source, reply-off learning; ни одного provider secret/legacy auth шага                |
| История обрезана/смешана                        | Paginated fixture >100 сообщений/разные actors/bots/decisive old turn, non-trigger edit/delete на ранней page при unchanged trigger/head; actual final model/native input и revision vector                 |
| Утечка через model input                        | Public inline reply **и** description не получают private workspace/source facts; internal allowed task получает их; derived evidence проходит ту же source audience policy                                 |
| Source/account/authority forgery                | Existing real adapter reject cases repo/workspace/fork/access/actor mismatch, bot policy edit, adjacent repo, quota/revoked connection; no dispatch/write                                                   |
| Self-induced duplicate                          | Первый event учит и публикует reply; затем redelivery при изменившихся thread digest/memory epoch. Lookup old record/output/effects; no second preview/model/retain/publication                             |
| Selection двойная или изменилась                | Real native transport: one dry-run, frozen ≤4 selected statements, async retain только exact chunks; readback digest/time/body неизменны, no raw context/job data. Consolidation calls учитываются отдельно |
| Source-set edit/forget                          | Existing PG concurrency fixtures: 2→1→0 complete selection, unknown/partial selection, drift и late callback; forget→source edit→fresh entry ID→generation migration не обходят bodyless suppression        |
| Status выдуман                                  | Real native/API queued→verified published, invalid output/unknown/failed child, retire/forget pending/completed; deterministic notice отражает stored effect                                                |
| Transcript retained                             | Canary bodies в actual CP/native/Gateway logs, errors/traces, outbox, async native payload, publication envelope purge/export; input profile disabled при недоказанном transient guarantee                  |
| Budget/window                                   | Near-window complete thread + nonempty memory + schema/overhead/output reserve; bounded preview/recall cumulative deadline and service budget exhaustion; no truncation/fallback/re-dispatch                |
| Portable только на бумаге                       | Packed ordinary external consumer без Router/org imports/credentials, current read/list/write + explicit unsupported capabilities                                                                           |
| Investigation/description/OCR пропускают memory | Actual T0/turn/companion requests, authoritative grant receipts и manifests; actual OCR plan/main/literal integrity + existing Skills/noSkills fixtures                                                     |
| Forget не полный                                | Existing provenance-aware drain/history/restart proof, source lineage и derived evidence; immediate exclusion и absence после restart                                                                       |

Дополнить уже запланированные fixtures: internal 2→1→0→new edit против explicit
retire suppression; one readback+one unknown child и late superseded callback;
explicit update auto handle→old-source replace; pre-bind rebuild против post-native
drift. Missed edit/delete event из thread A при recall в B исключает auto fact/derived
evidence, но оставляет maintained rule. Two-head case сохраняет original commit и
historical label, затем исключает stale source. Это existing PG/source/native
fixtures, не новые helper suites.

### Маленький корпус и заранее заданные инженерные цели

Checked-in synthetic/de-identified corpus: **48 целых threads**, 32 tuning и
16 protected hold-out, примерно 120–180 labeled human events и 80–120 expected
eligible facts. Hold-out разделяется **по thread/repository scenario**, не по
отдельным сообщениям; отдельные парафразы того же сценария не пересекают split.
Labels: eligible fact/text support, source actor/revision, scope/target, forbidden
write, acceptable answer/evidence/clarification/silence, desired effect status.
Не создавать generic eval platform: fixtures + тонкий runner + results table.

Каждый `run/build + compared variant + repository scenario` получает fresh isolated
disposable product records, native scopes/banks и source/processing IDs. Continuity
сохраняется только внутри одного A→B→authorized mutation→B scenario. Target fact
отсутствует перед A и не seed из oracle labels; variants и tuning/hold-out не
наследуют retained/derived state, accepted records или prior command effects.
Fixture namespace и cold-start precondition записываются в existing results table.
Использовать existing disposable setup/cleanup, не production reset API; повторный
replay старого effect не является проверкой изменённой extraction реализации.

RU/EN cases: informative non-command context, transient вопрос/шум, повтор,
negation/quoted bot evidence, «да, это исключение» с prior turn, current code vs
rule/observation, два maintainer с несогласием, ordinary contributor context,
ambiguous update/forget, useful silent learning при reply caps/off, длинная
история/edit/delete, публичная audience, template literals, follow-up recall.

Внутри тех же 48 threads выделить **8 linked repository scenarios (16 threads)**:
5 pairs в tuning, 3 pairs в protected hold-out, целиком одним split. Thread A
содержит informative non-command eligible assertion, Thread B — позже/на другом
head — не содержит её в raw history/code и требует retained fact для полезного
ответа. В protected pairs покрыть обычное learning, replies off, cap-exhausted
silent learning. Каждый A должен дойти до qualified published/readback и active
cohort; каждый B — получить source-backed recalled fact в actual input и правильно
использовать его с temporal/source label. No-memory baseline честно abstains либо
отмечает отсутствие сведений; hallucination не считается полезным ответом.
Как минимум один protected pair продолжается authorized update/retire/forget и
повторным B: после заявленного effect state старое знание не используется.

**Decisive release gates:** все protected A→B witnesses и after-mutation follow-ups
проходят, отдельно counts для non-command/silent-learning facts/events; critical
non-command recall ≥80% и silent/off/capped recall ≥80% в каждом из tuning/hold-out,
0 неавторизованных effects. Aggregate ≥80% recall не компенсирует failure этих
slices. Answer rubric требует нужный fact/source/temporal status и различает
appropriate abstention от лишнего clarification; exact prose/chain-of-thought
inspection/ещё один verifier call не нужны. Это labels и scenario rows внутри
existing corpus/runner allowance.

Default gates фиксируются **до tuning**, не требуют ещё одного owner confirmation:

| Метрика и denominator                                                                                                      | Стартовая цель                                       |
| -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Retained-fact precision: supported correct facts / все опубликованные facts                                                | ≥95%                                                 |
| Eligible-fact recall: корректно сохранённые labeled facts / все eligible facts                                             | ≥80%                                                 |
| Event harmful-write rate: events с ≥1 unsupported/wrong-scope fact / events с durable effects                              | ≤5%, при этом blocking authority cases ниже всегда 0 |
| Exact actor/source/target attribution: корректно привязанные effects / все effects                                         | 100% на blocking cases; ≥95% на общем corpus         |
| Supported-answer pass: human rubric pass / events, где нужен ответ                                                         | ≥90%                                                 |
| Unnecessary clarification и unnecessary reply: лишние / соответствующие labeled decision opportunities                     | ≤10% каждый                                          |
| Unauthorized/wrong-tenant/wrong-actor/destructive false effect; breach реально enforced request/byte/deadline/quota bounds | 0 blocking cases                                     |

Показать counts и denominators: небольшой hold-out не доказывает population
reliability. Сравнить current parser/no-memory baseline, native-selection-only
и full product отдельно. Record exact native image/model/profile/mission/common
prompt/connection class и corpus revision, product vs service latency/cost.
Tune по tuning errors, затем один planned hold-out checkpoint; failed hold-out
становится regression case, а новый protected набор добавляется из других whole
threads перед повторным qualification. Не подкручивать mission на hold-out и
выдавать повторный результат за независимый.

Править native mission/common task prompt по измеренной ошибке; Router semantic
confidence/verification fallback не добавлять. Deterministic 11 CLI/350 tests
проверяют delivery/contracts, не эти targets.

На реализации — focused changed-owner suites, protocol generate/check/handoff при
contract change, Foundation memory boundaries и package typecheck/build; перед
paired release обязательные действующие repo gates. Docs-only — format/diff/link
checks. Live native selected-model eval и App-first disposable Gateway interaction
E2E нужны перед enable; этого документа/локального mocked HTTP недостаточно.

## 11. Объём, альтернативы и оставшиеся решения

LOC — добавленный/существенно изменённый production/integration код **всего этого
плана сверх existing Hindsight baseline**. Перенос existing строк, generated/vendor
artifacts не считаются новым кодом. Tests/evals отдельно; это не размер существующего
subsystem и не выполненная работа.

| Срез                                                           | Incremental prod/integration LOC | Targeted tests/evals LOC |
| -------------------------------------------------------------- | -------------------------------: | -----------------------: |
| Portable memory + preview/current source mappings              |                          500–850 |                  250–400 |
| Gateway interaction wiring/finite authority + actual LLM reuse |                        650–1 050 |                  300–500 |
| Checked full-thread source/vector/budget input                 |                          300–500 |                  150–300 |
| Learning/reply/set replacement/replay                          |                        650–1 100 |                  300–550 |
| Investigation/description/OCR consumer integration             |                          300–550 |                  200–350 |
| Lineage/suppression metadata, rollout/operational adapters     |                          260–550 |                  100–280 |
| Native OCR one-pass integrity remediation                      |                           40–100 |                  100–220 |
| **Total этого среза сверх baseline**                           |                  **2 700–4 700** |          **1 400–2 600** |

First useful coherent slice ≈1 500–2 400 prod и 750–1 250 tests/evals **внутри**
total. Optional native per-account Gateway attribution bridge — ещё **250–500 prod,
150–300 tests**, не обязателен первой реализации; при его выборе total становится
**2 950–5 200 / 1 550–2 900**. Narrow strict-preview native control/error fix включён в existing preview row;
не меняет total. Native OCR/strict-preview new image/config/patch qualification,
packaging/release, human corpus labels, privacy/canary время — вне LOC.
Если transient source fidelity/budget требует retained raw history или нового native
поведения, остановить этот расширенный scope и переоценить, не спрятать platform
в contingency. Confidence medium; существующие mechanisms могут уменьшить код.

| Вариант в одинаковом feature scope                                        | Уверенность /10 | Достижимая надёжность /10 | Сложность /10 | Решение                                                                                         |
| ------------------------------------------------------------------------- | --------------: | ------------------------: | ------------: | ----------------------------------------------------------------------------------------------- |
| Narrow TS text/JSON port + existing Gateway/Sub2API SDK + portable memory |               8 |                         8 |             5 | Выбран; реальные privacy/quality/admission требуют qualification                                |
| SDK Hindsight только внутри Router                                        |               9 |                         8 |             3 | Не покрывает concrete multi-project/provider-neutral need                                       |
| Server comment-webhook→worker executor                                    |               7 |                         8 |             7 | Отложен: новые inference/source/publication/custody composition вместо готового Action App path |
| Новый service/универсальная platform                                      |               4 |                         6 |             9 | Нет demonstrated process/failure boundary                                                       |
| Свой semantic extractor/consolidator                                      |               3 |                         5 |             9 | Противоречит owner vision                                                                       |

Это engineering judgments, не measured availability. TypeScript подходит для
existing bindings; mature upstream Python engine оставляет семантику у его owner.
Новый native runtime/FFI/языковой rewrite не нужен.

Оставшиеся конкретные implementation решения не блокируют написание/проверку плана:

1. Final package name/registry/repository/license; `context-memory` proposed,
   не claimed installable product. Existing suitable maintained owner предпочтителен.
2. Exact qualified native input/model/mission profile и no-raw logs/payload proof.
   Initial representation/storage уже выбрана: one preview → frozen statements →
   existing exact chunks/generation; без bank migration ради нового input.
3. Captured Gateway conversation limits/compatibility в existing Prepare/request
   contract; extension SDK только при доказанном missing control. No paid retry.
4. Optional native bank-attributed account bridge — separate bounded spike; native
   service funding/egress в первом срезе раскрыты, customer OAuth не копируется.
5. Broadening eligible sources beyond verified human maintainers — future policy
   decision. Current supported default automatic learning уже реализуем без Save;
   ordinary contributor/bot evidence учитывается в ответе, не присваивает authority.

## 12. Независимая критика и source evidence

Завершены **3 rounds × 3 независимых reviewer = 9 reviews**, все на
**gpt-6.1-sol, xhigh**, как исследователи и writer, по explicit owner choice.
R1/R2 запросили исправления; R3 architecture/native и lifecycle — APPROVE FOR
PLANNING, product/eval — один narrow P2, закрытый isolated-fixture правилом §10.
Это не утверждение, что все девять одобрили исходную revision, и не acceptance
реализации/native image/model/deployment. Reports: `tmp/memory-conversation-plan/`.

| Round / reviewed revision                       | Независимый reviewer                                             | Findings → disposition                                                                                                                                                                                               |
| ----------------------------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1 / `c5ba9f81bcde0e465e8fb2a51336534adbecb94c` | Architecture/shared inference/DRY (`r1-architecture.md`)         | REVISE: actual Gateway entrypoint → выбран canonical managed interaction, server-worker alternative рассмотрена/отклонена; actual ar/Gateway reuse → §5; accepted identity → §7; audience до LLM → §7/8              |
| R1 / тот же commit                              | Native memory/authority/portability (`r1-native.md`)             | REVISE: один preview→exact chunks; no nonexistent confidence proof; bodyless cross-generation lineage suppression; bounded 2→1→0 source set; unchanged storage profile/generation → §3/6/7                           |
| R1 / тот же commit                              | Product/history/evals/minimalism (`r1-product-eval.md`)          | REVISE: whole-thread coherence vector; stable replay; learning отдельно от reply gates; complete/empty/unknown source sets; corpus hold-out+denominators+targets; final assembled/cumulative budgets → §4/5/7/10     |
| R2 / `a772403e262ed1a064789dded074b37d922cc1cd` | Lifecycle/replay/authority (`r2-lifecycle.md`)                   | REVISE: internal retirement vs explicit suppression; complete cohort activation/read+grant gate; explicit update detaches auto handle; early identity/unbound manifest; settled replay IDs/status после purge → §4/7 |
| R2 / тот же commit                              | Product/evals/OCR (`r2-eval-product.md`)                         | REVISE: linked A→B memory-dependent witnesses, non-command/silent-learning critical-slice gates и after-mutation recall внутри48threads → §10; OCR scope/evidence сохранены                                          |
| R2 / тот же commit                              | Architecture/native/DRY (`r2-architecture-native.md`)            | REVISE: native strict-preview no-split/false-empty prerequisite; one shared automatic-source applicability и live checks; across-head auto observations only historical с observed commit → §5/7                     |
| R3 / `63c56cbd6137f19ccbd3ae0c6f847e96c7f06ea9` | Architecture/native/portable reuse (`r3-architecture-native.md`) | APPROVE FOR PLANNING, 0 new/residual material findings; existing native/privacy/App-first gates сохранены                                                                                                            |
| R3 / тот же commit                              | Lifecycle/authority/DRY (`r3-lifecycle.md`)                      | APPROVE FOR PLANNING, 0 new material findings; brief first-slice editorial clarification: initial fences обязательны до enable → §9                                                                                  |
| R3 / тот же commit                              | Product/eval/evidence (`r3-eval-product.md`)                     | REVISE narrow P2: fresh product/native namespaces и cold preconditions для run/build×variant×scenario; no prior-run/label/cross-split state → правило добавлено §10; scope/LOC unchanged                             |

### Post-R3 owner clarification: ordinary inference без ar

После опубликованной revision `66878bc663e45949a70ac5aa1477e48da4fe9017` owner
уточнил, что ordinary model calls должны идти через существующий Sub2API без
обязательной связи с ar. §1/5/6/9/11 исправлены: narrow application text/JSON port
и independent Gateway SDK→Sub2API, no ar/bridge/task codec/agent runtime в новом
plain profile или portable memory library. Historical 9-review ledger выше не
переписан и не выдаётся за review этого последующего dependency решения.

Два focused source checks на **gpt-6.1-sol/xhigh**, не новый formal 3-round review:

| Check                                 | Проверенные exact inputs и disposition                                                                                                                                                 |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ar-dependency-followup.md`           | ar `83a7329f4383b05ac5c39356b79f82f029182d42`: constructor/bridge сами не spawn agent, но новая package/protocol связь избыточна; existing consumers остаются, новый plain path без ar |
| `sub2api-plain-inference-followup.md` | Independent SDK native bytes/Admission; one Responses SSE call; status не output replay; Codex OAuth strips output token cap → §5; no live dispatch/readiness claim                    |

Дополнительный scope/package/service/tests/LOC не добавлены. Existing selected
account/auth/quota/purpose grant/cancel/unknown и native strict-preview/OCR
prerequisites сохранены. Source checks подтверждают design seam, не выполненную
conversation implementation или production activation.

Источники проверены по exact inputs; current API existence не означает qualification:

- S source links далее используют [PR729 head](https://github.com/777genius/review-router-ai/tree/a75789fc2b4cf7476d247a4b0023390307191781),
  A — [PR349 head](https://github.com/777genius/review-router/tree/8734b1dff5439bdd52d0150602cb933a123ca386).
  Docs worktree base и открытый статус PR указаны в §2; deployment не проверен.
- Ранее рассмотренные, **не dependency нового plain profile**: [ar app-facing bridge](https://github.com/777genius/ar/blob/83a7329f4383b05ac5c39356b79f82f029182d42/docs/agent-task-bridge.md),
  [task contracts](https://github.com/777genius/ar/blob/83a7329f4383b05ac5c39356b79f82f029182d42/src/agent-task/task-codec/domain/agent-task-contracts.ts).
  Gateway exact archive — [vendored SDK](https://github.com/777genius/review-router-ai/blob/a75789fc2b4cf7476d247a4b0023390307191781/vendor/account-gateway/agent-teams-account-gateway-0.1.0-codex-models-6eb715faf907.tgz);
  consumer-owned [review preparation](https://github.com/777genius/review-router-ai/blob/a75789fc2b4cf7476d247a4b0023390307191781/apps/api/src/review-run-gateway-preparation.ts).
- Follow-up direct transport provenance: SDK archive SHA256
  `6eb715faf9076d5962713c9cb0f2af5296548f293c1efd620fae22e50143710a`;
  [SDK source](https://github.com/agent-teams-ai/account-gateway/blob/f08ba6386fcb9d6a9f0fe20c146ca167bbd39222/packages/account-gateway/src/features/facade-client/http/ingress.ts),
  [Gateway Responses validation](https://github.com/agent-teams-ai/account-gateway/blob/75f75c8397f7d3ceb2d5ff2b5c591de4a4b6bbe9/services/account-gateway/src/facade-ingress.ts),
  [Sub2API direct Responses transport](https://github.com/agent-teams-ai/sub2api/blob/66f59ebbca525f2b7046b3e3e1fe6363761a4fde/backend/internal/service/native_gateway_responses.go),
  [Codex OAuth output-cap removal](https://github.com/agent-teams-ai/sub2api/blob/66f59ebbca525f2b7046b3e3e1fe6363761a4fde/backend/internal/service/native_gateway_oauth_dispatch.go).
  `provider-connections-provenance.json` records `productionActivated:false`;
  filename hash prefix не source commit, source pin не deployment proof.
- Hindsight **v1.1.0 `a5a619b5ca59c5c39e0f96be6f7a31fabd136bd5`**:
  [dry-run API](https://github.com/vectorize-io/hindsight/blob/a5a619b5ca59c5c39e0f96be6f7a31fabd136bd5/hindsight-api-slim/hindsight_api/api/http.py),
  [semantic extraction, prompt/context и chunks](https://github.com/vectorize-io/hindsight/blob/a5a619b5ca59c5c39e0f96be6f7a31fabd136bd5/hindsight-api-slim/hindsight_api/engine/retain/fact_extraction.py),
  [ExtractedFact fields](https://github.com/vectorize-io/hindsight/blob/a5a619b5ca59c5c39e0f96be6f7a31fabd136bd5/hindsight-api-slim/hindsight_api/engine/response_models.py),
  [native consolidation](https://github.com/vectorize-io/hindsight/blob/a5a619b5ca59c5c39e0f96be6f7a31fabd136bd5/hindsight-api-slim/hindsight_api/engine/consolidation/consolidator.py),
  [config allowlist](https://github.com/vectorize-io/hindsight/blob/a5a619b5ca59c5c39e0f96be6f7a31fabd136bd5/hindsight-api-slim/hindsight_api/config.py),
  [bank attribution](https://github.com/vectorize-io/hindsight/blob/a5a619b5ca59c5c39e0f96be6f7a31fabd136bd5/hindsight-api-slim/hindsight_api/engine/bank_attribution.py).
  Source availability подтверждена; current Router approved chunks profile не
  qualified semantic preview/selected-model quality.
- OCR upstream **`8eb83340a487b1150af00701b94f01af97e4b4d6`**, native
  [main/plan renderer](https://github.com/alibaba/open-code-review/blob/8eb83340a487b1150af00701b94f01af97e4b4d6/internal/agent/agent.go),
  [compression owner](https://github.com/alibaba/open-code-review/blob/8eb83340a487b1150af00701b94f01af97e4b4d6/internal/llmloop/compression.go).
  Audited rr.4 binary SHA256 `0553daafe39d7a9d7608f0d37b26d55c11d07b9d5bbfc5b36b0778f9cd9f3df5`,
  patches digest `22286440592c8e256482b938842a77fd9252b3e2615532af9ea7ec634174c2b3`;
  [qualification manifest](https://github.com/777genius/review-router/blob/8734b1dff5439bdd52d0150602cb933a123ca386/tools/ocr/qualifications/review-skills-v1.manifest).
  Diagnostic probe observed substitution in both actual requests; desired-behavior
  regression ещё должна быть inverted после native fix. Live model не запускалась.

Native/reuse report `native-reuse-audit.md` и OCR `ocr-deep-audit.md` сохраняют
research details; `ocr-placeholder-probe.json` — bounded synthetic request summary.
Большие raw outbound prompt artifacts не коммитить. Maintained standard/catalog
blob IDs и accepted ADR links находятся в §2/3. Ни один report не меняет production
configuration, source authority или разрешение на deployment.
