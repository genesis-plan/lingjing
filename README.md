# 灵境 LingJing

> **在数字空间中构建的、与真实三维物理世界 + 时间线保持严格结构对应的通用虚拟空间。**
> 它不是游戏，不是元宇宙，而是真实物理世界的"结构等价"数字副本——
> 任何需要理解物理世界的智能体（机器人或人）的**物理想象力引擎**。

---

## 一、框架的数学结构

\[
\text{灵境} = \langle \; \mathcal{M}_{3,1},\; \mathcal{E}_{\text{PDE}},\; \mathcal{B}_{\partial},\; \Phi_{\text{Holo}},\; \mathcal{I}_{\text{处理}} \; \rangle
\]

| 符号 | 含义 |
| :--- | :--- |
| \(\mathcal{M}_{3,1}\) | 三维空间 + 时间的连续流形 |
| \(\mathcal{E}_{\text{PDE}}\) | 描述物理规律的偏微分方程组 |
| \(\mathcal{B}_{\partial}\) | 边界 / 信息处理面（低维映射空间） |
| \(\Phi_{\text{Holo}}\) | 体空间 → 边界的全息映射核（POD/SVD 降阶实现） |
| \(\mathcal{I}_{\text{处理}}\) | 边界上的信息处理算子（智能推理发生的地方） |

**五层结构**

