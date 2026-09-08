"""
灵境 · 真实世界条件体检（观测 ≠ 真值）— Python 轨
============================================================================
"一切以真实世界的情况为标准"的落地体检（与 verify_sensor.js 同构，量级对照；
本轨与 JS 轨各自种子噪声，故数字非逐位、趋势一致）。

真实世界的三个第一性事实：①只能观测、不能读真值；②欠采样；③速度不可直接
测、位置带噪。此前学习直接吃真值 (pos,vel)，真实世界里不可能。

流程：真实世界 RealWorld3D(真律 −1000/r²，椭圆) 出真值（仅裁判）→ 传感器
observe()：每 3 步采样 + 位置高斯噪声 σ → 机器人只拿带噪位置 → 两条管线：
  A 朴素差分：位置二阶中心差分估计加速度（原管线直接套真实数据的样子）
  B 平滑纪律：RTS 固定区间平滑（近恒加速度 σa=40，Joseph form，后向用预测态）
→ 学出的律当前 70% 观测、后 30% 滚动半圈预测 vs 新观测（含完美律误差底）。

诚实边界：训练残差在带噪下 ≠ 律质量（不能作判据）；预测校验分辨率受起点
状态估计限制（完美律也有底）；正圆轨道单一半径 → 基共线不可辨识。
运行：python verify_sensor.py
"""
import numpy as np
from lingjing_rom import RealWorld3D

DT = 0.01
STEPS = 6000
PERIOD = 3            # 观测采样间隔（世界步数）→ dt_obs = 0.03
H = PERIOD * DT
P0 = [10.0, 0.0, 0.0]
V0 = [0.0, 8.0, 0.0]
TRUTH = np.array([-1000.0, 0.0, 0.0, 0.0])
SIGMAS = [0.0, 0.02, 0.05, 0.1]
SA = 40.0
HOLD = 0.7


def basis(r):
    r = max(r, 1e-12)
    return np.array([1 / r**2, 1 / r, 1.0, 1 / r**3])


def world_traj(central):
    w = RealWorld3D(central_law=list(central), r_min=0.5)
    w.add_body(P0, V0, 1.0)
    P = np.zeros((STEPS + 1, 3))
    V = np.zeros((STEPS + 1, 3))
    P[0], V[0] = P0, V0
    for t in range(STEPS):
        w.step(DT)
        P[t + 1] = w.bodies[0]["pos"]
        V[t + 1] = w.bodies[0]["vel"]
    return P, V


def world_run(central, p0, v0, steps):
    w = RealWorld3D(central_law=list(central), r_min=0.5)
    w.add_body(list(p0), list(v0), 1.0)
    P = np.zeros((steps + 1, 3))
    P[0] = p0
    for t in range(steps):
        w.step(DT)
        P[t + 1] = w.bodies[0]["pos"]
    return P


def observe(Pt, sigma, seed=20260908):
    rng = np.random.default_rng(seed)
    idx = np.arange(0, len(Pt), PERIOD)
    obs = Pt[idx].copy()
    if sigma > 0:
        obs += rng.normal(0.0, sigma, obs.shape)
    return obs


def a_naive(pos, h=H):
    A = np.zeros_like(pos)
    A[1:-1] = (pos[2:] - 2 * pos[1:-1] + pos[:-2]) / h**2
    A[0] = A[1]
    A[-1] = A[-2]
    return A


def rts1(z, sigma_p, h=H, sa=SA):
    """1D RTS（近恒加速度）：滤波 Joseph form + 后向平滑（修正项用预测态）。"""
    M = len(z)
    F = np.array([[1, h, h**2 / 2], [0, 1, h], [0, 0, 1.0]])
    Q = sa * sa * np.array([[h**4 / 4, h**3 / 2, h**2 / 2],
                            [h**3 / 2, h**2, h], [h**2 / 2, h, 1.0]])
    R = sigma_p**2
    x = np.array([z[0], 0.0, 0.0])
    P = np.eye(3) * 1e6
    xf, x_pre, Pf, Pp = [], [], [], []
    for t in range(M):
        if t > 0:
            x = F @ x
            P = F @ P @ F.T + Q
        x_pre.append(x.copy())
        Pp.append(P.copy())
        S = P[0, 0] + R
        K = P[:, 0] / S                     # 标量观测增益（P 对称，取第一列）
        x = x + K * (z[t] - x[0])
        IKH = np.array([[1 - K[0], 0, 0], [-K[1], 1, 0], [-K[2], 0, 1.0]])
        P = IKH @ P @ IKH.T + R * np.outer(K, K)    # Joseph form
        xf.append(x.copy())
        Pf.append(P.copy())
    xs = [None] * M
    xs[M - 1] = xf[M - 1].copy()
    for t in range(M - 2, -1, -1):          # RTS 后向：A = P Fᵀ P₊⁻¹
        A = Pf[t] @ F.T @ np.linalg.inv(Pp[t + 1])
        xs[t] = xf[t] + A @ (xs[t + 1] - x_pre[t + 1])
    return np.array(xs), np.array(xf)


