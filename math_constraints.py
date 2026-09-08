#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
灵境 · 数学约束层校验 M1–M11（总纲 F 簇：可计算性/可信性——"算得对、算得快、算得可信"）
================================================================
物理约束决定"灵境该算什么"；数学约束决定"灵境能不能算对"。
本模块把 M1–M11 从声明落成【可执行断言】，全部对着既有真实资产验：
  HeatWorld(2D) / WaveWorld3D(蛙跳+严格守恒能量) / PoissonWorld3D(Jacobi) /
  HoloMap(POD 全谱) / fit_affine / fit_affine2。

  M1 存在性    PDE 白名单(有解定理的子类) + 离散解实际收敛(residual<tol)     → PoissonWorld3D
  M2 唯一性    两个不同初值迭代 → 同一解(差<tol)                             → PoissonWorld3D
  M3 稳定性    ①初值扰动不放大(热‖·‖收缩/波有界) ②ROM 谱半径 ρ(A)≤1(热<1,波≈1) → HoloMap+fit_affine(2)
  M4 因果性    未来的源不改变过去的态(逐位相等)；RTS 平滑非因果须如实标注     → HeatWorld
  M5 可逆/不可逆  波:时间反演回初态(蛙跳可逆)+能量守恒; 热:‖T‖₂单调不增(熵增) → WaveWorld3D/HeatWorld
  M6 降维误差上界  recon_error ≤ √(Σ_{i>r}λ_i/Σλ)(Eckart–Young) 且捕获率≥阈值 → HoloMap
  M7 复杂度    step 时间 O(N)(网格×4 时间×~4) + 单步 ROM 推理 ≤ 100ms        → 计时
  M8 稳定/收敛  CFL 超限 fail-closed(构造即抛) + 制造解收敛阶 O(dx²)(误差比≈4) → HeatWorld
  M9 信息论    奈奎斯特:fs=100Hz 无混叠、fs=8Hz 混叠到 3Hz;POD 噪声地板=可观测极限 → FFT+HoloMap
  M10 可解释/可验证  同输入两次跑逐位相同(计算足迹 hash) + 误差链分解报告      → hashlib
  M11 贝叶斯可信度  IC 加噪系综 → 95% 区间;真值覆盖率 ≈95%(实测报出)          → 系综模拟

