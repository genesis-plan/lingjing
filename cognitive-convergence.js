// cognitive-convergence.js — 认知收敛判据
// ============================================================================
// 把"人类使用者的理解过程"建模为一个函数极限，并用三条已落地的数学思想
// 合成一个可观测的【收敛判据】：
//
//   你从不同方法/角度出发  →  数学上的不同数列 {x_n}（Heine：每一条都是一条路径）
//   在去心邻域(0<|x-x0|<δ)内  →  你已"进入理解的邻域"，但永不"踩上"洞察点(去心)
//   函数值超过极限的一半  →  局部保号性推论：lim f=A>0 ⇒ 邻域内 f>A/2
//                             （你的方向/符号判断，在邻近例子里还保号吗）
//   最终达到极限  →  认知收敛：你讲的在不同角度下都收同一个理解
//   不同方法收同一极限  →  Heine 归结原则：lim 存在 ⟺ 每条路径都→A（条条大道通罗马）
//
// 三条已落地模块在本判据里的角色：
//   • 保号性（teachingfn.signPreservation）= 局部条件：方向判断在邻域里保号
//   • Heine / 互模拟（coalgebra.bisimilar）= 全局条件：所有路径收同一理解
//   • 收敛核（coalgebra.greatestFixedPoint）= 把"持续出现在末尾轮次的概念"算作极限
//
// ⚠️ 诚实边界（不虚报）：
//   • 我们【只观测到使用者的回复】，观测不到"每个探测如何改变理解"的转移函数。
//     因此 Heine 的"所有路径→同一极限"在这里用【可观测版本】实现：
//     各探测角度(strand)的回答序列都收束到同一概念签名集合 = 同一理解。
//     严格的余代数版（bisimilar = 条条大道通罗马）是理论根据，已落在 coalgebra.js。
//   • 收敛 ≠ "你已掌握"。去心邻域意味着镜子只认证【趋近稳定】，从不声称你
//     "踩上了"洞察点（极限点本身被挖去，是渐近线）。
//   • 全程不评分（守 A2）。只给判据结论：收敛 / 局部保号但路径依赖 /
//     各角度一致但方向翻号 / 发散。
// ============================================================================

'use strict';

const tfn = require('./teachingfn.js');
const coal = require('./coalgebra.js');

/** 概念签名（复用 teachingfn.sigOf） */
function sigOf(text, concepts) {
  return tfn.sigOf(text, concepts);
}

/** 众数签名：一串签名里出现最多的那个（=该路径/该半段的"极限"候选） */
function modalSig(sigs) {
  const tally = new Map();
  for (const s of sigs) if (s) tally.set(s, (tally.get(s) || 0) + 1);
  let best = '';
  let n = -1;
  for (const [s, c] of tally) if (c > n) { n = c; best = s; }
  return best;
}

/** 按探测类型(strand=方法/路径)分组回答签名，保持轮次序 */
function strandSignatures(probes, concepts) {
  const byType = new Map();
  for (const p of (Array.isArray(probes) ? probes : [])) {
    if (p && p.answer != null && p.type) {
      if (!byType.has(p.type)) byType.set(p.type, []);
      byType.get(p.type).push(sigOf(String(p.answer), concepts));
    }
  }
  return byType;
}

/**
 * 收敛核 = 在最后 K 轮里【持续出现】的概念之最大不动点（gfp）。
 *   F(S) = { c∈S | c 在尾部每轮签名里都出现 }
 * 从全空间向下迭代到不动；gfp = 极限（持续在场的理解核心）。
 * @param {Array<string>} concepts
 * @param {Array<string>} seq  每轮回复的概念签名（已过滤空串）
 * @param {number} K
 * @returns {Set<string>}
 */
function convergedCore(concepts, seq, K) {
  const tail = seq.slice(-K).filter(Boolean);
  if (!tail.length) return new Set();
  const universe = new Set(concepts.map(String));
  const F = (S) => {
    const out = new Set();
    for (const c of S) {
      const presentEverywhere = tail.every((sig) => sig.split('|').includes(c));
      if (presentEverywhere) out.add(c);
    }
    return out;
  };
  return coal.greatestFixedPoint(F, universe, { maxIter: concepts.length + 2 }).fixed;
}

/**
 * 认知收敛判据主函数
 * @param {{concepts:Array<string>, rounds:Array<{round:number,text:string}>, probes:Array, sign?:Object}} o
 * @returns {{ok:boolean, verdict:string, localPreserved:boolean, pathIndependent:boolean,
 *            limitExists:boolean, core:Array<string>, directionalCount:number,
 *            notPreservedCount:number, line:string, note:string}}
 */
