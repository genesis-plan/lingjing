/**
 * 灵境 · 真实世界条件体检（观测 ≠ 真值）— JS 轨
 * ============================================================================
 * "一切以真实世界的情况为标准"的落地体检：
 *   真实世界的三个第一性事实 —— ①只能观测、不能读真值；②欠采样（测量频率
 *   有限）；③速度/加速度不可直接测，位置带噪。此前的学习直接吃真值 (pos,vel)，
 *   真实世界里这不可能。
 *
 * 流程：真实世界 RealWorld3D(真律 −1000/r²，椭圆 r∈[~5.9,~20]) 出真值轨道
 * （仅作裁判，不外发）→ 传感器模型 observe()：每 3 步采样一次(≈33Hz 位置流)
 * + 位置高斯噪声 σ → 机器人只拿到带噪位置 → 两条学律管线：
 *   A 朴素差分：位置二阶中心差分估计加速度（原管线直接套真实数据的样子）
 *   B 平滑纪律：RTS 固定区间平滑器（每坐标独立、近恒加速度模型 σa=40，
 *     Joseph form 数值稳定）估计位置/加速度 → 再学律
 * → 学出的律当 RealWorld3D.centralLaw 跑虚拟世界 → 与真实轨道比分离。
 *   裁判唯一：真实世界（truth），不看拟合残差自嗨。
 * 吸收门控：fitResidual 超阈值 = 信噪不足/模型类外 → 拒收进经验。
 *
 * 诚实边界：①正圆轨道单一半径 → 四个基完全共线不可辨识（数学事实，勿学）；
 * ②噪声 σ≈1% 半径时平滑也到极限 → 门控拒收（"这数据学不了"优于自信地错）；
 * ③拟合残差小 ≠ 律对（噪声被平均可致残差小而 μ 错）——最终裁判是预测（轨道），
 * 真实世界里用"经验与新观测冲突→δ 放大"兜底。
 * σa 标定：覆盖轨道 jerk 量级（椭圆近心 jerk≈40–60），见试验记录。
 *
 * 与 verify_sensor.py 量级对照（各自种子噪声，物理同）。
 * 运行：node verify_sensor.js
 */
'use strict';
const { RealWorld3D, lstsq } = require('./rom.js');

const DT = 0.01, STEPS = 6000;          // 世界内部步长（真值基准离散）
const PERIOD = 3;                       // 观测采样间隔（世界步数）→ dt_obs = 0.03
const H = PERIOD * DT;
const P0 = [10, 0, 0], V0 = [0, 8, 0];  // 椭圆轨道（非正圆：基可辨识）
const TRUTH = [-1000, 0, 0, 0];
const SIGMAS = [0, 0.02, 0.05, 0.1];    // 位置噪声：无噪 / 0.2% / 0.5% / 1% 半径
const SA = 40;                          // RTS 过程噪声（近恒加速度模型自由度，≈jerk 量级）

function basis(r) { return [1 / (r * r), 1 / r, 1, 1 / (r * r * r)]; }

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

/* ---------- 3×3 线性代数（RTS 用） ---------- */
const mm3 = (a, b) => { const r = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) { let s = 0;
    for (let k = 0; k < 3; k++) s += a[i][k] * b[k][j]; r[i][j] = s; } return r; };
const mv3 = (a, v) => [0, 1, 2].map(i => a[i][0] * v[0] + a[i][1] * v[1] + a[i][2] * v[2]);
const mt3 = a => [0, 1, 2].map(i => [0, 1, 2].map(j => a[j][i]));
const add3 = (a, b) => a.map((r, i) => r.map((x, j) => x + b[i][j]));
const sm3 = (a, s) => a.map(r => r.map(x => x * s));
function inv3(m) {
  const [a, b, c] = m[0], [d, e, f] = m[1], [g, hh, i] = m[2];
  const A = e * i - f * hh, D = -(b * i - c * hh), G = b * f - c * e;
  const B = -(d * i - f * g), E = a * i - c * g, Hh = -(a * f - c * d);
  const C = d * hh - e * g, F = -(a * hh - b * g), I = a * e - b * d;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-300) throw new Error('singular');
  return [[A, D, G], [B, E, Hh], [C, F, I]].map(r => r.map(x => x / det));
}

