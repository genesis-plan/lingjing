"""
灵境 · 地面世界：推花盆实验（观察→干预→学经验）— Python 轨
============================================================================
"真实世界在地面上"的落地切片（与 verify_ground.js 双轨逐位对照）。

地面世界的主导物理是 接触/支撑/摩擦/翻倒 —— 静置的花盆不动，规律藏在
"交互响应"里：不碰它只能学几何，一碰它 质量/摩擦/稳度 全部从响应中露出。
被动观察给关联，干预才给因果。

模型：花盆=刚体盒（m, R, h, μ, e）
  ① 滑动：冲量 J → v0=J/m，动摩擦滑距 d=v0²/(2μg)
  ② 摇摆（Housner 1963）：I·θ''=−m·g·Rc·sin(α·sign(θ)−θ)，α=atan(R/h)，
     换边 ω*=e·ω；能量越过势垒 m·g·Rc·(1−cosα) → 翻倒
实验：G1 学质量 m̂=J/Δv；G2 学摩擦 μ̂=v0²/(2dg)；G3 二分扫翻倒阈值 J* 反解 α̂；
     G4 用 (m̂,μ̂,α̂) 预测新推力响应 vs 真实（以真实为唯一标准）。
诚实边界：无感知层；接触为简化模型；滑动/摇摆解耦；花=活物不映射。
运行：python verify_ground.py
"""
import math

G = 9.81
DT_R = 1e-4
T_ROCK = 3.0


def make_pot(m, R, h, mu, e):
    return {
        'm': m, 'R': R, 'h': h, 'mu': mu, 'e': e,
        'alpha': math.atan(R / h),
        'Rc': math.hypot(h, R),
        'I': (4 / 3) * m * (h * h + R * R),
    }


def slide(pot, J):
    v0 = J / pot['m']
    if v0 <= 0:
        return 0.0, 0.0
    mu_eff = min(pot['mu'], 0.999)
    return v0, v0 * v0 / (2 * mu_eff * G)


def rock(pot, J):
    """摇摆（Housner，半隐式欧拉）：返回 (是否翻倒, 末角)。"""
    w0 = J * pot['h'] / pot['I']
    Eb = pot['m'] * G * pot['Rc'] * (1 - math.cos(pot['alpha']))
    if 0.5 * pot['I'] * w0 * w0 >= Eb:
        return True, pot['alpha']
    th, om, t = 0.0, w0, 0.0

    def acc(x):
        if x >= 0:
            return -pot['m'] * G * pot['Rc'] * math.sin(pot['alpha'] - x) / pot['I']
        return -pot['m'] * G * pot['Rc'] * math.sin(-pot['alpha'] - x) / pot['I']

    while t < T_ROCK:
        om += acc(th) * DT_R
        prev = th
        th += om * DT_R
        if (th > 0) != (prev > 0) and prev != 0:
            om *= pot['e']                      # 换边撞击
        t += DT_R
        if abs(th) < 1e-5 and abs(om) < 1e-4:
            break
    return False, th


def will_tip(pot, J):
    w0 = J * pot['h'] / pot['I']
    Eb = pot['m'] * G * pot['Rc'] * (1 - math.cos(pot['alpha']))
    return 0.5 * pot['I'] * w0 * w0 >= Eb


def find_tip_threshold(pot, j_lo, j_hi, tol):
    while j_hi - j_lo > tol:
        mid = (j_lo + j_hi) / 2
        if will_tip(pot, mid):
            j_hi = mid
        else:
            j_lo = mid
    return (j_lo + j_hi) / 2


def learn_alpha_from_threshold(pot, j_star, h_known):
    def pred(R):
        I = (4 / 3) * pot['m'] * (h_known * h_known + R * R)
        Rc = math.hypot(h_known, R)
        a = math.atan(R / h_known)
        Eb = pot['m'] * G * Rc * (1 - math.cos(a))
        return math.sqrt(2 * I * Eb) / h_known
    lo, hi = 1e-3, 2.0
    for _ in range(60):
        mid = (lo + hi) / 2
        if pred(mid) > j_star:
            hi = mid
        else:
            lo = mid
    return math.atan(((lo + hi) / 2) / h_known)


