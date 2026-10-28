# Контекстное обучение из обсуждений и общий вызов LLM

Дата: 2026-10-28. Статус: **план следующего среза, не реализованная возможность**.
Начальная версия для независимой критики; реализация и production activation в
эту работу не входят. Исторические accepted ADR и план 23.10 не переписываются.

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

Общий вызов LLM — небольшая переиспользуемая capability для structured text
inference. Локальные TypeScript-компоненты вызывают порт в процессе. HTTP endpoint
появляется только на существующей реальной границе Action↔control plane/Gateway.
Выбранные review account/model используются там, где конкретный transport это
поддерживает. Credentials, quota, admission и исполнение по-прежнему принадлежат
существующим владельцам. Ни новый endpoint, ни одинаковое имя модели не дают
права обойти account authorization.

Поставляемое разделение:

| Ответственность                                                                         | Владелец                                                                   |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Семантическое выделение знаний, consolidation/dedup, temporal/conflict handling, recall | Нативный memory engine; сначала Hindsight                                  |
| Понимание разговора и формирование ответа                                               | Discussion use case + выбранная LLM capability; использует engine evidence |
| GitHub source identity/revision, доверие, разрешённая аудитория, право изменения правил | Router product owners                                                      |
| Команды, CAS, replay, operation status, revocation/forget fences                        | Существующий memory feature и его durable metadata                         |
| Переносимый engine mechanism, capabilities и provider mapping                           | Один отдельный небольшой library owner; без GitHub/workspace policy        |
| Account selection, custody, auth, quota, paid dispatch и usage                          | Существующие provider-account/Gateway/ar owners                            |

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
(прочитан через GitHub, blob `5b292039…`),
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
нового профиля. Это scoped successor §5–7 плана 23.10, raw-ingress clauses ADR018
и approved-source-only clauses ADR031. Старые документы остаются историческими.
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
   не сохраняет transcript. Существующие purge/deletion obligations сохраняются.
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
observation. Авторизация source class и scope проверяется детерминированно до
effect; low confidence, краткоживущая болтовня и неполная evidence не публикуются.
Эта классификация usefulness/conflict делается native engine, не Router regex/LLM
extractor рядом с Hindsight.

Важно: pinned native dry-run возвращает fact text/type/time/entities/chunk index,
но **не** GitHub message IDs, CRUD target, product rule kind, confidence или
approval. Нельзя скормить mixed-author transcript и приписать все факты trigger
human. Для первого native selection selectable content — новая eligible human
revision, весь chronological thread/anchor — read-only context; native mission
ограничивает selection этим источником. Source revision и thread digest
фиксируются отдельно; contamination/negation проверяются eval. Если native
evidence не позволяет установить источник однозначно, needs_input/suggestion,
без auto-publication. Router не добавляет второй semantic extractor, чтобы
восстановить отсутствующее доказательство.

Бот/неавторизованный человек может сообщить evidence и влиять на понимание ответа,
но не становится approval actor. Сведения такого источника не повышаются до
авторитетного правила. Предлагаемая политика первого среза: automatic publication
только repo-local observations из verified human maintainer messages; ordinary
contributors участвуют в контексте, их durable suggestion требует подтверждения
maintainer. При расширении класса источников менять policy явно.

Намеренное правило/исключение можно создать или изменить из естественной фразы
maintainer, когда intent, exact target/text и аудитория однозначны; его обычное
сообщение уже является authorized decision и отдельный Save не нужен. Одно
«у нас это сделано иначе» без явного намерения изменить правило сохраняет
наблюдение, не отменяет правило. Ambiguous/destructive target требует вопроса с
кандидатами; no-op и неуспех не маскируются под «запомнил».

## 4. Полный conversation snapshot

В A application вводится `ConversationSourceReader` с GitHub adapter; portable
memory library получает neutral source messages, не Octokit DTO. Snapshot:
stable repository/PR/thread ID, trigger comment ID/revision, все сообщения с
stable actor ID + display login + actor kind, createdAt/updatedAt, reply edges,
body digest, body, visibility; code anchor path/side/line/original position,
commit/originalCommit и текущее base/head. Удалённый source представляется
tombstone только при достоверном delete event/повторной проверке; 404 без права
доступа не является доказательством удаления.

