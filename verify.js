'use strict';
/**
 * 灵境 MVP 验真脚本 —— 每一层都真算，不做动画假象。
 * 运行：node verify.js
 */
const ROM = require('./rom.js');
const { solve } = require('C:/Users/Administrator/Desktop/灵数求解器/solver-core.js');
const D = require('./lingnao-decision.js');

const nx = 40, ny = 30;
const mkWorld = () => new ROM.HeatWorld(nx, ny, { alpha: 0.2, dt: 0.5, dx: 1 });

console.log('=== 1. L1/L2 物理底座：二维热传导 PDE 真实演化 ===');
const w = mkWorld();
w.init((i, j) => Math.exp(-(((i - 20) ** 2 + (j - 15) ** 2) / 40)));
const s0 = w.stats();
for (let t = 0; t < 50; t++) w.step();
const s1 = w.stats();
console.log('  热点扩散: max', s0.max.toFixed(4), '→', s1.max.toFixed(4), '| mean', s0.mean.toFixed(5), '→', s1.mean.toFixed(5));
console.log('  (max 应下降=扩散；mean 因 Dirichlet 零边界会衰减)');

console.log('=== 2. L3 全息映射：POD/SVD 降阶真算（多初值快照）===');
const hm = new ROM.HoloMap(nx * ny, 150);
// 训练快照须覆盖【空间多样性】（多热点位置 × 短时序），否则后期场趋同、模态泛化差
const POS = [[20, 15], [12, 8], [28, 22], [8, 24], [16, 6], [30, 12], [6, 14], [24, 26]];
for (const c of POS) {
  const ww = mkWorld();
  ww.init((i, j) => Math.exp(-(((i - c[0]) ** 2 + (j - c[1]) ** 2) / 40)));
  for (let t = 0; t < 16; t++) { ww.step(); hm.collect(ww.field); }
}
const built = hm.build(8);
console.log('  POD 模态数 r=' + built.r, '| 已取模态能量占比=' + (built.energy * 100).toFixed(2) + '%');
console.log('  前3特征值 λ=' + built.lambda.slice(0, 3).map(x => x.toExponential(2)).join('  '));
console.log('  体空间 N=' + (nx * ny) + ' 维 → 边界 r=' + built.r + ' 维，压缩比 ' + (nx * ny / built.r).toFixed(0) + ':1');

console.log('=== 3. L5 反向映射：分布内精度 / 分布外局限 / 自适应更新 ===');
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
// (a) 分布内：训练快照覆盖的位置
const wIn = mkWorld();
wIn.init((i, j) => Math.exp(-(((i - 20) ** 2 + (j - 15) ** 2) / 40)));
const errIn = [];
for (let t = 0; t < 12; t++) { wIn.step(); errIn.push(hm.reconError(wIn.field)); }
console.log('  (a) 分布内(训练已覆盖位置) 重建误差 均值=' + (mean(errIn) * 100).toFixed(2) + '%');

// (b) 分布外：未见的热点位置 —— ROM 真实局限，如实暴露
const w2 = mkWorld();
w2.init((i, j) => Math.exp(-(((i - 16) ** 2 + (j - 18) ** 2) / 40)));
const errsOut = [], psiSeq = [];
for (let t = 0; t < 20; t++) { w2.step(); errsOut.push(hm.reconError(w2.field)); psiSeq.push(hm.project(w2.field)); }
console.log('  (b) 分布外(未见热点位置) 重建误差 均值=' + (mean(errsOut) * 100).toFixed(2) + '%  ← ROM 真实局限：训练未覆盖状态表示能力差');

// (c) 自适应更新（框架 §3 机制）：偏差超阈值→吸收观测→重算 POD
const hm2 = new ROM.HoloMap(nx * ny, 200);
for (const c of POS) {
  const ww = mkWorld();
  ww.init((i, j) => Math.exp(-(((i - c[0]) ** 2 + (j - c[1]) ** 2) / 40)));
  for (let t = 0; t < 16; t++) { ww.step(); hm2.collect(ww.field); }
}
hm2.build(8);
let adapts = 0; const errsAd = [];
for (let t = 0; t < 20; t++) {
  w2.step();
  const a = hm2.maybeAdapt(w2.field, 0.05, 8);
  if (a.adapted) adapts++;
  errsAd.push(hm2.reconError(w2.field));
}
console.log('  (c) 启用自适应后：触发重训练 ' + adapts + ' 次 | 误差均值=' + (mean(errsAd) * 100).toFixed(2) + '%');
console.log('      (自适应=吸收新观测扩充快照并重算 POD；对已观测/邻近状态精度显著提升，全新分布仍需扩充重训练——ROM 真实边界，如实标注)');
const meanErr = mean(errsAd);

