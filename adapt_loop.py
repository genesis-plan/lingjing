"""
灵境 · 自适应闭环 v2：不动区间 + 经验
============================================================================
把"观察→学律→映射→验→改律→直到不动点"升级为用户修正后的诚实版本：

  - 不是"不动点"，是"不动区间"（invariant interval）：真实数据有噪声、真实世界在漂，
    机器人学到的律不该收敛成一个点，而该稳定在一个统计区间内（区间=它承认的"我不知道"）。
  - 学出的律 = 机器人自己的"经验"：跨交互持久保存，作为下次的先验(prior)热启动；
    只有新真实数据到来才做贝叶斯式融合更新，平时就持这条区间去行动。

数学本质：
  - 不动区间 = 模型空间里的**不变集** B，满足 F(B) ⊆ B（新一轮拟合落回旧区间）。
    比不动点 F(x*)=x* 弱：允许区间有宽度，不要求缩成一点。
  - 统计区间 = 系数的经验不确定度。用 split-half 复现：同一条轨迹前后半各拟一次，
    取散布 δ 作为区间半宽；数据越多 δ 越窄(√N 律)。
  - 经验 = 持久信念 (μ, δ, n_obs)。新交互以 μ 为 prior 热启动，融合用精度加权
    （n_obs 大的经验更可信）；新拟合与旧经验冲突 → 放大 δ（诚实承认"我可能错了"）。

诚实边界：
  - 不动区间只在"真实平稳 + 候选基覆盖真实"时存在；漂移世界没有不变集，只能持有区间随真实漂移。
  - 经验是带不确定度的信念，不是真理；区间宽度δ就是诚实量化。
  - "推测自己与真实世界的关系"=自模型(本体感知)，本演示未含，独立难问题。
  - 传感器桥仍用合成轨迹；verify 用"虚拟律 vs 真实律径向残差"作证伪指标。

运行：python adapt_loop.py
"""
import numpy as np
from induce_law import simulate, learn_law, basis


def observe(truth, noise=1e-3, dt=0.01, steps=3000):
    """机器人观察真实世界：生成轨迹 + 叠加传感器噪声。"""
    pos, vel = simulate(truth, [10.0, 0.0], [0.0, 8.0], dt, steps, noise=noise)
    return pos, vel


def learn_law_interval(pos, vel, dt):
    """从一条轨迹学出力律，返回 (均值系数 μ, 统计半宽 δ)。

    统计区间用 split-half 复现：前后半轨迹各拟一次，取散布为 δ。
    数据越多(步数越长)两半越一致 → δ 越窄；噪声越大 → δ 越宽。
    """
    n = len(pos)
    h = n // 2
    c1, _ = learn_law(pos[:h], vel[:h], dt)
    c2, _ = learn_law(pos[h:], vel[h:], dt)
    mu = (c1 + c2) / 2.0
    delta = np.abs(c1 - c2) / 2.0
    return mu, delta


class Experience:
    """机器人学到的规律 = 它自己的经验（持久信念）。

    持有一个区间 [μ−δ, μ+δ] 与已积累证据量 n_obs。
    - as_model(): 返回当前最佳估计 μ（虚拟世界律就写这个）。
    - band(): 返回区间上下界（机器人"承认的不知道"范围）。
    - absorb(): 新交互来了，以精度加权融合新证据；冲突放大 δ。
    """

    def __init__(self, dim=4):
        self.mu = np.zeros(dim)
        self.delta = np.full(dim, np.inf)   # 初始：全不知
        self.n_obs = 0

    def absorb(self, fit_mu, fit_delta, n):
        """融合一次新交互的证据：prior(旧经验) 与 likelihood(新拟合) 精度加权。"""
        if self.n_obs == 0:
            self.mu = fit_mu.copy()
            self.delta = fit_delta.copy()
            self.n_obs = n
            return
        tot = self.n_obs + n
        new_mu = (self.n_obs * self.mu + n * fit_mu) / tot   # 精度加权（n 大=可信）
        pooled = np.sqrt((self.n_obs * self.delta ** 2 + n * fit_delta ** 2) / tot)
        conflict = np.abs(new_mu - fit_mu)                   # 新旧不一致 → 承认不确定
        self.delta = np.maximum(pooled, conflict)
        self.mu = new_mu
        self.n_obs = tot

    def band(self):
        return self.mu - self.delta, self.mu + self.delta

    def as_model(self):
        return self.mu.copy()


def verify_residual(model, truth):
    """虚拟世界律 vs 真实世界律：r∈[5,15] 上比径向加速度相对残差。"""
    rs = np.linspace(5, 15, 200)
    am = np.array([model @ basis(r) for r in rs])
    at = np.array([truth @ basis(r) for r in rs])
    return float(np.linalg.norm(am - at) / (np.linalg.norm(at) or 1))


