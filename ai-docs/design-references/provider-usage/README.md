# Provider Usage reference

`overview-approved.png` - принятый владельцем визуальный образец Usage overview,
переданный root для реализации 2026-10-22. Это bitmap reference, не HTML/mock API
и не договор о числовых значениях. SHA256:
`5dd862f37cce75e7ad017c33f6a0f8387098ce57c04e31ddeba455e6d94a4ea9`.

Сохранить текущую ReviewRouter black/cyan тему, shell/workspaces/sidebar,
компактный filter bar, четыре inline KPI с dividers, daily stacked bars,
top models, Models/Runs tabs и нижнюю status/details строку. Responsive layout
адаптирует эту композицию, а не пытается уместить desktop bitmap на телефоне.

Данные на картинке иллюстративны и местами арифметически несогласованы. Не
переносить growth percentages, coverage percentages, «completed runs» или
«subscription billing» как готовый продуктовый контракт. Known cost не включает
неизвестное; разные currencies и cost bases не складываются. Requested model
не становится observed model при отсутствии observed telemetry. День без
observations не доказывает zero usage. Конкретный UI использует только ledger
facts и честные подписи из [плана 61](../../architecture/61-provider-usage-overview-implementation-plan.md).

Существующие shared UI primitives и токены являются исходником стилей. Образец
не требует новой component system, неизменных labels/providers/model IDs или
добавления библиотек без обоснования. Скриншоты проверки/trace сохраняются в
`tmp/accounts-reference-e2e/runs/provider-usage-overview-candidate/` (harness) или
`tmp/provider-usage-overview/` (дополнительные visual notes), не рядом с approved
reference.
