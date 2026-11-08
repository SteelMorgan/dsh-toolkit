#!/usr/bin/env python3
"""Готовит детерминированный запуск DSH-работника: изолированный HOME и patch-наложение ряда `dsh-tui`.

Зачем. Выбор provider/model/effort у TUI складывается из persist-настроек (`~/.dsh-tui/model.json`,
`effort.json`, `settings.json`), которые лежат ВЫШЕ любого per-launch наложения. Поэтому
`DSH_TUI_PRESET=<роль> dsh --profile tui --patch .dsh/presets/all.patch.yml` не фиксирует маршрут:
новая сессия молча получает чужую сохранённую модель. Роль-пресет к выбору модели отношения не имеет.

Что делает инструмент:
  1. читает каталог провайдеров из собранной конфигурации запуска и отказывает, если запрошенный
     маршрут или уровень effort в нём не объявлены (код отказа сохраняет имя `UNSUPPORTED_REASONING_EFFORT`);
  2. собирает изолированный HOME (симлинки на настоящий дом за вычетом `.dsh-tui`), из-за чего
     persist-настройки TUI для этого запуска не существуют;
  3. строит наложение `--patch` для ряда `dsh-tui` копией ЕГО ЖЕ собранного config с заменой
     только provider/model/effort (патч-слой заменяет config ряда целиком, а не сливает:
     сокращённая запись теряет fullscreen/terminalImages/привязки `DSH_TUI_*`);
  4. проверяет результат до запуска: собранный ряд совпадает с запрошенным, и резолвер TUI
     (`resolveModelRoute`/`readEffortPref`) на этом HOME выдаёт ровно запрошенный маршрут;
  5. пишет `<каталог>/launch.sh` — единственную команду, которую нужно выполнить в панели.

Отказ всегда с кодом и объяснением в stderr; ничего не запускается и не подменяется «на всякий случай»,
а каталог запуска, созданный самим инструментом, при отказе удаляется — недоделанный запуск не остаётся.
По умолчанию каждый запуск получает НОВЫЙ каталог (`mkdtemp` под `~/.dsh-launches`): два параллельных
запуска одной роли в одну секунду не делят HOME, наложение и `resolved.json`. Явный `--launch-dir`
сохраняется, но существующий каталог считается чужим и при отказе не удаляется.

Повседневная короткая форма — `tools/ds` (симлинк `~/.local/bin/ds`): он оставляет у вызывающего только
обязательные параметры `ds <роль> <маршрут>[:<effort>]`, подставляет профиль, пресеты и каталог запуска,
а затем сам исполняет `launch.sh`. Этот инструмент остаётся точкой правды и годится для отладки
и для проверок регрессии.
"""
import argparse
import errno
import json
import os
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
HOME_SKIP = {'.dsh-tui'}
DSH_ROW = 'dsh-tui'
EFFORT_ORDER = ['off', 'low', 'medium', 'high', 'xhigh', 'max']
CREATED_LAUNCH_DIR = None


class Expr(str):
    """Выражение `!!js` из конфигурации: переносится в наложение байт-в-байт, не вычисляется."""


class Loader(yaml.SafeLoader):
    pass


class Dumper(yaml.SafeDumper):
    pass


Loader.add_constructor('tag:yaml.org,2002:js', lambda loader, node: Expr(loader.construct_scalar(node)))
Dumper.add_representer(Expr, lambda dumper, value: dumper.represent_scalar('tag:yaml.org,2002:js', value))


class Refusal(Exception):
    def __init__(self, code, detail, hint=None):
        super().__init__(detail)
        self.code = code
        self.detail = detail
        self.hint = hint

    def report(self):
        lines = [f'dsh-worker-launch: ОТКАЗ {self.code}', f'  причина: {self.detail}']
        if self.hint:
            lines.append(f'  что делать: {self.hint}')
        return '\n'.join(lines)


def allocate_default_launch_dir(real_home, role, now=None):
    """Новый уникальный каталог запуска.

    `mkdtemp` атомарно резервирует имя и добавляет случайный суффикс, поэтому два параллельных
    запуска одной роли в одну и ту же секунду получают разные каталоги. Секунда в имени остаётся
    только для читаемости: на неё не опирается ни уникальность, ни очистка.
    """
    stamp = (now or datetime.now(timezone.utc)).strftime('%Y%m%dT%H%M%SZ')
    root = Path(real_home) / '.dsh-launches'
    root.mkdir(parents=True, exist_ok=True)
    return Path(tempfile.mkdtemp(prefix=f'{role or "worker"}-{stamp}-', dir=root))


