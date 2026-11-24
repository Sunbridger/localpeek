# LocalPeek

[![CI](https://github.com/Sunbridger/localpeek/actions/workflows/ci.yml/badge.svg)](https://github.com/Sunbridger/localpeek/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

LocalPeek 是一个面向本机开发的 macOS 桌面工具：发现并只读浏览本地 Redis / MySQL，
识别正在运行的 Web 开发服务，查看进程与实时日志。Electron + React + TypeScript + Ant Design。

> LocalPeek is a macOS desktop companion for local development. It discovers local Redis / MySQL
> instances and dev servers, then lets you browse data, inspect processes and tail logs in one place.

## 安装

当前发布 macOS arm64（Apple Silicon）未签名构建：

1. 从 [Releases](https://github.com/Sunbridger/localpeek/releases) 下载 dmg，或本地构建：
   ```bash
   npm install
   npm run dist
   ```
2. 产物在 `release/LocalPeek-<version>-arm64.dmg`。
3. 未签名应用首次打开需右键 → 打开（或「系统设置 → 隐私与安全性」中允许）。
4. Intel Mac 需自行调整 `electron-builder.yml` 与 `electronDist` 后构建；本轮不提供 x64 产物。

## 功能

- 自动扫描常见数据库端口与区间，叠加 `docker ps` / `docker inspect` 识别容器、端口映射与容器内密码；
  用 `lsof` 区分本机进程 / SSH 端口转发 / Docker
- 手动添加任意 host 的 MySQL / Redis 连接，可测试连接
- MySQL：实例 → 库 → 表树；分页、总行数、WHERE、关键词搜索、列排序、字段与索引；
  按表记忆排序、分页、筛选与「数据 / 结构」页签；长字段可点击在底部面板查看完整内容，
  支持字符串 / JSON 视图、折叠与复制
- Redis：db 切换（数量可配置）、SCAN 过滤与翻页、Key / Value / 类型 / TTL / 内存列表；
  Value 列展示 string 预览（长值 / JSON 点击查看详情），集合显示数量摘要；
  hash / list / set / zset / stream 以表格展开，支持字符串 / JSON 视图
- Web 应用：HTTP 探测本机开发服务，解析项目名、前端 / 后端角色、页面标题、进程与 PID；
  多进程监听同一端口时聚合展示；支持打开、关闭、按历史命令重启
- 实时日志：点击「进程」在底部打开日志区，最多并排 4 个面板，可拖动分隔条与最小宽度；
  长行随面板宽度换行；终端启动的进程可一键重启并捕获输出
- 可拖动布局、跟随系统 / 浅色 / 深色主题、重新扫描不打断当前页面
- 只读：MySQL 只生成单条 SELECT；例外是用户确认后的「关闭端口 / 启动服务」

## 配置

设置在配置文件的 `settings` 字段中调整，重启后生效。macOS 下默认位置：

```
~/Library/Application Support/LocalPeek/localpeek-config.json
```

实际路径可在应用「设置 → 本地数据」查看。旧版 `localdb-config.json` 会在首次启动时自动迁移。

```jsonc
{
  "version": 2,
  "settings": {
    "scanHost": "127.0.0.1",
    "projectRoots": ["mycode", "code"],
    "dbPorts": [3306, 3307, 3308, 6379, 6380, 6479],
    "dbPortRanges": [[3300, 3400], [6300, 6400]],
    "webPortRanges": [[1234, 1240], [3000, 3100], [4000, 4100], [4173, 4180], [4200, 4300], [4321, 4330], [5000, 5100], [5170, 5200], [5500, 5510], [6000, 6100], [7000, 7100], [8000, 8100], [8880, 8900], [9000, 9100], [9200, 9300]],
    "redisDbs": 16,
    "webHistoryLimit": 50
  }
}
```

- 数组字段整体替换默认值；非法值回退默认。
- `projectRoots` 用于从路径 `/mycode/<项目>/`、`/code/<项目>/` 中提取项目名。
- `redisDbs` 为 Redis 逻辑库数量（1–64），`webHistoryLimit` 为离线端口历史条数（1–500）。
- 自动扫描主机、端口与区间只在主进程使用；手动连接始终可指定任意 host。

## 安全说明

- 数据库凭据以 **0600 权限的明文**保存在上述配置文件，未接入系统钥匙串。请勿在多用户机器上使用。
- 「关闭端口 / 启动服务 / 重启并捕获输出」会在确认后执行本机 shell 命令并发送信号；
  仅对可信的本机进程使用。
- 日志读取只针对当前用户进程 fd 指向的普通文件。
- 详见 [SECURITY.md](SECURITY.md)。

## 开发

要求：macOS、Node.js >= 20.19、npm。

```bash
npm install
npm run dev        # 开发模式（打开窗口）
npm test           # 单元测试
npm run typecheck  # 主进程 + 渲染层类型检查
npm run build      # 构建到 out/
npm run dist       # 打包 arm64 未签名 dmg 到 release/
```

开发自检（无窗口）：

```bash
LOCALPEEK_SMOKE=1 ./node_modules/.bin/electron out/main/index.js
LOCALPEEK_CAPTURE=/tmp/shot.png LOCALPEEK_CAPTURE_TARGET=redis-value \
  ./node_modules/.bin/electron out/main/index.js
```

截图目标依赖本机夹具，可用环境变量覆盖，例如
`LOCALPEEK_CAPTURE_MYSQL_INSTANCE`、`LOCALPEEK_CAPTURE_MYSQL_DATABASE`、
`LOCALPEEK_CAPTURE_MYSQL_TABLE`、`LOCALPEEK_CAPTURE_REDIS_INSTANCE`。
旧变量名 `LOCALDB_*` 仍兼容一版。

网络受限时可先执行：

```bash
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ node node_modules/electron/install.js
```

打包如需镜像：`ELECTRON_BUILDER_BINARIES_MIRROR=... npm run dist`。

## 已知限制

- 当前仅支持 macOS arm64；Linux / Windows 尚未实现。
- Docker / SSH 转发进程、非当前用户进程只展示，不可关闭；其日志也不可读取。
- 终端里直接启动的进程输出只存在 pty 中，LocalPeek 无法事后读取；可由应用重启以捕获输出。
- 日志只推送以换行结尾的完整行；单行超过 4000 字符会截断，最多保留最后 200 行。
- 单次运行期间端口日志文件不轮转，每次启动截断；长时间高频输出会让文件持续增长。
- Redis 单集合最多 1000 条、string 最多 256 KB；MySQL 总行数来自 `COUNT(*)`，超大表可能较慢。
- 应用未签名、未公证；dmg 体积主要来自 Electron 运行时。

## 贡献

欢迎提交 Issue / PR，见 [CONTRIBUTING.md](CONTRIBUTING.md)。安全问题请按
[SECURITY.md](SECURITY.md) 私密报告。

## 许可证

[MIT](LICENSE) © 2026 Sunbridger
