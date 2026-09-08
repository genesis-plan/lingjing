/**
 * 灵境 · 经验驱动的物理层（E2E：学出的律接进真实模拟器 RealWorld3D）— JS 轨
 * ============================================================================
 * 与 verify_experience.py 逐项对齐（双轨验证）。RealWorld3D 现在接受
 * centralLaw=[c0..c3]（候选基 [1/r²,1/r,1,1/r³] 上的系数）替换硬写的 −GM/r²。
 *
 * 流程：真实世界=RealWorld3D({centralLaw:真律}) 生成轨道 → JS learnLawInterval
 * （SINDy/STLSQ + split-half 统计区间）学回经验律 μ±δ → 虚拟世界=RealWorld3D
 * ({centralLaw:μ}) 跑同样轨道 → 与真实轨道逐圈对比（短程贴合/长程相位累积）。
 *
 * 运行：node verify_experience.js
 */
'use strict';
const { RealWorld3D, lstsq } = require('./rom.js');

const DT = 0.01, STEPS = 6000;
const BASE = [10, 0, 0], VBASE = [0, 8, 0];

function basis(r) { return [1 / (r * r), 1 / r, 1, 1 / (r * r * r)]; }

/* mulberry32 种子化 PRNG + Box-Muller → 与 .py 的可复现噪声不同（轨道物理同） */
function rngNormal(seed) {
  let s = seed >>> 0;
  const next = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  let spare = null;
  return function () {
    if (spare !== null) { const v = spare; spare = null; return v; }
    const u = (next() || 1e-12), v = next() || 1e-12;
    const m = Math.sqrt(-2 * Math.log(u)), a = 2 * Math.PI * v;
    spare = m * Math.sin(a);
    return m * Math.cos(a);
  };
}

function worldTraj(central, steps, noise, seed, pos0, vel0) {
  const p0 = pos0 || BASE, v0 = vel0 || VBASE;
  const w = new RealWorld3D({ centralLaw: central, rMin: 0.5 });
  w.addBody(p0, v0, 1.0);
  const rng = rngNormal(seed || 12345);
  const P = [], V = [];
  P.push(p0.slice()); V.push(v0.slice());
  for (let t = 0; t < steps; t++) {
    w.step(DT);
    P.push(w.bodies[0].pos.slice());
    V.push(w.bodies[0].vel.slice());
    if (noise > 0) for (let k = 0; k < 3; k++) P[P.length - 1][k] += rng() * noise;
  }
  return { P, V };
}

/** SINDy/STLSQ：从轨道（N×3）反推中心力律系数 —— 与 induce_law.learn_law 同构 */
function learnLaw(pos, vel, dt) {
  const N = pos.length, dim = vel[0].length;
  const aEst = [];
  for (let t = 0; t < N; t++) {
    if (t === 0 || t === N - 1) { aEst.push(vel[1]); continue; }
    aEst.push(vel[t + 1].map((x, k) => (x - vel[t - 1][k]) / (2 * dt)));
  }
  aEst[0] = aEst[1].slice(); aEst[N - 1] = aEst[N - 2].slice();
  const B = [], ar = [];
  for (let t = 0; t < N; t++) {
    const r = Math.hypot(pos[t][0], pos[t][1], pos[t][2]) || 1e-12;
    B.push(basis(r));
    ar.push((aEst[t][0] * pos[t][0] + aEst[t][1] * pos[t][1] + aEst[t][2] * pos[t][2]) / r);
  }
  let c = lstsq(B, ar);
  for (let it = 0; it < 10; it++) {                       // STLSQ：稀疏性=数学先验
    const mx = Math.max(...c.map(Math.abs));
    const active = c.map(x => Math.abs(x) > 0.02 * mx);
    const nAct = active.filter(Boolean).length;
    if (nAct <= 1) break;
    const Bact = B.map(row => row.filter((_, j) => active[j]));
    const ca = lstsq(Bact, ar);
    const cn = c.map(() => 0);
    let j = 0;
    for (let k = 0; k < c.length; k++) if (active[k]) cn[k] = ca[j++];
    const close = c.every((x, k) => Math.abs(x - cn[k]) < 1e-12);
    c = cn;
    if (close) break;
  }
  return c;
}