def dsh_binary(explicit):
    candidate = explicit or os.environ.get('DSH_BIN') or shutil.which('dsh')
    if not candidate:
        raise Refusal('DSH_BINARY_NOT_FOUND', 'исполняемый файл dsh не найден',
                      'укажите --dsh <путь> или положите dsh в PATH')
    return candidate


def dump_config(dsh, profile, patches, home):
    argv = [dsh, '--profile', profile]
    for patch in patches:
        argv += ['--patch', str(patch)]
    argv.append('--dump-config')
    env = dict(os.environ, HOME=str(home))
    completed = subprocess.run(argv, capture_output=True, text=True)
    if completed.returncode != 0:
        raise Refusal('CONFIG_DUMP_FAILED', f'`{" ".join(argv)}` завершился с кодом {completed.returncode}: '
                                           f'{(completed.stderr or "").strip()[-800:]}',
                      'проверьте профиль, пути --patch и версию dsh')
    try:
        rows = yaml.load(completed.stdout, Loader=Loader)
    except yaml.YAMLError as error:
        raise Refusal('CONFIG_DUMP_UNREADABLE', f'собранная конфигурация не разбирается как YAML: {error}')
    if not isinstance(rows, list):
        raise Refusal('CONFIG_DUMP_UNREADABLE', 'собранная конфигурация не является списком рядов')
    return rows


def find_row(rows, row_id):
    for row in rows:
        if isinstance(row, dict) and row.get('id') == row_id:
            return row
    return None


def row_config(rows, row_id):
    row = find_row(rows, row_id)
    if row is None or not isinstance(row.get('config'), dict):
        raise Refusal('DSH_ROW_MISSING', f'в собранной конфигурации нет ряда `{row_id}` с config',
                      'проверьте, что профиль включает @deepseek-harness-tui/dsh-tui')
    return row['config']


def catalog(rows):
    """{provider: {model: [tiers]}} из ряда с объявлением провайдеров."""
    table = {}
    for row in rows:
        config = row.get('config') if isinstance(row, dict) else None
        providers = config.get('providers') if isinstance(config, dict) else None
        if not isinstance(providers, dict):
            continue
        for name, provider in providers.items():
            models = provider.get('models') if isinstance(provider, dict) else None
            if not isinstance(models, list):
                continue
            for model in models:
                if not isinstance(model, dict) or 'id' not in model:
                    continue
                declared = model.get('reasoningEfforts')
                tiers = list(declared.keys()) if isinstance(declared, dict) else []
                table.setdefault(name, {})[model['id']] = tiers
    if not table:
        raise Refusal('CATALOG_EMPTY', 'в собранной конфигурации нет ряда с config.providers[*].models',
                      'проверьте, что профиль включает llm-провайдеров')
    return table


def validate_route(table, provider, model, effort):
    if provider not in table:
        raise Refusal('MODEL_ROUTE_UNKNOWN', f'провайдер `{provider}` не объявлен в конфигурации',
                      'объявлены: ' + ', '.join(sorted(table)))
    models = table[provider]
    if model not in models:
        raise Refusal('MODEL_ROUTE_UNKNOWN', f'модель `{model}` не объявлена у провайдера `{provider}`',
                      'объявлены: ' + ', '.join(f'{provider}/{name}' for name in models))
    tiers = models[model]
    if effort is None:
        return tiers
    if effort not in tiers:
        offered = ', '.join(t for t in EFFORT_ORDER if t in tiers) or 'нет'
        raise Refusal('UNSUPPORTED_REASONING_EFFORT',
                      f'модель `{provider}/{model}` не предлагает effort `{effort}`; предложено: {offered}',
                      'запросите один из предложенных уровней — молчаливое понижение запрещено')
    return tiers


def validate_inherited_effort(tiers, inherited, provider, model):
    """Модель могла не объявлять effort, который ряд получает по наследству от профиля.

    Такой запуск упал бы уже в рантайме (`UNSUPPORTED_REASONING_EFFORT` от llm-слоя); отказ
    до запуска оставляет ту же причину, но без потерянной сессии и без молчаливой подмены уровня.
    """
    if not isinstance(inherited, str) or not tiers or inherited in tiers:
        return
    offered = ', '.join(tier for tier in EFFORT_ORDER if tier in tiers) or 'нет'
    raise Refusal('UNSUPPORTED_REASONING_EFFORT',
                  f'ряд `{DSH_ROW}` передаёт effort `{inherited}` по наследству от профиля, а модель '
                  f'`{provider}/{model}` его не объявляет; предложено: {offered}',
                  'укажите --effort из предложенных уровней — молчаливое понижение запрещено')


