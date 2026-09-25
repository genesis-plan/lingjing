// conjugacy.js — 拓扑共轭（topological conjugacy）的产品化应用
// ============================================================================
// 数学来源：拓扑共轭。两个动力系统 (X, f) 与 (Y, g) 拓扑共轭 ⇔ 存在同胚 h: X→Y 使
//   h∘f = g∘h。直觉：两个系统“行为完全相同，只是名字（坐标）不同”。
//   共轭保持：轨道结构、不动点、周期点、这几性。
//
// 本产品的创造性应用（诚实注：这是共轭思想在“学习轨迹”上的**类比代理**，
//   不是字面动力系统共轭——学习轨迹是有限状态序列，“转移图同构”是其可计算的代理）：
//   把“学生这节课实际走过的概念顺序”与“教材编排的概念顺序”各建成一张有向转移图
//   （节点=概念，边=相邻两轮/相邻两句的概念接续）。两张图同构（仅重标号不同）
//   ⇔ 学生重建出的概念结构，与作者意图是“同一张图”，即“拓扑共轭”──
//   你跟上了他的脉络；不同构 ⇔ 学生自成一派、绕了作者没安排的路线。
//
// ⚠️ 红线（守 A2）：本模块【不产出任何人学得好的量】。它只讲“结构同构/不同构”，
//   不评对错、不打分。判词只用 conjugate / notConjugate。
// ============================================================================

'use strict';

/**
 * 由“每轮触及的概念集合”序列，提取一条有序的概念轨迹
 * （按轮次顺序，首次出现先记；去重）。
 * @param {Array<Array<string>>} roundConceptSets
 * @returns {Array<string>}
 */
function trajectoryFromRounds(roundConceptSets) {
  const seen = new Set();
  const traj = [];
  for (const set of (roundConceptSets || [])) {
    if (!Array.isArray(set)) continue;
    for (const c of set) {
      if (c && !seen.has(c)) { seen.add(c); traj.push(c); }
    }
  }
  return traj;
}

/**
 * 由概念轨迹建转移图，返回“规范签名”（用于图同构判定，仅重标号）。
 * 签名 = 对每个节点，其出边目标在原序列中的相对次序排序后转串；
 *   再把所有节点签名排序后拼接。两张图同构 ⇔ 签名相同。
 * @param {Array<string>} traj
 * @returns {string}
 */
function graphSignature(traj) {
  const n = traj.length;
  if (n === 0) return 'EMPTY';
  const idx = new Map(traj.map((c, i) => [c, i]));
  const adj = traj.map((_, i) => {
    if (i + 1 >= n) return [];                 // 末节点无出边
    return [idx.get(traj[i + 1])];             // 仅记下一跳（确定性链）
  });
  const nodeSigs = adj.map((a) => '[' + a.slice().sort((x, y) => x - y).join(',') + ']');
  return nodeSigs.slice().sort().join('|');
}

/**
 * 拓扑共轭分析：学生概念轨迹 vs 教材概念脉络。
 * @param {Array<Array<string>>} studentRoundConcepts 学生每轮触及的概念集合
 * @param {Array<string>} lessonCanonical 教材概念在文中首次出现的顺序
 * @returns {{ok:boolean, conjugate:boolean, studentTraj:Array<string>,
 *            lessonTraj:Array<string>, line:string, note:string}}
 */
function analyzeConjugacy(studentRoundConcepts, lessonCanonical) {
  const studentTraj = trajectoryFromRounds(studentRoundConcepts);
  const lessonTraj = (lessonCanonical || []).slice();
  const sSig = graphSignature(studentTraj);
  const lSig = graphSignature(lessonTraj);
  if (sSig === 'EMPTY' || lSig === 'EMPTY') {
    return {
      ok: false,
      conjugate: false,
      studentTraj, lessonTraj,
      note: '概念轨迹为空（学生没触及任何概念，或教材没解析出概念），共轭分析无从谈起。',
      line: '概念轨迹为空，看不出你走过的图和教材是不是同一张。',
    };
  }
  const conjugate = sSig === lSig;
  let line, note;
  if (conjugate) {
    line = `你这节课实际走过的概念（${studentTraj.join('→')}）和教材的脉络`
      + `（${lessonTraj.join('→')}）是**同一张图，只换了名字**——`
      + `用拓扑共轭的话说：你的学习轨迹与作者意图拓扑共轭，你重建出了他本来的结构。`;
    note = '两张概念转移图规范签名一致 ⇒ 同构（仅重标号）⇒ 拓扑共轭成立。';
  } else {
    line = `你走过的图（${studentTraj.join('→')}）和教材的图（${lessonTraj.join('→')}）`
      + `**不是同一张**：你这节课自成一派，绕了作者没安排的路线。共轭不成立只是说`
      + `你没沿着他的脉络走，不是你有错。`;
    note = '两张概念转移图规范签名不同 ⇒ 非同构（结构不同，非仅重标号）⇒ 拓扑共轭不成立。';
  }
  return { ok: true, conjugate, studentTraj, lessonTraj, note, line };
}

module.exports = { analyzeConjugacy, trajectoryFromRounds, graphSignature };