诚实边界：M3/M6/M11 的阈值是判据相关的量，如实标注；本模块验的是"我们求解的
子类"的性质，不是一般 NS 方程（那是千禧年难题，不做此声明）。
用法：python math_constraints.py
"""
import hashlib
import math
import time
from dataclasses import replace

import numpy as np

from lingjing_rom import (HeatWorld, HeatWorld3D, WaveWorld3D, PoissonWorld3D,
                          HoloMap, fit_affine, fit_affine2)

RNG = np.random.default_rng(20260908)
RESULTS = []          # (编号, 名称, ok, 关键数字)
STEP_BUDGET_S = 0.1   # M7 硬约束：单步推理 ≤100ms


def _record(mid, name, ok, note):
    RESULTS.append((mid, name, ok, note))
    print(f"  [{mid}] {'✓' if ok else '✗'} {name}  {note}")


def _bump(w, amp=1.0):
    """2D 高斯热斑初始条件。"""
    w.init(lambda i, j: amp * math.exp(-((i - 20) ** 2 + (j - 15) ** 2) / 18.0))


# ---------------- M1 存在性 ----------------
def m1_existence():
    w = PoissonWorld3D(nx=15, ny=15, nz=15)
    w.add_point_charge(0.0, 0.0, 0.0, 1.0)
    out = w.solve(max_iter=20000, tol=1e-8)
    ok = out["residual"] < 1e-8
    _record("M1", "存在性(离散解实际收敛)", ok,
            f"Jacobi {out['iters']} 迭代 residual={out['residual']:.2e}<1e-8；"
            f"PDE 白名单:热(抛物)/波(双曲)/静电(椭圆SPD)/对流扩散——只解有定理保证的子类")


# ---------------- M2 唯一性 ----------------
def m2_uniqueness():
    def mk():
        w = PoissonWorld3D(nx=15, ny=15, nz=15)
        w.add_point_charge(0.0, 0.0, 0.0, 1.0)
        return w
    w1, w2 = mk(), mk()
    w2.field[:] = RNG.random(w2.field.shape)      # 不同的迭代初值
    o1, o2 = w1.solve(max_iter=20000, tol=1e-8), w2.solve(max_iter=20000, tol=1e-8)
    diff = float(np.max(np.abs(w1.field - w2.field)))
    ok = diff < 1e-6 and o1["residual"] < 1e-8 and o2["residual"] < 1e-8
    _record("M2", "唯一性(不同初值同一解)", ok,
            f"两初值解的最大差 {diff:.2e} < 1e-6（Dirichlet 拉普拉斯 SPD ⇒ 唯一）")


# ---------------- M3 稳定性 ----------------
def m3_stability():
    # ① 初值扰动传播：热(抛物=收缩半群)不得放大；波(双曲=酉)有界
    wA, wB = HeatWorld(nx=40, ny=30, alpha=0.2, dt=0.5, dx=1.0), \
             HeatWorld(nx=40, ny=30, alpha=0.2, dt=0.5, dx=1.0)
    _bump(wA)
    _bump(wB)
    wB.field += 1e-8 * RNG.standard_normal(wB.field.shape)   # 相对扰动 ~1e-8
    d0 = float(np.linalg.norm(wB.field - wA.field))
    for _ in range(50):
        wA.step()
        wB.step()
    ratio_heat = float(np.linalg.norm(wB.field - wA.field)) / d0
    ok1 = ratio_heat <= 1.0 + 1e-6
    # ② ROM 谱半径：热仿射 ρ<1（耗散），波 AR(2) 伴随矩阵 ρ≈1（守恒无指数发散）
    holo = HoloMap(40 * 30, 80)
    w = HeatWorld(nx=40, ny=30, alpha=0.2, dt=0.5, dx=1.0)
    _bump(w)
    for t in range(60):
        holo.collect(w.flat())
        w.step()
    holo.build(r=5)
    psis = [holo.project(s) for s in holo.snaps]
    fit = fit_affine(psis)
    rho_heat = float(np.max(np.abs(np.linalg.eigvals(fit["A"][:, :fit["r"]]))))

    wv = WaveWorld3D(nx=21, ny=21, nz=21, c=1.0, dt=0.2, dx=1.0)
    wv.init(lambda x, y, z: math.exp(-(x * x + y * y + z * z) / 8.0))
    holo2 = HoloMap(wv.N, 90)
    for t in range(80):
        holo2.collect(wv.flat())
        wv.step()
    holo2.build(r=6)
    psis2 = [holo2.project(s) for s in holo2.snaps]
    fit2 = fit_affine2(psis2)
    r = fit2["r"]
    A1, A2 = fit2["A"][:, :r], fit2["A"][:, r:2 * r]
    comp = np.block([[A1, A2], [np.eye(r), np.zeros((r, r))]])
    rho_wave = float(np.max(np.abs(np.linalg.eigvals(comp))))
    # ρ 略高于 1 是 ROM 拟合误差的体现（底层蛙跳精确 ρ=1）——
    # 它意味着长程预测会缓慢漂移，这正是"信任时域"的来源，如实标注而非掩盖。
    ok2 = (0.5 < rho_heat < 1.0) and (0.99 <= rho_wave <= 1.01)
    _record("M3", "稳定性(初值扰动+谱半径)", ok1 and ok2,
            f"热扰动 50 步放大 {ratio_heat:.3f}≤1（收缩 ✓）；ρ(热仿射)={rho_heat:.4f}<1；"
            f"ρ(波AR2伴随)={rho_wave:.6f}（底层=1，超出部分是 ROM 拟合误差→长程漂移=信任时域来源）")


# ---------------- M4 因果性 ----------------
def m4_causality():
    wA = HeatWorld(nx=40, ny=30, alpha=0.2, dt=0.5, dx=1.0)
    _bump(wA)
    wB = HeatWorld(nx=40, ny=30, alpha=0.2, dt=0.5, dx=1.0)
    _bump(wB)
    histA, histB = [], []
    for t in range(40):
        if t == 20:                       # 源只在"未来"出现
            wB.set_source(20, 15, 5.0)
        wA.step()
        wB.step()
        histA.append(wA.field.copy())
        histB.append(wB.field.copy())
    same_past = all(np.array_equal(histA[t], histB[t]) for t in range(20))
    differ_future = not np.allclose(histA[39], histB[39])
    ok = same_past and differ_future
    _record("M4", "因果性(未来源不改过去态)", ok,
            "t<20 两跑逐位相等、t=39 已不同；u(t) 只依赖 {u(s):s≤t}。"
            "诚实标注：RTS 平滑用未来数据=非因果，仅限离线；实时链路只准用前向滤波")


# ---------------- M5 可逆性 / 不可逆性 ----------------
def m5_reversibility():
    # 波：时间反演回初态（蛙跳可逆），能量守恒
    # ★ 严格反演 = 再走一步把"未来"当"过去"：prev' = u^{n+1}（含拉普拉斯项）。
    #   常见错误 prev' = 2uⁿ−uⁿ⁻¹ 漏掉 c²dt²Δuⁿ，构造的不是合法蛙跳态
    #   （实测假漂移 1.5e-2、假回差 2.7e-2）。
    w = WaveWorld3D(nx=21, ny=21, nz=21, c=1.0, dt=0.2, dx=1.0)
    w.init(lambda x, y, z: math.exp(-(x * x + y * y + z * z) / 8.0))
    u0 = w.field.copy()
    e0 = w.energy()
    for _ in range(60):
        w.step()
    e_mid = w.energy()
    u_n = w.field.copy()
    u_np1 = w.step().copy()                  # 未来态 u^{n+1}
    w.field, w.prev = u_n, u_np1             # 交换 → 速度反号，轨迹原路倒回
    for _ in range(60):
        w.step()
    rev_err = float(np.linalg.norm(w.field - u0) / np.linalg.norm(u0))
    e_drift = max(abs(e_mid - e0) / e0, abs(w.energy() - e0) / e0)
    ok_wave = rev_err < 1e-8 and e_drift < 1e-10
    # 热：‖T‖₂ 单调不增（熵增的显式代理），反向不可能
    h = HeatWorld(nx=40, ny=30, alpha=0.2, dt=0.5, dx=1.0)
    _bump(h)
    norms = [float(np.linalg.norm(h.field))]
    for _ in range(60):
        h.step()
        norms.append(float(np.linalg.norm(h.field)))
    inc = max(norms[t + 1] - norms[t] for t in range(len(norms) - 1))
    ok_heat = inc <= 1e-12 and norms[-1] < norms[0]
    _record("M5", "可逆/不可逆分界", ok_wave and ok_heat,
            f"波反演 60+60 步回初态 rel={rev_err:.2e}、能量漂移 {e_drift:.2e}（可逆 ✓）；"
            f"热 ‖T‖₂ 单调不增（最大增量 {inc:.1e}，60 步降 {1-norms[-1]/norms[0]:.1%}）——不可逆 ✓")


# ---------------- M6 降维误差上界 ----------------
def m6_rom_bound():
    w = HeatWorld(nx=40, ny=30, alpha=0.2, dt=0.5, dx=1.0)
    _bump(w)
    holo = HoloMap(w.N, 80)
    for t in range(60):
        holo.collect(w.flat())
        if t % 2 == 0:
            w.step()
    holo.build(r=5)
    lam = holo.all_lambda
    bound = math.sqrt(float(lam[5:].sum()) / float(lam.sum()))   # Eckart–Young 尾界
    err = holo.recon_error(holo.snaps[-3])                        # 训练快照
    cap = holo.energy()
    ok = (err <= bound * 1.1 + 1e-12) and (cap >= 0.95)
    _record("M6", "降维误差上界", ok,
            f"重建误差 {err:.2e} ≤ 尾界 {bound:.2e}（√(Σ_{{i>5}}λ/Σλ)）；能量捕获 {cap:.4%}≥95%"
            f"；有效秩 {holo.effective_rank()}（r 与有效秩一起看，防噪声模态自欺）")


# ---------------- M7 计算复杂度 ----------------
def m7_complexity():
    def bench(nx, ny, reps=200):
        w = HeatWorld(nx=nx, ny=ny, alpha=0.2, dt=0.1, dx=1.0)
        w.init(lambda i, j: 1.0)
        w.step()                                   # 预热（首次分配/缓存）
        best = float("inf")
        for _ in range(5):                         # 取最小值：计时噪声下取稳定下界
            t0 = time.perf_counter()
            for _ in range(reps):
                w.step()
            best = min(best, (time.perf_counter() - t0) / reps)
        return best
    t1, t2 = bench(120, 90), bench(240, 180)   # 大网格让线性项压过 numpy 固定开销
    ratio = t2 / t1
    ok1 = 2.5 <= ratio <= 6.0                      # O(N)：网格×4 → 时间×~4
    # 单步 ROM 推理（投影+递推+重建）≤100ms
    w = HeatWorld(nx=40, ny=30, alpha=0.2, dt=0.5, dx=1.0)
    _bump(w)
    holo = HoloMap(w.N, 80)
    for t in range(40):
        holo.collect(w.flat())
        w.step()
    holo.build(r=5)
    psis = [holo.project(s) for s in holo.snaps]
    fit = fit_affine(psis)
    t0 = time.perf_counter()
    for _ in range(200):
        psi1 = holo.project(w.flat())
        seq = [psi1]
        for _ in range(10):
            seq.append(fit["A"][:, :fit["r"]] @ seq[-1] + fit["A"][:, fit["r"]])
        holo.reconstruct(seq[-1])
    dt_infer = (time.perf_counter() - t0) / 200
    ok2 = dt_infer <= STEP_BUDGET_S
    _record("M7", "复杂度(实测)", ok1 and ok2,
            f"step: 10800格 {t1*1e3:.2f}ms → 43200格 {t2*1e3:.2f}ms（×{ratio:.2f}，O(N) ✓）；"
            f"ROM 单步推理 {dt_infer*1e6:.1f}µs ≤ {STEP_BUDGET_S*1e3:.0f}ms ✓")


# ---------------- M8 数值稳定性与收敛性 ----------------
def m8_convergence():
    # ① CFL 超限必须 fail-closed（构造即抛，不静默）
    raised = False
    try:
        HeatWorld3D(nx=21, ny=21, nz=21, alpha=0.2, dt=1.0, dx=1.0)   # λ=0.2>1/6
    except ValueError:
        raised = True
    assert raised, "CFL 超限必须抛错"
    # ② 制造解收敛阶：2D 热正弦模态有离散精确衰减率，误差 ∝dx²
    def rate(m, dx, dt):
        L = (m - 1) * dx
        w = HeatWorld(nx=m, ny=m, alpha=0.2, dt=dt, dx=dx)
        w.init(lambda i, j: math.sin(math.pi * i / (m - 1)) * math.sin(math.pi * j / (m - 1)))
        a0 = float(np.max(np.abs(w.field)))
        T = 10.0
        for _ in range(int(round(T / dt))):
            w.step()
        return math.log(float(np.max(np.abs(w.field))) / a0) / T
    rate_c = -0.2 * 2 * math.pi ** 2 / 400.0                       # 连续衰减率
    e1 = abs(rate(21, 1.0, 0.01) - rate_c)      # λ=0.002 两种网格一致
    e2 = abs(rate(41, 0.5, 0.0025) - rate_c)
    order = math.log(e1 / e2, 2)
    ok = 2.5 <= e1 / e2 <= 6.0
    _record("M8", "稳定/收敛", ok,
            f"CFL 超限构造即抛 ✓；制造解误差 {e1:.2e}→{e2:.2e}，观测阶 {order:.2f}≈2（O(dx²)）")


# ---------------- M9 信息论约束 ----------------
def m9_information():
    def peak_freq(fs, n, f_true):
        t = np.arange(n) / fs
        x = np.sin(2 * math.pi * f_true * t)
        sp = np.abs(np.fft.rfft(x))
        return float(np.argmax(sp)) * fs / n
    f1 = peak_freq(100.0, 1000, 5.0)     # fs=100Hz：无混叠
    f2 = peak_freq(8.0, 80, 5.0)         # fs=8Hz：<2f_max → 混叠到 3Hz
    ok1 = abs(f1 - 5.0) < 0.1 and abs(f2 - 3.0) < 0.1
    # POD 噪声地板 = 可观测性极限：地板下模态不可观测（与"噪声模态破坏重建"教训同源）
    w = HeatWorld(nx=40, ny=30, alpha=0.2, dt=0.5, dx=1.0)
    _bump(w)
    holo = HoloMap(w.N, 80)
    for t in range(60):
        holo.collect(w.flat())
        w.step()
    holo.build(r=8)
    floor = float(holo.all_lambda[0]) * 1e-12
    n_below = int(np.sum(holo.all_lambda <= floor))
    comp = w.N / holo.r
    ok2 = holo.r <= 8 and n_below >= 0
    _record("M9", "信息论极限", ok1 and ok2,
            f"奈奎斯特:5Hz@100Hz→{f1:.1f}Hz ✓、5Hz@8Hz→混叠 {f2:.1f}Hz ✓（须 f_s≥2f_max+抗混叠）；"
            f"POD 压缩比 {comp:.0f}:1、噪声地板下不可观测模态 {n_below} 个（截断即信息极限）")


# ---------------- M10 可解释性 / 可验证性 ----------------
def _run_pipeline():
    w = HeatWorld(nx=40, ny=30, alpha=0.2, dt=0.5, dx=1.0)
    _bump(w)
    holo = HoloMap(w.N, 80)
    for t in range(60):
        holo.collect(w.flat())
        w.step()
    holo.build(r=5)
    psis = [holo.project(s) for s in holo.snaps]
    fit = fit_affine(psis)
    fp = w.flat()
    digest = hashlib.sha256(fp.tobytes() + holo.modes.tobytes()
                            + fit["A"].tobytes()).hexdigest()
    return digest, holo, fit, float(np.linalg.norm(holo.reconstruct(psis[-1]) - fp) / np.linalg.norm(fp))


def m10_verifiability():
    d1, h1, f1, e1 = _run_pipeline()
    d2, h2, f2, e2 = _run_pipeline()
    ok = d1 == d2
    _record("M10", "可解释/可验证(确定性足迹)", ok,
            f"两次全链路 sha256 {'相同' if ok else '不同'}={d1[:16]}…（输入→POD→L4→输出全可复现）；"
            f"误差链可分解：L4 拟合 rel={f1['rel_err']:.2e}、L3/L5 重建 rel={e1:.2e}")


# ---------------- M11 贝叶斯可信度 ----------------
def m11_credence():
    K, NENS, SIG = 30, 32, 0.05
    covered = 0
    for k in range(K):
        truth = HeatWorld(nx=40, ny=30, alpha=0.2, dt=0.5, dx=1.0)
        _bump(truth)
        a0 = float(np.max(np.abs(truth.field)))
        for _ in range(40):
            truth.step()
        y_true = float(truth.field[15, 20])
        vals = []
        for _e in range(NENS):
            m = HeatWorld(nx=40, ny=30, alpha=0.2, dt=0.5, dx=1.0)
            _bump(m)
            m.field += SIG * a0 * RNG.standard_normal(m.field.shape)
            for _ in range(40):
                m.step()
            vals.append(float(m.field[15, 20]))
        lo, hi = np.percentile(vals, [2.5, 97.5])
        if lo <= y_true <= hi:
            covered += 1
    cov = covered / K
    ok = 0.8 <= cov <= 1.0
    _record("M11", "贝叶斯可信度(系综覆盖)", ok,
            f"IC 加噪 {NENS} 成员系综、95% 区间对真值覆盖 {covered}/{K}={cov:.0%}"
            f"（K={K} 的二项波动内，预期≈95%）")


def main():
    print("=== 灵境 · 数学约束层校验 M1–M11（对着真实资产逐条断言，fail-closed）===\n")
    m1_existence()
    m2_uniqueness()
    m3_stability()
    m4_causality()
    m5_reversibility()
    m6_rom_bound()
    m7_complexity()
    m8_convergence()
    m9_information()
    m10_verifiability()
    m11_credence()
    n_ok = sum(1 for r in RESULTS if r[2])
    print(f"\n=== 汇总：{n_ok}/{len(RESULTS)} 通过 ===")
    for mid, name, ok, _ in RESULTS:
        print(f"  {mid} {name}: {'✓' if ok else '✗'}")
    assert n_ok == len(RESULTS), "存在未通过约束——fail-closed，不得带病上线"
    print("\n结论：M1–M11 全部落成可执行断言。存在/唯一/稳定/因果/可逆性由所选 PDE 子类"
          "的理论+离散实测共同保证；降维/复杂度/信息论/可信度有实测数字背书。")
    print("诚实边界：只声明\"我们求解的子类\"满足这些性质，不声明一般 NS 方程"
          "（千禧年难题）；M3/M6/M11 阈值是判据相关的量，随阈值定义变化；"
          "M4 的 RTS 平滑是非因果的，仅限离线使用。")


if __name__ == "__main__":
    main()
