/**
 * 灵境 · 多物理规律验真（JS 轨）
 * ----------------------------------------------------------------------------
 * 同一个三维世界（唯一原点居中、XYZ 正负半轴、21³=9261）上跑五类不同的物理规律：
 *   A 热传导   抛物型 ∂tφ = α∇²φ          耗散、平滑、不可逆
 *   B 声波     双曲型 ∂²u/∂t² = c²∇²u     可逆、能量守恒、二阶系统
 *   C 静电势   椭圆型 ∇²φ = −ρ/ε₀         瞬时平衡、线性可叠加
 *   D 流体输运 对流–扩散 ∂tφ + u·∇φ = α∇²φ  输运为主、对降阶不友好
 *   E 刚体     牛顿–欧拉（非场，世界里的物体）
 *
 * 每类都问同一个问题：**它到底守不守恒 / 准不准 / 能不能被降阶**。
 * 对应《灵境》五层：L1 物理底座 → L2 体状态 → L3 POD 降阶 → L4 边界动力学 → L5 重建。
 *
 * 方法学铁律（前几轮踩过，见 README）：
 *   ① 不在训练快照上做预测（背答案）  ② 递推跨距必须与快照间隔对齐
 *   ③ 前面实验污染过基之后，后续指标必须用干净基重测
 *   ④ 降阶模态必须检查正交性（否则加模态反而更差）
 *   ⑤ L4 的模型阶必须匹配系统的阶：一阶系统用仿射、二阶系统用 AR(2)
 *
 * 运行：node verify_physics.js
 */
'use strict';
const { HeatWorld3D, WaveWorld3D, PoissonWorld3D, AdvectDiffuseWorld3D, RigidBody3D,
  HoloMap, fitAffine, fitAffine2, predictAffine, predictAffine2 } = require('./rom.js');

