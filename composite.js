// composite.js — 多层复合映射分析：把 N 轮对话合成一步映射 g = f_N∘…∘f_1
// ============================================================================
// 数学来源（用户 2026-09-25 夜追问"1→2→3→…→N 的多层复合映射呢"）：
//   • 复合映射 g = fₙ∘fₙ₋₁∘…∘f₁ : A₀→Aₙ。每一轮是一次映射 fᵢ，合成后把整条链
//     压成一步直接 1→N 的映射——这正是长对话里学生"丢了的全局观"，镜子把它还回去。
//   • 结合律 (f₃∘f₂)∘f₁ = f₃∘(f₂∘f₁)：学习路径可任意分块，净映射不变 ⇒ 学习顺序
//     是学生的自由（镜子不替人定序）。
//   • 恒等层 id：f∘id=f=id∘f。某一轮概念态没变 = 恒等层，照出"无效轮"。
//   • 逆层 f⁻¹：f⁻¹∘f=id。第 a 轮与第 b 轮互为逆 ⇒ 绕一圈回来了，净效果≈恒等
//     （照出空转 / 自我抵消）。
//   • 不交换性：f₂∘f₁ ≠ f₁∘f₂（一般）。轮序有意义，乱序不是同一堂课。
//   • 层的单/满/双射：注入保区分、满射开新疆、双射零损耗；非单射=坍缩(N→1)，
//     非满射=没覆盖全。这与 referent.js 的"N→1 商"是同一直觉的【过程版】——
//     同指是静态纤维，本算子是逐层看纤维怎么被一层层织出来。
//   • 函子合成 F=Fₙ∘…∘F₁：学生"理解函子"逐轮合成，结构保真可组合（接 functor.js）。
//   • 复合不动点 x=g(x)：整条旅程迭代（复习循环）是否收敛到稳定理解（接 convergence.js）。
//   • 与典范路径交换 g_学∘?=?∘g_教：学习者复合映射与教材复合映射是否共轭
//     （路线不同、落点一致=同构；否则偏航）——接 conjugacy.js。
//
// 与已落算子的 unification（不藏）：
//   • referent.js：同指是 N→1 的【静态商】；本算子是逐层看"商怎么被一层层合成出来"。
//   • convergence.js：本算子末端的"净映射 g 迭代是否收敛" = 那里 Banach 不动点的对象。
//   • conjugacy.js：本算子的"与典范路径交换"判定 = 那里拓扑共轭的 N 层版。
//   • functor.js：本算子的"层合成保结构" = 那里自然性的逐层展开。
//
// ⚠️ 红线（守 A2）：本算子【不产出任何人学得好的量】。只说"你这 N 轮合成的净映射是
//   什么、哪层是恒等/扩张/坍缩、有没有绕圈空转"，不评你懂不懂、不给掌握度。
// ⚠️ 诚实注：层分类只来自"每轮提及的规范概念集合"的句法模式（增/删/不变），不是深层
//   语义。真实"理解跃迁"需要 LLM 判定，有 key 时可由调用方传 semanticAsk 增强概念识别，
//   无 key 回退纯概念名匹配，不崩、不谎报。空轮（没提任何规范概念）参与合成但被标记，
//   不臆造"理解了"。
// ============================================================================

'use strict';

// 比较两个概念集合是否相同
function sameSet(a, b) {
  const A = new Set(a || []), B = new Set(b || []);
  if (A.size !== B.size) return false;
  for (const x of A) if (!B.has(x)) return false;
  return true;
}

// 单层的类型判定（比较相邻两轮的概念集合）
//   prev, cur: 概念名数组
//   → { kind: 'identity'|'expand'|'narrow'|'restructure', added:[], removed:[] }
function classifyLayer(prev, cur) {
  const P = new Set(prev || []), C = new Set(cur || []);
  const added = [...C].filter((x) => !P.has(x));
  const removed = [...P].filter((x) => !C.has(x));
  if (added.length === 0 && removed.length === 0) return { kind: 'identity', added, removed };
  if (added.length > 0 && removed.length === 0) return { kind: 'expand', added, removed };
  if (added.length === 0 && removed.length > 0) return { kind: 'narrow', added, removed };
  return { kind: 'restructure', added, removed };
}

