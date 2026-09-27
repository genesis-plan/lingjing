'use strict';
/*
 * coalgebra.js — 余代数 / 互模拟 / 余归纳（无限讲授的数学根据）
 * ----------------------------------------------------------------------------
 * 数学根据（实查，非记忆）：
 *   互模拟（bisimulation）= 谓词变换子的【最大不动点】（Knaster–Tarski 的 gfp 对偶）；
 *   最终余代数给所有系统唯一同态，互模拟态有相等最终语义（Rutten 2000 *Universal Coalgebra*；
 *   "Companions, Causality and Codensity" 综述：bisimilarity = gfp of a monotone transformer on 关系格）。
 *
 * 产品语义（灵境）：
 *   (1) **无限讲授 = 余归纳流**：镜子的理解态是余代数 X→F(X) 的展开（A3 append-only 的数学根据——
 *       它不是一个会"结束"的归纳构造，而是永不终止、只不断展开的余归纳流）。
 *   (2) **条条大道通罗马 = 互模拟**：两条传授路径（探针对序列）若互模拟 ⇒ 行为等价 ⇒
 *       它们通向同一个理解。这是 Heine"所有路径→同一 A"的余代数版严格判据。
 *   (3) gfp 与本仓库 tarski.js 的 lfp 是同一台机器的两面：理解闭包 = lfp（最小），
 *       路径等价 = gfp（最大）。
 *
 * 红线：不评分、不上权重。有界计算，超出诚实返回 unknown。
 */

function setEq(a, b) {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

/**
 * 通用最大不动点：在有限集 universe 的幂集上，F 单调，
 * gfp = 从全空间向下迭代到不动（对偶于 tarski.js 的 lfp 从 ⊥ 向上）。
 * @param {(Set)=>Set} F 单调变换子
 * @param {Set} universe
 * @param {Object} opts { maxIter?:number }
 * @returns {{fixed:Set, iter:number, stable:boolean}}
 */
function greatestFixedPoint(F, universe, opts = {}) {
  const U = universe instanceof Set ? universe : new Set(universe);
  const cap = opts.maxIter || (U.size + 2);
  let X = new Set(U);
  for (let i = 0; i < cap; i++) {
    const next = F(X);
    if (setEq(next, X)) return { fixed: X, iter: i, stable: true };
    X = next;
  }
  return { fixed: X, iter: cap, stable: false };
}

/**
 * 最大互模拟关系（强互模拟，无标签）：
 *   变换子 T(R) = { (a,b)∈S×S | ∀a'∈step(a) ∃b'∈step(b):(a',b')∈R 且 ∀b'∈step(b) ∃a'∈step(a):(a',b')∈R }
 * gfp(T) = 最大互模拟。有界：状态对总数超 maxPairs 时诚实返回 unknown。
 *
 * @param {Array} states       状态集合 S
 * @param {(s:any)=>Array} step  step(s) → s 的后继状态数组（空数组=终止态）
 * @param {Object} opts { maxPairs?:number, key?:(s)=>string }
 * @returns {{relation:Set<string>, complete:boolean, unknown:boolean}}
 *          relation 中元素为 "ka#kb" 形式的键（默认用 JSON 或提供的 key）
 */
function bisimulationRelation(states, step, opts = {}) {
  const key = opts.key || ((s) => (typeof s === 'string' ? s : JSON.stringify(s)));
  const S = states.map(key);
  const succ = new Map();
  states.forEach((s, i) => { succ.set(S[i], (step(s) || []).map(key)); });
  const allPairs = [];
  for (const a of S) for (const b of S) allPairs.push([a, b]);
  const maxPairs = opts.maxPairs || 5000;
  if (allPairs.length > maxPairs) {
    return { relation: new Set(), complete: false, unknown: true };
  }
  const universe = new Set(allPairs.map(([a, b]) => `${a}#${b}`));
  // 变换子：从候选关系 R 到更紧的互模拟前关系
  const T = (R) => {
    const rel = new Set(R);
    const out = new Set();
    for (const [a, b] of allPairs) {
      const sa = succ.get(a) || [], sb = succ.get(b) || [];
      // 条件：a 的每个后继都能在 b 的后继里找到互模拟配对，且反之
      const fw = sa.every((a2) => sb.some((b2) => rel.has(`${a2}#${b2}`)));
      const bw = sb.every((b2) => sa.some((a2) => rel.has(`${a2}#${b2}`)));
      if (sa.length === 0 && sb.length === 0) { out.add(`${a}#${b}`); continue; } // 两终止态互模拟
      if (fw && bw) out.add(`${a}#${b}`);
    }
    return out;
  };
  const res = greatestFixedPoint(T, universe);
  return { relation: res.fixed, complete: res.stable, unknown: false };
}

/**
 * 两状态是否互模拟（"这两条传授路径是否通到同一理解"）。
 * 见 bisimulationRelation；这里只取结论布尔。
 */
function bisimilar(a, b, states, step, opts = {}) {
  const key = opts.key || ((s) => (typeof s === 'string' ? s : JSON.stringify(s)));
  const rel = bisimulationRelation(states, step, opts);
  if (rel.unknown) return { bisimilar: false, unknown: true };
  return { bisimilar: rel.relation.has(`${key(a)}#${key(b)}`), unknown: false, relation: rel };
}

module.exports = {
  greatestFixedPoint, bisimulationRelation, bisimilar, coalgebraNote:
    '无限讲授=余归纳流(A3的数学根据)；条条大道通罗马=互模拟(gfp)。与 tarski 的 lfp 同机两面。',
};
