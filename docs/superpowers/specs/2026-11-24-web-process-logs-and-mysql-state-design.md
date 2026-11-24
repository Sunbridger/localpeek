# Web 进程实时日志 + MySQL 表视图交互记忆 设计

日期：2026-11-24
状态：已实现（2026-11-24）

## 1. 意图与原因

两个日常使用痛点：

1. **Web 应用面板**：用户需要反复切到终端看本地服务的启动/请求日志。希望在面板内点击某个端口行的「进程」就直接看到该端口进程的实时输出，再次点击收起，最多展示最后 200 行；日志面板常驻，持续实时追加。
2. **MySQL 表视图**：排序、分页、筛选、页签等操作在切表或离开后全部丢失，每次回来都要重新设置。希望按「实例 + 库 + 表」记住用户上次的交互状态，离开再回来原样恢复。

## 2. 目标与非目标

### 目标

- 点击 Web 应用表格中某行的「进程」单元格，在面板底部打开该端口的实时日志区；再次点击同一端口关闭，点击其他端口切换。
- 日志区最多保留最后 200 行，持续实时追加，默认自动跟随到底部。
- 支持的日志来源：
  - LocalPeek 启动的进程（每端口独立日志文件）；
  - stdout/stderr 已重定向到普通文件的进程（自动探测 fd 1/2）；
  - 已离线的端口：展示该端口上次启动留下的日志文件。
- 不可读时明确说明原因；若进程可关闭且存在历史启动命令，提供「重启并捕获输出」按钮（确认后按历史命令重启）。
- 展开的日志目标在离开 Web 面板再回来后仍保留；重启应用后也保留。
- MySQL 表视图按表记忆：数据/结构页签、页码、每页行数、关键词（草稿与已应用）、WHERE（草稿与已应用）、排序字段与方向、SQL 面板开关。切表、离开再回来、重启应用后均恢复。
- 排序箭头在恢复后正确显示（受控 `sortOrder`）。

### 非目标

- Docker 容器日志（`docker logs`）、SSH 转发进程日志（用户已明确不选）。
- 日志搜索、过滤、导出、历史归档、多窗口同步。
- 改变进程生命周期：仍以 detached 方式启动，LocalPeek 退出后服务继续运行。
- Redis / 侧边栏展开状态等其它面板的状态持久化（本次不做）。
- 行详情、单元格详情面板的恢复（属于瞬时查看，不持久化）。

### 反目标

- 不经确认就结束用户进程。
- 读取与进程 fd 无关的任意文件；不读取其他用户的受保护文件。
- 因日志功能导致服务在 LocalPeek 退出后异常（不能持有 stdout 管道）。

## 3. 约束与事实

- macOS 下终端启动的进程 stdout/stderr 指向 pty（`/dev/ttysNNN`），外部进程无法读取其输出，也不会落盘（已实测 `node` 的 fd 0/1/2 均为 pty）。
- 能读到输出的途径只有：进程 fd 指向普通文件，或进程由本应用以文件重定向方式启动。
- 现有 `spawnWebEntry` 以 `detached: true` + 文件 fd 启动并 `unref()`；不能改为持有管道，否则 LocalPeek 退出后子进程写 stdout 可能收到 SIGPIPE。
- Web 表格「项目」列使用 `rowSpan` 合并单元格，antd 的 `expandedRowRender` 会插入额外行，破坏合并布局；因此使用底部常驻面板，不使用展开行。
- 应用为单窗口，主进程可向发起订阅的 `webContents` 推送事件。
- 仓库当前不是 git 仓库；设计文档只落在本地，不提交。

## 4. 备选方案与选择

### 日志读取

1. **每端口日志文件 + 主进程增量 tail + IPC 推送（已选）**
   - 启动时把输出写入 `userData/logs/web-<port>.log`；展开时主进程读末尾 200 行作为快照，之后轮询文件增量并推送。
   - 外部进程用 `lsof` 探测 fd 1/2，指向普通文件就复用同一套 tail。
   - 优点：不影响进程生命周期；LocalPeek 重启后仍能继续 tail（运行中的进程 fd 仍指向该文件）；离线时也能看上次日志。
   - 代价：需要文件轮询与订阅管理；只能推送完整行。
2. 主进程持有子进程管道、内存环形缓冲：实时性最好，但 LocalPeek 退出会断管，服务下次写 stdout 可能退出；重启后无历史。放弃。
3. 渲染层每秒轮询：实现最简单，但延迟 1 秒、重复 IPC，且仍需解决日志来源。放弃。

### MySQL 状态存储

1. **渲染层 localStorage，按 `实例|库|表` 记录（已选）**：无新增 IPC，跨重启保留，改动集中在前端。
2. 主进程配置文件：集中持久化，但需新增 IPC、并发写，且与凭据/历史配置混在一起，收益不大。放弃。
3. 仅会话内提升到 App state：切表保留、重启丢失，不满足「离开再回来」。放弃。

