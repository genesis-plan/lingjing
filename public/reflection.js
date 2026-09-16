// reflection.js — 灵境·双稿制确定性反思引擎（总结方法论代码化）
// =====================================================================
// 设计铁律（镜像 questioning.js，守"不靠模型替人定稿"的命根）：
//   1. 本模块只产出「双稿制」的确定性结构：AI 镜稿三块、人五类修改 reducer、
//      人定稿三阶（照镜札记）组装、七步状态机。LLM 只是"嗓音"，不在此写任何总结文字。
//   2. 完全不评分、不评判、不纠错、不替人下结论 —— 只做"学徒照镜"的反射。
//   3. 纯函数、可单测、跨输入可复现（见 tools/test_reflection.mjs）。
//
// 与 docs/理论基座.md §十.13（双稿制·定稿·不可改动·2026-09-16 锁死）对齐：
//   - AI 镜稿三块（全"我"开头，不评价/不建议/不评分）：
//       ① 我听到的核心内容  ② 我还没完全明白的地方  ③ 我可能理解偏了的地方
//   - 人五类修改动作：确认 / 改写 / 补充 / 删除 / 转化
//   - 人定稿三阶（照镜札记）：事实 / 反思 / 行动 / 保留（允许保留困惑）
//   - 七步流程：镜稿→通读→五类改→三阶定稿→朗读(可选)→确认定稿→回看
//
// 双模输出：Node(CommonJS require) 与 浏览器(classic <script> 挂 window.LJReflection) 共用同一份纯逻辑。
// =====================================================================

// ---- 常量（锁死，与 §十.13 一字不差）----
const MIRROR_LABEL = '学徒草稿总结 · 草稿·AI 学徒理解·待你修订';
const FINAL_LABEL = '人类终审版 · 照镜札记';

const MIRROR_BLOCKS = {
  heard:   { key: 'heard',   title: '我听到的核心内容',     hint: '用自己的话复述传授者讲过的内容，可含错误理解' },
  confused: { key: 'confused', title: '我还没完全明白的地方', hint: '以「我没跟上」列困惑，不说「你没讲清楚」' },
  misread:  { key: 'misread',  title: '我可能理解偏了的地方', hint: '标注自己不确定的理解，不判断谁对谁错' },
};
const MIRROR_BLOCK_KEYS = ['heard', 'confused', 'misread'];

const EDIT_KINDS = ['confirm', 'rewrite', 'add', 'delete', 'transform'];
const EDIT_LABEL = {
  confirm:  '确认', rewrite: '改写', add: '补充', delete: '删除', transform: '转化',
};

const REFLECT_STAGES = {
  fact:    { key: 'fact',    title: '一、事实', desc: '我讲了什么 / AI 听到了什么' },
  reflect: { key: 'reflect', title: '二、反思', desc: '哪里顺 / 哪里卡 / 为什么' },
  reflect2:null,
  action:  { key: 'action',  title: '三、行动', desc: '如果重讲一次，我会改变什么' },
  reserve: { key: 'reserve', title: '四、保留', desc: '暂时无解的问题（允许保留困惑）' },
};
const REFLECT_STAGE_KEYS = ['fact', 'reflect', 'action', 'reserve'];

// 七步流程（§十.13 操作流程）
const REFLECTION_STEPS = [
  'AI 生成镜稿',
  '人通读',
  '人用五类动作修改（确认/改写/补充/删除/转化）',
  '人按三阶写定稿（事实/反思/行动/保留）',
  'AI 朗读定稿（可选，只复述不加评价）',
  '人确认定稿（存「照镜札记」）',
  '下次传授前回看（可积累认知轨迹）',
];

// 评价/判定语黑名单（镜稿里严禁出现；AI 只当镜子，不审判）
const EVAL_RE = /(评分|打分|掌握度|得分|你讲得|你没讲清|你错了|不对|建议你|应该改|不及格|优秀|良好)/;

// ---- 确定性辅助 ----
function stableId(name, block, i) {
  return name + '::' + block + '::' + i;
}
function probeLabel(t) {
  return ({ counter: '反例', bound: '边界', example: '正例', distinct: '区分', mechanism: '机制', apply: '应用' })[t] || '探测';
}
function noEval(text) {
  return !EVAL_RE.test(String(text || ''));
}