def fit_law(pos, a_est):
    """学律（输入即加速度估计序列）+ 归一化拟合残差；STLSQ 稀疏化。"""
    rs = np.maximum(np.linalg.norm(pos, axis=1), 1e-12)
    B = np.array([basis(r) for r in rs])
    ar = np.einsum('ij,ij->i', a_est, pos) / rs
    c = np.linalg.lstsq(B, ar, rcond=None)[0]
    for _ in range(10):
        mx = np.max(np.abs(c))
        active = np.abs(c) > 0.02 * mx
        if active.sum() <= 1:
            break
        ca = np.linalg.lstsq(B[:, active], ar, rcond=None)[0]
        cn = np.zeros_like(c)
        cn[active] = ca
        if np.allclose(c, cn, atol=1e-12):
            c = cn
            break
        c = cn
    pred = B @ c
    resid = float(np.linalg.norm(pred - ar) / (np.linalg.norm(ar) or 1))
    return c, resid


def gate_p50(law, obs, R, i_split, L, every=15):
    """滚动半圈预测：平滑起点状态外推 L 观测步，与陆续观测比，报中位分离 %。"""
    M = len(obs)
    sep = []
    for s in range(i_split, M - L, every):
        p0 = np.array([R[0][s][0], R[1][s][0], R[2][s][0]])
        v0 = np.array([R[0][s][1], R[1][s][1], R[2][s][1]])
        Pv = world_run(law, p0, v0, L * PERIOD)
        pv = Pv[L * PERIOD]
        po = obs[s + L]
        d = np.linalg.norm(pv - po)
        r = max(np.linalg.norm(po), 1e-12)
        sep.append(d / r * 100)
    sep.sort()
    return sep[len(sep) // 2]


def law_str(c, nd=1):
    return '[' + ', '.join(f'{x:.{nd}f}' for x in c) + ']'


def main():
    print('=== 灵境 · 真实世界条件体检（观测≠真值：欠采样+带噪+速度不可直接测）— Python 轨 ===')
    print('真实世界(truth): −1000/r²，椭圆 r∈[~5.9,~20]  观测: 每 3 步(≈33Hz) 只给位置')
    print('学律: 前 70% 观测  预测校验: 滚动半圈预测 vs 新观测  管线 A=朴素差分 B=RTS(σa=40)')
    print('（本轨与 JS 轨种子噪声独立，数字量级对照、趋势一致）\n')
    Pt, _ = world_traj(TRUTH)
    L_hor = int(round(0.5 * 3.96 / H))
    for sigma in SIGMAS:
        label = 'E0 无噪（欠采样本身的影响）' if sigma == 0 else \
            f'Sσ={sigma}（{sigma / 10 * 100:.1f}% 半径）'
        obs = observe(Pt, sigma)
        M = len(obs)
        i_s = int(HOLD * M)
        R = [rts1(obs[:, k], sigma if sigma > 0 else 1e-4)[0] for k in range(3)]
        posS = np.stack([R[0][:, 0], R[1][:, 0], R[2][:, 0]], axis=1)
        aS = np.stack([R[0][:, 2], R[1][:, 2], R[2][:, 2]], axis=1)
        cA, _ = fit_law(obs[:i_s + 1], a_naive(obs[:i_s + 1]))
        cB, _ = fit_law(posS[:i_s + 1], aS[:i_s + 1])
        gA = gate_p50(cA, obs, R, i_s, L_hor)
        gB = gate_p50(cB, obs, R, i_s, L_hor)
        gT = gate_p50(TRUTH, obs, R, i_s, L_hor)
        eA = abs(cA[0] + 1000) / 10
        eB = abs(cB[0] + 1000) / 10
        print(f'── {label} ──')
        print(f'  A 朴素差分 : μ={law_str(cA)}  c0误差 {eA:.2f}%  滚动半圈预测 p50={gA:.1f}%')
        print(f'  B RTS平滑  : μ={law_str(cB)}  c0误差 {eB:.2f}%  滚动半圈预测 p50={gB:.1f}%')
        print(f'  完美律(底) : (预测误差下限，由起点状态估计决定)       p50={gT:.1f}%\n')

    print('结论（与 JS 轨一致）：')
    print('  · 原学律管线（直接差分）在真实观测下失效（σ=0.02 已 ~10%+、σ=0.1 达 300%+）；')
    print('  · RTS 平滑纪律把学律质量推回无噪量级（σ=0.02→~0.1%、σ=0.1→~5%，量级上 60×+ 优于差分）；')
    print('  · 训练残差在带噪下 ≠ 律质量（好律残差也高）——不能作判据；')
    print('  · 预测校验是正判据但分辨率受起点状态估计限制（完美律也有底）→ 真实 Agent 用连续滚动')
    print('    监控 + 误差劣化 → δ 放大（v2 闭环），而非静态二元门控；')
    print('  · 正圆轨道单一半径 → 基完全共线不可辨识（勿学）。')


if __name__ == '__main__':
    main()