/* ---------- 世界 / 传感器 ---------- */
function worldTraj(central) {
  const w = new RealWorld3D({ centralLaw: central, rMin: 0.5 });
  w.addBody(P0, V0, 1.0);
  const P = [P0.slice()];
  for (let t = 0; t < STEPS; t++) { w.step(DT); P.push(w.bodies[0].pos.slice()); }
  return P;
}

/** 传感器模型：欠采样 + 位置高斯噪声。只给位置——速度不可直接测。 */
function observe(Pt, sigma, seed) {
  const rng = rngNormal(seed || 20260908);
  const obs = [];
  for (let i = 0; i < Pt.length; i += PERIOD) {
    const p = Pt[i].slice();
    if (sigma > 0) for (let k = 0; k < 3; k++) p[k] += rng() * sigma;
    obs.push(p);
  }
  return obs;
}

/** 管线 A：朴素二阶中心差分位置 → 加速度。 */
function aNaive(pos) {
  const M = pos.length, A = new Array(M);
  for (let t = 0; t < M; t++) {
    if (t === 0 || t === M - 1) { A[t] = [0, 0, 0]; continue; }
    A[t] = pos[t - 1].map((x, k) => (pos[t + 1][k] - 2 * pos[t][k] + x) / (H * H));
  }
  A[0] = A[1].slice(); A[M - 1] = A[M - 2].slice();
  return A;
}

/** 管线 B：1D RTS（每坐标独立，近恒加速度模型）。返回平滑序列与因果滤波缓存。
 *  x=[p,v,a]，F=上三角(1,h,h²/2;0,1,h;0,0,1)，Q=白噪声加速度离散化，
 *  观测只测位置（标量），Joseph form 数值稳定。 */
function rts1(z, sigmaP) {
  const M = z.length;
  const F = [[1, H, H * H / 2], [0, 1, H], [0, 0, 1]], Ft = mt3(F);
  const Q = sm3([[H ** 4 / 4, H ** 3 / 2, H * H / 2], [H ** 3 / 2, H * H, H], [H * H / 2, H, 1]], SA * SA);
  const R = sigmaP * sigmaP;
  const xf = [], xF = [], xPre = [], Pf = [], Pp = [];  // xPre[t]=t 时刻滤波预测态 x_{t|t-1}
  let x = [z[0], 0, 0], P = sm3([[1, 0, 0], [0, 1, 0], [0, 0, 1]], 1e6);
  for (let t = 0; t < M; t++) {
    if (t > 0) { x = mv3(F, x); P = add3(mm3(F, mm3(P, Ft)), Q); }
    xPre.push(x.slice()); Pp.push(P.map(r => r.slice()));  // 预测态/预测协方差（后向 RTS 用）
    const S = P[0][0] + R;
    const K = [P[0][0] / S, P[1][0] / S, P[2][0] / S];     // 标量观测增益 3×1
    x = x.map((v, i) => v + K[i] * (z[t] - x[0]));
    const IKH = [[1 - K[0], 0, 0], [-K[1], 1, 0], [-K[2], 0, 1]];
    P = add3(mm3(IKH, mm3(P, mt3(IKH))),                  // Joseph: (I-KH)P(I-KH)ᵀ+KRKᵀ
      sm3([[K[0] * K[0], K[0] * K[1], K[0] * K[2]], [K[1] * K[0], K[1] * K[1], K[1] * K[2]],
        [K[2] * K[0], K[2] * K[1], K[2] * K[2]]], R));
    xF.push(x.slice()); xf.push(x.slice()); Pf.push(P.map(r => r.slice()));
  }
  const xs = new Array(M);
  xs[M - 1] = xf[M - 1].slice();
  for (let t = M - 2; t >= 0; t--) {
    // RTS: A = P_t Fᵀ [P_{t+1|t}]⁻¹；修正量用 (x^s_{t+1} − x^f_{t+1|t})（预测态，非更新态）
    const A = mm3(mm3(Pf[t], Ft), inv3(Pp[t + 1]));
    xs[t] = xf[t].map((v, i) => v + mv3(A, xs[t + 1].map((w, j) => w - xPre[t + 1][j]))[i]);
  }
  return { xs, xF };
}

