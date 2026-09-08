"""
灵境 · 多物理规律验真（Python / NumPy 轨）
================================================================================
与 verify_physics.js 跑【完全相同】的场景与参数，输出逐位可比。
任何一项对不上就是 bug，不是"精度差异"。

同一个三维世界（唯一原点居中、XYZ 正负半轴、21³=9261）上跑五类不同的物理规律：
  A 热传导   抛物型 ∂tφ = α∇²φ           耗散、平滑、不可逆
  B 声波     双曲型 ∂²u/∂t² = c²∇²u      可逆、能量守恒、二阶系统
  C 静电势   椭圆型 ∇²φ = −ρ/ε₀          瞬时平衡、线性可叠加
  D 流体输运 对流–扩散 ∂tφ + u·∇φ = α∇²φ   输运为主、对降阶不友好
  E 刚体     牛顿–欧拉（非场，世界里的物体）

每类都问同一个问题：**它到底守不守恒 / 准不准 / 能不能被降阶**。

方法学铁律（前几轮踩过，见 README）：
  ① 不在训练快照上做预测（背答案）  ② 递推跨距必须与快照间隔对齐
  ③ 前面实验污染过基之后，后续指标必须用干净基重测
  ④ 降阶模态必须检查正交性（否则加模态反而更差）
  ⑤ L4 的模型阶必须匹配系统的阶：一阶系统用仿射、二阶系统用 AR(2)

运行：python verify_physics.py
"""
from __future__ import annotations

import math

import numpy as np

from lingjing_rom import (HeatWorld3D, WaveWorld3D, PoissonWorld3D,
                          AdvectDiffuseWorld3D, RigidBody3D, HoloMap,
                          fit_affine, fit_affine2, predict_affine, predict_affine2)

N = 21
SIGMA = 3.0
RANK = 8
OPTS = dict(dx=1.0, boundary=0.0)


