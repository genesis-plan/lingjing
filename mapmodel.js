// mapmodel.js — 灵境自研「无权重关系推理引擎」可行性 PoC
// ============================================================================
// 用户提案（2026-09-25 夜）："用多层复合映射思想，做出自己的大模型，不用权重"。
//
// 本文件是可行性证明，不是产品级实现。它证明一件事：
//   知识 = 概念（对象） + 人类传授的映射（态射）
//   推理 = 映射的合成（函数复合 / 关系连接）
//   完全没有权重、没有反向传播、没有训练、没有梯度、没有语料学习。
//
// 人喂什么映射，它就有什么能力。这恰好是灵境"人传授、人体验"的定位——
// AI 学生不是学习者，是把人类喂进来的映射织成一张图、并照出盲区（断头/环/缝隙）的镜子。
//
// ⚠️ 诚实边界（不虚报）：
//   • 这是一个【关系推理 / 诊断】引擎，不是生成式大模型（写不出流畅自由文本）。
//   • 它的"规模"来自人类喂进去的知识库大小，不来自参数。
//   • 它复用 composite.js 的"复合映射"思想，但职责不同：composite.js 分析【对话轮次】，
//     本文件把映射本身当作一等公民，构建可查询的【关系知识模型】。
// ============================================================================

'use strict';

/**
 * 创建一个无权重的映射模型。
 * @returns {Object} model
 */
function makeModel() {
  const concepts = new Set();        // 对象：概念
  const maps = [];                   // 态射：{ from, to, label }

  function addConcept(c) {
    if (c == null) return;
    concepts.add(String(c));
  }

  /**
   * 增加一条人类传授的映射（态射）：from --label--> to
   * 顺便把端点的概念登记进对象集。
   */
  function addMap(from, to, label) {
    addConcept(from);
    addConcept(to);
    maps.push({ from: String(from), to: String(to), label: label ? String(label) : '' });
  }

  /**
   * 前向推理（复合映射的应用）：从起点概念出发，沿出射映射走到底。
   * 这就是"零权重前向传播"——每一步都是一次确定的函数复合，没有任何数值参数。
   * @param {string} start 起点概念
   * @returns {{terminals:Array<{concept:string,via:Array<string>}>, allReached:Array<string>}}
   *          terminals：所有终点（死胡同/叶子）及其走过的映射标签链
   *          allReached：整条链上到达过的全部概念
   */
  function reach(start) {
    const s = String(start);
    if (!concepts.has(s)) return { terminals: [], allReached: [] };
    const allReached = new Set();
    const terminals = [];
    const queue = [{ c: s, via: [] }];
    while (queue.length) {
      const { c, via } = queue.shift();
      if (allReached.has(c)) continue;       // 防止环里无限转
      allReached.add(c);
      const outs = maps.filter((m) => m.from === c);
      let progressed = false;                  // 是否还有"通向未访问节点"的出射
      for (const m of outs) {
        if (!allReached.has(m.to)) {
          progressed = true;
          queue.push({ c: m.to, via: [...via, m.label || m.to] });
        }
      }
      // 落点（复合映射的终点）= 所有出射都指回已访问节点（含环里的叶子），无新进展
      if (!progressed) terminals.push({ concept: c, via });
    }
    return { terminals: terminals, allReached: [...allReached] };
  }

  /**
   * 把一串命名映射（按 label 顺序）合成一条复合映射，返回终点到哪。
   * 即 g = fₙ ∘ … ∘ f₁ 在命名层面的直接体现。
   * @param {string} start 起点
   * @param {Array<string>} labelPath 映射标签序列
   * @returns {string|null} 落点概念，或 null（路径在某步断了）
   */
  function compose(start, labelPath) {
    let cur = String(start);
    if (!concepts.has(cur)) return null;
    for (const lab of labelPath) {
      const m = maps.find((x) => x.from === cur && x.label === lab);
      if (!m) return null;                   // 这条复合链断了——诚实返回 null，不编造
      cur = m.to;
    }
    return cur;
  }

  /**
   * 盲区诊断（诊断镜的核心）：照出这张映射图里"人类没连好"的地方。
   * @returns {{orphans:Array<string>, deadEnds:Array<string>, cycles:Array<Array<string>>, gapPairs:number}}
   *   orphans：只当起点、从没被别人映射到的概念（孤源）
   *   deadEnds：只当终点、从没有出射映射的概念（断头路——典型盲区：讲了但没延伸）
   *   cycles：环（映射绕回自己，对应 composite.js 的"空转/互为逆"）
   *   gapPairs：任意两概念间无路径可达的有序对数量（结构缝隙）
   */
  function blindSpots() {
    const ins = new Set(maps.map((m) => m.to));
    const outs = new Set(maps.map((m) => m.from));
    const orphans = [...concepts].filter((c) => !ins.has(c));
    const deadEnds = [...concepts].filter((c) => !outs.has(c));

    // 环检测（DFS 找后向边）
    const adj = {};
    for (const m of maps) (adj[m.from] = adj[m.from] || []).push(m.to);
    const cycles = [];
    const color = {};                       // 0 未访 1 在栈 2 完成
    const stack = [];
    function dfs(u) {
      color[u] = 1; stack.push(u);
      for (const v of adj[u] || []) {
        if (color[v] === 1) {
          const i = stack.indexOf(v);
          if (i >= 0) cycles.push(stack.slice(i).concat(v));
        } else if (!color[v]) dfs(v);
      }
      stack.pop(); color[u] = 2;
    }
    for (const c of concepts) if (!color[c]) dfs(c);

    // 结构缝隙：全源 BFS 求可达性，数"不可达有序对"
    let gapPairs = 0;
    for (const a of concepts) {
      const r = reach(a).allReached;
      const set = new Set(r);
      for (const b of concepts) if (b !== a && !set.has(b)) gapPairs++;
    }
    return { orphans, deadEnds, cycles, gapPairs };
  }

  return {
    addConcept, addMap, reach, compose, blindSpots,
    concepts: () => [...concepts],
    maps: () => maps.slice(),
  };
}

module.exports = { makeModel };
