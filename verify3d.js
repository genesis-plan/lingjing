/**
 * 灵境 · 三维虚拟仿真验真（JS 轨）
 * ----------------------------------------------------------------------------
 * 与 verify3d.py 跑【完全相同】的场景与参数，输出逐位可比。
 * 任何一项对不上就是 bug，不是"精度差异"。
 *
 * ⚠️ 方法学（吸取首版教训，两轨一致）：
 *   1. 快照必须【拷贝】入轨迹。HeatWorld3D.flat() 返回的是 field 本体引用，
 *      step() 会原地改写它——若直接 push 引用，全部快照会塌缩成同一个终态，
 *      进而使 PᵀP 秩亏、最小二乘静默失败返回零矩阵，伪造成"预测误差 100%"。
 *   2. 重建误差必须在【基没见过】的状态上测。拿建基用的快照去测恒等于 0，
 *      是自欺指标（首版即犯此错，已修）。
 *
 * 运行：node verify3d.js
 */
'use strict';
const { HeatWorld3D, HoloMap, fitLinear, fitAffine, predict, predictAffine } = require('./rom.js');

// ---- 场景参数（两轨必须一致）----
const N = 20;                 // 每边格点数 → N³ = 8000 自由度
const SIGMA = 3.0;
const CENTER = (N - 1) / 2;
const TRAIN_STEPS = 40;       // 训练段：t=0..40
const TEST_STEPS = 20;        // 测试段：继续步进到 t=60（基未见过）
const SNAP_EVERY = 2;
const R = 8;
const H = 6;                  // L4 多步预测步数

const hotSpot = (cx, cy, cz) => (i, j, k) => {
  const d = (i - cx) ** 2 + (j - cy) ** 2 + (k - cz) ** 2;
  return Math.exp(-d / (2 * SIGMA * SIGMA));
};
const OPTS = { alpha: 0.2, dt: 0.5, dx: 1.0, boundary: 0.0 };

function norm(v) { let s = 0; for (let i = 0; i < v.length; i++) s += v[i] * v[i]; return Math.sqrt(s); }
function relErr(a, b) { return norm(a.map((x, i) => x - b[i])) / (norm(b) || 1); }

console.log('=== 灵境 3D 验真 · JS 轨 ===');

// ==================== L1+L2：三维热传导演化 ====================
const w = new HeatWorld3D(N, N, N, OPTS);
w.init(hotSpot(CENTER, CENTER, CENTER));
console.log(`网格 ${N}×${N}×${N} = ${w.N} 自由度 | λ=α·dt/dx²=${w.lam.toFixed(6)} (3D CFL 上限 0.166667)`);

const holo = new HoloMap(w.N, 200);
const psiSeq = [];
for (let t = 0; t <= TRAIN_STEPS; t++) {
  if (t % SNAP_EVERY === 0) {
    const snap = w.flat().slice();      // ★ 必须拷贝
    holo.collect(snap);
  }
  if (t < TRAIN_STEPS) w.step();
}
const sTrainEnd = w.stats();
console.log(`  L1 t=${TRAIN_STEPS}（训练段末） max=${sTrainEnd.max.toFixed(6)}  mean=${sTrainEnd.mean.toFixed(6)}`);

// ==================== L3：全息降阶 ====================
const built = holo.build(R);
console.log(`  L3 降阶 r=${built.r}  能量捕获率=${(built.energy * 100).toFixed(4)}%  压缩比=${(w.N / built.r).toFixed(1)}:1`);
console.log(`  L3 有效秩=${holo.effectiveRank()}  谱断崖位置=${holo.cliffIndex()}`);

// 训练段上的 psi 序列（L4 用），必须是【不同时刻】的真序列
for (const s of holo.snaps) { const p = holo.project(s); if (p) psiSeq.push(p); }
// ★ 留存一份"干净"训练快照：下面分布外/自适应实验会【故意污染 holo】（把 OOD 帧吸收进基），
//   L4 必须在干净基上测，否则会被污染基带偏（曾据此误报 4.7e-1）。
const trainSnaps = holo.snaps.map(function (s) { return s.slice(); });

// ==================== L5：分布内【留出】测试 ====================
for (let t = 0; t < TEST_STEPS; t++) w.step();
const sTest = w.stats();
console.log(`  L1 t=${TRAIN_STEPS + TEST_STEPS}（测试段末） max=${sTest.max.toFixed(6)}  mean=${sTest.mean.toFixed(6)}`);
const errIn = holo.reconError(w.flat());
console.log(`  L5 重建误差 · 分布内(留出) = ${(errIn * 100).toFixed(4)}%`);