const N = 21, SIGMA = 3.0, RANK = 8;
const OPTS = { dx: 1.0, boundary: 0.0 };
const gauss = (cx, cy, cz) => (x, y, z) =>
  Math.exp(-((x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2) / (2 * SIGMA * SIGMA));
// 紧凑支撑脉冲（有真正的波前，测波速用）
const bump = (x, y, z) => { const r = Math.hypot(x, y, z); return r < 2.5 ? Math.cos(Math.PI * r / 5) ** 2 : 0; };

function norm(v) { let s = 0; for (let i = 0; i < v.length; i++) s += v[i] * v[i]; return Math.sqrt(s); }
function relErr(a, b) { const A = Array.from(a), B = Array.from(b); return norm(A.map((x, i) => x - B[i])) / (norm(B) || 1); }
function fj(v, d) { return (v >= 0 ? ' ' : '') + v.toFixed(d); }

/** 通用：在时变场上跑 L3→L5（order=1 仿射 / order=2 AR(2)），样本外自由演化 */
function romPipeline(makeWorld, trainSteps, snapEvery, testBlocks, r, order) {
  const w = makeWorld();
  const holo = new HoloMap(w.N, 200);
  holo.collect(w.flat().slice());
  for (let t = 1; t <= trainSteps; t++) {
    w.step();
    if (t % snapEvery === 0) holo.collect(w.flat().slice());
  }
  holo.build(r);
  const snapsClean = holo.snaps.map(function (s) { return s.slice(); });
  const psiAll = snapsClean.map(function (s) { return holo.project(s); });
  const fit = order === 2 ? fitAffine2(psiAll) : fitAffine(psiAll);

  // 模态正交性（护栏是否生效）
  let maxOff = 0;
  for (let a = 0; a < holo.modes.length; a++) for (let b = 0; b < holo.modes.length; b++) {
    if (a === b) continue;
    let s = 0; for (let p = 0; p < w.N; p++) s += holo.modes[a][p] * holo.modes[b][p];
    maxOff = Math.max(maxOff, Math.abs(s));
  }

  // 样本外：从训练段末向未见未来递推（跨距对齐）
  const psi0 = holo.project(w.flat());                  // ψ(t=T_train)
  let psiCur = psi0, psiPrev = psiAll[psiAll.length - 2];
  const w2 = makeWorld();
  for (let t = 0; t < trainSteps; t++) w2.step();
  for (let blk = 0; blk < testBlocks; blk++) {
    for (let q = 0; q < snapEvery; q++) w2.step();
    const nxt = order === 2
      ? predictAffine2(fit.A, psiCur, psiPrev, 1)[1]
      : predictAffine(fit.A, psiCur, 1)[1];
    psiPrev = psiCur; psiCur = nxt;
  }
  const truth = w2.flat();
  const l5 = relErr(holo.reconstruct(holo.project(truth)), truth);
  const l4 = relErr(holo.reconstruct(psiCur), truth);

  return {
    r: holo.r, energy: holo.energy(), effectiveRank: holo.effectiveRank(),
    compression: w.N / holo.r, maxOff: maxOff,
    fitResid: fit.relErr, l5: l5, l4: l4,
  };
}

console.log('=== 灵境 · 多物理规律验真 · JS 轨 ===');
console.log(`世界：原点 (0,0,0) 居中，x,y,z ∈ [−10, +10]，dx=1，${N}³ = ${N ** 3} 自由度\n`);

// ==================== A 热传导（抛物型） ====================
{
  console.log('── A 热传导（抛物型 ∂tφ = α∇²φ）：耗散、平滑、不可逆 ──');
  const w = new HeatWorld3D(N, N, N, Object.assign({ alpha: 0.2, dt: 0.5 }, OPTS));
  w.init(gauss(0, 0, 0));
  let prev = w.stats().mean, monotone = true;
  for (let t = 0; t < 60; t++) { w.step(); const m = w.stats().mean; if (m > prev + 1e-15) monotone = false; prev = m; }
  console.log(`  总热量单调不增（耗散性）= ${monotone ? '是' : '否'}   t=30 均值=${prev.toFixed(6)}`);
  const rom = romPipeline(function () {
    const x = new HeatWorld3D(N, N, N, Object.assign({ alpha: 0.2, dt: 0.5 }, OPTS));
    x.init(gauss(0, 0, 0)); return x;
  }, 40, 2, 6, RANK, 1);
  console.log(`  L3 r=${rom.r}(请求${RANK}) 能量=${(rom.energy * 100).toFixed(4)}% 有效秩=${rom.effectiveRank} 压缩=${rom.compression.toFixed(0)}:1  正交=${rom.maxOff.toExponential(2)}`);
  console.log(`  L5 重建(样本外) = ${(rom.l5 * 100).toFixed(4)}%   L4 仿射预测(样本外) = ${rom.l4.toExponential(3)}`);
}

// ==================== B 声波（双曲型） ====================
{
  console.log('\n── B 声波（双曲型 ∂²u/∂t² = c²∇²u）：可逆、能量守恒、二阶系统 ──');
  const w = new WaveWorld3D(N, N, N, Object.assign({ c: 1.0, dt: 0.2 }, OPTS));
  w.init(gauss(0, 0, 0));
  const e0 = w.energy();
  let maxDrift = 0;
  for (let t = 1; t <= 30; t++) { w.step(); maxDrift = Math.max(maxDrift, Math.abs(w.energy() / e0 - 1)); }
  console.log(`  Courant = ${w.courant.toFixed(4)}（上限 0.5774）  能量 30 步最大漂移 = ${(maxDrift * 100).toExponential(3)}%`);

  // 波速：紧凑脉冲，探针测到达时刻，拟合 t(d) 斜率 = 1/c
  const w2 = new WaveWorld3D(N, N, N, Object.assign({ c: 1.0, dt: 0.05 }, OPTS));
  w2.init(bump);
  const probes = [4, 5, 6, 7];
  const arrivals = [];
  for (const d of probes) {
    const idx = w2.indexAt(d, 0, 0);
    let ta = null;
    for (let t = 1; t <= 200 && ta === null; t++) {
      w2.step();
      if (Math.abs(w2.field[idx]) > 1e-3) ta = w2.time;
    }
    arrivals.push(ta);
  }
  const n = probes.length; let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) { sx += probes[i]; sy += arrivals[i]; sxx += probes[i] * probes[i]; sxy += probes[i] * arrivals[i]; }
  const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  console.log(`  波速：探针 d=${probes.join(',')} 到达 t=${arrivals.map(function (v) { return v.toFixed(2); }).join(',')}  拟合 1/c=${fj(slope, 4)}  理论 1.000`);

  // L4：一阶仿射 vs 二阶 AR(2)
  const rom1 = romPipeline(function () {
    const x = new WaveWorld3D(N, N, N, Object.assign({ c: 1.0, dt: 0.2 }, OPTS));
    x.init(gauss(0, 0, 0)); return x;
  }, 40, 2, 6, RANK, 1);
  const rom2 = romPipeline(function () {
    const x = new WaveWorld3D(N, N, N, Object.assign({ c: 1.0, dt: 0.2 }, OPTS));
    x.init(gauss(0, 0, 0)); return x;
  }, 40, 2, 6, RANK, 2);
  console.log(`  L3 r=${rom2.r} 能量=${(rom2.energy * 100).toFixed(4)}% 有效秩=${rom2.effectiveRank} 压缩=${rom2.compression.toFixed(0)}:1  正交=${rom2.maxOff.toExponential(2)}`);
  console.log(`  L5 重建(样本外) = ${(rom2.l5 * 100).toFixed(4)}%`);
  console.log(`  L4 一阶仿射 预测(样本外) = ${rom1.l4.toExponential(3)}  ← 二阶系统硬塞一阶模型，爆炸`);
  console.log(`  L4 二阶 AR(2) 预测(样本外) = ${rom2.l4.toExponential(3)}  ← 模型阶匹配后可用`);
}