Порядок работы:

1. Проверить App installation, repository, PR, trust domain и trigger actor через
   текущую server authority; payload — hint. Разрешить body reading только новому
   source-processing profile. Fork policy не обходится ради ответа.
2. Прочитать **все** страницы current inline thread, включая root, replies всех
   humans/bots и собственные предыдущие ответы. REST pagination уже есть;
   дополнить точной thread membership/GraphQL thread cursor там, где REST root
   relation недостаточна. Не смешивать другие threads одного PR.
3. Детерминированно упорядочить по createdAt, stable ID как tie-breaker; сохранить
   updatedAt отдельно. Разрешить reply edges и current/outdated anchor. Повторно
   проверить trigger revision и head перед effects; источник изменился —
   discarded snapshot/new processing revision, не прежняя команда с новыми bytes.
4. Snapshot содержит completeness result: complete или safe reason/cursor/counts.
   Pagination error, permission loss, missing root, unknown edit race — incomplete.
   Сервис не пишет durable memory и не делает destructive resolution из
   incomplete snapshot. Ответ честно ограничен имеющимся контекстом/просит retry.
5. Убрать `.slice(-8)` и silent body truncation. Сначала проверить полный размер
   against captured model context and policy byte/token ceilings. Если помещается,
   ответ строится по всему snapshot. Если не помещается, native engine обрабатывает
   историю пакетами с source/revision и связывает evidence; ответ получает native
   recall/reflection evidence и coverage metadata. Не вводить Router semantic
   summarizer и не объявлять кусок истории полной историей.

Для длинного thread нужна доказанная native coverage семантика: каждый message
revision обработан, native reduction учитывает старые уточнения/отрицания, reply
может запросить недостающий source segment через ограниченный reader. Если native
version не может доказуемо покрыть историю в разрешённом transient profile,
результат `context_incomplete`, а не last-N response с видом полной уверенности.
Первый срез может честно ограничить **общий максимальный размер обрабатываемого
thread**, но обязан загрузить все pages и явно сказать о превышении; это не
ограничение «последние N». Расширение на oversized histories — native capability,
не собственный summarization engine.

## 5. Общая LLM capability и действительная authority

Проверен pinned `777genius/ar@83a7329f4383b05ac5c39356b79f82f029182d42`:
package exports `agent-task`, `provider-codex`, `openai-compatible-codex` и
`provider-claude`; `src/provider-codex/app-server/application/app-server-client.ts`
владеет Codex process/thread/turn execution. Это пригодный existing runtime
mechanism для соответствующих adapters, **не** готовый общий Sub2API SDK. Selected
Gateway уже используется через `@agent-teams/account-gateway/{contracts,http}`
в S `review-run-gateway-model-settings.ts`, `review-run-gateway-relay.ts` и
`review-action-v2-production-composition.ts`. До изменения подтвердить exact
public SDK contract у его owner; расширить нужную missing capability там,
не создавать одноимённый вымышленный runtime API. Новая portable structured task
capability — proposed extension; из наличия process client её готовность не следует.

Реальные consumers — review structured calls, discussion и description; agentic
investigation сохраняет `ReviewAgentPort` с tools/session/cancel/fencing. Общая
часть — prepared input, structured response, deadline/cancel, model attribution,
usage/error/effect status. Не загонять различающиеся задачи в `Provider.review()`
или один интерфейс с двадцатью optional methods.

Иллюстрация переносимого local contract, окончательная форма у владельца runtime:

```ts
interface StructuredInference {
  invoke(
    input: {
      invocationKey: string;
      messages: readonly ModelMessage[];
      responseSchema: JsonSchema;
      maxOutputTokens: number;
    },
    controls: {
      deadlineAt: Date;
      signal?: AbortSignal;
    },
  ): Promise<InferenceResult>;
}
```

