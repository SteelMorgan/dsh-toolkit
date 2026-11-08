# dsh-tui-compact-tech

Компактные заголовки терминальных карточек для `dsh-TUI` в стиле Codex/Claude:
многострочная команда в шапке `Bash(...)` сжимается до одной строки, а тело
результата остаётся штатным — 3 строки preview и полный вывод по `Ctrl+O`.

Плагин **не меняет исходники** DSH и dsh-TUI. Он оборачивает `presentCall`
уже зарегистрированных инструментов (`bash`, `pwsh`) и переписывает только
*заголовок*:

- заголовок терминальной карточки → первая строка команды, обрезанная до
  `titleCells`, с пометкой `… +N lines` для многострочных скриптов;
- тело результата по умолчанию **не трогается**: TUI сам показывает 3 строки,
  а `Ctrl+O`/клик раскрывает полный результат.

Модельный контекст не трогается: `tool/result` остаётся полным.

## Как это выглядит

Было (многострочный Bash):

```text
• Bash(git status --porcelain; git diff --stat; git log --oneline -5;
      git ls-files --others --exclude-standard;
      5 lines folded, ctrl+o to expand)
  ⎿  M src/a.ts
     M src/b.ts
     ... ещё 40 строк
```

Стало (header-only):

```text
• Bash(git status --porcelain; git diff --stat; … +4 lines)      2s
  ⎿  M src/a.ts
     M src/b.ts
     ... ещё 40 строк   ← штатный 3-строчный preview, Ctrl+O раскрывает всё
```

Если нужен максимально плотный вид, можно включить `trimResults: true` —
тогда тело сжимается до 1 строки + маркер. Это **lossy для карточки**: TUI
рисует и свёрнутое, и раскрытое состояние из одного `resultView`, поэтому
`Ctrl+O` покажет тот же сжатый текст. Полный результат при этом остаётся у
модели и в session log/`/export`.

## MCP/JSON: generic smart

Для `generic`-карточек (MCP, JSON-результаты, фоновые job'ы) можно включить
`generic: smart`: плагин делает JSON-aware сводку — статус/`error`/счётчики/
`next` — и добавляет строку `… N chars hidden`. Если ответ не JSON, остаются
первая и последняя строки плюс маркер. Не-текстовые блоки (картинки) не
затрагиваются; ошибки не сжимаются.

Это **lossy для карточки**: TUI рисует свёрнутое и раскрытое состояние из
одного `resultView`, поэтому `Ctrl+O` покажет ту же сводку. Полный ответ
остаётся у модели и в session log/`/export`. Терминальные карточки при этом
остаются header-only (`trimResults: false`).

## Установка

Плагин — обычный bundle: `package.json` объявляет `dsh.bundle.patch`, поэтому
`dsh plugin add` сам добавляет его в `dsh.profile.bundles`.

Локально (в контейнере/на машине, где запущен нужный профиль):

```bash
dsh plugin --profile tui add /path/to/dsh-tui-compact-tech-0.6.0.tgz
```

Для удалённого контейнера (подставь имя контейнера и пользователя):

```bash
docker cp dsh-tui-compact-tech-0.6.0.tgz <container>:/tmp/
docker exec -u <user> <container> \
  dsh plugin --profile tui add /tmp/dsh-tui-compact-tech-0.6.0.tgz
```

Проверить, что bundle попал в профиль:

```bash
docker exec -u <user> <container> \
  sh -lc 'grep -n compact-tech ~/.dsh/profiles/tui/package.json'
```

Удаление:

```bash
dsh plugin --profile tui remove dsh-tui-compact-tech
```

## Настройка

Конфиг ряда лежит в `cordis.patch.yml` профиля (или в самом bundle-патче):

```yaml
- id: dsh-tui-compact-tech
  config:
    enabled: true
    tools: [bash, pwsh]   # какие инструменты оборачивать
    trimResults: false    # true = резать тело (lossy для Ctrl+O)
    bodyLines: 1          # только при trimResults: true
    failureLines: 4       # только при trimResults: true
    titleCells: 100       # бюджет заголовка в ячейках
    generic: smart        # false | headtail | smart (MCP/JSON)
```

## Ограничения и совместимость

- Оборачивается только заголовок; `presentResult` не подменяется, пока не
  включён `trimResults`. TUI монтирует инструменты в scope агента, поэтому
  плагин патчит и глобальный вид, и каждый agent scope (включая агентов,
  созданных после старта).
- Плагин идемпотентен: повторная активация/`tools/change` не навешивает
  обёртки второй раз; при выгрузке оригинальные функции возвращаются.
- Если DSH изменит форму `ToolCallView`/`ToolResultView`, обёртка вернёт
  исходный view без изменений (все обращения к полям защищены).
- `read`/`grep`/`diff`/`search`/`web`-карточки не сжимаются: у них уже есть
  собственные лимиты и структурированное представление.
- MCP/JSON-карточки в header-only режиме тоже не сжимаются: их тело — это
  `generic`-view, а его обрезка возможна только через `trimResults: true`
  (lossy). Для lossless-просмотра полного JSON нужен отдельный scene/панель.
- Это presentation-only хак на уровне реестра инструментов, а не официальный
  seam dsh-TUI. После крупного апгрейда dsh-TUI стоит прогнать smoke-тест на
  одной сессии.

## Тесты

```bash
node --test test/*.test.js
```

24 теста: сворачивание заголовка, header-only по умолчанию, opt-in trim,
границы, идемпотентная обёртка, scoped-агенты, поздняя регистрация инструмента,
frozen-definition, dispose/restore.

## 0.5.0

- Fix: restored/resumed sessions resolve their tools through
  `agent.ctx.get('tools')`; the plugin now patches that registry, not only the
  global `tools.get(name, agent)` view. New and restored agents both compact
  Bash headers after restart.


## 0.6.0

- `allTools: true`: patch every tool definition, so `generic: smart` applies to
  MCP/Generic **results** too. MCP call headers remain untouched
  (`compactCallView` only rewrites terminal cards). The result summary is what
  renders in the card and Ctrl+O; the model/session log keeps the full result.
