# Codex Theme for Paseo

独立的 Paseo 主题插件，提供 **Codex Light** 和 **Codex Dark**。以中性灰阶、柔和面板层次和蓝色强调色为基础，由 Paseo 原生主题系统应用到菜单、聊天、插件面板和终端。

这是 Codex 风格的独立配色设计，不是 OpenAI 官方主题或逐像素布局复刻。字体、间距、侧栏结构、消息和工具行为由 Paseo 保持原有实现。

## 使用

需要 Paseo 0.11.2 至 0.11.x。

```sh
paseo plugin add git:KiritoKing/paseo-plugins --path packages/paseo-codex-theme
```

安装后在设置 → 外观 → 主题选择 Codex Light 或 Codex Dark。安装不会自动切换当前主题。可以随时改回内置主题；禁用或移除插件时，Paseo 自动回退到默认主题。

## 开发

从 monorepo 根目录执行 `npm ci --ignore-scripts`，然后 `npm run typecheck --workspace @chlrc/paseo-codex-theme`。调色板在 `client/themes.ts`，通过 `index.client.ts` 调用原生 `addTheme` 注册，并在卸载时清理贡献。插件只有客户端主题数据，不读取文件、会话或外部网络。
