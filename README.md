# Personal Paseo plugins

个人 Paseo 插件 monorepo，使用 `@chlrc` npm scope。各插件独立安装、独立版本；这是非官方项目。

| 包 | Paseo 安装 ID | 功能 |
| --- | --- | --- |
| [@chlrc/paseo-ux](packages/paseo-ux/README.md) | `paseo-ux` | 连续图片聚合、媒体面板、大图手势与方向键、工作区会话恢复 |
| [@chlrc/paseo-aiw-companion](packages/paseo-aiw-companion/README.md) | `aiw-companion` | AIW 多仓文件树、Diff、搜索与可拖拽布局 |
| [@chlrc/paseo-codex-theme](packages/paseo-codex-theme/README.md) | `paseo-codex-theme` | 独立的 Codex 风格浅色与深色主题 |

## 安装

这些包目前提供 Git 源码安装；仓库中的 npm 名称不代表已经发布到 npm。

```sh
paseo plugin add git:KiritoKing/paseo-plugins --path packages/paseo-ux
paseo plugin add git:KiritoKing/paseo-plugins --path packages/paseo-aiw-companion
paseo plugin add git:KiritoKing/paseo-plugins --path packages/paseo-codex-theme
```

只安装需要的插件。插件安装在对应 daemon 上；主题插件安装后，在设置 → 外观选择 Codex Light 或 Codex Dark。各包的 `OVERVIEW.md` 与 README 说明兼容版本和使用方式。

## 开发

使用 Node.js 22 或更新版本与 npm。保留现有 npm 工具链，根工作区统一维护锁文件。

```sh
npm ci --ignore-scripts
npm run check
paseo plugin install ./packages/paseo-ux
paseo plugin install ./packages/paseo-aiw-companion
paseo plugin install ./packages/paseo-codex-theme
```

Paseo 直接编译插件的 TypeScript 入口，无需预构建。修改后重载对应安装 ID；不要重启 daemon。独立浏览器夹具的使用方式见 UX 包的 `tests/browser/README.md`。

`check` 检查公开源码与包元数据，执行所有包的类型检查和现有测试，并检查 npm 打包文件清单。CI 只做这些检查，普通 push 不发布 npm 包。发行版本必须单独授权，通过 CI 发布；本仓库当前没有配置 npm 发布流程或账号权限。

## 迁移

UX 从原本的独立本地 Git 仓库提交 `f24a903` 导入；AIW Companion 从既有 0.5.0 源码快照导入。两个原安装 ID 保持不变，迁移不更改插件设置的命名空间。Paseo 的 `plugin remove` 会删除该安装 ID 的设置目录；迁移目录安装前必须备份 daemon home 下对应的 `plugin-settings/<id>/`，安装完成后恢复并读回。旧目录作为历史副本保留，新维护入口是本仓库。

仓库收纳源码、合成测试和通用说明；原有机器、会话和业务数据的验收回执保留在原目录，没有复制到公开仓库。新验证范围见 [VALIDATION.md](VALIDATION.md)。
