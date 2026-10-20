# UI／UX 插件兼容合同

当前合同仅适用于既有界面呈现与展示交互。工作概览、待办汇总、审阅／证据中心与执行自动化均已撤回。候选已实现，具体证据与未验证范围见[验证记录](../../packages/paseo-codex-theme/VALIDATION.md)。

## 能力与归属

本插件使用公开主题、timeline 展示与外观设置接口。Paseo 继续拥有侧栏结构、路由、pane、会话、composer、权限、模型与运行控制。媒体预览、会话恢复和 Companion 等既有功能保留原有归属；本插件不对它们增加强制依赖。

首版不注册业务 screen／panel／sidebar item／pill，不调用创建会话、发送、权限响应、归档、Git／文件读取等业务操作。后端仅在外观偏好存储需要时使用公开 settings API，不注册自动跟进或配置修改 hook。

既有研究读取的 App／CLI 为 `0.11.4`，开发 SDK 为 `0.11.2`，theme manifest 为 `>=0.11.2 <0.12.0`；这些是读取时的基线，不能代替实施时的兼容检查。历史源码依据为官方 `v0.11.4` commit `dc5b02f7d7c120baea380d76def8b968020d8823`。[证据索引](evidence/compatibility-sources.json) 保留源码校验与函数探针。

## Timeline 共存

该基线的宿主对同一条消息采用第一个有效 transformer 输出；`undefined` 才继续，空数组也会认领。插件不能依靠改名或加载先后来保证叠加。[源码与仲裁实现](https://github.com/getpaseo/paseo/blob/dc5b02f7d7c120baea380d76def8b968020d8823/packages/app/src/plugins/timeline/model.ts#L74-L112)

五个直接源函数探针验证了这些仲裁行为，不是插件集成测试。替换后的 renderer 缺失／schema 失败显示 unavailable，组件错误由错误边界处理，不能声称必定恢复原生消息。[渲染实现](https://github.com/getpaseo/paseo/blob/dc5b02f7d7c120baea380d76def8b968020d8823/packages/app/src/plugins/timeline/view.tsx#L49-L94)

因此：

- 各消息类型的增强独立开关；同类消息由用户明确选择一种 renderer，不自动关闭其他插件。
- 不支持的内容在认领前返回 `undefined`，不返回空数组，不消费其他插件拥有的行，不持久化新的 timeline 项。
- 先保证 schema、renderer 和内容完整性，再认领。错误不扩散到其他模块；关闭后的原生恢复行为必须实测。
- Assistant 正文增强须额外验证媒体、附件、选择、复制和查找。验证不足的内容保留原生，避免破坏 `paseo-ux` 的既有媒体能力。
- 不宣称自动检测所有冲突或兼容任意可信插件；记录具体组合及版本。

## 可选局部样式适配

公开 API 未提供的 composer／外壳排版只作为单独的 desktop／web 候选模块，默认关闭，先验证再纳入支持。该模块不拥有消息数据、业务行为或全局布局。

使用明确的版本与结构识别、局部 root 和本插件命名空间；不全局覆盖原生选择器、不搬移控件、不截获输入和快捷键、不读取或改写内部 store／bridge。结构不符时不应用；清理只撤销本插件仍拥有的样式及资源。无法满足这些条件就不提供该增强。

## 版本、设置与资源

保持既有安装 ID `paseo-codex-theme` 和主题 ID `codex-light`／`codex-dark`，显示名称可调整；不通过删除重装来改名。安装不自动切换主题，不改变 provider／model／权限或其他插件设置。

Manifest 最低版本为 `>=0.11.2`。使用的 API 同时以开发 SDK 0.11.2 和隔离的 0.12.0 公开声明作严格类型检查，不保留缺少依据的次版本上限；能力检查失败时不认领原始消息。当前 App／daemon 运行目标仍为 0.11.4；0.12.0 的声明检查不是运行验收。[官方 requirements](https://paseo.sh/docs/plugins/reference#requirements)

外观偏好使用公开 settings API，它是 host 共享数据，不能当作设备本地或跨 host 全局设置。保留 revision 冲突及 invalid 数据，避免静默覆盖。订阅、定时器、样式与注册项随本模块生命周期清理，不建立后台全量会话订阅。

## 验收矩阵

| 场景 | 必须验证 |
| --- | --- |
| 各类消息／工具、长历史与流式更新 | 信息完整、展开与焦点稳定，失败可见，复制／链接／查找正常 |
| 浅深色、宽窄窗、键盘、输入法、触控 | 可读可操作，不改变原生发送与运行行为 |
| `paseo-ux`、Companion 及适配当前版本的聊天增强插件 | 原有功能正常；同类 renderer 的选用与限制明确 |
| 全部关闭、单项关闭、重载、断线 | 原生可恢复，自己拥有的资源与样式清理完整 |
| 可选局部适配遇到新标记或不支持平台 | 不应用增强，不影响消息和输入 |
| 拟支持的新 App／daemon 版本 | 审查 API delta，运行上述回归后再修改 manifest |

验收记录包含实际 App／daemon／SDK／插件版本、共存版本与开关、步骤及运行截图。源码阅读、探针、类型检查、running 状态和真实 UI 验收分别说明。
