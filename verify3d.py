"""
灵境 · 三维虚拟仿真验真（Python / NumPy 轨）
================================================================================
与 verify3d.js 跑【完全相同】的场景与参数，输出逐位可比。
任何一项对不上就是 bug，不是"精度差异"。

⚠️ 方法学（吸取首版教训，两轨一致）：
  1. 快照必须【拷贝】入轨迹。HeatWorld3D.flat() 返回 field 本体视图，
     step() 会原地改写它——若直接存引用，全部快照会塌缩成同一个终态，
     进而使 PᵀP 秩亏、最小二乘静默失败返回零矩阵，伪造成"预测误差 100%"。
  2. 重建误差必须在【基没见过】的状态上测。拿建基用的快照去测恒等于 0，
     是自欺指标（首版即犯此错，已修）。

运行：python verify3d.py
"""
from __future__ import annotations

import numpy as np

from lingjing_rom import (HeatWorld3D, HoloMap, fit_linear, fit_affine,
                          predict, predict_affine)

# ---- 场景参数（两轨必须一致）----
N = 20                 # 每边格点数 → N³ = 8000 自由度
SIGMA = 3.0
CENTER = (N - 1) / 2
TRAIN_STEPS = 40       # 训练段：t=0..40
TEST_STEPS = 20        # 测试段：继续步进到 t=60（基未见过）
SNAP_EVERY = 2
R = 8
H = 6                  # L4 多步预测步数


def hot_spot(cx: float, cy: float, cz: float):
    def f(i, j, k):
        d = (i - cx) ** 2 + (j - cy) ** 2 + (k - cz) ** 2
        return float(np.exp(-d / (2 * SIGMA * SIGMA)))
    return f


OPTS = dict(alpha=0.2, dt=0.5, dx=1.0, boundary=0.0)


def rel_err(a, b) -> float:
    a = np.asarray(a, dtype=np.float64).reshape(-1)
    b = np.asarray(b, dtype=np.float64).reshape(-1)
    nb = float(np.linalg.norm(b))
    return float(np.linalg.norm(a - b) / nb) if nb > 0 else 0.0


print("=== 灵境 3D 验真 · Python 轨 ===")

# ==================== L1+L2：三维热传导演化 ====================
w = HeatWorld3D(nx=N, ny=N, nz=N, **OPTS)
w.init(hot_spot(CENTER, CENTER, CENTER))
print(f"网格 {N}×{N}×{N} = {w.N} 自由度 | λ=α·dt/dx²={w.lam:.6f} (3D CFL 上限 0.166667)")

holo = HoloMap(N=w.N, max_snap=200)
for t in range(TRAIN_STEPS + 1):
    if t % SNAP_EVERY == 0:
        holo.collect(w.flat().copy())          # ★ 必须拷贝
    if t < TRAIN_STEPS:
        w.step()

s = w.stats()
print(f"  L1 t={TRAIN_STEPS}（训练段末） max={s['max']:.6f}  mean={s['mean']:.6f}")

# ==================== L3：全息降阶 ====================
built = holo.build(r=R)
print(f"  L3 降阶 r={built['r']}  能量捕获率={built['energy'] * 100:.4f}%  "
      f"压缩比={w.N / built['r']:.1f}:1")
print(f"  L3 有效秩={holo.effective_rank()}  谱断崖位置={holo.cliff_index()}")

# 训练段上的 psi 序列（L4 用）
psi_seq = [holo.project(snap) for snap in holo.snaps]
psi_seq = [p for p in psi_seq if p is not None]
# ★ 留存一份干净训练快照：下面分布外/自适应实验会【故意污染 holo】（把 OOD 帧吸收进基），
#   L4 必须在干净基上测，否则会被污染基带偏（曾据此误报 4.7e-1）。
train_snaps = [snap.copy() for snap in holo.snaps]

# ==================== L5：分布内【留出】测试 ====================
for _ in range(TEST_STEPS):
    w.step()
s = w.stats()
print(f"  L1 t={TRAIN_STEPS + TEST_STEPS}（测试段末） max={s['max']:.6f}  mean={s['mean']:.6f}")
err_in = holo.recon_error(w.flat())
print(f"  L5 重建误差 · 分布内(留出) = {err_in * 100:.4f}%")

# ==================== L5：分布外（热点挪到别处） ====================
w_ood = HeatWorld3D(nx=N, ny=N, nz=N, **OPTS)
w_ood.init(hot_spot(4, 4, 4))
for _ in range(20):
    w_ood.step()
