// tarski.js — Knaster–Tarski 不动点定理：给「收敛」一个定理保证，而不是拍脑袋阈值
// ============================================================================
// 数学来源（本轮实查，非记忆）：
//   • Knaster–Tarski（Knaster 1928；Tarski 1955, Pacific J. Math. 5:285–309
//     《A lattice-theoretical fixpoint theorem and its applications》）：
//       完备格 L、单调映射 f: L→L ⇒ f 的不动点集 Fix(f) 【本身仍是完备格】。
//       于是最小不动点 lfp = ∧{x | f(x) ≤ x}、最大不动点 gfp = ∨{x | x ≤ f(x)} 都存在。
//   • Kleene 迭代：lfp = ⊔ₙ fⁿ(⊥)。无限格需要 ω-连续性；【有限格只需单调】
//     ——有限格上链高有限，⊆-递增链必然在有限步稳定，稳定点即 lfp。
//   • 应用谱系：Cousot & Cousot 1977 抽象解释、指称语义、程序不动点语义。
//
// 落到灵境为什么是【真能落】而不是硬凑——两个前提天然满足：
//   ✓ 格：P(C)（概念的幂集）在包含序下是完备格；有限 ⇒ 链高有限 = |C|+1。
//   ✓ 单调：传播算子 F(X) = X ∪ out(X) 由并集构造，单调性由构造保证。
//   所以「从 A 出发的可达闭包」根本不是"看着不再变了"，它是 F 的【最小不动点】，
//   且至多 |C| - |seed| + 1 次迭代必停——有精确上界，不需要轮询、不需要拍阈值。
//
// ⚠️ 诚实边界（不虚报）：
//   • 幂集格是 2^|C| 个元素，本模块【从不枚举格】，只沿 ⊥ 出发的那条 Kleene 链走。
//   • 对外部传入的 f，单调性只能【沿链抽样验证】（extensive 且链上不回缩），
//     这是必要条件，不是充分证明。内建传播算子的单调性由构造保证，单独标注。
//   • 本模块【不评分】（守 A2）。只说"稳定 / 还需至多 N 步 / 不单调，给不出上界"。
// ============================================================================

'use strict';

