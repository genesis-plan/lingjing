/**
 * 灵境 · 真实世界验真（JS 轨）
 * ----------------------------------------------------------------------------
 * 把"三维虚拟空间"升级为更接近真实世界的系统：
 *   - 物理层（现实规律，含运动）：以原点模拟为地球中心，从原点产生反平方中心引力，
 *     物体受牛顿运动影响；可选互引力(N 体)、可选弹性碰撞。
 *   - 数学层（数学规律，区别于物理力）：
 *       G4 MG 几何约束律：物体被约束在半径 R 的球面上（纯数学结构，非力）。
 *       G5 MI 不变量律：能量/角动量/动量 由三大连续对称推出，显式测漂移。
 *       G1–G3 / G6 Bertrand 专属数学律：反平方中心力下离心率矢量守恒 ⇒ 束缚轨道闭合成椭圆。
 *
 * 方法学铁律（与 verify_physics 一致）：测不准比算不对更危险——所有"守恒"都是
 * 拿真值对照测出来的，不是靠假设。Verlet 是辛积分，能量长期是有界振荡而非单调发散。
 *
 * 运行：node verify_world.js
 */
'use strict';
const { RealWorld3D } = require('./rom.js');

function norm(v) { return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]); }
function relErr(a, b) { return norm([a[0] - b[0], a[1] - b[1], a[2] - b[2]]) / (norm(b) || 1); }
function fj(v, d) { return (v >= 0 ? ' ' : '') + v.toFixed(d); }

console.log('=== 灵境 · 真实世界验真（原点=地球中心 · 中心引力 + 多体 + 数学规律）· JS 轨 ===\n');

// ==================== G1 近圆轨道：能量 / 角动量长期守恒（辛积分） ====================
{
  console.log('── G1 近圆轨道（中心反平方引力，速度 Verlet 长期守恒）──');
  const w = new RealWorld3D({ G: 1, M: 1000, rMin: 0.5 });
  w.addBody([10, 0, 0], [0, 10, 0], 1, 0.2);      // R0=10, v=10=√(μ/R0) ⇒ 圆轨道
  const E0 = w.energy(), L0 = w.angularMomentum();
  const T = 2 * Math.PI * Math.sqrt(10 ** 3 / 1000);  // 周期 T=2π√(R³/μ)
  const steps = Math.round(5 * T / 0.01);            // 跑 5 圈
  let maxDE = 0, maxDL = 0;
  for (let i = 0; i < steps; i++) {
    w.step(0.01);
    maxDE = Math.max(maxDE, Math.abs(w.energy() / E0 - 1));
    maxDL = Math.max(maxDL, Math.abs(norm(w.angularMomentum()) / norm(L0) - 1));
  }
  console.log(`  圆轨道 5 圈(${steps} 步)：能量最大漂移 = ${(maxDE * 100).toExponential(3)}%  角动量|L|漂移 = ${(maxDL * 100).toExponential(3)}%`);
  console.log(`  E0=${E0.toFixed(4)}（应为负=束缚）  L0=(${L0.map(function (v) { return v.toFixed(2); }).join(', ')})`);
}

// ==================== G2 椭圆轨道：Bertrand 数学律（离心率矢量守恒 ⇒ 闭合椭圆） ====================
{
  console.log('\n── G2 椭圆轨道（反平方专属数学律：离心率矢量 e_vec 守恒 ⇒ 轨道闭合成椭圆）──');
  const w = new RealWorld3D({ G: 1, M: 1000, rMin: 0.5 });
  w.addBody([10, 0, 0], [0, 8, 0], 1, 0.2);        // v=8<√(μ/R)=10 ⇒ 束缚椭圆
  const e0 = w.eccVector(0), a0 = Math.hypot(e0[0], e0[1], e0[2]);
  // 由 vis-viva：1/a = 2/R − v²/μ
  const a = 1 / (2 / 10 - 64 / 1000);
  const T = 2 * Math.PI * Math.sqrt(a ** 3 / 1000);
  const steps = Math.round(2 * T / 0.01);
  let maxDEcc = 0, rMinObs = 1e9, rMaxObs = 0;
  for (let i = 0; i < steps; i++) {
    w.step(0.01);
    const e = w.eccVector(0);
    maxDEcc = Math.max(maxDEcc, Math.abs(norm(e) / a0 - 1));
    const r = norm(w.bodies[0].pos);
    rMinObs = Math.min(rMinObs, r); rMaxObs = Math.max(rMaxObs, r);
  }
  console.log(`  理论 a=${a.toFixed(4)}（vis-viva）  实测 r∈[${rMinObs.toFixed(4)}, ${rMaxObs.toFixed(4)}]  → a≈${(0.5 * (rMinObs + rMaxObs)).toFixed(4)}`);
  console.log(`  |e_vec| 2 周期(${steps} 步)最大漂移 = ${(maxDEcc * 100).toExponential(3)}%  ← Bertrand：反平方力下 e_vec 守恒，轨道必闭合成椭圆`);
}

// ==================== G3 中心 + 双卫星：能量 + 角动量矢量(方向)守恒 ====================
{
  console.log('\n── G3 中心 + 双卫星：能量守恒 且 总角动量矢量(方向+大小)守恒 ──');
  const w = new RealWorld3D({ G: 1, M: 1000, rMin: 0.5 });
  w.addBody([10, 0, 0], [0, 10, 0], 1, 0.2);
  w.addBody([0, 15, 0], [Math.sqrt(1000 / 15), 0, 0], 1, 0.2);  // R=15 圆轨道
  const E0 = w.energy(), L0 = w.angularMomentum();
  let maxDE = 0, maxDLvec = 0;
  for (let i = 0; i < 3000; i++) {
    w.step(0.01);
    maxDE = Math.max(maxDE, Math.abs(w.energy() / E0 - 1));
    maxDLvec = Math.max(maxDLvec, relErr(w.angularMomentum(), L0));
  }
  console.log(`  3000 步：能量漂移 = ${(maxDE * 100).toExponential(3)}%  角动量矢量(方向+大小)漂移 = ${(maxDLvec * 100).toExponential(3)}%`);
}