Bound implementation уже имеет разрешённые account/model/limits; portable request
не принимает secret, arbitrary baseUrl, reviewRequestId, workspaceId, provider
bankId или «trusted=true». Он не создаёт admission сам. Result различает complete,
invalid output, unavailable, cancelled и unknown external effect, содержит actual
model/usage только при подтверждённых данных. Tools не разрешены в prompt-only
capability. Повтор после unknown dispatch не выполняется автоматически.

Router adapter связывает invocationKey/purpose с существующим captured selected
account/lane, paid grant/lease, immutable manifest, repository trust и usage.
Review-specific IDs нужны в **этом adapter/remote authorization envelope**, а не
в независимом library contract. Новый discussion request получает отдельную
конечную authority и budget у текущего account owner: старый завершённый review
lease нельзя повторно использовать. Model/account selection и fallback не живут
в discussion prompt. Если connection удалён/сменился/не даёт нужной capability,
ответ unavailable; существующие команды могут работать без LLM.

При реальном remote вызове расширить existing Gateway task dispatch contract
небольшим purpose-specific profile/capability и server-owned bounds. Не добавлять
public `/llm` с arbitrary models/keys. Endpoint является transport adapter того
же port, не новым источником полномочий. App-first/OIDC, quota/account custody,
UNKNOWN receipts и release ABI остаются у прежних owners. Scope transport
документа: Account Gateway/Sub2API выбранный production path; explicit direct
OpenRouter — отдельный разрешённый режим, не fallback. Его новые capabilities
сначала unavailable, пока его конкретные auth/spend/effect гарантии не
квалифицированы. GitHub Secrets/Hosted не активируются по наличию credentials.

## 6. Переносимая память без потери native возможностей

Existing owner проверен: `@reviewrouter/features-memory` private и product-specific;
Foundation memory boundary — tooling. Central catalog не объявляет готовый
provider-neutral memory runtime. Upstream Hindsight SDK переиспользуем, но
provider-specific и не выполняет новый portable contract. Поэтому latest owner
request обосновывает scoped successor старой формулировки «не нужен ещё один
wrapper»: нужен **один небольшой purpose-named package**, а не второй Router
feature. До реализации проверить maintained repositories ещё раз; найденный
подходящий owner расширяется вместо создания конкурента.

Предлагаемая новая единица `context-memory` (название/registry availability ещё
проверить) — отдельный library repository/subpackage у одного владельца. Файлы
`src/contracts.ts`, `src/capabilities.ts`, `src/hindsight/`, `src/index.ts` и
README; package не зависит от Router/Prisma/GitHub/Get Modular. TypeScript —
достаточный transport/mapping runtime; Hindsight Python остаётся upstream native
engine. Переписывание engine на TypeScript/Rust не даёт пользы этому срезу.

У consumers остаются application-owned narrow ports и anti-corruption mapping.
Library отдаёт **раздельные** capabilities:

| Capability                           | Смысл и honest limitation                                                                               |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| Source extraction preview            | Native useful facts из допустимого source, evidence attribution, no claimed publication                 |
| Source retain/replace                | Native extraction и lifecycle с stable source/document identity, returned operation                     |
| Recall                               | Scoped evidence and native ranking; derived evidence complete/incomplete                                |
| Reflect                              | Только при native implementation: structured answer + evidence, не custom prompt emulation              |
| Entry mutation/operation observation | Stable writable EntryRef отдельно от derived ObservationRef; expected revision задаёт caller owner      |
| Invalidation/retirement              | Логическое исключение и статус; не обещает physical erasure                                             |
| Forget qualification/receipt         | Adapter-specific cleanup proofs остаются implementation, public result честно cleanup_pending/completed |

Не тащить Hindsight bank/retain strategy/mental-model DTO в Router domain. Вместо
universal options bag — narrow capability с реальным consumer и declared
guarantees; не поддерживается — явный unsupported при composition/qualification.
Native mission/custom instructions/reflection могут использоваться adapter-ом,
когда обеспечивают контракт. Native факты/наблюдения не становятся writable
Router entries по совпадению строк.

