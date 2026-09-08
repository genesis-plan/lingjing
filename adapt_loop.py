"""
灵境 · 自适应闭环：观察→推测关系→建模→映射→总结规律→改律→直到不动点
============================================================================
把用户的完整构思落成一个可跑的最小闭环：

  观察真实世界(observe) → 从轨迹学出力律(learn) → 写入虚拟世界(model=map)
  → 验虚拟律是否=真实律(verify) → 若不等则改律(update) → 重复 → 不动点

数学本质：这是**模型空间里的不动点迭代** F: 模型 → 模型。
  - 当真实世界规律平稳且落在候选基(数学先验)内：迭代收缩到不动点
    （虚拟律=真实律 且 不再变化）。
  - 当真实世界非平稳（规律随时在变）：没有不动点，只能"跟踪"不能"收敛"。

诚实边界：
  - 不动点只在"真实平稳 + 假设类覆盖真实"时存在；否则是 tracking 不是 convergence。
  - "推测自己和真实世界的关系"=机器人的自模型(本体感知)，本演示未含，是独立难问题。
  - verify 用"虚拟律 vs 真实律在径向上的差异"作证伪指标（不依赖额外传感器）。
  - 学出的律只在训练区段可信（与 induce_law 同源限制）。

运行：python adapt_loop.py
"""
import numpy as np
from induce_law import simulate, learn_law, basis


def observe(truth, noise=1e-3, dt=0.01, steps=3000):
    """机器人观察真实世界：生成轨迹 + 叠加传感器噪声。"""
    pos, vel = simulate(truth, [10.0, 0.0], [0.0, 8.0], dt, steps, noise=noise)
    return pos, vel


def verify_residual(model, truth):
    """虚拟世界律 vs 真实世界律：在 r∈[5,15] 上比径向加速度，相对残差。"""
    rs = np.linspace(5, 15, 200)
    am = np.array([model @ basis(r) for r in rs])
    at = np.array([truth @ basis(r) for r in rs])
    return float(np.linalg.norm(am - at) / (np.linalg.norm(at) or 1))


def run(truth_fn, init, max_iter=30, tol=1e-3, eps=1e-4, label=''):
    """自适应闭环。truth_fn(iter) 返回本轮真实系数（可随时间变）。"""
    model = np.array(init, dtype=float)
    prev = model.copy()
    print(f'── {label} ──')
    for it in range(max_iter):
        truth = truth_fn(it) if callable(truth_fn) else np.array(truth_fn, dtype=float)
        pos, vel = observe(truth)                       # ① 观察
        c, _ = learn_law(pos, vel, 0.01)                # ② 推测关系 + 学律
        model = c                                       # ③ 映射进虚拟世界（改律）
        vr = verify_residual(model, truth)              # ④ 验：虚拟≈真实？
        dmodel = float(np.linalg.norm(model - prev))    # ⑤ 模型还变不变？
        prev = model.copy()
        print(f'  iter {it:2d}: 模型={np.array2string(model, precision=2)}'
              f'  虚实残差={vr * 100:.4f}%  Δ模型={dmodel:.3e}')
        if vr < tol and dmodel < eps:                   # ⑥ 不动点：匹配且不再变
            print(f'  ★ 不动点达成（iter {it}）：虚拟世界律 = 真实世界律，且不再变化\n')
            return model
    print(f'  ✗ 未达不动点：真实世界非平稳，每轮都变 → 只能跟踪，不能收敛\n')
    return model


print('=== 灵境 · 自适应闭环（观察→学律→映射→改律→不动点）===\n')

# 情形 A：真实世界平稳（反平方引力，GM 恒定）
run(lambda it: np.array([-1000.0, 0.0, 0.0, 0.0]),
    init=[0.0, 0.0, 0.0, 0.0], label='情形A 真实平稳（GM 恒定反平方）')

# 情形 B：真实世界非平稳（GM 每轮漂移 −20）
run(lambda it: np.array([-1000.0 - 20.0 * it, 0.0, 0.0, 0.0]),
    init=[0.0, 0.0, 0.0, 0.0], label='情形B 真实非平稳（GM 每轮漂移）')

print('结论：')
print('  A 收敛到不动点 ⇒ 虚拟世界最终等于真实世界，可作指导且稳定。')
print('  B 无不动点 ⇒ "直到不动点"是错觉；真实在变时就该改为"持续跟踪 + 告警"，而非宣称已收敛。')