/** 集合相等（用于 Kleene 迭代的终止判据） */
function setEq(a, b) {
  if (!(a instanceof Set) || !(b instanceof Set)) return a === b;
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

/**
 * Kleene 迭代：从 bottom 出发反复应用 f，直到不再变化。
 * 有限格 + 单调 f ⇒ 必定终止，终止值即最小不动点 lfp。
 * @param {Function} f
 * @param {*} bottom
 * @param {{maxIter?:number, eq?:Function}} opts
 * @returns {{lfp:*, iterations:number, stable:boolean, chain:Array, extensive:boolean}}
 *          extensive：沿链每步都满足 X ⊆ f(X)（单调增的必要条件；外部 f 只能抽样得出）
 */
/**
 * 默认判等：任一侧是 Set 就按集合比（否则两个不同实例的空 Set 永远 `!==`，
 * 会一路撞到 maxIter 才停——这是实际踩过的坑）。
 */
function defaultEq(a, b) {
  if (a instanceof Set || b instanceof Set) return setEq(a, b);
  return a === b;
}

function kleeneIterate(f, bottom, opts = {}) {
  const eq = opts.eq || defaultEq;
  const maxIter = opts.maxIter == null ? 1024 : opts.maxIter;
  let cur = bottom;
  let iterations = 0;
  let extensive = true;
  const chain = [cur];
  const contains = (big, small) => {
    if (small instanceof Set && big instanceof Set) {
      for (const v of small) if (!big.has(v)) return false;
      return true;
    }
    return true;                                   // 非集合类型：无从判定，诚实留 true
  };

  while (iterations < maxIter) {
    const next = f(cur);
    iterations++;
    if (!contains(next, cur)) extensive = false;   // 出现了回缩 ⇒ 不是扩张的，链不单调
    if (eq(next, cur)) return { lfp: cur, iterations, stable: true, chain, extensive };
    cur = next;
    chain.push(cur);
  }
  return { lfp: cur, iterations, stable: false, chain, extensive };
}

/**
 * 归一化输入：接受 mapmodel 实例或 {concepts, maps}。
 */
function normalize(src) {
  const empty = { concepts: [], maps: [], adj: {} };
  if (!src) return empty;
  let cs = [];
  let ms = [];
  if (typeof src.concepts === 'function' && typeof src.maps === 'function') {
    cs = (src.concepts() || []).map(String);
    ms = (src.maps() || []).map((m) => ({ from: String(m.from), to: String(m.to) }));
  } else {
    cs = Array.isArray(src.concepts) ? src.concepts.map(String) : [];
    ms = Array.isArray(src.maps) ? src.maps.map((m) => ({ from: String(m.from), to: String(m.to) })) : [];
  }
  const set = new Set(cs);
  for (const m of ms) { set.add(m.from); set.add(m.to); }
  const adj = {};
  for (const c of set) adj[c] = [];
  for (const m of ms) adj[m.from].push(m.to);
  return { concepts: [...set], maps: ms, adj };
}

/**
 * 可达闭包 = 传播算子的最小不动点（Tarski 保证存在，Kleene 构造出来）。
 * F(X) = X ∪ {m.to | m.from ∈ X}，格 = P(C)。
 * @param {Object} src
 * @param {string|string[]} starts 起点概念（可多个）
 * @param {{maxIter?:number}} opts
 * @returns {{ok:boolean, closure:string[], seed:string[], iterations:number,
 *            bound:number, stable:boolean, grew:number, monotone:string,
 *            line:string, note:string}}
 *          bound：迭代次数上界 = |C| - |seed| + 1（每轮至少新增一个概念否则终止）
 */
function reachFixpoint(src, starts, opts = {}) {
  const { concepts, adj } = normalize(src);
  const universe = new Set(concepts);
  const seedArr = (Array.isArray(starts) ? starts : [starts]).map(String).filter((c) => universe.has(c));

  if (!concepts.length || !seedArr.length) {
    return {
      ok: false, closure: [], seed: seedArr, iterations: 0, bound: 0, stable: false, grew: 0,
      monotone: 'unknown',
      line: '图是空的，或起点不在图里——不动点无从谈起（诚实拒绝，不编结论）。',
      note: '空图 / 起点缺失。',
    };
  }

  const seed = new Set(seedArr);
  const F = (X) => {
    const n = new Set(X);
    for (const c of X) for (const v of adj[c] || []) n.add(v);
    return n;
  };

  const bound = concepts.length - seed.size + 1;    // 有限格上的精确迭代上界
  const r = kleeneIterate(F, seed, {
    maxIter: opts.maxIter == null ? bound + 1 : opts.maxIter,
    eq: setEq,
  });

  return {
    ok: true,
    closure: [...r.lfp].sort(),
    seed: seedArr,
    iterations: r.iterations,
    bound,
    stable: r.stable,
    withinBound: r.iterations <= bound,
    grew: r.lfp.size - seed.size,
    monotone: 'byConstruction',                     // F 由并集构造 ⇒ 单调性不靠抽样
    line:
      `从「${seedArr.join('、')}」出发，反复施加你教的那组映射，` +
      `第 ${r.iterations} 步停住（理论上界 ${bound} 步，${r.iterations <= bound ? '未超界 ✓' : '⚠ 超界'}），` +
      `一共走到 ${r.lfp.size} 个概念。` +
      `这个"停住"不是碰巧——Knaster–Tarski 说单调映射在完备格上必有最小不动点，` +
      `Kleene 迭代 ⊔ₙ Fⁿ(⊥) 恰好把它造出来。`,
    note:
      `F(X)=X∪out(X) 在 P(C)（有限完备格）上单调，由并集构造保证；` +
      `迭代上界 |C|-|seed|+1 = ${bound}。`,
  };
}

/**
 * 讲授链的稳定性：逐轮概念集合是否单调扩张/收缩，以及还要几轮必然稳定。
 * 有限格上严格单调链的长度 ≤ |U| ⇒ 一旦单调，剩余轮数【有上界】，不必"再讲几轮看看"。
 * @param {Array<Array<string>|Set<string>>} sets 逐轮讲到的概念集合
 * @param {Array<string>} universe 全部可能概念（格的全集；缺省取所有出现过的概念）
 * @returns {{monotone:'increasing'|'decreasing'|'none', stable:boolean,
 *            remainingBound:?number, rounds:number, last:number, line:string}}
 */
function chainStability(sets, universe) {
  const arr = (sets || []).map((s) => (s instanceof Set ? new Set([...s].map(String)) : new Set((s || []).map(String))));
  const U = new Set((universe || []).map(String));
  for (const s of arr) for (const v of s) U.add(v);

  if (arr.length < 2) {
    return {
      monotone: 'none', stable: false, remainingBound: null, rounds: arr.length,
      last: arr.length ? arr[0].size : 0,
      line: '只有一轮，看不出扩张还是收缩（诚实：不给结论）。',
    };
  }

  const subset = (a, b) => { for (const v of a) if (!b.has(v)) return false; return true; };
  let inc = true;
  let dec = true;
  for (let i = 0; i + 1 < arr.length; i++) {
    if (!subset(arr[i], arr[i + 1])) inc = false;
    if (!subset(arr[i + 1], arr[i])) dec = false;
  }
  const last = arr[arr.length - 1].size;
  const stable = setEq(arr[arr.length - 1], arr[arr.length - 2]);

  if (inc && !dec) {
    const remaining = Math.max(0, U.size - last);
    return {
      monotone: 'increasing', stable, remainingBound: remaining, rounds: arr.length, last,
      line: stable
        ? '你这几轮讲到的概念集合已经不再变大——在"还有哪些概念没讲"这件事上，你已经到了不动点。'
        : `你在往外扩：每轮讲到的概念都在变多。全集一共 ${U.size} 个，当前 ${last} 个，` +
          `所以最多再 ${remaining} 轮就必然停下（有限格上严格递增链有长度上界，不需要猜）。`,
    };
  }
  if (dec && !inc) {
    const remaining = Math.max(0, last);
    return {
      monotone: 'decreasing', stable, remainingBound: remaining, rounds: arr.length, last,
      line: stable
        ? '你这几轮讲到的概念集合已经不再变小——收拢到不动点了。'
        : `你在往里收：每轮讲到的概念都在变少。当前 ${last} 个，最多再 ${remaining} 轮必然停下。`,
    };
  }
  if (inc && dec) {                                  // 前后两轮完全相同
    return {
      monotone: 'increasing', stable: true, remainingBound: 0, rounds: arr.length, last,
      line: '相邻两轮讲到的概念完全一样——已经是不动点了。',
    };
  }
  return {
    monotone: 'none', stable: false, remainingBound: null, rounds: arr.length, last,
    line: '你这几轮讲的概念一会儿多一会儿少，不成单调链——有限格的链长上界用不上，给不出"还要几轮"的保证（诚实：不编上界）。',
  };
}

/**
 * Tarski 视角的一句话注记（给报告用，无评分）。
 */
function tarskiNote(src) {
  const { concepts, maps } = normalize(src);
  return (
    `〔Knaster–Tarski：单调映射在完备格上必有最小不动点，且不动点集本身仍是完备格。` +
    `你这 ${concepts.length} 个概念构成的幂集格里，${maps.length} 条映射合成的那个传播算子，` +
    `它的最小不动点就是"反复讲下去最终会停在哪"——有保证，不靠阈值。〕`
  );
}

module.exports = { kleeneIterate, reachFixpoint, chainStability, tarskiNote, setEq };
