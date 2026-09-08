#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
灵境 · 耦合可行性判定器 feasibility()（总纲横切红带② 的落地）
================================================================
总纲 docs/constraints-framework.md §一：单律过了 ≠ 系统可行。
输入一组规格（尺寸/质量/材料/功率/散热/飞行盘面积/任务），联立全部硬约束，
输出 {可行?, 瓶颈序列(余量升序), 各约束余量}。

物理形式（全部显式公式，零依赖）：
  B1 静态   σ_s = m·g/A_cs ≤ σ_y
  B1 动态   σ_d = k_bend·n·m·g/A_cs ≤ σ_y      （k_bend=弯曲放大，经验系数）
  A2 敏捷   a_max = σ_y·A_cs/(k_bend·m) ≥ a_req
  D2 热     (1−η)·P_max ≤ h·A_skin·ΔT_max      （不满足→峰值占空 duty=margin）
  B3 飞行   P_hover = (m·g)^1.5/√(2ρA_disk) ≤ P_max   （动量/盘作动理论）
  B3 气动加热 T_stag = T0·(1+(γ−1)/2·M²) ≤ T_limit
  D1 能量   f·m·e_density ≥ P_max·duty·t_req/η

尺度律自动涌现（几何相似缩放 s：质量/功率/储能∝s³，截面/散热面/盘面积∝s²）：
  静态应力∝s、动态应力/敏捷/热余量∝1/s、飞行余量∝1/s^0.5
  —— 这就是平方-立方律的判定器形式：需求∝L³ vs 容量∝L²。

校准锚点（先用真实世界验证判定器本身，再拿去判设定——尺子没验过不许量东西）：
  ① 岩柱自压极限 σ_y/ρg ≈ 7.6 km vs 珠峰 8.85 km（同量级）
  ② Mi-26（56t，旋翼直径 32m）理想悬停功率 ≈9 MW，装机 ~15 MW 级 > 理想 ✓
  ③ 电池#2 同一阻力模型终端速度 √(g/k)=44.3 m/s（100m 落体不达终端 ✓）
  ④ 人体基线：动态骨应力余量 ~3.8×；峰值散热占空 ~54%（短跑必过热——真实）

