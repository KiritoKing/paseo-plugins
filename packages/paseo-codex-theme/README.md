# Codex Theme for Paseo

独立的 Paseo 主题插件，提供 **Codex Light** 和 **Codex Dark**。以中性灰阶、柔和面板层次和黑白强调色为基础，由 Paseo 原生主题系统应用到菜单、聊天、插件面板和终端。

这是 Codex 风格的独立配色设计，不是 OpenAI 官方主题或逐像素布局复刻。字体、间距、侧栏结构、消息和工具行为由 Paseo 保持原有实现。

## 使用

声明的 Paseo 兼容范围为 `>=0.11.2 <0.12.0`。历史验证记录涉及 Paseo 0.11.2；这不代表整个声明范围都经过验证或得到保证。运行插件只需要 Paseo 宿主环境，不额外依赖 Git、rg、AIW CLI 或其他外部工具。

```sh
paseo plugin add git:KiritoKing/paseo-plugins --path packages/paseo-codex-theme
```

安装后在设置 → 外观 → 主题选择 Codex Light 或 Codex Dark。安装不会自动切换当前主题。可以随时改回内置主题；禁用或移除插件时，Paseo 自动回退到默认主题。

`paseo plugin remove paseo-codex-theme` 会删除该 daemon 上此插件的设置目录。升级若需要先移除再安装，或卸载后可能需要恢复设置，请先备份对应的 `plugin-settings/paseo-codex-theme/`；重装后恢复并读回。

## 开发

开发支持 Node.js 22 和 24，默认使用 Node.js 24.22.0；pnpm 固定为 10.34.7，以根目录 `package.json` 的 `packageManager` 字段为准。所有命令从 monorepo 根目录执行：

```sh
pnpm --filter @chlrc/paseo-codex-theme typecheck
paseo plugin install ./packages/paseo-codex-theme
paseo plugin reload paseo-codex-theme
```

根目录安装依赖和完整检查命令见[开发指南](../../README.md#开发)。调色板在 `client/themes.ts`，通过 `index.client.ts` 调用原生 `addTheme` 注册，并在卸载时清理贡献。插件只有客户端主题数据，不读取文件、会话或外部网络。本包变更记录见[CHANGELOG](CHANGELOG.md)。