// ==================== G4 数学规律 MG：几何约束律（球面约束，纯结构非力） ====================
{
  console.log('\n── G4 数学规律 MG·几何约束律：物体被约束在半径 R=10 的球面上（非力，每步投影）──');
  const w = new RealWorld3D({ G: 1, M: 1000, rMin: 0.5, constraint: { type: 'sphere', R: 10 } });
  // 故意放非球面初始位置 + 含径向速度
  w.addBody([3, 4, 0], [1, 1, 5], 1, 0.2);
  w.addBody([12, 0, 5], [-2, 0, 1], 1, 0.2);
  w.addBody([-2, -2, -2], [0, 3, -1], 1, 0.2);
  for (let i = 0; i < 200; i++) w.step(0.01);
  let maxRad = 0, maxVr = 0;
  for (const b of w.bodies) {
    const r = norm(b.pos);
    const vr = b.vel[0] * b.pos[0] / r + b.vel[1] * b.pos[1] / r + b.vel[2] * b.pos[2] / r;
    maxRad = Math.max(maxRad, Math.abs(r - 10));
    maxVr = Math.max(maxVr, Math.abs(vr));
  }
  console.log(`  200 步后：max|r−R| = ${maxRad.toExponential(3)}  max|径向速度| = ${maxVr.toExponential(3)}`);
  console.log(`  ↑ 几何约束律"物体永远在球面上且只沿切向运动"逐位满足；注意这是数学结构，不守恒物理能量（诚实）`);
}

// ==================== G5 数学规律 MI：三大对称 → 三守恒（孤立 N 体，无中心质量） ====================
{
  console.log('\n── G5 数学规律 MI·不变量律：孤立 N 体（M=0, 互引力）→ 动量/角动量/能量 由对称推出并守恒 ──');
  const w = new RealWorld3D({ G: 1, M: 0, rMin: 0.5, mutual: true });
  w.addBody([5, 0, 0], [0, 1, 0], 1, 0.2);
  w.addBody([-3, 4, 0], [0, 0, -0.7], 1, 0.2);
  w.addBody([0, -2, 6], [0.5, 0.3, 0], 1, 0.2);
  const E0 = w.energy(), L0 = w.angularMomentum(), P0 = w.momentum();
  let maxDE = 0, maxDL = 0, maxDP = 0;
  for (let i = 0; i < 4000; i++) {
    w.step(0.005);
    maxDE = Math.max(maxDE, Math.abs(w.energy() / E0 - 1));
    maxDL = Math.max(maxDL, relErr(w.angularMomentum(), L0));
    maxDP = Math.max(maxDP, relErr(w.momentum(), P0));
  }
  console.log(`  4000 步：能量(时间平移对称)漂移 = ${(maxDE * 100).toExponential(3)}%`);
  console.log(`           角动量(SO(3)旋转对称)漂移 = ${(maxDL * 100).toExponential(3)}%`);
  console.log(`           动量(平移对称)漂移 = ${(maxDP * 100).toExponential(3)}%`);
}

// ==================== G6 现实规律·弹性碰撞：总动量 + 总动能守恒 ====================
{
  console.log('\n── G6 现实规律·弹性碰撞（M=0 无引力，仅碰撞相互作用）：动量 + 动能守恒 ──');
  const w = new RealWorld3D({ G: 1, M: 0, rMin: 0.5, collide: true });
  w.addBody([-5, 0, 0], [1, 0, 0], 1, 0.5);
  w.addBody([5, 0, 0], [-1, 0, 0], 1, 0.5);
  const KE0 = w.bodies.reduce(function (s, b) { return s + 0.5 * b.mass * norm(b.vel) ** 2; }, 0);
  const P0 = w.momentum();
  for (let i = 0; i < 200; i++) w.step(0.01);
  const KE1 = w.bodies.reduce(function (s, b) { return s + 0.5 * b.mass * norm(b.vel) ** 2; }, 0);
  const P1 = w.momentum();
  console.log(`  对撞后：总动量模漂移 = ${(relErr(P1, P0) * 100).toExponential(3)}%  总动能漂移 = ${(Math.abs(KE1 / KE0 - 1) * 100).toExponential(3)}%`);
  console.log(`  末速度 v=(${w.bodies.map(function (b) { return '[' + b.vel.map(function (v) { return v.toFixed(3); }).join(',') + ']'; }).join(' ')})  ← 等质量正碰应反向`);
}

// ==================== G7 fail-closed：距原点过近直接拒 ====================
{
  console.log('\n── G7 奇点护栏：物体初始距原点 < rMin 必须拒绝启动（fail-closed）──');
  const w = new RealWorld3D({ G: 1, M: 1000, rMin: 0.5 });
  w.addBody([0.1, 0, 0], [0, 0, 0], 1, 0.2);
  let ok = false, msg = '';
  try { w.step(0.01); } catch (e) { ok = true; msg = e.message.split('（')[0]; }
  console.log(`  ${ok ? '✅' : '❌'} r=0.1 < rMin=0.5：${ok ? '已拒绝 — ' + msg : '未拦截！'}`);
}

console.log('\n=== JS 轨结束 ===');
