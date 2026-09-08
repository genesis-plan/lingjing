"""
灵境 · 真实世界验真（Python 轨）
----------------------------------------------------------------------------
与 verify_world.js 完全同构、同初值、同步数，用于双轨数字对齐。
分层：
  物理层（现实规律，含运动）：原点=地球中心、反平方中心引力、N 体互引力、弹性碰撞。
  数学层（数学规律）：
    G4 MG 几何约束律（球面约束，纯结构非力）
    G5 MI 不变量律（能量/角动量/动量，由三大连续对称推出）
    G1–G3/G6 Bertrand 专属数学律（反平方中心力下离心率矢量守恒 ⇒ 闭合椭圆）
运行：python verify_world.py
"""
import numpy as np
from lingjing_rom import RealWorld3D


def norm(v):
    return float(np.linalg.norm(v))


def rel_err(a, b):
    return norm(np.asarray(a) - np.asarray(b)) / (norm(b) or 1.0)


def fj(v, d):
    return (' ' if v >= 0 else '') + format(v, f'.{d}f')


print('=== 灵境 · 真实世界验真（原点=地球中心 · 中心引力 + 多体 + 数学规律）· Python 轨 ===\n')

# ==================== G1 近圆轨道 ====================
print('── G1 近圆轨道（中心反平方引力，速度 Verlet 长期守恒）──')
w = RealWorld3D(G=1, M=1000, r_min=0.5)
w.add_body([10, 0, 0], [0, 10, 0], 1, 0.2)
E0 = w.energy()
L0 = w.angular_momentum()
T = 2 * np.pi * np.sqrt(10 ** 3 / 1000)
steps = int(round(5 * T / 0.01))
max_dE = 0.0
max_dL = 0.0
for _ in range(steps):
    w.step(0.01)
    max_dE = max(max_dE, abs(w.energy() / E0 - 1))
    max_dL = max(max_dL, abs(norm(w.angular_momentum()) / norm(L0) - 1))
print(f'  圆轨道 5 圈({steps} 步)：能量最大漂移 = {max_dE * 100:.3e}%  角动量|L|漂移 = {max_dL * 100:.3e}%')
print(f'  E0={E0:.4f}（应为负=束缚）  L0=({", ".join(f"{v:.2f}" for v in L0)})')

# ==================== G2 椭圆轨道：Bertrand 数学律 ====================
print('\n── G2 椭圆轨道（反平方专属数学律：离心率矢量 e_vec 守恒 ⇒ 轨道闭合成椭圆）──')
w = RealWorld3D(G=1, M=1000, r_min=0.5)
w.add_body([10, 0, 0], [0, 8, 0], 1, 0.2)
e0 = w.ecc_vector(0)
a0 = norm(e0)
a = 1 / (2 / 10 - 64 / 1000)
T = 2 * np.pi * np.sqrt(a ** 3 / 1000)
steps = int(round(2 * T / 0.01))
max_dEcc = 0.0
r_min_obs = 1e9
r_max_obs = 0.0
for _ in range(steps):
    w.step(0.01)
    e = w.ecc_vector(0)
    max_dEcc = max(max_dEcc, abs(norm(e) / a0 - 1))
    r = norm(w.bodies[0]['pos'])
    r_min_obs = min(r_min_obs, r)
    r_max_obs = max(r_max_obs, r)
print(f'  理论 a={a:.4f}（vis-viva）  实测 r∈[{r_min_obs:.4f}, {r_max_obs:.4f}]  → a≈{0.5 * (r_min_obs + r_max_obs):.4f}')
print(f'  |e_vec| 2 周期({steps} 步)最大漂移 = {max_dEcc * 100:.3e}%  ← Bertrand：反平方力下 e_vec 守恒，轨道必闭合成椭圆')

# ==================== G3 中心 + 双卫星 ====================
print('\n── G3 中心 + 双卫星：能量守恒 且 总角动量矢量(方向+大小)守恒 ──')
w = RealWorld3D(G=1, M=1000, r_min=0.5)
w.add_body([10, 0, 0], [0, 10, 0], 1, 0.2)
w.add_body([0, 15, 0], [np.sqrt(1000 / 15), 0, 0], 1, 0.2)
E0 = w.energy()
L0 = w.angular_momentum()
max_dE = 0.0
max_dLvec = 0.0
for _ in range(3000):
    w.step(0.01)
    max_dE = max(max_dE, abs(w.energy() / E0 - 1))
    max_dLvec = max(max_dLvec, rel_err(w.angular_momentum(), L0))
