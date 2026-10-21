# AIW 合并面板交互回归

在仓库根目录使用固定版本 pnpm 安装依赖后运行：

```sh
corepack pnpm fixtures:build
corepack pnpm fixtures:serve
```

打开 `http://127.0.0.1:8769/aiw-panel.html`。刷新页面后点击“运行回归”（也可执行 `await window.runAiwChecks()`），预期通过 22 项断言。手动按钮可切换宽窄布局、主题、名称设置与插件重载；底部 trace 显示合成 RPC 输入。

测试运行真实的插件入口、业务仓面板、搜索、阅读器、名称设置与导航组件。React Native/UI 原语和数据是测试替身；使用 SDK 的真实 RPC 验证和工作区上下文，settings 使用带 schema 与 revision 检查的内存替身，因为 npm SDK 只声明 `useSettings`，运行实现由 Paseo 宿主提供。图标为简化占位，不用于像素验收。

覆盖单一面板与入口、配置初始折叠、可用仓库范围、分组结果、命中行预览、文件树展开、改动视图、参数组合、重复搜索、清空、无匹配、RPC 错误、部分失败与截断、无仓库禁用、命令聚焦、窄面板、深色主题、空名称校验和保存后重载。这里通过不代表真实 host 的设置持久化、原生客户端或移动端验收通过。测试完成后关闭本次服务。
