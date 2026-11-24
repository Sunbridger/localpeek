# Contributing

感谢愿意帮助 LocalPeek。提交前请先开 Issue 描述问题或方案，避免重复工作。

## 开发环境

- macOS（当前主要支持平台），Node.js >= 20.19
- `npm install`
- `npm run dev` 启动开发窗口
- `npm test` 运行单元测试
- `npm run typecheck` 类型检查
- `npm run build` 构建到 `out/`

打包未签名 arm64 dmg：

```bash
npm run dist
```

网络受限时可参考 README 的 Electron / electron-builder 镜像说明。

## 提交规范

- 代码使用 TypeScript + React + Ant Design，遵循现有目录结构。
- 新功能尽量附带单元测试；纯 UI 改动请在 PR 中附截图。
- 不要提交 `out/`、`release/`、个人配置、凭据、日志或本机路径。
- 提交信息用简短的中文或英文祈使句，说明「为什么」而不是罗列文件。

## 安全问题

发现凭据泄露、命令执行或进程操作相关问题时，请不要公开 Issue，按 [SECURITY.md](SECURITY.md) 的渠道报告。
