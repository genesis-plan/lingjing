// function.js — 函数思想的算子（2026-09-25 落，用户自学"大学数学第2节：函数"触发）
// ============================================================================
// 教材口径（先说准，免得讲错）：第1节的【映射】已要求"唯一确定"；第2节的【函数】
// = 定义域与值域都是【数集】的映射。所以函数 ⊂ 映射，不是"更松的关系"。
//
// 文献支撑（本次实查，非凭记忆）：
//   • Vinner & Dreyfus (1989)：concept image（概念意象）≠ concept definition（概念定义）；
//     学生靠意象运作；误解 = 认知结构与科学定义的不匹配。→ 算子⑤
//   • Evangelidou et al. (2004)：多数师范生把"函数"误当成"一一对应(单射)"——
//     把宽概念讲窄，这是记录在案的经典误解。→ 算子⑤ 的核心判据
//   • 外延相等 funext（Lean/nLab/集合论）：∀x, f x = g x ⇒ f = g。
//     两个函数只要对每个输入输出都相同就相等，与写法无关。→ 算子③
//   • 形式定义（CMSC 27100 等）：函数 = 全(total) + 单值(single-valued) 的关系；
//     im f ⊆ codomain；反函数存在 ⟺ 双射。→ 算子①②④
//
// ⚠️ 红线（守 A2）：本文件【不产出任何人学得好不好的量】。只照出结构事实：
//   单值/非单值、覆盖缺口、两讲法是否外延相等、是否可逆、定义与例子是否等宽。
//   不评分、不判对错、不说"你掌握了"。
// ⚠️ 诚实：概念识别无 LLM 时回退词面 indexOf，可能漏"不提名但同指"的表达；
//   算子⑤的宽/窄口径靠关键词，是启发式，不是语义理解——如实标注，不谎报。
// ============================================================================

'use strict';

// ① 良定义性 / 单值性：函数要求"每个输入唯一一个输出"。
//    一句话映射到 ≥2 个规范概念 ⇒ 非单值 ⇒ 它是【关系】不是【函数】⇒ 真歧义（盲区信号）。
//    @param utterances [{round, text}]  @param concepts 规范概念表
//    @param opts.semanticAsk async(text, concepts)=>string[]  有 LLM 时的语义增强
async function checkWellDefined(utterances, concepts, opts = {}) {
  const utts = (utterances || []).filter((u) => u && typeof u.round === 'number');
  if (!utts.length || !Array.isArray(concepts) || !concepts.length) {
    return {
      ok: false,
      line: '没有原话、或没有规范概念，单值性无从判定。',
      note: '诚实：不编结论。',
      multiValued: [], rows: [],
    };
  }
  const rows = [];
  for (const u of utts) {
    let cs = concepts.filter((c) => String(u.text || '').indexOf(c) >= 0);
    if (typeof opts.semanticAsk === 'function') {
      try {
        const sem = await opts.semanticAsk(u.text, concepts);
        if (Array.isArray(sem)) cs = cs.concat(sem.filter((c) => concepts.indexOf(c) >= 0));
      } catch (_) { /* LLM 失败 → 词面回退，不崩 */ }
    }
    cs = [...new Set(cs)];
    rows.push({ round: u.round, concepts: cs, singleValued: cs.length <= 1 });
  }
  const multiValued = rows.filter((r) => !r.singleValued);
  const singleCount = rows.filter((r) => r.singleValued && r.concepts.length === 1).length;

  let line = '';
  if (!multiValued.length) {
    line = `你讲的每一句话都只指向唯一一个概念——这是"良定义"的（单值）。共 ${singleCount} 句是单值的。`;
  } else {
    line = `有 ${multiValued.length} 句话同时指向多个概念，它们不是"函数"而是"关系"（一话多指）：\n`
      + multiValued.map((r) => `· 第 ${r.round} 轮：同时指到 ${r.concepts.join('、')}`).join('\n')
      + `\n这正是歧义所在——你的表达还不满足函数的单值性。`;
  }
  const note = '函数的形式要求是"全 + 单值"（CMSC 27100）：每个输入恰好一个输出。'
    + '一话多指 ⇒ 非单值 ⇒ 是关系不是函数 ⇒ 歧义。同指识别(referent.js)正是把这种关系修成函数。';
  return { ok: true, line, note, multiValued, rows };
}