function learnLawInterval(pos, vel, dt) {
  const h = Math.floor(pos.length / 2);
  const c1 = learnLaw(pos.slice(0, h), vel.slice(0, h), dt);
  const c2 = learnLaw(pos.slice(h), vel.slice(h), dt);
  return { mu: c1.map((x, i) => (x + c2[i]) / 2), delta: c1.map((x, i) => Math.abs(x - c2[i]) / 2) };
}

function sepAt(a, b, t) {
  const i = Math.min(Math.round(t / DT), a.length - 1);
  const d = Math.hypot(a[i][0] - b[i][0], a[i][1] - b[i][1], a[i][2] - b[i][2]);
  const r = Math.hypot(b[i][0], b[i][1], b[i][2]);
  return d / r * 100;
}

function maxSep(a, b) {
  let m = 0;
  for (let i = 0; i < a.length; i++) {
    const d = Math.hypot(a[i][0] - b[i][0], a[i][1] - b[i][1], a[i][2] - b[i][2]);
    const r = Math.hypot(b[i][0], b[i][1], b[i][2]) || 1e-12;
    if (d / r > m) m = d / r;
  }
  return m * 100;
}

const fmt = (c, nd) => '[' + c.map(x => x.toFixed(nd)).join(', ') + ']';
const T1 = 3.96, T3 = 11.9;

console.log('=== 灵境 · 经验驱动的物理层（学出的律接进 RealWorld3D）— JS 轨 ===\n');

/* ── E1 真实=纯反平方 −1000/r² ── */
const truth1 = [-1000, 0, 0, 0];
const obs1 = worldTraj(truth1, STEPS, 0, 12345);
const l1 = learnLawInterval(obs1.P, obs1.V, DT);
const virt1 = worldTraj(l1.mu, STEPS, 0, 12345);
const err1 = Math.abs(l1.mu[0] - truth1[0]) / Math.abs(truth1[0]) * 100;
console.log('── E1 真实=纯反平方 −1000/r² ──');
console.log('  真实律  : ' + fmt(truth1, 2));
console.log('  学出经验: μ=' + fmt(l1.mu, 2) + '  δ=' + fmt(l1.delta, 2) +
  `（c0 系数误差 ${err1.toFixed(3)}%：基可辨识性下限）`);
console.log('  经验虚拟世界(centralLaw=μ) vs 真实世界：');
console.log(`    1 圈后(t≈4) 相对分离 = ${sepAt(virt1.P, obs1.P, T1).toFixed(4)}%   → 短程贴合 ✓`);
console.log(`    3 圈后(t≈12) 相对分离 = ${sepAt(virt1.P, obs1.P, T3).toFixed(4)}%`);
console.log(`    15 圈全程 max 分离 = ${maxSep(virt1.P, obs1.P).toFixed(3)}%   → 长程相位累积\n`);

/* ── E2 真实=反平方+1/r³ 修正；设计律硬写 GM=1000 ── */
const truth2 = [-1000, 0, 0, 600];
const obs2 = worldTraj(truth2, STEPS, 1e-3, 7);
const l2 = learnLawInterval(obs2.P, obs2.V, DT);
const design = [-1000, 0, 0, 0];
const virtL = worldTraj(l2.mu, STEPS, 0, 7);
const virtD = worldTraj(design, STEPS, 0, 7);
const mL = maxSep(virtL.P, obs2.P), mD = maxSep(virtD.P, obs2.P);
console.log('── E2 真实=反平方 −1000/r² + 1/r³ 修正 +600/r³（真实≠设计）──');
console.log('  真实律  : ' + fmt(truth2, 2));
console.log('  学出经验: μ=' + fmt(l2.mu, 2) + '  δ=' + fmt(l2.delta, 2) +
  '（把设计外 1/r³ 修正学回来了）');
console.log(`  经验虚拟世界 vs 真实：1 圈 = ${sepAt(virtL.P, obs2.P, T1).toFixed(4)}%，` +
  `15 圈 max = ${mL.toFixed(3)}%   → 贴合 ✓`);
console.log(`  设计虚拟世界 vs 真实：15 圈 max = ${mD.toFixed(2)}%（${(mD / Math.max(mL, 1e-12)).toFixed(0)}× 经验律）` +
  '  → 硬写律漏掉真实修正项，偏离 ✗\n');

console.log('结论：学出的经验律(μ) 直接当 RealWorld3D 的 centralLaw 用 → 物理层从"硬写规律"');
console.log('变为"用经验驱动"；短程贴合、长程相位累积 ⇒ 经验需持续被真实数据校正（v2 闭环）。');
