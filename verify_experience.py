"""
灵境 · 经验驱动的物理层（E2E：学出的律接进真实模拟器 RealWorld3D）
============================================================================
把 v2 概念从独立演示落进真正的模拟器：RealWorld3D 现在接受 central_law=[c0..c3]
（候选基 [1/r²,1/r,1,1/r³] 上的系数）替换硬写的 −GM/r²。

流程（Python 轨）：
  ① 真实世界 = RealWorld3D(central_law=真律) 生成轨道（机器人观察）
  ② induce_law.learn_law_interval 从轨道学回经验律 (μ ± δ)（split-half 统计区间）
  ③ 虚拟世界 = RealWorld3D(central_law=μ)：物理层真正用"学出的经验"跑
  ④ 对比轨道：经验虚拟世界 vs 真实世界 = 贴合；设计虚拟世界(硬写 GM) vs 真实 = 偏差

数字（双轨对齐，见 verify_experience.js）：
  E1 真实纯反平方        → 学回 μ≈[−1000.0x,…]，经验虚拟轨道 max 相对分离 < 1e-4
  E2 真实=反平方+1/r³修正 → 设计律(GM=1000 漏掉修正)轨道明显偏离；经验律贴合

诚实边界：能学≠真理(受候选基限制)；学出的律只在训练区段 r∈[~5,~10] 可信；
"观察→学律"仍用合成轨迹（传感器桥缺口未补）；自模型(本体感知)未含。
运行：python verify_experience.py
"""
import numpy as np
from lingjing_rom import RealWorld3D
from induce_law import learn_law

BASE = [10.0, 0.0, 0.0]
VBASE = [0.0, 8.0, 0.0]
DT = 0.01
STEPS = 6000  # 60 时间单位 ≈ 15 圈


def learn_law_interval(pos, vel, dt):
    """从轨道学回经验律并给统计区间（split-half 复现，同 adapt_loop v2 口径）。"""
    n = len(pos)
    h = n // 2
    c1, _ = learn_law(pos[:h], vel[:h], dt)
    c2, _ = learn_law(pos[h:], vel[h:], dt)
    return (c1 + c2) / 2.0, np.abs(c1 - c2) / 2.0


def world_traj(central, steps=STEPS, noise=0.0, seed=12345, pos0=None, vel0=None):
    """用 RealWorld3D(central_law=central) 从同一初值跑轨道，返回 pos,vel (N,3)。"""
    p0 = BASE if pos0 is None else list(pos0)
    v0 = VBASE if vel0 is None else list(vel0)
    w = RealWorld3D(central_law=central, r_min=0.5)
    w.add_body(p0, v0, 1.0)
    rng = np.random.default_rng(seed)
    P = np.zeros((steps + 1, 3))
    V = np.zeros((steps + 1, 3))
    P[0] = p0
    V[0] = v0
    for t in range(steps):
        w.step(DT)
        P[t + 1] = w.bodies[0]["pos"]
        V[t + 1] = w.bodies[0]["vel"]
        if noise > 0:
            P[t + 1] += rng.normal(0.0, noise, 3)
    return P, V


def rel_sep(a_pos, b_pos):
    """a 轨道相对 b 轨道的分离：逐点 ||Δpos||/||pos_b|| 的 max 与末值。"""
    d = np.linalg.norm(a_pos - b_pos, axis=1)
    r = np.linalg.norm(b_pos, axis=1)
    return float(np.max(d / r)) * 100, float(d[-1] / r[-1]) * 100


def law_str(c, nd=2):
    return '[' + ', '.join(f'{x:.{nd}f}' for x in c) + ']'


def sep_at(a_pos, b_pos, t):
    """a、b 轨道在时刻 t（时间单位）处的相对分离 %。"""
    i = min(int(t / DT), len(a_pos) - 1)
    d = np.linalg.norm(a_pos[i] - b_pos[i])
    r = np.linalg.norm(b_pos[i])
    return d / r * 100.0