Library переносит provider-neutral mechanism и нейтральные native mappings;
Router source permissions, automatic-learning policy, revocation epochs, metadata
commands и cleanup authority остаются в `features-memory`. Не переносить весь
Hindsight adapter механически: там есть approved policy и Router-specific scopes.
Existing full-forget identity ledger/drain не заменяются общим delete API.
Упаковка/версионирование+один real Router consumer и disposable ordinary external
project с injected adapter/config входят **в ту же** delivery; без org credentials,
review IDs или production data. Не создавать второй production provider ради теста.

## 7. Conversation use case и жизненный цикл

Последовательность одной source revision:

1. Build checked complete conversation snapshot + actor authority/context policy.
2. Получить разрешённую память через existing scope/admission service, freeze
   exact bytes/hash/eligibility и native provenance. Устаревшее или revoked
   исключается до следующего inference admission, не после prompt assembly.
3. Native selection/related recall определяет полезные сведения и возможные
   correction targets. Discussion inference понимает вопрос и готовит ответ;
   memory mutation исполняется отдельным application step по authority policy.
   Model JSON сам не является разрешением вызвать CRUD.
4. Create/update разрешённой observation или однозначной authorized rule;
   ambiguous target → clarify; retire/forget только при конкретном target и
   authority. Mutation идёт через existing CAS/durable commands, не прямо SDK.
5. Reply render получает **фактический effect status**: queued/processing —
   «принято в обработку», published/readback — «сохранено», unknown — неопределённо,
   retirement — исключено из новых admissions, forget cleanup_pending — ещё не
   физически удалено. При no durable knowledge обычный ответ остаётся обычным.
6. Существующий App-owned publication adapter создаёт/обновляет reply; результат
   LLM не получает publish token. Ограничения reply rate/count сохраняются.

Reply idempotency и memory idempotency — разные эффекты. Маркер reply с hash
одного comment body недостаточен для conversation: обработка зависит от thread
revision, anchor, policy и memory eligibility. Metadata fingerprint включает
source revision/full snapshot digest, target revision, selected profile и
semantic command digest; не хранит transcript. Одна принятая версия не порождает
дубликат при webhook redelivery. После crash reconcile прежнюю command/paid
dispatch identity; не запускать платный inference заново по одному timeout.

| Событие/ошибка                                             | Обязательное поведение                                                                                                                           |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Redelivery того же event/revision                          | Вернуть прежний effect/status; не повторять retain или reply                                                                                     |
| Edit source до publication                                 | Проверить актуальную revision; старый result не публиковать под новой версией                                                                    |
| Edit после publication                                     | Новая revision и native replace/reprocess с прежним source identity; автоматически не редактировать unrelated/manual rule                        |
| Out-of-order event                                         | Trusted current source revision/cursor определяет новизну; arrival time не authority                                                             |
| Delete source                                              | Немедленно прекратить новое admission source-derived knowledge; native cleanup/retire по scope policy, explicit maintained rule не удалять молча |
| Permission/access loss                                     | Revoke eligible context; unavailable provenance не выдавать за «текст удалён»                                                                    |
| Correction «это уже неверно» с несколькими related entries | Native recall даёт кандидатов; уточнить ID/text/target, не выбирать первый semantic match                                                        |
| Forget                                                     | Установить existing fence сразу; drain/identity-bound cleanup и verified receipt по complete-forget owner                                        |
| Late native completion после fence                         | Не восстанавливать видимость; reconcile уже существующие unresolved effects                                                                      |
| Unknown paid/model/native outcome                          | Честный unknown, bounded reconciliation; без hidden retry/fallback                                                                               |

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
При replay новая admission проверяет source/revocation eligibility; старый hash
никогда не обозначает другие bytes. Открытое исполнение с уже выданной lease
сохраняет accepted immutable input по ADR031, без мнимого refund.