console.log('=== 4. L4 边界智能层：低维动力学拟合 + 多步预测 ===');
const fit = ROM.fitLinear(psiSeq);
console.log('  ψ_{t+1}=A·ψ_t 拟合: r=' + (fit && fit.A.length) + ' | 相对拟合误差=' + (fit && fit.relErr.toExponential(2)));
const start = 5, H = 6;
const pred = ROM.predict(fit.A, psiSeq[start], H);
let pe = 0, sc = 0;
for (let k = 0; k <= H; k++) for (let o = 0; o < pred[k].length; o++) {
  pe += (pred[k][o] - psiSeq[start + k][o]) ** 2; sc += psiSeq[start + k][o] ** 2;
}
console.log('  多步预测(H=' + H + ') 相对误差=' + Math.sqrt(pe / sc).toExponential(2));

console.log('=== 5. 灵数在边界层真解【控制分配方程】（灵数硬限制 ≤6 变量）===');
// 场景：2 个冷却执行器 u1,u2 —— 总功率约束 u1+u2=P；加权降温目标 w1·u1+w2·u2=Q
const P = 1.2, Q = 0.8, g1 = 0.6, g2 = 0.9;
const eqs = ['u1 + u2 = ' + P, '(' + g1 + ')*u1 + (' + g2 + ')*u2 = ' + Q];
const lr = solve(eqs, ['u1', 'u2'], 6);
const sol = lr && lr.solutions && lr.solutions[0];
console.log('  方程: ' + eqs.join('  ;  '));
let maxres = NaN;
if (sol && sol.values) {
  const u1 = sol.values[0], u2 = sol.values[1];
  console.log('  灵数解 u1=' + u1.toFixed(6) + '  u2=' + u2.toFixed(6) + ' | certified=' + sol.certified);
  maxres = Math.max(Math.abs(u1 + u2 - P), Math.abs(g1 * u1 + g2 * u2 - Q));
  console.log('  回代: u1+u2=' + (u1 + u2).toFixed(6) + '(应=' + P + ')  加权=' + (g1 * u1 + g2 * u2).toFixed(6) + '(应=' + Q + ')  最大残差=' + maxres.toExponential(2));
} else {
  console.log('  ❌ 灵数未解出');
}

console.log('=== 6. 灵脑决策核 FIREWALL（含 G5 热安全门）===');
const allow = D.decide({ from: 'lingjing-L4' }, { power: 0.9, load: 0.1, cap: 1, conflict: false, tempMax: 0.5, tempLimit: 1.0 });
const denyHot = D.decide({ from: 'lingjing-L4' }, { power: 0.9, load: 0.1, cap: 1, conflict: false, tempMax: 1.5, tempLimit: 1.0 });
console.log('  正常(temp 0.5≤1.0) →', allow.approved, '|', allow.reason);
console.log('  超温(1.5>1.0)  →', denyHot.approved, '|', denyHot.reason);

console.log('=== 7. 审计账本（不可篡改哈希链）===');
const led = new D.VerifyLedger();
led.append({ step: 1, psi: psiSeq[0] }); led.append({ step: 2, psi: psiSeq[1] });
console.log('  账本长度=' + led.length + ' | 整链校验=' + led.verify());

console.log('=== 结论 ===');
const ok = s1.max < s0.max && built.r >= 4 && built.energy > 0.9 && meanErr < 0.10 &&
           fit && fit.relErr < 0.2 && allow.approved && !denyHot.approved && sol && maxres < 1e-4;
console.log('  判定: PDE演化=' + (s1.max < s0.max) + ' | 能量捕获>90%=' + (built.energy > 0.9) +
            ' | 自适应后误差<10%=' + (meanErr < 0.10) + ' | 边界动力学拟合=' + (fit && fit.relErr < 0.2) +
            ' | 灵数控制分配=' + (sol && maxres < 1e-4) + ' | 决策核=' + (allow.approved && !denyHot.approved));
console.log(ok ? '  ✅ 灵境五层核心数学真算通过 + 灵数/灵脑真集成生效' : '  ❌ 验证失败（见上方数值）');
process.exit(ok ? 0 : 1);