// ==================== C 静电势（椭圆型） ====================
{
  console.log('\n── C 静电势（椭圆型 ∇²φ = −ρ/ε₀）：瞬时平衡、线性可叠加 ──');
  const mk = function () { return new PoissonWorld3D(N, N, N, Object.assign({ eps0: 1.0 }, OPTS)); };
  // 叠加原理：三个解跑【完全相同】的迭代次数，Jacobi 是线性的 ⇒ 逐位叠加到机器精度
  const pa = mk(); pa.addPointCharge(-4, 0, 0, 1); pa.solve(1000, 0);
  const pb = mk(); pb.addPointCharge(4, 0, 0, 1); pb.solve(1000, 0);
  const pab = mk(); pab.addPointCharge(-4, 0, 0, 1); pab.addPointCharge(4, 0, 0, 1); pab.solve(1000, 0);
  let sup = 0, den = 0;
  for (let p = 0; p < pa.N; p++) {
    sup = Math.max(sup, Math.abs(pab.field[p] - (pa.field[p] + pb.field[p])));
    den = Math.max(den, Math.abs(pab.field[p]));
  }
  console.log(`  叠加原理（固定 1000 次迭代）max|φ_AB−(φ_A+φ_B)|/max|φ_AB| = ${(sup / den).toExponential(3)}  ← 应 ~1e-16`);
  // 离散均值性质：无源处 φ_p = 六邻均值（对离散调和函数精确成立）
  const p1 = mk(); p1.addPointCharge(0, 0, 0, 1); const r1 = p1.solve(3000, 1e-12);
  let mv = 0, mvscale = 0;
  for (const [px, py, pz] of [[5, 0, 0], [0, 5, 0], [3, 3, 3], [-4, -2, 1]]) {
    const p = p1.idx(p1.iOf(px), p1.jOf(py), p1.kOf(pz));
    const s = p1.field[p - 1] + p1.field[p + 1] + p1.field[p - N] + p1.field[p + N] + p1.field[p - N * N] + p1.field[p + N * N];
    mv = Math.max(mv, Math.abs(p1.field[p] - s / 6));
    mvscale = Math.max(mvscale, Math.abs(p1.field[p]));
  }
  console.log(`  离散均值性质（无源点）max|φ−⟨六邻⟩| / max|φ| = ${(mv / mvscale).toExponential(3)}  求解残差=${r1.residual.toExponential(2)}`);
  console.log(`  降阶：椭圆型无时间演化，建基须【参数化】（尚未实现），此处不套 POD`);
}

// ==================== D 流体输运（对流主导） ====================
{
  console.log('\n── D 流体输运（∂tφ + u·∇φ = α∇²φ）：输运为主、对降阶不友好 ──');
  const mk = function () {
    const x = new AdvectDiffuseWorld3D(N, N, N, Object.assign({ alpha: 0.0, dt: 0.2, omega: 0.1 }, OPTS));
    x.init(gauss(5, 0, 0)); return x;
  };
  const w = mk();
  const c0 = w.centroid();
  const quarter = Math.round((Math.PI / 2 / 0.1) / 0.2);
  const peak0 = w.stats().max;
  for (let t = 0; t < quarter; t++) w.step();
  const c1 = w.centroid();
  const ang = Math.atan2(c1.y, c1.x) - Math.atan2(c0.y, c0.x);
  console.log(`  对流 CFL = ${w.flowCFL.toFixed(4)}（上限 1）  扩散 λ = ${w.lam.toFixed(4)}`);
  console.log(`  转 90°（${quarter} 步）：质心角 ${fj(ang * 180 / Math.PI, 2)}°  理论 90.00°`);
  console.log(`  峰值 ${peak0.toExponential(4)} → ${w.stats().max.toExponential(4)}  衰减 ${((1 - w.stats().max / peak0) * 100).toFixed(2)}%（一阶迎风的数值扩散，非物理耗散）`);
  const rom = romPipeline(mk, 40, 2, 6, RANK, 1);
  console.log(`  L3 r=${rom.r} 能量=${(rom.energy * 100).toFixed(4)}% 有效秩=${rom.effectiveRank} 压缩=${rom.compression.toFixed(0)}:1`);
  console.log(`  L5 重建(样本外) = ${(rom.l5 * 100).toFixed(4)}%   L4 仿射预测(样本外) = ${rom.l4.toExponential(3)}`);
  console.log(`  ↑ 有效秩 ${rom.effectiveRank} > 热传导的 3：对流问题 Kolmogorov n-width 衰减慢，低维基抓不住平移的斑`);
}

