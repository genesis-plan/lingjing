// reflection.js — 灵境·双稿制确定性反思引擎（总结方法论代码化）
// =====================================================================
// 设计铁律（镜像 questioning.js，守"不靠模型替人定稿"的命根）：
//   1. 本模块只产出「双稿制」的确定性结构：AI 镜稿三块、人五类修改 reducer、
//      人定稿三阶（照镜札记）组装、七步状态机。LLM 只是"嗓音"，不在此写任何总结文字。
//   2. 完全不评分、不评判、不纠错、不替人下结论 —— 只做"学徒照镜"的反射。
//   3. 纯函数、可单测、跨输入可复现（见 tools/test_reflection.mjs）。
//
// 与 docs/理论基座.md §十（双稿制·定稿·不可改动·2026-09-16 锁死）对齐：
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

// ---- 双稿三阶·镜鉴复盘法（增强层）----
// 本层把若干被反复验证过的"照镜子"方法重组为一组确定性脚手架：引导设问、元认知自检、
// 复盘四步、跨课轨迹。原则只吸收进逻辑与命名，不挂任何外部出处；本层只产确定性结构，
// 绝不替人写答案、绝不评分（见 noEval 铁律）。

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

// ---- 抓主要矛盾 / 自我批评（方法增强；原则只吸收进逻辑，不挂任何出处）----
// 抓主要矛盾：从累积盲区里定位最该先啃的一条（频次最高、并列取最具体）。
//   只读、纯函数、不替人编造；对应"先解决主要问题"的工程化表达。
function mainContradictionOf(traj) {
  const t = traj || { entries: [] };
  const freq = {};
  for (const e of (t.entries || [])) {
    for (const bs of (e.blindSpots || [])) {
      const k = String(bs || '').trim();
      if (!k) continue;
      freq[k] = (freq[k] || 0) + 1;
    }
  }
  const keys = Object.keys(freq);
  if (!keys.length) return null;
  keys.sort((x, y) => (freq[y] - freq[x]) || (y.length - x.length));
  const top = keys[0];
  return { text: top, count: freq[top] };
}
function buildMainContradictionPrompt(prev, finalDraft) {
  const here = String((finalDraft && finalDraft.reserve) || '').split('\n').map((x) => x.trim()).filter(Boolean);
  const merged = (prev && prev.entries) ? prev : { entries: [] };
  const t = { entries: merged.entries.concat([{ blindSpots: here }]) };
  const mc = mainContradictionOf(t);
  if (!mc) return null;
  const lead = mc.count > 1 ? ('「' + mc.text + '」反复出现（' + mc.count + ' 次）') : ('「' + mc.text + '」');
  const text = '在这么些保留困惑里，' + lead + '——先啃它：把它转成你下一步最想追问的一个问题？';
  if (!noEval(text)) throw new Error('抓主要矛盾提示泄漏评价语：' + text);
  return { key: 'main_contradiction', target: mc.text, count: mc.count, text };
}

// 自我批评式自判脚手架：人自判"坚持住的(真理) / 要修正的(错误)"，与五类修改、复盘四步互补
const SELF_CRITIQUE_ANCHORS = [
  { key: 'uphold',  title: '坚持住的（真理）', desc: '这次我真正搞懂、要一直记牢的一点是什么' },
  { key: 'correct', title: '要修正的（错误）', desc: '这次我发现原来理解偏了、要改过来的一点是什么' },
];
function buildSelfCritiquePrompts() {
  return SELF_CRITIQUE_ANCHORS.map((a) => ({ key: a.key, title: a.title, question: a.desc + '？' }));
}

// ---- 渐进试错 / 效果导向（方法增强；原则只吸收进逻辑，不挂出处）----
// 渐进试错：先拿最小例子试一遍，从"试"里现出没搞清的地方（小步推进、不等想全再动）。
const TRIAL_ANCHORS = [
  { key: 'try_first',   title: '先试一小步', desc: '别等想全再动——拿一个最小例子先试一遍' },
  { key: 'learn_doing', title: '从试中找漏', desc: '试的时候哪里卡住、答不上来，就是我还没搞清的地方' },
];
function buildTrialPrompts() {
  return TRIAL_ANCHORS.map((a) => ({ key: a.key, title: a.title, question: a.desc + '？' }));
}