用法：python feasibility.py
"""
import math
from dataclasses import dataclass, replace

G = 9.81
RHO_AIR = 1.225
GAMMA = 1.4
T0 = 288.0          # 海平面气温 K
A_SOUND = 340.0     # 声速 m/s


@dataclass
class Spec:
    name: str
    L: float            # 特征尺寸 m
    m: float            # 质量 kg
    sigma_y: float      # 材料屈服/极限 Pa
    A_cs: float         # 承载截面 m²
    k_bend: float       # 弯曲放大系数（经验，待测；只影响数值不影响尺度结论）
    P_max: float        # 峰值机械功率 W
    eta: float          # 能量→机械效率
    h_eff: float        # 综合散热系数 W/(m²·K)
    A_skin: float       # 散热面积 m²
    dT_max: float       # 允许温升 K
    A_disk: float       # 飞行盘面积 m²（不飞=0）
    v_max: float        # 最大空速 m/s（不飞=0）
    T_limit: float      # 外壳材料耐温 K
    e_density: float    # 能源能量密度 J/kg
    fuel_frac: float    # 能源质量占比
    t_req: float        # 任务时长 s
    duty_req: float     # 峰值占空需求
    a_req: float        # 所需加速度（跳跃 ≥ g）
    load_n: float       # 步态/冲击峰值载荷因子（×mg）


def scale(sp: Spec, s: float) -> Spec:
    """几何相似缩放：材料/效率/密度/温升/需求指标不变，几何与功率按尺度律缩放。"""
    return replace(sp, name=f"{sp.name} ×{s:g}", L=sp.L * s, m=sp.m * s ** 3,
                   A_cs=sp.A_cs * s ** 2, A_skin=sp.A_skin * s ** 2,
                   A_disk=sp.A_disk * s ** 2, P_max=sp.P_max * s ** 3)


def check(sp: Spec):
    """联立全部硬约束。返回约束列表 [{layer,name,demand,capacity,margin,kind,unit,formula}]。"""
    c = []
    mg = sp.m * G

    sig_s = mg / sp.A_cs
    c.append(dict(layer='B1', name='静态自压', demand=sig_s, capacity=sp.sigma_y,
                  margin=sp.sigma_y / sig_s, kind='hard', unit='Pa',
                  formula='σ_s=mg/A_cs ≤ σ_y'))

    sig_d = sp.k_bend * sp.load_n * mg / sp.A_cs
    c.append(dict(layer='B1', name='动态结构(步态/冲击)', demand=sig_d, capacity=sp.sigma_y,
                  margin=sp.sigma_y / sig_d, kind='hard', unit='Pa',
                  formula=f'σ_d=k_bend·{sp.load_n:g}·mg/A_cs ≤ σ_y'))

    a_max = sp.sigma_y * sp.A_cs / (sp.k_bend * sp.m)
    c.append(dict(layer='A2', name='敏捷/跳跃', demand=sp.a_req, capacity=a_max,
                  margin=a_max / sp.a_req, kind='hard', unit='m/s²',
                  formula='a_max=σ_y·A_cs/(k_bend·m) ≥ a_req'))

    waste = (1 - sp.eta) * sp.P_max
    diss = sp.h_eff * sp.A_skin * sp.dT_max
    c.append(dict(layer='D2', name='散热(峰值占空)', demand=waste, capacity=diss,
                  margin=diss / waste, kind='duty', unit='W',
                  formula='(1−η)·P_max ≤ h·A_skin·ΔT_max'))

    if sp.A_disk > 0:
        p_hover = mg ** 1.5 / math.sqrt(2 * RHO_AIR * sp.A_disk)
        c.append(dict(layer='B3', name='悬停推进', demand=p_hover, capacity=sp.P_max,
                      margin=sp.P_max / p_hover, kind='hard', unit='W',
                      formula='P_hover=(mg)^1.5/√(2ρA_disk) ≤ P_max'))
        if sp.v_max > 0:
            Mm = sp.v_max / A_SOUND
            t_stag = T0 * (1 + (GAMMA - 1) / 2 * Mm * Mm)
            c.append(dict(layer='B3', name='气动加热', demand=t_stag, capacity=sp.T_limit,
                          margin=sp.T_limit / t_stag, kind='hard', unit='K',
                          formula='T_stag=T0(1+0.2M²) ≤ T_limit'))

    e_store = sp.fuel_frac * sp.m * sp.e_density
    e_req = sp.P_max * sp.duty_req * sp.t_req / sp.eta
    c.append(dict(layer='D1', name='能量预算', demand=e_req, capacity=e_store,
                  margin=e_store / e_req, kind='hard', unit='J',
                  formula='f·m·e_density ≥ P_max·duty·t_req/η'))
    return c


def feasibility(sp: Spec):
    """总纲接口：feasibility(spec) → {feasible, binding(余量升序), duties, constraints}"""
    con = check(sp)
    hard = [x for x in con if x['kind'] == 'hard']
    duties = {x['name']: x['margin'] for x in con if x['kind'] == 'duty'}
    feasible = (all(x['margin'] >= 1.0 for x in hard)
                and all(v >= sp.duty_req for v in duties.values()))
    binding = sorted(con, key=lambda x: x['margin'])
    return dict(name=sp.name, feasible=feasible, constraints=con,
                binding=binding, duties=duties)


def report(res, title):
    print(f'\n[{title}]  可行={res["feasible"]}')
    print(f'  {"约束(层)":<22}{"需求":>12}{"容量":>12}{"余量":>9}  公式')
    for x in res['binding']:
        flag = '✓' if x['margin'] >= 1 else ('✗硬' if x['kind'] == 'hard' else '✗占空')
        print(f'  {x["name"]+"("+x["layer"]+")":<22}'
              f'{x["demand"]:>10.3g}{x["unit"]:<2}'
              f'{x["capacity"]:>10.3g}{x["unit"]:<2}'
              f'{x["margin"]:>8.3g} {flag}  {x["formula"]}')
    if res['duties']:
        for k, v in res['duties'].items():
            print(f'  → {k}: 峰值可持续占空 = {v*100:.1f}%（<100% 意为只能间歇满功率）')


def calibrate():
    print('== 阶段0 判定器校准（先验尺子，再量设定；断言全非空） ==')
    # ① 岩柱自压极限 vs 珠峰
    L_rock = 200e6 / (2700 * G)
    assert 5000 <= L_rock <= 15000, L_rock
    print(f'  ① 岩柱自压极限 σ_y/ρg = {L_rock/1000:.1f} km  vs 珠峰 8.85 km（同量级 ✓）')
    # ② Mi-26 理想悬停功率（动量理论）vs 装机功率量级
    p_h = (56000 * G) ** 1.5 / math.sqrt(2 * RHO_AIR * math.pi * 16 ** 2)
    assert 5e6 <= p_h <= 12e6, p_h
    print(f'  ② Mi-26(56t,D=32m) 理想悬停功率 = {p_h/1e6:.1f} MW（装机 ~15 MW 级 > 理想 ✓）')
    # ③ 与电池#2 同一阻力模型的终端速度
    v_t = math.sqrt(G / 0.005)
    assert abs(v_t - 44.3) < 0.5, v_t
    print(f'  ③ 终端速度 √(g/k) = {v_t:.1f} m/s（100m 落体不达终端，与电池#2 一致 ✓）')


def main():
    print('=== 灵境 · 耦合可行性判定器（总纲横切红带②：单律过 ≠ 系统可行）===')
    calibrate()

    # 现实基线：人体标定的人形（材料=骨量级，功率=短跑级，能源=电池占比30%）
    human = Spec(name='现实人形基线(人体标定)', L=1.7, m=70.0, sigma_y=130e6,
                 A_cs=6e-4, k_bend=10.0, P_max=2000.0, eta=0.25, h_eff=15.0,
                 A_skin=1.8, dT_max=30.0, A_disk=0.0, v_max=0.0, T_limit=400.0,
                 e_density=0.9e6, fuel_frac=0.3, t_req=3600.0, duty_req=0.2,
                 a_req=9.81, load_n=3.0)
    res_h = feasibility(human)
    assert res_h['feasible'], '现实人体尺度必须可行（校准锚点④）'
    m_dyn = next(x for x in res_h['constraints'] if x['name'].startswith('动态'))
    assert 2 <= m_dyn['margin'] <= 6, m_dyn['margin']  # 动态骨应力余量 ~3.8×（量级正确）
    report(res_h, '阶段1 现实人形（校准锚点④：短跑必然过热、动态余量≈4×——真实）')

    # 百米巨人：几何×(100/1.7)，保留幻想设定"高速飞行"（加 30%L² 盘面积 + 100 m/s）
    s = 100 / 1.7
    giant = scale(human, s)
    giant = replace(giant, name='百米巨人(几何相似+飞行设定)',
                    A_disk=0.3 * (100.0 ** 2), v_max=100.0)
    res_g = feasibility(giant)
    assert not res_g['feasible'], '百米巨人必须不可行（平方-立方律）'
    assert len(res_g['binding']) == 7
    report(res_g, '阶段2 百米巨人（幻想设定联立判定）')
    print('  瓶颈升序：' + ' → '.join(
        f'{x["name"]}({x["margin"]:.3g})' for x in res_g['binding'] if x['margin'] < 1))

    # 阶段3 尺度扫描：余量随 s 的幂律（平方-立方律的数值复现）
    print('\n[阶段3] 尺度扫描（几何相似，余量=容量/需求；<1 不可行）')
    print(f'  {"L(m)":>6}{"静态":>9}{"动态":>9}{"敏捷":>9}{"散热":>9}{"悬停":>9}')
    base = {x['name']: x['margin'] for x in res_h['constraints']}
    m0_flight = human.P_max / ((human.m * G) ** 1.5 / math.sqrt(2 * RHO_AIR * 0.3 * human.L ** 2))
    rows = []
    for s_ in (1.0, 3.0, 10.0, 30.0, s, 2 * s):
        sp = scale(human, s_)
        sp = replace(sp, A_disk=0.3 * sp.L ** 2)
        mm = {x['name']: x['margin'] for x in check(sp)}
        p_f = sp.P_max / ((sp.m * G) ** 1.5 / math.sqrt(2 * RHO_AIR * sp.A_disk))
        rows.append((sp.L, mm['静态自压'], mm['动态结构(步态/冲击)'],
                     mm['敏捷/跳跃'], mm['散热(峰值占空)'], p_f))
        print(f'  {sp.L:>6.1f}{mm["静态自压"]:>9.3g}{mm["动态结构(步态/冲击)"]:>9.3g}'
              f'{mm["敏捷/跳跃"]:>9.3g}{mm["散热(峰值占空)"]:>9.3g}{p_f:>9.3g}')
    # 幂律自检（公式是纯幂律，必须精确成立）
    L1, *rest = rows
    for i, (col, p_exp) in enumerate(zip(range(1, 6), (-1, -1, -1, -1, -0.5))):
        r = rows[-1][col] / L1[col]
        s_ratio = (rows[-1][0] / L1[0])
        assert abs(r - s_ratio ** p_exp) / (s_ratio ** p_exp) < 1e-9, (col, r)
    print('  幂律自检：静态/动态/敏捷/散热余量∝1/s、悬停∝1/s^0.5 —— 精确成立 ✓')

    print('\n结论：')
    print('  · 现实人形可行，但散热峰值占空仅 54%（短跑必然过热）——判定器复现真实人体极限。')
    print(f'  · 百米巨人不可行，瓶颈序列：散热({res_g["duties"]["散热(峰值占空)"]*100:.1f}%占空) → '
          '悬停推进 → 动态结构 → 敏捷(a_max≈1.9<g，连跳跃都做不到)。')
    print('  · 反直觉两点（诚实）：① 静态自压在百米级余量仍有 1.9×——"巨人自己压垮自己"'
          '在静态下不成立，先死的是热/敏捷/动载；② 能源等比放大后能量余量 3.3× 不变'
          '——装无限电池救不了，锁死它的是热与结构（总纲耦合轴结论的数值复现）。')
    print('  · 静态自压约 L≈194m(骨量级、双腿细柱)才 binding——远低于实心岩柱 7.6km，'
          '因为细腿承载截面只占 0.02%L²（1/A_frac 放大）。')
    print('\n诚实边界：k_bend=10、散热系数、材料牌号均为标定量级的待测系数——'
          '它们只影响余量数值，不影响瓶颈的尺度结论（∝1/s 由几何决定，已幂律自检）；'
          '本判定器是先验可行性筛选，不是 FEM；真实材料系数须实测（休谟欠定不变）。')


if __name__ == '__main__':
    main()