// ==================== E 刚体（牛顿力学） ====================
{
  console.log('\n── E 刚体（牛顿–欧拉，非场）：世界里的物体 ──');
  const mk = function () { return new RigidBody3D({ mass: 2.0, pos: [0, 10, 0], gravity: [0, -9.81, 0] }); };
  const rb = mk(); const steps = 100; const dt = 0.01;
  for (let i = 0; i < steps; i++) rb.step(dt);
  const exact = 10 - 0.5 * 9.81 * rb.time * rb.time;
  console.log(`  自由落体（速度 Verlet，恒加速度下位置应精确）：y=${rb.pos[1].toFixed(12)} 解析=${exact.toFixed(12)} 差=${Math.abs(rb.pos[1] - exact).toExponential(2)}`);
  const rb2 = new RigidBody3D({ mass: 3.0, pos: [0, 0, 0] });
  const F = [2.0, -1.0, 0.5];
  for (let i = 0; i < 200; i++) { rb2.applyForce(F); rb2.step(0.01); }
  const p = rb2.momentum();
  console.log(`  动量（恒力应逐位守恒）：p=(${p.map(function (v) { return v.toFixed(9); }).join(', ')})  理论 F·t=(${(F[0] * 2).toFixed(9)}, ${(F[1] * 2).toFixed(9)}, ${(F[2] * 2).toFixed(9)})`);
  const rb3 = new RigidBody3D({ Ix: 1.0, Iy: 2.0, Iz: 3.0, omega: [0.3, 1.2, -0.7] });
  const L0 = rb3.angularMomentum(), E0 = 0.5 * (rb3.Ix * rb3.omega[0] ** 2 + rb3.Iy * rb3.omega[1] ** 2 + rb3.Iz * rb3.omega[2] ** 2);
  let dL = 0, dE = 0;
  for (let i = 0; i < 2000; i++) {
    rb3.step(0.005);
    const L = rb3.angularMomentum();
    dL = Math.max(dL, Math.abs(norm(L) / norm(L0) - 1));
    const E = 0.5 * (rb3.Ix * rb3.omega[0] ** 2 + rb3.Iy * rb3.omega[1] ** 2 + rb3.Iz * rb3.omega[2] ** 2);
    dE = Math.max(dE, Math.abs(E / E0 - 1));
  }
  console.log(`  无力矩自转(非对称 I=1,2,3，RK2) 2000 步：|L| 漂移=${(dL * 100).toExponential(3)}%  转动能漂移=${(dE * 100).toExponential(3)}%`);
}

// ==================== F CFL fail-closed ====================
{
  console.log('\n── F 稳定性护栏：超 CFL 必须拒绝启动（fail-closed，不是警告） ──');
  const cases = [
    ['热传导 α·dt/dx²>1/6', function () { return new HeatWorld3D(10, 10, 10, { alpha: 0.2, dt: 5, dx: 1 }); }],
    ['声波 c·dt/dx>1/√3', function () { return new WaveWorld3D(10, 10, 10, { c: 1, dt: 1, dx: 1 }); }],
    ['流体 Σ|u|dt/dx>1', function () { return new AdvectDiffuseWorld3D(10, 10, 10, { alpha: 0, dt: 0.5, omega: 5, dx: 1 }); }],
    ['流体 α·dt/dx²>1/6', function () { return new AdvectDiffuseWorld3D(10, 10, 10, { alpha: 0.2, dt: 5, omega: 0.01, dx: 1 }); }],
  ];
  for (const c of cases) {
    let ok = false, msg = '';
    try { c[1](); } catch (e) { ok = true; msg = e.message.split('。')[0]; }
    console.log(`  ${ok ? '✅' : '❌'} ${c[0]}：${ok ? '已拒绝 — ' + msg : '未拦截！'}`);
  }
}

console.log('\n=== JS 轨结束 ===');
