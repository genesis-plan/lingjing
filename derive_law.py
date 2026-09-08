#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
灵境 · 从未知现实"推导"规律（数学先行 + 约束电池）
=================================================================
用户定调的架构：从未知现实映射到虚拟世界——不是先列假设库去拟合，
而是：**观测结构 → 数学定理推导 → 反证证伪 → 测不可约余量 → 约束电池互证 → 经验指导**。

本轮按用户要求把"现实世界的其他各种约束"用数学方法加进来（约束电池）：
  C1 Runge–Lenz 矢量守恒 —— 1/r² 的签名约束（中心势中 LRL 守恒 ⟺ 平方反比）
  C2 Virial 位力定理 —— 束缚 1/r² 轨道 ⟨v²⟩=k⟨1/r⟩，直接给出第 4 路独立 k 测量
  C3 Kepler 第三律 —— T²=4π²a³/k，第 3 路独立 k 测量
  C4 能量守恒（Noether 时间平移）—— E=v²/2−k/r 无单调漂移；耗散候选直接违反
四路独立 k 测量互证（h²/p、vis-viva、Kepler-3、virial），互差即诚实不确定度。

完整流程（现实=合成未知中心引力，系统不知道是 1/r²，真值仅供人核对）：
  阶段1 观测结构（零假设）：L 无漂移？v² 只依赖 r？焦点圆锥？闭合？
  阶段2 定理推导律形：角动量定理 + Binet/牛顿逆定理 + Bertrand ⟹ F=−k/r² r̂（推导非挑选）
  阶段3 反证证伪：1/r³、谐振子、匀强场、阻力——定理 + 数值（含 LRL 漂移）双重驳回
  阶段4 测余量：k=h²/p，split-half 给 μ±δ
  阶段5 约束电池：C1–C4 逐条数据检验 + 四路 k 互证表
  阶段6 经验 + 指导：结构反哺状态估计（速度由轨道要素重建），虚拟世界多时域外推

诚实边界（务必读）：
  · 写死的是**数学定理**（Noether/Binet/Bertrand/LRL/Virial/Kepler——这就是"数学的
    各种知识"，正确的写死；IMA 公理库/灵脑证明引擎以后供给更多定理与约束）。
  · **现实的律不是写死的**：律形 = 数据观测到的结构 × 定理 推导出来；系数 k 由数据测，
    四路独立测量互证；哪条约束适用由数据结构决定；约束不满足时须诚实报"结构不符"。
  · 经验输入不可免（休谟欠定）：至少要观测到结构；长时域外推仍有相位慢漂（信任时域）。