const KIND_LABEL = {
  identity: '恒等层（没动）',
  expand: '扩张层（开了新概念）',
  narrow: '收窄层（丢了概念）',
  restructure: '重构层（拆并都有）',
};

// 逆层 / 空转检测：第 i 轮改了态，之后某第 j 轮又回到改之前的态 ⇒ i、j 互逆，净≈恒等
//   roundSets: [{ round, concepts:[...] }]
//   → [{ invertRound, revertRound, anchorRound }]
function detectCancellation(roundSets) {
  const pairs = [];
  for (let i = 1; i < roundSets.length; i++) {
    const anchor = roundSets[i - 1].concepts;
    const changed = roundSets[i].concepts;
    if (sameSet(anchor, changed)) continue;        // 第 i 轮自身就是恒等，跳过
    if (!anchor.length) continue;                   // 锚点是空轮，无法判定"回到哪"
    for (let j = i + 1; j < roundSets.length; j++) {
      if (sameSet(anchor, roundSets[j].concepts)) {
        pairs.push({
          invertRound: roundSets[i].round,
          revertRound: roundSets[j].round,
          anchorRound: roundSets[i - 1].round,
        });
        break;                                      // 只记第一个回到的位置
      }
    }
  }
  return pairs;
}

// 结合律注记（概念性，不计算）
function associativityNote() {
  return '复合映射满足结合律：(f₃∘f₂)∘f₁ = f₃∘(f₂∘f₁)。'
    + '你可以把 N 轮任意分块（(1→3)(3→N) 或 (1→2)(2→N)），合成的净映射 g 不变——'
    + '所以你的学习顺序是你自己的自由，镜子不替你定序。';
}

// 与典范路径交换注记（概念性，依据 terminalSet vs canonicalSet 判定）
function commutativityNote(terminalSet, canonicalSet) {
  const T = new Set(terminalSet || []), C = new Set(canonicalSet || []);
  if (!C.size) return null;
  const missing = [...C].filter((x) => !T.has(x));   // 教材要到、你没到
  const extra = [...T].filter((x) => !C.has(x));     // 你到了、教材没排
  if (!missing.length && !extra.length) {
    return '你的复合映射 g_学 与教材的复合映射 g_教 交换（拓扑共轭）：路线不同，落到的概念集一致——'
      + '你重建出了作者本来的结构。';
  }
  const parts = [];
  if (missing.length) parts.push(`教材要到、你没到：${missing.join('、')}`);
  if (extra.length) parts.push(`你到了、教材没排：${extra.join('、')}`);
  return '你的复合映射与教材的复合映射【不交换】：落点有偏差——' + parts.join('；') + '。';
}

/**
 * 多层复合映射分析（核心算子）。
 * @param {Array<{round:number, text?:string, concepts?:Array<string>}>} rounds
 *        每轮；text 与 concepts 二选一提供——给 text 时按 concepts 名单抽取提及的概念。
 * @param {Array<string>} concepts  规范概念名单（教材里的"东西"）。
 * @param {Object} [opts]
 * @param {Array<string>} [opts.lessonCanonical]  教材概念在课文中的有序出现序列（用于交换性判定）。
 * @param {Function} [opts.semanticAsk]  async (text, concepts) => string[]  概念识别增强（有 LLM 时）。
 * @returns {Promise<{ok:boolean, line:string, note:string, layers:Array,
 *                     cancellation:Array, net:Object}>}
 */