function cognitiveConvergence(o = {}, opts = {}) {
  const cs = (o.concepts || []).map(String);
  const rnds = Array.isArray(o.rounds) ? o.rounds : [];
  const prbs = Array.isArray(o.probes) ? o.probes : [];
  if (!cs.length || rnds.length < 2) {
    return {
      ok: false, verdict: 'unknown', localPreserved: false, pathIndependent: false,
      limitExists: false, core: [], directionalCount: 0, notPreservedCount: 0,
      line: '轮次不足两轮，你还没进入理解的去心邻域（无从谈趋近与收敛）。多讲几轮，镜子才能判。',
      note: '',
    };
  }

  // (1) 局部保号性：方向判断在邻近情形里还保号吗
  const sp = o.sign || tfn.signPreservation({ concepts: cs, rounds: rnds, probes: prbs });
  const localPreserved = sp.ok && sp.notPreserved.length === 0;

  // (2) 趋近序列：每轮回复触及的概念签名 = 数列的项
  const seq = rnds.map((r) => sigOf(String(r.text || ''), cs)).filter((s) => s !== '');
  if (seq.length < 2) {
    return {
      ok: false, verdict: 'unknown', localPreserved, pathIndependent: false,
      limitExists: false, core: [], directionalCount: sp.directional.length, notPreservedCount: sp.notPreserved.length,
      line: '你的回复里没有足够可比对的内容，趋近序列凑不出来（诚实拒绝）。',
      note: '',
    };
  }

  // (3) 收敛核（gfp）：持续出现在末尾轮次的概念 = 极限
  const K = Math.min(3, seq.length);
  const core = [...convergedCore(cs, seq, K)];
  const tailModal = modalSig(seq.slice(-K));
  const limitExists = !!tailModal; // 末尾有稳定的理解形态 ⇒ 极限存在（序列有收束趋势）

  // (4) Heine / 条条大道（可观测版）：所有路径收同一理解
  //   多条 strand(探测角度) → 各自极限签名相等；否则用前后半段比较
  const strands = strandSignatures(prbs, cs);
  const strandLimits = [...strands.values()].map(modalSig).filter(Boolean);
  let pathIndependent;
  if (strandLimits.length >= 2) {
    pathIndependent = new Set(strandLimits).size === 1; // 各方法收同一极限
  } else {
    const half = Math.ceil(seq.length / 2);
    pathIndependent = modalSig(seq.slice(0, half)) === modalSig(seq.slice(half)); // 前后半收同一极限
  }

  // (5) 综合判据
  let verdict;
  let line;
  if (localPreserved && pathIndependent) {
    verdict = 'converged';
    line = '✅ 认知收敛：你给的方向判断在邻近情形里都保了号（局部保号性，邻域内保持在 A/2 之上），' +
      '且不同角度/轮次的讲授流都收同一个理解（Heine：条条大道通罗马）。这比"讲了好多轮"硬得多——' +
      '是收敛，不是堆砌。收敛核 = ' + (core.length ? core.join('、') : '（空）') + '。';
  } else if (localPreserved && !pathIndependent) {
    verdict = 'local-ok-global-divergent';
    line = '⚠️ 局部保号，但路径依赖：你的方向判断在邻近例子里站得住，可换个角度/轮次，理解就分了叉——' +
      '说明这理解还没真正收敛，只是局部对。就像某条趋近路径上方向翻了，极限便不存在。';
  } else if (!localPreserved && pathIndependent) {
    verdict = 'global-ok-local-flip';
    line = '⚠️ 各角度收得一致，但你的方向判断在邻近情形里翻了号（没保号）：' +
      '理解框架稳，可结论的方向性站不住——差一处翻号反例就垮。';
  } else {
    verdict = 'divergent';
    line = '❌ 发散：方向判断在邻近情形翻号、且不同角度收不到同一个理解。' +
      '按 Heine，存在一条路径不收同一极限 ⇒ 极限不存在——你的理解在此处尚未收敛。';
  }

  const note =
    '局部=保号性(signPreservation.notPreserved 空)；全局=Heine 可观测版(各探测角度的回答序列收同一概念签名集)；' +
    '收敛核=greatestFixedPoint(末尾 K 轮持续在场的概念)。去心邻域=轮次序列：镜子只认证【趋近稳定】，' +
    '从不声称你"踩上"洞察点(极限点本身被挖去)。三件套合成认知收敛判据。严格余代数版(条条大道=互模拟)见 coalgebra.js。';

  return {
    ok: true, verdict, localPreserved, pathIndependent, limitExists,
    core, directionalCount: sp.directional.length, notPreservedCount: sp.notPreserved.length,
    line, note,
  };
}

module.exports = { cognitiveConvergence, convergedCore, modalSig, strandSignatures };