**PR description: включить read-only, отдельной audience policy.** Разрешены
repo-local/shared approved facts только если их можно раскрыть аудитории PR;
private workspace memory не попадает в публичную description автоматически.
Никакой memory learning из сгенерированной description и обратной self-reinforcing
петли. Memory объясняет термины/решения, но модель описывает только фактически
разрешённые изменения PR. Добавить hash/eligibility в existing companion
manifest/lease и safe provenance; бюджет и primary selected account сохраняются.
Memory unavailable — description без памяти либо пропуск по существующей policy.

**OCR:** повторно проверить actual installed source/schema и outgoing request,
поскольку поле в Router DTO не доказывает, что CLI его понимает. Известный fix
PR349 преобразует legacy `{id,content}` в native `{path,rule,merge_system_rule}`
только при memory. Конкретное schema и CLI доказательство дополнит native/OCR
research report. Не предполагать наличие native OCR long-term learning или
discussion memory по этому request shape. Review→OCR rules delivery и durable
memory lifecycle — разные owners. Context merge должен сохранить skills/rules
precedence и exact provider-observable hash, не расширить prompt policy молча.

DRY экономия — единые scope selection, applicability, immutable memory bundle,
status/command semantics, account binding и portable engine mapping. Отдельные
prompt formatting и task audience policies намеренно не сливаются. Оценка ниже
считает интеграцию всех трёх consumers, не только legacy discussion.

## 9. Последовательные slices и точные владельцы

Все следующие пути — target changes, не claim о наличии новых файлов.

| Срез                           | Изменения и owner                                                                                                                                                                                                                                | Критерий завершения                                                                                                 |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| 0. Contract successor          | Новый S ADR/source-processing profile; этот план; narrow native qualification fixture                                                                                                                                                            | Решены transient persistence/authority/model egress; existing profile неизменён                                     |
| 0a. OCR integrity prerequisite | Native rr.4 owner `internal/agent/agent.go` template substitution; bounded actual CLI outgoing regression + exact Action artifact requalification                                                                                                | Memory placeholders остаются literal bytes; no second expansion; прежний request schema/skills precedence сохранены |
| 1. Portable memory             | `context-memory/src/{contracts,capabilities,hindsight,index}.ts`, README; S `memory-knowledge-provider-port.ts`, composition and anti-corruption adapter                                                                                         | Real Router + external disposable consumer, no product deps; native effects/readback/error semantics preserved      |
| 2. LLM reuse                   | Existing runtime/SDK owner narrow structured inference capability; A `discussion/codex-responder.ts`, `main.ts`; S `review-run-gateway-*` task authorization where remote                                                                        | Один selected account/model, конечный отдельный grant/usage; no new generic server                                  |
| 3. Full inline source          | A `github/discussion.ts`, `discussion/types.ts`, new `discussion/application/conversation-source-port.ts`, `discussion/infrastructure/github-conversation-source.ts`; S `github/github-memory-source-verifier.ts` отдельный body-profile adapter | All pages/authors/revisions/anchor; explicit incomplete/oversized behavior                                          |
| 4. Learning + reply            | New A `discussion/application/process-conversation.ts`; S existing `memory` domain/access/service/store + `action-memory-v2-routes.ts`, replay/worker                                                                                            | Informative maintainer message learns without Save, answers recall; rule/destructive actions preserve authority     |
| 5. All actual consumers        | A `review-investigation/application/{review-agent-port,review-investigation-turn-prompt}.ts`, investigation adapters, `production-t0-review-runner.ts`, `pr-description-generation.ts`; S review contracts/admission/description                 | Investigation + description verified exact memory bytes and task audience, no duplicated retrieval                  |
| 6. Paired rollout              | Generated contract authority S `packages/features/action-control-plane` + owning semantic descriptors; paired A generated artifacts, Foundation seams/reject fixtures, operations docs                                                           | Focused gates + real disposable E2E + live native model eval before enable                                          |

