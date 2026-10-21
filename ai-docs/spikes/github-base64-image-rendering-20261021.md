# GitHub base64 image rendering: фактическая проверка

Дата: 2026-10-21, Europe/Kiev. Результат: `data:image/*;base64,...`
непригоден для изображения в проверенном GitHub Markdown renderer.

## Метод

Через авторизованный `gh api` выполнены два запроса:

```text
POST https://api.github.com/markdown
mode=gfm, context=777genius/review-router-ai

POST https://api.github.com/markdown
mode=markdown, context=777genius/review-router-ai
```

В обоих запросах одинаковый текст: настоящее PNG, настоящее WebP, каждый
в Markdown image syntax и в HTML `<img src="data:...">`. Контроль:
обычная HTTPS-картинка GitHub. Проверялся возвращённый сервером HTML,
а не только успешный exit code команды.

Фикстура - детерминированный баннер ReviewRouter 1280×224:

| Формат           | Размер файла | Base64 без префикса |
| ---------------- | -----------: | ------------------: |
| PNG              | 14 264 байта |     19 020 символов |
| WebP, quality 85 |   7 766 байт |     10 356 символов |

Это размеры конкретного тестового изображения, не универсальная оценка.
Base64 добавляет примерно треть к размеру бинарного файла.

## Наблюдение

| Вход                   | GFM                            | Markdown                       |
| ---------------------- | ------------------------------ | ------------------------------ |
| Markdown PNG data URI  | `src` удалён                   | `src` удалён                   |
| HTML PNG data URI      | `src` удалён                   | `src` удалён                   |
| Markdown WebP data URI | `src` удалён                   | `src` удалён                   |
| HTML WebP data URI     | `src` удалён                   | `src` удалён                   |
| HTTPS control          | `src` сохранён, URL через Camo | `src` сохранён, URL через Camo |

Пример входа:

```markdown
![RR MD WEBP](data:image/webp;base64,...)
```

Фактический фрагмент ответа GFM:

```html
<a target="_blank" rel="noopener noreferrer" href=""
  ><img alt="RR MD WEBP" style="max-width: 100%;"
/></a>
```

Проверены все четыре alt-label в каждом ответе; img-теги остались,
но ни у одного data-image нет атрибута `src`. Поэтому проблема возникает
ещё до загрузки изображения браузером и не связана с WebP decoder.

Граница исходного эксперимента: проверен серверный `/markdown`, в двух режимах.
Issue, PR и комментарии не создавались; browser E2E опубликованного комментария
не выполнялся. Другие image transports эта проверка не подтверждает.

## Evidence и повторение

Локальные disposable материалы: `tmp/github-base64-check/`:
`review-banner.png`, `review-banner.webp`, `input.md`, `request-gfm.json`,
`request-markdown.json`, `rendered-gfm.html`, `rendered-markdown.html`, `result.json`.

```sh
gh api --method POST /markdown --input tmp/github-base64-check/request-gfm.json
gh api --method POST /markdown --input tmp/github-base64-check/request-markdown.json
```

Документ сохраняет вывод и существенные факты после удаления временных файлов.
Для production использовать обычный Markdown либо HTTPS image URL.

Источники: [GitHub Markdown REST API](https://docs.github.com/en/rest/markdown/markdown),
[GFM и дополнительная sanitization GitHub](https://github.github.com/gfm/#what-is-github-flavored-markdown-).
На дату проверки установленный `gh` 2.89.0 не показывает `--attach` у
`gh pr comment`; текущая [документация attachment upload](https://docs.github.com/en/github-cli/github-cli/attaching-files-with-github-cli)
описывает эту возможность, но она здесь не проверялась и не является основанием
обещать работающую загрузку через нынешний CLI или GitHub App publisher.

## Дополнительная проверка в PR

Позднее в тот же день реальный WebP data URL проверен в опубликованном
PR-комментарии: raw body сохранил data, а GitHub удалил src из img.
HTTPS SVG прошёл GitHub sanitization и загрузился через Camo в обеих темах.
Тестовый комментарий удалён; существенные факты и ID сохранены в
[отчёте presentation E2E](compact-review-comments-e2e-20261021.md).
