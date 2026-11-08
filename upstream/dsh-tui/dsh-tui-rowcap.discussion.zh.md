# [建议] 长会话上翻时历史记录在眼前消失：渲染窗口 RENDERED_ROW_CAP 可配置（默认 120）

感谢维护 dsh-TUI。先说结论：这不是要求把常量直接改成 600，而是希望把“渲染窗口”做成可配置项，**默认值保持 120 不变**；需要回看长会话的用户可以自行调到 600。这样既保留现有的性能保护，也不牺牲长会话的可读性。

## 现象

在 fullscreen 长会话（记录数超过 120 条）里：

1. 用滚轮/触控板向上翻，阅读较早的记录；
2. 翻到接近顶部边界（即将出现 `show previous messages (N) · Ctrl+E` 的位置）；
3. 此时运行一个会持续产生新输出的任务，或开始新回合；
4. 最上面的可见记录会一条条“消失”。按 `Ctrl+E`（showAll）后它们又出现。

期望：向上阅读时，已经显示出来的历史不要被新输出顶掉；或者至少可以配置窗口大小。`Ctrl+E` 能恢复，说明渲染层本身支持显示全部记录，只是默认窗口只有 120 条。

## 根因（已验证）

- `src/components/MessageList.tsx:58`：`const RENDERED_ROW_CAP = 120`
- `src/components/MessageList.tsx:537`：`const hiddenCount = rows.length - RENDERED_ROW_CAP`
- `src/components/MessageList.tsx:603-605`：
  ```ts
  const sliced = showAll || hiddenCount <= 0
    ? rows
    : rows.slice(hiddenCount)
  ```
  新记录追加时 `hiddenCount` 增大，`slice` 窗口整体前移，于是最旧的可见行被裁掉。
- `src/components/MessageList.tsx:1534`：`showAll` 为 false 时显示 `show previous messages (N) · Ctrl+E` 分隔条；`Ctrl+E` 走 `showAll`，绕过 120 窗口。
- 另一个上限是 `src/channel/transcript.ts:19` 的 `MAX_ROWS = 600`；超过 600 时 `src/dsh-adapter/channel/transcript.ts` 的 `foldRows` 会折叠最旧的行（只留 preview，session log 仍是完整真源）。所以 120 是“渲染窗口”，600 是“内存/折叠窗口”，两者都不删除历史。

## 建议

**方案 A（推荐，最小改动）**：新增 `renderedRowCap` 配置/设置，默认 120，范围 1..600（或 `MAX_ROWS`）。

- `MessageList` 增加可选 prop `renderedRowCap`，缺省回退 `RENDERED_ROW_CAP`；
- `Chat.tsx` 从 channel/settings 传入；
- `src/settings/definitions.ts` 增加 `kind: 'number'` 的设置项，默认 120；
- `visibleCache` 的 key 加上 `cap`，避免设置变更后窗口缓存不失效；
- 默认 120，行为与现在完全一致；用户显式设为 600 才改变。

**方案 B**：自适应——贴底时 120，向上滚动/离开底部时提升到 600。无需用户配置，交互更好，但逻辑更复杂，需要处理 sticky 状态与窗口切换。

**方案 C**：直接把常量改成 600。不推荐：所有用户默认承担变化，也违背现有 120 作为性能保护的设计。

## 性能

- `MessageList` 已有虚拟滚动，实际挂载的仍是视口内的行；`cap` 只影响 `visibleRows` 的 slice、预扫描和 offsets/margins。
- `Ctrl+E` 的 `showAll` 已经会渲染全部 600 行；`cap = 600` 的负载与现有 `showAll` 相同，而不是把实际渲染量放大 5 倍。
- 默认 120 不变；只有显式设置 600 的用户承担额外开销。
- 我还没有做正式 benchmark。如果维护者需要，我可以在长会话上用仓库现有的性能探针补一组数据。

## 代码草案

```diff
// src/components/MessageList.tsx
 const RENDERED_ROW_CAP = 120

 export function MessageList({
   ...
+  renderedRowCap = RENDERED_ROW_CAP,
   ...
 }) {
-  const hiddenCount = rows.length - RENDERED_ROW_CAP
+  const cap = Math.max(1, renderedRowCap)
+  const hiddenCount = rows.length - cap
   ...
-    visibleCache.showAll !== (showAll || hiddenCount <= 0) ||
+    visibleCache.cap !== cap ||
+    visibleCache.showAll !== (showAll || hiddenCount <= 0) ||
   ...
```

```diff
// src/screens/Chat.tsx
 <MessageList
   ...
+  renderedRowCap={channel.renderedRowCap}
   foldTerminalCommand={channel.foldTerminalCommand}
   ...
 />
```

接线可以完全照 `foldTerminalCommand` 的现有模式：`settings/definitions.ts` 增加 number 项 → `dsh-adapter/plugin.ts` 的 Schema/applyDisplay → `channel/state.ts` 与 `preferences.ts` 增加字段与 setter → `Chat.tsx` 传给 `MessageList`。这样设置页、配置层和持久化都会自动覆盖。

## 兼容性与测试

- 默认 120：现有行为、性能、配置都不变。
- 需要覆盖：默认值、显式 600、`Ctrl+E` showAll、`hiddenCount` 分隔条、设置变更后缓存失效、窄屏/inline/fullscreen。
- 文档：README.md 与 README_ZH.md 的设置说明需要同步。

## 关于贡献流程

我看了 `.github/ISSUE_TEMPLATE/config.yml`：功能建议走 Discussions Ideas，所以我把提案发在这里；如果方向认可，请维护者开 issue 跟踪，或指定已批准的贡献者。

我不在 `.github/APPROVED_CONTRIBUTORS` 名单里，按 `pr-gate` 不能直接提交实现 PR。如果这个方向值得做，我可以提供完整 patch、聚焦回归脚本，以及在 inline/fullscreen 和窄终端下的手动验证结果；也可以由维护者转交给合适的贡献者。

再次感谢维护者的工作。120 这个上限本身是合理的性能保护，这里只是希望让长会话用户能自行选择窗口大小。
