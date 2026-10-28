# Стабильное подключение ReviewRouter и заменяемый агент

Дата: 2026-10-14, Europe/Kiev. Уточнение владельца: сейчас 0 пользователей, breaking changes до запуска допустимы, устаревшие контракты можно удалить. Это план, а не выполненная реализация или deploy.

## Цель и главное решение

Сначала привести систему к одному хорошему контракту, затем сохранять его для будущих пользователей. После подключения customer YAML не меняется при совместимой смене runtime, поддержанного агента, модели или model-provider. Для 1000 репозиториев такие обновления выпускаются централизованно.

До public launch не строить backward-compatibility слой ради текущих dogfood/test установок. Старые workflows, API aliases, config parsers и скрытые semantic migrations удаляются из актуального исполнения. Существующий код использовать там, где он подходит новой модели, а не считать его формат ограничением архитектуры.

Сохраняются реальные security/data invariants: точная identity исполняемого кода, tenant/revision authority, explicit overrides, bounded effects, cancellation/cleanup и отсутствие повторного provider invocation. Legacy cleanup не означает удаление credentials, provider accounts, durable billing/effect evidence, Git history или immutable release tags.

Обязательная реализация: три этапа и один coherent выпуск. Не вводить новые policy/generation tables, migration service, routing DSL, runtime downloader или дополнительные review/deploy циклы по расписанию.

## Проверенная основа

Аудит зафиксирован на SaaS `6dd3bed59ded93defad3a91148bddff7a481bdb3` и public runtime `14f43d923531c0c0592302ddb4f10978570c0bb5`. Локальный исходный checkout старый и dirty; реализация использует clean актуальный main обоих release-coupled repos без чужих изменений.

