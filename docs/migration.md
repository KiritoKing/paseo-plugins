# 插件迁移与设置保留

本仓库承接此前分散维护的插件源码：Paseo UX 导入自独立仓库提交 `f24a903`；AIW Companion 基于既有 `0.5.0` 源码快照。两个插件的 Paseo 安装 ID 保持为 `paseo-ux` 和 `aiw-companion`，迁移不更改其设置命名空间。后续维护以本 monorepo 为准。

## 升级或卸载前保留设置

Paseo 的 `plugin remove` 会删除被移除插件在该 daemon 上的设置目录。若升级时必须先移除再安装，或卸载后可能需要恢复插件设置：

1. 在对应的 daemon 主机上备份 `plugin-settings/<id>/`。每个 daemon 的设置分别保存；例如 `<id>` 可以是 `paseo-ux` 或 `aiw-companion`。
2. 按插件 README 中的当前安装方式移除并重新安装插件。
3. 将备份恢复到同一 daemon 的对应设置目录，并读回需要保留的值。

如果不需要保留设置，正常卸载即可。升级前是否必须先移除取决于具体升级方式；不要仅为迁移而删除安装。根 README 和各插件 README 均保留 `plugin remove` 的设置删除提醒。
