# Paseo Essentials

Paseo Essentials 为 Paseo 增加会话阅读设置、附件浏览、图片组和工作区会话历史功能。npm 包名为 @chlrc/paseo-ux。manifest ID 仍为 paseo-ux，以保留原插件身份和设置命名空间。

## 环境要求

- Paseo app 和 daemon 0.11.2 或更高版本。
- 在此仓库开发需要 Node.js 22 或 24 与 pnpm 10.34.7。
- 恢复会话需要 daemon 主机的 PATH 中有官方 Paseo CLI。

## 从当前代码库安装

将插件安装到实际承载它的 daemon。先在仓库根目录执行：

    cd packages/paseo-ux
    paseo plugin install .
    paseo plugin reload paseo-ux

连接远端 daemon 时，应在该 daemon 主机上安装并重载插件。恢复会话不能依赖另一台机器上的 CLI。

## 使用插件

### 会话阅读

在 Essentials 的会话阅读设置中调整正文与代码排版、字号、密度、阅读宽度、思考展开方式和可选的逐条 shell 记录。工具默认保留原生分组。“全部折叠（仅输出）”隐藏全部工具、思考及其标题，包括流式与失败记录，原始历史保留；切回分类设置即可恢复之前的偏好。关闭会话阅读增强会释放其时间线呈现，不影响附件和会话历史。

流式正文、图片、附件、不支持的 Markdown、文件链接、未知工具和超限内容继续使用原生呈现。纯图片消息仍可使用 Essentials 的图片组，图片与正文混合时保持原生。会话排版跟随当前 Paseo 主题，插件不再提供或切换配色主题。

这些能力从已移除的 Codex 主题包迁入。既有偏好可以保留到 Essentials，且不会覆盖媒体设置，步骤见[迁移说明](../../docs/migration.md#会话阅读并入-essentials)。设置按 daemon host 保存。

内容归属、插件共存、设置与生命周期边界见[会话阅读实现约定](../../docs/conversation-reading.md)。

### 会话媒体

当元数据检查确认会话中存在附件后，输入框上方会显示“媒体”入口。也可以用命令中心的附件操作或 /media 打开面板。面板可按名称或来源搜索、按媒体类型筛选，也可加载更早的历史。元数据检查会分页读取会话历史，因此不会因最新一页为空就误判更早的历史中没有附件。

仅含图片的完整助手消息和用户消息会通过 Paseo timeline pipeline 转换为紧凑图片组。混合文本仍由 Paseo 原有渲染器显示。选择图片可打开全屏查看器。查看器支持上一张、下一张、缩放、平移和复位。图片手势默认开启；关闭手势后，导航控件仍可用。

附件面板支持图片预览和受支持的本地音频播放，视频、文档及普通文件以卡片显示。HTTP(S) 来源可通过 Paseo 的外部链接处理器打开。本地视频、PDF 和其他文件内容不会由插件下载或预览。

### 工作区会话

点击工作区顶部的“会话”按钮，或使用命令中心的恢复操作，浏览当前工作区的会话。可以按会话名称或 provider 搜索。选择已关闭且有持久化记录的会话时，插件会用原会话 ID 重载；如果会话仍在运行，则直接打开该会话。历史列表仅包含所选工作区及其 daemon 保留的记录。

### 设置

偏好按所选 host 保存，并应用到连接该 host 的所有设备：

- “附件”控制媒体索引和输入框上方的附件入口。
- “仅图片消息分组”控制图片组转换。
- “可见缩略图”设置收起时显示的图片数量，可选 1 至 8 张，默认 3 张。
- “图片手势”控制缩放、平移和复位手势，默认开启。
- “会话历史”控制工作区会话列表和恢复操作，默认开启。
- “音频播放”控制是否允许新的本地音频播放请求，默认开启；公开 API 不提供停止已播放片段的控制。

## 数据访问与限制

daemon 从所选会话的公开 timeline 和结构化工具结果中查找媒体引用。插件不会扫描工作区目录。读取本地图片或音频内容前，插件会确认该来源出现在会话历史中。引用路径可能位于工作区之外，文件由 daemon 主机读取。单个本地图片或受支持音频的读取上限为 16 MiB。daemon 不会抓取 HTTP(S) 资源；客户端通过 Paseo 的外部链接处理器打开原始来源。

索引使用宿主提供的会话投影，包含其中合并后的消息与工具结果。覆盖范围是消息正文和工具详情中可见的引用，不包含完整原始事件或未暴露在这些字段中的独立附件 payload。宿主替换掉的旧工具详情可能不再出现在此视图中。

尚未在真实 iOS 和 Android 设备上验证行为。插件不会把会话内容发送给额外模型；发送给 agent 的消息和工具结果仍遵循 Paseo 中所选 provider 的既有配置。

## 在此仓库开发

在仓库根目录执行：

    pnpm install --frozen-lockfile --ignore-scripts
    pnpm hooks:install
    pnpm --filter @chlrc/paseo-ux typecheck
    pnpm --filter @chlrc/paseo-ux test

此包使用仓库的 pnpm workspace 和锁文件。修改代码后，安装或重载本地插件以载入新 bundle。固定版本的 Marked 构建与许可证位于 shared/conversation/vendor；有意升级该解析器时运行 pnpm --filter @chlrc/paseo-ux build:markdown。

### 会话恢复配置

插件会在 daemon 主机上调用官方 CLI。重载前会检查选中的会话 ID 和工作目录，随后读回会话，确认相同 ID 已处于活动状态。CLI 默认可执行文件名为 paseo，必须能从 daemon 主机的 PATH 找到。

- PASEO_HOME 用于选择 daemon 数据目录，默认值为 ~/.paseo。
- 如果不使用 paseo 作为可执行文件，可通过 PASEO_ESSENTIALS_CLI 指定独立可执行文件。

请在 daemon 的运行环境中设置这些变量。插件调用 CLI 时会清空 PASEO_HOST，因此 PASEO_HOME 必须指向拥有该会话的 daemon。