// ---- 主入口：把 teacher.js 的 P0-2 aiNotes 转成锁死的镜稿三块 ----
// 入参 aiNotes: [{ name, mis, took:[{round,type,q,answer}], stuck:[{round,type,q}], selfCheck }]
// 返回确定性镜稿（每块每条全"我"开头，不评价、不评分）
function buildMirrorDraft(aiNotes) {
  const list = Array.isArray(aiNotes) ? aiNotes : [];
  const students = list.map((n) => {
    const name = n && n.name ? String(n.name) : '学徒';
    const heard = (n.took || []).map((t, i) => ({
      id: stableId(name, 'heard', i),
      text: '我听到的核心是：「' + String(t.answer || '').trim() + '」'
        + (t.q ? '（你问的' + probeLabel(t.type) + '：「' + String(t.q).trim().slice(0, 28) + '」）' : ''),
    }));
    const confused = (n.stuck || []).map((t, i) => ({
      id: stableId(name, 'confused', i),
      text: '我没跟上你问的「' + String(t.q || '').trim().slice(0, 28) + '」（第' + (t.round || '?') + '轮）',
    }));
    // 第 3 块「我可能理解偏了」= AI 自我点检（确定性模板，含可能带错的旧想法 + 最想不通处）
    let selfCheck = n.selfCheck ? String(n.selfCheck).trim()
      : '这课我没什么想不通的——但也可能只是我没敢问。';
    // 归一化：确保「我」开头（teacher.js 兜底语「这课我…」→「我这堂课我…」，不失真、不替人加评价）
    if (!selfCheck.startsWith('我')) {
      selfCheck = selfCheck.replace(/^这课|^这节课/, '我这堂课');
      if (!selfCheck.startsWith('我')) selfCheck = '我（照镜）：' + selfCheck;
    }
    const misread = [{ id: stableId(name, 'misread', 0), text: selfCheck }];
    return { name, blocks: { heard, confused, misread } };
  });
  return {
    label: MIRROR_LABEL,
    generatedAt: new Date().toISOString(),
    students,
  };
}

// 镜稿 → 平铺可读初稿（聚合所有学徒的"我"句，作为一份 AI 初稿）
function mirrorToText(draft) {
  const d = draft || { students: [] };
  const L = [];
  L.push(d.label || MIRROR_LABEL);
  L.push('（AI 学徒理解，全用「我」说，只照镜、不审判。你改完的才是真的总结。）');
  for (const key of MIRROR_BLOCK_KEYS) {
    L.push('');
    L.push('【' + MIRROR_BLOCKS[key].title + '】');
    let any = false;
    for (const s of d.students) {
      for (const it of (s.blocks[key] || [])) {
        any = true;
        L.push('· ' + s.name + '：' + it.text);
      }
    }
    if (!any) L.push('· （这枚学徒这课没有可照的内容）');
  }
  return L.join('\n');
}

// ---- 反射状态（不可变更新：镜稿只读，修改痕迹累加在 edits / itemStatus）----
function initReflectionState(mirrorDraft) {
  return { mirrorDraft: mirrorDraft || { students: [] }, itemStatus: {}, edits: [] };
}

// 五类修改 reducer：返回新 state（浅克隆，mirrorDraft 共享引用不动）
function applyEdit(state, edit) {
  if (!edit || EDIT_KINDS.indexOf(edit.kind) < 0) {
    throw new Error('未知修改动作：' + (edit && edit.kind));
  }
  const ns = {
    mirrorDraft: state.mirrorDraft,
    itemStatus: Object.assign({}, state.itemStatus),
    edits: state.edits.slice(),
  };
  const rec = {
    kind: edit.kind,
    student: edit.student,
    block: edit.block,
    text: edit.text != null ? String(edit.text) : '',
    reserve: !!edit.reserve,
    at: new Date().toISOString(),
  };
  if (edit.kind === 'add') {
    // 补充：往某块追加一条人写的内容（不动原镜稿条目）
    if (!edit.student || MIRROR_BLOCK_KEYS.indexOf(edit.block) < 0) {
      throw new Error('补充动作需要 student + block（heard/confused/misread）');
    }
    rec.id = edit.student + '::' + edit.block + '::add::' + ns.edits.length;
  } else {
    // confirm/rewrite/delete/transform：作用在某条镜稿条目上
    if (edit.id == null && (edit.student == null || edit.block == null || edit.index == null)) {
      throw new Error('该动作需要 id 或 (student+block+index) 定位一条镜稿');
    }
    const id = edit.id != null ? edit.id
      : stableId(edit.student, edit.block, Number(edit.index));
    rec.id = id;
    ns.itemStatus[id] = {
      status: edit.kind,
      humanText: edit.text != null ? String(edit.text) : '',
    };
  }
  ns.edits.push(rec);
  return ns;
}