- [Caller](https://github.com/777genius/rr-selfhost-direct-v2-e2e-20260730t120036z/blob/bf8a01f58ee5087793015f2c2eabe2284683b401/.github/workflows/reviewrouter-codex.yml) уже компактный, но содержит SHA и Codex-specific knobs.
- [ReviewAgentPort](https://github.com/777genius/review-router/blob/14f43d923531c0c0592302ddb4f10978570c0bb5/src/review-investigation/application/review-agent-port.ts), adapters, selector, ProducerRelease, private snapshots, durable request lifecycle и provisioning revision существуют. Расширять их; не создавать параллельный framework/registry.
- [Mapper](https://github.com/777genius/review-router-ai/blob/6dd3bed59ded93defad3a91148bddff7a481bdb3/packages/features/review-providers/src/domain/provider-runtime-plan.ts#L104) превращает explicit 5 в 50. Эту эвристику удалить полностью, без временного legacy adapter.
- Current materialized config и старые agent/provider aliases не обязаны сохраняться для клиентов. Current Account Gateway/kernel, защищённая credential custody и актуальные SCM features продолжают работать через новую policy model.

Внешние ограничения: [GitHub reusable workflows](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows) имеют literal uses и caller permission ceiling; [OIDC](https://docs.github.com/en/actions/reference/security/oidc) должен доказывать actual executed SHA. Re-running all jobs может заново разрешить mutable ref; specific/failed-job rerun использует первый SHA. В обоих случаях новый run_attempt не получает новую provider authority по старому request. GitHub concurrency не является durable queue.

## Этап 1. Один публичный контракт

**Ownership:** workflow-provisioning, source attestation, public runtime и existing paired release pipeline.

Caller `.github/workflows/reviewrouter-review.yml`, name `ReviewRouter`, job `review`. Entry `.github/workflows/reviewrouter-runtime.yml@workflow-v1`. Новый channel описывает совместимость подключения, независимо от product v1.0.x. Правила channel и immutable tags находятся в existing release operations document; не создавать новый release process. В той же партии обновить AGENTS/setup docs, если они предписывают obsolete codex filename/schema.

Required inputs только review_request_id, pr_number, review_head_sha. Они проверяются against durable intent/live SCM, не являются полномочиями. Optional control_plane_url сохраняет self-hosted origin; default SaaS URL не позволяет fallback в другой origin. Secrets, CLI versions, provider_instance_id, runtime_ref, auth/session implementation mode и модели отсутствуют в caller.

Иллюстрация target YAML; становится исполняемым после публикации/регистрации entry:

```yaml
name: ReviewRouter
run-name: ${{ format('ReviewRouter review {0}', inputs.review_request_id) }}
on:
  workflow_dispatch:
    inputs:
      review_request_id: { required: true, type: string }
      pr_number: { required: true, type: string }
      review_head_sha: { required: true, type: string }
permissions: {}
jobs:
  review:
    if: ${{ inputs.review_request_id != '' && inputs.pr_number != '' && inputs.review_head_sha != '' }}
    concurrency:
      group: reviewrouter-request-${{ github.repository_id }}-${{ inputs.review_request_id }}
      cancel-in-progress: false
    permissions:
      contents: read
      pull-requests: read
      id-token: write
    uses: 777genius/review-router/.github/workflows/reviewrouter-runtime.yml@workflow-v1
    with:
      review_request_id: ${{ inputs.review_request_id }}
      pr_number: ${{ inputs.pr_number }}
      review_head_sha: ${{ inputs.review_head_sha }}
```

1. One contract definition содержит names/input types/permissions; public artifact sync выводит тот же contract. Current generator/scanner заменяется new canonical contract, старые branches/path aliases удаляются после pre-launch cutover.
2. Entry непосредственно выполняет job и получает OIDC; nested reusable jobs не используются. Binary/tooling preparation переиспользует TS helpers. Так signed job_workflow_sha доказывает сам executable entrypoint, без отдельного chain-proof механизма.
3. Existing validation проверяет issuer/audience/expiry/replay, signed repository/owner IDs, caller source/path, run id/attempt и job_workflow_ref/job_workflow_sha. Supported GitHub sub formats - особенность внешнего GitHub protocol, а не наш obsolete config; их проверка сохраняется.
4. ProducerRelease проверяет actual SHA, artifact digests и active/revoked state. Today's channel target и client-supplied SHA не заменяют signed execution identity. Runtime checkout идёт по actual executed SHA.
5. Managed durable dispatch, per-request concurrency, App-first publication и current permission ceiling сохраняются. Runtime watchdog/profile budget внутри shared runtime; YAML не задаёт engine-specific timeout.
6. Managed channel обновляется штатным release job после exact artifact/CI validation. Immutable pin может использовать существующий provisioning actionRef как advanced override; отдельная pin-management/update-PR платформа не нужна.

**Готовность:** один deterministic/canonical YAML около 30 строк; unknown source/SHA/permission denied до provider effects. Change agent/model/tooling не меняет inputs, trigger и permissions.

## Этап 2. Один внутренний контракт исполнения и настроек

**Ownership:** existing agent adapters/composition, review-config, platform config, run snapshots и compatibility gate.

### Агент и model-provider разделены

Авторитетная настройка агента - validated deployment `REVIEW_ROUTER_AGENT_PROFILE`, default approved OCR profile `ocr-managed-v2` для Account Gateway с Agentic context. Значение opaque profile ref; definition принадлежит existing approved producer metadata. Там agent kind, qualified binary/capabilities и существующие selector options, без arbitrary commands/URLs/credentials. Новые policy tables/operator APIs не нужны.

1. Current ReviewAgentPort с negotiate/executeTurn/cancel сохраняется. Model provider и agent kind имеют разные types; существующий selector получает explicit captured executionAuthority. Наличие secret/model-provider kind не выбирает агент.
2. Server profile setting меняется после выпуска runtime, поддерживающего profile. Admission проверяет registered producer/profile/model-transport/auth combination; unknown combination fail closed, no guessed fallback.
3. Единственный актуальный private snapshot v3 содержит effective policy, selected agent profile/digest, producer, deadline/binding/limits. Во время pre-launch cutover old authorizations завершаются или fenced/sealed, после этого snapshot-v1/v2 execution parsers удаляется. Historical raw rows остаются audit evidence, не admission input.
4. После server admission runtime проверяет actual toolchain/profile через negotiate до checkout/model calls. Server registration и actual negotiation - две разные проверки одной границы, они не дублируют друг друга.
5. Captured winning snapshot сохраняется для run/attempt. Profile/config deployment edit не меняет active run. Higher GitHub attempt по прежнему request denied; existing server rerun service создаёт новый request после безопасного разрешения prior execution. Unknown effect outcome не разрешает новый автоматический запуск.
6. Vendor CLI flags/env/auth/bootstrap/error parsing и cleanup принадлежат adapters. Domain не импортирует конкретный SDK и не требует Codex. Изменять binary version без qualified producer profile нельзя.

### Одна актуальная policy schema

Выбрать canonical current schemaVersion=3: полная workspace policy и sparse repository overrides. Это прямая замена v1/v2 до launch, а не dual-read framework. Нет family-aware policy stores, overridePaths/null legacy convention, baseline catalogue или временного downcast.

7. Workspace сохраняет full validated policy через existing configuration-version operation при onboarding после выбора разрешённого connection; до readiness execution не начинается, default не создаёт gateway binding/полномочия. Existing test workspace переносится once с explicit settings; новый product default не перезаписывает сохранённый workspace. Не распознавать inherited/default values по их числу.
8. Repository хранит только explicit typed overrides. Absent field наследует workspace; explicit 0/false сохраняется; reset удаляет override. Providers заменяется целиком validated array, не merge по index. Null допускается только для объявленных nullable settings. Нет generic recursive merge/JSON Patch.
9. Canonical non-secret policy document хранить в existing ReviewConfigurationVersion с schemaVersion и policy JSON. Это единственный policy source; старые materialized policy columns/reader helpers больше не управляют исполнением. Existing typed provider/binding FK references сохраняются как автоматически derived reference projection в той же transaction; JSON не отменяет tenant/binding validation и lifecycle protection. Credential/account/kernel tables не переделывать.
10. Existing config editor/save работают с одним current schema: workspace full document и repository typed patch/reset. Effective full policy вычисляется сервером, runtime не получает sparse override document. Маленький reset/inherit control нужен; field-source inspector и profile editor не нужны.
11. Composite revision token/cache/snapshot ID учитывает workspace version, repository version и effective policy digest. Existing Serializable/CAS предотвращает concurrent save overwrite; snapshot получает целый validated effective document.
12. inlineMaxComments=5 означает 5. Удалить old 5→50 helper, auth auto-conversion и old public aliases. New parser не меняет auth mode при чтении. Model/auth connection определяется typed references текущего gateway/catalog, не историческим названием codex row.
13. Все актуальные server-side consumers (включая existing GitLab adapter, если он читает policy) переходят на current effective serializer в этой партии. GitLab workflow redesign не нужен. Не оставлять скрытый hardcoded-v2 reader; закрыть import/callsite impact search + typecheck. Old config execution parser удаляется, а не живёт как fallback.

**Готовность:** есть одно current policy representation/serializer и один current snapshot parser. Explicit overrides сохраняют смысл; server-managed workspace settings распространяются без customer YAML edits. Actual alternative CLI production qualification выполняется при его реальном включении; первый neutralization release может использовать qualified Codex.

## Этап 3. Разовый pre-launch переход и выпуск

**Ownership:** existing dispatch/recovery/provisioning, config adapters и paired release workflow.

Это не reusable legacy migration service. Нужны известные dogfood/test targets, один gated переход и удаление obsolete execution paths. Наличие 0 пользователей подтверждено владельцем; read-only inventory нужен только для выявления наших активных test jobs/configs.

1. Остановить новый dispatch/admission для меняемых test/dogfood installations существующим safety control. Завершить current runs либо отменить с existing fencing/cleanup. Pending requests без effects terminal/seal; unknown provider/POST outcome reconcile по existing evidence, не повторять и не стирать ledger. Для нескольких наших installs не добавлять queue-generation tables/fields.
2. Сохранить узкий recovery snapshot старых workflow/config/source refs. Не делать broad DB reset. Provider accounts, credentials, pool connections, authorization/effect history и unrelated data сохраняются. Historical policy/snapshot rows можно оставить read-only opaque evidence без old execution parser.
3. Пока dispatch остановлен, обновить API/runtime current serializer и schema, пересоздать known test policy через current existing writer, заменить caller в наших test repos existing setup PR и удалить old workflow в том же PR. Не нужен add/activate/drain/cleanup overlap двух публичных контрактов: drain выполнен до замены.
4. Source probe подтверждает новый canonical caller/registered producer; existing provisioning revision/CAS сохраняются. Old request/source authority fenced до возобновления dispatch, late old callbacks не получают новые effects. Удалить obsolete generators, validators, old path allowlists и tests, проверяющие только удалённый contract. Не удалять current Codex implementation/internal credential features только из-за codex в имени.
5. Выпустить один coherent paired release и managed channel через current штатный pipeline. Один App-first canary в existing disposable repo доказывает signed actual SHA, exact head, result и App-bot identity. После success включить new provisioning default и dispatch.
6. Partial failure оставляет затронутые installations stopped; failed verification не включает old fallback. Исправлять недоказанный шаг. Recovery может восстановить previous source/config отдельной операторской операцией, но permanent backward-compatibility code в current build не сохраняется. Immutable published tags/Git history не переписывать.

**Готовность:** current code не принимает obsolete config/workflow/auth aliases; test installs работают с новым contract, unresolved old effects не получили повторный запуск. Это единственная breaking cleanup перед launch.

## Что будет удобно обновлять после запуска

| Изменение                                                                        | Где выполняется                                                     | Customer YAML                         |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------- |
| CLI/runtime dependencies и orchestration                                         | Compatible approved runtime release + channel move                  | Не меняется                           |
| Qualified agent с теми же capabilities/permissions                               | Runtime adapter/profile + server setting                            | Не меняется                           |
| Model/provider connection и review policy                                        | Existing server config/catalog/settings                             | Не меняется                           |
| Product/workspace defaults                                                       | Versioned workspace policy update; explicit repo overrides остаются | Не меняется                           |
| Internal schema/storage                                                          | Server-side migration/serializer и compatible runtime release       | Не меняется, если public ABI сохранён |
| New required inputs, permissions, execution location или другой public major ABI | Новый contract major и installation update                          | Может потребоваться миграция          |

После launch workflow-v1 сохраняет input names/types, permissions и failure semantics. Новые public поля только optional с deliberate defaults. Breaking public ABI получает новый major. Old active jobs сохраняют admitted exact release/snapshot до завершения. Zero-user разрешение на cleanup применяется сейчас; оно не означает, что после появления клиентов можно незаметно ломать contract.

Owner/repository/file path reusable workflow и API origin фиксируются до первого внешнего подключения. Перенос runtime infra за тем же API origin внутренний; переименование самого публичного GitHub repo/path меняет literal uses и потребует installation update. До launch выбрать окончательный namespace, после launch сохранять его как public API. Никакая agent abstraction не отменяет это ограничение GitHub.

Это архитектурная граница для обновления, не обещание поддержки любого CLI. Agent должен пройти существующий port/profile contract. Если новая модель не поддержана выбранным агентом, server capability check сообщает это, не заменяет модель или агент молча.

## Минимальные проверки и rollback

| Набор                | Конкретная поломка                                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Caller/OIDC/producer | Лишние права, missing/unknown signed SHA, wrong source/repository/attempt; denied provider calls=0                       |
| Agent/snapshot       | Agent выводится из model kind, profile drift, live settings меняют active run, unsafe rerun, broken cancellation/cleanup |
| Policy               | Explicit 5/0/false, sparse/reset/array semantics, workspace edit/save race, FK/tenant bypass, hidden old-schema reader   |
| Pre-launch cutover   | Dispatch не остановлен до old path removal, unknown effect rerun, canary failure включает неподтверждённый path          |
| Один live canary     | Actual claims, exact revision и App-first publication                                                                    |

Обновлять ближайшие existing suites и relevant typechecks, не создавать отдельную suite на каждом слое. Один synthetic case на 1000 installation records показывает bounded reads и ноль workflow writes при compatible channel/profile change; не создавать 1000 GitHub repos или live provider reviews.

Выполнить обязательный required CI exact head, artifact integrity/architecture checks проекта и один final canary. Passed checks не повторять без нового изменения/сбоя. Не вводить sleep/cooldown или deploy на каждом шаге. Для реального включения другого агента нужны его contract/process checks и targeted live qualification; не требовать такой provider run для удаления старого filename/compatibility code.

Rollback после launch: last-known-good approved new-contract producer/channel + existing safety stop/revoke. Config history/snapshots/ledger не удаляются. Во время нынешнего pre-launch перехода recovery идёт через saved source/state при stopped dispatch; legacy не становится automatic fallback. Heavy checks выполняются в isolated hosted test workspace, а не runtime launch на реальных проектах пользователя.

## Оценка объёма и приёмка

Основная реализация ориентировочно 900–1700 строк нового/редактируемого рабочего TS/YAML, 450–800 tests/fixtures и 60–120 SQL/Prisma: примерно 1400–2700 строк, без docs/generated artifacts. Это engineering range, не measured diff. Удаления obsolete code/tests считать отдельно после impact search: они могут увеличить changed LOC, но уменьшают поддерживаемый код. Число строк не является архитектурной целью.

Acceptance:

- Один public caller, одна current policy schema и один current execution snapshot; obsolete branches/aliases не используются.
- Actual approved SHA, tenant/revision/effect authority и cancellation сохраняются.
- Compatible model/provider/agent/runtime update не меняет caller; mandatory scope не содержит нового framework/registry/migration service.
- Central agent setting действительно приходит в existing selector authority; active run не меняется при settings edit.
- Policy overrides/defaults однозначны, текущие typed binding references/lifetime protections сохранены.
- Pre-launch cleanup касается подтверждённых наших test installs/config, а не credentials/accounts/history/unrelated data.
- Первый release проходит mandatory checks и один live canary; дополнительный цикл обоснован только новым failure/risk.

## Предыдущие ревью

Два независимых раунда ревью были проведены на более широких drafts; их invariant findings сохранены: exact executable proof, authority-aware rerun, runtime negotiation и config precedence. По последнему указанию владельца backward-compatibility решения удалены из scope. Old-reader coexistence и долгий dual-workflow cutover больше не нужны, поскольку переход выполняется при stopped dispatch до клиентов. Current actual effect/cleanup safety остаётся обязательной.

Предыдущие drafts/review reports сохранены в tmp/provider-neutral-plan-20261014 как recovery evidence. Эта редакция не выдаётся за independently reviewed implementation: корректность будет доказана перечисленными focused checks при реализации.

Private snapshot generation уточнён при интеграции main: published migration 000129 уже заняла v2 для inert personal epoch pin. Полный policy/profile snapshot использует v3, не переопределяет опубликованный формат; единственная новая policy migration перенумерована в 000132. Исторические v1/v2 остаются audit evidence. Захваченный expectedAuthorizationEpoch сохраняется и проверяется в API и SQL; personal capture сохраняет существующий точный private sharing flag и обязательный epoch; default остаётся выключенным. Публичный workflow-v1 не меняется.

## Уточнение владельца: сохранение дополнительных режимов (2026-10-15)

GitHub Secrets сохраняется, включая существующий scoped secret forwarding и credential rotation. Hosted Pool тоже сохраняется; основной текущий путь — sub2api. Эти режимы не удалять ради очистки имён. Их существующие entrypoints остаются отдельными от нового компактного Gateway caller; они не являются автоматическим fallback при отказе Gateway. При необходимости исправить небольшие несовместимости provisioning/path, без новой платформы миграций и без отдельной полной live-сертификации старых режимов.

Требования выше об удалении obsolete execution paths относятся к заменяемому Gateway contract, а не к удалению GitHub Secrets/Hosted Pool. Новый Gateway caller сохраняет reviewrouter-review.yml и workflow-v1; существующий secret-backed/Hosted caller сохраняет свой путь до отдельной миграции. Общий constant старого caller нельзя переназначать на новый путь: это меняет установку и активацию ещё используемых режимов. Проверки ограничиваются затронутыми provisioning/secret-forwarding suites; основной live canary остаётся Gateway.

## OCR default rollout (2026-10-20)

Неявный engine на Account Gateway с `agenticContext=true` разрешается сервером
через immutable approved profile `ocr-managed-v2`. Его реальный binary/capabilities
должны быть зарегистрированы у exact admitted producer до включения. Explicit
`agentProfileRef` сохраняется без fallback. Неявный supplied-diff-only сохраняет
единственный approved Codex profile с Account Gateway transport; отсутствие или
неоднозначность совместимого профиля закрывают admission. GitHub Secrets и Hosted
Pool сохраняют свой qualified Codex/provider-api contract: текущий OCR его не
поддерживает. Это граница охвата, а не переименование Codex в OCR.

SQL-перенос policy не нужен: отсутствие `agentProfileRef` уже означает server
default. JSON, версии policy и захваченные старые snapshots не переписываются.
Process override `REVIEW_ROUTER_AGENT_PROFILE` остаётся авторитетным для неявного
agentic Gateway default; production rollout сверяет его с новым exact profile.

### TODO: отдельная квалификация оптимизаций native ReviewRouter

- [ ] После вывода новых relation-обязательств повторно использовать полный proof
      того же принятого turn через existing closure prover. В r2 следующий turn
      повторил 10 поисков и 8 полных чтений (406 552 байта исходников); 3 набора путей
      уже были полностью покрыты. Сохранять точные revision/tree, полный search chain,
      exact required paths и contiguous complete HEAD proof. Missing/partial/wrong-tree
      evidence оставляет relation открытой. Нужны отдельная версия domain/profile
      policy и regression checks; число байтов не обещает экономии tokens/time.
- [ ] После model-free квалификации нескольких direct MCP calls в одном ответе
      (отдельные receipts и operation limits для каждого) предложить пакетировать
      независимые read/search. В r2 было 61 request и 58 single-call continuations;
      накопленная история добавила 15 550 402 serialized bytes. Это полезные evidence,
      их нельзя молча обрезать. Prompt hint не гарантирует batching или экономию.

Обе идеи только TODO: текущий алгоритм, prompt и frozen comparison не меняются.
Измерения: retained r2 `optimization-followups.json`, `rr/native-context-traces.json`
и `rr/wire-shapes-safe.json`; это один bounded case, не общий benchmark.
