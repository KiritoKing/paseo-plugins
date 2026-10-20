# 历史研究记录

本文件保留收敛前的研究和提案语境。用户已明确限定为既有界面的 UI／UX 变更；文中的工作概览、待处理聚合、审阅中心及新控制面功能提案均已撤回，不属于当前交付。当前范围以 [README](README.md)、[交互规格](interaction-spec.md) 与 [兼容合同](compatibility-contract.md) 为准。研究来源继续有效，功能推导须服从当前范围。

---

# Paseo 客户端体验重设计

本次设计围绕一个核心问题：当多个 AI 会话在不同机器和工作区运行时，人怎样用较少注意力确认进展、及时介入，并判断结果是否可以采用。成品是独立的 Paseo 插件，替换目前的 Codex theme；名称可变，媒体与会话恢复等既有 UX 功能继续由原插件负责。

状态：已形成 [同一套体验的三状态原型图](storyboard-v2/README.md)，等待视觉反馈。尚未确定实现目标，尚未实现可点击原型或替换运行中的插件。所有概念图使用合成数据，不是运行结果或插件验收截图。此前三稿保留为探索记录，后续以 [体验改造方向](experience-delta.md) 和 [兼容合同](compatibility-contract.md) 为准。

## 好的 AI 控制面帮助人完成什么

控制面的主要内容应是工作、决定和产物。执行轨迹提供解释，模型和运行环境提供上下文。界面需要让用户回答五个问题：当前在做什么、工作在哪里发生、是否需要我介入、结果依据是什么、下一步可以做什么。

