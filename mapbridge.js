// mapbridge.js — 大模型 ↔ 零权重模型 的桥（"在需要的地方接入大模型"的具象点）
// ============================================================================
// 分工（用户 2026-09-25 夜拍板）：
//   • 自然语言理解（把人话变成结构）  → 交给大模型（llm.orChat）
//   • 结构推理 / 盲区诊断（零权重）   → 交给 mapmodel.js（复合映射、纯结构、无权重）
// 两者互补，不是替代：mapmodel 写不出自然语，大模型不做严谨的关系推理。
//
// 流程：人类自由讲授文本 → 大模型抽出 (概念→概念) 的映射 → 喂给 mapmodel
//       → 跑 blindSpots 照出断头/环/缝隙。无 key 时回退到【带方向的】词面抽取，不崩、不谎报。
// ============================================================================

'use strict';

const { makeModel } = require('./mapmodel.js');
const llm = require('./llm.js');

// 按中英文句末/换行切句
function splitSentences(text) {
  return String(text || '')
    .split(/[。！？\n;；]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// 关系锚词：方向 = 锚词之前的概念 → 锚词之后的概念（"X 是 Y 的特例" ⇒ X→Y）
// ⚠️ 必须带 g 标志：exec 才推进 lastIndex，否则非全局正则反复命中同一处 → 死循环。
const CUES = [
  { re: /是/g, label: '是' },
  { re: /属于/g, label: '属于' },
  { re: /要求/g, label: '要求' },
  { re: /包含|包括|涵盖/g, label: '包含' },
  { re: /决定|推出|导致|映(射)?到|对应(于)?/g, label: '决定' },
  { re: /相当于|即是|也就是/g, label: '相当于' },
];

// 关键词回退：同一句里，按关系锚词把"前概念→后概念"连成有向边（不是双向团）。
function fallbackExtract(text, concepts) {
  const sentences = splitSentences(text);
  const maps = [];
  const seen = new Set();
  for (const sent of sentences) {
    // 记录每个概念在句中的所有出现区间（不止第一次），否则逗号句里后出现的宾语会漏
    const occ = [];
    for (const c of (concepts || [])) {
      let idx = sent.indexOf(c);
      while (idx >= 0) { occ.push({ c, start: idx, end: idx + c.length }); idx = sent.indexOf(c, idx + 1); }
    }
    if (occ.length < 2) continue;
    for (const cue of CUES) {
      cue.re.lastIndex = 0;
      let m;
      while ((m = cue.re.exec(sent)) !== null) {
        const cueStart = m.index;
        const cueEnd = cueStart + m[0].length;
        const beforeList = occ.filter((o) => o.end <= cueStart);       // 锚词之前的候选主语
        const afterList = occ.filter((o) => o.start >= cueEnd);         // 锚词之后的候选宾语
        if (beforeList.length && afterList.length) {
          const from = beforeList[beforeList.length - 1].c;             // 紧邻锚词之前 = 主语
          const emittedTo = new Set();
          for (const a of afterList) {                                  // 锚词后每个概念都连（如"双射要求单射和满射"）
            if (emittedTo.has(a.c)) continue;
            emittedTo.add(a.c);
            const key = from + '->' + a.c + '#' + cue.label;
            if (!seen.has(key)) { seen.add(key); maps.push({ from, to: a.c, label: cue.label }); }
          }
        }
        if (m.index === cue.re.lastIndex) cue.re.lastIndex++;           // 防零宽死循环
      }
    }
  }
  return maps;
}

// 从大模型响应里抠出第一个 JSON 数组（容错：模型可能夹带解释文字）
function parseTriples(raw) {
  if (!raw) return null;
  const m = raw.match(/\[[\s\S]*\]/);
  if (!m) return null;
  try {
    const arr = JSON.parse(m[0]);
    if (!Array.isArray(arr)) return null;
    return arr
      .filter((t) => t && typeof t.from === 'string' && typeof t.to === 'string')
      .map((t) => ({ from: t.from, to: t.to, label: typeof t.label === 'string' ? t.label : '' }));
  } catch {
    return null;
  }
}

/**
 * 从教学文本抽取映射三元组。优先大模型，失败/无 key 回退有向词面。
 * @param {string} text 人类教学文本
 * @param {Object} [opts]
 * @param {Array<string>} [opts.concepts] 规范概念表（约束大模型、支撑回退）
 * @param {number} [opts.deadline] LLM 时间预算（毫秒）
 * @param {Object} [opts.llmApi] 注入用（测试）：{ llmUsable, orChat }，默认用真实 llm.js
 * @returns {Promise<{maps:Array<{from,to,label}>, usedLLM:boolean}>}
 */
async function extractMaps(text, opts = {}) {
  const concepts = opts.concepts || null;
  const deadline = opts.deadline || 0;
  const api = opts.llmApi || llm;
  const usable = typeof api.llmUsable === 'function' ? api.llmUsable() : false;
  let usedLLM = false;
  let maps = null;

  if (usable) {
    const sys = '你是严谨的知识工程师。从用户的教学文本中抽取"概念之间的映射（关系）"，'
      + '只输出一个 JSON 数组，每个元素形如 {"from":"概念A","to":"概念B","label":"关系说明"}。'
      + (concepts && concepts.length
        ? '只允许使用这些概念名：' + concepts.join('、') + '。'
        : '概念名须忠实于原文。')
      + '不要任何解释，不要输出数组以外的文字。';
    try {
      const raw = await api.orChat(sys, String(text || ''), { maxTokens: 600, deadline: deadline || 12000 }).catch(() => '');
      const parsed = parseTriples(raw);
      if (parsed && parsed.length) { maps = parsed; usedLLM = true; }
    } catch (_) { /* 落到回退 */ }
  }

  if (!maps) maps = fallbackExtract(text, concepts || []);
  return { maps, usedLLM };
}

/**
 * 端到端：教学文本 → 零权重模型 → 盲区诊断。
 * @returns {Promise<{model:Object, maps:Array, usedLLM:boolean, blindSpots:Object}>}
 */
async function buildModelFromTeaching(text, opts = {}) {
  const { maps, usedLLM } = await extractMaps(text, opts);
  const model = makeModel();
  for (const m of maps) model.addMap(m.from, m.to, m.label);
  return { model, maps, usedLLM, blindSpots: model.blindSpots() };
}

module.exports = {
  extractMaps, buildModelFromTeaching, fallbackExtract, parseTriples, splitSentences,
};