| 层 | 名称 | 数学对象 | 本仓库实现 |
| :--- | :--- | :--- | :--- |
| 1 | 物理底座 | \(\mathcal{M}_{3,1} + \mathcal{E}_{\text{PDE}}\) | `rom.js` / `lingjing_rom.py` — 二维热传导 PDE |
| 2 | 体空间状态 | \(\phi(t,\mathbf{x})\) | `HeatWorld`（FTCS 显式步进） |
| 3 | 全息映射 | \(\Phi_{\text{Holo}}: \phi \mapsto \psi\) | `HoloMap.build()` — POD/SVD 降阶 |
| 4 | 边界智能层 | \(\mathcal{I}(\psi) \mapsto \psi'\) | `fit_linear()` / `predict()` + 灵脑决策核 |
| 5 | 反向映射 | \(\Phi_{\text{Holo}}^{-1}: \psi' \mapsto \phi'\) | `HoloMap.reconstruct()` |

**闭环**：感知 → 体状态更新 → 全息投影 → 边界推理 → 反向映射 → 行动 → 反馈。

---

## 二、双轨实现

同一套五层数学，两套实现，**参数逐一对齐、数字交叉验证**：

| | JS 版（浏览器） | Python 版（NumPy） |
| :--- | :--- | :--- |
| 核心数学 | `rom.js` | `lingjing_rom.py` |
| 演示界面 | `index.html`（三视图 + 审计面板，双击即开） | — |
| 验真 | `verify.js` | `verify.py` |
| 决策核 | `lingnao-decision.js` | 内置 `VerifyLedger` / `decide` |
| SVD 后端 | 手写 Jacobi 旋转 | **LAPACK**（`np.linalg.eigh`） |
| 规模上限 | N≈1200 已吃力 | **N=30000 仅 92ms** |
| 审计哈希 | cyrb53（演示链） | **SHA-256（真重算校验）** |
| 用途 | 演示 / 分发 | 真规模计算 / 机器人生态接入（ROS、NumPy） |

---

## 三、快速开始

### Python 版（推荐用于计算）

```bash
pip install numpy
python verify.py
```

可选接入真灵数求解器（lingshu-solver，JS 实现，经子进程调用）：

```bash
export LINGSHU_CORE=/path/to/lingshu-solver/solver-core.js
export LINGJING_NODE=/path/to/node     # 可选，默认 "node"
python verify.py
```

未配置时脚本**诚实跳过并标注**，不会假装做了认证求解。

### JS 版（浏览器演示）

```bash
node verify.js          # 命令行验真
# 或直接用浏览器打开 index.html
```

---

## 四、验真数字（两版交叉验证，非动画）

| 指标 | JS 版 | Python 版 |
| :--- | :--- | :--- |
| L1/L2 热传导峰值扩散 | 1.0000 → 0.6670 | 1.0000 → 0.6670（一致） |
| L3 能量捕获率 | 99.93% | 99.94% |
| L3 压缩比 | 150:1（N=1200 → r=8） | 150:1 |
| L5 重建误差 · 分布内 | 1.04% | 1.04%（一致） |
| L5 重建误差 · 分布外 | 52.79% | 52.50% |
| L5 重建误差 · 自适应后 | 3.25% | 2.90% |
| L4 边界动力学拟合误差 | 1.23e-8 | 6.87e-11 |
| L4 多步预测误差（H=6） | 7.33e-6 | 7.52e-11 |
| 控制分配方程解 | u1=0.933333 u2=0.266667 | 同（一致） |
| 灵数认证 | `certified=true` | 经子进程调用同一实现 |

---

## 五、诚实边界（请务必读）

这些是**真实的局限**，不是免责声明：

1. **MVP 仅启用热传导一个 PDE**。刚体 / 弹性 / 流体 / 声学 / 电磁是框架预置模型，尚未实现。
2. **当前是 2D + 时间，不是完整的 \(\mathcal{M}_{3,1}\)**。
3. **ROM 是近似，重建有误差**。分布外状态误差可达 **~50%**——这是降阶模型的真实泛化局限，不是 bug。
   本仓库提供**自适应重训练**（`maybeAdapt()`，对应框架 §3）来缓解，但无法根治。
4. **能量捕获率必须和谱形态一起看**。能量捕获率对数值噪声模态不敏感：一批高度相关的快照会让谱断崖（如 λ 从 1e2 跌到 1e-3），此后补进的模态是噪声却仍算"已捕获"，百分比逼近 100% 而真实表示能力很低。
   因此内核提供 `effective_rank()` / `cliff_index()` / `spectrum_ratios()`——**别只看百分比**。
5. **灵脑决策核是"对齐概念的最小真实现"**：实现了 `verifyLedger` 哈希链、`FIREWALL` 信任门、`fail-closed` 三条灵魂不变量，
   但**不是**完整灵脑内核（无八元组 BrainTuple、无 M1–M4 证明模块、JS 版哈希为 cyrb53 演示级）。
6. **灵数求解器（lingshu-solver）是 JS 实现，Python 侧无对应物**。
   本仓库不假装有——未配置时用 NumPy 求解并明确标注"非灵数区间认证解"。

### 已知的跨版本语义差异（未强行迁就）

Python 版 `HeatWorld.init()` 立即施加 Dirichlet 边界；JS 版 `init()` 不碰边界、要等第一次 `step()` 才设。
物理上 Python 版更正确（初始条件本身应满足边界条件）。代价是初始 `mean` 差 1e-4（0.10453 vs 0.10463），
一步之后两版完全一致（末态同为 0.10287）。该差异已在源码 docstring 中写明。

---

## 六、文件构成

| 文件 | 说明 |
| :--- | :--- |
| `lingjing_rom.py` | 五层核心数学（Python / NumPy 版，唯一第三方依赖 numpy） |
| `verify.py` | Python 验真：五层 + 篡改检测 + 规模扩展 |
| `rom.js` | 五层核心数学（JS 版，UMD） |
| `verify.js` | Node 验真 |
| `index.html` | 浏览器演示：真场 / 重建场 / 预演场三视图 + 五层状态 + 审计账本 |
| `lingnao-decision.js` | 灵脑风格可审计决策核（哈希链 + FIREWALL + fail-closed） |
| `lingshu-core.js` | 灵数求解器核心（源自 `genesis-plan/lingshu-solver`，同属版权方） |

---

## 七、许可

**本仓库尚未确定许可**——这是版权方的商业/法律决策。

在正式许可发布前：**默认保留所有权利**（all rights reserved），仅允许阅读与引用。

其中 `lingshu-core.js` 源自 `genesis-plan/lingshu-solver`，适用《灵数求解器商业授权许可协议》
（非商业免费，商业使用须版权方书面授权）。

---

## 八、路线（待版权方拍板）

- [ ] 扩展到三维 \(\mathcal{M}_{3,1}\)（当前 2D + 时间）
- [ ] 接入第二个 PDE 模型（弹性 / 流体），验证框架通用性
- [ ] 接入完整灵脑内核（八元组、M1–M4 证明模块、SHA-256+HMAC 单写者账本）
- [ ] 打包为可分发的 `lingjing-rom`（PyPI / npm）
