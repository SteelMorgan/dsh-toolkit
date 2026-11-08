# dsh-toolkit

Набор расширений и локальных патчей для DSH/dsh-TUI:

- компактные tool-карточки (header-only для Bash + `generic: smart` для
  MCP/Generic **результатов**);
- loader, который поднимает окно истории dsh-TUI с 120 до 600 строк и умеет
  `DSH_TUI_MODEL_ROUTE`/`DSH_TUI_EFFORT`;
- универсальный deterministic launcher: роль + provider/model/effort на запуск,
  изолированный HOME, overlay ряда `dsh-tui`, `resolved.json`;
- skill для агентов, которые запускают DSH и сопровождают патчи.

## Компоненты

| Путь | Что |
|---|---|
| `plugins/dsh-compact-tech` | dsh-TUI плагин; 0.6.0, `allTools: true` |
| `patches/dsh-tui` | Node loader: rowcap + model/effort env; 6 тестов |
| `launcher/dsh-launch` | `ds` + `dsh-worker-launch.py`: детерминированный запуск |
| `skills/dsh-local-patches` | launch/update-аудит для агентов |
| `upstream/dsh-tui` | китайские тексты предложений #1909/#1910 |
| `scripts` | install-local, install-container, verify, headless helper |
| `dist` | собранные tarballs |

## Быстрый старт

```bash
./scripts/install-local.sh
dsh plugin --profile tui add dist/dsh-tui-compact-tech-0.6.0.tgz
./scripts/verify.sh
```

Новый TUI-процесс получит cap 600 и плагин; текущий — нет.

## Плагин

`dsh-tui-compact-tech`:

- сворачивает **заголовок** Bash/pwsh-вызова до одной строки с `+N lines`;
- `generic: smart` сворачивает generic/MCP **результат** до 3 строк
  (summary → `… N chars hidden` → хвост); вызов MCP не меняется;
- `allTools: true` патчит все definitions, поэтому MCP-результаты тоже
  сжимаются;
- полный результат остаётся в модели и session log.

Установка и настройка — `plugins/dsh-compact-tech/README.md`.

## Launcher

```bash
install -d ~/.local/share/dsh-launch ~/.local/bin
install -m 755 launcher/dsh-launch/ds launcher/dsh-launch/dsh-worker-launch.py ~/.local/share/dsh-launch/
ln -sf ~/.local/share/dsh-launch/ds ~/.local/bin/ds

ds worker provider/model:high
ds worker provider/model:high --print
```

- роль задаёт `DSH_TUI_PRESET` и `.dsh/presets/all.patch.yml` (или `--preset`);
- провайдер/модель/effort передаются явно;
- создаётся уникальный `~/.dsh-launches/<role>-<UTC>-<random>/` с `launch.sh` и
  `resolved.json`;
- HOME изолируется от `~/.dsh-tui`, чтобы persist `/model` не перебивал запуск;
- `DSH_HOME` (профиль и credentials) сохраняется.

Launcher не знает про конкретные роли, провайдеры или policy — всё задаётся
аргументами. Подробнее — `launcher/dsh-launch/README.md`.

## Local patches

```bash
DSH_TUI_MODEL_ROUTE='provider/model' DSH_TUI_EFFORT='high' \
  ~/.local/rowcap-bin/dsh --profile tui --patch .dsh/presets/all.patch.yml
```

- env действует на новую сессию; resume сохраняет маршрут из лога;
- `DSH_TUI_EFFORT` — только TUI; headless читает `--patch`/`agent-default-model`;
- wrapper обязателен: `/usr/bin/dsh` env не читает;
- не смешивать env с launcher’ом, пока launcher не валидирует env.

## Upstream

- #1909 rowcap: https://github.com/ccch1mneyyy/dsh-TUI/discussions/1909
- #1910 model/effort env: https://github.com/ccch1mneyyy/dsh-TUI/discussions/1910

PR не открываем: аккаунт не в `APPROVED_CONTRIBUTORS`, `pr-gate` закроет.
Тексты — в `upstream/dsh-tui/`.

## Политика

- Не коммитить секреты, credentials, логи, `node_modules`.
- Сторонний код и внутренние отчёты в этот репозиторий не входят.
