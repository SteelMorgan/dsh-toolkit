---
name: dsh-local-patches
description: "Launch DSH workers with a deterministic provider/model/effort route and audit local dsh-TUI patches after DSH/dsh-TUI updates. Covers DSH_TUI_MODEL_ROUTE/DSH_TUI_EFFORT, the rendered-row cap loader, wrapper/PATH checks, the optional deterministic launcher, and upstream discussions #1909/#1910. Use before starting DSH agents, after updates, or when TUI history/model behavior changes."
---

# DSH local patches and launch

Локальные доработки dsh-TUI устанавливаются в `~/.local/rowcap-bin` и
подключаются через PATH. Это не upstream-код: после обновления dsh-TUI сначала
проверяем patch health, потом запускаем агентов.

## 1. Запуск с фиксированным маршрутом

Проверь, что `dsh` — wrapper с loader’ом:

```bash
command -v dsh
# ожидаемо: /home/<user>/.local/rowcap-bin/dsh
```

Ручной запуск:

```bash
DSH_TUI_MODEL_ROUTE='provider/model' \
DSH_TUI_EFFORT='high' \
~/.local/rowcap-bin/dsh --profile tui --patch .dsh/presets/all.patch.yml
```

- `provider/model` — id провайдера и модели, не API key/baseURL.
- Действует на новую сессию; resume сохраняет маршрут из лога.
- Env не задан → обычный last-used `/model`.
- `DSH_TUI_EFFORT` работает только для TUI; headless его не читает.

Herdr:

```bash
herdr pane split --current --direction right --no-focus \
  --cwd "$PWD" \
  --env DSH_TUI_MODEL_ROUTE='provider/model' \
  --env DSH_TUI_EFFORT='high'
herdr pane run <pane> "dsh --profile tui --patch .dsh/presets/all.patch.yml"
```

Docker (подставь контейнер/пользователя):

```bash
docker exec -u <user> -e DSH_TUI_MODEL_ROUTE='provider/model' \
  -e DSH_TUI_EFFORT='high' <container> \
  bash -lc 'exec dsh --profile tui --patch .dsh/presets/all.patch.yml'
```

## 2. Опциональный deterministic launcher

`launcher/dsh-launch/` — универсальная обвязка для программного запуска:
изолированный HOME, overlay ряда `dsh-tui`, проверка `resolved.json`.

```bash
install -d ~/.local/share/dsh-launch ~/.local/bin
install -m 755 launcher/dsh-launch/ds launcher/dsh-launch/dsh-worker-launch.py ~/.local/share/dsh-launch/
ln -sf ~/.local/share/dsh-launch/ds ~/.local/bin/ds
ds worker provider/model:high
ds worker provider/model:high --print
```

Если launcher уже используется, **не подмешивай**
`DSH_TUI_MODEL_ROUTE` вручную: launcher валидирует свой overlay/`resolved.json`,
env-патч перебьёт маршрут. Сначала интегрируй env в launcher, потом смешивай.

## 3. Что патчится

`patches/dsh-tui/hooks.mjs` при загрузке модулей dsh-TUI:

| Модуль | Замена | Когда |
|---|---|---|
| `lib/types/components/MessageList.js` | `RENDERED_ROW_CAP = 120` → `600` | всегда |
| `lib/types/modelPrefs.js` | `readModelPref()` читает `DSH_TUI_MODEL_ROUTE` до файла | только при env |
| `lib/types/effortPrefs.js` | `resolveEffortDefault()` ставит env выше settings/persist | только при env |

Если исходник не содержит маркер — hook no-op. Если upstream уже поддерживает
env/настройку — hook тоже no-op.

Wrapper `patches/dsh-tui/dsh` находит настоящий `dsh`, добавляет
`NODE_OPTIONS=--import=.../loader.mjs` и делает `exec`.

PATH добавляется в `~/.bashrc` **и** в конец `~/.profile` (login-shell
перезаписывает PATH после `.bashrc`).

## 4. Аудит после обновления DSH/dsh-TUI

```bash
P=~/.dsh/profiles/tui/node_modules/@deepseek-harness-tui/dsh-tui/lib/types
grep -n "RENDERED_ROW_CAP" "$P/components/MessageList.js"
grep -n "DSH_TUI_MODEL_ROUTE" "$P/modelPrefs.js"
grep -n "DSH_TUI_EFFORT" "$P/effortPrefs.js"
```

- `RENDERED_ROW_CAP = 120` → loader нужен; `= 600`/настройка → upstream landed.
- env-упоминания → upstream model env landed.

Тесты loader’а:

```bash
cd patches/dsh-tui
node --test test/*.test.mjs
```

Интеграционная проверка на реальном модуле:

```bash
P=~/.dsh/profiles/tui/node_modules/@deepseek-harness-tui/dsh-tui/lib/types
NODE_OPTIONS=--import=$HOME/.local/rowcap-bin/loader.mjs \
DSH_TUI_MODEL_ROUTE='provider/model' \
node --input-type=module -e "import('file://$P/modelPrefs.js').then(m=>console.log(m.readModelPref()))"
```

Ожидаемо: env-маршрут, а не persisted.

Upstream:

- rowcap: https://github.com/ccch1mneyyy/dsh-TUI/discussions/1909
- model/effort env: https://github.com/ccch1mneyyy/dsh-TUI/discussions/1910

## 5. Когда патчи можно убрать

- #1910 (model/effort env) вошёл → удалить model/effort-хуки; `dsh` читает env
  нативно.
- #1909 (rowcap) вошёл → выставить `renderedRowCap: 600`/дефолт и убрать
  rowcap-хук.
- Пока хотя бы один пункт не в релизе — wrapper остаётся transitional-слоем.

## 6. Что не делать

- Не править `node_modules` вручную: loader работает в памяти.
- Не запускать env-режим через `/usr/bin/dsh` — env будет проигнорирован.
- Не смешивать env с launcher’ом, пока launcher не валидирует env.
- Не класть в env API keys/baseURL; только `provider/model` и effort.
- Не считать `dsh --dump-config` доказательством runtime-маршрута.