Сначала vertical slice «полный допустимый thread → existing memory recall →
ответ выбранным account → native learning observation → следующий ответ использует
его»; затем destructive corrections/forget и other consumers. Не выпускать
параллельно несовместимые writers. Новые optional capabilities backward-compatible
для already admitted runs; если меняется persisted source identity, нужен explicit
metadata migration/cursor/rollback, не смена document ID без cleanup.

## 10. Проверки и EVALS по реальным рискам

Не тестировать каждую DTO-функцию и helper. Тестировать границы, где можно
перепутать власть, деньги, tenant, факт сохранения или историю.

| Риск                                              | Минимальное независимое доказательство                                                                                                                                        |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Полная история незаметно обрезалась               | GitHub paginated fixture >100 сообщений, разные humans/bots, старое decisive уточнение вне последних 8, edit/delete/outdated anchor; verify actual model input/coverage       |
| Forged source/actor или чужая память              | Real authority adapter reject cases: repo/workspace/fork/access/actor mismatch, revoked source, bot policy edit, adjacent repo; no retained content/effect                    |
| Дубликат после replay/crash                       | Existing PostgreSQL command/worker concurrency fixtures: same revision once, changed bytes same ID conflict, edit races, lost ACK/unknown without second paid/native dispatch |
| «Saved» без эффекта                               | Real native process/API fixture: queued→published readback, invalid schema, partial/failed child, unknown, late completion after retire/forget; status wording assertions     |
| Утечка transcript                                 | Canary bodies across actual API/native logs, failed job/operation payloads, outbox/audit/export/errors; prove transient contract or keep new profile disabled                 |
| Contract только кажется portable                  | Packed ordinary external project без Router/org imports/credentials + same native adapter conformance fixtures                                                                |
| Same account заявлен, фактически другой           | Actual SDK→Gateway→admitted native transport fixture: selected account/model/usage/effect correlation; quota/auth denial before dispatch, cancellation/unknown no fallback    |
| Memory потерялась в investigation/description/OCR | Actual production T0 prepared requests + manifests/receipts, exact same bytes/hash for admitted task; actual OCR CLI outgoing request verifies understood native fields       |
| Забытое воскресло                                 | Existing complete-forget proof + new extracted source ancestry, zero-fact/derived/shared observation cases; exclude immediately and after restart                             |

EVALS — отдельный небольшой версионированный corpus, с ручным oracle и rubric,
а не assertions, сгенерированные той же моделью. Cases RU/EN: полезный контекст
без команды; transient вопрос; уже известный повтор; contradiction/updated code;
rule vs observation/exception; два maintainer с несогласием; bot injection; ordinary
contributor useful evidence; ambiguous update/forget; длинный mixed-author thread;
deleted/edited source; memory-aware follow-up и публичная description.

Измерять learning precision и recall **раздельно**, ошибочное повышение observation
до policy, верность source/target attribution, recall relevance, ответ с evidence,
честность effect status, latency/cost. Сравнить current parser/no-memory baseline,
native engine selected configuration и полный product path. Перед release corpus
и thresholds фиксируются владельцем: policy/tenant/destructive false-positive —
0 в blocking fixtures; общая usefulness/reply quality оценивается human review,
с отдельными error buckets. Не выдавать 11 deterministic CLI tests за модельное
качество. Prompt/native mission меняются по обнаруженной ошибке, затем повторяется
затронутый eval set; без собственного semantic fallback.

На реализации запускать focused suites соответствующих owners, protocol generate/
check/handoff при contract change, Foundation memory boundary fixtures и package
typecheck/build; перед paired release — обязательные repo gates по действующим
scripts. Docs-only delivery требует format/diff/link checks, не запуска всего
production CI ради Markdown. Live native model canary и App-first disposable PR
нужны до активации, не входят в текущую работу без deploy доступа.

## 11. Объём, альтернативы и нерешённые вопросы

LOC — оценка **добавленного/существенно изменённого** production/integration кода
для всего этого плана сверх проверенного Hindsight baseline, без переноса строк
между файлами, generated artifacts и vendor source. Это total следующего среза,
не размер уже существующего memory subsystem. Tests/evals указаны отдельно.

