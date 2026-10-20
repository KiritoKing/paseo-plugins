# 质量门禁

仓库的公共 API 与原生边界约束纳入 Biome 2.5.15。规则定义保存在 `biome.json` 和 `lint/*.grit`，正反例通过真正的 Biome CLI 验证。不要为同一语法约束再增加扫描脚本。现有 `check:boundaries` 保留跨文件依赖图、声明依赖与打包运行时检查。

| 作用域 | 门禁 |
| --- | --- |
| 所有插件生产源码 | 仅使用公共 SDK 入口；禁止私有 `dist`、`src`、`internal` 路径及 SDK host 测试适配器；禁止修改宿主或内建对象原型 |
| `client/` 与 `index.client.*` | 禁止 Node 模块和 Node 全局；使用 React Native JSX；DOM 适配仅限其他插件显式的 `client/web.ts` |
| Essentials 的全部 client 源码 | 禁止 DOM/浏览器全局与 HTML JSX 属性；使用公开的 React Native/Paseo API，没有 web adapter 例外 |
| `shared/` | 不得依赖 Node、React Native 或 client/server 运行时 |
| 测试、浏览器夹具与工程脚本 | 可使用各自执行环境；不通过全局禁用规则为生产源码开口 |

规则同时包含合法的附件 `document` 属性、本地 `window` 变量与插件自有类原型的正例，防止按标识符文本误报。导入图校验和 TypeScript 检查继续覆盖跨文件边界。

## 本地安装

安装依赖不会执行生命周期脚本，因此每个 checkout/worktree 显式安装一次：

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm hooks:install
```

安装器在当前 worktree 专属 git-dir 内保存分发器，通过 worktree 配置设置 `core.hooksPath`，不覆盖全局安全 hook 文件或其他 worktree 的 hook 设置。它先转发继承的 hook，保留参数、stdin 与失败退出码，再执行项目门禁。继承自全局 `core.hooksPath` 时会重新读取该配置，后续全局 hook 更新仍生效。已有未知文件或被改写的受管文件会使安装失败。

启用 Git 的 `extensions.worktreeConfig` 前，若 common 配置存在 `core.worktree` 或 `core.bare=true`，安装器会拒绝，要求维护者先处理这些工作区敏感配置。它不会代替维护者迁移其他工作区。

分发器存放在 git-dir，切换到尚无 `.githooks` 的分支仍会转发继承的安全 hook；项目命令缺失或 pnpm 不可用时明确失败。再次安装会先核验已有文件与摘要，再原子更新自己的持久分发器；未知或被改写的文件仍会拒绝。安装不修改全局 Git 配置。

## 提交与推送

- **pre-commit**：要求工作区中所有非忽略文件与暂存快照一致；拒绝任何未暂存修改和非忽略的未跟踪文件，包括并未暂存的兄弟源码，随后执行 `pnpm check:commit`。该命令运行环境检查、暂存文件的 Biome 检查、整个依赖图检查和类型检查。工作区里的未跟踪导入或未暂存类型修复不能替暂存版本通过检查。Git 忽略的依赖与构建输出不在此状态限制内；项目与打包边界仍由 CI 检查。
- **pre-push**：要求 tracked 工作区与暂存区干净，然后运行完整 `pnpm check`，包括格式、lint、公开源码约束、类型、测试、浏览器构建和消费者安装验证。

继承 hook 收到原始 Git 环境。pre-push 的项目完整检查会清除 `git rev-parse --local-env-vars` 列出的仓库局部变量，让临时仓库按自己的 cwd 发现身份；pre-commit 保留实际暂存索引，包括 Git 提供的临时索引。

hook 不自动格式化、stash、回滚或提交文件。提交前需要把内容准备成一致、可验证的工作区状态；无关未暂存文件会使 hook 阻止提交，但文件会原样保留。继承的 hook 拒绝操作时，保留其原始诊断并解决问题。不要用关闭 hook 或配置空目录来跳过门禁。

本地 hook 只提供提前反馈，不能防止开发者显式绕过；pre-push 也不把未跟踪文件当作提交内容。因此合入还必须由 CI 检查精确提交。

## CI 与主干保护

`.github/workflows/ci.yml` 在 pull request、main push、merge group 和手动触发时，分别使用 Node 22、24，以冻结锁文件安装并运行 `pnpm check`。检查失败或取消不会算通过；规则插件解析失败也会阻断。

`.github/rulesets/main-quality.json` 描述 main 的要求：通过 PR 合入、解决所有 review threads、禁止强推和删除、要求分支包含最新 main，并要求 GitHub Actions 的 `check (22)` 与 `check (24)` 均成功。没有绕过主体，不额外要求审核人数量。

JSON 文件是可审查的策略定义，是否已启用必须读回 GitHub repository ruleset 与 main 的有效规则；不能仅凭仓库文件宣称远端门禁已生效。2026-10-20 已应用并通过 repository ruleset 与 main 有效规则独立读回，远端规则为 [Main quality gate](https://github.com/KiritoKing/paseo-plugins/rules/25477422)。PR 检查链接随交付提供。后续变更检查 job 名称或 GitHub App 来源时，须同步更新实际规则与该文件，避免要求一个永远不会产生的状态。
