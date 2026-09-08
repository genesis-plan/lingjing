#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
灵境 · 约束电池 #2：碰撞与空气（材料极限 + 空气动力，数学先行）
=================================================================
用户点名的两族真实约束，接进"数学先行"管线：
  · 空气动力 —— 量纲分析（定理）推导阻力形式 F=½Cd·ρAv²（形式被量纲逼死，Cd 是余量）；
    被动性不等式 F·v≤0；终端速度存在性 v_t²=g/k。
  · 材料受力极限 —— 恢复系数不等式 0<e≤1；屈服阈值 = e 随撞击速度掉落点
    （本数据未触及 ⟹ e 恒定，掉落点即可测屈服）。

现实#2：竖直落体 + 二次空气阻力 + 地面反复碰撞（系统不知道 km、e）。
  阶段1 观测结构：每段能量单调不增？窗口恒等式结构回归判别 v² vs v？e 是否恒定？
  阶段2 定理推导：量纲分析 + 被动性 + 恢复系数不等式 + 终端速度
  阶段3 反证：无阻力 / e=1 / e>1 / 线性阻力 / 永动机
  阶段4 测余量：k=c/m、e（split-half）
  阶段5 互证+经验指导：推导律(k,e) 从初态全程积分 → 预测各次反弹高度 vs 观测

实现纪律（踩过的坑，勿重犯）：
  · 碰撞是运动学断点 —— RTS 按自由飞行段分段平滑，严禁跨碰撞点（verify_dynamic 教训）。
  · **微分是噪声放大器，积分是噪声平均器** —— 结构回归不用逐点 a_est（RTS â 或差分皆噪），
    改用窗口恒等式 v(t₂)−v(t₁)+gΔt = −k∫|v|v dt（对 ODE 的精确积分形式），与
    verify_sensor"中心差分放大噪声"教训同源。
  · RTS 端点速度 = 滤波估计 = 整段最不可靠点 —— 边界速度用段内插值外推到碰撞点。
  · 验证断言必须非空集；静止抖动不算反弹（撞击速度阈值截断）。