async function analyzeComposite(rounds, concepts, opts = {}) {
  const rs = (rounds || []).filter((r) => r && typeof r.round === 'number');
  if (rs.length < 2 || !Array.isArray(concepts) || !concepts.length) {
    return {
      ok: false,
      line: '你说的轮次还不够（至少两轮、且得有规范概念），多层复合映射无从合成。',
      note: '诚实：不编结论。',
      layers: [], cancellation: [], net: null,
    };
  }
  // ① 逐轮抽取"概念集合"（text 模式用 indexOf 匹配；concepts 模式直接用）
  const roundSets = [];
  for (const r of rs) {
    let cs;
    if (Array.isArray(r.concepts)) cs = r.concepts.filter((c) => concepts.indexOf(c) >= 0);
    else {
      const t = String(r.text || '');
      cs = concepts.filter((c) => t.indexOf(c) >= 0);
      if (typeof opts.semanticAsk === 'function') {
        try {
          const sem = await opts.semanticAsk(t, concepts);
          if (Array.isArray(sem)) cs = cs.concat(sem.filter((c) => concepts.indexOf(c) >= 0));
        } catch (_) { /* LLM 失败 → 词面回退，不崩 */ }
      }
    }
    roundSets.push({ round: r.round, concepts: [...new Set(cs)] });
  }

  // ② 逐层分类（相邻两轮）
  const layers = [];
  for (let i = 1; i < roundSets.length; i++) {
    const cls = classifyLayer(roundSets[i - 1].concepts, roundSets[i].concepts);
    layers.push({
      from: roundSets[i - 1].round,
      to: roundSets[i].round,
      kind: cls.kind,
      label: KIND_LABEL[cls.kind],
      added: cls.added,
      removed: cls.removed,
    });
  }

  // ③ 逆层 / 空转检测
  const cancellation = detectCancellation(roundSets);

  // ④ 净复合映射 g：起点态(种子) → 终点态
  const firstNonEmpty = roundSets.find((r) => r.concepts.length) || roundSets[0];
  const last = roundSets[roundSets.length - 1];
  const seed = new Set(firstNonEmpty.concepts);
  const terminal = new Set(last.concepts);
  const viaExpand = [...terminal].filter((x) => !seed.has(x));   // 新开
  const lost = [...seed].filter((x) => !terminal.has(x));        // 丢了
  const stable = [...seed].filter((x) => terminal.has(x));       // 始终在
  const net = {
    seedRound: firstNonEmpty.round,
    terminalRound: last.round,
    seed: [...seed],
    terminal: [...terminal],
    viaExpand, lost, stable,
  };

  // ⑤ 组装人话
  const counts = { identity: 0, expand: 0, narrow: 0, restructure: 0 };
  for (const l of layers) counts[l.kind]++;
  const layerLines = layers.map((l) => {
    let tail = '';
    if (l.added.length) tail += ` 开了：${l.added.join('、')}`;
    if (l.removed.length) tail += ` 丢了：${l.removed.join('、')}`;
    return `· 第 ${l.from}→${l.to} 轮：${l.label}。${tail}`;
  });
  const cancelLines = cancellation.length
    ? cancellation.map((p) => `· 第 ${p.invertRound} 轮与第 ${p.revertRound} 轮互为逆（回到第 ${p.anchorRound} 轮之前的状态），净效果≈恒等——你绕了一圈又回来了。`)
    : [];

  let line = `你这 ${rs.length} 轮对话合起来，就是一步复合映射 g = f_${rs.length - 1}∘…∘f_₁：`
    + `从你第 ${net.seedRound} 轮的概念态，直接变到现在的态。\n`;
  line += `层构成：恒等层 ${counts.identity} 个、扩张层 ${counts.expand} 个、收窄层 ${counts.narrow} 个、重构层 ${counts.restructure} 个。\n`;
  if (layerLines.length) line += layerLines.join('\n') + '\n';
  if (cancelLines.length) line += cancelLines.join('\n') + '\n';
  line += `净变换：起点概念{${net.seed.join('、') || '（空）'}}，终点概念{${net.terminal.join('、') || '（空）'}}；`
    + `新开了{${viaExpand.join('、') || '无'}}，丢了{${lost.join('、') || '无'}}，始终在的有{${stable.join('、') || '无'}}。`;

  // ⑥ 数学注记：结合律 + 函子合成 + 不动点 + （可选）交换性
  let note = associativityNote()
    + ' 函子视角：你的"理解函子" F = F_' + (rs.length - 1) + '∘…∘F_₁ 逐层合成，结构保真可组合；'
    + '把整条链压成一步 g，相当于把"编译后的理解"直接回放，跳过中间噪音。';
  const comm = commutativityNote([...terminal], opts.lessonCanonical);
  if (comm) note += ' ' + comm;
  note += ' 末端的净映射 g 若被你反复迭代（复习循环），是否收敛到稳定理解——那是 convergence.js 的 Banach 不动点问题。';

  return { ok: true, line, note, layers, cancellation, net };
}

module.exports = {
  analyzeComposite, classifyLayer, detectCancellation,
  associativityNote, commutativityNote, sameSet, KIND_LABEL,
};
