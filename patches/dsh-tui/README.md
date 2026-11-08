# dsh-TUI local patches

Два независимых локальных патча dsh-TUI, которые применяются в памяти через
Node loader — **без правки `node_modules`** и без касания `~/.dsh-tui`:

1. **rowcap**: `const RENDERED_ROW_CAP = 120` → `600` в
   `lib/types/components/MessageList.js`.
2. **model/effort env** (только при заданном env):
   - `DSH_TUI_MODEL_ROUTE=provider/model` читается в `readModelPref()` раньше
     `~/.dsh-tui/model.json`;
   - `DSH_TUI_EFFORT=high` читается в `resolveEffortDefault()` раньше
     `settings.effortDefault`/`effort.json`.

## Зачем

- rowcap: dsh-TUI рендерит только 120 записей, а хранит до 600; при чтении
  истории окно сдвигается, и верхние записи исчезают. `Ctrl+E` показывает всё,
  но каждый раз вручную.
- model/effort env: профильный `provider/model/effort` — это default, а
  last-used `/model`/`/effort` из `~/.dsh-tui` стоит выше. Для программного
  запуска (Herdr/launcher/docker) нужен явный launch-pin. Upstream:
  #1910.

## Файлы

- `hooks.mjs` — ESM `load` hook + чистые функции `patch*Source`.
- `loader.mjs` — регистрирует hooks для `node --import`.
- `dsh` — wrapper: находит настоящий `dsh` в PATH (пропуская свой каталог),
  добавляет `NODE_OPTIONS=--import=.../loader.mjs`, делает `exec`.
- `test/patch.test.mjs` — 6 тестов (rowcap, model, effort, load hook).

## Установка

```bash
install -d "$HOME/.local/rowcap-bin"
install -m 755 dsh "$HOME/.local/rowcap-bin/dsh"
install -m 644 loader.mjs hooks.mjs "$HOME/.local/rowcap-bin/"
# PATH в конец .bashrc и .profile (login-shell перезаписывает PATH)
printf '%s\n' 'export PATH="$HOME/.local/rowcap-bin:$PATH"' >> "$HOME/.bashrc"
printf '%s\n' 'export PATH="$HOME/.local/rowcap-bin:$PATH"' >> "$HOME/.profile"
```

Проверка:

```bash
command -v dsh          # ~/.local/rowcap-bin/dsh
dsh --version
node --test test/*.test.mjs
```

## Запуск с маршрутом

```bash
DSH_TUI_MODEL_ROUTE='provider/model' \
DSH_TUI_EFFORT='high' \
~/.local/rowcap-bin/dsh --profile tui --patch .dsh/presets/all.patch.yml
```

- Env не задан → поведение обычное.
- Действует на новую сессию; resume сохраняет маршрут из лога.
- Не API key/baseURL; только provider/model/effort.

## Совместимость

- Если маркер в исходнике изменился — hook становится no-op, запуск не
  ломается; обнови `hooks.mjs`/тесты.
- Если upstream уже содержит `DSH_TUI_MODEL_ROUTE`/`DSH_TUI_EFFORT` или
  `RENDERED_ROW_CAP` изменён/настраивается — соответствующий hook больше не
  нужен.
- Upstream: rowcap #1909, model/effort #1910.
- После обновления DSH/dsh-TUI — см. `skills/dsh-local-patches/SKILL.md`.