def build_home(real_home, target):
    if target.exists() and not target.is_dir():
        raise Refusal('HOME_TARGET_BLOCKED', f'{target} существует и не является каталогом')
    target.mkdir(parents=True, exist_ok=True)
    linked = 0
    for name in sorted(os.listdir(real_home)):
        if name in HOME_SKIP:
            continue
        source = real_home / name
        destination = target / name
        if destination.is_symlink() or destination.exists():
            continue
        os.symlink(source, destination)
        linked += 1
    if (target / '.dsh-tui').exists():
        raise Refusal('HOME_NOT_ISOLATED', f'{target}/.dsh-tui существует: persist-настройки TUI видны запуску',
                      'укажите новый --launch-dir или удалите этот каталог')
    return linked


def overlay_rows(base_config, provider, model, effort):
    """Копия собранного ряда с заменой маршрута.

    effort=None означает «оставить как в базовом ряду», а не «снять»: снятие молча перевело бы
    запуск на дефолт модели, то есть дало бы другой effort, чем у обычного `dsh --profile tui`.
    """
    config = dict(base_config)
    config['provider'] = provider
    config['model'] = model
    if effort is not None:
        config['effort'] = effort
    return [{'id': DSH_ROW, 'config': config}]


def write_yaml(path, data):
    text = yaml.dump(data, Dumper=Dumper, sort_keys=False, allow_unicode=True, default_flow_style=False)
    path.write_text(text, encoding='utf-8')
    path.chmod(0o600)


RESOLVER = r"""
const fs = require('node:fs');
const path = require('node:path');
const pkg = process.env.PROBE_TUI_PKG;
const spec = JSON.parse(process.env.PROBE_SPEC);
const load = async (name) => import('file://' + path.join(pkg, 'lib/types', name));
(async () => {
  const route = await load('modelRoute.js');
  const modelPrefs = await load('modelPrefs.js');
  const effortPrefs = await load('effortPrefs.js');
  let settingsEffortDefault;
  try {
    const file = path.join(process.env.HOME, '.dsh-tui', 'settings.json');
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    settingsEffortDefault = (parsed.values || {}).effortDefault;
  } catch (error) {
    settingsEffortDefault = undefined;
  }
  if (settingsEffortDefault === 'auto') settingsEffortDefault = undefined;
  const persistedModelPref = modelPrefs.readModelPref();
  const persistedEffortPref = effortPrefs.readEffortPref();
  const startupRoute = route.resolveModelRoute(
    { provider: spec.rowProvider, model: spec.rowModel },
    persistedModelPref,
    route.DEFAULT_MODEL_ROUTE,
  );
  console.log(JSON.stringify({
    persistedModelPref: persistedModelPref ?? null,
    persistedEffortPref: persistedEffortPref ?? null,
    settingsEffortDefault: settingsEffortDefault ?? null,
    startupRoute,
    // порядок TUI при старте: сохранённый /effort перекрывает effort ряда (model-actions.js)
    bootEffort: persistedEffortPref ?? spec.rowEffort ?? null,
    // /settings effortDefault применяется поверх, если задан явно
    effectiveEffort: settingsEffortDefault ?? persistedEffortPref ?? spec.rowEffort ?? null,
  }));
})().catch((error) => {
  console.error('PROBE_FAILED ' + (error && error.stack ? error.stack : error));
  process.exit(1);
});
"""


def resolve_startup(launch_dir, tui_pkg, home, row_provider, row_model, row_effort):
    script = launch_dir / 'resolve-route.cjs'
    script.write_text(RESOLVER, encoding='utf-8')
    spec = {'rowProvider': row_provider, 'rowModel': row_model,
            'rowEffort': row_effort if isinstance(row_effort, str) else None}
    env = dict(os.environ, HOME=str(home),
               PROBE_TUI_PKG=str(tui_pkg),
               PROBE_SPEC=json.dumps(spec))
    completed = subprocess.run(['node', str(script)], capture_output=True, text=True, env=env)
    if completed.returncode != 0:
        raise Refusal('RESOLVER_FAILED', (completed.stderr or completed.stdout).strip()[-800:],
                      'проверьте версию @deepseek-harness-tui/dsh-tui и наличие node в PATH')
    try:
        return json.loads(completed.stdout.strip().splitlines()[-1])
    except (ValueError, IndexError):
        raise Refusal('RESOLVER_FAILED', f'резолвер вернул неожиданный вывод: {completed.stdout.strip()[-400:]}')