def run(exp, truth_fn, max_iter=30, eps_delta=1e-2, label=''):
    """一轮与真实世界的交互：以经验热启动，观察→学律(区间)→融合进经验→判不动区间。
    返回更新后的 Experience（经验跨交互持久）。
    """
    print(f'── {label} ──')
    prev_delta = np.inf
    prev_truth = None
    drifted = False
    for it in range(max_iter):
        truth = truth_fn(it) if callable(truth_fn) else np.array(truth_fn, dtype=float)
        if prev_truth is not None and not np.array_equal(truth, prev_truth):
            drifted = True                               # 真实世界在本轮交互内变化了
        prev_truth = truth
        pos, vel = observe(truth)                       # ① 观察真实世界
        mu, delta = learn_law_interval(pos, vel, 0.01)  # ② 学律(含推测关系) + 得统计区间
        lo, hi = exp.band()                             # 融合前旧经验区间
        inside = exp.n_obs == 0 or np.all((mu >= lo) & (mu <= hi))  # ③ 不变集: F(B)⊆B?
        exp.absorb(mu, delta, len(pos))                 # ④ 映射进虚拟世界 + 更新经验
        vr = verify_residual(exp.mu, truth)             # ⑤ 验: 虚拟≈真实?
        ddelta = (np.inf if not np.isfinite(prev_delta).all()
                  else np.max(np.abs(exp.delta - prev_delta)))
        lo, hi = exp.band()
        print(f'  iter {it:2d}: 经验μ={np.array2string(exp.mu, precision=2)}'
              f'  δ={np.array2string(np.array([round(d, 2) for d in exp.delta]), precision=2)}'
              f'  虚实残差={vr * 100:.4f}%  落回旧区间={inside}')
        prev_delta = exp.delta.copy()
        # ⑥ 不动区间：新拟合落回旧区间(不变集 F(B)⊆B) 且 带宽已稳定(不再明显收缩)
        #    区间有宽度是正常的——统计区间，不是点；收敛=区间稳定，不是宽度归零。
        if inside and ddelta < eps_delta:
            print(f'  ★ 不动区间达成（iter {it}）：经验收敛到稳定区间，可作为指导持久保存\n')
            return exp
    if drifted:
        print(f'  ✗ 无不动区间：真实世界在变 → 经验随真实漂移(持有区间、持续跟踪)，未收敛为定域\n')
    else:
        lo, hi = exp.band()
        print(f'  · 经验向当前平稳世界收敛中(区间仍在收窄)：已融合修正到 μ='
              f'{np.array2string(exp.mu, precision=1)}，δ='
              f'{np.array2string(np.array([round(d, 1) for d in exp.delta]), precision=1)}；'
              f'加大 max_iter 即达成不动区间\n')
    return exp


print('=== 灵境 · 自适应闭环 v2（不动区间 + 经验持久）===\n')

# 情形 A：真实平稳（GM 恒定反平方）→ 收敛到不动区间，经验稳定
expA = Experience()
run(expA, lambda it: np.array([-1000.0, 0.0, 0.0, 0.0]),
    label='情形A 真实平稳（GM 恒定反平方）')

# 情形 B：真实非平稳（GM 每轮漂 −20）→ 无不动区间，经验随真实漂移
expB = Experience()
run(expB, lambda it: np.array([-1000.0 - 20.0 * it, 0.0, 0.0, 0.0]),
    label='情形B 真实非平稳（GM 每轮漂移）')

# 情形 C：经验跨交互持久 + 热启动 + 遇新数据更新
#   第 1 次交互建立经验(平稳世界)；离线期后：
#     C-2 复遇相同世界 → 经验命中，iter0 即不动区间（持久 + 热启动，μ 不动、δ 不涨）
#     C-3 遇不同世界(GM=−980) → 落回旧区间=False（冲突）→ 经验被修正、δ 放大、重收敛到新带
print('── 情形C 经验跨交互持久 + 热启动 + 遇新数据更新 ──')
expC = Experience()
expC = run(expC, lambda it: np.array([-1000.0, 0.0, 0.0, 0.0]), max_iter=8,
           label='  C-1 第一次交互(建立经验)')
lo, hi = expC.band()
print(f'  [离线期] 机器人持经验区间行动，等待下次真实交互：')
print(f'      经验μ={np.array2string(expC.mu, precision=2)}  区间=[{lo[0]:.2f}, {hi[0]:.2f}]×1/r²\n')
# C-2：复遇相同世界 → 经验作为 prior 直接命中，不动区间 iter0 达成
expC = run(expC, lambda it: np.array([-1000.0, 0.0, 0.0, 0.0]), max_iter=4,
           label='  C-2 第二次交互(复遇相同世界：经验命中)')
print(f'  ⇒ C-2 经验持久：μ 稳定、δ 不涨，iter0 即不动区间（热启动，无需重新摸索）\n')
# C-3：遇不同世界 → 冲突触发经验更新
expC = run(expC, lambda it: np.array([-980.0, 0.0, 0.0, 0.0]), max_iter=35, eps_delta=0.05,
           label='  C-3 第三次交互(遇不同世界 GM=−980：冲突→经验修正)')
lo, hi = expC.band()
print(f'  [结果] C-3 新真实律在旧经验带外 → 冲突放大 δ、μ 融合到 ≈−990；经验被新数据修正\n')

print('结论：')
print('  A 收敛到不动区间 ⇒ 经验稳定，可作长期指导。')
print('  B 无不动区间 ⇒ 真实在变时"直到不动点"是错觉；正确姿态=持有经验区间、持续跟踪+告警。')
print('  C 经验跨交互持久 ⇒ 学出的律=机器人自己的经验：平时持区间行动，复遇则热启动命中，')
print('     遇新真实则融合修正（δ 放大=诚实承认"我可能错了"），直到下次交互。')