高自动化与人的控制权可以同时增强。控制权应落实为可识别的工作范围、明确的介入时机、可检查的结果和有边界的恢复操作，而不是要求用户审批每一步。[Horvitz 的混合主动交互研究](https://www.erichorvitz.com/chi99horvitz.pdf)、[Shneiderman 的人本 AI 框架](https://arxiv.org/abs/2002.04087)

## 从 Codex 学到的体验结构

### 让内容占据主位

本轮读取的官方浅深色界面图展示了相同的信息结构：轻量侧栏、低干扰画布，以及聚合输入、配置和工作位置的 composer。两张图实际显示的是新会话入口，不能用来证明运行中、审批和审阅流程的体验。截图来自官方 changelog 的公开资源，属于版本化参考，不视为本机最新版的实机截图。[官方 changelog](https://learn.chatgpt.com/docs/changelog)、[浅色图](https://learn.chatgpt.com/images/codex/app/codex-app-basic-light.webp)、[深色图](https://learn.chatgpt.com/images/codex/app/codex-app-basic-dark.webp)

对 Paseo 的设计推导是：用字号、对齐和间距建立主次，减少重复标题与持久边框；强调色表达链接、焦点和可操作状态，状态同时提供文字。克制视觉不应削弱错误、权限和执行位置的辨识度。

### 输入区同时承担范围确认

在自然语言目标之外，工作位置、分支、上下文附件和执行配置决定了实际行为。把这些信息放在发送动作附近，可以帮助人在提交前确认范围。Paseo 的机器与 harness 更多，需要更明确地标出当前作用对象；详细配置可展开，日常界面不必常驻九个技术字段。[Codex 项目与工作目录说明](https://learn.chatgpt.com/docs/projects)

### 运行中消息有不同的生效时机

Codex 文档区分转向当前运行和排队到下一回合，并让排队消息保持可见、可编辑。这说明输入不是一个无状态的发送动作。Paseo 应明确表现能力和生效时机，不能让同一按钮在不同 harness 下暗中改变含义。[官方 prompting 文档](https://learn.chatgpt.com/docs/prompting#steering-and-queuing)

### 审阅是持续协作的一部分

Codex 的公开工程工作流将选择环境、介入运行、检查变更和继续修改连接起来。对 Paseo 的推导是：完成消息应把人带向产物与证据，并允许针对局部结果反馈；日志长度或一次工具成功不能替代验收。[官方 Remote 工作流](https://developers.openai.com/blog/mastering-codex-remote-for-engineering)

### 可以借鉴的外观与需要重新设计的部分

系统字体、中性画布、轻量行、克制状态色、可展开执行细节适合延续。Paseo 的多 host、多 harness 和多 workspace 关系则需要独立设计：不能把 Codex 的单一执行体验直接套用到所有 provider，也不能为了保持简洁而隐藏作用范围。

社区的 [Codex design guidelines](https://codex-design.beacon.host/) 提供了作者自述从应用提取和测量的视觉规则。它是社区重建资料，具体像素值与版本覆盖未在本轮独立复核，不作为官方设计系统或直接复制代码的依据。

## 跨产品研究形成的原则

| 原则 | 对 Paseo 的具体要求 | 依据与证据性质 |
| --- | --- | --- |
| 观察与操作分开 | 默认展示阶段、最近进展、等待原因；控制动作说明作用对象与生效时机 | [Crosley 的控制面分析](https://blakecrosley.com/blog/agentic-design-control-surface)，设计作者主张 |
| 服务强度随情境变化 | 常规工作持续运行；真正需要判断时再引起注意；支持纠错与退出 | [HAX 指南](https://www.microsoft.com/en-us/research/wp-content/uploads/2019/01/Guidelines-for-Human-AI-Interaction-camera-ready.pdf)，HCI 研究 |
| 透明度面向判断 | 默认摘要，展开查看动作、目标与输出；不把原始思考文本当作可靠解释 | [Richard Simms 的 Agent to UI](https://www.rsimms.com/stories/agent-to-ui)，设计作者主张 |
| 介入应有时间语义 | 区分继续、排队、转向和停止；未确认支持的能力回到原生会话 | [VS Code 的运行控制](https://code.visualstudio.com/learn/foundations/reviewing-and-controlling-agent-changes)，厂商功能说明 |
| 权限与具体动作关联 | 展示真实请求、目标、范围和可选动作；提交后读取最终状态 | [Cursor run modes](https://cursor.com/docs/agent/security/run-modes)，厂商功能说明 |
| 结果可被局部检查 | 关联文件、差异、命令结果和未验证项；反馈能指向具体产物 | [VS Code 的改动审阅](https://code.visualstudio.com/learn/foundations/reviewing-and-controlling-agent-changes)，厂商功能说明 |
| 恢复范围必须准确 | 重试、恢复会话、分叉和文件回滚分别说明；不暗示能撤销外部副作用 | 同上，检查点边界的官方说明 |

这些原则用于设计推导。论文、作者文章和产品文档不能证明拟议界面已经改善了 Paseo 用户表现；社区帖子也不足以推断问题频率。本轮未开展用户实验。

## 优先解决的设计风险

下表是按潜在后果排列的设计风险，不是已经复现的 Paseo 缺陷清单。缺少用户样本和产品遥测，发生频率均未知。

| 优先级 | 用户目标与可能断点 | 证据与置信度 | 对应设计动作 |
| --- | --- | --- | --- |
| 高 | 对正确机器、目录和会话操作；跨上下文后可能误认目标 | 多 host 与 workspace／agent 关联来自版本化 SDK，关系本身置信度高；误操作程度待实测 | 持续可见的范围区，动作携带 host／workspace／session 身份 |
| 高 | 判断目标是否已经达成；可能把 turn 结束理解为交付完成 | `idle` 与任务验收不同属于已核实的 SDK 语义；界面误解属于待验证风险 | 将执行状态与检查证据、人工接受分别呈现 |
| 中 | 在运行中补充信息；可能不清楚消息何时生效 | Codex 与 VS Code 文档明确区分不同介入方式；Paseo 插件统一控制能力有缺口 | 显示真实可用动作及时间语义，能力不足时打开原生会话 |
| 中 | 管理并行工作；可能不得不逐条阅读 transcript 才知道哪里需要人 | HCI 指南与设计师分析支持注意力分配原则，具体效果置信度中等 | 待处理入口优先呈现真实阻塞，轨迹默认摘要、按需展开 |
| 中 | 审阅本次结果；可能把整个 workspace 的差异归给单个会话 | 当前 workspace DTO 提供 diffStat，缺少已确认的逐会话文件所有权证据 | 标出工作树／分支／证据范围，不虚构“本 agent 修改”的归属 |

第一轮检验范围识别、状态理解和一次完整反馈循环；交互夹具与真实插件复用组件和能力适配，在既有包与公开扩展点内演进。后续再通过多机器切换、长历史和移动端任务检验注意力负担。视觉偏好与实际任务表现分开评估。

## 三套模型对应三条轴

| 模型 | 用户需要理解的问题 | 默认呈现 | 按需展开 |
| --- | --- | --- | --- |
| Client → Server → Runtime | 我从哪里控制，工作在哪里继续，当前状态是否新鲜 | 目标 host、连接状态、最近同步状态 | 当前 client、server 与执行 runtime 的关系和诊断 |
| Control → Harness → Model | 谁组织工作，谁执行，使用哪个模型及能力 | Paseo 上下文、当前 harness 与选定模型 | provider 支持的模式、权限、effort、能力差异 |
| Project → Workspace → Session | 工作属于什么，在哪个隔离目录，沿用哪个会话上下文 | 项目／工作区路径与当前 session | 分支、目录、会话关系、历史与归档 |

这是交互建模，不是要求实现九级导航。Project 组织长期相关工作，Workspace 表示共享文件与工具的工作空间，Session 承载持续对话与多个 turn。Session 不能等同于一个 turn，Runtime 也不能等同于持久会话。

详细状态与流程见 [交互规格](interaction-spec.md)，本轮收敛的改造重点见 [体验改造方向](experience-delta.md)，界面归属、插件共存和升级验收见 [兼容合同](compatibility-contract.md)。

## 研究与审计的证据范围

- Codex 原生窗口被当前计算机工具明确限制访问，没有尝试绕过。关于其体验的结论来自官方界面资料、功能说明和公开设计研究，不能称为完整实机审计。
- 已读取 Paseo 当前客户端的可访问结构；一次原生截图与所读取窗口不一致，已排除出审计与生成参考。没有将其他工作区内容用于概念图。
- 已捕获并检查 Paseo 官网的公开产品展示页。该页是产品演示，不代表完整真实客户端或交互验收。
- 已实际读取上列官方浅深色参考图。后续视觉生成只附加公开参考资料，使用合成项目、工作区和会话数据。
- SDK 可实现性以 Paseo `v0.11.4` 版本化文档与源码声明为依据；尚未编译或运行新插件。官网当前版本及社区插件的兼容声明不能替代本机验收。

## 产品设计流程与交付

当前阶段形成研究、交互合同与兼容边界。工作区、待处理与审阅合为一套协作循环，配色作为可调 token。下一轮视觉验证应展示关键状态与跳转，不能再将三个工作阶段当作互斥产品方向。确定视觉目标后，在现有插件基础上实现公开 API 承载的主流程，并在真实客户端验收。概念图、交互夹具、插件运行、目录审核和正式上架分别提供证据。

此前三个视觉稿已保存到 `concepts/`；[产物清单](concepts/manifest.json) 记录它们在本轮对话中的实际显示顺序、文件和校验值，[生成说明](concepts/prompts.json) 记录公开参考与完整提示词。它们尚未选定，且不足以说明交互差异，不作为当前选型或整个原生外壳的实现约束。

最终发布素材必须来自实际运行的插件，不能将生成的概念图用作实现截图。发布要求以当时的 [官方指南](https://paseo.sh/docs/plugins/publishing) 为准。
