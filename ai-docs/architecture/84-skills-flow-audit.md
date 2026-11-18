# Аудит Skills: каталог, проверка, добавление (2026-11-18)

Статус: план и исправления, версия 2 (учтено ревью). База: RR `ae18f9e87`. Деплой не входит.
Заменяет в плане `ai-docs/plans/2026-10-27-skills-catalog-security.md` §3 (отказ при ссылках на файлы) и §5 (отказ по лишним полям через общий парсер).

## Симптом и корневая причина

- В «Browse skills» после Preview: «This skill cannot be added as text instructions. It may need extra files or features that are not supported here.» Текст - `apps/web/app/dashboard/skill-catalog-actions.ts:35-36` для кода `unsupported`.
- Единственный источник кода - `portable-skill-import-normalizer.ts:21-23`: `catch {}` превращает любую ошибку `parseSkillImport` в `unsupported`, причина теряется. Resolve бросает ошибку до staging, кандидат не создаётся.
- Prod (read-only): `ReviewSkillImportCandidate` = 0, `ReviewSkillScan` = 0; scan worker и scanner живы, но ни одной проверки не было. Ни одна попытка не дошла до preview, поэтому scan, add и assign на prod не проверены вообще (см. запись деплоя).
- Замер: 601 `SKILL.md` из популярных страниц UAP и поисков (review, security, react, typescript) через текущий парсер. Принято 202 (34%). Отказы:
  - 226 (38%) - лишние поля frontmatter (`portable-skill.ts:505-513`): `allowed-tools` 118, `version` 50, `homepage` 39, `displayName` 36, `disable-model-invocation` 28, `argument-hint` 17, `user-invocable` 16 и др. Ложный отказ: ревьюер получает только текст, поля ничего не дают и ничего не расширяют.
  - 16 - вложенный `metadata` (`:519-528`). Ложный отказ, `metadata` и так не сохраняется.
  - 151 (25%) - ссылки на соседние файлы (`hasCompanionFiles`, `:536`); у 135 только `.md`. Основной текст полезен сам по себе.
  - 6 - больше 32 KiB. Честный отказ.
- После исправления тот же корпус: принято 591 из 601 (98%). Остальные 10 - честные отказы: 8 по размеру, 2 с описанием длиннее 1024 символов (раньше эта причина пряталась за первой).

## Карта потока

Поиск (UAP `GET /v1/skills`) -> Preview (UAP `POST /v1/skills/resolve` -> нормализация -> staging кандидата на 24 ч) -> Check (outbox -> scan worker -> SkillSpector) -> Add (повторная проверка на сервере, создание Skill) -> назначение репозиториям -> при ревью текст уходит в runtime как captured attachment (ADR-031); ссылки в web skills runtime не разбирает. Удаление и назначения - существующие CRUD, не менялись.

## Исправления

1. Парсер (`portable-skill.ts`, общий для каталога и редактора):
   - Лишние поля и `metadata` любой формы принимаются и попадают в `omittedFields` (до 20 имён, без управляющих символов, до 100 единиц UTF-16 - те же границы, что проверяет store). Безопасный разбор YAML (alias, tag, merge, глубина 16) остаётся. Принимается BOM в начале файла.
   - Ссылки на соседние файлы больше не отказ: `linkedFilePaths` возвращает до 20 путей. Файлы не подгружаются, текст не меняется.
   - Настоящие отказы - `SkillImportError` с причиной `too_large`, `invalid_header`, `invalid_content` (тип в домене); текст ошибки для редактора прежний.
2. Каталог: `resolve` возвращает статус `unsupported` с причиной и точным источником вместо исключения. Код ошибки `unsupported` и общий текст удалены.
3. Кандидат отдаёт `linkedFiles` и `acknowledgementRequired`; оба считаются в store из сохранённых инструкций одной доменной функцией `omissionAcknowledgementRequired`. Ею же store проверяет подтверждение при импорте. Без миграции.
4. UI: общий компонент `SkillImportOmissions` для каталога и редактора: «Not used: ... tools and scripts never run», «Linked files are not included: ... The reviewer will not see them». Для `unsupported` - причина простыми словами, ссылка на точную папку на GitHub и совет взять нужную часть через Create skill. Для внешних элементов каталога вместо «Not available to add here» - «Only skills stored on GitHub can be added here» и ссылка на skills.sh. Ссылка в preview ведёт на точный commit и путь.
5. Подсказку «используйте skills из репозитория» в каталоге не даём: runtime отклоняет лишние поля frontmatter и не-`.md` ссылки, и ревью упало бы. Экспорт со ссылками остаётся `SKILL.draft.md`: в одном файле связанных файлов нет; его текст называет корни `.reviewrouter/skills` и `.agents/skills`.

## Тесты

- Парсер, нормализатор, сервис (причины отказа, без staging). PostgreSQL: кандидат со ссылкой без ресурсов требует подтверждения при импорте.
- Диалог (jsdom): причина и ссылка для `unsupported`, перечень пропущенного, подтверждение.
- Браузер «Catalog real checked import»: skill с `allowed-tools`, `version` и ссылкой проходит check, подтверждение и добавление; слишком большой skill показывает причину (desktop и mobile). Статических проверок в квитанции CI 9 вместо 8. «Skills real Next»: обзор импорта в редакторе и отказ для файла без заголовка.

## Вне рамок

- Подгрузка связанных `.md` из каталога: нужен новый контракт UAP resolve (другой репозиторий) и хранение набора файлов.
- Выравнивание runtime-разбора Git skills (лишние поля) - другой репозиторий.
- Лимит 32 KiB, сканер, квоты, аккаунты и провайдеры не меняются.
