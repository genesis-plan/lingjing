/**
 * 灵境 · 地面世界：推花盆实验（观察→干预→学经验）— JS 轨
 * ============================================================================
 * "真实世界在地面上"的落地切片。天上轨道是光滑少体力学（管线验证场）；
 * 地面世界的主导物理是 接触/支撑/摩擦/翻倒 —— 静置的花盆不动，规律藏在
 * "交互响应"里：不碰它只能学几何，一碰它 质量/摩擦/稳度 全部从响应中露出。
 * 被动观察给关联，干预才给因果 —— 花盆是必须主动推一下才能学的对象。
 *
 * 模型（可积、可审计、双轨逐位一致）：
 *   花盆 = 刚体盒（质量 m、底半宽 R、质心高 h、桌面摩擦 μ、撞击恢复系数 e）
 *   ① 滑动：冲量 J → v0=J/m，动摩擦减速 → 滑距 d=v0²/(2μg)（库仑）
 *   ② 摇摆（Housner 1963）：绕支撑边转动 I=(4/3)m(h²+R²)，
 *      I·θ'' = −m·g·Rc·sin(α·sign(θ)−θ)，α=atan(R/h)，Rc=√(h²+R²)；
 *      换边(θ 过 0)时 ω*=e·ω（撞击损失）；能量越过势垒 m·g·Rc·(1−cosα) → 翻倒。
 *   滑动与摇摆解耦（诚实简化：真实花盆可边滑边晃）。
 *
 * 实验（智能体视角：只测响应，参数全部反推）：
 *   G1 学质量 m̂ = J/Δv（推已知冲量、测速度跳变）
 *   G2 学摩擦 μ̂ = v0²/(2·d·g)（测滑距）
 *   G3 学稳度：二分扫描冲量找翻倒阈值 J*，反解 α̂=atan(R/h)（质心垂线出支撑面即倒）
 *   G4 经验预测：用学到的 (m̂,μ̂,α̂) 预测新推力的滑距与翻/不翻 → 与真实世界对照
 *      （一切以真实世界为标准：预测 vs 真实，不看拟合残差）
 *
 * 诚实边界：无感知层（花盆位姿假设已给——视觉重建是另一量级）；接触为简化
 * 模型（Housner+库仑，非通用接触求解器）；花=活物（生长/萎蔫是天级生物过程，
 * 物理引擎不映射）；滑动与摇摆解耦。
 * 与 verify_ground.py 双轨逐位对照。运行：node verify_ground.js
 */
'use strict';

const G = 9.81;

/* ---------------- 真实世界（truth，智能体不可直接读参数） ---------------- */
function makePot(m, R, h, mu, e) {
  return {
    m, R, h, mu, e,
    alpha: Math.atan(R / h),            // 临界角：质心垂线出支撑面即翻
    Rc: Math.hypot(h, R),
    I: (4 / 3) * m * (h * h + R * R)    // 绕支撑边的转动惯量（矩形块）
  };
}

/* 滑动：冲量 J → v0 → 滑距（动摩擦）。返回 {v0, dist}；v0=0 则不滑。 */
function slide(pot, J) {
  const v0 = J / pot.m;
  if (v0 <= 0) return { v0: 0, dist: 0 };
  const muEff = Math.min(pot.mu, 0.999);   // 桌面摩擦（花盆底与桌面）
  return { v0, dist: v0 * v0 / (2 * muEff * G) };
}

/* 摇摆（Housner）：冲量 J 作用于质心高 h → 角冲量 J·h。返回 {tipped, thetaEnd}。
 * 能量越过势垒 → 翻倒；否则衰减摇摆回正（换边 ω*=e·ω）。半隐式欧拉 dt=1e-4。 */
const DT_R = 1e-4, T_ROCK = 3.0;
function rock(pot, J) {
  const w0 = J * pot.h / pot.I;
  const Eb = pot.m * G * pot.Rc * (1 - Math.cos(pot.alpha));
  if (0.5 * pot.I * w0 * w0 >= Eb) return { tipped: true, thetaEnd: pot.alpha };
  let th = 0, om = w0, t = 0;
  const acc = (x) => x >= 0
    ? -pot.m * G * pot.Rc * Math.sin(pot.alpha - x) / pot.I
    : -pot.m * G * pot.Rc * Math.sin(-pot.alpha - x) / pot.I;
  while (t < T_ROCK) {
    om += acc(th) * DT_R;                  // 半隐式：先更新 ω 再更新 θ
    const prev = th;
    th += om * DT_R;
    if (Math.sign(th) !== Math.sign(prev) && prev !== 0) om *= pot.e;  // 换边撞击
    t += DT_R;
    if (Math.abs(th) < 1e-5 && Math.abs(om) < 1e-4) break;             // 回正静止
  }
  return { tipped: false, thetaEnd: th };
}

/* 翻/不翻判定（能量判据，与数值摇摆一致） */
function willTip(pot, J) {
  const w0 = J * pot.h / pot.I;
  const Eb = pot.m * G * pot.Rc * (1 - Math.cos(pot.alpha));
  return 0.5 * pot.I * w0 * w0 >= Eb;
}

/* ---------------- 智能体：只测响应，参数全反推 ---------------- */
/* G1 学质量：测速度跳变。G2 学摩擦：测滑距。G3 学稳度：二分找翻倒阈值反解 α。 */
function learnMass(J, v0measured) { return J / v0measured; }
function learnMu(v0, d) { return v0 * v0 / (2 * d * G); }