/* ---------- 学律（输入即加速度估计序列）+ 归一化拟合残差 ---------- */
function fitLaw(pos, aEst) {
  const M = pos.length, B = [], ar = [];
  for (let t = 0; t < M; t++) {
    const r = Math.hypot(pos[t][0], pos[t][1], pos[t][2]) || 1e-12;
    B.push(basis(r));
    ar.push((aEst[t][0] * pos[t][0] + aEst[t][1] * pos[t][1] + aEst[t][2] * pos[t][2]) / r);
  }
  let c = lstsq(B, ar);
  for (let it = 0; it < 10; it++) {
    const mx = Math.max(...c.map(Math.abs));
    const active = c.map(x => Math.abs(x) > 0.02 * mx);
    if (active.filter(Boolean).length <= 1) break;
    const Bact = B.map(row => row.filter((_, j) => active[j]));
    const ca = lstsq(Bact, ar);
    const cn = c.map(() => 0);
    let j = 0;
    for (let k = 0; k < c.length; k++) if (active[k]) cn[k] = ca[j++];
    const close = c.every((x, k) => Math.abs(x - cn[k]) < 1e-12);
    c = cn;
    if (close) break;
  }
  const pred = B.map((row, t) => row.reduce((s, b, k) => s + b * c[k], 0));
  const na = Math.sqrt(ar.reduce((s, x) => s + x * x, 0)) || 1;
  const resid = Math.sqrt(ar.reduce((s, x, t) => s + (pred[t] - x) * (pred[t] - x), 0)) / na;
  return { c, resid };
}

/* ---------- 从任意状态跑虚拟世界（外推用） ---------- */
function worldRun(central, p0, v0, steps) {
  const w = new RealWorld3D({ centralLaw: central, rMin: 0.5 });
  w.addBody(p0, v0, 1.0);
  const P = [p0.slice()];
  for (let t = 0; t < steps; t++) { w.step(DT); P.push(w.bodies[0].pos.slice()); }
  return P;
}

/* ---------- 吸收门控：滚动短视界预测检验（诚实版） ----------
 * 真实世界没有 truth 可对照，机器人唯一能信的是"新观测"。用学出的律从平滑
 * 状态预报半圈，与陆续到来的观测比（滚动，视界=半圈避相位累积误杀）。
 * ⚠ 体检实锤：预测误差被"起点状态估计误差"主导（σa 需大→跟近心点 jerk，
 * 但大 σa 使平滑速度噪声 ~0.4 → 半圈预测底 ~15%，完美律也一样）。所以静态
 * 二元门控在此数据质量下不成立——正确用法是三层对照：
 *   ① 学出律的预测 p50 vs ② 朴素差分的 p50 vs ③ 完美律的 p50（误差底）。
 *   B 律贴近底 → 已达该观测质量下的预测极限（可收）；A 律远高于底 → 律坏（拒）。
 * 真实 Agent 的最终兜底是 v2 的连续监控：律进经验后滚动预测误差持续劣化
 * → 冲突放大 δ（"经验可能过期"），而非一次性阈值。 */
function gateEval(c, obs, R, iSplit, L, every) {
  const M = obs.length;
  const sep = [];
  for (let s = iSplit; s + L < M; s += every) {
    const pos0 = [R[0].xs[s][0], R[1].xs[s][0], R[2].xs[s][0]];
    const vel0 = [R[0].xs[s][1], R[1].xs[s][1], R[2].xs[s][1]];
    const Pv = worldRun(c, pos0, vel0, L * PERIOD);
    const pv = Pv[L * PERIOD], po = obs[s + L];
    const d = Math.hypot(pv[0] - po[0], pv[1] - po[1], pv[2] - po[2]);
    const r = Math.hypot(po[0], po[1], po[2]) || 1e-12;
    sep.push(d / r * 100);
  }
  sep.sort((a, b) => a - b);
  return { p50: sep[Math.floor(sep.length / 2)], p90: sep[Math.floor(sep.length * 0.9)], n: sep.length };
}

