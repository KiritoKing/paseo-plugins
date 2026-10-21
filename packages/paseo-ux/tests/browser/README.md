# 浏览器夹具

夹具使用合成会话与模拟的 Paseo RPC、设置和导航上下文。`essentials.html` 加载实际生产入口、附件面板、设置页、图片组与查看器，UI 原语来自真实 React Native Web；`session-screen.html` 覆盖既有会话选择流程。它们不连接真实会话，不恢复用户会话，也不替代 Paseo 宿主与原生设备验收。

从仓库根目录执行：

```sh
pnpm fixtures:build
pnpm fixtures:serve
```

打开 `http://127.0.0.1:8769/essentials.html` 或 `http://127.0.0.1:8769/session-screen.html`。服务没有热更新，修改源码后重新构建并刷新。用完后停止自己启动的服务。

建议回归顺序：

1. 在 attachments 中检查五类附件；搜索与筛选后结果正确，空搜索结果保留工具栏。用 360×800、800×360 和宽窗口检查列表滚动。
2. 打开图片，检查全窗口 Modal、44px 控件、前后切换、缩放与切图复位、双指缩放后平移、适应状态下滑动切图、Escape 关闭与焦点返回。
3. 进入 features，分别关闭附件、纯图片聚合、图片手势、会话历史及音频。检查 Registration state 中对应注册和订阅的清理，独立项不互相误关。
4. 切换 Empty：自动 pill 应隐藏；Add first attachment 后应显示。Older attachments 的最新页没有附件，较早页面有附件，pill 仍应显示，面板可加载较早附件。
5. Fail next history request 后刷新，出现错误和重试入口；已发现附件的 pill 不应被误隐藏。
6. gallery 检查默认 3/5 张、展开/收起与重复资源键；关闭聚合后手工渲染夹具不代表宿主仍有 renderer 注册。
7. 刷新页面后切换 Empty，点击 Delay next history response，再点击面板的 Refresh attachments，并在 600ms 内点击 Add first attachment。旧请求在 1200ms 后返回空页；面板应自动继续请求并显示 6 个合成附件，无需手动再次刷新。

夹具截图只可用作开发证据，不可冒充市场要求的实际 Paseo 界面截图。原生 iOS/Android 的安全区域、系统返回、旋转、焦点和真实触控仍需设备验收。当前证据见 [VALIDATION.md](../../VALIDATION.md)。
