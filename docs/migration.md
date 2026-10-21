# 插件迁移与设置保留

本仓库承接此前分散维护的插件源码：Paseo UX 导入自独立仓库提交 `f24a903`；AIW Companion 基于既有 `0.5.0` 源码快照。两个插件的 Paseo 安装 ID 保持为 `paseo-ux` 和 `aiw-companion`，迁移不更改其设置命名空间。后续维护以本 monorepo 为准。

## 升级或卸载前保留设置

Paseo 的 `plugin remove` 会删除被移除插件在该 daemon 上的设置目录。若升级时必须先移除再安装，或卸载后可能需要恢复插件设置：

1. 在对应的 daemon 主机上备份 `plugin-settings/<id>/`。每个 daemon 的设置分别保存；例如 `<id>` 可以是 `paseo-ux` 或 `aiw-companion`。
2. 按插件 README 中的当前安装方式移除并重新安装插件。
3. 将备份恢复到同一 daemon 的对应设置目录，并读回需要保留的值。

如果不需要保留设置，正常卸载即可。升级前是否必须先移除取决于具体升级方式；不要仅为迁移而删除安装。根 README 和各插件 README 均保留 `plugin remove` 的设置删除提醒。

## 会话阅读并入 Essentials

独立的 `paseo-codex-theme` 包已移除。正文排版、思考折叠、可选工具记录与“全部折叠（仅输出）”迁入 Essentials。Essentials 保留 `paseo-ux` 安装 ID、npm 包身份和原有 `media` 设置；会话阅读使用独立的 `appearance` 设置，版本仍为 1。插件不再注册主题，配色由 Paseo 当前主题提供。

已有会话偏好只在同一 daemon 上迁移，不从其他 host 自动收集设置：

1. 备份 `plugin-settings/paseo-codex-theme/` 与 `plugin-settings/paseo-ux/`，然后停用旧主题插件。停用会释放其主题与时间线贡献，原始会话记录保留。
2. 将旧插件的完整 `appearance.json` 保留到 Essentials 的设置目录。保留文件的 `version` 和 `values`，不要把它合入 `media.json`。如果 Essentials 已有 `appearance.json`，默认保留已有目标设置，先明确需要覆盖的偏好再操作。
3. 更新 Essentials；如果更换安装来源必须先卸载，卸载前保存上一步准备的设置目录，重新安装前恢复，再读回每项设置。
4. 确认 Essentials 的会话阅读设置与附件／会话功能正常后，卸载 `paseo-codex-theme`。不要同时保留两份会话呈现插件来处理同类消息。

移除已选中的旧主题后，Paseo 按自身规则回退到默认主题；Essentials 不强制另选配色。此迁移不会恢复已经被其他卸载操作删除、且没有备份的偏好。
