// analogy.js — 类比结构分析算子（映射思想的元应用，2026-09-25 落）
//
// 数学依据（查论文，非凭记忆）：
//   Gentner (1983) Structure-Mapping Theory + SME 计算模型 ——
//   类比 = 源域 → 靶域的**映射**；真正被映射的是"关系"而非表面"属性"；
//   系统性原则（优先映射互联的关系系统）；每个类比终会破裂，须显式标出边界。
//
// 产品定位（为何这是"把映射思想融入产品"的狠招）：
//   学生学"映射"时，自己就在做一个映射——把他熟悉的生活域，映射到抽象的定义域。
//   这个"学生建的映射"本身，就是镜子最该照的对象。本算子照见它：
//     保真了哪条关系 / 在哪儿破裂 / 混进了哪些破坏约束的表面属性。
//
// 守 A2 红线（与 Λ/Σ/Φ 同口径，注释钉死）：
//   ❌ 不产出任何"理解度 / 对错 / 评分"量。
//   ✅ 只描述"映射结构保真 / 破裂"。判词只用 保真 / 破裂 / 拟真 / 失真。
//   本文件任何输出字符串都不得含：掌握、理解度、评分、评级、得分、对、错、正确、错误。

const llm = require('./llm.js');

// 类比触发词（启发式 detectAnalogy 用）：生活实例类比常见的语言标记
// ⚠️ 单字「像」**不能**当 cue——它会误命中数学术语「原像」「像（n.）」。
//   只用明确的类比标记（短语或生活实例专属词），避免把"复述定义"误判成"做类比"。
const ANALOGY_CUES = ['好比', '比如', '就像', '相当于', '如同', '排队', '奶茶', '打个比方', '说白了', '换个说法'];
// 破坏单值性（唯一确定）的弱信号词（启发式回退用）：暗示"多对一 / 不唯一"
const NONINJECTIVE_CUES = ['多人', '两个', '同款', '多个', '好几', '随便', '同时'];

// 红线词（守 A2 自检，测试会断言输出里一个都不出现）
const REDLINE_WORDS = ['掌握', '理解度', '评分', '评级', '得分', '对错', '正确', '错误', '你错了', '你对了'];

function detectAnalogy(text) {
  const t = String(text || '');
  const cues = ANALOGY_CUES.filter((c) => t.includes(c));
  return { isAnalogy: cues.length > 0, cues };
}

// 启发式回退：无 LLM 或 LLM 空时，做字面核对（诚实标注"可能不全"）
function heuristicOne(r, targetConcept) {
  const t = String(r.text || '');
  const broken = NONINJECTIVE_CUES.filter((c) => t.includes(c));
  let h;
  if (broken.length) {
    h = `字面看，你的类比里出现了「${broken.join('、')}」这类说法——它们暗示"一个原像可能对应多个像"（多对一），`
      + `而「${targetConcept}」的定义要求"唯一确定"。这通常是你这个类比**破裂**的地方。`;
  } else {
    h = `字面没检出明显破坏"唯一确定"的词，但无大模型时我们只能做字面核对，保真还是破裂，最终要你自己的判断。`;
  }
  return { round: r.round, text: r.text, analysis: h, source: 'heuristic' };
}

// 大模型语义分析（Gentner SME 视角）：让镜子用大白话照见类比映射的结构
async function llmAnalyzeOne(r, targetConcept, lessonContent, deadline) {
  const system = '你是课堂里的镜子学生。你不评分、不判对错，只照见结构。'
    + `学生正在学「${targetConcept}」。形式定义一般要求：① 处处有定义（定义域每个元素都被对应）；`
    + '② 唯一确定（一个原像只对应唯一一个像，不能多对一歧义）。\n'
    + '照见方式：可以说"这里定义允许/要求什么"，但**绝不要说"你错了/你误解了/你搞混了"**'
    + '——一律用"这里定义要求…"的中性陈述，把评判权留给学生自己。';
  const user = `学生用了一段生活实例类比来想「${targetConcept}」，原话：「${r.text}」。\n`
    + '请用大白话分析这段类比**作为一个映射**：\n'
    + '1) 他把生活里哪个域，映射到了「' + targetConcept + '」的哪个关系上；\n'
    + '2) 这个映射**保住**了定义里的哪条约束（关系对应，即"拟真"的部分）；\n'
    + '3) 他混进了哪些**破坏**约束的表面属性（类比在哪里"破裂"）。\n'
    + '不要说学生对错，不要给分数，只描述映射结构。两三百字。';
  const txt = await llm.orChat(system, user, { maxTokens: 600, deadline: deadline || 0, temperature: 0.5 });
  return txt ? { round: r.round, text: r.text, analysis: txt, source: 'llm' } : null;
}

function buildBody(analyses) {
  const head = '你学「映射」的时候，自己也在做一个映射——把你熟悉的生活，映射到抽象的定义上。'
    + '这正好是镜子最该照的东西：**不评你对不对，只照你这个映射保真了哪、裂在哪儿**。\n';
  const body = analyses.map((a) => {
    const tag = a.source === 'llm' ? '' : '（字面核对）';
    const excerpt = String(a.text).length > 42 ? String(a.text).slice(0, 42) + '…' : a.text;
    return `第${a.round}轮你说的「${excerpt}」${tag}：\n${a.analysis}`;
  }).join('\n\n');
  return head + body;
}

// 主入口（async，因为可能要 await LLM）
async function analyzeAnalogMapping({ rounds, targetConcept, lessonContent, deadline } = {}) {
  if (!rounds || !rounds.length) return { found: false, body: '', note: '' };
  const analogyRounds = rounds
    .map((r) => ({ ...r, det: detectAnalogy(r && r.text) }))
    .filter((r) => r.det.isAnalogy);
  if (!analogyRounds.length) return { found: false, body: '', note: '' };

  const usable = llm.llmUsable();
  const analyses = [];
  for (const r of analogyRounds) {
    let a = null;
    if (usable) a = await llmAnalyzeOne(r, targetConcept, lessonContent, deadline);
    if (!a) a = heuristicOne(r, targetConcept);   // LLM 空/失败 → 启发式回退，绝不崩
    analyses.push(a);
  }
  return {
    found: true,
    body: buildBody(analyses),
    note: usable ? '' : '（无大模型时只做字面核对，可能不全）',
  };
}

module.exports = { detectAnalogy, analyzeAnalogMapping, REDLINE_WORDS };
