# 验证记录

## Essentials 会话阅读整合（2026-10-21）

已合入 `origin/main` 的 `4952111`，整合基线为合并提交 `b23a122`。本节验证其后的整合工作树，最终源码以本记录所在提交为准；下方记录保留为历史，不能作为当前保证。

- 删除独立主题包及其发行选项。原正文、工具、思考与仅输出能力迁入 Essentials，保留 `paseo-ux` 和 `@chlrc/paseo-ux` 身份，不再注册主题。
- macOS arm64、Node 24.22.0、pnpm 10.34.7，完整 `pnpm check` 通过：Essentials 74、AIW 14、工程 58，共 146 项测试；三个浏览器夹具和两个包的隔离安装／运行入口编译通过。AIW 为 28 个打包文件，Essentials 为 37 个。
- Paseo browser 运行实际生产入口与会话组件，验证阅读、图片库、附件和会话功能的独立开关；仅输出及切回类别偏好、流式记录隐藏、浅色宽窗与深色 390px 无横向溢出通过。宿主接口与数据为合成上下文，页面日志只有 React 开发提示，无运行错误。
- 在实际 Paseo 0.12.0 app／daemon 上替换本地 Essentials 安装来源；独立读回 `enabled`、`running`、来源路径和启动日志。旧阅读设置先完整备份，按原字节迁入独立 `appearance` 存储；原媒体设置保留。随后移除旧主题安装，其他安装未变。

详情与边界见 [Essentials 验证记录](packages/paseo-ux/VALIDATION.md)。插件加载与设置文件读回不等于原生消息呈现或原生主题回退的实屏验收；移动设备、远端 CI、npm／市场发布未在本轮验证。

## PR 提交前复查（2026-10-20）

基于主干 `663df64`，平台为 macOS arm64；格式化与工程迁移拆成两个提交。
主干的 AIW 预览缓存修复及其测试完整保留；主题仍为主干的 0.1.0 与原有配色，
链接颜色修复由独立 PR 交付。发行测试从 manifest 读取当前版本，避免依赖其他分支的版本号。

- Node.js 24.22.0 运行完整 `pnpm check` 通过：环境、Biome、公开源码、导入边界、
  三包类型检查、28 项业务测试、14 项工具链测试、四个浏览器夹具构建及三包隔离打包。
- Node.js 22.22.3 运行 `pnpm test`，42/42 通过；此版本本轮未重复运行完整 `pnpm check`。
- 解包后的实际运行入口编译通过，最终包文件数为 AIW 28、主题 8、UX 23；AIW 的
  消费者依赖安装通过。该检查没有覆盖已有 `work/packages/` 下的历史产物。
- 18 份 Markdown 的本地链接与 `git diff --check` 通过。真实 Paseo 客户端、移动端、
  发布授权和实际发布未验收；远端 CI 结论以该 PR 当前 revision 的 GitHub 检查为准。

---

## pnpm 与工程检查迁移（2026-10-20，实现阶段历史记录）

基线为 `e50deb6`，以下结果对应同步到最新主干之前的实现阶段工作树，平台为 macOS arm64。
开发工具链为 pnpm 10.34.7、TypeScript 5.9.3、Biome 2.5.15。SDK 和三个插件的
版本号保持原值；源码统一格式，并对部分 Hook、循环和浏览器夹具作 lint 整改。

- 从原 npm 锁文件导入 pnpm 锁文件，冻结安装通过；开发工具集中到根工作区。
  AIW 的消费者锁文件单独维护，所有 341 个解析来源均为公共 npm registry。
  `pnpm lock:runtime` 再生成通过，锁文件内容保持一致。
- Node.js 22.23.3 和 24.22.0 分别运行完整 `pnpm check`，均通过：环境、格式与
  lint、公开文件、导入边界、三包类型检查、26 项业务测试、14 项工具链回归测试、
  四个浏览器夹具构建及三个包的隔离安装/入口编译。回归测试包含新增 workspace、
  缺失入口、跨包导入、非公共依赖来源、生命周期脚本和发行条件。
- 在独立源码副本的 AIW 包目录执行 Git 准备命令
  `pnpm install --prod --frozen-lockfile --ignore-scripts` 成功；随后确认 minimatch、
  refractor 和 yaml 的生产入口均可导入。
- `pnpm pack:release` 成功生成三个 tarball；独立读回文件数为 AIW 27、主题 8、
  UX 23。各包带 CHANGELOG，AIW 带消费者锁；npm 产物不含 Git 专用准备命令、
  测试或依赖目录。产物和 SHA-256 清单位于忽略的 `work/packages/`。
- `actionlint 1.7.12` 检查 CI 和手动发行 workflow 通过；未启用 shellcheck/pyflakes。
  Markdown 本地链接检查与 `git diff --check` 通过。
- 使用 Paseo browser 访问独立夹具：会话选择与恢复得到正确的模拟 RPC 参数，
  恢复后仍在原工作区页面；图片连续右键停在第三张，关闭后方向键恢复传递给页面。
  浏览器日志没有运行错误。夹具使用模拟宿主 UI 和数据，不替代真实客户端验收。

本轮未提交、推送或发布；远端 CI 未运行这些改动。真实 daemon/移动端界面、真实
客户端截图、插件市场上架和 GitHub/npm trusted publisher 配置均未验收。手动发行
workflow 默认仅上传产物，实际发布还需要主干、显式发布选项及外部授权设置。

---

2026-10-13，Node.js 24，本机 Paseo 0.11.2。

## Monorepo

- npm workspace 安装完成，根锁文件使用公开 npm registry。
- 三包类型检查通过；UX 14 项、AIW Companion 12 项现有测试通过。主题是纯配色贡献，没有新增镜像实现的单元测试。
- 公共源码与元数据检查通过；三包打包清单分别为 22、25、7 个文件，包含 manifest、OVERVIEW、许可证与运行入口，不包含测试、机器验收回执或依赖目录。
- UX 的 33 个运行与测试文件和原提交完全一致；AIW 的 26 个运行与测试文件和既有快照完全一致。包名、版本、文档与仓库元数据适配 monorepo。
- 生产依赖 npm audit 无已知漏洞。完整开发依赖审计仍有 20 项告警（5 moderate、15 high），没有执行强制升级。

## 本机安装

- `paseo-ux`、`aiw-companion` 和 `paseo-codex-theme` 均以 monorepo 下的独立目录安装，状态 `running`。没有重启 daemon。
- 旧源码目录保留。主题是独立插件；UX 没有主题代码。主题不自动切换当前外观。
- 迁移时 CLI 拒绝覆盖已有 ID；随后使用 remove/install 更换源路径。读回发现 remove 会删除插件设置目录。本轮只保存了旧设置文件哈希，没有保存完整文件，因此本机 AIW 的布局偏好无法还原，现使用默认布局。这是已知迁移缺口；README 已明确后续迁移先备份设置。远端安装和设置没有修改。

## 主题与界面边界

- Codex Light / Dark 使用 Paseo 原生 `addTheme`，配色数据通过 SDK 类型检查，主题插件加载成功。
- CUA 仅只读检查，当前可见工作区属于其他远端 host；没有切换主题或操作真实会话。
- Codex 应用的窗口读取受工具限制，未获取本轮 Codex 像素基线。主题为独立的 Codex 风格配色，不宣称字体、布局或像素复刻。实际浅深色外观需用户在 Paseo 的设置 → 外观选择主题验收。
- CI 文件已加入；远端 CI 的状态以 GitHub 的实际运行结果为准，本地通过不能替代 CI。