// 效果导向：以"能讲清/能用"为真的判据，不拘形式、不重 dogma（看成效而非看样子）。
const OUTCOME_ANCHORS = [
  { key: 'prove_get',  title: '我拿什么证明真懂', desc: '是能讲清、能解决一个具体问题，还是只"看了/记了"' },
  { key: 'ignore_form', title: '不拘形式',       desc: '懂没懂看效果，不看得笔记全不全、答得顺不顺' },
];
function buildOutcomePrompts() {
  return OUTCOME_ANCHORS.map((a) => ({ key: a.key, title: a.title, question: a.desc + '？' }));
}

// 生成式总结（方法增强；原理只吸收进逻辑，不挂出处）
// 用自己的话重述要点：挑重点(select) → 组织成一段更短(organize) → 连到已有/上一课(integrate) → 能用到别处(extend)。
// 写给自己当工具(writer-based)，不拘措辞；照抄原句不是真总结；目的在能迁移到新情境。
const SUMMARY_ANCHORS = [
  { key: 'select',   title: '挑最关键的 3 条',   desc: '从你这课的保留与行动里，挑出最关键的 3 条' },
  { key: 'organize', title: '组织成一段（更短）', desc: '用你自己的话，把 3 条写成一段——比原话更短，别照抄原句' },
  { key: 'integrate', title: '连到已有的',        desc: '这一课和你以前知道的什么能连起来' },
  { key: 'extend',   title: '能用到别处',        desc: '这 3 条如果换一个完全不是这堂课的场景，你会怎么用' },
];
function buildSummaryPrompts(prev, fd) {
  const out = SUMMARY_ANCHORS.map((a) => ({ key: a.key, title: a.title, question: a.desc + '？' }));
  // 让脚手架"真会动"：依据跨课轨迹把 select / integrate 锚点具体化（非恒定）
  if (prev && typeof prev === 'object') {
    const n = (prev.blindSpotCount | 0);
    const m = Array.isArray(prev.entries) ? prev.entries.length : 0;
    if (n > 0) {
      const sel = out.find((x) => x.key === 'select');
      if (sel) sel.question = '从你这课的保留与行动里，挑出最关键的 3 条——其中至少 1 条，来自你跨课反复卡住的点（共 ' + n + ' 条）？';
    }
    if (m > 1) {
      const intg = out.find((x) => x.key === 'integrate');
      if (intg) intg.question = '这一课和你最早一课（共跨 ' + m + ' 课）的哪条保留困惑能连起来？连一下？';
    }
  }
  for (const p of out) noEval(p.question); // 零评价语铁律
  return out;
}