### 日志面板位置

- **底部常驻日志区（已选）**：全宽可读长日志，与 MySQL 字段详情面板交互一致；不破坏合并单元格。
- 单元格内展开：位置直观，但列宽约 380px，长日志横向滚动体验差；且单元格高度增长会挤压表格。放弃。

## 5. 设计

### 5.1 日志文件

- 目录：`userData/logs/`（启动时 `mkdir -p`）。
- 文件：`web-<port>.log`，每次启动以截断方式打开并写头部：

  ```
  [2026-11-24T05:32:10.123Z] port=5173 cwd=/Users/me/code/proj
  $ npm run dev
  ```

- 替换现有单一 `web-launch.log`。`startWebProcess` / `startWebProcesses` 的提示文案与 README 中的路径同步更新。
- 单次运行内文件不做轮转；每次重新启动即截断，天然有界。README「已知限制」注明长时间运行可能持续增长。

### 5.2 主进程日志服务（新文件 `src/main/services/webLog.ts`）

纯函数与类，便于单测：

- `stripAnsi(text)`：去除 ANSI 转义序列。
- `sanitizeLine(line)`：去 ANSI、去尾部 `\r`、单行超过 4000 字符截断并加 `…`。
- `readTail(path, maxLines = 200)`：`stat` 后从末尾最多读 512 KB；若从文件中间开始读，丢弃第一段不完整行；按 `\n` 切分；返回最后 `maxLines` 行。文件不存在返回空数组。
- `parseLsofFds(output)`：解析 `lsof -Fn` 输出，返回每个 PID 的普通文件路径列表（过滤 `/dev/*`、`->`、`(deleted)`）。
- `class LogTail`：
  - `start()` 记录当前文件大小作为 offset，每 500 ms 轮询。
  - `pump()`（导出以便测试）：`stat`；文件不存在时等待重建；`size < offset` 视为截断，offset 归零重读；`size > offset` 时读取新增字节，用 `StringDecoder` 处理跨块多字节字符，按行切分并批量回调；末尾不完整的行留在缓冲区，等下一次出现换行再推送。
  - `stop()` 清理定时器。
  - 读取错误（EACCES 等）通过回调报告一次，不刷屏。

### 5.3 日志来源解析（`DbManager`）

`resolveWebLog(port)` 返回 `{ source, path?, reason?, online }`：

1. 在 `this.webApps` 中找到该端口记录，收集 PID（`pids` 或单个 `pid`）。
2. 本会话启动注册表 `this.launchLogs: Map<port, path>`（由 `spawnWebEntry` 写入）：命中且文件存在 → `source: 'launch'`。这是优化路径。
3. 否则执行 `lsof -a -p <pids> -d 1,2 -Fn`（3 秒超时），取第一个满足条件的 `n` 名称：以 `/` 开头、非 `/dev/`、`statSync` 为普通文件 → `source: 'file'`。LocalPeek 重启后，运行中的服务 fd 仍指向自己的日志文件，也会命中这里。
4. 离线端口：若 `logs/web-<port>.log` 存在 → `source: 'launch'`，`online: false`，面板标注「已结束」。
5. 否则 `source: 'unavailable'`，原因为：Docker / SSH 转发、属于其他用户、非 LocalPeek 启动且无文件重定向。

面板展示标签时，若路径等于预期端口日志路径 → 显示「LocalPeek 启动」，否则显示「外部日志文件」。

订阅管理：

- `DbManager` 持有每个端口一个 `LogTail` 与监听者集合；`subscribeWebLog(port, listener)` 解析来源并启动 tail，返回快照 + 来源信息；`unsubscribeWebLog` 移除监听者，最后一个离开时 `stop()`。
- IPC 层按 `event.sender` 记录订阅，窗口 `destroyed` 时自动清理。推送事件 `localpeek:web:logLines`，载荷 `{ port, lines }`。

### 5.4 重启并捕获输出

`DbManager.restartWebProcess(port)`：

- 校验端口在线、`app.killable`、存在历史 `commandLine` + `cwd` 且目录存在。
- 先 `killWebProcesses([{port,pid}])`；若端口仍在线则返回失败。
- 再 `startWebProcesses([port])`，输出写入该端口日志文件。
- 返回 `WebActionResult`（含最新 `webApps`）。渲染层在确认弹窗后才调用。

### 5.5 IPC / preload / 类型

`src/shared/types.ts` 新增：

```ts
export type WebLogSource = 'launch' | 'file' | 'unavailable'

export interface WebLogInfo {
  source: WebLogSource
  path?: string
  reason?: string
  lines: string[]
  online: boolean
}

export interface WebLogLinesEvent {
  port: number
  lines: string[]
}
```