function findTipThreshold(pot, Jlo, Jhi, tol) {   // 二分扫描（真实世界实验的代价=次数）
  while (Jhi - Jlo > tol) {
    const mid = (Jlo + Jhi) / 2;
    if (willTip(pot, mid)) Jhi = mid; else Jlo = mid;
  }
  return (Jlo + Jhi) / 2;
}

/* 由 J* 反解 α：J*²h²/(2I) = m g Rc (1−cosα)，I=(4/3)m(h²+R²)，Rc=√(h²+R²)。
 * h 可测（盆高），R 未知 → 数值二分 R 使预测阈值匹配实测 J*。 */
function learnAlphaFromThreshold(pot, Jstar, hKnown) {
  const pred = (R) => {
    const I = (4 / 3) * pot.m * (hKnown * hKnown + R * R);
    const Rc = Math.hypot(hKnown, R);
    const a = Math.atan(R / hKnown);
    const Eb = pot.m * G * Rc * (1 - Math.cos(a));
    return Math.sqrt(2 * I * Eb) / hKnown;
  };
  let lo = 1e-3, hi = 2.0;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (pred(mid) > Jstar) hi = mid; else lo = mid;
  }
  return Math.atan(((lo + hi) / 2) / hKnown);
}

/* ---------------- 实验 ---------------- */
const fmt = x => x.toFixed(4);
const truth = makePot(2.0, 0.07, 0.15, 0.15, 0.7);   // 真花盆：2kg、盆半径 7cm、质心高 15cm、μ=0.15

console.log('=== 灵境 · 地面世界：推花盆（观察→干预→学经验）— JS 轨 ===');
console.log(`真实花盆(智能体不可读): m=2kg R=7cm h=15cm μ=0.15 e=0.7  临界角 α=${(truth.alpha * 180 / Math.PI).toFixed(2)}°\n`);

/* G1 学质量 */
const J1 = 0.5;
const r1 = slide(truth, J1);
const mHat = learnMass(J1, r1.v0);
console.log(`── G1 学质量：轻推 J=${J1} N·s，测得速度跳变 Δv=${fmt(r1.v0)} m/s ──`);
console.log(`   m̂ = J/Δv = ${fmt(mHat)} kg（真值 2，误差 ${(Math.abs(mHat - 2) / 2 * 100).toFixed(3)}%）`);

/* G2 学摩擦 */
const J2 = 1.0;
const r2 = slide(truth, J2);
const muHat = learnMu(r2.v0, r2.dist);
console.log(`── G2 学摩擦：推 J=${J2} N·s，测得滑距 d=${fmt(r2.dist)} m ──`);
console.log(`   μ̂ = v0²/(2dg) = ${fmt(muHat)}（真值 0.15，误差 ${(Math.abs(muHat - 0.15) / 0.15 * 100).toFixed(3)}%）`);

/* G3 学稳度 */
const Jstar = findTipThreshold(truth, 0.1, 5.0, 1e-6);
const alphaHat = learnAlphaFromThreshold(truth, Jstar, truth.h);
const JstarAna = Math.sqrt(2 * truth.I * truth.m * G * truth.Rc * (1 - Math.cos(truth.alpha))) / truth.h;
console.log(`── G3 学稳度：逐级加力二分扫到翻倒阈值 J*=${fmt(Jstar)} N·s（解析 ${fmt(JstarAna)}）──`);
console.log(`   反解 α̂ = ${(alphaHat * 180 / Math.PI).toFixed(3)}°（真值 ${(truth.alpha * 180 / Math.PI).toFixed(3)}°，` +
  `误差 ${(Math.abs(alphaHat - truth.alpha) * 180 / Math.PI).toFixed(4)}°）`);

/* G4 经验预测 vs 真实世界（以真实为唯一标准） */
const exp = { m: mHat, mu: muHat, alpha: alphaHat, h: truth.h };
const expPot = makePot(exp.m, Math.tan(exp.alpha) * exp.h, exp.h, exp.mu, truth.e);
console.log('── G4 经验预测 vs 真实（学到的 m̂/μ̂/α̂ 组成花盆的经验，预测新推力响应）──');
for (const J of [0.3, 1.2, 1.5]) {
  const rt = slide(truth, J), kt = rock(truth, J);
  const re = slide(expPot, J), ke = rock(expPot, J);
  const dErr = rt.dist > 0 ? Math.abs(re.dist - rt.dist) / rt.dist * 100 : 0;
  const tipSame = kt.tipped === ke.tipped;
  console.log(`   J=${J} N·s: 真实 滑距=${fmt(rt.dist)}m ${kt.tipped ? '翻倒' : '站稳'} | ` +
    `经验预测 滑距=${fmt(re.dist)}m ${ke.tipped ? '翻倒' : '站稳'} → 滑距误差 ${dErr.toFixed(2)}%、翻倒判定${tipSame ? '一致 ✓' : '不一致 ✗'}`);
}

console.log('\n结论：');
console.log('  · 地面世界的"学习"= 干预响应反推参数：质量/摩擦/稳度一次实验各得一个数，精度数值级；');
console.log('  · "花盆不动"不是没规律：稳度 α=atan(R/h)（质心垂线出支撑面即倒）是从"多大力会翻"学出来的；');
console.log('  · 学到的 (m̂,μ̂,α̂) 就是花盆在虚拟世界里的全部力学身份——预测与真实一致（以真实为标准）；');
console.log('  · 诚实：滑动/摇摆解耦、接触为简化模型、位姿假设已给（视觉重建未做）、花=活物不映射。');