print(f'  3000 步：能量漂移 = {max_dE * 100:.3e}%  角动量矢量(方向+大小)漂移 = {max_dLvec * 100:.3e}%')

# ==================== G4 数学规律 MG：几何约束律 ====================
print('\n── G4 数学规律 MG·几何约束律：物体被约束在半径 R=10 的球面上（非力，每步投影）──')
w = RealWorld3D(G=1, M=1000, r_min=0.5, constraint={'type': 'sphere', 'R': 10})
w.add_body([3, 4, 0], [1, 1, 5], 1, 0.2)
w.add_body([12, 0, 5], [-2, 0, 1], 1, 0.2)
w.add_body([-2, -2, -2], [0, 3, -1], 1, 0.2)
for _ in range(200):
    w.step(0.01)
max_rad = 0.0
max_vr = 0.0
for b in w.bodies:
    r = norm(b['pos'])
    vr = float(b['vel'] @ (b['pos'] / r))
    max_rad = max(max_rad, abs(r - 10))
    max_vr = max(max_vr, abs(vr))
print(f'  200 步后：max|r−R| = {max_rad:.3e}  max|径向速度| = {max_vr:.3e}')
print('  ↑ 几何约束律"物体永远在球面上且只沿切向运动"逐位满足；注意这是数学结构，不守恒物理能量（诚实）')

# ==================== G5 数学规律 MI：三大对称 → 三守恒 ====================
print('\n── G5 数学规律 MI·不变量律：孤立 N 体（M=0, 互引力）→ 动量/角动量/能量 由对称推出并守恒 ──')
w = RealWorld3D(G=1, M=0, r_min=0.5, mutual=True)
w.add_body([5, 0, 0], [0, 1, 0], 1, 0.2)
w.add_body([-3, 4, 0], [0, 0, -0.7], 1, 0.2)
w.add_body([0, -2, 6], [0.5, 0.3, 0], 1, 0.2)
E0 = w.energy()
L0 = w.angular_momentum()
P0 = w.momentum()
max_dE = 0.0
max_dL = 0.0
max_dP = 0.0
for _ in range(4000):
    w.step(0.005)
    max_dE = max(max_dE, abs(w.energy() / E0 - 1))
    max_dL = max(max_dL, rel_err(w.angular_momentum(), L0))
    max_dP = max(max_dP, rel_err(w.momentum(), P0))
print(f'  4000 步：能量(时间平移对称)漂移 = {max_dE * 100:.3e}%')
print(f'           角动量(SO(3)旋转对称)漂移 = {max_dL * 100:.3e}%')
print(f'           动量(平移对称)漂移 = {max_dP * 100:.3e}%')

# ==================== G6 现实规律·弹性碰撞 ====================
print('\n── G6 现实规律·弹性碰撞（M=0 无引力，仅碰撞相互作用）：动量 + 动能守恒 ──')
w = RealWorld3D(G=1, M=0, r_min=0.5, collide=True)
w.add_body([-5, 0, 0], [1, 0, 0], 1, 0.5)
w.add_body([5, 0, 0], [-1, 0, 0], 1, 0.5)
KE0 = sum(0.5 * b['mass'] * norm(b['vel']) ** 2 for b in w.bodies)
P0 = w.momentum()
for _ in range(200):
    w.step(0.01)
KE1 = sum(0.5 * b['mass'] * norm(b['vel']) ** 2 for b in w.bodies)
P1 = w.momentum()
print(f'  对撞后：总动量模漂移 = {rel_err(P1, P0) * 100:.3e}%  总动能漂移 = {abs(KE1 / KE0 - 1) * 100:.3e}%')
print('  末速度 v=' + ' '.join('[' + ','.join(f'{v:.3f}' for v in b['vel']) + ']' for b in w.bodies) + '  ← 等质量正碰应反向')

# ==================== G7 fail-closed ====================
print('\n── G7 奇点护栏：物体初始距原点 < r_min 必须拒绝启动（fail-closed）──')
w = RealWorld3D(G=1, M=1000, r_min=0.5)
w.add_body([0.1, 0, 0], [0, 0, 0], 1, 0.2)
ok = False
msg = ''
try:
    w.step(0.01)
except RuntimeError as e:
    ok = True
    msg = str(e).split('（')[0]
print(f'  {"✅" if ok else "❌"} r=0.1 < r_min=0.5：{("已拒绝 — " + msg) if ok else "未拦截！"}')

print('\n=== Python 轨结束 ===')