`LocalDbApi.web` 新增：

- `logInfo(port): Promise<WebLogInfo>` — 只解析来源并返回最后 200 行，不订阅。
- `followLog(port): Promise<WebLogInfo>` — 解析 + 订阅，事件推给当前渲染进程。
- `unfollowLog(port): Promise<void>`。
- `restartForLog(port): Promise<WebActionResult>`。
- `onLogLines(cb): () => void` — 返回取消订阅函数（preload 中包装 `ipcRenderer.on` / `removeListener`）。

### 5.6 渲染层 UI

`WebAppsPane`：

- 新增 `logPort: number | null`，持久化到 `localStorage` key `localpeek.webLogPort.v1`；初始化时若该端口不在 `webApps` 中则忽略。
- 「进程」单元格可点击（光标提示、`title` 提示「点击查看实时日志」）：同端口 → 置空；其他端口 → 切到该端口。选中行加高亮类。
- 日志区位于表格下方，使用 antd `Splitter`（垂直、默认 260、最小 140）以便拖动高度；表格区域内部滚动。
- 新组件 `src/renderer/src/components/WebLogPanel.tsx`：
  - `useEffect` 中 `followLog(port)` 拿快照与来源，注册 `onLogLines` 并按 `port` 过滤；卸载或切换端口时 `unfollowLog` 并取消监听。
  - 行缓冲保留最后 200 行；滚动容器判断是否在底部（距底 ≤ 24 px），在底部时新行到达自动滚到底；用户向上滚动后停止跟随并显示「回到最新」按钮。
  - 头部：`:{port} 输出`、来源标签（LocalPeek 启动 / 外部日志文件 / 不可读）、路径 tooltip、PID 列表、`显示 N / 200 行`、复制全部、关闭。
  - 不可读：`Alert` 显示原因；若在线、可关闭且存在历史启动记录 → 「重启并捕获输出」按钮（Popconfirm 说明会先结束进程），成功后重新 `followLog`。
  - 离线：继续展示该端口上次日志，标注「已结束」。
  - 空日志：显示「等待输出…」。
  - 日志样式：等宽字体、12px、`white-space: pre`、纵向与横向滚动、最大高度由 Splitter 控制。

### 5.7 MySQL 表视图状态

新文件 `src/renderer/src/mysqlTableState.ts`：

```ts
export interface MysqlTableUiState {
  view: 'data' | 'structure'
  page: number
  pageSize: number
  keywordInput: string
  whereInput: string
  keyword: string
  where: string
  orderBy?: string
  orderDir: 'asc' | 'desc'
  showSql: boolean
}
```

- storage key：`localpeek.mysqlTableState.v1`；内容 `{ version: 1, entries: Record<string, { state, updatedAt }> }`，表键为 `${instanceId}|${database}|${table}`。
- API：`readTableState(storage, key)`（与默认值合并并逐字段校验）、`patchTableState(storage, key, patch)`（读取、合并、写回并更新 `updatedAt`）、`prune`（超过 200 条按 `updatedAt` 淘汰最旧）。
- 所有读写 `try/catch`，localStorage 不可用时降级为无持久化。
- `MysqlTablePane`：`view` 初始值取自 `readTableState`；切换时 `patchTableState({ view })`。
- `DataView`：现有各 `useState` 的初始值来自同一份读取结果；任一字段变化后用 300 ms 防抖 `patchTableState` 写回。恢复的值包括页码、每页行数、关键词/WHERE 的草稿与已应用值、排序、SQL 面板；行/单元格详情不恢复。
- 排序受控：每个数据列加 `sortOrder: orderBy === name ? (orderDir === 'asc' ? 'ascend' : 'descend') : null`；`onChange` 逻辑保持（取消排序时清空 `orderBy`）。
- 列结构加载后若 `orderBy` 不在当前列中，清除排序，避免非法 `ORDER BY`。
- 查询返回后若 `total !== null` 且当前页超出总页数，自动跳到最后一页（至少第 1 页），避免恢复后空表。

### 5.8 需要更新的文档与提示

- `README.md`：日志面板、每端口日志文件路径 `userData/logs/web-<port>.log`、重启捕获、MySQL 交互记忆；已知限制补充 pty/Docker/SSH 不可读、单行需换行才推送、单次运行日志文件持续增长。
- `startWebProcess` 失败提示中的日志路径改为对应端口文件。
- `capture.ts` 可选新增 `web-log` 目标，用于人工截图验证（非必须）。

## 6. 实现影响

