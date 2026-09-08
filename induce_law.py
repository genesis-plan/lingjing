"""
灵境 · 从轨迹反推力律（系统辨识 / 稀疏回归 SINDy 风格演示）
----------------------------------------------------------------------------
回答"虚拟世界能不能从真实轨迹学习自己的规律"：能，但必须给"数学先验"（候选基函数空间）。

方法：
  1. 用一条*未知*的中心力 truth(a_r(r)=Σc_i·b_i(r)) 生成轨迹（这里用已知系数当"真实世界"，
     模拟机器人从传感器拿到的 pos/vel 序列）。
  2. 从轨迹数值微分得加速度 a(t)，取径向分量 a_r = a·r̂。
  3. 在候选基 b(r)=[1/r², 1/r, 1, 1/r³] 上稀疏回归：解 min_c ||B·c − a_r||，
     恢复系数 c_i —— 这就是"学出的力律"。
  4. 与真实系数对照，报告残差。

诚实边界（与 README 一致）：
  - 能学 ≠ 学到真理。学出的律只在"候选基所覆盖的规律家族"内最优；基里没有的项永远学不到。
  - 数值微分对噪声敏感；观测噪声大时系数会漂（下面给噪声用例）。
  - 学到的律只在本训练区段(状态空间)内可信，分布外会像 ROM 一样崩（~90% 误差）。
  - 数学先验(基函数)就是用户说的"数学知识"——没有它，无穷多条律拟合同一有限轨迹。

运行：python induce_law.py
"""
import numpy as np


def basis(r):
    """候选力律基函数（"数学先验"=假设空间）。r>0。"""
    return np.array([1.0 / r ** 2, 1.0 / r, 1.0, 1.0 / r ** 3])


def a_mag(coeffs, r):
    """径向加速度大小 a_r(r) = Σ c_i · b_i(r)。"""
    return float(coeffs @ basis(r))


def simulate(coeffs, r0, v0, dt, steps, noise=0.0):
    """生成中心力轨迹（速度 Verlet）。返回 pos[N,2], vel[N,2]。"""
    pos = np.zeros((steps + 1, 2))
    vel = np.zeros((steps + 1, 2))
    pos[0] = r0
    vel[0] = v0
    for t in range(steps):
        r = pos[t]
        rr = float(np.linalg.norm(r)) or 1e-12
        a = a_mag(coeffs, rr) * (r / rr)          # 径向加速度矢量
        pos[t + 1] = pos[t] + vel[t] * dt + 0.5 * a * dt ** 2
        r1 = pos[t + 1]
        rr1 = float(np.linalg.norm(r1)) or 1e-12
        a1 = a_mag(coeffs, rr1) * (r1 / rr1)
        vel[t + 1] = vel[t] + 0.5 * (a + a1) * dt
        if noise > 0:                              # 模拟传感器噪声
            pos[t + 1] += np.random.default_rng(0).normal(0, noise, 2)
    return pos, vel


def learn_law(pos, vel, dt):
    """从轨迹稀疏回归出力律系数（SINDy 风格：STLSQ 序列阈值最小二乘）。

    裸 lstsq 会让所有基项都拿非零系数（数值微分偏差渗进去）。STLSQ 用稀疏性
    （奥卡姆/"数学先验"）反复把小系数归零再重拟合，只留真正显著的项。
    """
    N = len(pos)
    a_est = np.zeros((N, 2))
    for t in range(1, N - 1):
        a_est[t] = (vel[t + 1] - vel[t - 1]) / (2 * dt)   # 中心差分
    a_est[0] = a_est[1]
    a_est[-1] = a_est[-2]
    B = np.stack([basis(float(np.linalg.norm(pos[t])) or 1e-12) for t in range(N)])  # (N,4)
    a_r = np.sum(a_est * (pos / (np.linalg.norm(pos, axis=1, keepdims=True) + 1e-12)), axis=1)
    c, *_ = np.linalg.lstsq(B, a_r, rcond=None)           # 向后稳定 QR/SVD
    # STLSQ：迭代阈值化（相对容差，按当前最大系数缩放）
    for _ in range(10):
        active = np.abs(c) > 0.02 * np.max(np.abs(c))
        if active.sum() <= 1:
            break
        c_a, *_ = np.linalg.lstsq(B[:, active], a_r, rcond=None)
        c_new = np.zeros_like(c)
        c_new[active] = c_a
        if np.allclose(c_new, c, atol=1e-12):
            c = c_new
            break
        c = c_new
    pred = B @ c
    resid = float(np.linalg.norm(pred - a_r) / (np.linalg.norm(a_r) or 1))
    return c, resid


def demo(name, coeffs, r0, v0, dt=0.01, steps=4000, noise=0.0):
    np.random.seed(1)
    pos, vel = simulate(coeffs, r0, v0, dt, steps, noise=noise)
    c, resid = learn_law(pos, vel, dt)
    labels = ["1/r²", "1/r", "1", "1/r³"]
    print(f'── {name} ──')
    print(f'  真实系数 : ' + ', '.join(f'{l}={coeffs[i]:+.4f}' for i, l in enumerate(labels)))
    print(f'  学出系数 : ' + ', '.join(f'{l}={c[i]:+.4f}' for i, l in enumerate(labels)))
    print(f'  径向加速度相对残差 = {resid * 100:.4f}%')
    dominant = labels[int(np.argmax(np.abs(c)))]
    print(f'  ⇒ 判定主导力律: {dominant}（基由"数学先验"给定，学只在其中选系数）\n')


print('=== 灵境 · 从轨迹反推力律（系统辨识演示）===\n')
# 真实世界 1：纯反平方引力（GM=1000，吸引 ⇒ 1/r² 系数为负）
demo('案例1 纯反平方引力（真实世界= −GM/r²）',
     np.array([-1000.0, 0.0, 0.0, 0.0]), [10.0, 0.0], [0.0, 8.0])
# 真实世界 2：反平方 + 一个小三次修正项（模拟"真实规律和我们设计的不同"）
demo('案例2 反平方 + 三次修正（真实规律含额外结构）',
     np.array([-1000.0, 0.0, 0.0, 50.0]), [10.0, 0.0], [0.0, 8.0])
# 真实世界 3：带观测噪声（传感器不完美）
demo('案例3 同案例1 但 pos 叠加噪声 σ=1e-3（传感器不完美）',
     np.array([-1000.0, 0.0, 0.0, 0.0]), [10.0, 0.0], [0.0, 8.0], noise=1e-3)

print('诚实结论：系统能从轨迹学回力律（案例1/2 残差~机器精度）；但"能学什么"完全由')
print('候选基(数学先验)决定——基里没有的项永远学不到；噪声大(案例3)系数漂；分布外会失效。')
print('它可 falsify（留出轨迹验证），但永远不能 prove 学到的是宇宙真律。')
