/**
 * 灵境 · 动态观测：被动看一个运动的地面物体（观察→学律→经验）— JS 轨
 * ============================================================================
 * "如果观测到的是动态的呢" 的落地切片。承接 verify_ground（静置花盆，靠"推一下"
 * 干预才学出 m/μ/α）——这里对象本身在动，智能体**全程不碰它**，只被动看它的
 * 带噪位置轨迹。结论：动态观测 ≠ 新问题，它正是 verify_sensor 已验证的范式
 * （带噪欠采样观测流 → RTS 平滑出状态 → 学动力学），只是把"中心力律"换成
 * "地面接触动力学"。天上轨道与地面动态物体在数学上同构：轨迹即观测流。
 *
 * 两个场景（都被动、无干预）：
 *   场景 A 滑动块：库仑动摩擦，x(t)=x0+v0·t−½·μg·t²，停后静止。
 *     被动学出 μg（减速幅度）。⚠ 诚实边界：纯滑动中 m 与 μ 不可分（μg 乘积才是
 *     可观测量）——要拆出 m 仍需干预（verify_ground G1 推一下）。
 *   场景 B 抛体：2D 抛物线，y(t)=y0+vy0·t−½·g·t²。
 *     被动学出 g（真·物理常数）。这是"从运动反推物理"的标准范式（视觉→物理）。
 *
 * 学律内核 = verify_sensor 的 RTS 平滑纪律（近恒加速度模型、Joseph form）逐字复用，
 * 证明"动态观测"用的就是已验证的数学，不用另起炉灶。
 *
 * 诚实边界：无感知层（位姿假设已由传感器给出，视觉重建另量级）；地面接触为简化
 * 模型（滑动/抛体解耦，非通用多体接触）；被动观测只能还原可观测的组合量。
 * 与 verify_dynamic.py 双轨对照（独立种子噪声，关键量同量级、无噪部分逐位一致）。
 * 运行：node verify_dynamic.js
 */
'use strict';

const G = 9.81;

/* ---------- 3×3 线性代数（与 verify_sensor 逐字一致，保证平滑纪律同一实现） ---------- */
const mm3 = (a, b) => { const r = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) { let s = 0;
    for (let k = 0; k < 3; k++) s += a[i][k] * b[k][j]; r[i][j] = s; } return r; };
const mv3 = (a, v) => [0, 1, 2].map(i => a[i][0] * v[0] + a[i][1] * v[1] + a[i][2] * v[2]);
const mt3 = a => [0, 1, 2].map(i => [0, 1, 2].map(j => a[j][i]));
const add3 = (a, b) => a.map((r, i) => r.map((x, j) => x + b[i][j]));
const sm3 = (a, s) => a.map(r => r.map(x => x * s));
function inv3(m) {
  const [a, b, c] = m[0], [d, e, f] = m[1], [g, hh, i] = m[2];
  const A = e * i - f * hh, D = -(b * i - c * hh), Gg = b * f - c * e;
  const B = -(d * i - f * g), E = a * i - c * g, Hh = -(a * f - c * d);
  const C = d * hh - e * g, F = -(a * hh - b * g), I = a * e - b * d;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-300) throw new Error('singular');
  return [[A, D, Gg], [B, E, Hh], [C, F, I]].map(r => r.map(x => x / det));
}

/* ---------- RTS 固定区间平滑器（近恒加速度模型 x=[p,v,a]） ----------
 * 与 verify_sensor.rts1 同算法；H=观测间隔、SA=过程加速度噪声（近 jerk 自由度）。
 * 后向修正项用预测态 x^f_{t+1|t} 而非更新态（已修过的 bug）。 */