// 跨课复习调度（路线数学：SM-2 间隔 + Ebbinghaus 遗忘曲线；只提示"该回看了"，不判掌握度）
// 把"人类自己记下的保留困惑"按出现次数给间隔建议，到期就提示回看——纯调度，守人判契约。
const REVIEW_EF0 = 2.5; // SM-2 初始易度因子（无人工评分则不调）
function reviewItems(traj, now) {
  const t = traj || { entries: [] };
  const nowMs = (typeof now === 'number' && now > 0) ? now : Date.now();
  const DAY = 86400000;
  const byKey = {};
  for (const e of (t.entries || [])) {
    const at = Date.parse(e.at || '');
    if (!(at > 0)) continue;
    for (const raw of (e.blindSpots || [])) {
      const k = String(raw || '').trim();
      if (!k) continue;
      if (!byKey[k]) byKey[k] = { text: k, seen: [] };
      byKey[k].seen.push(at);
    }
  }
  const out = [];
  for (const k of Object.keys(byKey)) {
    const seen = byKey[k].seen.slice().sort((a, b) => a - b);
    const reps = seen.length;
    const firstSeen = seen[0];
    const lastSeen = seen[seen.length - 1];
    // SM-2 间隔：I(1)=1, I(2)=6, I(n>2)=I(n-1)·EF
    let intervalDays;
    if (reps <= 1) intervalDays = 1;
    else if (reps === 2) intervalDays = 6;
    else intervalDays = 6 * Math.pow(REVIEW_EF0, reps - 2);
    const dueAt = lastSeen + intervalDays * DAY;
    const dueInDays = (dueAt - nowMs) / DAY;
    out.push({
      text: k,
      firstSeen, lastSeen, reps,
      intervalDays: Math.round(intervalDays * 10) / 10,
      dueInDays: Math.round(dueInDays * 10) / 10,
      due: dueAt <= nowMs,
    });
  }
  // 到期优先；同状态按出现次数多者优先；再按最近出现早者优先
  out.sort((a, b) => ((a.due === b.due) ? 0 : (a.due ? -1 : 1))
    || (b.reps - a.reps) || (a.lastSeen - b.lastSeen));
  return out;
}
function buildReviewSchedulePrompts(traj, now) {
  const items = reviewItems(traj, now).filter((x) => x.due);
  return items.map((x) => {
    const q = '「' + snippet(x.text) + '」是你反复记下的保留困惑（跨 ' + x.reps
      + ' 课）——按间隔复习，现在该回看一眼：它现在有进展了吗？';
    if (!noEval(q)) throw new Error('复习调度提示泄漏评价语：' + q);
    return { key: 'review', title: '该回看了', question: q };
  });
}

