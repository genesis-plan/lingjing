// convergence.js — 不动点分析：把「映射的自映射不动点」思想装进镜子
// ============================================================================
// 数学来源（本轮查的硬核论文，非教育类）：
//   • Banach 压缩映射定理（1922）：完备度量空间上自映射 T:X→X，若
//       d(Tx,Ty) ≤ q·d(x,y)  (0≤q<1)，则 T 有【唯一不动点】，且迭代
//       x_{n+1}=T(x_n) 必收敛到它（序列是 Cauchy 的）。
//   • 本产品里，「镜子」就是这样一个自映射：把学生第 n 轮讲法的概念分布
//       映到第 n+1 轮的概念分布。相邻两轮分布之间的距离，恰好就是 Φ 已经
//       算出来的 W1 传输成本（transport.series 里的 w1）。
//     ⇒ w1[n] = d(状态_n, 状态_{n+1})，正是 Banach 定理里相邻迭代的距离。
//     ⇒ 若这些距离一轮比一轮小（几何递减），反射序列就是 Cauchy 的，
//       必收敛到一个「稳定的自我画像」——那，就是反射映射的不动点。
//
// ⚠️ 红线（守 A2）：本模块【不产出任何人学得好的量】。它只讲反射序列
//   「在收敛 / 还在漂移 / 在摇摆」，不评对错、不打分、不给掌握度。判词只用
//   converged / converging / drifting / oscillating。
// ============================================================================

'use strict';

/**
 * 依据 Φ 给出的逐轮 W1 距离序列，做 Banach 式不动点判定。
 * @param {Array<{round:number, w1:?number, note?:string}>} series
 *        transportAlong 的输出：每两轮反射态之间的 W1 距离（null=该轮算不出）。
 * @returns {{status:string, converged:boolean, qEst:?number, dFirst:?number,
 *            dLast:?number, line:string, note:string}}
 */
function analyzeConvergence(series) {
  const valid = (series || [])
    .filter((s) => s && typeof s.w1 === 'number' && isFinite(s.w1))
    .map((s) => s.w1);

  if (valid.length < 2) {
    return {
      status: 'insufficient',
      converged: false,
      qEst: null,
      dFirst: valid[0] != null ? valid[0] : null,
      dLast: null,
      line: '话还不够多（至少两轮才有距离可量），看不出你在收敛还是漂移。',
      note: '不足两轮，不动点分析无从谈起（诚实：不编结论）。',
    };
  }

  // 相邻迭代距离的比值序列：ratio_i = d_{i+1} / d_i
  // 对压缩映射，这些比值应全部 ≤ 某个 q<1（且越小收敛越快）。
  const ratios = [];
  for (let i = 0; i + 1 < valid.length; i++) {
    if (valid[i] > 1e-9) ratios.push(valid[i + 1] / valid[i]);
  }
  // 取最大比值作为「最坏情况收缩常数」上界 qEst。
  const qEst = ratios.length ? Math.max(...ratios) : 1;
  const dFirst = valid[0];
  const dLast = valid[valid.length - 1];
  const shrinking = dLast < dFirst;                       // 整体在变小
  const monotone = ratios.length > 0 && ratios.every((r) => r <= 1 + 1e-6); // 单调不增

  let status, line, note;
  if (qEst < 0.85 && shrinking) {
    // 距离每轮显著缩小 ⇒ 几何递减 ⇒ 序列 Cauchy ⇒ 存在唯一不动点（稳定自我画像）
    status = 'converged';
    line =
      `你的理解在收敛：相邻两轮讲法的距离一轮比一轮小（收缩比约 ${qEst.toFixed(2)}），` +
      `正逼近一个稳定的自我画像。这面镜子照见的，正是你不再漂移的那一刻——` +
      `这就是反射映射的不动点（Banach 压缩映射定理：距离几何递减的迭代必收敛到唯一不动点）。`;
    note = '满足压缩映射必要条件：d_n 几何递减 ⇒ 迭代序列 Cauchy ⇒ 不动点存在且唯一。';
  } else if (qEst < 1 && shrinking) {
    status = 'converging';
    line =
      `你的理解在慢慢收拢：距离在缩小但每步收得不多（收缩比约 ${qEst.toFixed(2)}）。` +
      `再讲几轮，可能就照见那个不动点了。`;
    note = '弱收缩：距 0 收敛，但尚未稳定到可以断言不动点。';
  } else if (qEst >= 1 && !shrinking) {
    // 距离不缩反张 ⇒ 不满足压缩条件 ⇒ 迭代未必收敛 ⇒ 没有压出不动点
    status = 'drifting';
    line =
      `你的理解还在漂移：相邻两轮讲法的距离没有缩小（收缩比约 ${qEst.toFixed(2)}，≥1），` +
      `你每轮都在重起炉灶，反射映射没有压出不动点——还没照见一个稳定的自己。`;
    note = '不满足压缩条件：迭代序列未必收敛，不动点不存在或未被逼近。';
  } else {
    // 比值忽大忽小 ⇒ 非单调 ⇒ 未在单一方向压缩
    status = 'oscillating';
    line =
      `你的理解在摇摆：距离一会儿缩一会儿涨（收缩比最高到 ${qEst.toFixed(2)}），` +
      `你还没落定到一个稳定的讲法上。`;
    note = '非单调：反射映射未在单一方向上压缩，不动点未显现。';
  }

  return {
    status,
    converged: status === 'converged' || status === 'converging',
    qEst: Number(qEst.toFixed(3)),
    dFirst: Number(dFirst.toFixed(4)),
    dLast: Number(dLast.toFixed(4)),
    line,
    note,
  };
}

/**
 * FCA 不动点注记：概念格里每个节点都是闭包算子的不动点。
 * 依据（aciego / bloch 的 FCA 论文）：闭包算子 c 幂等 c(c(X))=c(X)，
 * 其不动点集 {X | c(X)=X} 恰好构成概念格。本产品 Λ 的 closureOf 即此闭包算子，
 * conceptOf 返回的每对 (extent,intent) 都是它的不动点。
 * @param {{concepts?:Array<{extent:Array<number>,intent:Array<string>}>}} lattice
 * @returns {string} 一句人话注记（无评分）
 */
function fcaFixedPointNote(lattice) {
  const n = lattice && Array.isArray(lattice.concepts) ? lattice.concepts.length : 0;
  if (!n) return '';
  return (
    `〔数学上，概念格里每一个节点都是闭包算子的不动点：对闭包 c 有 c(c(X))=c(X)。` +
    `你反复讲的东西一旦闭包就停住，那个停住的点就是一个「概念」——` +
    `这堂课照出的 ${n} 个概念，就是 ${n} 个不动点。〕`
  );
}

module.exports = { analyzeConvergence, fcaFixedPointNote };