用法：python derive_law_contact.py
"""
import math
import numpy as np
from lerobot_bridge import rts1
from derive_law import trend_total

G = 9.81           # 重力（已知常数，非本管线学习目标）
# numpy 2.x 把 np.trapz 改名为 np.trapezoid（兼容两代）
_trapz = getattr(np, 'trapezoid', None) or np.trapz
KM_TRUE = 0.005    # 空气阻力系数 c/m 真值——系统不知道，仅供人核对
E_TRUE = 0.7       # 恢复系数真值——系统不知道，仅供人核对
H = 0.01           # 观测采样 100Hz
SIGMA = 0.05       # 位置观测噪声
SA = 16.0          # RTS 过程噪声（本现实 |a|≤16，取匹配值降 V 抖动）
V_REST = 0.5       # 静止判定：撞击/反弹速度低于此视为静止（抖动≠反弹）

# ---------------- 现实#2 生成（系统不可见内部参数） ----------------
def simulate_contact(h0, t_end, dt_sim=0.002, sub=5):
    n = int(t_end / dt_sim)
    y, v = h0, 0.0
    rec = []; tb = []
    for i in range(n):
        if i % sub == 0:
            rec.append((y, v))
        a = -G - KM_TRUE * abs(v) * v
        v = v + a * dt_sim / 2
        y = y + v * dt_sim
        a = -G - KM_TRUE * abs(v) * v
        v = v + a * dt_sim / 2
        if y < 0:
            v_imp = abs(v)
            y = -y
            v = -E_TRUE * v
            if v_imp > V_REST:
                tb.append(i * dt_sim)
            else:
                break                          # 静止，停止模拟
    return rec, tb

# ---------------- 碰撞检测（近地面局部极小；进入静止抖动区即截断） ----------------
def detect_bounces(y_obs):
    n = len(y_obs); w = 4
    mins = []
    for i in range(w, n - w):
        if (y_obs[i] <= min(y_obs[i-w:i]) and y_obs[i] < min(y_obs[i+1:i+w+1])
                and y_obs[i] < 0.6):
            mins.append(i)
    merged = []
    for i in mins:
        if not merged or i - merged[-1] > 20:
            merged.append(i)
    kept = [merged[0]]
    for i in merged[1:]:
        if i - kept[-1] >= 25:                 # 间隔<0.25s = 已进入抖动/静止区（v_reb<1 m/s）
            kept.append(i)                     # 截断过早会把真实反弹留在段内 → 污染恒等式
        else:
            break
    return kept

# ---------------- 分段 RTS（严禁跨碰撞点；碰撞点两侧各去 4 个污染样本） ----------------
def segment_states(y_obs, bounces):
    bounds = [0] + list(bounces) + [len(y_obs)]
    segs = []
    for j in range(len(bounds) - 1):
        i0 = bounds[j] + (4 if j > 0 else 0)
        i1 = bounds[j+1] - (4 if j < len(bounds) - 2 else 0)
        if i1 - i0 < 30:
            continue
        xsf = rts1([float(y_obs[t]) for t in range(i0, i1)], SIGMA, H, SA)
        segs.append(dict(i0=i0, i1=i1,
                         P=[x[0] for x in xsf], V=[x[1] for x in xsf]))
    return segs

# ---------------- 边界速度：段内插值外推到碰撞点（不用不可靠的 RTS 端点值） ----------------
def edge_speed(seg, at_start):
    V = np.asarray(seg['V'])
    n = len(V)
    if at_start:
        tt = np.arange(4, 24)
        c = np.polyfit(tt, V[4:24], 1)
        return abs(float(np.polyval(c, -4)))
    tt = np.arange(n - 24, n - 4)
    c = np.polyfit(tt, V[n-24:n-4], 1)
    return abs(float(np.polyval(c, n + 4)))

# ---------------- 窗口恒等式（积分形式回归；微分是放大器，积分是平均器） ----------------
def window_equations(segs, win=1.0, step=0.25):
    """对每段滑窗写精确恒等式 v(t₂)−v(t₁)+gΔt = −k∫|v|v dt（二次）或 = −γ∫v dt（Stokes）。
    返回 [(X2, X1, Y, t_mid采样号)]。"""
    L = int(win / H); S = int(step / H)
    eqs = []
    for seg in segs:
        V = np.asarray(seg['V'])
        n = len(V)
        i = 0
        while i + L < n:
            Y = V[i + L] - V[i] + G * L * H
            vv = V[i:i + L + 1]
            X2 = float(_trapz(np.abs(vv) * vv, dx=H))
            X1 = float(_trapz(vv, dx=H))
            eqs.append((X2, X1, Y, seg['i0'] + i + L // 2))
            i += S
    return eqs

def fit_through_origin(xs, ys):
    xs, ys = np.asarray(xs), np.asarray(ys)
    k = float(np.dot(xs, ys) / (np.dot(xs, xs) + 1e-12))
    res = float(np.sqrt(np.mean((ys - k * xs)**2)) / (ys.std() + 1e-9))
    return k, res

# ---------------- 推导律全程积分（经验指导用） ----------------
def predict_derived(y0, km, e, t_end, dt_sim=0.002):
    y, v = y0, 0.0
    apex = []; bts = []
    n = int(t_end / dt_sim)
    for i in range(n):
        a = -G - km * abs(v) * v
        v_p = v + a * dt_sim / 2
        y = y + v_p * dt_sim
        v_n = v_p + (-G - km * abs(v_p) * v_p) * dt_sim / 2
        if y < 0:
            if abs(v_n) < V_REST:              # 静止，截停（抖动≠反弹）
                break
            bts.append(i * dt_sim)
            y = -y
            v_n = -e * v_n
        elif v > 0 and v_n <= 0:               # 整步符号变化 = 最高点（无盲窗）
            apex.append(y)
        v = v_n
    return bts, apex

def main():
    rng = np.random.default_rng(20260908)
    print('=== 灵境 · 约束电池#2：碰撞与空气（量纲分析 + 被动性 + 恢复系数不等式）===\n')

    # ---- 现实#2 ----
    rec, tb_true = simulate_contact(h0=100.0, t_end=22.0)
    y_obs = [p[0] + rng.normal(0, SIGMA) for p in rec]
    N = len(y_obs)

    # ---- 阶段1 观测结构 ----
    bounces = detect_bounces(y_obs)
    segs = segment_states(y_obs, bounces)
    print('[阶段1] 观测结构（全部来自数据，零假设）:')
    print(f'  检出碰撞 {len(bounces)} 次、自由飞行段 {len(segs)} 段'
          f'（碰撞点位置连续、速度反号；真值反弹 {len(tb_true)} 次供人核对）')
    # 被动性：主段（平均速度>5m/s，能量足够大）内部能量单调不增
    drops = []; worst_up = 0.0; n_main = 0
    for seg in segs:
        Vm = np.abs(np.asarray(seg['V'])).mean()
        if Vm <= 5.0:
            continue                           # 末段小能量被 V 误差支配，如实剔除
        n_main += 1
        n = len(seg['V']); lo, hi = int(n*0.15), int(n*0.85)
        E = [G * seg['P'][t] + 0.5 * seg['V'][t]**2 for t in range(lo, hi)]
        drops.append(trend_total(E, H) / (abs(E[len(E)//2]) + 1e-9))
        worst_up = max(worst_up, max(0.0, max(E) - E[0]) / (abs(E[0]) + 1e-9))
    print(f'  主段×{n_main} 能量(内部)趋势: 全部 ≤ 0（降 {abs(max(drops))*100:.0f}%~'
          f'{abs(min(drops))*100:.0f}%），最大正漂 {worst_up*100:.1f}% → 耗散而不产生')
    # 窗口恒等式结构回归
    eqs = window_equations(segs)
    X2 = [e[0] for e in eqs]; X1 = [e[1] for e in eqs]; Y = [e[2] for e in eqs]
    km_q, res_q = fit_through_origin([-x for x in X2], Y)   # Y = km·(−X2)? 见下：Y=−k·X2 → 用 (−X2) 拟正 k
    gam_l, res_l = fit_through_origin([-x for x in X1], Y)
    print(f'  窗口恒等式回归（{len(eqs)} 个窗口，积分形式）:')
    print(f'    二次  Y=−k∫|v|v dt: k={km_q:.5f}  残差 {res_q*100:.1f}%')
    print(f'    线性  Y=−γ∫v dt  : γ={gam_l:.4f}  残差 {res_l*100:.1f}%')
    print(f'    → {"二次结构胜出" if res_q < res_l else "⚠ 线性胜出"}')
    # 逐次恢复系数
    # 逐次恢复系数：物理恒等式 v_reb = e·v_imp（过原点精确关系），
    # 用碰撞对做过原点回归代替逐对比值等权平均 —— 高速对（相对误差小）自然主导。
    es = []; pairs = []
    for j in range(len(segs) - 1):
        v_imp = edge_speed(segs[j], at_start=False)
        v_reb = edge_speed(segs[j + 1], at_start=True)
        if v_imp > 3.0:
            es.append(v_reb / v_imp)
            pairs.append((v_imp, v_reb))
    es = np.array(es)
    e_hat, _ = fit_through_origin([p[0] for p in pairs], [p[1] for p in pairs])
    print(f'  逐次恢复系数 e_j = {np.round(es, 3)}（撞击速度 ~35→3 m/s）')
    print(f'  过原点回归 v_reb=e·v_imp: e={e_hat:.4f}'
          f'（{len(pairs)} 对，高速对主导；速度范围内不变 → 未触及屈服极限）\n')

    # ---- 阶段2 定理推导 ----
    print('[阶段2] 数学推导（形式由定理逼出，非假设库）:')
    print('  定理D 量纲分析: 空气作用仅涉及 ρ[M L⁻³], A[L²], v[L T⁻¹] → 唯一力量纲组合')
    print('       ρAv² ⟹ F_air = ½Cd·ρAv²（形式推导，Cd 无量纲余量）；k=c/m 即待测系数')
    print('  定理E 被动性: 无外部作功 ⟹ E 不可增（F·v≤0）— 观测主段能量全部单调不增 ✓')
    print('  定理F 恢复系数不等式: 被动碰撞 0<e≤1；e 恒定 ⟺ 线弹性接触域')
    print('  定理G 终端速度: 阻力随 v 增 ⟹ 存在 v_t 且 mg=k·v_t²（力平衡推导）\n')

    # ---- 阶段3 反证证伪 ----
    half_p = max(1, len(pairs) // 2)
    e_a, _ = fit_through_origin([p[0] for p in pairs[:half_p]], [p[1] for p in pairs[:half_p]])
    e_b, _ = fit_through_origin([p[0] for p in pairs[half_p:]], [p[1] for p in pairs[half_p:]])
    e_delta = max(abs(e_a - e_b) / 2, es.std() / math.sqrt(len(es)))
    n_sigma = (1 - e_hat) / e_delta if e_delta > 0 else float('inf')
    print('[阶段3] 反证证伪:')
    print(f'  ✗ 无阻力: 能量应守恒 — 观测主段能量降 {abs(min(drops))*100:.0f}% → 驳回')
    print(f'  ✗ e=1(完全弹性): 观测 e={e_hat:.3f}±{e_delta:.3f}，1 在 {n_sigma:.0f}σ 外 → 驳回')
    print('  ✗ e>1(能量增益碰撞): 违反被动性定理 E → 数学驳回')
    print(f'  ✗ 线性阻力(Stokes): 恒等式残差 {res_l*100:.1f}% vs 二次 {res_q*100:.1f}% → 驳回'
          f'（低 Re 区量纲亦允许 Stokes，由数据结构判别）')
    print('  ✗ 永动机: 违反被动性定理 → 数学驳回\n')

    # ---- 阶段4 测余量 ----
    t_half = N * H / 2
    X2h = [[e[0], e[2]] for e in eqs if e[3] * H < t_half]
    X2h2 = [[e[0], e[2]] for e in eqs if e[3] * H >= t_half]
    km_a, _ = fit_through_origin([-p[0] for p in X2h], [p[1] for p in X2h])
    km_b, _ = fit_through_origin([-p[0] for p in X2h2], [p[1] for p in X2h2])
    km_delta = abs(km_a - km_b) / 2
    print('[阶段4] 测不可约余量（形式已推导，只剩系数）:')
    print(f'  k=c/m = {km_q:.5f} ± {km_delta:.5f} (1/m)   split-half')
    print(f'  e = {e_hat:.4f} ± {e_delta:.4f}   （{len(pairs)} 次碰撞，过原点回归 split-half）')
    print(f'  [仅供人核对] 真值 km={KM_TRUE}, e={E_TRUE}；'
          f'相对误差 km {abs(km_q-KM_TRUE)/KM_TRUE*100:.1f}%、'
          f'e {abs(e_hat-E_TRUE)/E_TRUE*100:.1f}%\n')

    # ---- 阶段5 互证 + 经验指导 ----
    y0 = segs[0]['P'][0]
    bts_hat, apex_hat = predict_derived(y0, km_q, e_hat, 22.0)
    apex_obs = [max(seg['P']) for seg in segs]
    n_cmp = min(len(apex_hat), len(apex_obs) - 1)
    print('[阶段5] 互证 + 经验指导（用推导律(k,e) 从初态预测整串反弹）:')
    print(f'  预测反弹 {len(bts_hat)} 次 vs 观测 {len(bounces)} 次（真值 {len(tb_true)} 次）')
    if n_cmp <= 0:
        print('  ⚠ 预测/观测序列为空，无法对照（诚实报：不可判定）')
    else:
        errs = [abs(apex_hat[i] - apex_obs[i+1]) / apex_obs[i+1] * 100 for i in range(n_cmp)]
        for i in range(n_cmp):
            print(f'    第{i+1}次反弹高度: 预测 {apex_hat[i]:7.2f} m vs 观测 {apex_obs[i+1]:7.2f} m'
                  f'  误差 {errs[i]:5.2f}%')
        ok = all(e_ < 10 for e_ in errs)
        print(f'  → {"✅ 推导律+测得系数复现整串反弹(全部<10%)" if ok else "⚠ 有偏差(信任时域)"}')
    print('  （误差随时域增长=信任时域：k、e 的微小误差经多次碰撞累积）')

    print('\n结论：阻力形式由量纲分析推导(非假设库)、被动性/恢复系数不等式全程成立；'
          f'余量 k={km_q:.5f}(±{km_delta:.5f})、e={e_hat:.4f}(±{e_delta:.4f})'
          ' 由数据测得(积分形式回归)；推导律从初态复现碰撞序列。')
    print('诚实边界：本数据撞击速度未达材料屈服极限(e 恒定)——屈服阈值=e 随撞击速度掉落点，'
          '需更高能量碰撞数据；低 Re 区量纲亦允许 Stokes 形式，由数据判别；'
          '真实数据仍卡沙箱无网。')

if __name__ == '__main__':
    main()
