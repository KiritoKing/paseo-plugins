# AIW Companion

用于 Paseo 的 AIW 多仓工作区只读插件。安装按 daemon 隔离；使用目录安装时，请保留源码目录。

根目录有 `aiw.yaml` 的工作区，顶部显示一个 **AIW** 按钮，点击在右侧 Explorer 打开唯一的 AIW Tab；重复点击复用既有页签。入口跟随工作区生命周期，每 60 秒重新检查配置文件增删，普通工作区不显示。未物化业务仓也可进入面板查看就绪原因。

在已有 AIW 工作区按 **⌘K**，选择 **AIW** 打开面板，或选择 **AIW 搜索** 聚焦顶部搜索栏。`/aiw` 和 `/aiw-search` 也使用同一个面板。面板可以放入工作区或 Explorer。

在 **设置 → 插件 → AIW Companion → AIW 面板** 修改 Tab 名称（默认 `AIW`），保存后重载插件生效；该 host 的工作区共用名称。沿用原业务仓面板 ID 和布局设置。升级前已打开的旧搜索 Tab 可手动关闭，后续入口只打开统一面板。

## 使用

- **布局**：拖动文件树与预览之间的分隔条，左右布局调整树宽，上下布局调整树高；树顶部的分栏图标切换方向。松开自动保存，同一宿主机按工作区分别记忆方向、宽度和高度，重新打开、重载或重启后恢复。窄于 480 像素时临时上下排列，恢复宽度后沿用原布局；分隔条聚焦后可用方向键微调。保存失败会显示重试入口。

- **文件**：按仓库 → 目录 → 文件展开，点击文件在右侧阅读。桌面侧栏约 304px，紧凑布局上下排列；选中文件持续标记。长文件分段阅读；搜索命中展开父目录并定位对应行。
- **改动**：各仓库分别展示自己的 Git 变更和基线。全部变更是基线到工作树；分支已提交是基线到 HEAD；未提交分别列出已暂存、未暂存和未跟踪文件。
- **筛选**：改动视图将“对比范围”和“文件类型”分成两组，每组单选，组合生效；文件类型支持全部文件、代码文件、文档文件；搜索范围不受 Diff 筛选影响。
- **类型规则**：按当前 Diff 的文件路径筛选代码或文档。通过右上角 **设置图标** 打开弹窗，切换“代码文件 / 文档文件”编辑各自 Include/Exclude；两套草稿可切换，保存时一起持久化，恢复默认只影响当前类别。每行一条，支持 `*`、`**`、`?`；exclude 优先，重命名的旧、新路径都参与匹配，因此跨类型重命名可出现在两类中。代码默认覆盖 TS/JS、Vue、Svelte、CSS、Go、Python、Java、Rust、C/C++、Swift、Shell、SQL、Proto 等；文档覆盖 Markdown、文本、RST、AsciiDoc、LaTeX、OpenSpec/AIW 文档及需求目录中的结构化文件。普通 JSON/YAML 配置和图片等仍可在“全部文件”中查看。自定义旧文档规则保留，原默认规则自动升级；规则按项目保存，不绑定 spec 框架。
- **预览**：全文与 Diff 共用阅读器；按文件类型高亮关键字、字符串、注释等。支持 TS/TSX、JS/JSX、JSON、YAML、Markdown、CSS、HTML、Go、Shell、Python、SQL、Protobuf。Diff 显示独立的旧/新行号、增删标记与背景，隐藏 Git 路径/索引头部；行号在水平滚动时固定，可切换折行和复制。未知格式或超大分段降为纯文本。
- **跨仓搜索**：搜索栏位于面板顶部，按 Enter 或搜索按钮查询；`Aa` 切换大小写，`.*` 切换正则。点击左侧箭头展开仓库范围和路径 include/exclude，默认收起。结果在下方按仓库与文件分组，点击直接在原阅读器打开对应行；可随时切换文件、改动和搜索结果。清除搜索回到文件树。重复提交同一查询会重新搜索。仓库选择默认跟随所有可用仓库，未就绪仓库禁用。
- **刷新**：重新读取当前 worktree；业务仓视图每 20 秒刷新。若 Diff 提示快照过期，刷新并重新选中改动。

需要 Paseo ≥0.11.1、pnpm、Git、ripgrep（rg）和可运行 `version`、`change status --json` 的 AIW CLI。优先使用工作区 `.aiw/bin/aiw`，其次使用 `AIW_COMPANION_AIW` 或 daemon 的 PATH。已有 `.aiw/aiw-toolchain.env` 时严格校验版本；无锁文件时支持宿主机安装，按实际状态结构、就绪标志和 Git 身份核验，不要求伪造锁文件。已选但未物化的业务仓显示未就绪标记，不进入默认搜索范围。读取发生在当前 Paseo daemon 所在机器。未就绪子仓显示错误，不会自动下载、物化、切分支或修复。

## 兼容范围与宿主依赖

声明的 Paseo 兼容范围为 `>=0.11.1`；历史验证记录涉及 Paseo 0.11.2。该记录只说明曾针对这个版本做过验证，不代表整个声明范围都经过验证或得到保证。

Git 源码安装时，运行此插件的 daemon 通过 `pnpm install --prod --frozen-lockfile --ignore-scripts` 准备生产依赖，因此需要 pnpm、Git、ripgrep（`rg`）和 AIW CLI。CLI 必须支持 `version` 与 `change status --json`。AIW、仓库文件和 Git 状态均从 daemon 所在机器读取。AIW npm 发布包使用随包提供的 `npm-shrinkwrap.json` 供消费者安装锁定依赖，并移除 Git 源码安装专用的准备步骤。

> **设置备份：** `paseo plugin remove aiw-companion` 会删除该 daemon 上此插件的设置目录。升级若需要先移除再安装，或卸载后可能需要恢复设置，请先备份对应的 `plugin-settings/aiw-companion/`；重装后恢复并读回。

文件和 Diff 只读；不会暂存、提交、push 或修改业务仓。搜索流式接收结果，达到上限后停止扫描并提示截断；可转换的路径规则在扫描时收窄范围。大文件读取也有上限。跨仓搜索使用当前 worktree 内容，忽略 Git 忽略的文件；业务仓文件树可以选择显示忽略文件。禁止读取仓库外的符号链接。

## 本地维护

以下命令均从 monorepo 根目录执行：

需要 Node.js 22 或 24；开发默认使用 Node.js 24.22.0。pnpm 固定为 10.34.7，版本以根目录 `package.json` 的 `packageManager` 字段为准。

```sh
pnpm --filter @chlrc/paseo-aiw-companion typecheck
pnpm --filter @chlrc/paseo-aiw-companion test
paseo plugin install ./packages/paseo-aiw-companion
paseo plugin reload aiw-companion
```

文件树顶部提供刷新、折叠全部图标；文件视图可切换显示忽略文件。设置图标直接打开 Pattern 弹窗。

修改源码后重载对应插件。更多包级命令见[根目录开发说明](../../README.md#开发)；功能边界见[概览](OVERVIEW.md)，本包变更记录见[CHANGELOG](CHANGELOG.md)。