- 主进程：`services/webLog.ts`（新增）、`manager.ts`（启动写入、来源解析、订阅、重启）、`ipc.ts`（新通道）、`config.ts` 不变。
- preload/shared：`types.ts`、`preload/index.ts`、`preload/index.d.ts`。
- 渲染层：`WebAppsPane.tsx`、`WebLogPanel.tsx`（新增）、`MysqlTablePane.tsx`、`mysqlTableState.ts`（新增）、`styles.css`。
- 测试：`test/webLog.test.ts`、`test/mysqlTableState.test.ts`。
- 无新依赖。

## 7. 验证

- `npm test`：tail 读取/截断/ANSI/行截断、lsof 解析、MySQL 状态读写与淘汰。
- `npm run typecheck`、`npm run build`。
- 手动：
  1. LocalPeek 启动一个前端服务 → 点击进程 → 实时滚动；再次点击关闭。
  2. 退出并重开 LocalPeek → 服务仍在线 → 点击进程 → 仍能读取（fd 探测命中）。
  3. 终端以 `> /tmp/dev.log 2>&1` 启动服务 → 点击进程 → 自动 tail 外部文件。
  4. 终端普通启动的服务 → 点击 → 提示不可读 → 重启捕获 → 日志出现。
  5. MySQL 表：设置排序/页码/每页行数/关键词/WHERE/页签 → 切到别的表再回来 → 全部恢复；重启应用再验证一次。

## 8. 实现记录（与设计的差异）

- 去掉了会话内的 `launchLogs` 端口→文件缓存：实测 LocalPeek 重启后运行中的服务 fd 仍指向端口日志文件，
  `lsof` 足够可靠；只信任 fd 探测可避免端口被新进程占用后展示旧日志。离线时才回退到 `web-<port>.log`。
- 只探测当前用户进程的 fd；其他用户的进程即使文件可读也不读取。
- 日志面板按 `port + 在线状态 + PID 集合` 重新解析来源并重新订阅，覆盖退出、被杀、重启、端口被复用等情况。
- `capture.ts` 新增人工/自动截图目标：`web-log`（外部文件 + 展开/收起）、`web-log-restart`（不可读 → 重启捕获）、
  `mysql-state`（排序 → 切表 → 返回并校验恢复）。
- 端到端验证通过：外部重定向文件实时 tail；pty 进程提示不可读并可一键重启捕获；MySQL 排序恢复后 SQL 为
  `ORDER BY id DESC`。

## 9. 扩展：多日志面板（2026-11-24 已实现）

- 底部日志区改为水平嵌套 `Splitter`：点击不同进程依次并排打开，最宽 4 个；已打开时再次点击关闭。
- 超过 4 个时替换最早打开的，并提示替换了哪个端口。面板集合变化时按新集合重排为等宽，可继续拖动分隔条。
- 每个面板 `min=180px`；面板宽度不足时通过容器查询逐级收起路径、PID、行数、在线状态、来源标签。
- 打开集合持久化在 `localpeek.webLogPorts.v1`（数组，最多 4 个），并迁移旧的单端口键；端口从列表消失时自动清理。
- 测试：`toggleLogPort` / `sanitizeLogPorts` 单元测试；`capture.ts` 增加 `web-log-multi`
  目标，验证 4 面板并排、拖动（宽度 265→335）、第 5 个替换最早打开。
- 日志正文改为软换行（`pre-wrap` + `overflow-wrap: anywhere`），拖动分隔条时文字随面板宽度重排，
  不再出现横向滚动；`ResizeObserver` 在仍处于跟随状态时保持滚动到最新行；头部标题、标签与
  操作按钮不换行，路径按可用宽度省略。`capture.ts` 的 `web-log-resize` 目标验证拖动前后
  `scrollWidth === clientWidth`（520/640、400）。

## 10. 扩展：Redis Value 列（2026-11-24 已实现）

- key 列表新增 Value 列：string 用同一次加载的第二次 pipeline 取 `GETRANGE 0..319`，
  最多展示 160 字符；超过 80 字符、含换行或 JSON 前缀的单元格使用 MySQL 同款可点击长单元格，
  点击选中该 key、打开底部详情，JSON 值自动切到 JSON 视图。
- 非 string 类型显示数量摘要：hash/list/set/zset/stream 分别用 HLEN/LLEN/SCARD/ZCARD/XLEN，
  展示「N 个字段 / N 条 / N 个成员 / N 条记录」；已过期 key 显示「已过期」。
- 预览只读、单 key 最多 320 字节，避免列表加载时传输大 value；`test/redisPreview.test.ts`
  覆盖 JSON 判定、截断、多字节边界与摘要文案；`capture.ts` 增加 `redis-value` 目标。

## 11. 留给实现者的决定

- 具体 CSS 类名与日志面板视觉细节。
- 轮询间隔、tail 读取窗口大小、单行长度上限等参数的具体取值（设计给出的数值可直接采用）。
- 是否在 `capture.ts` 增加截图目标。
- 日志面板「复制全部」是否需要额外提示文案。
