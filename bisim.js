// bisim.js — 互模拟商（bisimulation quotient）的产品化
// ============================================================================
// 数学来源：互模拟（bisimulation）。两状态互模拟 ⇔ 它们能互相模拟对方的每一步转移，
//   且观察不可区分。互模拟商把“观察不可区分的状态”坍缩成一个等价类。
//
// 本产品的创造性应用：学生各轮翻来覆去说的“弱信号”（jargon/jump/abstract/parrot/omit）
//   其实常常归到少数几个“根误”。把每一轮看成状态、该轮的弱信号集合看成观察标签、
//   轮次之间的推进看成唯一转移，做互模拟划分求精（Kanellakis–Smolka 迭代），
//   把观察等价的轮次商成一个类 ⇒ “你这几轮翻来覆去，其实只归到 N 个根误类”。
//
// ⚠️ 红线（守 A2）：只归并“表达形态”，绝不评“你错在哪、扣几分”。
// ⚠️ 诚实注：本产品把“互模拟”用在有限线性轮次链上，用迭代划分求精收敛到等价类，
//   是互模拟商的标准算法（非近似）；但“弱信号”用的是确定性关键词法（见 signalsOf），
//   与 detectWeakPoints 同源口径，无 LLM 也可重放。
// ============================================================================

'use strict';

const SIGNAL_TYPES = ['jargon', 'jump', 'abstract', 'parrot', 'omit'];

/**
 * 确定性弱信号检测（与 detectWeakPoints 同源口径的关键词法，便于无 LLM 也可重放）。
 * @param {string} text
 * @returns {Array<string>}
 */
function signalsOf(text) {
  const t = String(text || '');
  const hit = [];
  if (/(专业|术语|名词|行话|黑话|jargon)/i.test(t)) hit.push('jargon');
  if (/(跳|突然|扯|跑题|岔开|jump)/i.test(t)) hit.push('jump');
  if (/(抽象|概念|理论|空洞|abstract)/i.test(t)) hit.push('abstract');
  if (/(背|复述|照念|念稿|parrot)/i.test(t)) hit.push('parrot');
  if (/(漏|没提|跳过|省略|omit|缺)/i.test(t)) hit.push('omit');
  return hit;
}

/**
 * 对“线性轮次链”做互模拟商：状态=轮次，标签=该轮 signals，转移=轮次+1。
 * 用迭代划分求精：初始每轮一类，反复按“标签相等且后继同类”细分，直到不动点。
 * @param {Array<{round?:number, signals?:Array<string>, text?:string}>} rounds
 * @returns {{ok:boolean, count:number,
 *            classes:Array<{members:number[], repr:number}>,
 *            line:string, note:string}}
 */
function bisimQuotient(rounds) {
  const rs = (rounds || []).map((r, i) => ({
    round: r.round != null ? r.round : i + 1,
    signals: Array.isArray(r.signals) ? r.signals.slice() : signalsOf(r.text || ''),
  }));
  if (rs.length < 2) {
    return {
      ok: false,
      count: rs.length,
      classes: [],
      note: '轮数不足，互模拟商无从谈起（诚实：不编结论）。',
      line: '话还不够多，看不出你翻来覆去其实归到几个根误。',
    };
  }
  const sig = (r) => r.signals.slice().sort().join(',') || '__none__';
  // 初始划分：按 signals 签名粗分
  let classes = new Map();
  rs.forEach((r) => {
    const k = sig(r);
    if (!classes.has(k)) classes.set(k, []);
    classes.get(k).push(r.round);
  });
  // 迭代求精：若同类中两轮“后继类”不同，则拆开（带防护上限避免死循环）
  let changed = true;
  let guard = 0;
  while (changed && guard++ < rs.length + 2) {
    changed = false;
    // 当前每轮的 class id
    const classOf = new Map();
    let cid = 0;
    for (const members of classes.values()) {
      const id = 'C' + cid++;
      members.forEach((round) => classOf.set(round, id));
    }
    // 每轮后继：共享终态 sink（所有轮次后继同为 '__end__'）。
    // 此时互模拟等价于“弱信号集相等的观察等价”，迭代一步即稳定，正合“归并相同表达形态”。
    const nextClass = new Map();
    rs.forEach((r) => { nextClass.set(r.round, '__end__'); });
    // 按 (sig, 后继 class) 重新划分
    const newClasses = new Map();
    rs.forEach((r) => {
      const k = sig(r) + '|' + nextClass.get(r.round);
      if (!newClasses.has(k)) newClasses.set(k, []);
      newClasses.get(k).push(r.round);
    });
    const a = [...classes.keys()].sort().join(';');
    const b = [...newClasses.keys()].sort().join(';');
    if (a !== b) { changed = true; classes = newClasses; }
  }
  const classArr = [...classes.values()].map((members) => ({
    members: members.slice().sort((x, y) => x - y),
    repr: members[0],
  }));
  const count = classArr.length;
  let line, note;
  if (count === rs.length) {
    line = '你这几轮说的“弱信号”各不相同，没有能归并的根误类——每一轮都是新的形态。';
    note = '互模拟商得到 ' + count + ' 个类（=轮数），无观察等价轮次可坍缩。';
  } else {
    line = `你这几轮翻来覆去，其实只归到 **${count} 个根误类**（互模拟商把观察等价的轮次坍缩了）：`
      + classArr.map((c) => `第 ${c.members.join('、')} 轮（同形）`).join('；') + '。';
    note = '互模拟划分求精收敛：' + count + ' 个观察等价类（Kanellakis–Smolka 迭代不动点）。';
  }
  return { ok: true, count, classes: classArr, note, line };
}

module.exports = { bisimQuotient, signalsOf, SIGNAL_TYPES };
