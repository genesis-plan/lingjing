#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
灵境 · 动态观测：被动看一个运动的地面物体（观察→学律→经验）— Python 轨
与 verify_dynamic.js 同构（纯 Python、无 numpy 依赖）、独立种子噪声；
双轨对照"关键量同量级、无噪部分逐位一致"。
运行：python -u verify_dynamic.py
"""
import random

G = 9.81

# ---------- 3x3 线性代数（与 JS 逐字对应，纯列表实现） ----------
def mm3(a, b):
    r = [[0.0, 0.0, 0.0], [0.0, 0.0, 0.0], [0.0, 0.0, 0.0]]
    for i in range(3):
        for j in range(3):
            s = 0.0
            for k in range(3):
                s += a[i][k] * b[k][j]
            r[i][j] = s
    return r

def mv3(a, v):
    return [a[i][0] * v[0] + a[i][1] * v[1] + a[i][2] * v[2] for i in range(3)]

def mt3(a):
    return [[a[j][i] for j in range(3)] for i in range(3)]

def add3(a, b):
    return [[a[i][j] + b[i][j] for j in range(3)] for i in range(3)]

def sm3(a, s):
    return [[x * s for x in row] for row in a]

def inv3(m):
    a, b, c = m[0]; d, e, f = m[1]; g, hh, i = m[2]
    A = e * i - f * hh; D = -(b * i - c * hh); Gg = b * f - c * e
    B = -(d * i - f * g); E = a * i - c * g; Hh = -(a * f - c * d)
    C = d * hh - e * g; F = -(a * hh - b * g); I = a * e - b * d
    det = a * A + b * B + c * C
    if abs(det) < 1e-300:
        raise ValueError('singular')
    return [[x / det for x in row] for row in [[A, D, Gg], [B, E, Hh], [C, F, I]]]

# ---------- RTS 固定区间平滑器（近恒加速度 x=[p,v,a]），与 JS 逐字对应 ----------
def rts1(z, sigmaP, H, SA):
    M = len(z)
    F = [[1, H, H * H / 2], [0, 1, H], [0, 0, 1]]
    Ft = mt3(F)
    Q = sm3([[H**4/4, H**3/2, H*H/2], [H**3/2, H*H, H], [H*H/2, H, 1]], SA * SA)
    R = sigmaP * sigmaP
    xs, xpre, Pf, Pp = [], [], [], []
    x = [z[0], 0.0, 0.0]
    P = sm3([[1, 0, 0], [0, 1, 0], [0, 0, 1]], 1e6)
    for t in range(M):
        if t > 0:
            x = mv3(F, x)
            P = add3(mm3(F, mm3(P, Ft)), Q)
        xpre.append(list(x)); Pp.append([row[:] for row in P])
        S = P[0][0] + R
        K = [P[0][0] / S, P[1][0] / S, P[2][0] / S]
        yres = z[t] - x[0]
        x = [x[i] + K[i] * yres for i in range(3)]
        IKH = [[1 - K[0], 0, 0], [-K[1], 1, 0], [-K[2], 0, 1]]
        P = add3(mm3(IKH, mm3(P, mt3(IKH))),
                 sm3([[K[0]*K[0], K[0]*K[1], K[0]*K[2]],
                      [K[1]*K[0], K[1]*K[1], K[1]*K[2]],
                      [K[2]*K[0], K[2]*K[1], K[2]*K[2]]], R))
        xs.append(list(x)); Pf.append([row[:] for row in P])
    xsf = [list(xs[-1])]
    for t in range(M - 2, -1, -1):
        A = mm3(mm3(Pf[t], Ft), inv3(Pp[t + 1]))
        corr = [xsf[0][j] - xpre[t + 1][j] for j in range(3)]
        xsf.insert(0, [xs[t][i] + mv3(A, corr)[i] for i in range(3)])
    return xsf

# ---------- 种子正态噪声（random 独立种子；与 JS 同量级非逐位） ----------
def observe1d(truth, sigma, seed):
    rng = random.Random(seed)
    return [x + (rng.gauss(0, 1) * sigma if sigma > 0 else 0.0) for x in truth]

# ---------- 场景 A：滑动块 ----------
def sliding_truth(x0, v0, mug, t_stop, t_max, H):
    pos = []
    t = 0.0
    while t <= t_max + 1e-9:
        if t <= t_stop:
            pos.append(x0 + v0 * t - 0.5 * mug * t * t)
        else:
            pos.append(x0 + v0 * t_stop - 0.5 * mug * t_stop * t_stop)
        t += H
    return pos

def learn_mug(xsf):
    M = len(xsf)
    win = [t for t in range(3, M - 2)]   # 跳过 RTS 起始暂态；全程在滑动（无停-静断点）
    sx = sum(win); sy = sum(xsf[t][1] for t in win)
    sxx = sum(t * t for t in win); sxy = sum(t * xsf[t][1] for t in win)
    n = len(win)
    slope = (n * sxy - sx * sy) / (n * sxx - sx * sx)
    b = (sy - slope * sx) / n           # 速度截距 = 初速（真实时间 0）
    return -slope / H, b

# ---------- 场景 B：抛体 ----------
def proj_truth(x0, y0, vx0, vy0, t_max, H):
    xs, ys, t = [], [], 0.0
    while t <= t_max + 1e-9:
        xs.append(x0 + vx0 * t)
        ys.append(y0 + vy0 * t - 0.5 * G * t * t)
        t += H
    return xs, ys

def observe2d(xs, ys, sigma, seed):
    rng = random.Random(seed)
    ox = [x + (rng.gauss(0, 1) * sigma if sigma > 0 else 0.0) for x in xs]
    oy = [y + (rng.gauss(0, 1) * sigma if sigma > 0 else 0.0) for y in ys]
    return ox, oy

def learn_g(xsf):
    M = len(xsf)
    win = [t for t in range(M) if xsf[t][0] > 0.05 and t < M - 2]
    sx = sum(win); sy = sum(xsf[t][1] for t in win)
    sxx = sum(t * t for t in win); sxy = sum(t * xsf[t][1] for t in win)
    n = len(win)
    slope = (n * sxy - sx * sy) / (n * sxx - sx * sx)
    return -slope / H

# ============================ 实跑 ============================
H = 0.02
SIGMA = 0.01

print('=== 灵境 · 动态观测：被动看一个运动的地面物体（观察→学律→经验）— Python 轨 ===')
print(f'观测: 被动、不碰对象、只拿带噪位置流（{1/H}Hz, σ={SIGMA}m）；平滑: RTS 近恒加速度\n')

# 场景 A
mu = 0.15
mug = G * mu
v0 = 3.0
x0 = 0.0
t_stop = v0 / mug
d_true = v0 * v0 / (2 * mug)
truth_a = sliding_truth(x0, v0, mug, t_stop, 1.8, H)   # 只观测滑动段（未停，避断点污染平滑）；减速=μg
obs_a = observe1d(truth_a, SIGMA, 20260908)
r_a = rts1(obs_a, SIGMA, H, 40.0)   # SA 须足够大才放得开加速度估计（同 verify_sensor 标定值）
mug_est, v0hat = learn_mug(r_a)
d_pred = v0hat * v0hat / (2 * mug_est)
print('── 场景 A 滑动块（库仑动摩擦，纯被动观测）──')
print(f'  真值: v0={v0} m/s, μg={mug:.4f} m/s², 停于 t={t_stop:.3f}s, 滑距 d={d_true:.4f}m')
print(f'  RTS 平滑初速 v̂0={v0hat:.4f} m/s')
print(f'  被动学出 μĝ={mug_est:.4f} m/s²（真 {mug:.4f}，误差 {abs(mug_est-mug)/mug*100:.2f}%）')
print(f'  用 (v̂0, μĝ) 预测滑距 d̂={d_pred:.4f}m（真 {d_true:.4f}，误差 {abs(d_pred-d_true)/d_true*100:.2f}%）')
print('  ⚠ 诚实：纯滑动中 m 与 μ 不可分 —— μg 是可观测量；拆 m 需干预（verify_ground G1 推一下）。')

# 场景 B
px0, py0, pvx0, pvy0 = 0.0, 2.0, 5.0, 6.0
truth_b = proj_truth(px0, py0, pvx0, pvy0, 1.4, H)
obs_b = observe2d(truth_b[0], truth_b[1], SIGMA, 20260909)
r_x = rts1(obs_b[0], SIGMA, H, 40.0)
r_y = rts1(obs_b[1], SIGMA, H, 40.0)
g_est = learn_g(r_y)
ax_est = learn_g(r_x)
print('\n── 场景 B 抛体（2D 抛物线，纯被动观测）──')
print(f'  真值: g={G} m/s², 初速 (vx,vy)=({pvx0},{pvy0}) m/s, 抛出高 {py0}m')
print(f'  被动学出 ĝ={g_est:.4f} m/s²（真 {G}，误差 {abs(g_est-G)/G*100:.2f}%）')
print(f'  水平轴加速度学出={ax_est:.4f} m/s²（应≈0，无水平力，误差 {abs(ax_est)/G*100:.2f}% 相对 g）')

print('\n结论：')
print('  · 动态观测 = verify_sensor 已验证范式（带噪位置流→RTS 平滑→学动力学），地面只是换物理；')
print('  · 场景 A：被动滑动块学出减速 μg（误差级小），但 m 与 μ 不可分 —— 因果要靠干预（推花盆）；')
print('  · 场景 B：被动抛体学出真物理常数 g（误差级小）——"从运动反推物理"成立，无需碰对象；')
print('  · 被动观察给关联/可观测组合量，干预才给因果/拆参 —— 两条线（sensor 动态 / ground 静态）合流。')