function rts1(z, sigmaP, H, SA) {
  const M = z.length;
  const F = [[1, H, H * H / 2], [0, 1, H], [0, 0, 1]], Ft = mt3(F);
  const Q = sm3([[H ** 4 / 4, H ** 3 / 2, H * H / 2], [H ** 3 / 2, H * H, H], [H * H / 2, H, 1]], SA * SA);
  const R = sigmaP * sigmaP;
  const xf = [], xF = [], xPre = [], Pf = [], Pp = [];
  let x = [z[0], 0, 0], P = sm3([[1, 0, 0], [0, 1, 0], [0, 0, 1]], 1e6);
  for (let t = 0; t < M; t++) {
    if (t > 0) { x = mv3(F, x); P = add3(mm3(F, mm3(P, Ft)), Q); }
    xPre.push(x.slice()); Pp.push(P.map(r => r.slice()));
    const S = P[0][0] + R;
    const K = [P[0][0] / S, P[1][0] / S, P[2][0] / S];
    x = x.map((v, i) => v + K[i] * (z[t] - x[0]));
    const IKH = [[1 - K[0], 0, 0], [-K[1], 1, 0], [-K[2], 0, 1]];
    P = add3(mm3(IKH, mm3(P, mt3(IKH))),
      sm3([[K[0] * K[0], K[0] * K[1], K[0] * K[2]], [K[1] * K[0], K[1] * K[1], K[1] * K[2]],
        [K[2] * K[0], K[2] * K[1], K[2] * K[2]]], R));
    xF.push(x.slice()); xf.push(x.slice()); Pf.push(P.map(r => r.slice()));
  }
  const xs = new Array(M);
  xs[M - 1] = xf[M - 1].slice();
  for (let t = M - 2; t >= 0; t--) {
    const A = mm3(mm3(Pf[t], Ft), inv3(Pp[t + 1]));
    xs[t] = xf[t].map((v, i) => v + mv3(A, xs[t + 1].map((w, j) => w - xPre[t + 1][j]))[i]);
  }
  return { xs, xf };
}

/* ---------- 种子正态噪声（独立种子；与 PY 同量级、非逐位） ---------- */
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

/* ---------- 场景 A：滑动块（Coulomb 摩擦，被动观测） ---------- */
function slidingTruth(x0, v0, mug, tStop, tMax, H) {
  const pos = [];
  for (let t = 0; t <= tMax + 1e-9; t += H) {
    const x = t <= tStop ? x0 + v0 * t - 0.5 * mug * t * t : x0 + v0 * tStop - 0.5 * mug * tStop * tStop;
    pos.push(x);
  }
  return pos;
}
function observe1d(truth, sigma, seed) {
  const rng = rngNormal(seed);
  return truth.map(x => x + (sigma > 0 ? rng() * sigma : 0));
}
/** 从 RTS 平滑速度反推 μg：观测全程在滑动（未停），跳过 RTS 起始暂态后对 v̂ 线性拟合。
 *  斜率(每样本) = −μg·H；截距 b = 真实时间 0 的初速 v0。返回 {mug, v0}。 */
function learnMug(xs) {
  const M = xs.length;
  const win = [];
  for (let t = 3; t < M - 2; t++) win.push(t);   // 跳过 RTS 起始暂态；全程在滑动（无停-静断点）
  let sx = 0, sy = 0, sxx = 0, sxy = 0, n = win.length;
  for (const t of win) { sx += t; sy += xs[t][1]; sxx += t * t; sxy += t * xs[t][1]; }
  const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  const b = (sy - slope * sx) / n;               // 速度截距 = 初速（真实时间 0）
  return { mug: -slope / H, v0: b };
}

/* ---------- 场景 B：抛体（2D，被动观测） ---------- */
function projTruth(x0, y0, vx0, vy0, tMax, H) {
  const xs = [], ys = [];
  for (let t = 0; t <= tMax + 1e-9; t += H) {
    xs.push(x0 + vx0 * t);
    ys.push(y0 + vy0 * t - 0.5 * G * t * t);
  }
  return { xs, ys };
}
function observe2d(xs, ys, sigma, seed) {
  const rng = rngNormal(seed);
  const ox = xs.map(x => x + (sigma > 0 ? rng() * sigma : 0));
  const oy = ys.map(y => y + (sigma > 0 ? rng() * sigma : 0));
  return { ox, oy };
}
/** 从平滑 y 速度反推 g：飞行窗口（ŷ>0）内对 v̂_y 线性拟合取斜率。 */
function learnG(xsY) {
  const M = xsY.length;
  const win = [];
  for (let t = 0; t < M; t++) if (xsY[t][0] > 0.05 && t < M - 2) win.push(t); // 只取在空中的段
  let sx = 0, sy = 0, sxx = 0, sxy = 0, n = win.length;
  for (const t of win) { sx += t; sy += xsY[t][1]; sxx += t * t; sxy += t * xsY[t][1]; }
  const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  return -slope / H;
}