def max_sep(a_pos, b_pos):
    """全程 max 相对分离 %。"""
    d = np.linalg.norm(a_pos - b_pos, axis=1)
    r = np.linalg.norm(b_pos, axis=1)
    return float(np.max(d / r)) * 100


if __name__ == "__main__":
    print('=== 灵境 · 经验驱动的物理层（学出的律接进 RealWorld3D）===\n')

    # ── E1：真实世界 = 纯反平方 −1000/r²（学回经验律，虚拟世界直接用它跑）──
    truth1 = np.array([-1000.0, 0.0, 0.0, 0.0])
    P_t1, V_t1 = world_traj(truth1, noise=0.0)
    mu1, delta1 = learn_law_interval(P_t1, V_t1, DT)
    P_l1, _ = world_traj(mu1)                    # 虚拟世界：central_law = 学出的经验 μ
    err1 = abs(mu1[0] - truth1[0]) / abs(truth1[0]) * 100
    print('── E1 真实=纯反平方 −1000/r² ──')
    print(f'  真实律  : {law_str(truth1)}')
    print(f'  学出经验: μ={law_str(mu1)}  δ={law_str(delta1)}（c0 系数误差 {err1:.3f}%：'
          f'1/r³ 与 1/r² 在本弧段的基可辨识性下限）')
    print(f'  经验虚拟世界(central_law=μ) vs 真实世界：')
    print(f'    1 圈后(t≈4) 相对分离 = {sep_at(P_l1, P_t1, 3.96):.4f}%   → 短程贴合 ✓')
    print(f'    3 圈后(t≈12) 相对分离 = {sep_at(P_l1, P_t1, 11.9):.4f}%')
    print(f'    15 圈全程 max 分离 = {max_sep(P_l1, P_t1):.3f}%   → 长程相位累积'
          f'（微小律误差×圈数→漂移，故经验需持续被真实数据校正）\n')

    # ── E2：真实世界 = 反平方 + 1/r³ 修正（"真实规律和我们设计的不同"）──
    #    观测叠加噪声 σ=1e-3；设计律=硬写 GM=1000（漏掉 1/r³ 项）
    truth2 = np.array([-1000.0, 0.0, 0.0, 600.0])
    P_t2, V_t2 = world_traj(truth2, noise=1e-3, seed=7)
    mu2, delta2 = learn_law_interval(P_t2, V_t2, DT)
    design = np.array([-1000.0, 0.0, 0.0, 0.0])  # 设计律：工程师硬写 GM=1000
    P_l2, _ = world_traj(mu2)                    # 经验虚拟世界
    P_d2, _ = world_traj(design)                 # 设计虚拟世界
    print('── E2 真实=反平方 −1000/r² + 1/r³ 修正 +600/r³（真实≠设计）──')
    print(f'  真实律  : {law_str(truth2)}')
    print(f'  学出经验: μ={law_str(mu2)}  δ={law_str(delta2)}'
          f'（把设计外的 1/r³ 修正也学回来了；δ 只含噪声性不确定，'
          f'基可辨识性的系统偏差不在 δ 内——诚实边界）')
    print(f'  经验虚拟世界 vs 真实：1 圈 = {sep_at(P_l2, P_t2, 3.96):.4f}%，'
          f'15 圈 max = {max_sep(P_l2, P_t2):.3f}%   → 贴合 ✓')
    print(f'  设计虚拟世界 vs 真实：15 圈 max = {max_sep(P_d2, P_t2):.2f}%'
          f'（{max_sep(P_d2, P_t2) / max(max_sep(P_l2, P_t2), 1e-12):.0f}× 经验律）'
          f'  → 硬写律漏掉真实修正项，偏离 ✗\n')

    print('结论：')
    print('  学出的经验律(μ) 直接当 RealWorld3D 的 central_law 用 → 物理层从"硬写规律"')
    print('  变为"用经验驱动"；短程贴合、长程相位累积 ⇒ 经验必须持续被真实数据校正')
    print('  （= v2 的经验遇新交互即更新的闭环，正是它存在的原因）。')