| Срез                                                                      | Production/integration LOC, incremental | Targeted tests/evals LOC |
| ------------------------------------------------------------------------- | --------------------------------------: | -----------------------: |
| Portable memory capability + native mappings                              |                                 500–900 |                  250–450 |
| Общая LLM capability + authorized bindings                                |                                 350–650 |                  200–400 |
| Full thread source/versions/completeness                                  |                                 350–650 |                  200–350 |
| Conversational orchestration, learning authority, truthful replies/replay |                               700–1 100 |                  350–600 |
| Investigation/description/OCR integration                                 |                                 300–550 |                  200–350 |
| Source-processing metadata/rollout/operational adapters                   |                                 250–450 |                  150–300 |
| **Всего сверх baseline**                                                  |                         **2 450–4 300** |          **1 350–2 450** |

First useful coherent slice (portable/native minimum + checked complete fitting
thread + recall/reply + automatic observation) ориентировочно 1 300–2 100 prod и
650–1 100 tests/evals **внутри указанного total**, не дополнительно. Переиспользование
existing runtime primitive уменьшит LLM строку; обнаруженная обязательная native
patch/retained-history profile потребует переоценки, не скрытого удвоения scope.
Release/packaging, threat/privacy qualification, human eval labels и canary время
не измеряются LOC.

| Вариант в том же scope                                                   | Уверенность /10 | Достижимая надёжность /10 | Сложность /10 | Решение                                                              |
| ------------------------------------------------------------------------ | --------------: | ------------------------: | ------------: | -------------------------------------------------------------------- |
| Existing TS ports + маленькая portable memory library + native Hindsight |               8 |                         8 |             5 | Выбран; фактические privacy/quality гарантии требуют qualification   |
| Только provider-specific SDK внутри Router                               |               9 |                         8 |             3 | Не удовлетворяет concrete multi-project/provider-neutral requirement |
| Новый service/универсальная LLM+memory platform                          |               4 |                         6 |             9 | Нет отдельного failure/process need; не выбран                       |
| Свой semantic extractor/consolidator                                     |               3 |                         5 |             9 | Противоречит owner vision; не выбран                                 |

Оценки — engineering judgment, не измеренная availability. Нативный upstream engine
сильнее новой реализации в другом языке для extraction; TypeScript bindings
соответствуют existing runtime. Дополнительный native runtime/FFI не нужен.

Перед implementation slice 1 закрыть только конкретные решения:

1. Подтверждённый existing reusable owner или final package/repository name;
   registry/license/release coordinates. Пока `context-memory` — proposed, не
   installable claimed product.
2. Pinned native extraction guarantee: полезность, source attribution, raw
   persistence/logging и безопасный full-thread/large-thread path. Dry-run/chunks
   сами по себе не отвечают на это. Нет доказательства — feature unavailable.
3. First profile source class: рекомендация verified maintainer observations,
   repo-local; broader ordinary-contributor auto-learning требует явного policy
   решения, а не замены «automatic learning» на manual-only.
4. Existing ar/Gateway owner точного common inference extension и capability
   matrix по выбранным account transports; review-bound authority остаётся в
   adapter. Неподдержанный route не получает credential fallback.
5. Native LLM/embedding model-egress и transient против retained profile; это
   конкретное privacy решение, не повод менять все source ingress endpoints.
6. Task audience policy для description и inclusion/replay policy investigation;
   проверяется перед first admission, а не только при render.

## 12. Независимая критика и evidence

Начальная версия записана до трёх требуемых critique/fix rounds. Здесь будут
зафиксированы round reports, существенные corrections и остаточные ограничения.
До завершения этих rounds статус не меняется на reviewed.

Исследовательские отчёты располагаются в
`tmp/memory-conversation-plan/`: owner request, native/reuse source audit, deep
OCR delivery audit. Они — рабочая evidence, не substitute для commit-pinned
источников в окончательной версии. Native/API existence, local deterministic
execution, live quality и deployment readiness в отчётах различаются явно.
