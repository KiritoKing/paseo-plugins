# 贡献指南

欢迎通过问题和拉取请求讨论缺陷、文档改进与功能调整。开始前请查看[根 README](README.md)和目标包的 README、OVERVIEW，了解兼容范围、宿主依赖、功能与数据访问边界。

## 环境与检查

支持 Node.js 22 和 24；开发默认使用 Node.js 24.22.0。pnpm 固定为维护中的 10.x 版本 `10.34.7`，以根目录 `package.json` 的 `packageManager` 字段为准。所有开发和 CI 工作区命令从仓库根目录执行：

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm check
```

按需运行单包检查：

```sh
pnpm --filter @chlrc/paseo-ux typecheck
pnpm --filter @chlrc/paseo-ux test
pnpm --filter @chlrc/paseo-aiw-companion typecheck
pnpm --filter @chlrc/paseo-aiw-companion test
pnpm --filter @chlrc/paseo-codex-theme typecheck
pnpm --filter @chlrc/paseo-codex-theme test
```

Paseo UX 的独立浏览器夹具见[浏览器文档](packages/paseo-ux/tests/browser/README.md)；Codex UI 的真实组件夹具通过统一服务的 `/conversation-ui.html` 访问。夹具结果不替代真实宿主中的交互检查。

完整检查由 `pnpm check` 组合，顺序如下：

| 命令 | 检查内容 |
| --- | --- |
| `pnpm check:env` | Node、pnpm 和必要工具版本 |
| `pnpm check:style` | Biome 格式与 lint |
| `pnpm check:public` | 公开源码、元数据与公开文件约束 |
| `pnpm check:boundaries` | 包与源码边界 |
| `pnpm typecheck` | 各包类型检查 |
| `pnpm test` | 各包现有测试与脚本测试 |
| `pnpm fixtures:build` | 构建 UX 浏览器夹具 |
| `pnpm pack:inspect` | 检查临时 npm 包的文件、运行入口和消费者安装 |

只需单独调试浏览器页面时，可在根目录运行 `pnpm fixtures:build` 和 `pnpm fixtures:serve`。服务默认监听 `127.0.0.1:8769`。

## 锁文件与消费者安装验证

根目录 `pnpm-lock.yaml` 服务于工作区开发和 CI。AIW npm 发布包使用包内的 `npm-shrinkwrap.json` 锁定消费者安装所用的依赖；两者用途不同。工作区依赖安装与检查入口由 pnpm 驱动。npm 可执行文件只用于对生成的 npm 发布包执行消费者安装验证：`pnpm pack:inspect`、`pnpm pack:release` 和包含 `pack:inspect` 的 `pnpm check` 会运行此验证，因此执行这些命令时需要本机可用 `npm`。

AIW Git 源码安装的准备步骤为 `pnpm install --prod --frozen-lockfile --ignore-scripts`，它在安装插件的 daemon 上执行，因此该 daemon 需要 pnpm。AIW Companion 还需要 Git、ripgrep（`rg`）与 AIW CLI。npm 发布包会移除 Git 源码安装专用的准备步骤；UX 和 Codex Theme 只依赖 Paseo 宿主环境。

有意调整 AIW 的依赖或版本后，运行 `pnpm lock:runtime` 更新消费者锁，再运行 `pnpm check`。脚本在临时目录保留原锁的已有解析结果，明确使用公共 npm registry，检查来源后才写回。不要把其他机器的 registry 配置或依赖目录复制进仓库。

## 格式与 lint

`pnpm format` 使用 Biome 统一 JS、TS、TSX 和 JSON 格式，`pnpm check:style` 只读检查。React Hooks 的缺失依赖仍作为错误；允许通过额外依赖表达刷新、重试和版本切换。必要的 revision 键或只读 token 序列例外须在对应行说明原因。非空断言沿用 TypeScript 的语言能力，由严格类型检查和行为测试约束，不另外作为通用风格告警。

## 版本和变更记录

三个插件分别维护版本号和 CHANGELOG。修改插件时更新受影响包的变更记录：[Paseo UX](packages/paseo-ux/CHANGELOG.md)、[AIW Companion](packages/paseo-aiw-companion/CHANGELOG.md)、[Codex Theme](packages/paseo-codex-theme/CHANGELOG.md)。共享工程调整按实际影响分别记录。尚未发布的工程调整记在 `Unreleased`，当前版本条目只概述仓库元数据所对应的能力，不虚构发行日期或发布状态。

## 打包产物

从仓库根目录运行 `pnpm pack:release` 会在 `work/packages/` 生成 `.tgz` 文件，用于检查与消费者安装验证。该命令只生成产物，不会发布到 npm。

已有同名产物时脚本会拒绝覆盖；先保留或移动需要的产物，再重新准备。仓库版本号与 CHANGELOG 的发布条目需要在单独确认的发行变更中确定。

手动发行入口见 [release.yml](.github/workflows/release.yml)。默认 `publish=false`，完成检查后只上传选定插件的 tarball。版本输入必须与包内版本一致；预发布版本使用 `next`。实际发布要求从 `main` 手动选择 `publish=true`，并经过 `npm` environment。

首次启用发布前，由维护者在 GitHub 配置该 environment 的审核规则，在 npm 确认 scope/包所有权、首次发布所需准备，以及指向本仓库 `release.yml` 和 `npm` environment 的 trusted publisher。当前提交不代表这些外部设置已经完成。云端发布使用支持 OIDC 的 npm；本地脚本没有发布入口。发布失败后先核验注册表中的版本和 dist-tag，再决定是否重试。