// ---- 人定稿三阶组装（照镜札记）----
// humanFields: { fact, reflect, action, reserve } 皆为人写，可为空（我们绝不替人编造文字）
// 返回确定性结构（含修改痕迹 trace，但不发明任何总结句）
function buildFinalDraft(state, humanFields) {
  const hf = humanFields || {};
  const trace = { confirmed: [], rewritten: [], deleted: [], transformed: [], added: [] };
  for (const e of (state.edits || [])) {
    if (e.kind === 'confirm') trace.confirmed.push(e.id);
    else if (e.kind === 'rewrite') trace.rewritten.push({ id: e.id, text: e.text });
    else if (e.kind === 'delete') trace.deleted.push(e.id);
    else if (e.kind === 'transform') {
      if (e.reserve) trace.transformed.push({ id: e.id, text: e.text, to: 'reserve' });
      else trace.transformed.push({ id: e.id, text: e.text, to: 'reflect' });
    } else if (e.kind === 'add') trace.added.push({ block: e.block, text: e.text });
  }
  // 转化的"保留"分支累加到 reserve（允许保留困惑）
  let reserve = hf.reserve || '';
  const reserveFromTransform = trace.transformed.filter((t) => t.to === 'reserve').map((t) => t.text).filter(Boolean);
  if (reserveFromTransform.length) {
    reserve = (reserve ? reserve + '\n' : '') + reserveFromTransform.join('\n');
  }
  return {
    label: FINAL_LABEL,
    generatedAt: new Date().toISOString(),
    fact: hf.fact || '',
    reflect: hf.reflect || '',
    action: hf.action || '',
    reserve: reserve || '',
    trace,
  };
}

// 照镜札记 → Markdown
function reflectionToMarkdown(finalDraft) {
  const f = finalDraft || {};
  const L = [];
  L.push('# ' + (f.label || FINAL_LABEL));
  L.push('');
  L.push('> 这份终稿完全属于人。AI 初稿只作为修改痕迹留存，不保留为「正确答案」。');
  L.push('');
  L.push('## 一、事实');
  L.push(f.fact || '（待你写：我讲了什么 / AI 听到了什么）');
  L.push('');
  L.push('## 二、反思');
  L.push(f.reflect || '（待你写：哪里顺 / 哪里卡 / 为什么）');
  L.push('');
  L.push('## 三、行动');
  L.push(f.action || '（待你写：如果重讲一次，我会改变什么）');
  L.push('');
  L.push('## 四、保留');
  L.push(f.reserve || '（待你写：暂时无解的问题；允许保留困惑）');
  const t = f.trace || {};
  const cnt = (t.confirmed || []).length + (t.rewritten || []).length
    + (t.deleted || []).length + (t.transformed || []).length + (t.added || []).length;
  if (cnt) {
    L.push('');
    L.push('## 修改痕迹（AI 初稿 → 人定稿）');
    L.push(`- 确认 ${t.confirmed.length} · 改写 ${t.rewritten.length} · 删除 ${t.deleted.length} · 转化 ${t.transformed.length} · 补充 ${t.added.length}`);
  }
  return L.join('\n');
}

// ---- 七步状态机 ----
function stepCount() { return REFLECTION_STEPS.length; }
function stepLabel(i) { return (i >= 0 && i < REFLECTION_STEPS.length) ? REFLECTION_STEPS[i] : null; }
function nextStep(i) { return (i >= 0 && i < REFLECTION_STEPS.length - 1) ? i + 1 : null; } // null = 已到末步

// ---- 第二批书单方法论代码化（双稿三阶·镜鉴复盘法 / LJ-GMR 增强层）----
// 来源映射（详见 docs/理论基座.md §十.14）：
//   反思性实践(舍恩 reflection-on-action) → 结构化镜鉴提示 + 跨课回看(七步末步)
//   引导式笔记(达利奥引导日记/一行日记) → 引导式设问生成器 + 成长轨迹累积
//   元认知与自我评估(监测-调节)        → 元认知自检锚点(盲区/根因/下一步)
//   形成性评价(为学而评,非评判)        → AI 镜稿恒为形成性、永不为终结性(见 noEval 铁律)
//   AI之镜(瓦尔or)                     → AI 只当镜子不审判(已锁死) + 镜与不镜提示
//   复盘方法(联想四步/AAR)             → 复盘四步锚点(目标/结果/原因/规律)
// 本层只产确定性结构，绝不替人写答案、绝不评分。