// ② 定义域 / 值域 / 对应域：全函数性 + 覆盖缺口 + 越界
//    对应域 codomain = 应该覆盖的概念全集（教材）；值域 image = 你实际讲到的；
//    定义域 domain = 你当作起点、应当被解释的概念。
//    · 非全(partial)：定义域里有概念你没给出像 ⇒ 提到了但没讲清楚
//    · 不满射：对应域里有概念值域没覆盖 ⇒ 覆盖缺口（盲区）
//    · 越界：值域里出现对应域之外的概念 ⇒ 教材之外（可能是你补充的，不评判好坏）
function analyzeCoverage(o = {}) {
  const domain = new Set(o.domain || []);
  const image = new Set(o.image || []);
  const codomain = new Set(o.codomain || []);
  if (!codomain.size) {
    return { ok: false, line: '没有对应域（教材概念全集），覆盖无从判定。', note: '诚实：不编结论。', gap: [], outside: [], undefinedOn: [] };
  }
  const gap = [...codomain].filter((c) => !image.has(c));            // 该覆盖没覆盖
  const outside = [...image].filter((c) => !codomain.has(c));        // 讲到了但教材没有
  const undefinedOn = [...domain].filter((c) => !image.has(c));      // 该解释没解释（非全）
  const surjective = gap.length === 0;
  const total = undefinedOn.length === 0;

  const parts = [];
  parts.push(`值域(你实际讲到的) ${image.size} 个，对应域(教材全部) ${codomain.size} 个，`
    + `值域 ${surjective ? '=' : '⊊'} 对应域——${surjective ? '满射，覆盖完整' : '不满射，有缺口'}。`);
  if (gap.length) parts.push(`覆盖缺口（教材有、你没讲到）：${gap.join('、')}。`);
  if (undefinedOn.length) parts.push(`非全函数（你提到了但没给出解释）：${undefinedOn.join('、')}。`);
  if (outside.length) parts.push(`越界（你讲到了教材之外的概念）：${outside.join('、')}——不评判好坏，只如实标出。`);

  return {
    ok: true,
    line: parts.join(' '),
    note: 'im f ⊆ codomain 恒成立；im f ⊊ codomain 即不满射，缺口就是盲区。'
      + ' totality（全函数性）要求定义域每个元素都有像——提到了却没解释，就是"非全"。',
    gap, outside, undefinedOn, surjective, total,
  };
}

// ③ 外延相等（funext）：两种讲法是不是"同一个函数"
//    ∀x, f x = g x ⇒ f = g。不看措辞（内涵），只看每个输入上的输出（外延）。
//    @param f1, f2  形如 { 输入概念: 输出概念 } 的对应法则
function extensionalEquality(f1, f2) {
  const a = f1 || {}, b = f2 || {};
  const d1 = Object.keys(a), d2 = Object.keys(b);
  if (!d1.length && !d2.length) {
    return { ok: false, line: '两个对应法则都是空的，相等性无从判定。', note: '诚实：不编结论。', equal: false };
  }
  const onlyInA = d1.filter((k) => !(k in b));
  const onlyInB = d2.filter((k) => !(k in a));
  const sameDomain = onlyInA.length === 0 && onlyInB.length === 0;
  const disagreements = [];
  for (const k of d1) {
    if (k in b && a[k] !== b[k]) disagreements.push({ input: k, a: a[k], b: b[k] });
  }
  const equal = sameDomain && disagreements.length === 0;

  let line;
  if (equal) {
    line = '两种讲法【外延相等】：定义域相同，且每一个输入上给出的输出都一致——'
      + '尽管措辞不同，它们是同一个函数（同一个理解）。';
  } else if (!sameDomain) {
    line = '两种讲法【定义域就不同】，谈不上同一个函数：'
      + (onlyInA.length ? `只在第一种里出现的输入：${onlyInA.join('、')}。` : '')
      + (onlyInB.length ? `只在第二种里出现的输入：${onlyInB.join('、')}。` : '');
  } else {
    line = '两种讲法定义域相同，但【有输入上取值不一致】，所以不是同一个函数：'
      + disagreements.map((d) => `· 对「${d.input}」，一种说「${d.a}」，另一种说「${d.b}」`).join(' ');
  }
  const note = '依据函数外延相等（funext，集合论/Lean）：∀x f x = g x ⇒ f = g。'
    + ' 判"同一个理解"不看措辞（内涵/语法），只看每个输入上的输出是否一致（外延/行为）。';
  return { ok: true, line, note, equal, sameDomain, onlyInA, onlyInB, disagreements };
}

// ④ 可逆性：反函数存在 ⟺ 双射（既单射又满射）
//    @param map 形如 { 输入概念: 输出概念 }
//    @param codomain 对应域（判满射必需）
function invertibility(map, codomain) {
  const m = map || {};
  const entries = Object.entries(m);
  if (!entries.length) {
    return { ok: false, line: '没有对应关系，可逆性无从判定。', note: '诚实：不编结论。', invertible: false };
  }
  const values = entries.map(([, v]) => v);
  const uniqueValues = new Set(values);
  const injective = uniqueValues.size === values.length;            // 无"多对一" ⇒ 单射
  const cod = new Set(codomain || []);
  const hit = values.filter((v) => cod.has(v));
  const surjective = cod.size > 0 && new Set(hit).size === cod.size; // 对应域每个元素都被映到
  const bijective = injective && surjective;

  const collisions = [];
  const byValue = {};
  for (const [k, v] of entries) (byValue[v] = byValue[v] || []).push(k);
  for (const v of Object.keys(byValue)) if (byValue[v].length > 1) collisions.push({ output: v, inputs: byValue[v] });

  const parts = [];
  parts.push(`单射：${injective ? '是' : '否'}${collisions.length ? `（${collisions.length} 处多对一）` : ''}；`
    + `满射：${surjective ? '是' : '否'}；双射：${bijective ? '是' : '否'}。`);
  if (collisions.length) {
    parts.push('多对一处：' + collisions.map((c) => `${c.inputs.join('、')} 都映到「${c.output}」`).join('；')
      + '——多对一就无法唯一逆回去。');
  }
  parts.push(bijective
    ? '是双射 ⇒ 反函数存在，可以无损地逆回去。'
    : '不是双射 ⇒ 反函数不存在（或只在值域上有部分逆），逆回去会有歧义或有损。');

  return {
    ok: true, line: parts.join(' '), note: '反函数存在 ⟺ 双射（Definition 4 / CMSC 27100）：'
      + ' f⁻¹(f(x))=x 与 f(f⁻¹(y))=y 只在双射时同时成立。',
    invertible: bijective, injective, surjective, collisions,
  };
}