// ==================== L5：分布外（热点挪到别处） ====================
const wOOD = new HeatWorld3D(N, N, N, OPTS);
wOOD.init(hotSpot(4, 4, 4));
for (let t = 0; t < 20; t++) wOOD.step();
const errOut = holo.reconError(wOOD.flat());
console.log(`  L5 重建误差 · 分布外       = ${(errOut * 100).toFixed(4)}%`);

// ==================== 自适应：吸收 1 帧后，在【另一个】OOD 状态上测泛化 ====================
holo.collect(wOOD.flat().slice());
holo.build(R);
const errSameAfter = holo.reconError(wOOD.flat());
const wOOD2 = new HeatWorld3D(N, N, N, OPTS);
wOOD2.init(hotSpot(15, 15, 5));
for (let t = 0; t < 20; t++) wOOD2.step();
const errOtherAfter = holo.reconError(wOOD2.flat());
console.log(`  L5 自适应后·同状态         = ${(errSameAfter * 100).toFixed(4)}%（吸收进基，属记忆非泛化）`);
console.log(`  L5 自适应后·另一 OOD 状态 = ${(errOtherAfter * 100).toFixed(4)}%（这才是泛化）`);

// ==================== L4：边界低维动力学（线性 vs 仿射；样本内 vs 样本外） ====================
/* ⚠️ 方法学（这里踩过两个坑，写在这里防止复发）
   坑 1 · 背答案：早期版本用 predictAffine(A, psiSeq[0], H) 去比 psiSeq[H]——
          起点和终点【都是训练快照】，本质是样本内复现，误差 1e-9 量级毫无预测意义。
          现已改为【样本外自由演化】：从训练段末状态出发，向基从未见过的未来递推。
   坑 2 · 跨距错配：快照每 SNAP_EVERY 个物理步存一张 ⇒ 拟合出的 A 是"两步映射"。
          递推 1 次必须走 SNAP_EVERY 个物理步；若按 1 步递推，等于让预测跑双倍速，
          误差会虚高到 1e-1 量级（曾据此误判"模型不行"，实为脚本 bug）。
   结论口径：L4 误差应当与 L5 投影底线同量级——边界预测本身几乎不引入额外误差。 */
// 用干净基重建（此时 holo 已被自适应当作实验污染）
const holoL4 = new HoloMap(w.N, 200);
for (const s of trainSnaps) holoL4.collect(s.slice());
holoL4.build(R);
const seqL4 = holoL4.snaps.map(function (s) { return holoL4.project(s); });
const fit = fitLinear(seqL4);
const fitA = fitAffine(seqL4);

// ---- 样本内（背答案，仅作对照，不得用于对外宣称）----
if (fit) console.log(`  L4 线性拟合 残差(样本内)     = ${fit.relErr.toExponential(4)}`);
console.log(`  L4 仿射拟合 残差(样本内)     = ${fitA.relErr.toExponential(4)}`);
if (fit) {
  const predIn = predict(fit.A, psiSeq[0], H);
  console.log(`  L4 线性 ${H} 步(样本内/背答案) = ${relErr(predIn[H], psiSeq[H]).toExponential(4)}`);
}
const predInA = predictAffine(fitA.A, psiSeq[0], H);
console.log(`  L4 仿射 ${H} 步(样本内/背答案) = ${relErr(predInA[H], psiSeq[H]).toExponential(4)}`);

// ---- 样本外自由演化（这才是真正的预测）----
const w4 = new HeatWorld3D(N, N, N, OPTS);
w4.init(hotSpot(CENTER, CENTER, CENTER));
for (let t = 0; t < TRAIN_STEPS; t++) w4.step();   // 推进到训练段末 t=TRAIN_STEPS
let psiL = holoL4.project(w4.flat());
let psiA = holoL4.project(w4.flat());
for (let blk = 0; blk < H; blk++) {
  for (let q = 0; q < SNAP_EVERY; q++) w4.step();  // 跨距严格对齐
  if (fit) psiL = predict(fit.A, psiL, 1)[1];
  psiA = predictAffine(fitA.A, psiA, 1)[1];
}
const truthH = w4.flat();
const floorH = holoL4.reconError(truthH);          // L5 投影底线（同 horizon）
if (fit) {
  console.log(`  L4 线性 ${H} 步(样本外/真预测) = ${relErr(Array.from(holoL4.reconstruct(psiL)), Array.from(truthH)).toExponential(4)}`);
}
console.log(`  L4 仿射 ${H} 步(样本外/真预测) = ${relErr(Array.from(holoL4.reconstruct(psiA)), Array.from(truthH)).toExponential(4)}`);
console.log(`  L5 投影底线(同 horizon)      = ${(floorH * 100).toFixed(4)}%（L4 应与之同量级）`);

console.log('=== JS 轨结束 ===');
