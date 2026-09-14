# “灵境·课室”最小产品原型：数学框架、软件架构、产品开发

> ⚠️ **编辑注（2026-09-09，产品/架构/路线图）**
> 本文件是"灵境·课室"最小产品原型蓝图（产品定位 + 精化数学框架 + 软件架构 + 开发路线）。与当日其他决策的关系与诚实标注：
>
> - ⚠️ **与本会话早前决策冲突**：用户在 16:06 刚定"先验证、不提前交税、不改语言"，并已在 JS 原型（`world.js`/`teacher.js`）跑通教师 MVP。本文件却 proposing **Unity WebGL + ASP.NET Core/Python + SignalR + PostgreSQL + Redis + Neo4j + Azure TTS/ASR + 阿里云部署**（6+ 运行时/服务、月成本 ¥1.1–2.1k、需云部署）——正是"提前交税 + 改多语言"的反面。按"不交税"决策，本文件仅作**未来目标/愿景**留存，不立即执行。
> - ⚠️ **三套技术栈互相打架**：本会话已出现三种不一致的技术构想——(a) JS 单语言原型【验证中】(b) C++/Python/Go【15:4x 用户拍板目标】(c) 本文 Unity+.NET+Python+PostgreSQL+Redis+Neo4j+Azure【本文件】。其中 .NET vs Go、Unity vs C++、Neo4j 均不重合，须用户择一统一，否则无法开工。
> - ⚠️ **"全栈工程师1名 已有"不成立**：用户是数学功底深但**不懂代码**的独立创始人（见 MEMORY）；该路线图假设的工程产能用户并不具备。22 天单人交付 Unity 3D + 多后端 + 多数据库 + 云语音是不现实的，须以"AI/外包代工"重估工期与成本。
> - ✅ **MVP 数学框架自洽且合理**：\(\Psi=\mathcal{C}\otimes\mathcal{K}\otimes\mathcal{T}\)、\(\text{Teach}=E\circ U\circ P\)、\(V=\alpha\cdot\Delta K/\Delta t+\beta\cdot\text{互动}+\gamma\cdot S\)（固定权重）、\(\text{Student}_i=(p_i,k_i,q_i,s_i)\)、DAG 验证——且**已基本被现有 JS 原型覆盖**（Teach 人→AI 课堂循环、R_teach、V(s) 标量代理；本文件 V 是更具体的三项加权式）。
> - ⚠️ **过度基建**：MVP 阶段上 Neo4j（知识图谱）、Azure TTS/ASR、云部署均为 premature；验证"真人愿来教"用现有文本原型即可，3D 课室+Avatar+语音是成本最高、验证价值最低的块。

---

## “灵境·课室”最小产品原型：数学框架、软件架构、产品开发

### 🎯 产品定位

**一句话定义**：一个让人类在虚拟课室中体验“教师”职业的Web/VR应用。人类教师面对AI学生，传授任何知识，AI实时响应、提问、反馈。

**最小场景**：
- 课室：一间3D虚拟课室（讲台、黑板、课桌椅、窗外光影）
- 职业：教师
- AI学生：3-5名具有不同性格、学习进度的AI学生
- 核心交互：教师讲课→AI学生听讲、提问、回答→教师获得教学反馈

### 📐 第一部分：数学框架（适配最小原型的精化版）

#### 一、状态空间（简化版）

针对单一课室场景，状态空间简化为：

\[
\boxed{\Psi(t) = \mathcal{C}(t) \otimes \mathcal{K}(t) \otimes \mathcal{T}(t)}
\]

| 分量 | 定义 | 维度 | 数据类型 |
| :--- | :--- | :--- | :--- |
| \(\mathcal{C}(t)\) | 课室物理状态 | 3D空间布局、教师位置、AI学生位置 | 三维坐标+姿态 |
| \(\mathcal{K}(t)\) | 知识状态 | 当前教学内容、每个学生的理解程度 | 向量 \( \mathbb{R}^{d} \) |
| \(\mathcal{T}(t)\) | 教师状态 | 教师意图、教学行为、表达方式 | 意图向量 |

**简化说明**：通用框架中的 \( \mathcal{H} \)（人类状态）在这里具象化为教师状态 \( \mathcal{T} \)，\( \mathcal{P} \)（物理状态）具象化为课室状态 \( \mathcal{C} \)，\( \mathcal{I} \)（信息状态）具象化为知识状态 \( \mathcal{K} \)。张量积在工程实现中用组合对象替代。

#### 二、教学通道（核心数学运算）

\[
\boxed{\text{Teach} = \text{Express} \circ \text{Understand} \circ \text{Perceive}}
\]

