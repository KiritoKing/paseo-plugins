# Personal Paseo plugins

个人维护的非官方 Paseo 插件 monorepo。插件以 `@chlrc` 命名，各包独立安装、独立版本；只安装你需要的插件。

| 插件 | Paseo 安装 ID | 声明兼容范围 | 用途 |
| --- | --- | --- | --- |
| [Paseo UX](packages/paseo-ux/README.md) | `paseo-ux` | `>=0.11.2 <0.12.0` | 图片聚合与预览、媒体面板、工作区会话恢复 |
| [AIW Companion](packages/paseo-aiw-companion/README.md) | `aiw-companion` | `>=0.11.1` | AIW 多仓文件树、Diff、搜索与布局 |
| [Codex Theme](packages/paseo-codex-theme/README.md) | `paseo-codex-theme` | `>=0.11.2 <0.12.0` | Codex 风格浅色与深色主题 |

历史验证记录涉及 Paseo 0.11.2。它是一个历史验证版本，不代表声明兼容范围中的所有版本都经过验证，也不构成对未来版本的保证。各插件的运行时要求和数据访问说明见对应 README。

## 安装

目前提供 Git 源码安装；仓库中的 npm 包名不表示这些包已发布到 npm。发布包的打包与安装验证见下方开发说明。

```sh
paseo plugin add git:KiritoKing/paseo-plugins --path packages/paseo-ux
paseo plugin add git:KiritoKing/paseo-plugins --path packages/paseo-aiw-companion
paseo plugin add git:KiritoKing/paseo-plugins --path packages/paseo-codex-theme
```

安装在对应的 Paseo daemon 上。目录安装时请保留对应源码目录。安装后，Codex Theme 需要在设置 → 外观中手动选择主题；安装不会自动切换主题。

> **保留插件设置：** `paseo plugin remove <id>` 会删除该安装 ID 的设置目录。若升级流程需要先移除再重装，或准备卸载但希望日后恢复设置，请先备份对应 daemon 的 `plugin-settings/<id>/`，重装后再恢复并读回。迁移步骤见[迁移说明](docs/migration.md)。

## 开发

支持 Node.js 22 和 24；开发默认使用 Node.js 24.22.0。pnpm 固定为维护中的 10.x 版本 `10.34.7`，以根目录 `package.json` 的 `packageManager` 字段为准。所有开发与 CI 工作区命令都从仓库根目录通过 pnpm 执行：

先确认 `pnpm --version` 为 `10.34.7`。未安装时可参考 [pnpm 安装说明](https://pnpm.io/10/installation)，安装指定版本后继续。完整检查还需要 Git、ripgrep、npm 和 tar；无需安装真实 AIW CLI 即可运行合成测试。

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm check
```

按需检查单个包：

```sh
pnpm --filter @chlrc/paseo-ux typecheck
pnpm --filter @chlrc/paseo-ux test
pnpm --filter @chlrc/paseo-aiw-companion typecheck
pnpm --filter @chlrc/paseo-aiw-companion test
pnpm --filter @chlrc/paseo-codex-theme typecheck
```

Codex Theme 没有独立测试命令。插件由 Paseo 编译 TypeScript 入口，不需要预构建。要在本机开发时加载插件，可从仓库根目录执行 `paseo plugin install ./packages/<package-directory>`，修改后重载对应安装 ID；远端使用时须安装到相应 daemon。UX 浏览器夹具见[浏览器文档](packages/paseo-ux/tests/browser/README.md)。

`pnpm check` 会依次运行环境、样式、公开文件、边界、类型、测试、浏览器夹具构建和打包清单检查。开发细项、消费者安装验证与包产物说明见[贡献指南](CONTRIBUTING.md)。

根目录 `pnpm-lock.yaml` 用于工作区开发和 CI。AIW npm 发布包使用自己的 `npm-shrinkwrap.json` 锁定消费者安装依赖；两份锁文件用途不同。npm 可执行文件只用于对生成的 npm 发布包做消费者安装验证：`pnpm pack:inspect`、`pnpm pack:release` 和包含 `pack:inspect` 的 `pnpm check` 会执行这一步。工作区依赖安装和检查入口仍由 pnpm 驱动。

Git 源码安装 AIW Companion 时，daemon 通过 `pnpm install --prod --frozen-lockfile --ignore-scripts` 准备生产依赖，因此需要 pnpm、Git、ripgrep（`rg`）和 AIW CLI。生成的 npm 包会移除这项 Git 专用准备步骤。UX 与 Codex Theme 只依赖 Paseo 宿主运行环境。

`pnpm pack:release` 会在 `work/packages/` 生成 `.tgz` 包供检查和消费者安装验证；它只生成文件，不会发布到 npm。

手动发行 workflow 默认只生成可下载产物。发布需要单独选择发布选项并配置 GitHub/npm 授权，详见[贡献指南](CONTRIBUTING.md)。

## 版本与变更记录

各包独立版本化，各自的变更记录位于包目录中的 `CHANGELOG.md`。

## 许可证

仓库使用 [MIT License](LICENSE)。