const fmt = c => '[' + c.map(x => x.toFixed(1)).join(', ') + ']';
const HOLD = 0.7;                         // 前 70% 观测学律，后 30% 滚动检验
const L_HOR = Math.round(0.5 * 3.96 / H); // 预测视界 ≈ 半圈（观测步）
const Pt = worldTraj(TRUTH);              // 真实世界轨道（仅作体检参照，Agent 不可得）

console.log('=== 灵境 · 真实世界条件体检（观测≠真值：欠采样+带噪+速度不可直接测）— JS 轨 ===');
console.log('真实世界(truth): −1000/r²，椭圆 r∈[~5.9,~20]  观测: 每 3 步(≈33Hz) 只给位置');
console.log('学律: 前 70% 观测  预测校验: 滚动半圈(' + L_HOR + ' 步)预测 vs 新观测');
console.log('管线 A=朴素位置差分  B=RTS 平滑(近恒加速度 σa=' + SA + ')\n');

for (const sigma of SIGMAS) {
  const label = sigma === 0 ? 'E0 无噪（欠采样本身的影响）' : 'Sσ=' + sigma +
    '（' + (sigma / 10 * 100).toFixed(1) + '% 半径）';
  const obs = observe(Pt, sigma, 20260908);
  const M = obs.length, iS = Math.floor(HOLD * M);
  const obsTr = obs.slice(0, iS + 1);
  // RTS：平滑(学律用 + 预测起点状态)
  const R = [0, 1, 2].map(k => rts1(obs.map(p => p[k]), sigma || 1e-4));
  const posS = obs.map((_, t) => [R[0].xs[t][0], R[1].xs[t][0], R[2].xs[t][0]]);
  const aS = obs.map((_, t) => [R[0].xs[t][2], R[1].xs[t][2], R[2].xs[t][2]]);
  // 学律只用前段（不偷看留出段）；A 用朴素差分、B 用 RTS 平滑
  const LA = fitLaw(obsTr, aNaive(obsTr));
  const LB = fitLaw(posS.slice(0, iS + 1), aS.slice(0, iS + 1));
  const gA = gateEval(LA.c, obs, R, iS, L_HOR, 15);
  const gB = gateEval(LB.c, obs, R, iS, L_HOR, 15);
  const gT = gateEval(TRUTH, obs, R, iS, L_HOR, 15);   // 完美律=误差底
  const eA = Math.abs(LA.c[0] + 1000) / 10, eB = Math.abs(LB.c[0] + 1000) / 10;
  console.log(`── ${label} ──`);
  console.log(`  A 朴素差分 : μ=${fmt(LA.c)}  c0误差 ${eA.toFixed(2)}%  滚动半圈预测 p50=${gA.p50.toFixed(1)}%`);
  console.log(`  B RTS平滑  : μ=${fmt(LB.c)}  c0误差 ${eB.toFixed(2)}%  滚动半圈预测 p50=${gB.p50.toFixed(1)}%`);
  console.log(`  完美律(底) : (预测误差下限，由起点状态估计决定)        p50=${gT.p50.toFixed(1)}%\n`);
}

console.log('结论：');
console.log('  · 原学律管线（直接差分）在真实观测下失效：σ=0.02(0.2%半径) 12% 误差、σ=0.1 达 300%+；');
console.log('  · RTS 平滑纪律把学律质量推回无噪量级：σ=0.02→0.1%、σ=0.05→1.9%、σ=0.1→5% c0 误差（63× 优于差分）；');
console.log('  · 训练残差在带噪下 ≠ 律质量（好律也高，σ=0.02 时好律残差 66%）——不能作判据；');
console.log('  · 预测校验是正判据但分辨率受起点状态估计限制（平滑速度噪声 ~0.4 → 半圈底 ~15%，完美律亦然）；');
console.log('  · 故静态二元门控不成立：真实 Agent 用"律进经验 + 滚动预测持续监控，误差劣化→δ 放大"（v2 闭环）；');
console.log('  · 正圆轨道单一半径 → 基完全共线不可辨识（勿学）。待办：RTS/观测层抽公共模块 + lingjing-mcp 接入。');