**Perceive**（教师感知课室）：
- 输入：课室状态 \( \mathcal{C}(t) \)、AI学生状态
- 输出：教师感知到的教学情境 \( \mathcal{S}_{\text{情境}} \)
- 数学形式：多模态特征融合

**Understand**（教师理解情境→形成教学意图）：
- 输入：教学情境 \( \mathcal{S}_{\text{情境}} \)
- 输出：教学意图 \( \mathcal{I}_{\text{教学}} \)
- 数学形式：意图推理（基于知识图谱）

**Express**（教师表达意图→改变课室/知识状态）：
- 输入：教学意图 \( \mathcal{I}_{\text{教学}} \)
- 输出：课室变化 \( \Delta\mathcal{C} \)、知识变化 \( \Delta\mathcal{K} \)
- 数学形式：语音合成、3D动画、知识更新

#### 三、教学价值泛函（MVP版本）

\[
\boxed{
V = \alpha \cdot \underbrace{\frac{\Delta K}{\Delta t}}_{\text{知识传递速率}} + \beta \cdot \underbrace{\frac{1}{1+\sigma_{\text{互动}}}}_{\text{互动质量}} + \gamma \cdot \underbrace{S_{\text{教师}}}_{\text{教师满意度}}
}
\]

- \( \Delta K \)：AI学生对当前知识点的理解提升幅度
- \( \Delta t \)：教学时间
- \( \sigma_{\text{互动}} \)：AI学生提问/回答的困惑程度
- \( S_{\text{教师}} \)：教师自我评价（简单星级反馈）

**MVP阶段采用固定权重**：\( \alpha = 0.5, \beta = 0.3, \gamma = 0.2 \)

#### 四、AI学生模型（简化版）

每个AI学生 \( i \) 的状态：

\[
\boxed{
\text{Student}_i = (p_i, k_i, q_i, s_i)
}
\]

| 属性 | 含义 | 取值范围 |
| :--- | :--- | :--- |
| \( p_i \) | 性格类型 | 好奇型/沉稳型/活泼型/严谨型 |
| \( k_i \) | 当前理解程度 | [0, 1] |
| \( q_i \) | 当前困惑点 | 概念ID或文本 |
| \( s_i \) | 情绪状态 | 专注/困惑/疲惫/兴奋 |

#### 五、教学行为图

\[
\boxed{
\text{TeachingGraph} = (V, E)
}
\]

- \( V \)：教学节点（知识点、提问、讲解、练习）
- \( E \)：教学依赖（A必须学完才能学B）

**验证条件**：\( \text{TeachingGraph} \) 必须是DAG（有向无环图）

#### 六、MVP数学框架总结

| 数学对象 | 用途 | 实现方式 |
| :--- | :--- | :--- |
| \( \Psi = \mathcal{C} \otimes \mathcal{K} \otimes \mathcal{T} \) | 整体状态 | 游戏引擎中的场景对象 + 数据结构 |
| \( \text{Teach} = E \circ U \circ P \) | 教学交互流程 | 事件驱动的处理管道 |
| \( V = \alpha \cdot \Delta K/\Delta t + \beta \cdot \text{互动质量} + \gamma \cdot S \) | 教学效果评估 | 实时计算+用户反馈 |
| \( \text{Student}_i = (p_i, k_i, q_i, s_i) \) | AI学生模型 | 数据结构+LLM Prompt |
| DAG验证 | 教学逻辑一致性 | 图数据库拓扑检查 |

### 🏗️ 第二部分：软件架构

#### 一、整体架构图

（前端层：3D课室 Unity WebGL / 语音交互 Web Audio / UI React；API Gateway / SignalR Hub；教学引擎层 C#/Python；AI代理层 Python/LLM；数据层 PostgreSQL/Redis；外部服务层 LLM API / TTS / ASR）

#### 二、核心模块详细设计

**1. 前端层：3D课室（Unity WebGL）**

| 组件 | 功能 | 技术选型 |
| :--- | :--- | :--- |
| 课室场景 | 3D课室、讲台、黑板、课桌椅 | Unity 2022 LTS + URP |
| 教师角色 | 教师Avatar（第一人称+第三人称） | Unity Animator + Mixamo |
| AI学生 | 5名AI学生的3D Avatar | Unity Animator + 随机动画 |
| 语音交互 | 教师语音输入 | Web Audio API |
| UI界面 | 教学仪表盘、知识状态显示 | Unity UI |

**关键交互**：教师移动 WASD + 鼠标视角；教学动作点击黑板写字、举手、翻页；语音输入点麦克风说话。