// 引导式设问：基于镜稿三块，给"人"出可操作的反思问题（非陈述、非评价）
const GUIDED_PROMPT_KINDS = ['confirm', 'rewrite', 'transform'];
const GUIDED_HINT = {
  heard:   '这我听到的理解，对吗？哪里要补？',
  confused: '这个卡住的点，转成我下一步要追问的问题会是什么？',
  misread: '关于这句，如果让我用自己的话重说一遍，我会怎么说？',
};
function snippet(text) {
  const t = String(text || '');
  const m = t.match(/「([^」]{1,24})」/);
  return m ? m[1] : t.slice(0, 24);
}
function buildGuidedPrompts(mirrorDraft) {
  const d = mirrorDraft || { students: [] };
  const out = [];
  for (const s of (d.students || [])) {
    for (const key of MIRROR_BLOCK_KEYS) {
      const items = s.blocks[key] || [];
      for (let i = 0; i < items.length; i++) {
        const kind = key === 'heard' ? 'confirm' : key === 'confused' ? 'transform' : 'rewrite';
        const text = '「' + snippet(items[i].text) + '」——' + GUIDED_HINT[key];
        out.push({ student: s.name, block: key, index: i, kind, text });
      }
    }
  }
  // 全部须过 noEval（守住"只提问不评判"）
  for (const p of out) {
    if (!noEval(p.text)) throw new Error('引导设问泄漏评价语，已拒绝：' + p.text);
  }
  return out;
}

// 元认知自检锚点（监测"我知/我不知" + 调节"下一步怎么做"）
const METACOG_ANCHORS = [
  { key: 'known_unknown', title: '我以为我懂但其实没懂', desc: '讲出来才发现没懂的地方（盲区）' },
  { key: 'stuck_root',    title: '最想不通的点卡在哪',   desc: '是没敢问、没被点破、还是概念断层' },
  { key: 'next_first',    title: '重来先想清什么',       desc: '如果重讲一次，我会先想清楚什么' },
  { key: 'transfer',      title: '和过去的困惑像不像',   desc: '这次困惑与以前哪次相似，可复用什么' },
];
function buildMetacogPrompts() {
  return METACOG_ANCHORS.map((a) => ({ key: a.key, title: a.title, question: a.desc + '？' }));
}

// 复盘四步锚点（联想复盘：回顾目标/评估结果/分析原因/总结规律）
const REVIEW_FOUR_STEPS = [
  { key: 'goal',   title: '回顾目标', desc: '我这次本来想搞懂的是什么' },
  { key: 'result', title: '评估结果', desc: '我实际带走的理解是什么' },
  { key: 'cause',  title: '分析原因', desc: '那个盲区为什么会产生（没问/没被点破）' },
  { key: 'pattern',title: '总结规律', desc: '下次同类概念先做什么能少走弯路' },
];
function buildReviewPrompts() {
  return REVIEW_FOUR_STEPS.map((s) => ({ key: s.key, title: s.title, question: s.desc + '？' }));
}

// 跨课成长轨迹（保留段=盲区、行动段=意图，逐课累积，绝不替人编造）
function accumulateTrajectory(prev, finalDraft) {
  const p = prev || { entries: [], blindSpotCount: 0, actionCount: 0 };
  const f = finalDraft || {};
  const blind = String(f.reserve || '').split('\n').map((x) => x.trim()).filter(Boolean);
  const acts = String(f.action || '').split('\n').map((x) => x.trim()).filter(Boolean);
  const entry = {
    at: f.generatedAt || new Date().toISOString(),
    summary: String(f.fact || '').slice(0, 80),
    blindSpots: blind,
    actions: acts,
  };
  const entries = (p.entries || []).concat([entry]);
  return {
    entries,
    blindSpotCount: (p.blindSpotCount || 0) + blind.length,
    actionCount: (p.actionCount || 0) + acts.length,
  };
}

// ---- 导出（双模）----
const API = {
  MIRROR_LABEL, FINAL_LABEL, MIRROR_BLOCKS, MIRROR_BLOCK_KEYS,
  EDIT_KINDS, EDIT_LABEL, REFLECT_STAGES, REFLECT_STAGE_KEYS,
  REFLECTION_STEPS,
  noEval, probeLabel,
  buildMirrorDraft, mirrorToText,
  initReflectionState, applyEdit, buildFinalDraft,
  reflectionToMarkdown,
  stepCount, stepLabel, nextStep,
  // LJ-GMR 增强层（第二批书单）
  GUIDED_PROMPT_KINDS, GUIDED_HINT,
  METACOG_ANCHORS, REVIEW_FOUR_STEPS,
  buildGuidedPrompts, buildMetacogPrompts, buildReviewPrompts,
  accumulateTrajectory,
};
if (typeof module !== 'undefined' && module.exports) module.exports = API;
if (typeof window !== 'undefined') window.LJReflection = API;
