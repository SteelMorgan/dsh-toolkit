# dsh-launch

Универсальная обвязка для программного запуска DSH-работника с явным
provider/model/effort.

## Зачем

В dsh-TUI persist-настройки `/model` и `/effort` (`~/.dsh-tui/model.json`,
`effort.json`) стоят выше `--patch`, `agent-default-model` и роли. Поэтому
обычный `dsh --profile tui --patch …` не фиксирует маршрут нового работника.

`dsh-launch` готовит запуск заранее:

1. изолирует `HOME` от `~/.dsh-tui` (симлинк-ферма; `.ssh`, `.gitconfig`
   сохраняются);
2. собирает overlay ряда `dsh-tui` из **его же** config, меняя только
   provider/model/effort;
3. проверяет собранный row и резолвер TUI на изолированном HOME;
4. пишет `launch.sh` и `resolved.json`.

`DSH_HOME` (профиль и credentials) не подменяется.

## Установка

Нужен Python 3, PyYAML и установленный DSH.

```bash
install -d ~/.local/share/dsh-launch ~/.local/bin
install -m 755 launcher/dsh-launch/ds launcher/dsh-launch/dsh-worker-launch.py ~/.local/share/dsh-launch/
ln -sf ~/.local/share/dsh-launch/ds ~/.local/bin/ds
```

`dsh-worker-launch.py` ищет пресеты в `--preset`, затем в
`<repo>/.dsh/presets` и `<cwd>/.dsh/presets`; для установки вне репозитория
передавай `--preset` явно.

## Использование

```bash
ds <role> <provider>/<model>[:<effort>] [-- <dsh args>]

ds worker provider-a/model-a:high
ds worker provider-a/model-a --effort high
ds worker provider-a/model-a:high --print
```

Роль задаёт `DSH_TUI_PRESET` и ищет `.dsh/presets/all.patch.yml` /
`.dsh/presets/<role>.patch.yml`. Если роль не нужна: `--no-preset`.

Полезные флаги:

- `--print` — только `LAUNCH_CMD=…` и решение, без запуска;
- `--launch-dir` — явный каталог (по умолчанию уникальный
  `~/.dsh-launches/<role>-<UTC>-<random>`);
- `--dsh` — путь к бинарю;
- `--profile` — профиль DSH (по умолчанию `tui`);
- `--preset` — patch-файл пресетов, можно несколько.

## Результат

В каталоге запуска:

```text
launch.sh
resolved.json
model.patch.yml
home/
```

`resolved.json` содержит provider/model/effort, role/profile/presets,
`startupRoute`, `effectiveEffort`, `persistedModelPref`,
`persistedEffortPref`, `settingsEffortDefault`.

## Ограничения

- Провайдер/модель/effort должны быть объявлены в каталоге DSH; иначе отказ
  `MODEL_ROUTE_UNKNOWN`/`UNSUPPORTED_REASONING_EFFORT`.
- Роль должна быть собрана как `preset-<role>`; иначе `PRESET_NOT_COMPOSED`.
- Launcher — отдельный слой; не смешивай его с `DSH_TUI_MODEL_ROUTE` в одном
  запуске, пока env не встроен в launcher и не валидируется.
- Живой TUI/сеть не запускаются: проверки идут через `dsh --dump-config`.
