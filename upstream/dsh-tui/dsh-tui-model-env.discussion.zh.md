# [建议] 增加 `DSH_TUI_MODEL_ROUTE` / `DSH_TUI_EFFORT` 启动级覆盖（默认仍遵循 `/model` 的 last-used）

感谢维护 dsh-TUI。这是一个与「渲染行数」无关的独立建议：给部署/启动器一个**显式**的模型与 effort 覆盖入口，默认行为完全不变。

## 现象

`dsh --profile tui --patch ...` 和 `DSH_TUI_PRESET=<role>` 目前都无法固定一个新 worker 的 provider/model/effort：

- `~/.dsh-tui/model.json`（`/model` 的 last-used 选择）整体优先于 cordis.yml 里的 `provider`/`model`；
- `~/.dsh-tui/effort.json` 与 `settings.json` 的 `dsh-tui.effortDefault` 优先于 cordis.yml 的 `effort`；
- 角色 preset 只影响 persona/工具，不决定模型。

结果：部署方想「这次启动就用 X 模型跑 Y 角色」，只能：

1. 隔离整个 `HOME`（例如符号链接农场，排除 `.dsh-tui`）——会连带丢掉用户的主题、鼠标、状态栏等 UI 偏好；
2. 再加一个完整的 `dsh-tui` 行 overlay（patch 层替换整个 config，需要重复所有字段，升级时容易漏新字段）。

这能工作，但把「一个启动参数」变成了「隔离整个用户环境」。

## 根因（已验证）

- `src/modelRoute.ts:65` `resolveModelRoute(configured, pref, defaults)`：`pref`（持久 `/model`）整体优先，cordis.yml 只是 deployment default。
- `src/dsh-adapter/plugin.ts:3177` `startupRoutes()` 直接调用 `readModelPref()`，没有环境变量入口。
- `src/effortPrefs.ts:46` `resolveEffortDefault(settingsDefault, configured, persisted)`：`settingsDefault ?? persisted ?? configured`。
- `src/modelRoute.ts` 的注释本身写着：需要固定路由的部署应把值放在「composition reads the environment」的位置，而不是这个 config key。但目前没有这样的 env 入口。

## 建议

增加两个**可选**的启动级环境变量：

```text
DSH_TUI_MODEL_ROUTE=provider/model
DSH_TUI_EFFORT=high
```

语义：

- 设置了 → 对**新会话**优先于持久 `/model` 与 `settings.effortDefault`；
- 未设置 → 保持现在的 last-used 规则，完全不变；
- **resume** 继续使用该会话日志里记录的 route/effort，不被启动 env 改掉；
- 值要按现有 catalog 校验（provider/model/effort 是否存在），非法值不要静默替换成别的模型；
- `/model`、`/effort` 在会话内仍然正常工作。

代码形态可以很小，例如在 `readModelPref` / `resolveEffortDefault` 入口检查环境变量，或者由 `startupRoutes()` 传入一个可选 override：

```diff
+const envRoute = parseModelRoute(process.env.DSH_TUI_MODEL_ROUTE)
+const envEffort = process.env.DSH_TUI_EFFORT?.trim()

 startupRoute: resolveModelRoute(
   configuredRoute,
-  readModelPref(),
+  envRoute ?? readModelPref(),
   harnessDefault,
 )
```

`effort` 则在 `resolveEffortDefault` 的最前面加一行：

```ts
const envEffort = process.env.DSH_TUI_EFFORT?.trim()
if (envEffort) return envEffort
return settingsDefault ?? persisted ?? configured
```

## 为什么值得做

- 启动器/部署方可以「一次启动固定一个路由」，不需要隔离 `HOME`；
- 用户自己的主题、鼠标、状态栏等 `~/.dsh-tui` 偏好得以保留；
- 不需要在每次 dsh-TUI 升级后维护完整 `dsh-tui` 行 overlay；
- 默认路径零变化，普通用户完全感知不到；
- 对 CI、评测、review swarm 等需要可复现模型的场景同样有用。

## 兼容性与测试

- 默认无 env：现有行为与所有测试不变；
- env 只影响新会话，resume 保持会话记录；
- 覆盖值需要和现有 `startupRoutes` 一样经过 catalog 校验；
- 建议测试：env 设置/未设置、非法 provider/model/effort、resume 不被覆盖、`/model` 仍可切换、settings `effortDefault` 与 env 的优先级。
- 文档：README.md / README_ZH.md 的环境变量表（如果项目维护此类表）。

## 关于贡献流程

我不在 `.github/APPROVED_CONTRIBUTORS` 名单里，按 `pr-gate` 不能直接提交实现 PR。如果方向认可，我可以提供完整 patch、聚焦回归脚本与手工验证结果；也可以由维护者开 issue 或转给已批准贡献者。

再次感谢维护者的工作。这个建议不改变任何默认行为，只是给「部署/启动器需要确定性路由」补一个显式的、可审计的入口。

## 适用场景：受管环境（如 Herdr）

这个建议主要针对“启动是程序化的、但使用者仍然在 TUI 里工作”的场景：Herdr/launcher 创建 pane 并启动 `dsh`，启动时没有人在 TUI 里手动输入 `/model`；但之后用户仍然要在同一个 TUI 里交互。启动器需要把“这次用哪个 provider/model/effort”作为**启动意图**传进去。

在受管环境里，启动器本来就能控制子进程环境（`docker exec -e`、shell export、systemd `Environment=`、Herdr `pane run` 等），TUI 会继承这些变量。项目已经有 `DSH_TUI_PRESET`、`DSH_TUI_BACKEND`、`DSH_TUI_RESUME_SESSION` 这类启动级 env，所以用 env 传递 route/effort 与现有模式一致：不需要改 `dsh` 的 CLI 参数解析，也不依赖人在 TUI 里先执行 `/model`。

补充一点：env 本身只是“信封”，需要有代码去读它；没有读取分支时，设置 `DSH_TUI_MODEL_ROUTE` 不会改变任何行为。这正是本提案要补的那一小段代码。