def tui_package(dsh_home, profile):
    candidate = Path(dsh_home) / 'profiles' / profile / 'node_modules' / '@deepseek-harness-tui' / 'dsh-tui'
    if not (candidate / 'lib' / 'types' / 'modelRoute.js').is_file():
        raise Refusal('DSH_TUI_PACKAGE_MISSING',
                      f'не найден пакет TUI: {candidate}/lib/types/modelRoute.js',
                      'проверьте DSH_HOME и --profile')
    return candidate


def write_launcher(path, home, dsh_home, dsh, profile, presets, overlay, role):
    lines = ['#!/usr/bin/env bash', 'set -euo pipefail', '# сгенерировано tools/dsh-worker-launch.py',
             f'export HOME={sh_quote(str(home))}', f'export DSH_HOME={sh_quote(str(dsh_home))}']
    if role:
        lines.append(f'export DSH_TUI_PRESET={sh_quote(role)}')
    argv = [sh_quote(dsh), '--profile', sh_quote(profile)]
    for preset in presets:
        argv += ['--patch', sh_quote(str(preset))]
    argv += ['--patch', sh_quote(str(overlay)), '"$@"']
    lines.append('exec ' + ' '.join(argv))
    path.write_text('\n'.join(lines) + '\n', encoding='utf-8')
    path.chmod(0o755)


def sh_quote(value):
    return "'" + value.replace("'", "'\\''") + "'"