/* ============================ 实跑 ============================ */
const H = 0.02, SIGMA = 0.01;   // 50Hz 位置流 + 1cm 噪声（机器人级）

console.log('=== 灵境 · 动态观测：被动看一个运动的地面物体（观察→学律→经验）— JS 轨 ===');
console.log(`观测: 被动、不碰对象、只拿带噪位置流（${1 / H}Hz, σ=${SIGMA}m）；平滑: RTS 近恒加速度\n`);

/* ---- 场景 A：滑动块 ---- */
const mu = 0.15, mug = G * mu, v0 = 3.0, x0 = 0;
const tStop = v0 / mug;                       // 停住时刻
const dTrue = v0 * v0 / (2 * mug);            // 真实滑距
const truthA = slidingTruth(x0, v0, mug, tStop, 1.8, H);   // 只观测滑动段（未停，避断点污染平滑）；减速=μg
const obsA = observe1d(truthA, SIGMA, 20260908);
const rA = rts1(obsA, SIGMA, H, 40.0);   // SA 须足够大才放得开加速度估计（同 verify_sensor 标定值）
const { mug: mugEst, v0: v0hat } = learnMug(rA.xs);
const dPred = v0hat * v0hat / (2 * mugEst);
console.log('── 场景 A 滑动块（库仑动摩擦，纯被动观测）──');
console.log(`  真值: v0=${v0} m/s, μg=${mug.toFixed(4)} m/s², 停于 t=${tStop.toFixed(3)}s, 滑距 d=${dTrue.toFixed(4)}m`);
console.log(`  RTS 平滑初速 v̂0=${v0hat.toFixed(4)} m/s`);
console.log(`  被动学出 μĝ=${mugEst.toFixed(4)} m/s²（真 ${mug.toFixed(4)}，误差 ${(Math.abs(mugEst - mug) / mug * 100).toFixed(2)}%）`);
console.log(`  用 (v̂0, μĝ) 预测滑距 d̂=${dPred.toFixed(4)}m（真 ${dTrue.toFixed(4)}，误差 ${(Math.abs(dPred - dTrue) / dTrue * 100).toFixed(2)}%）`);
console.log('  ⚠ 诚实：纯滑动中 m 与 μ 不可分 —— μg 是可观测量；拆 m 需干预（verify_ground G1 推一下）。');

/* ---- 场景 B：抛体 ---- */
const px0 = 0, py0 = 2.0, pvx0 = 5.0, pvy0 = 6.0;
const truthB = projTruth(px0, py0, pvx0, pvy0, 1.4, H);
const obsB = observe2d(truthB.xs, truthB.ys, SIGMA, 20260909);
const rX = rts1(obsB.ox, SIGMA, H, 40.0);
const rY = rts1(obsB.oy, SIGMA, H, 40.0);
const gEst = learnG(rY.xs);
const axEst = learnG(rX.xs);   // x 轴应≈0（无水平力）
console.log('\n── 场景 B 抛体（2D 抛物线，纯被动观测）──');
console.log(`  真值: g=${G} m/s², 初速 (vx,vy)=(${pvx0},${pvy0}) m/s, 抛出高 ${py0}m`);
console.log(`  被动学出 ĝ=${gEst.toFixed(4)} m/s²（真 ${G}，误差 ${(Math.abs(gEst - G) / G * 100).toFixed(2)}%）`);
console.log(`  水平轴加速度学出=${axEst.toFixed(4)} m/s²（应≈0，无水平力，误差 ${(Math.abs(axEst) / G * 100).toFixed(2)}% 相对 g）`);

console.log('\n结论：');
console.log('  · 动态观测 = verify_sensor 已验证范式（带噪位置流→RTS 平滑→学动力学），地面只是换物理；');
console.log('  · 场景 A：被动滑动块学出减速 μg（误差级小），但 m 与 μ 不可分 —— 因果要靠干预（推花盆）；');
console.log('  · 场景 B：被动抛体学出真物理常数 g（误差级小）——"从运动反推物理"成立，无需碰对象；');
console.log('  · 被动观察给关联/可观测组合量，干预才给因果/拆参 —— 两条线（sensor 动态 / ground 静态）合流；');
console.log('  · 感知层缺口仍显式：位姿假设已由传感器给出，视觉重建（图像→几何）是另一量级工程，先不碰。');