// ⑤ 概念意象 vs 概念定义（Vinner & Dreyfus 1989；Evangelidou et al. 2004）
//    经典误解：把"函数"(宽：单值对应)讲成"一一对应/单射"(窄)。
//    判据：定义文本用宽口径词，而例子清一色用窄口径词 ⇒ 把概念讲窄了（意象 ≠ 定义）。
const BROAD = [/单值/, /映射/, /函数/, /唯一(确定)?/, /每一个?\s*x/, /对应(关系)?/];
const NARROW = [/一一对应/, /双射/, /一一映射/, /既是单射又是满射/, /可逆/, /一一/];

// 找窄口径词的所有出现，并标注是否带否定前缀。
// ⚠️ 关键坑：'f(x)=x² 不是一一对应（多对一）' 其实是【宽口径的正面例子】——
//   它正是在说明"函数不必是一一对应"。只做关键词匹配会把否定句误判成窄例，
//   从而把讲得对的人误报成"讲窄了"。所以必须区分 肯定提及 / 否定提及。
function narrowMentions(text) {
  const out = [];
  for (const r of NARROW) {
    const re = new RegExp(r.source, 'g');
    let m;
    while ((m = re.exec(text)) !== null) {
      const pre = text.slice(Math.max(0, m.index - 4), m.index);
      out.push({ term: m[0], negated: /不是|并非|不属于|并不|非$/.test(pre) });
      if (m.index === re.lastIndex) re.lastIndex++;          // 防零宽死循环
    }
  }
  return out;
}

function imageVsDefinition(definitionText, examples) {
  const def = String(definitionText || '');
  const exs = (examples || []).map((t) => String(t || ''));
  const defBroad = BROAD.some((r) => r.test(def));

  const narrowEx = [];
  const broadOnlyEx = [];
  for (const t of exs) {
    const men = narrowMentions(t);
    const narrowPos = men.some((x) => !x.negated);            // 肯定地说"是一一对应"
    const narrowNeg = men.some((x) => x.negated);             // 明确说"不是一一对应"
    if (narrowPos) { narrowEx.push(t); continue; }
    // 否定窄口径 = 在示范"函数不必是一一对应" ⇒ 宽口径信号
    if (narrowNeg || BROAD.some((r) => r.test(t))) broadOnlyEx.push(t);
  }

  // 讲窄 = 定义是宽的，但所有例子都是窄的（一个宽例都没有）
  const narrowed = defBroad && narrowEx.length > 0 && broadOnlyEx.length === 0;
  // 讲宽 = 定义窄、例子宽（较少见，也照出来）
  const defNarrow = NARROW.some((r) => r.test(def)) && !defBroad;
  const widened = defNarrow && broadOnlyEx.length > 0;

  let line;
  if (narrowed) {
    line = '你的定义说的是宽口径（单值对应/函数），但你举的例子清一色是窄口径（一一对应/双射）——'
      + '你把「函数」讲窄成「一一对应」了。这正是文献记录在案的经典误解'
      + '（Evangelidou et al. 2004：多数师范生把函数等同于一一对应）。';
  } else if (widened) {
    line = '你的定义用的是窄口径（一一对应），但例子里有宽口径的——定义比例子窄，讲法不自洽。';
  } else if (narrowEx.length && broadOnlyEx.length) {
    line = '你的例子里宽口径与窄口径都有，覆盖是均衡的。';
  } else if (!defBroad && !defNarrow) {
    line = '定义文本里没识别到明确的函数/对应口径词，无法判定意象与定义是否等宽。';
  } else {
    line = '定义与例子的口径一致，没看出"讲窄/讲宽"的错位。';
  }

  const note = '依据 Vinner & Dreyfus (1989)：概念意象(concept image) ≠ 概念定义(concept definition)，'
    + '误解 = 认知结构与科学定义的不匹配。本算子只用关键词启发式判定宽/窄口径，'
    + '是**弱信号**，不是语义理解——有 LLM 时应结合语义判定。';
  return {
    ok: true, line, note, narrowed, widened,
    defBroad, defNarrow, narrowExamples: narrowEx.length, broadExamples: broadOnlyEx.length,
  };
}

module.exports = {
  checkWellDefined, analyzeCoverage, extensionalEquality, invertibility, imageVsDefinition,
};