def main():
    global CREATED_LAUNCH_DIR
    parser = argparse.ArgumentParser(
        description='Готовит детерминированный запуск DSH-работника с фиксированным provider/model/effort.')
    parser.add_argument('--provider', required=True, help='id провайдера из каталога DSH')
    parser.add_argument('--model', required=True, help='id модели из каталога DSH')
    parser.add_argument('--effort', help='уровень effort; проверяется по каталогу моделей')
    parser.add_argument('--role', help='роль DSH: уходит в DSH_TUI_PRESET и выбирает patch пресетов')
    parser.add_argument('--profile', default='tui', help='профиль dsh (по умолчанию tui)')
    parser.add_argument('--preset', action='append', default=[], metavar='PATH',
                        help='patch-файл пресетов (можно несколько); по умолчанию ищется .dsh/presets/all.patch.yml')
    parser.add_argument('--no-preset', action='store_true', help='не подключать patch пресетов')
    parser.add_argument('--launch-dir',
                        help='каталог запуска (по умолчанию — новый уникальный ~/.dsh-launches/<роль>-<UTC>-<random>)')
    parser.add_argument('--dsh', help='путь к dsh (по умолчанию из PATH)')
    parser.add_argument('--json', action='store_true', help='вывести результат одним JSON')
    arguments = parser.parse_args()

    real_home = Path(os.path.expanduser('~'))
    dsh_home = Path(os.environ.get('DSH_HOME') or (real_home / '.dsh'))
    dsh = dsh_binary(arguments.dsh)

    if arguments.launch_dir:
        launch_dir = Path(arguments.launch_dir).expanduser().resolve()
        try:
            launch_dir.mkdir(parents=True)
        except FileExistsError:
            if not launch_dir.is_dir():
                raise Refusal('PATH_CONFLICT', f'{launch_dir} существует и не является каталогом',
                              'укажите другой каталог в --launch-dir')
            # Существующий каталог задан явно: он не создан этим процессом, поэтому при отказе
            # не удаляется. Право на очистку даёт только собственное создание.
        else:
            CREATED_LAUNCH_DIR = launch_dir
    else:
        launch_dir = allocate_default_launch_dir(real_home, arguments.role)
        CREATED_LAUNCH_DIR = launch_dir
    home = launch_dir / 'home'

    presets = [Path(item).resolve() for item in arguments.preset]
    if arguments.role and not presets and not arguments.no_preset:
        for candidate in (ROOT / '.dsh/presets/all.patch.yml', ROOT / f'.dsh/presets/{arguments.role}.patch.yml',
                          Path.cwd() / '.dsh/presets/all.patch.yml',
                          Path.cwd() / f'.dsh/presets/{arguments.role}.patch.yml'):
            if candidate.is_file():
                presets = [candidate.resolve()]
                break
        else:
            raise Refusal('PRESET_PATCH_MISSING',
                          f'роль `{arguments.role}` задана, но patch пресетов не найден',
                          'укажите --preset <файл> или --no-preset, если персона роли не нужна')
    for preset in presets:
        if not preset.is_file():
            raise Refusal('PRESET_PATCH_MISSING', f'файл пресетов не найден: {preset}')

    if not launch_dir.exists():
        CREATED_LAUNCH_DIR = launch_dir
    launch_dir.mkdir(parents=True, exist_ok=True)
    build_home(real_home, home)

    base_rows = dump_config(dsh, arguments.profile, presets, home)
    base_config = row_config(base_rows, DSH_ROW)
    table = catalog(base_rows)
    tiers = validate_route(table, arguments.provider, arguments.model, arguments.effort)
    if arguments.effort is None:
        validate_inherited_effort(tiers, base_config.get('effort'), arguments.provider, arguments.model)

    overlay = launch_dir / 'model.patch.yml'
    write_yaml(overlay, overlay_rows(base_config, arguments.provider, arguments.model, arguments.effort))

    applied_rows = dump_config(dsh, arguments.profile, presets + [overlay], home)
    applied_config = row_config(applied_rows, DSH_ROW)
    expected = dict(base_config)
    expected['provider'] = arguments.provider
    expected['model'] = arguments.model
    if arguments.effort is not None:
        expected['effort'] = arguments.effort
    mismatched = sorted(key for key in set(expected) | set(applied_config)
                        if expected.get(key) != applied_config.get(key))
    if mismatched:
        raise Refusal('OVERLAY_NOT_APPLIED',
                      f'собранный ряд `{DSH_ROW}` расходится с ожидаемым по полям: {", ".join(mismatched)}',
                      'патч-слой заменяет config ряда целиком: наложение должно повторять все поля')

    if arguments.role and presets:
        preset_row = find_row(applied_rows, f'preset-{arguments.role}')
        if preset_row is None:
            raise Refusal('PRESET_NOT_COMPOSED', f'в собранной конфигурации нет ряда `preset-{arguments.role}`',
                          'проверьте, что --preset указывает на патч с этой ролью')

    startup = resolve_startup(launch_dir, tui_package(dsh_home, arguments.profile), home,
                              applied_config.get('provider'), applied_config.get('model'),
                              applied_config.get('effort'))
    requested = {'provider': arguments.provider, 'model': arguments.model}
    if startup['startupRoute'] != requested:
        raise Refusal('MODEL_SELECTION_NOT_DETERMINISTIC',
                      f'резолвер выбрал {startup["startupRoute"]} вместо запрошенных {requested}',
                      'persist-настройки TUI видны запуску; проверьте, что HOME изолирован')
    if arguments.effort and startup['effectiveEffort'] != arguments.effort:
        raise Refusal('MODEL_SELECTION_NOT_DETERMINISTIC',
                      f'effort на старте {startup["effectiveEffort"]!r} вместо запрошенного {arguments.effort!r}',
                      'persist-настройки TUI видны запуску; проверьте, что HOME изолирован')

    launcher = launch_dir / 'launch.sh'
    write_launcher(launcher, home, dsh_home, dsh, arguments.profile, presets, overlay, arguments.role)

    result = {
        'provider': arguments.provider,
        'model': arguments.model,
        'effort': arguments.effort,
        'effort_tiers': tiers,
        'role': arguments.role,
        'profile': arguments.profile,
        'launch_dir': str(launch_dir),
        'home': str(home),
        'dsh_home': str(dsh_home),
        'presets': [str(item) for item in presets],
        'overlay': str(overlay),
        'launch_cmd': f'bash {launcher}',
        'startup': startup,
    }
    state = launch_dir / 'resolved.json'
    state.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    state.chmod(0o600)

    if arguments.json:
        print(json.dumps(result, ensure_ascii=False))
        return 0
    print(f'dsh-worker-launch: {arguments.provider}/{arguments.model}'
          + (f' effort={arguments.effort}' if arguments.effort else '')
          + (f' роль={arguments.role}' if arguments.role else ''))
    print(f'  изолированный HOME: {home}')
    print(f'  persist-настройки TUI: model={startup["persistedModelPref"]} '
          f'effort={startup["persistedEffortPref"]} (не влияют)')
    print(f'  маршрут на старте: {startup["startupRoute"]["provider"]}/{startup["startupRoute"]["model"]} '
          f'effort={startup["effectiveEffort"]}')
    print(f'  наложение: {overlay}')
    print(f'  каталог запуска: {launch_dir}')
    print(f'LAUNCH_CMD=bash {launcher}')
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Refusal as refusal:
        if CREATED_LAUNCH_DIR is not None:
            shutil.rmtree(CREATED_LAUNCH_DIR, ignore_errors=True)
        print(refusal.report(), file=sys.stderr)
        sys.exit(2)
    except OSError as error:
        if error.errno == errno.EEXIST:
            print(f'dsh-worker-launch: ОТКАЗ PATH_CONFLICT\n  причина: {error}', file=sys.stderr)
            sys.exit(2)
        raise