# Paseo 插件快速接入

本仓库的三个插件从 GitHub monorepo 的各自子目录安装。以下命令使用发布引用 `onboarding-20261019-r1`；执行前请确认该 Git 引用已发布。

## 前置条件

- Paseo 插件功能已在目标 daemon 的 **Settings → Plugins → Enable plugins** 打开。
- 目标 daemon 和连接它的 Paseo 客户端都支持对应 manifest 版本范围；已安装插件可用 `paseo plugin ls` 查看状态。
- 三个包都声明 Node.js 22 或更新版本。AIW Companion 还会运行 manifest 中的准备命令，因此目标 daemon 的 PATH 中需有 npm。
- AIW Companion 另需 Git、ripgrep（`rg`）和可运行 `version`、`change status --json` 的 AIW CLI。插件优先使用工作区内的 `.aiw/bin/aiw`，其次使用 `AIW_COMPANION_AIW` 或 daemon 的 PATH。
- 安装按 daemon 隔离。CLI 默认使用本机 daemon home（`~/.paseo`）；操作其他 daemon 时加 `--host <host>`。插件服务端代码和准备命令以 daemon 用户权限在目标机器运行，客户端界面代码在 Paseo app 中运行。请把插件安装到实际承载目标工作区的 daemon。

## 安装

每条命令只安装一个插件。插件 ID 和兼容范围来自 manifest：

| 插件 | 安装 ID | 包版本 | Paseo 版本 |
| --- | --- | --- | --- |
| Paseo UX | `paseo-ux` | 0.2.5 | `>=0.11.2 <0.12.0` |
| AIW Companion | `aiw-companion` | 0.5.1 | `>=0.11.1` |
| Codex Theme | `paseo-codex-theme` | 0.1.1 | `>=0.11.2 <0.12.0` |

```sh
paseo plugin add git:KiritoKing/paseo-plugins:packages/paseo-ux --ref onboarding-20261019-r1
paseo plugin add git:KiritoKing/paseo-plugins:packages/paseo-aiw-companion --ref onboarding-20261019-r1
paseo plugin add git:KiritoKing/paseo-plugins:packages/paseo-codex-theme --ref onboarding-20261019-r1
```

如果要安装到另一台 daemon，在命令末尾加 `--host <host>`。也可以在该 daemon 的 **Settings → Plugins** 页面粘贴同一个 Git source，并选择安装。有关 Git 子目录语法，见 Paseo 的[插件来源参考](https://paseo.sh/docs/plugins/reference#plugin-sources)。

## 验证

先检查插件是否载入：

```sh
paseo plugin ls
paseo plugin logs <plugin-id>
```

目标插件应显示 `running`，没有加载错误。然后在连接到同一 daemon 的 Paseo 客户端验证对应功能：

- **AIW Companion**：打开根目录含 `aiw.yaml` 的工作区，确认顶部显示 AIW 业务仓与搜索入口。
- **Paseo UX**：打开包含连续图片的 agent 回复，检查缩略图聚合和大图预览。`Cmd+Shift+T` 的关闭会话恢复快捷键依赖 macOS 桌面默认绑定。
- **Codex Theme**：打开 **Settings → Appearance → Theme**，手动选择 Codex Light 或 Codex Dark。安装不会自动切换主题。

如果插件没有运行，先读 `paseo plugin ls` 状态，再用 `paseo plugin logs <plugin-id>` 查看 daemon 输出。

## 更新和移除

首次安装的 `--ref` 只选择该次安装的内容，不会锁住之后的更新。普通 `paseo plugin update <plugin-id>` 会检查 Git 仓库当前默认分支的 HEAD，即使首次安装使用了 `--ref` 也一样。

要显式更新到某个 Git 引用，使用：

```sh
paseo plugin update <plugin-id> --ref onboarding-20261019-r1
```

CLI 会直接应用显式指定的引用，不再逐项询问；运行前确认目标引用。临时停用可用 `paseo plugin disable <plugin-id>`，之后可用 `paseo plugin enable <plugin-id>` 恢复。完全移除用 `paseo plugin remove <plugin-id>`。移除会清理该安装 ID 的插件设置目录；如果要保留 AIW 布局、规则或其他插件偏好，先备份对应设置再移除或更换安装来源。

更多说明见 Paseo 的[插件 quickstart](https://paseo.sh/docs/plugins)、[发布指南](https://paseo.sh/docs/plugins/publishing)和[插件参考](https://paseo.sh/docs/plugins/reference)。