**2. 教学引擎层（核心逻辑）**

| 组件 | 功能 | 数学对应 |
| :--- | :--- | :--- |
| 教学流程管理器 | 管理Teach = E∘U∘P的流程 | 教学通道 |
| 教学价值计算器 | 计算V值，反馈给教师 | 教学价值泛函 |
| DAG验证器 | 检查教学行为是否形成环 | 教学行为图 |
| 状态同步器 | 维护Ψ的一致性 | 状态空间 |

**3. AI代理层（AI学生）**

| 组件 | 功能 |
| :--- | :--- |
| 学生状态管理器 | 维护5个AI学生的(p_i, k_i, q_i, s_i) |
| LLM路由 | 根据学生性格和状态，路由到不同Prompt |
| 对话生成 | 生成AI学生的提问、回答、反馈 |
| 表情/动作生成 | 根据情绪状态驱动3D动画 |

**4. 数据层**

| 数据 | 存储方式 |
| :--- | :--- |
| 用户信息 | PostgreSQL |
| 教学记录 | PostgreSQL（时间序列） |
| 知识图谱 | Neo4j（轻量级） |
| 实时状态 | Redis |
| 会话历史 | 文件存储（JSON） |

#### 三、技术选型总览

| 层级 | 技术 | 理由 |
| :--- | :--- | :--- |
| 前端3D渲染 | Unity 2022 LTS + WebGL | 成熟、3D表现力好、Web兼容 |
| 前端UI | 内嵌Unity UI | 减少技术栈数量 |
| 后端框架 | ASP.NET Core 8 / Python FastAPI | 性能好、生态丰富 |
| 实时通信 | SignalR (WebSocket) | 原生支持实时双向通信 |
| 数据库 | PostgreSQL + Redis | 关系型+缓存，满足MVP需求 |
| 知识图谱 | Neo4j (AuraDB免费层) | 轻量、适合MVP |
| LLM | DeepSeek API + GLM API | 国产、性价比高 |
| TTS/ASR | Azure Cognitive Services | 质量好、稳定 |
| 部署 | 阿里云ECS + 云数据库 | 国内访问快、MVP成本可控 |

### 🛠️ 第三部分：产品开发路线

（MVP 功能范围 P0/P1/P2；Phase 0–3 共 10 周；详细任务分解；最小功能清单 F01–F10 约 22 天；资源 ¥1,100–2,100/月；市场验证目标；后续 v1.1–v2.0 路线。详见用户原文。）

### 📊 总结：三个核心内容对照表

| 维度 | 核心内容 | 关键决策 |
| :--- | :--- | :--- |
| **数学框架** | \(\Psi = \mathcal{C} \otimes \mathcal{K} \otimes \mathcal{T}\) + Teach = E∘U∘P + V = α·ΔK/Δt + β·互动质量 + γ·S | 固定权重、简化状态、DAG验证 |
| **软件架构** | 前端Unity WebGL + 后端.NET Core/Python + 实时通信SignalR + 数据库PostgreSQL/Redis | 分离渲染与逻辑、LLM异步、实时双向通信 |
| **产品开发** | MVP 10个P0功能 + 3阶段迭代 + 1人全栈 + ¥1,100-2,100/月成本 | 单场景聚焦、语音优先、快速验证 |

### 💎 一句话总结

**数学框架描述了教学本质（Teach = E∘U∘P），软件架构支撑了教学流程（前端渲染+后端逻辑+实时通信），产品开发验证了教学价值（10个P0功能+3阶段迭代），三者共同构成了“灵境·课室”最小原型的完整蓝图，可在3个月内投入市场验证。**

---

## 附：AI 诚实评估（与编辑注一致）

- 这份蓝图作为**未来产品的目标描述**是完整、可读、可讨论的；其 MVP 数学框架自洽，且与现有 JS 原型高度重合。
- 但它的执行前提（Unity 3D + .NET + Python + PostgreSQL + Redis + Neo4j + Azure + 阿里云）与你在 16:06 拍板的"先验证、不提前交税、不改语言"**直接冲突**，也与 15:4x 的 C++/Python/Go 目标**不一致**。三套栈必须择一统一。
- 最关键的一点：路线图假设"全栈工程师1名 已有"，而你是**非码农独立创始人**——这份 22 天 / ¥1.1–2.1k 的计划对你不可直接执行，需以"AI 代工或外包"重估工期与现金。
- 建议：本文件作**愿景/未来目标**留存；当前仍用 JS 文本原型验证"真人愿来教"，拿到信号后再谈 Unity/云/多数据库。
