// referent.js — 同指识别：把 N 个"不同表达"坍缩成它们共同指到的那 1 个东西
// ============================================================================
// 数学来源（用户 2026-09-25 夜的洞见，已抽成数学）：
//   • 复合映射 (f∘g)(x)=f(g(x))：1→2 是 g、2→3 是 f，合成 1→3；满足结合律 ⇒
//     绕的弯不同，最终落到的"东西"不变。这个不变元 = 复合链的极限。
//   • 1→N 不是函数，是【关系 / 对应 / 多值映射】：一个概念 r 对应 N 个表达 e_i。
//     它的反向（N 个表达 → 1 个概念）要成为函数，必须先做【归一化 / 商 / section】。
//   • 大模型前馈 = f = L_n∘…∘L_1：每层映射，合成后把"不同说法"压到同一不变特征。
//   • 本算子要建的就是这个关系的【纤维 / 商】：N 个表达 e_i 都通过学习者心智模型
//     映射到同一个指称 r；镜子把它们坍缩，并告诉学生"这几句话，指同一个东西"。
//
// 与已落算子的 unification（不藏）：
//   • convergence.js（Banach 不动点）：复合链的极限 = 这里被识别出的"那个东西"。
//   • functor.js（自然性）：同指判定必须自然——学生没改口，镜子不能翻"同物/异物"。
//   • conjugacy.js（拓扑共轭）：不同体验者说同一事物 = 不同坐标系下的同一结构 ⇒ 共轭；
//     本算子先在一体内（同一体验者跨轮）做同指，跨人版是 natural 延伸（见文件尾注释）。
//
// ⚠️ 红线（守 A2）：本算子【不产出任何人学得好的量】。它只说"这几句话指同一个东西"，
//   不评你懂不懂、不给掌握度。判词只用"同指 / 各异"。
// ⚠️ 诚实注：纯词面启发式只能抓"显式转述"（对应→映射、一一对应→双射…）；真正跨表达
//   （如"奶茶排队"这种类比 vs "函数对应"这种定义）的语义同指，需要 LLM 语义判定层
//   （semanticAsk），有 key 时自动启用，无 key 回退词面、不崩、不谎报。
// ============================================================================

'use strict';

// 同义 / 转述片段 → 规范概念 的确定性映射（无 LLM 也能跑的回退层）
//   键是被检测文本里可能出现的"说法"，值是它归到的规范概念（必须存在于 concepts 列表）。
const SYNONYMS = {
  '对应': '映射',
  '映射对应': '映射',
  '像与原像': '映射',
  '一一对应': '双射',
  '满单射': '双射',
  '可逆': '双射',
  '反函数': '逆映射',
  '逆函数': '逆映射',
  '叠加': '复合',
  '组合': '复合',
  '复合函数': '复合映射',
};

/**
 * 从一段文本里，找出它"指到"哪些规范概念（canonical concepts）。
 * ① 精确包含规范名；② 命中同义词表；③（可选）LLM 语义判定。
 * @param {string} text
 * @param {Array<string>} concepts
 * @returns {Array<string>}
 */
function conceptsReferred(text, concepts) {
  const t = String(text || '');
  const hit = new Set();
  for (const c of concepts) {
    if (c && t.indexOf(c) >= 0) hit.add(c);
  }
  for (const syn of Object.keys(SYNONYMS)) {
    const canon = SYNONYMS[syn];
    if (concepts.indexOf(canon) >= 0 && t.indexOf(syn) >= 0) hit.add(canon);
  }
  return [...hit];
}

/**
 * 同指识别（核心算子）。
 * @param {Array<{source?:string, round:number, text:string}>} utterances
 *        表达集合；source 用于区分"不同体验者"（同体内默认都填 '你'）。
 * @param {Array<string>} concepts  规范概念列表（教材里的"东西"）。
 * @param {Object} [opts]
 * @param {Function} [opts.semanticAsk]  async (text, concepts) => string[]  语义同指增强（有 LLM 时）。
 * @returns {Promise<{ok:boolean, clusters:Array, line:string, note:string}>}
 */
async function referentCluster(utterances, concepts, opts = {}) {
  const us = (utterances || []).filter((u) => u && typeof u.text === 'string');
  if (us.length < 2 || !Array.isArray(concepts) || !concepts.length) {
    return {
      ok: false,
      clusters: [],
      note: '表达不足或没有规范概念，同指识别无从谈起（诚实：不编结论）。',
      line: '你说的话还不够多，看不出不同说法是否指同一个东西。',
    };
  }
  // 每条表达 → 它指到的规范概念集合（启发式 + 可选 LLM 语义增强）
  const refs = [];
  for (const u of us) {
    let cs = conceptsReferred(u.text, concepts);
    if (typeof opts.semanticAsk === 'function') {
      try {
        const sem = await opts.semanticAsk(u.text, concepts);
        if (Array.isArray(sem)) cs = cs.concat(sem.filter((c) => concepts.indexOf(c) >= 0));
      } catch (_) { /* LLM 失败 → 用启发式，不崩 */ }
    }
    refs.push({ u, cs: [...new Set(cs)] });
  }
  // 按规范概念分组：哪些表达指到同一个概念（= "同一个东西"的不同表达）
  const byConcept = new Map();
  for (const r of refs) {
    for (const c of r.cs) {
      if (!byConcept.has(c)) byConcept.set(c, []);
      byConcept.get(c).push(r);
    }
  }
  const clusters = [];
  for (const [concept, rs] of byConcept) {
    // 只保留"用【不同】表达指同一东西"的簇：≥2 条，且表面文本不全相同
    const distinct = new Set(rs.map((r) => r.u.text.trim()));
    if (rs.length >= 2 && distinct.size >= 2) {
      clusters.push({
        concept,
        expressions: rs.map((r) => ({
          source: r.u.source || '你',
          round: r.u.round,
          excerpt: r.u.text.trim().slice(0, 36),
        })),
      });
    }
  }
  if (!clusters.length) {
    return {
      ok: true,
      clusters: [],
      note: '没有检出"不同说法指同一东西"的簇——你每轮说的都是各指各的，或表达完全重合。',
      line: '这几轮里，我没看出来有哪两个不同说法指的是同一个东西。',
    };
  }
  // 报告：对每个簇，点出"这些不同说法，指的都是 X"
  const parts = clusters.map((cl) => {
    const who = cl.expressions
      .map((e) => (e.source === '你' ? `第 ${e.round} 轮（${e.excerpt}…）` : `${e.source} 第 ${e.round} 轮（${e.excerpt}…）`))
      .join('、');
    return `${who} —— 指的其实是同一个东西：**${cl.concept}**。`;
  });
  const line = '你已经在用不同的话讲同一个结构了：\n' + parts.join('\n');
  const note = `同指识别把 N 个表达坍缩成 ${clusters.length} 个被识别的不变元`
    + `（纤维 / 商）；这正是复合映射链的极限——绕的弯不同，落到的东西不变。`;
  return { ok: true, clusters, line, note };
}

module.exports = { referentCluster, conceptsReferred, SYNONYMS };

// ── 跨人体验者延伸（NOT YAGNI 说明，未实装，留给多会话共享教案时）：
//   若把多个 session 的 utterances 都喂进来（source 标不同人名），本算子天然支持
//   "不同体验者说同一事物、表达不同 → 被识别为同一东西"。那时它和 conjugacy.js
//   （不同坐标系同结构）是同一数学直觉的两面：共轭是结构层、同指是语义层。
