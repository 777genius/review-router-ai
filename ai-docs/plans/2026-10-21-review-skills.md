# Review Skills — подробный план реализации

**Статус:** план прошёл три последовательных раунда критики; все три направления GO на 3fbeabb. Реализация и локальная квалификация завершены, включая свежий browser 7/7 и настоящий OCR. [Результаты и границы проверок](./2026-10-21-review-skills-implementation.md); полный удалённый CI отслеживается отдельно в PR.
Дата: 2026-10-21. [SaaS PR #635](https://github.com/777genius/review-router-ai/pull/635) · [Runtime PR #297](https://github.com/777genius/review-router/pull/297).
Ветка обоих репозиториев: `feat/review-skills-20261021`, отдельные worktrees.

## 1. Пользовательский результат и границы

В workspace появляется **Skills непосредственно перед Memory**. Три поля редактора: название, описание, Markdown-инструкции; явный Save. В таблице видны источник, автор и репозитории текущего workspace, где используется скилл. Изменение одного оригинала применяется ко всем следующим ревью подключённых репозиториев.

В списке репозиториев: выбрать один/несколько/все текущие результаты → Manage skills → Add или Remove → таблица скиллов с пустыми operation checkboxes и отдельным Assigned k/N → Apply. Add добавляет недостающие связи, Remove снимает выбранные; другие связи не заменяются. В библиотеке обратный вход Repositories вызывает те же серверные команды.

Из другого workspace подключается **живая canonical ссылка**. Содержание редактирует только исходный автор, пока он состоит в исходном workspace. Администраторы управляют разрешением использовать, а не получают право переписывать текст. Личный аккаунт и организация используют одну модель workspace.

OCR — первый обязательный consumer. Native reviewer использует тот же neutral captured contract. Пользователь не настраивает формат под движок.

### Включено

- Web library, редактор, неизменяемые ревизии, CAS конфликт, import/export текстового SKILL.md.
- Прямые source grants, destination links, revoke/unlink и назначения repository manager.
- Capture целого набора перед новым admission; immutable retry; authorization до cache lookup.
- Git Skills из явно подключённых корней `.reviewrouter/skills`, `.agents/skills`; bounded Markdown references из exact trusted base.
- OCR real-parser fix, точные пути и inventory, native parity, cache identity и provenance.
- Реальные PostgreSQL, Next/browser, OCR binary loopback проверки; общий generated contract; scoped Get Modular/Foundation gates.

В первой версии нет scripts/dependency installation/MCP grants из скиллов, marketplace, транзитивного sharing, двусторонней Git/web sync, ручных Publish/semver, переноса авторства, архивирования и миграции всего проекта на новый framework.

### Baseline

| Область      | Проверенная версия                                                   |
| ------------ | -------------------------------------------------------------------- |
| SaaS main    | bb277462bed5135a838b20d07eeae69034562bd8                             |
| Runtime main | 9e494fb9b8809dc5c91c9f4159edcca13b89fbde                             |
| OCR upstream | 8eb83340a487b1150af00701b94f01af97e4b4d6; managed binary 1.13.1-rr.3 |
| Get Modular  | Core/Assembly0.7.0; Conformance0.5.0                                 |
| Dev tools    | Engineering Foundation2.1.0; Feature Module Standard0.2.2            |

Registry availability проверена. Exact versions фиксируются lockfiles. Новый TS дополнительно проверяется TS7.0.2 через существующий `scripts/local-checks/compiler-cli.ts --native`; отдельный `typecheck:native` gate явно устанавливает pinned pilot compiler. Production build/typecheck сохраняют repository TS6.0.3, доступный в обычной установке и Docker, а AST/transpile API инструменты также остаются на TS6. Нет скрытой зависимости production build от локального opt-in install. Node24.19 удовлетворяет требуемому floor24.18. Root pnpm10.33 сохраняется; отдельный Foundation tooling workspace использует свой pnpm11.25/lock и существующие точные age-policy exceptions для четырёх проверенных версий. Его install выполняется без `--ignore-workspace`, чтобы эти настройки действительно применялись.

## 2. Архитектура: DDD, Clean Architecture, SOLID, DRY

DDD/Clean Architecture уже приняты ADR-005. ADR-028 определяет ownership admission, operation-specific atomic commands и Published Language. ADR-001/data classification сохраняют code custody в execution runtime. ADR-030 — другая узкая WEB-host область, её не расширяем молча.

Новый scoped ADR фиксирует:

1. Web-authored Markdown — намеренно сохраняемый user-managed content, не raw prompt archive, Memory или репозиторный исходник.
2. Git bodies/resources не сохраняются в CP. Там только exact base SHA и разрешённые descriptors.
3. Bounded context `review-skills` владеет originals/revisions/grants/links/bindings. `review-run-control` владеет admission/run lifetime.
4. App composition соединяет consumer ports существующей Serializable admission transaction. Generic cross-context Unit of Work не вводим.
5. Engine adapters получают immutable neutral DTO. OCR-specific fields не проникают в domain.
6. User skills — данные; Get Modular собирает приложение, а не исполняет каждый скилл.

### 2.1 Структура нового context

`packages/features/review-skills/src/`:

| Слой                  | Ответственность                                              | Не импортирует                                  |
| --------------------- | ------------------------------------------------------------ | ----------------------------------------------- |
| domain                | инварианты, IDs, limits, author policy, scopes/delta         | Prisma, HTTP, React, GM                         |
| application           | сценарии CRUD/sharing/assignment/capture; structured results | Next, Fastify, конкретную БД, OCR               |
| application/ports     | narrow query/atomic command/actor ports                      | global service locator, generic transaction bag |
| infrastructure/prisma | SQL, CAS, constraints, locking, projections                  | React, prompts                                  |
| composition           | GM declarations/factory и borrowed host ports                | executable user code                            |
| public exports        | curated DTO/application/composition surfaces                 | внутренние Prisma models                        |

Не создавать класс для каждого поля, функцию-policy как GM module или пустые layers ради дерева каталогов. Маленькие cohesive файлы допустимы ADR-005.

### 2.2 Практическое применение принципов

- **SRP:** content, sharing, assignment, capture и engine projection имеют разные операции/владельцев.
- **OCP:** новый engine меняет adapter, не original/revision/grant модель.
- **LSP:** adapters принимают общий input; unsupported capability вызывает явный отказ, не silent omission.
- **ISP:** web CRUD не получает run-token/checkout authority; runtime не получает библиотечный CRUD.
- **DIP:** application зависит от consumer-owned ports; DB/session/clock/IDs внедряет host.
- **DRY:** одна assignment command для двух UX; один scope matcher; один capture; один source wire contract с generated copy; одна common materialization до engine branch.
- **DDD:** Skill aggregate защищает head revision; source и destination authority — отдельные понятия; run authorization хранит immutable snapshot, не живую ссылку.

### 2.3 Get Modular/Foundation: реальная, ограниченная adoption

Минимальный graph: borrowed Store + borrowed Access → Review Skills application root. Production/test hosts отличаются adapters. Используем public `defineContract`, `declareModule`, `input`, `implement`, `assemblyFor().prepare()`. Ports имеют own callable properties, class-prototype adapters оборачиваются. Actor передаётся на каждую операцию; construction не авторизует будущие запросы.

Core/Assembly imports только composition/tests. Conformance dev-only в той же physical Assembly dependency graph; resources0.2.1 только dev peer если требуется Conformance. Не добавлять runtime Resources/Observation без owned lifecycle/telemetry задачи.

Foundation/FMS — `scripts/review-skills-tooling`, отдельный private package, pnpm11.25 и lock. FMS public Node API `checkFeatureModuleOnDisk`/`formatNodeReport`; maps существующие domain/application/infrastructure/composition роли. Foundation scoped `architecture.source-dependencies` schemaVersion1: v2 требует полного closed workspace census и расширил бы задачу. Gate проверяет реальные запрещённые imports и rejecting mutation. Existing architecture gate и ADR-030 profile сохраняются. Не включаем global catalogs/presets/dependency migration.

`architecture/review-skills/consumer-module-profile.json` фиксирует reviewed CMS/module-authoring commit и FMS standard digest, production root/governed paths, exact package pins, два borrowed inputs и один application module, app-owned lifetime/no owned resources, blocking commands и узкую область claims. Gate добавляет public checkNamespaces и independent checkWiring oracle; expected providers/namespaces не вычисляются из production graph.

## 3. Модель данных, ownership и ACL

### 3.1 Сущности

| Сущность                    | Минимальные поля / ключ                                                                | Инвариант                                             |
| --------------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| ReviewSkill                 | id, sourceWorkspaceId, authorUserId, headRevisionId, createdAt, deletedAt?             | immutable source/author identity                      |
| ReviewSkillRevision         | id, skillId, revisionNumber, name, description, instructions, contentDigest, createdAt | append-only; unique(skillId,revisionNumber)           |
| ReviewSkillGrant            | skillId, destinationWorkspaceId, grantedBy, grantedAt, revokedAt?, version             | только direct source grant; unique(skill,destination) |
| ReviewSkillLink             | workspaceId, skillId, acceptedGrantVersion, acceptedBy, acceptedAt, unlinkedAt?        | canonical reference, не копия                         |
| ReviewSkillBinding          | workspaceId, repositoryConnectionId, skillId, includePaths, excludePaths, version      | repository и local link принадлежат destination       |
| ReviewSkillRepositorySource | repositoryConnectionId, roots, version                                                 | только allowlisted roots, opt-in                      |
| Authorization attachment    | nullable skillsSnapshotCanonicalJson на ReviewRunAuthorization                         | null = historical absence, никогда capture latest     |

Grant generation: revoke и regrant увеличивают version. Link действителен только при acceptedGrantVersion == current active grant.version; Accept требует expectedGrantVersion. Regrant требует нового destination Accept, repeated active Grant/Accept — no-op. Dual-admin helper принимает точное поколение atomically.

Binding ownership: composite FK (workspaceId,repositoryConnectionId) проверяет repository ownership; доступность local original либо shared accepted link проверяет atomic command (без выдуманного FK для union). Source/head revision constraint — composite key.

Local original доступен source workspace без self-grant. Destination требует одновременно active grant и active accepted link. Binding хранит canonical skillId. Одинаковые имена не сливаются. Composite FK/constraint запрещает head revision чужого skill.

Additive migration: индексы source library, destination links, repo bindings, revisions. Нет cascade удаления captured content. User deletion не меняет author на администратора; сохраняем immutable identity по существующей retention policy.

### 3.2 Матрица доступа

| Операция                     | Серверное правило                                                                                                                                                         |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| List/read                    | current member активного workspace; original или local accepted link; только нужная текущая revision                                                                      |
| Create                       | current source member со стабильным User.id                                                                                                                               |
| Save name/description/body   | actorUserId == authorUserId и current source membership                                                                                                                   |
| Grant/revoke                 | source owner/admin                                                                                                                                                        |
| Accept/unlink                | destination owner/admin                                                                                                                                                   |
| Dual-admin Add               | в одной transaction проверить обе authority и создать grant+link                                                                                                          |
| Bind/unbind/scope/Git opt-in | current destination owner/admin **или** подтверждённый SCM repository manager write/maintain/admin; active workspace обязателен, membership для второго пути не требуется |
| Delete original              | author с source membership; нет local bindings/active grants                                                                                                              |
| New admission                | active workspace/grant/link/binding; членство автора **не требуется**                                                                                                     |
| Admitted execution           | existing run authorization + captured attachment; no live grant recheck                                                                                                   |

Не использовать mutable GitHub login для authorship. Actor из server session, не client payload. `canAdminWorkspace`/local override не дают author-only edit. Repo adapter сохраняет правила repo_manager (write/maintain/admin), но не принимает local-admin override как достаточную Skills authority: либо current DB owner/admin, либо реальная SCM проверка. Source grant/destination accept также требуют actual current DB role owner/admin, без override. UI capabilities — presentation, server повторно проверяет.

Автор ушёл из source → edit заморожен, текущая revision/grants продолжают работать. Пользователь — member A/admin B → не может экспортировать A только из-за права читать. Destination не может re-share canonical link.

Repository-only actor получает отдельный listAssignmentChoices после проверки **каждого exact selected repository**. Он видит доступные для назначения metadata плюс generic unavailable existing bindings для Remove и k/N этого set, не всю библиотеку/body/history или usage остальных repos. Workspace library/body read по-прежнему требует membership. Acceptance использует настоящую write-permission ветку, без admin shortcut.

### 3.3 Privacy/lifecycle

- Usage показывает только разрешённые repo names/counts текущего workspace. Source не читает destination results/private repo list.
- Linking не открывает историю source revisions; target читает текущую доступную head и свои captured runs.
- Audit/outbox/logs: IDs/digests/counts/safe reasons; без body/provider prompt.
- Revoked dependency — отдельная unavailable projection: generic label + canonical ID + local assignment counts/removal capability, без чтения свежего source head/name/description/body. После revoke→source rename target не видит новое имя. Revoked dependency видна как unavailable. Пока assignment остаётся, new admission blocked; нельзя превратить это в green skipped review.
- Revoke не отменяет admitted run; UI объясняет это. Остановка уже принятого run — отдельная destination операция.
- Unlink с bindings требует явного снятия, не скрытой потери проверок.
- Delete original = soft tombstone после проверки активных зависимостей. Revoked stale links не запрещают deletion навсегда; captured bytes сохраняются по run retention.
- Delete original, Remove from workspace, Remove from repositories — отдельные подписи и последствия.

## 4. Application API и операции

Server-only Actor = { userId }. DTO не содержит actor login/admin flags, Prisma object или engine-specific JSON.

```ts
type Scope = {
  includePaths: readonly string[];
  excludePaths: readonly string[];
};
type SaveSkill = {
  workspaceId: string;
  skillId: string;
  expectedRevisionId: string;
  name: string;
  description: string;
  instructions: string;
};
type AssignSkills = {
  workspaceId: string;
  repositoryIds: readonly string[];
  skillIds: readonly string[];
  mode: "add" | "remove";
  scope?: Scope;
};
```

| Команда/query                                               | Порядок / результат                                                                                                                    |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| listWorkspaceSkills(workspaceId,search,cursor)              | server bootstrap, current head metadata, viewer capabilities, safe local usage                                                         |
| loadSkill(workspaceId,skillId)                              | current allowed body и expectedRevisionId; не arbitrary ID reader                                                                      |
| createSkill                                                 | validate → member check → original+revision atomically; unassigned initially                                                           |
| saveSkill                                                   | author/member check + expected head → append revision + CAS head в одной transaction                                                   |
| listLinkableSkills(destination)                             | existing grants либо source admin authority; не вся доступная для чтения библиотека                                                    |
| grant/revoke/accept/unlink                                  | отдельные операции, repeated intent idempotent; dual-admin helper atomic                                                               |
| loadSkillAccess(workspace,skillId)                          | source-admin-only grants/status/current generations; destination name только если actor вправе его видеть, иначе opaque ID             |
| listSkillRepositoryTargets(workspace,skillId,search,cursor) | authorized local target IDs/names/assignment states через существующий repository query port                                           |
| loadRepositorySkillSettings(workspace,repositoryId)         | same repo-manager authority, roots/current source version и bindings/scopes/versions                                                   |
| listAssignmentChoices(workspace,repoIDs)                    | available candidates **и generic unavailable existing bindings** selected set; k/N по всему captured set, availability, current scopes |
| applyAssignments                                            | Add union missing / Remove subtract; прочие bindings и existing scopes сохраняются                                                     |
| updateBindingScope                                          | explicit one-binding command + expectedVersion; не побочный эффект Add                                                                 |
| setRepositorySources                                        | opt-in только разрешённых roots, expectedVersion                                                                                       |
| deleteSkill                                                 | safe dependency counts/reason при невозможности                                                                                        |

Conflict Save возвращает current revisionId и safe metadata; UI сохраняет draft. No blind overwrite. Bulk **all-or-nothing**: exact IDs → все permissions/availability → bounded transaction. При forbidden target ни одного partial write; UI показывает исправимый отказ и позволяет изменить selection. No background-job/idempotency framework: повторная set delta сама no-op.

### Limits

| Объект                          | Лимит v1                                                        |
| ------------------------------- | --------------------------------------------------------------- |
| Web name / description          | 120 / 1024 Unicode символа; name nonblank                       |
| Web instructions / Git SKILL.md | 32 KiB UTF-8, nonblank                                          |
| Markdown reference              | 16 KiB, максимум8 на skill                                      |
| Skills per repository/run       | максимум32 web+materialized Git                                 |
| Scope                           | <=16 include +16 exclude, pattern<=256 bytes; default ["**"]/[] |
| Captured/materialized bundle    | <=256 KiB canonical UTF-8                                       |
| Bulk                            | <=1000 exact repository IDs, <=100 skill IDs                    |
| Library/choices page            | 50; server cursor/search; selections сохраняются                |

No silent truncation. Size/count/path/unsupported errors останавливают применение до inference. UI подсказывает limits; server authoritative. 1000 ограничивает одну операцию, не задаёт future selection.

## 5. Captured contract, admission и транспорт

### 5.1 Published Language

Pure source `packages/shared/src/review-skills-contract.ts`, deterministic generated runtime copy, TS export/check script с digest. Independent golden/rejecting fixtures. Existing runtime-config strict v1 и private runtime snapshot strict v3 сохраняют формы и byte limits.

```ts
type CapturedReviewSkills = {
  schemaVersion: "reviewrouter.review-skills/v1";
  baseSha: string;
  webSkills: readonly {
    skillId: string;
    revisionId: string;
    sourceWorkspaceId: string;
    name: string;
    description: string;
    instructions: string;
    includePaths: readonly string[];
    excludePaths: readonly string[];
  }[];
  gitSources: readonly { root: ".reviewrouter/skills" | ".agents/skills" }[];
  digest: string; // SHA-256 canonical payload без digest
};
```

Canonicalization сортирует canonical IDs/roots/scopes, rejects unknown keys/duplicates, валидирует digest и bytes. Envelope baseSha равен authorization baseSha. Web identity учитывает revision/body/description/scopes; exact-base descriptor фиксирует Git content без CP custody. Explicit empty capture отличается от historical null. Старые hash preimages не меняются.

Transport descriptor в этом же generated source фиксирует `/api/action/v2/skills`, empty-object request <=1024 bytes, response <=256KiB, no-store и safe error codes. Это companion существующего v2 transport, не незарегистрированный ad-hoc маршрут.

### 5.2 Capability

Optional `reviewSkillsVersion:1` в **registered ReviewAgentProfile**. Новый qualified profile/binary identity; registered historical records не переписываем. Existing producer immutable key уже включает agentProfiles.

Profile без capability и без назначений сохраняет legacy execution. Nonempty bindings/Git sources с unsupported profile → actionable skills_engine_unsupported до inference. Capability migration охватывает shared profile parser, scripts/lib/review-action-v2-release-manifests.mjs readers/writers, generated runtime profile reader, private captured agent parser и ручной readApprovedOcrReviewAgent в ocr-managed-bootstrap.ts. Supporting value1 сохраняется normalization; absence возвращает прежний семиключевой object без undefined/null. Full manifest→capture→runtime и invalid capability fixtures обязательны. Client flag не заменяет registered capability. Supporting profile всегда получает captured empty/nonempty DTO; missing attachment — error.

### 5.3 Admission последовательность

1. Existing trusted repository/producer/run eligibility.
2. Existing lookup original run/attempt **до чтения текущих Skills**.
3. Original найден → его attachment, включая null; не capture latest.
4. Для нового run после captured engine selection читать текущие bindings/grants/links/source roots и exact immutable revision bodies, проверить capability/bounds.
5. Сформировать canonical candidate; Git содержит exact authorization.baseSha и roots, без blobs.
6. Existing Serializable admission transaction: identity locks → replay lookup → **prelock полного captured source/destination Workspace set в sorted order** → existing runtime fence (уже берёт destination FOR UPDATE) → Skills revalidation → authorization row/attachment + existing outbox. Проверяем count locked parent rows == unique candidate workspaceIDs и все active. Missing/deleted parent → denied/eligibilitychanged. При новом source/binding вне candidate возвращаем AdmissionFactsChanged, не добираем out-of-order locks.
7. Fence повторно получает полный current set и сравнивает candidate. Нет набора из разных revisions/assignment moments.
8. Перед возвратом mutable Skills capture denial повторить original lookup: concurrent admitted winner мог появиться после первого lookup. Если найден — обычные eligibility/restore checks с его attachment, без capture latest. Действительно новый run остаётся denied.
9. Cache/evidence reusable lookup только после successful new admission.

Consumer `ReviewRunSkillsSnapshotPort` в review-run-control, app adapter вызывает context. TransactionClient только app/infrastructure, не generic UoW в application.

Attachment пишется только вместе с new authorization row; renew/restore/terminate не меняют его. Все Prisma selected mappings возвращают поле. Racing candidates возвращают первый persisted winner bytes и один outbox. Skills digest не добавляется в existing replay immutable key, иначе valid first-winner restore превратится в conflict. Snapshot immutable защищён write paths и DB guard.

Mutations/capture используют общий lock order: sorted destination/source workspaceIDs, затем repositoryIDs/skillIDs. Destination scope защищает от phantom added binding; source scope — Save/revoke. Serializable reads текущих workspace/membership + bounded retries на serialization failures. Внешний GitHub permission I/O перед короткой DB transaction; DB membership повторно внутри.

**Не помещать new grant checks в runtimeSnapshots.isLive(), renewal или каждый provider call.** Revoke после admission commit оставляет bounded право этого run на snapshot. Author membership проверяется при edit, не consumption.

### 5.4 Отдельный endpoint

`POST /api/action/v2/skills`, existing review-run bearer, bounded empty request. Ответ captured DTO, Cache-Control:no-store. Endpoint resolves existing authorization, отдаёт только её attachment, валидирует scope/base/limits. Content не кладётся в env, claims, telemetry.

Supporting runtime ограничивает чтение HTTP body до response.json/parse (stream UTF-8 byte cap, cancellation и run deadline); timeout/oversize/invalid не дают fallback. Supporting runtime fetches до inference/cache, хранит immutable parsed DTO в execution input. Retry/token refresh не перечитывает latest; если повторяет fetch — сравнивает bytes/digest. Failure/missing/unsupported endpoint → blocked, без static fallback. Legacy unsupported profile не вызывает endpoint.

Queue/retry/restore используют captured bytes до max authorization lifetime. New manual run получает current capture. Existing emergency producer/run revocations остаются своими проверками.

### 5.5 Все runtime entrypoints

| Seam                                    | Обязательный trusted input                                                                                              |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| ProductionT0ReviewRunner.runInWorkspace | Supporting captured profile + attachment до compatibility/evidence lookup                                               |
| prepareSingleT0NativeInputs             | После fresh receipt тот же attachment, exact-base materialization                                                       |
| prepareSingleT0ReviewPlan               | Уже materialized bundle и trusted captured profile/capability; omission при capability1 forbidden                       |
| Native finding/investigation            | Один projection для обеих веток                                                                                         |
| Older/nonmanaged paths                  | Если admitted transport не умеет доставить Skills, new admission с назначениями explicitly denied до legacy cache reuse |

`provider_api` сам по себе не доказывает delivery: supporting profile предпочитается только для verified `providerApiAuthMode: "openrouter-api"`. GitHub Secrets/Hosted callers без admitted-input seam выбирают единственный retained legacy Codex profile; при bindings/Git sources получают `skills_engine_unsupported`. Если legacy candidate отсутствует или неоднозначен, admission fails, без supporting fallback. Gateway native сохраняет supporting selection.

## 6. Git Skills и materialization

Простое explicit opt-in «Use skills from repository» с двумя known roots. Web Skills не требуют файлов. Не auto-load всех IDE rules/AGENTS.md/skills чужого назначения.

После materializer.ensureAvailable и до engine branch:

1. Сверить captured baseSha с verified authorization.baseSha.
2. Читать exact commit через git tree/blob API, не рабочий HEAD.
3. Обнаружить непосредственные <root>/<name>/SKILL.md, stable POSIX order. Ограничить tree output <=1MiB и <=4096 entries/root; count SKILL.md до чтения blobs, общий limit32 с учётом web. Reference/byte budgets проверять инкрементально.
4. Regular blobs only; no symlink/gitlink; path containment/UTF-8/bytes.
5. Frontmatter: required name/description, optional license/compatibility/metadata (string map). Unknown keys, YAML custom tags/anchors/aliases и execution-required fields (allowed-tools/tools/scripts/dependencies) rejected с понятной unsupported ошибкой. Git skills apply all reviewable files; custom path scope только web binding.
6. Материализовать Markdown inline links `[text](relative.md)` и reference definitions `[id]: relative.md` (используемые reference-style links) без optional title/embedded HTML. Разрешены `.md` пути без пробелов/URL encoding с optional #anchor, строго внутри skill directory. External URLs/anchors остаются текстом без fetch; unsupported local reference syntax даёт actionable error, не обещает загрузку. Depth<=4, <=8 unique references/skill, cycle rejected.
7. Traversal/missing local md/cycles/recursion/unsupported mandatory resources/limits → explicit error. Scripts/tool instructions не исполняются и не расширяют authority.
8. Neutral resolved item identity = git:root/name, revision=baseSha, resources+bytes/digests.
9. Общие web+Git limits; materialized execution digest включает все bytes/scopes.
10. Runtime provenance: IDs/revisions/origin и «instructions supplied», не гарантия исполнения каждой проверки.

Изменение skill в проверяемом PR не меняет правила этого PR. После merge следующий trusted base включает изменение. Недоступный base можно получить existing authorized exact-SHA SCM reader; нельзя заменять HEAD.

## 7. Движки, scope и identity

### Common

В `production-t0-review-runner.ts` один immutable effective bundle до `if(input.ocr)`. Единый dialect: anchored repository-relative POSIX globs, `*`, `?`, `**` (только целый segment), dotfiles included, case-sensitive. Reject absolute/drive/backslash/empty or dot-dot segments, bracket classes, braces, extglob, negation/comments. Matcher minimatch10.2.5: dot:true, nocase:false, nonegate:true, nocomment:true, noext:true, nobrace:true; один shared grammar validator и независимый fixture corpus. Include union минус excludes. Compose **все** подходящие skills на assigned path, stable order, dedupe canonical ID/revision. Не расширять inventory/tools. Порядок обеспечивает reproducibility, не решает семантические противоречия.

### OCR

Текущий builder передаёт id/content и top-level merge, которых pinned parser не использует. Реальная shape:

```json
{
  "rules": [
    {
      "path": "src/example.ts",
      "rule": "ReviewRouter managed policy\n…",
      "merge_system_rule": true
    }
  ]
}
```

- Precompose matching skills в один entry на path: upstream first match не суммирует rules.
- Managed patch exact case-sensitive path matching; ordinary upstream glob mode сохраняется.
- Managed assigned-inventory allowlist **до grouping/native dispatch/первого model call**; upstream include **не allowlist**.
- Preserve SkipProjectRules/private HOME/sanitized env; не читать PR-head .opencodereview/rule.json.
- Multiline inline wrapper не даёт loader принять строку за path к md.
- merge_system_rule true на каждом entry сохраняет built-ins.
- Assert main **и plan** requests; factual-only filter не переписываем.
- Новый patch set → новая qualified binary/profile identity; rr.3 immutable.
- Missing binary в required qualification lane = fail, не describe.skip green.

**Historical OCR branch:** captured legacy absence/rr.3 использует старый builder и его ruleText/semantic preimage byte-for-byte. Новый supporting profile + explicit empty/nonempty attachment использует corrected builder/patch. Нельзя выбрать ветку по сегодняшним assignments. Supporting profile + missing attachment fails. Fixture восстановленного rr.3 через новый Action обязателен.

### Native

Shared PromptBuilder segments для finding/investigation и prepared path получают те же применимые captured instructions, с path labels. Late async enrichers не читают библиотеку. Existing file/context boundaries сохраняются.

### Cache

Skills-enabled incremental compatibility включает captured + execution digests, поскольку ранний completed-snapshot reuse может обойти prompt builder. OCR ruleText и native final prompt/contextManifestHash также включают effective text. Auth before cache остаётся отдельным условием.

Legacy absence branch сохраняет byte-for-byte old hashes; не добавлять skills:null в preimage v1. Tests показывают изменение при revision/scope/resource и неизменность legacy fixture.

## 8. Frontend, без лишней сложности

### 8.1 Shell и read path

- dashboard-section.ts: union/order/meta; skills сразу перед memory.
- dashboard-section-tabs.tsx: icon для desktop/compact.
- DashboardSectionContent делегирует отдельному server section до heavy account reads.
- Новый `src/features/review-skills`: contracts/query-keys/client-adapter.
- Server composition/dashboard adapter/actions отдельно от большого workspace-page.
- First paint через server loader; interactive React Query keys workspace+viewer+selection identity, deliberate staleTime и точечная invalidation. Не дублировать fetched state в локальном useState.

### 8.2 Library/editor

Плоская таблица, source/author, local Used in, updated, действия. Empty: Create / Add from workspace. Три поля, explicit Save, hint «Updates future reviews in connected repositories». Linked skill read-only для неавтора; исходный автор с current source membership получает Edit original (переход в source workspace), а не ложный запрет из-за link.

Dirty close — discard или продолжить. Conflict сохраняет draft, показывает fresh revision, explicit reload/reconcile; no blind overwrite. Create в empty bulk доступен только workspace member; repository-only actor видит пояснение и возможность выбрать доступные скиллы без Create/body/share. Create из empty bulk возвращает initial repo selection и отмечает созданный skill. Create из library предлагает Assign to repositories.

Import SKILL.md — bounded local file → plain-text preview полей нового web original; no raw HTML, remote images, YAML tags/aliases или выполнение. Export — portable text-only format. Это не live Git sync. Git-managed content не редактируется в web. V1 source settings показывает roots, включённость, trusted-base правило и понятные runtime discovery errors; **полного web preview Git bodies не добавляем**. Run provenance показывает разрешённые paths/revisions/diagnostics, без CP blob custody. Эти Git entries не выдаются за selectable web skill IDs.

### 8.3 Sharing

Add → Create / Import / From another workspace. Eligible originals показывают source/author/live link explanation.

Dual admin: одно Add. Existing explicit grant: destination Accept. Source admin выдаёт/revokes direct grant выбранному workspace. Destination picker содержит только workspace, metadata которых actor вправе видеть; односторонний grant другому workspace использует exact opaque destination ID без global search/enumeration. No invites/email/public catalog. Unavailable row объясняет состояние и позволяет снять dependencies. Query не раскрывает workspace/repo metadata неавторизованному actor.

### 8.4 Selection/bulk

Existing gateway-repository-batch-controls содержит gateway targets/version/cap100. Extract neutral repo ID selection provider; Gateway adapter сохраняет свои eligibility/version/cap. Skills inventory допускает repo_manager и не наследует direct_config-only выборку.

repository-live-search различает matchingIds/visibleIds. Select all N matching берёт matchingIds. Selection survives filters/pages; selected/hidden counters, Clear. Exact repoIDs фиксируются при открытии; background selection/filter changes не меняют dialog title/N/set. Изменение — явный reopen. При >1000 selection сохраняется целиком, Apply disabled с инструкцией сузить; no truncate/chunk/future selection.

Dialog: Add/Remove title/description/primary action различны. Checkboxes initially empty, Assigned k/N отдельный столбец. Skill selection survives pages/search. Add scope default all; advanced optional include/exclude. Подсказка advanced scope: применяется только к новым bindings. Existing scope не меняется Add; Paths для single repo — explicit versioned command. Remove доступен для unavailable binding.

Bulk transaction all-or-nothing; pending prevents duplicate submit, safe rejection остаётся в dialog. Transport-unknown completion не называется failure/no-change: exact delta selection сохраняется, предлагается readback/безопасный same-delta retry. Known unsupported runtime показывается до Apply; assignment может быть сохранён с явным сообщением, что новое ревью blocked до update. Success invalidates usages+bindings. Library Repositories использует тот же API.

### 8.5 Accessibility

Shared Base UI Dialog/Button/Checkbox/Badge/SelectField; semantic labels/table/textarea без новой component framework. Focus trap/return, Esc+dirty behavior, keyboard; mobile scroll/max-height с доступным footer. Nav desktop/compact order E2E.

## 9. Пошаговое исполнение и ownership

Каждый coherent checkpoint commit/push в уже открытые draft PR. Root владеет git и интеграцией; agents не коммитят чужие файлы.

### A. План и решения

- [x] Worktrees, baselines, early draft PR, source audits, registry versions.
- [x] Три **последовательных** раунда нескольких критиков: architecture/data/tooling; runtime/OCR/protocol; UX/authorization/privacy.
- [x] После каждого: исправить план, finding→решение→acceptance в review log; следующий round читает новую revision.
- [x] Scoped ADR и точный contract.freeze; dependency/toolchain checks.
- [x] Только после round3 запуск параллельной implementation.

### B. Domain/persistence — architecture lane

1. Новый package/exports/build/test config.
2. Domain limits/author policy/scopes/delta/structured errors.
3. Additive Prisma models+migration/constraints/indexes, runtime DB ACL минимально необходимая.
4. Operation-specific ports, Prisma atomic commands/CAS/locks/bounded retry.
5. CRUD/grant/revoke/accept/unlink/linkable query/bulk/scope/Git opt-in.
6. Capture/revalidation surface для app adapter; no Git bodies in CP.
7. GM production/test composition, scoped Foundation/FMS rejecting gates.
8. Domain tests и PG author/CAS/sharing/bulk/races.

### C. CP admission/transport — root

1. Pure published contract + generator/check + independent fixtures.
2. Profile capability parser/export и new qualified identity; legacy absence preserved.
3. Authorization attachment domain/Prisma mapping/migration, не public claims.
4. Consumer capture port после engine selection, original restore first.
5. App-owned transaction fence, no live grant checks on renew.
6. Actionable unsupported/unavailable/oversize admission reasons.
7. Authenticated no-store endpoint.
8. PG empty/legacy/race/capture/cache-order tests.
9. Release handoff/digest fixtures; no mutation old manifests.

### D. Runtime — runtime lane, другой worktree

1. Generated contract и capability; endpoint integration managed transports.
2. Captured immutable execution input, refresh equality, no fallback.
3. Exact-base Git reader/refs/bounds + pure scope projection.
4. Common runner integration всех OCR/native/investigation/prepared paths.
5. OCR parser shape/exact paths/allowlist patch; binary/profile qualification.
6. Compatibility identity with legacy goldens.
7. Real CLI loopback prompts, native parity, Git fixture, published contract parity.
8. Text-only subset docs, safe provenance.

### E. Web — frontend lane

1. Server session/access composition + safe DTO adapters.
2. Server section/first paint/actions/query keys.
3. Library/editor/import/export/conflict/readonly.
4. Sharing/accept/revoke/local usage.
5. Neutral selection provider + Gateway regression.
6. Bulk Add/Remove, all matching/kN/scopes/Git opt-in/reverse assignments.
7. Nav before Memory.
8. Actual Next/browser cases в existing accounts-reference-e2e harness. Для repository-only write actor внедрить narrow test HTTP transport seam в существующий GitHub App adapter и loopback token+collaborator permission fixture с user ID/login/write. Session/guards/use case/DB настоящие, no production bypass/no fake authorizer true. Workspace-admin fixture не считается этой проверкой.

### F. Общие gates

1. Dependency install/Prisma generate/build new packages.
2. Focused tests/typecheck + existing relevant regressions.
3. Foundation/FMS/GM independent oracle; запрещённый импорт действительно red.
4. Real PostgreSQL17+ acceptance migrations/transactions (точная версия в evidence); PGlite только developer smoke.
5. Real patched OCR binary+loopback Responses, main/plan actual prompt assertions.
6. Existing browser harness расширить, без production auth bypass; actual Next actions/DB.
7. Paired CP→runtime captured transport/projection/digest parity fixture.
8. Independent implementation review, fixes, evidence with exact commands/SHAs.
9. Final commits/push/update PR status; production deployment/stable tags отдельны.

## 10. Acceptance matrix

| ID  | Сценарий                                | Проверяемый результат                                                                                                                           |
| --- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| A01 | create/save/reopen                      | persisted head, append-only revision                                                                                                            |
| A02 | concurrent editors                      | один Save, второй conflict; draft intact                                                                                                        |
| A03 | nonauthor admin direct action           | server forbidden                                                                                                                                |
| A04 | author leaves source                    | edit denied, existing consumption valid                                                                                                         |
| S01 | dual admin link                         | один original, grant+link, no copy                                                                                                              |
| S02 | member A/admin B export                 | denied без source grant                                                                                                                         |
| S03 | destination re-share                    | denied, no transitive grant                                                                                                                     |
| S04 | usage privacy                           | нет чужих repo names/counts/results                                                                                                             |
| B01 | mixed Add                               | только missing, unrelated/scopes preserved                                                                                                      |
| B02 | Remove unavailable                      | selected bindings сняты, original intact                                                                                                        |
| B03 | >100 repos/multiple skill pages         | exact matching selection survives filters/pages                                                                                                 |
| B04 | forbidden repo in bulk                  | no partial writes, actionable reason                                                                                                            |
| B05 | repeated delta                          | no-op safe                                                                                                                                      |
| R01 | Save/rebind после capture               | byte-identical retry                                                                                                                            |
| R02 | revoke before new admission/cache       | blocked до reuse/inference                                                                                                                      |
| R03 | revoke after admission                  | original run valid, next blocked                                                                                                                |
| R04 | concurrent Save/revoke/bind/admit       | whole authorized old/new set, no torn snapshot                                                                                                  |
| R05 | historical null                         | no latest capture, same old hash                                                                                                                |
| R06 | unsupported registered profile          | explicit failure, no ignore                                                                                                                     |
| G01 | PR-head malicious Skill                 | exact trusted base content                                                                                                                      |
| G02 | refs traversal/symlink/cycle/oversize   | fail before model, no network                                                                                                                   |
| G03 | missing base object                     | exact authorized fetch или fail, no HEAD                                                                                                        |
| E01 | real OCR main/plan                      | matching instructions + built-ins present                                                                                                       |
| E02 | case/metachar paths/inventory           | no bleed, unassigned never sent                                                                                                                 |
| E03 | native finding/investigation            | same applicable captured content                                                                                                                |
| E04 | revision/scope/resource change          | new cache key; old absence golden unchanged                                                                                                     |
| U01 | desktop/compact nav                     | Skills directly before Memory                                                                                                                   |
| U02 | dirty/conflict/mobile/keyboard          | draft/focus/action accessible                                                                                                                   |
| U03 | empty bulk→create                       | original repo selection + new skill selected                                                                                                    |
| U04 | viewer/workspace switch                 | query cache isolation                                                                                                                           |
| P01 | logs/health/outbox                      | no bodies/Git blobs/raw prompts                                                                                                                 |
| M01 | missing/wrong provider/forbidden import | scoped gates fail                                                                                                                               |
| X01 | repo-only write actor                   | Add/Remove разрешены; content/share/чужой usage запрещены; role demotion/live permission loss/one forbidden selected repo → zero partial writes |
| X02 | revoke→source rename                    | target не видит fresh source metadata/body                                                                                                      |
| X03 | revoke→regrant                          | нужен Accept current generation; stale Accept rejected                                                                                          |
| X04 | 1001 selected / unknown transport       | IDs retained, bounded error/no writes; no false outcome on lost response                                                                        |
| X05 | sourceID<destID concurrent admit/revoke | consistent prelock order, bounded retry, один row/outbox                                                                                        |
| X06 | same-run two candidates + denial race   | оба возвращают persisted winner; new run denied                                                                                                 |
| X07 | manifest/profile/legacy rr.3            | full capability roundtrip; old profile, ruleText и hashes unchanged                                                                             |

## 11. Rollout и совместимость

Delivery заканчивается реализацией/квалификацией в PR. Production deploy/stable-tag movement не выполняются этим поручением. Не объявлять profile qualified до real binary proof.

Совместимый порядок: additive DB+server readers → qualified new runtime/profile registration → assignment enablement для поддерживаемых repositories. Старый producer с назначениями явно требует update; не делает green ignored review. Старые empty/legacy runs сохраняются.

Rollback code не удаляет revisions/attachments. Не rebind profileRef/binary identity к другим bytes. Captured data доступны supporting runtime до expiry. Deletion/retention следуют существующему operation policy, не новому бесконечному archive.

## 12. Журнал исполнения

Три раунда: [2026-10-21-review-skills-reviews.md](./2026-10-21-review-skills-reviews.md).
Все implementation lanes B–E завершены. Общие локальные gates F пройдены: captured contract/real PostgreSQL/actual roles, signed paired HTTP transport, native/OCR projection, реальный OCR binary, fresh seven-case browser qualification, scoped GM/Foundation/FMS, protocol/artifact parity и независимый implementation review. Подробные команды, версии, результаты и ограничения — в [отчёте о реализации](./2026-10-21-review-skills-implementation.md).

Функциональный SaaS checkpoint `03c94f32ce4a5147336681502742e4385c1827d5`; runtime `4aae5bd7e1c62cfa6852209ca78799d2e5e14132`. Коммиты отправлены в оба PR по ходу работы. Последующие документационные checkpoints не меняют квалифицированный product behavior. Финальные remote jobs и production release остаются отдельными наблюдаемыми этапами, не подразумеваемым результатом локальных тестов.