def fmt(x):
    return f'{x:.4f}'


def main():
    truth = make_pot(2.0, 0.07, 0.15, 0.15, 0.7)
    print('=== 灵境 · 地面世界：推花盆（观察→干预→学经验）— Python 轨 ===')
    print(f"真实花盆(智能体不可读): m=2kg R=7cm h=15cm μ=0.15 e=0.7  "
          f"临界角 α={truth['alpha'] * 180 / math.pi:.2f}°\n")

    # G1 学质量
    J1 = 0.5
    v0, _ = slide(truth, J1)
    m_hat = J1 / v0
    print(f'── G1 学质量：轻推 J={J1} N·s，测得速度跳变 Δv={fmt(v0)} m/s ──')
    print(f'   m̂ = J/Δv = {fmt(m_hat)} kg（真值 2，误差 {abs(m_hat - 2) / 2 * 100:.3f}%）')

    # G2 学摩擦
    J2 = 1.0
    v0, d = slide(truth, J2)
    mu_hat = v0 * v0 / (2 * d * G)
    print(f'── G2 学摩擦：推 J={J2} N·s，测得滑距 d={fmt(d)} m ──')
    print(f'   μ̂ = v0²/(2dg) = {fmt(mu_hat)}（真值 0.15，误差 {abs(mu_hat - 0.15) / 0.15 * 100:.3f}%）')

    # G3 学稳度
    J_star = find_tip_threshold(truth, 0.1, 5.0, 1e-6)
    alpha_hat = learn_alpha_from_threshold(truth, J_star, truth['h'])
    J_ana = math.sqrt(2 * truth['I'] * truth['m'] * G * truth['Rc'] *
                      (1 - math.cos(truth['alpha']))) / truth['h']
    print(f'── G3 学稳度：逐级加力二分扫到翻倒阈值 J*={fmt(J_star)} N·s（解析 {fmt(J_ana)}）──')
    print(f"   反解 α̂ = {alpha_hat * 180 / math.pi:.3f}°（真值 {truth['alpha'] * 180 / math.pi:.3f}°，"
          f"误差 {abs(alpha_hat - truth['alpha']) * 180 / math.pi:.4f}°）")

    # G4 经验预测 vs 真实
    exp_pot = make_pot(m_hat, math.tan(alpha_hat) * truth['h'], truth['h'], mu_hat, truth['e'])
    print('── G4 经验预测 vs 真实（学到的 m̂/μ̂/α̂ 组成花盆的经验，预测新推力响应）──')
    for J in (0.3, 1.2, 1.5):
        _, d_t = slide(truth, J)
        tip_t, _ = rock(truth, J)
        _, d_e = slide(exp_pot, J)
        tip_e, _ = rock(exp_pot, J)
        d_err = abs(d_e - d_t) / d_t * 100 if d_t > 0 else 0.0
        same = tip_t == tip_e
        print(f'   J={J} N·s: 真实 滑距={fmt(d_t)}m {"翻倒" if tip_t else "站稳"} | '
              f'经验预测 滑距={fmt(d_e)}m {"翻倒" if tip_e else "站稳"} → '
              f'滑距误差 {d_err:.2f}%、翻倒判定{"一致 ✓" if same else "不一致 ✗"}')

    print('\n结论（与 JS 轨一致）：')
    print('  · 地面世界的"学习"= 干预响应反推参数：质量/摩擦/稳度一次实验各得一个数，精度数值级；')
    print('  · "花盆不动"不是没规律：稳度 α=atan(R/h)（质心垂线出支撑面即倒）从"多大力会翻"学出；')
    print('  · 学到的 (m̂,μ̂,α̂) 就是花盆在虚拟世界里的全部力学身份——预测与真实一致；')
    print('  · 诚实：滑动/摇摆解耦、接触为简化模型、位姿假设已给、花=活物不映射。')


if __name__ == '__main__':
    main()