// ---- 生成式总结·辅助计算（确定性本地启发式；只给候选/链接/度量，不替人定稿）----
// 设计路线实现：Select=子模贪心×多样性挑 top-k；Organize=压缩比代理；Integrate=余弦近邻链接；
// Extend=取历史中最不像本课的点作迁移靶。全部用 bag-of-words 余弦近似，无模型、无 API、可复现。
// 诚实标注：这些是"辅助建议"，最终判定权永远在人（守人判契约）。
const SUM_STOP = new Set(['的','了','是','在','我','你','他','她','它','我们','你们','他们','这','那','这个','那个','和','与','及','或','也','都','就','不','没','有','把','被','让','给','对','从','到','为','以','上','下','中','里','后','前','而','但','因为','所以','如果','一个','一种','怎么','什么','如何','为什','吗','呢','吧','啊','会','能','要','去','做','说','想','看','知道','觉得','应该','可以','这些','那些','自己','它们']);
function sumTokenize(t) {
  const s = String(t || '');
  const out = [];
  const re = /[A-Za-z0-9]+|[\u4e00-\u9fff]/g;
  let m;
  while ((m = re.exec(s))) {
    const w = m[0].toLowerCase();
    if (/[a-z0-9]/.test(w)) { if (w.length > 1) out.push(w); }
    else if (!SUM_STOP.has(w)) out.push(w);
  }
  return out;
}
function sumBow(tokens) {
  const m = {};
  for (const t of tokens) m[t] = (m[t] || 0) + 1;
  return m;
}
function sumCosine(a, b) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  let dot = 0, na = 0, nb = 0;
  for (const k of keys) {
    const x = a[k] || 0, y = b[k] || 0;
    dot += x * y; na += x * x; nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
// 子模贪心×多样性：每步选 信息量(不同 token 数) / (1 + 已选相似度之和) 最大者
function summarySelect(items, k) {
  const arr = (items || []).map((s) => String(s || '').trim()).filter(Boolean);
  const uniq = [];
  const seen = new Set();
  for (const s of arr) { if (!seen.has(s)) { seen.add(s); uniq.push(s); } }
  const kk = Math.max(1, Math.min(k || 3, uniq.length));
  const chosen = [];
  const chosenBow = [];
  while (chosen.length < kk) {
    let best = -1, bestScore = -1;
    for (let i = 0; i < uniq.length; i++) {
      if (chosen.includes(uniq[i])) continue;
      const bow = sumBow(sumTokenize(uniq[i]));
      const salience = Object.keys(bow).length;
      let divPenalty = 0;
      for (const cb of chosenBow) divPenalty += sumCosine(bow, cb);
      const score = salience / (1 + divPenalty);
      if (score > bestScore) { bestScore = score; best = i; }
    }
    if (best < 0) break;
    chosen.push(uniq[best]);
    chosenBow.push(sumBow(sumTokenize(uniq[best])));
  }
  return chosen.map((s) => {
    const bow = sumBow(sumTokenize(s));
    return { text: s, salience: Object.keys(bow).length };
  });
}
// 压缩比代理：summary 相对 raw 的长度比（≤1；越短越凝练）
function compressionRatio(raw, summary) {
  const r = String(raw || '').length, s = String(summary || '').length;
  if (r === 0) return s === 0 ? 1 : 1;
  return Math.max(0, Math.min(1, s / r));
}
// 取跨课盲区文本集合
function _trajBlindSpots(traj) {
  const out = [];
  for (const e of (traj && traj.entries || [])) {
    for (const b of (e.blindSpots || [])) {
      const t = String(b || '').trim();
      if (t) out.push(t);
    }
  }
  return out;
}
// Integrate：把 currentText 连到历史里最像的已有保留点（余弦近邻）
function summaryIntegrate(currentText, traj) {
  const cur = sumBow(sumTokenize(currentText));
  if (Object.keys(cur).length === 0) return [];
  const hist = _trajBlindSpots(traj);
  return hist.map((t) => ({ text: t, similarity: Math.round(sumCosine(cur, sumBow(sumTokenize(t))) * 1000) / 1000 }))
    .filter((x) => x.similarity > 0)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, 2);
}
// Extend：取历史里最不像 currentText 的点作迁移靶（最小相似度 = 最远）
function summaryExtend(currentText, traj) {
  const cur = sumBow(sumTokenize(currentText));
  if (Object.keys(cur).length === 0) return null;
  const hist = _trajBlindSpots(traj);
  let best = null, bestSim = 2;
  for (const t of hist) {
    const sim = sumCosine(cur, sumBow(sumTokenize(t)));
    if (sim < bestSim) { bestSim = sim; best = t; }
  }
  if (!best) return null;
  return { text: best, similarity: Math.round(bestSim * 1000) / 1000 };
}
function buildSummaryAssist(traj, currentText) {
  const cur = (typeof currentText === 'string' && currentText.trim()) ? currentText : null;
  const spots = _trajBlindSpots(traj);
  const select = summarySelect(spots, 3);
  const integrate = cur ? summaryIntegrate(cur, traj) : [];
  const extend = cur ? summaryExtend(cur, traj) : null;
  return { select, integrate, extend };
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
  // 抓主要矛盾 / 自我批评（方法增强）
  buildMainContradictionPrompt, SELF_CRITIQUE_ANCHORS, buildSelfCritiquePrompts,
  // 渐进试错 / 效果导向（方法增强）
  buildTrialPrompts, TRIAL_ANCHORS, buildOutcomePrompts, OUTCOME_ANCHORS,
  // 生成式总结（方法增强）
  buildSummaryPrompts, SUMMARY_ANCHORS,
  // 生成式总结·辅助计算（确定性本地启发式；只给候选/链接/度量，不替人定稿）
  buildSummaryAssist, summarySelect, compressionRatio, summaryIntegrate, summaryExtend,
  // 跨课复习调度（路线数学：SM-2 间隔 + 遗忘曲线）
  reviewItems, buildReviewSchedulePrompts, REVIEW_EF0,
};
if (typeof module !== 'undefined' && module.exports) module.exports = API;
if (typeof window !== 'undefined') window.LJReflection = API;