err_out = holo.recon_error(w_ood.flat())
print(f"  L5 重建误差 · 分布外       = {err_out * 100:.4f}%")

# ==================== 自适应：吸收 1 帧后，在【另一个】OOD 状态上测泛化 ====================
holo.collect(w_ood.flat().copy())
holo.build(r=R)
err_same_after = holo.recon_error(w_ood.flat())
w_ood2 = HeatWorld3D(nx=N, ny=N, nz=N, **OPTS)
w_ood2.init(hot_spot(15, 15, 5))
for _ in range(20):
    w_ood2.step()
err_other_after = holo.recon_error(w_ood2.flat())
print(f"  L5 自适应后·同状态         = {err_same_after * 100:.4f}%（吸收进基，属记忆非泛化）")
print(f"  L5 自适应后·另一 OOD 状态 = {err_other_after * 100:.4f}%（这才是泛化）")

# ==================== L4：边界低维动力学（线性 vs 仿射；样本内 vs 样本外） ====================
# ⚠️ 方法学（踩过两个坑，写在这里防止复发）
#   坑 1 · 背答案：早期版本用 predict_affine(A, psi_seq[0], H) 比 psi_seq[H]——
#          起点和终点【都是训练快照】，本质是样本内复现，误差 1e-9 量级毫无预测意义。
#          现改为【样本外自由演化】：从训练段末状态出发，向基从未见过的未来递推。
#   坑 2 · 跨距错配：快照每 SNAP_EVERY 个物理步存一张 ⇒ 拟合出的 A 是"两步映射"。
#          递推 1 次必须走 SNAP_EVERY 个物理步；按 1 步递推等于让预测跑双倍速，
#          误差会虚高到 1e-1 量级（曾据此误判"模型不行"，实为脚本 bug）。
#   结论口径：L4 误差应与 L5 投影底线同量级——边界预测本身几乎不引入额外误差。

# 用干净基重建（此时 holo 已被自适应实验污染）
holo_l4 = HoloMap(N=w.N, max_snap=200)
for snap in train_snaps:
    holo_l4.collect(snap.copy())
holo_l4.build(r=R)
seq_l4 = [holo_l4.project(snap) for snap in holo_l4.snaps]

fit = fit_linear(seq_l4)
fit_a = fit_affine(seq_l4)

# ---- 样本内（背答案，仅作对照，不得用于对外宣称）----
if fit:
    pred = predict(fit["A"], seq_l4[0], H)
    print(f"  L4 线性拟合 残差(样本内)     = {fit['rel_err']:.4e}")
    print(f"  L4 线性 {H} 步(样本内/背答案) = {rel_err(pred[H], seq_l4[H]):.4e}")
if fit_a:
    pred_a = predict_affine(fit_a["A"], seq_l4[0], H)
    print(f"  L4 仿射拟合 残差(样本内)     = {fit_a['rel_err']:.4e}")
    print(f"  L4 仿射 {H} 步(样本内/背答案) = {rel_err(pred_a[H], seq_l4[H]):.4e}")

# ---- 样本外自由演化（这才是真正的预测）----
w4 = HeatWorld3D(nx=N, ny=N, nz=N, **OPTS)
w4.init(hot_spot(CENTER, CENTER, CENTER))
for _ in range(TRAIN_STEPS):
    w4.step()                                    # 推进到训练段末
psi_l = holo_l4.project(w4.flat())
psi_a = holo_l4.project(w4.flat())
for _ in range(H):
    for _q in range(SNAP_EVERY):                 # 跨距严格对齐
        w4.step()
    if fit:
        psi_l = predict(fit["A"], psi_l, 1)[1]
    psi_a = predict_affine(fit_a["A"], psi_a, 1)[1]

truth_h = w4.flat()
floor_h = holo_l4.recon_error(truth_h)           # L5 投影底线（同 horizon）
if fit:
    print(f"  L4 线性 {H} 步(样本外/真预测) = {rel_err(holo_l4.reconstruct(psi_l), truth_h):.4e}")
print(f"  L4 仿射 {H} 步(样本外/真预测) = {rel_err(holo_l4.reconstruct(psi_a), truth_h):.4e}")
print(f"  L5 投影底线(同 horizon)      = {floor_h * 100:.4f}%（L4 应与之同量级）")

print("=== Python 轨结束 ===")
