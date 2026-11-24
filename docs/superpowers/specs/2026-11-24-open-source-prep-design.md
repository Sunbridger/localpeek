# LocalPeek 开源准备设计

日期：2026-11-24
状态：已实现（2026-11-24）
范围：最小可发布 + 配置抽象（不含 safeStorage、i18n、Linux/Windows 实现）

## 决策

- 名称：LocalPeek；包名 `localpeek`；appId `io.github.sunbridger.localpeek`；
  仓库 `https://github.com/Sunbridger/localpeek`；环境变量前缀 `LOCALPEEK_`。
- 许可证：MIT；版权人 Sunbridger。
- 平台：当前仅 macOS（arm64）。抽出平台层，后续补 Linux / Windows，不在本轮实现。
- 开发自检夹具：环境变量可覆盖，默认值改为通用名称；不再硬编码个人项目。

## 目标

1. 品牌与标识集中：名称、标题、appId、配置文件名、环境变量前缀、仓库/Issue 链接统一在
   `src/shared/appInfo.ts`，改名只改一处。
2. 配置抽象：扫描端口/区间、扫描主机、项目根目录、Redis db 数、Web 历史条数写入
   `localpeek-config.json` 的 `settings`；默认值来自 `src/shared/settings.ts`。
   其余上限（日志 200 行、Redis 预览/详情上限、MySQL 每页档位等）集中到
   `src/shared/limits.ts`。
3. 平台层：`src/main/platform.ts` 统一 shell、lsof、ps 的路径选择；macOS 行为不变，
   Linux 后续只需补实现，Windows 明确不承诺。
4. 路径展示：`SettingsModal` 不再硬编码 `~/Library/Application Support/localdb`，改为主进程
   返回真实路径（userData / config / logs）。
5. 迁移：
   - 旧配置 `localdb-config.json`（以及旧 userData 目录 `localdb` / `Electron`）在首次启动时
     复制到新位置，失败不影响启动。
   - localStorage 键 `localdb-*` / `localdb.*` 迁移到 `localpeek-*` / `localpeek.*`，不覆盖已有新值。
   - 环境变量同时接受 `LOCALPEEK_*` 与旧的 `LOCALDB_*` 一版，方便过渡。
6. 仓库可发布：MIT LICENSE、package 元数据（repository/homepage/bugs/keywords/engines/license）、
   README（安装、平台、配置、安全、贡献）、CONTRIBUTING、SECURITY、.editorconfig、.gitattributes、
   GitHub Actions（macOS 上 test + typecheck + build）。
7. 打包：productName/appId/artifact 改名；`files` 排除 docs、.github、CONTRIBUTING、SECURITY、
   package-lock；仍只构建 macOS arm64（Intel 需自行构建，README 注明）。

## 非目标

- safeStorage / 钥匙串（凭据仍为 0600 明文，SECURITY 与 README 明确说明）。
- i18n、Linux/Windows 的完整发现与启动实现、Intel/Universal 构建、自动更新。
- 为所有常量提供设置界面；设置通过编辑配置文件生效。

## 设置结构

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

数组字段整体替换默认值；逐字段校验，非法值回退默认。`redisDbs` 限制 1–64，
`webHistoryLimit` 限制 1–500。设置只影响发现范围与展示上限，不改变只读语义。

## 影响面

- 主进程：`appInfo.ts`、`settings.ts`、`limits.ts`、`platform.ts`、`config.ts`、`manager.ts`、
  `discovery/scanner.ts`、`discovery/webapps.ts`、`discovery/listeners.ts`、`projectName.ts`、
  `services/webHistory.ts`、`services/webLog.ts`、`services/redis.ts`、`services/redisPreview.ts`、
  `ipc.ts`、`index.ts`、`capture.ts`、`smoke.ts`。
- 共享：`shared/types.ts`（设置与路径 API）。
- 渲染层：`main.tsx`（localStorage 迁移）、`App.tsx`、`index.html`、`api.ts`、`InstancePane.tsx`、
  `SettingsModal.tsx`、`RedisBrowser.tsx`、`WebAppsPane.tsx`、`mysqlTableState.ts`、`legacyStorage.ts`。
- 仓库：`package.json`、`electron-builder.yml`、`README.md`、`LICENSE`、`CONTRIBUTING.md`、
  `SECURITY.md`、`.editorconfig`、`.gitattributes`、`.github/workflows/ci.yml`、`.gitignore`、docs。
- 测试：设置校验、localStorage 迁移、项目根自定义；个人名字/路径夹具改为通用值。

## 验证

- `npm test`（93 个）、`npm run typecheck`、`npm run build` 通过。
- 用 `LOCALPEEK_CAPTURE_*` 跑 `redis-value` 截图：标题与侧栏显示 LocalPeek，Value 列与 JSON 详情正常。
- 配置迁移验证：`~/Library/Application Support/LocalPeek/localpeek-config.json` 自动创建，
  `version: 2`、settings 为默认值、旧 webHistory 与 credentials 已复制。
- `npm run dist` 产出 `release/LocalPeek-0.1.0-arm64.dmg`；asar 仅保留 LICENSE（docs、package-lock、
  CONTRIBUTING、SECURITY、README 已排除）；Info.plist 的 appId 为
  `io.github.sunbridger.localpeek`、名称为 LocalPeek。
- 打包产物已启动验证并安装到 `/Applications/LocalPeek.app`；旧 `/Applications/LocalDB.app` 仍保留，
  确认无误后可删除。

## 未做 / 后续

- safeStorage 加密凭据、Electron sandbox / CSP 收紧（下一步安全加固）。
- i18n、Linux / Windows 实现、Intel / universal 构建。
- README 截图与 GitHub Release 发布流程。
- 仓库尚未 `git init` / 提交；推送后将 README 中的 GitHub 链接与 CI 徽章生效。