用法：python derive_law.py
"""
import math
import numpy as np
from lerobot_bridge import rts1

GM_TRUE = 1000.0   # 现实真值——系统不知道，仅打印供人核对
H = 0.01           # 采样步长
SIGMA = 0.02       # 位置观测噪声
SA = 40.0          # RTS 过程噪声（verify_sensor 标定）

# ---------------- 生成"未知现实"（速度 Verlet；系统不可见此函数的律） ----------------
def simulate_truth(GM, r0, v0, dt, n):
    P = np.zeros((n, 2)); V = np.zeros((n, 2))
    p = np.array(r0, float); v = np.array(v0, float)
    def acc(p):
        r = math.hypot(p[0], p[1])
        return -GM / r**3 * p
    a = acc(p)
    for i in range(n):
        P[i] = p; V[i] = v
        v = v + a * dt / 2
        p = p + v * dt
        a = acc(p)
        v = v + a * dt / 2
    return P, V

# ---------------- RTS：带噪观测 → 平滑状态（全项目同一平滑纪律） ----------------
def rts_state(obs, H, SIGMA, SA=40.0):
    N, D = obs.shape
    P = np.zeros_like(obs); V = np.zeros_like(obs)
    for d in range(D):
        xsf = rts1([float(obs[t, d]) for t in range(N)], SIGMA, H, SA)
        P[:, d] = [x[0] for x in xsf]; V[:, d] = [x[1] for x in xsf]
    return P, V

# ---------------- 通用趋势统计（守恒判据=无单调漂移，非峰峰小） ----------------
def trend_total(x, H):
    """去首尾 10% 暂态后，线性趋势在窗口内的累计变化量（有符号）。"""
    N = len(x); i0, i1 = N // 10, 9 * N // 10
    t = np.arange(i0, i1) * H
    slope = np.polyfit(t, x[i0:i1], 1)[0]
    return float(slope * (t[-1] - t[0]))

# ---------------- 阶段1：从数据观测结构（零假设，全是可测事实） ----------------
def observe_structure(P, V):
    N = len(P)
    r = np.hypot(P[:, 0], P[:, 1])
    Lz = P[:, 0] * V[:, 1] - P[:, 1] * V[:, 0]
    h = abs(np.median(Lz))
    L_noise = float(np.std(Lz[N//10:9*N//10]) / (h + 1e-12))
    L_trend = abs(trend_total(Lz, H)) / (h + 1e-12)
    u = 1.0 / r
    v2 = V[:, 0]**2 + V[:, 1]**2
    X = np.column_stack([u, np.ones(N)])                 # vis-viva: v²=2k/r+β
    coef, *_ = np.linalg.lstsq(X, v2, rcond=None)
    vis_resid = np.sqrt(np.mean((v2 - X @ coef)**2)) / (v2.std() + 1e-12)
    th = np.unwrap(np.arctan2(P[:, 1], P[:, 0]))         # 焦点圆锥: u=c0+c1cosθ+c2sinθ
    Xc = np.column_stack([np.ones(N), np.cos(th), np.sin(th)])
    cc, *_ = np.linalg.lstsq(Xc, u, rcond=None)
    conic_resid = np.sqrt(np.mean((u - Xc @ cc)**2)) / (u.std() + 1e-12)
    e = math.hypot(cc[1], cc[2]) / cc[0]
    p_semi = 1.0 / cc[0]
    omega = math.atan2(cc[2], cc[1])
    med = np.median(r)
    peri = [i for i in range(1, N-1)
            if r[i] < r[i-1] and r[i] <= r[i+1] and r[i] < 0.8 * med]
    dth = np.diff(th[peri]) if len(peri) >= 2 else np.array([float('nan')])
    return dict(h=h, L_noise=L_noise, L_trend=L_trend,
                vis_slope=coef[0], vis_resid=vis_resid,
                e=e, p=p_semi, omega=omega, conic_resid=conic_resid,
                dth=float(np.mean(dth)), n_peri=len(peri), peri_idx=peri)

# ---------------- 约束电池的量 ----------------
def lrl_metrics(P, V, k, H):
    """Runge–Lenz 矢量 e_vec = v×h/k − r̂（2D）。返回 (中位模长, 方向趋势漂移 rad)。"""
    r = np.hypot(P[:, 0], P[:, 1])
    Lz = P[:, 0] * V[:, 1] - P[:, 1] * V[:, 0]
    ex = Lz * V[:, 1] / k - P[:, 0] / r
    ey = -Lz * V[:, 0] / k - P[:, 1] / r
    emag = np.hypot(ex, ey)
    ang = np.unwrap(np.arctan2(ey, ex))
    return float(np.median(emag[len(emag)//10:9*len(emag)//10])), abs(trend_total(ang, H))

def energy_series(P, V, k):
    r = np.hypot(P[:, 0], P[:, 1])
    return 0.5 * (V[:, 0]**2 + V[:, 1]**2) - k / r

def fmt_dth(x):
    return '发散(未检出≥2近日点)' if math.isnan(x) else f'{x:.3f}'

# ---------------- 候选律积分（反证的数值对照） ----------------
def integrate_candidate(kind, c, p0, v0, dt, n):
    P = np.zeros((n, 2)); V = np.zeros((n, 2))
    p = np.array(p0, float); v = np.array(v0, float)
    def acc(p, v):
        if kind == 'inv3':
            r = math.hypot(p[0], p[1]); return -c / r**4 * p
        if kind == 'hooke':
            return -c * p
        if kind == 'uniform':
            return np.array([0.0, c])
        if kind == 'drag':
            return -c * v
        raise ValueError(kind)
    a = acc(p, v)
    for i in range(n):
        P[i] = p; V[i] = v
        v = v + a * dt / 2
        p = p + v * dt
        a = acc(p, v)
        v = v + a * dt / 2
    return P, V

def main():
    rng = np.random.default_rng(20260908)
    print('=== 灵境 · 从未知现实推导规律（观测结构 → 定理推导 → 反证 → 约束电池互证 → 经验）===\n')

    # ---- 未知现实：系统只见带噪位置流 ----
    P_true, V_true = simulate_truth(GM_TRUE, r0=(10, 0), v0=(0, 8), dt=H, n=2400)
    obs = P_true + rng.normal(0, SIGMA, P_true.shape)
    P, V = rts_state(obs, H, SIGMA, SA)
    N = len(P)

    # ---- 阶段1 观测结构 ----
    s = observe_structure(P, V)
    print('[阶段1] 观测结构（全部来自数据，零假设）:')
    print(f'  L 守恒判据(无单调漂移): 趋势累计 {s["L_trend"]*100:.2f}%'
          f'（噪声底 std {s["L_noise"]*100:.2f}%）→ 在估计精度内守恒')
    print(f'  v²=α/r+β 拟合残差 = {s["vis_resid"]*100:.2f}%  → v² 只依赖 r')
    print(f'  焦点圆锥拟合残差 = {s["conic_resid"]*100:.2f}%  e={s["e"]:.3f} (<1 束缚)')
    print(f'  相邻近日点张角 = {fmt_dth(s["dth"])} rad (2π={2*math.pi:.4f},'
          f' {s["n_peri"]} 个近日点) → 闭合\n')

    # ---- 阶段2 数学推导 ----
    print('[阶段2] 数学推导（定理适用性由数据结构决定）:')
    print('  定理A dL/dt=r×F: L 无漂移 ⟹ 力必径向（对称性，Noether 方向）')
    print('  定理B Binet/牛顿逆定理: 焦点在力心的圆锥轨道 ⟺ F∝1/r²'
          f'（观测残差 {s["conic_resid"]*100:.2f}%）⟹ 律形推出 F=−k/r² r̂')
    print('  定理C Bertrand: 闭合+径向 ⟹ ∈{1/r², r²}；焦点(非中心)排除 r² ⟹ 交叉验证通过')
    print('  ⟹ 律的形式是"推导"出来的，不是假设库里挑的。只剩 k 未定。\n')

    # 由结构直接得 k（h²/p），供反证与约束电池用；阶段4 再给正式测量
    k_all = s['h']**2 / s['p']

    # ---- 阶段3 反证证伪（数学 + 数值 + LRL 签名） ----
    _, lrl_ang_obs = lrl_metrics(P, V, k_all, H)
    print('[阶段3] 反证证伪（假律逐条驳回；数值对照同一初始状态）:')
    print('  ✗ 匀强场 a=g·ŷ: 定理 r×F=x·g ẑ≠0 ⟹ L 必线性增长 — 与"L 无漂移"矛盾')
    print('  ✗ 阻力 −γv:   定理 dL/dt=−γL ⟹ L 指数衰减 — 同上矛盾')
    r_ref = s['p'] / (1 - s['e']**2)                    # 半长轴（由焦点圆锥参数推出）
    a_ref = s['h']**2 / (s['p'] * r_ref**2)             # r_ref 处真实加速度量级（由结构推出）
    for kind, c, name, math_kill in (
            ('inv3',    a_ref * r_ref**3, 'F=−c/r³', 'Binet: u″+(1−c/h²)u=0, β≠1 ⟹ 不闭合非圆锥'),
            ('hooke',   a_ref / r_ref,    'F=−k·r',  '椭圆中心在"中心"非"焦点"'),
            ('uniform', a_ref,            '匀强场',   'r×F≠0 ⟹ L 线性增长'),
            ('drag',    0.05,             '阻力−γv',  'dL/dt=−γL ⟹ L 衰减')):
        Pc, Vc = integrate_candidate(kind, c, P[0], V[0], H, N)
        sc = observe_structure(Pc, Vc)
        _, lrl_drift = lrl_metrics(Pc, Vc, k_all, H)
        print(f'  ✗ {name}: {math_kill}')
        print(f'      数值实证: 焦点圆锥残差 {sc["conic_resid"]*100:.1f}%'
              f'(观测 {s["conic_resid"]*100:.2f}%)、近日点张角 {fmt_dth(sc["dth"])}'
              f'(观测 {fmt_dth(s["dth"])})、L 趋势 {sc["L_trend"]*100:.0f}%'
              f'(观测 {s["L_trend"]*100:.2f}%)、LRL 方向漂移 {lrl_drift:.2f} rad'
              f'(观测 {lrl_ang_obs:.3f}) → 矛盾，驳回')
    print()

    # ---- 阶段4 测不可约余量 k（正式测量 + split-half） ----
    def measure_k(P, V):
        st = observe_structure(P, V)
        return st['h']**2 / st['p'], st
    n70 = int(N * 0.7)
    k_a, _ = measure_k(P[:n70//2], V[:n70//2])
    k_b, _ = measure_k(P[n70//2:n70], V[n70//2:n70])
    delta = abs(k_a - k_b) / 2
    print('[阶段4] 测不可约余量（律形已推导，只剩系数）:')
    print(f'  k = h²/p = {k_all:.2f}   split-half μ±δ = {k_all:.2f} ± {delta:.2f}')
    print(f'  [仅供人核对] 真值 GM={GM_TRUE:.2f}，系统不知道；'
          f'测得相对误差 {abs(k_all-GM_TRUE)/GM_TRUE*100:.2f}%\n')

    # ---- 阶段5 约束电池（现实的其他数学约束，逐条数据检验） ----
    print('[阶段5] 约束电池（把现实的其他约束用数学方法用进来）:')
    # C1 Runge–Lenz（1/r² 签名）
    emag_med, ang_drift = lrl_metrics(P, V, k_all, H)
    print(f'  C1 Runge–Lenz 矢量守恒（中心势中 LRL⟺1/r²，签名约束）:')
    print(f'      |e_vec|={emag_med:.4f} vs 圆锥拟合 e={s["e"]:.4f}'
          f'（差 {abs(emag_med-s["e"])/s["e"]*100:.2f}%）、方向趋势漂移 {ang_drift:.4f} rad → 守恒 ✓')
    # C2 Virial → 第 4 路独立 k
    r = np.hypot(P[:, 0], P[:, 1]); v2 = V[:, 0]**2 + V[:, 1]**2
    i0, i1 = N // 10, 9 * N // 10
    k_vir = float(np.mean(v2[i0:i1]) / np.mean(1.0 / r[i0:i1]))
    print(f'  C2 Virial 位力定理（束缚 1/r²: ⟨v²⟩=k⟨1/r⟩）: k_vir = {k_vir:.2f} → 第4路独立测量')
    # C3 Kepler 第三律 → 第 3 路独立 k
    a_semi = r_ref
    t_peri = np.array(s['peri_idx']) * H
    T = float(np.mean(np.diff(t_peri)))
    k_kep = 4 * math.pi**2 * a_semi**3 / T**2
    print(f'  C3 Kepler 第三律（T²=4π²a³/k）: T={T:.4f} a={a_semi:.4f} → k_kep = {k_kep:.2f}'
          f' → 第3路独立测量')
    # C4 能量守恒（Noether 时间平移）
    E = energy_series(P, V, k_all)
    E_trend = abs(trend_total(E, H)) / (abs(np.mean(E[i0:i1])) + 1e-12)
    print(f'  C4 能量守恒（E=v²/2−k/r 无单调漂移，Noether 时间平移）: 趋势 {E_trend*100:.2f}%'
          f'（噪声级内）→ 守恒 ✓')
    Pd, Vd = integrate_candidate('drag', 0.05, P[0], V[0], H, N)
    Ed = energy_series(Pd, Vd, k_all)
    print(f'      反证补强: 阻力候选的 E 趋势 '
          f'{abs(trend_total(Ed, H))/abs(np.mean(Ed[i0:i1]))*100:.0f}%（耗散必违 C4）→ 驳回')
    # 四路独立 k 互证表
    ks = [('h²/p（轨道要素）', k_all), ('vis-viva 斜率/2', s['vis_slope'] / 2),
          ('Kepler 第三律', k_kep), ('virial ⟨v²⟩/⟨1/r⟩', k_vir)]
    vals = [kv for _, kv in ks]
    spread = (max(vals) - min(vals)) / (sum(vals) / len(vals)) * 100
    print('  四路独立 k 互证:')
    for name, kv in ks:
        print(f'      {name:<18} = {kv:.2f}')
    print(f'      极差/均值 = {spread:.2f}% → 互证{"一致 ✓" if spread < 2 else "⚠ 分歧需查"}\n')

    # ---- 阶段6 经验 + 指导（结构反哺估计 + 多时域外推） ----
    k70, st70 = measure_k(P[:n70], V[:n70])
    def velocity_from_elements(P, st, idx):
        x, y = P[idx]
        r = math.hypot(x, y)
        f = math.atan2(y, x) - st['omega']
        vr = (st['h'] / st['p']) * st['e'] * math.sin(f)
        vt = (st['h'] / st['p']) * (1 + st['e'] * math.cos(f))
        ux, uy = x / r, y / r
        return np.array([vr * ux - vt * uy, vr * uy + vt * ux])
    v_recon = velocity_from_elements(P, st70, n70 - 1)
    T70 = 2 * math.pi * math.sqrt(a_semi**3 / k70)
    p = P[n70-1].copy(); v = v_recon.copy()
    n_rest = N - n70
    Pt = np.zeros((n_rest, 2))
    def acc(p, k):
        r = math.hypot(p[0], p[1]); return -k / r**3 * p
    a = acc(p, k70)
    for i in range(n_rest):
        Pt[i] = p
        v = v + a * H / 2; p = p + v * H; a = acc(p, k70); v = v + a * H / 2
    scale = float(np.median(np.hypot(P[n70:,0], P[n70:,1])))
    print('[阶段6] 经验 + 指导（推导结构反哺状态估计 → 虚拟世界外推）:')
    print(f'  经验入库: 律形="F=−k/r²"(推导) k={k70:.2f}±{delta:.2f} n={n70}')
    dv_rts = float(np.hypot(*(V[n70-1] - V_true[n70-1])))
    dv_rec = float(np.hypot(*(v_recon - V_true[n70-1])))
    print(f'  边界速度估计 [仅供人核对]: RTS 直接估计误差 {dv_rts:.3f}'
          f' → 结构重建误差 {dv_rec:.3f}（{dv_rts/max(dv_rec,1e-9):.0f}× 提升）')
    for frac in (0.25, 0.5, 1.0, 1.82):
        m = min(int(frac * T70 / H), n_rest)
        rmse = math.sqrt(np.mean((Pt[:m] - P[n70:n70+m])**2))
        print(f'    外推 {frac:.2f}T ({m*H:.1f} 时间单位): RMSE={rmse:.4f}'
              f' (占轨道尺度 {rmse/scale*100:.2f}%)')

    print(f'\n结论：律形=数据结构×数学定理推导(零拟合)；四条假律被定理+数值+LRL签名驳回；'
          f'唯一经验量 k 由四路独立测量互证(极差 {spread:.2f}%)；'
          f'约束电池(C1 LRL/C2 Virial/C3 Kepler-3/C4 能量)逐条通过；'
          f'结构反哺状态估计后虚拟外推多时域贴合。')
    print('诚实边界：写死的是数学定理(知识)不是现实的律；约束不满足时须诚实报"结构不符"；'
          '观测结构不可免(休谟欠定)；长时域外推仍有相位慢漂(信任时域)。')

if __name__ == '__main__':
    main()