def gauss(cx, cy, cz):
    def f(x, y, z):
        d = (x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2
        return float(np.exp(-d / (2 * SIGMA * SIGMA)))
    return f


def bump(x, y, z):
    r = math.hypot(x, y, z)
    return math.cos(math.pi * r / 5) ** 2 if r < 2.5 else 0.0


def rel_err(a, b) -> float:
    a = np.asarray(a, dtype=np.float64).reshape(-1)
    b = np.asarray(b, dtype=np.float64).reshape(-1)
    nb = float(np.linalg.norm(b))
    return float(np.linalg.norm(a - b) / nb) if nb > 0 else 0.0


def rom_pipeline(make_world, train_steps, snap_every, test_blocks, r, order):
    """通用：在时变场上跑 L3→L5（order=1 仿射 / order=2 AR(2)），样本外自由演化。"""
    w = make_world()
    holo = HoloMap(w.N, 200)
    holo.collect(w.flat())
    for t in range(1, train_steps + 1):
        w.step()
        if t % snap_every == 0:
            holo.collect(w.flat())
    holo.build(r)
    snaps_clean = [s.copy() for s in holo.snaps]
    psi_all = [holo.project(s) for s in snaps_clean]
    fit = fit_affine2(psi_all) if order == 2 else fit_affine(psi_all)

    # 模态正交性（护栏是否生效）
    G = holo.modes.T @ holo.modes
    max_off = float(np.max(np.abs(G - np.eye(holo.r))))

    # 样本外：从训练段末向未见未来递推（跨距对齐）
    psi0 = holo.project(w.flat())                 # ψ(t=T_train)
    psi_cur, psi_prev = psi0, psi_all[len(psi_all) - 2]
    w2 = make_world()
    for _ in range(train_steps):
        w2.step()
    for _ in range(test_blocks):
        for _ in range(snap_every):
            w2.step()
        nxt = (predict_affine2(fit["A"], psi_cur, psi_prev, 1)[1]
               if order == 2 else predict_affine(fit["A"], psi_cur, 1)[1])
        psi_prev, psi_cur = psi_cur, nxt
    truth = w2.flat()
    l5 = rel_err(holo.reconstruct(holo.project(truth)), truth)
    l4 = rel_err(holo.reconstruct(psi_cur), truth)

    return {
        "r": holo.r, "energy": holo.energy(), "effective_rank": holo.effective_rank(),
        "compression": w.N / holo.r, "max_off": max_off,
        "fit_resid": fit["rel_err"], "l5": l5, "l4": l4,
    }


def _mk_heat():
    x = HeatWorld3D(N, N, N, alpha=0.2, dt=0.5, **OPTS)
    x.init(gauss(0, 0, 0))
    return x


def _mk_wave():
    x = WaveWorld3D(N, N, N, c=1.0, dt=0.2, **OPTS)
    x.init(gauss(0, 0, 0))
    return x


def _mk_poisson():
    return PoissonWorld3D(N, N, N, eps0=1.0, **OPTS)


def _mk_adv():
    x = AdvectDiffuseWorld3D(N, N, N, alpha=0.0, dt=0.2, omega=0.1, **OPTS)
    x.init(gauss(5, 0, 0))
    return x


print("=== 灵境 · 多物理规律验真 · Python 轨 ===")
print(f"世界：原点 (0,0,0) 居中，x,y,z ∈ [−10, +10]，dx=1，{N}³ = {N ** 3} 自由度\n")

# ==================== A 热传导（抛物型） ====================
print("── A 热传导（抛物型 ∂tφ = α∇²φ）：耗散、平滑、不可逆 ──")
w = HeatWorld3D(N, N, N, alpha=0.2, dt=0.5, **OPTS)
w.init(gauss(0, 0, 0))
prev = w.stats()["mean"]
monotone = True
for _ in range(60):
    w.step()
    m = w.stats()["mean"]
    if m > prev + 1e-15:
        monotone = False
    prev = m
print(f"  总热量单调不增（耗散性）= {'是' if monotone else '否'}   t=30 均值={prev:.6f}")

rom = rom_pipeline(lambda: _mk_heat(), 40, 2, 6, RANK, 1)
print(f"  L3 r={rom['r']}(请求{RANK}) 能量={rom['energy'] * 100:.4f}% 有效秩={rom['effective_rank']} "
      f"压缩={rom['compression']:.0f}:1  正交={rom['max_off']:.2e}")
print(f"  L5 重建(样本外) = {rom['l5'] * 100:.4f}%   L4 仿射预测(样本外) = {rom['l4']:.3e}")

# ==================== B 声波（双曲型） ====================
print("\n── B 声波（双曲型 ∂²u/∂t² = c²∇²u）：可逆、能量守恒、二阶系统 ──")
w = WaveWorld3D(N, N, N, c=1.0, dt=0.2, **OPTS)
w.init(gauss(0, 0, 0))
e0 = w.energy()
max_drift = 0.0
for _ in range(30):
    w.step()
    max_drift = max(max_drift, abs(w.energy() / e0 - 1))
print(f"  Courant = {w.courant:.4f}（上限 0.5774）  能量 30 步最大漂移 = {max_drift * 100:.3e}%")

# 波速：紧凑脉冲，探针测到达时刻，拟合 t(d) 斜率 = 1/c
w2 = WaveWorld3D(N, N, N, c=1.0, dt=0.05, **OPTS)
w2.init(bump)
probes = [4, 5, 6, 7]
arrivals = []
for d in probes:
    idx = w2.index_at(d, 0, 0)
    ta = None
    for _ in range(1, 201):
        w2.step()
        if abs(w2.flat()[idx]) > 1e-3:
            ta = w2.time
            break
    arrivals.append(ta)
n = len(probes)
sx, sy, sxx, sxy = sum(probes), sum(arrivals), sum(p * p for p in probes), sum(p * a for p, a in zip(probes, arrivals))
slope = (n * sxy - sx * sy) / (n * sxx - sx * sx)
print(f"  波速：探针 d={probes} 到达 t={[f'{v:.2f}' for v in arrivals]}  "
      f"拟合 1/c={slope:.4f}  理论 1.000")

# L4：一阶仿射 vs 二阶 AR(2)
rom1 = rom_pipeline(lambda: _mk_wave(), 40, 2, 6, RANK, 1)
rom2 = rom_pipeline(lambda: _mk_wave(), 40, 2, 6, RANK, 2)
print(f"  L3 r={rom2['r']} 能量={rom2['energy'] * 100:.4f}% 有效秩={rom2['effective_rank']} "
      f"压缩={rom2['compression']:.0f}:1  正交={rom2['max_off']:.2e}")
print(f"  L5 重建(样本外) = {rom2['l5'] * 100:.4f}%")
print(f"  L4 一阶仿射 预测(样本外) = {rom1['l4']:.3e}  ← 二阶系统硬塞一阶模型，爆炸")
print(f"  L4 二阶 AR(2) 预测(样本外) = {rom2['l4']:.3e}  ← 模型阶匹配后可用")

# ==================== C 静电势（椭圆型） ====================
print("\n── C 静电势（椭圆型 ∇²φ = −ρ/ε₀）：瞬时平衡、线性可叠加 ──")

# 叠加原理：三个解跑【完全相同】的迭代次数，Jacobi 是线性的 ⇒ 逐位叠加到机器精度
pa = _mk_poisson(); pa.add_point_charge(-4, 0, 0, 1); pa.solve(1000, 0)
pb = _mk_poisson(); pb.add_point_charge(4, 0, 0, 1); pb.solve(1000, 0)
pab = _mk_poisson(); pab.add_point_charge(-4, 0, 0, 1); pab.add_point_charge(4, 0, 0, 1); pab.solve(1000, 0)
sup = float(np.max(np.abs(pab.field - (pa.field + pb.field))))
den = float(np.max(np.abs(pab.field)))
print(f"  叠加原理（固定 1000 次迭代）max|φ_AB−(φ_A+φ_B)|/max|φ_AB| = {sup / den:.3e}  ← 应 ~1e-16")

# 离散均值性质：无源处 φ_p = 六邻均值（对离散调和函数精确成立）
p1 = _mk_poisson(); p1.add_point_charge(0, 0, 0, 1); r1 = p1.solve(3000, 1e-12)
mv, mvscale = 0.0, 0.0
f = p1.flat()
for px, py, pz in [(5, 0, 0), (0, 5, 0), (3, 3, 3), (-4, -2, 1)]:
    p = p1.idx(p1.i_of(px), p1.j_of(py), p1.k_of(pz))
    s = f[p - 1] + f[p + 1] + f[p - p1.nx] + f[p + p1.nx] + f[p - p1.nx * p1.ny] + f[p + p1.nx * p1.ny]
    mv = max(mv, abs(f[p] - s / 6))
    mvscale = max(mvscale, abs(f[p]))
print(f"  离散均值性质（无源点）max|φ−⟨六邻⟩| / max|φ| = {mv / mvscale:.3e}  求解残差={r1['residual']:.2e}")
print("  降阶：椭圆型无时间演化，建基须【参数化】（尚未实现），此处不套 POD")

# ==================== D 流体输运（对流主导） ====================
print("\n── D 流体输运（∂tφ + u·∇φ = α∇²φ）：输运为主、对降阶不友好 ──")

w = _mk_adv()
c0 = w.centroid()
quarter = round((math.pi / 2 / 0.1) / 0.2)
peak0 = w.stats()["max"]
for _ in range(quarter):
    w.step()
c1 = w.centroid()
ang = math.atan2(c1["y"], c1["x"]) - math.atan2(c0["y"], c0["x"])
print(f"  对流 CFL = {w.flowCFL:.4f}（上限 1）  扩散 λ = {w.lam:.4f}")
print(f"  转 90°（{quarter} 步）：质心角 {ang * 180 / math.pi:.2f}°  理论 90.00°")
print(f"  峰值 {peak0:.4e} → {w.stats()['max']:.4e}  "
      f"衰减 {(1 - w.stats()['max'] / peak0) * 100:.2f}%（一阶迎风的数值扩散，非物理耗散）")
rom = rom_pipeline(_mk_adv, 40, 2, 6, RANK, 1)
print(f"  L3 r={rom['r']} 能量={rom['energy'] * 100:.4f}% 有效秩={rom['effective_rank']} "
      f"压缩={rom['compression']:.0f}:1")
print(f"  L5 重建(样本外) = {rom['l5'] * 100:.4f}%   L4 仿射预测(样本外) = {rom['l4']:.3e}")
print(f"  ↑ 有效秩 {rom['effective_rank']} > 热传导的 3：对流问题 Kolmogorov n-width 衰减慢，低维基抓不住平移的斑")

# ==================== E 刚体（牛顿力学） ====================
print("\n── E 刚体（牛顿–欧拉，非场）：世界里的物体 ──")
rb = RigidBody3D(mass=2.0, pos=(0, 10, 0), gravity=(0, -9.81, 0))
for _ in range(100):
    rb.step(0.01)
exact = 10 - 0.5 * 9.81 * rb.time * rb.time
print(f"  自由落体（速度 Verlet，恒加速度下位置应精确）：y={rb.pos[1]:.12f} "
      f"解析={exact:.12f} 差={abs(rb.pos[1] - exact):.2e}")

rb2 = RigidBody3D(mass=3.0, pos=(0, 0, 0))
F = np.array([2.0, -1.0, 0.5])
for _ in range(200):
    rb2.apply_force(F)
    rb2.step(0.01)
p = rb2.momentum()
print(f"  动量（恒力应逐位守恒）：p=({p[0]:.9f}, {p[1]:.9f}, {p[2]:.9f})  "
      f"理论 F·t=({F[0] * 2:.9f}, {F[1] * 2:.9f}, {F[2] * 2:.9f})")

rb3 = RigidBody3D(Ix=1.0, Iy=2.0, Iz=3.0, omega=(0.3, 1.2, -0.7))
L0 = rb3.angular_momentum()
E0 = 0.5 * (rb3.Ix * rb3.omega[0] ** 2 + rb3.Iy * rb3.omega[1] ** 2 + rb3.Iz * rb3.omega[2] ** 2)
dL, dE = 0.0, 0.0
for _ in range(2000):
    rb3.step(0.005)
    L = rb3.angular_momentum()
    dL = max(dL, abs(float(np.linalg.norm(L)) / float(np.linalg.norm(L0)) - 1))
    E = 0.5 * (rb3.Ix * rb3.omega[0] ** 2 + rb3.Iy * rb3.omega[1] ** 2 + rb3.Iz * rb3.omega[2] ** 2)
    dE = max(dE, abs(E / E0 - 1))
print(f"  无力矩自转(非对称 I=1,2,3，RK2) 2000 步：|L| 漂移={dL * 100:.3e}%  转动能漂移={dE * 100:.3e}%")

# ==================== F CFL fail-closed ====================
print("\n── F 稳定性护栏：超 CFL 必须拒绝启动（fail-closed，不是警告） ──")
cases = [
    ("热传导 α·dt/dx²>1/6", lambda: HeatWorld3D(10, 10, 10, alpha=0.2, dt=5, dx=1)),
    ("声波 c·dt/dx>1/√3", lambda: WaveWorld3D(10, 10, 10, c=1, dt=1, dx=1)),
    ("流体 Σ|u|dt/dx>1", lambda: AdvectDiffuseWorld3D(10, 10, 10, alpha=0, dt=0.5, omega=5, dx=1)),
    ("流体 α·dt/dx²>1/6", lambda: AdvectDiffuseWorld3D(10, 10, 10, alpha=0.2, dt=5, omega=0.01, dx=1)),
]
for name, fn in cases:
    try:
        fn()
        print(f"  ❌ {name}：未拦截！")
    except ValueError as e:
        print(f"  ✅ {name}：已拒绝 — {str(e).split('。')[0]}")

print("\n=== Python 轨结束 ===")
