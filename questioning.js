// questioning.js — 灵境·TCMQ 确定性提问引擎（提问方法论代码化）
// =====================================================================
// 设计铁律（与 P0-1 同源，守"不靠模型猜怎么问"的命根）：
//   1. 本模块只产出「问句规格 spec」（钉谁 / 什么类型 / 引哪句原话 / 第几层 / 等多久 / 什么姿态）；
//      LLM 只是"嗓音"，负责把 spec 用中文说出口。任何"怎么问"的规则都在此确定性落地，不交给模型。
//   2. 完全不评分、不评判、不纠错——只做"学徒不知而问"的困惑式反射（Schein 谦逊探询 + Chin authentic question）。
//   3. 纯函数、可单测、跨输入可复现（见 tools/test_questioning.mjs）。
//
// 来源（理论基座 §十.6 / §十.8 已挂实证）：
//   - 镜面锚定 100% 引用原话  → paraphrasing question 技术（探究式教学实证）
//   - 学徒姿态（不知而问）    → Schein《Humble Inquiry》2013 谦逊探询
//   - 六层递进（认知操作改编）→ Paul & Elder 2006 苏格拉底六问（对外标注"改编自"）
//   - 等待/沉默              → Rowe 1986 等待时间（≥3 秒，高阶问题无上限）
//   - 双轨（显性/隐性）       → 波兰尼隐性知识 + Nonaka SECI（B 轨模板就位，检测待 ③ 路线接线）
//   - 非评判话术             → Cotton 1988（模糊表扬把教师摆成唯一评判者，须克制）
//   - 陌生学徒姿态           → Keysar 1999/2002 透明错觉（人高估被听懂、对熟人尤甚；AI 扮零背景陌生人最大化缺口外显）
//   - 解释不辩护护栏         → Rozenblit & Keil 2002 解释性错觉(IOED) + Fernbach 2013（请解释机制才暴露盲区，请辩护立场反固化）
// =====================================================================

// ---- 学徒姿态话术库（谦逊探询：提自己不知答案的问题，凭好奇建关系）----
// 全部是"我跟不上 / 我想确认"的困惑式，零评判零纠错零考核。
const STANCE = {
  confused: [
    '我有点跟不上，',
    '这里我不太理解，',
    '你刚说的我有点懵，',
    '我卡住了，',
  ],
  curious: [
    '我想跟你确认一下，',
    '我很好奇，',
    '我刚才没太听明白，',
  ],
};

// ---- 六层认知递进（改编自 Paul & Elder 2006 苏格拉底六问；对外标注"改编自"）----
// 层级越低越安全（澄清），越高越深（反例/元认知）；按人类响应模式升降档。
const PROGRESSION = {
  clarify:      { level: 1, cue: '精确澄清（你说的 X 具体指什么）' },
  example:      { level: 2, cue: '具象举例（能给我一个具体例子吗）' },
  cause:        { level: 3, cue: '因果外化（你是怎么从 A 推到 B 的）' },
  hypothesis:   { level: 4, cue: '边界假设（如果条件变了还成立吗）' },
  counterexample:{ level: 5, cue: '反例证伪（有没有不适用的反例）' },
  metacog:      { level: 6, cue: '元认知来源（你是怎么知道这个的）' },
};

// 探测类型 → 基础递进层（确定性映射，可单测）
const PROBE_TO_LEVEL = {
  distinct:  'clarify',
  example:   'example',
  mechanism: 'cause',
  bound:     'hypothesis',
  counter:   'counterexample',
  apply:     'hypothesis', // 应用新场景 = 边界思考
};

// ---- 双轨提问模板库 ----
// A 轨：显性知识查漏（书本/概念/理论）——逻辑链
const TRACK_A = {
  jargon:   '你刚才说的「{q}」，我记下来了——它具体是什么意思？能用自己的话讲讲吗？',
  jump:     '你从「{a}」一下说到「{b}」，中间那一步到底是怎么发生的？',
  abstract: '你说的是「{q}」这种抽象说法——能不能给我一个具体的例子？',
  parrot:   '你刚才原话是「{q}」，如果换成你自己的话，会怎么讲？',
  // 第 5 类：前提盲区（WYSIATI）。以学徒好奇问"你默认了什么前提"，绝不摆出质疑姿态。
  omit:     '你刚说「{q}」——我有点跟不上：这句话在什么样的情况下会站不住？有没有什么是你默默算进去、但没说出来的前提？',
};
// B 轨：隐性经验萃取（手艺/决策/判断）——场景·权衡链（检测待 ③ 路线接线，当前仅模板就位）
const TRACK_B = {
  scene:    '你刚才讲的是「{q}」——能还原一次具体的情形吗？当时发生了什么？',
  detail:   '关于「{q}」，当时你具体做了什么、没做什么？',
  alt:      '如果换一种做法处理「{q}」，你还会选同样的吗？',
  tradeoff: '在「{q}」里，你优先考虑的是哪一点？放弃了什么？',
  boundary: '「{q}」在什么情况下会完全失效？',
  reflect:  '回看「{q}」，你觉得自己当时判断的根据是什么？',
};

// ---- 等待提示（Rowe 1986：不立即甩下一问 + 复述确认）----
const WAIT = {
  prefix: '让我想想…',
  afterAnswer: '（我先消化一下你刚说的，不急着抛下一个问题；复述确认后我们再往下走）',
};

// ---- 确定性辅助 ----
function stableHash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

// 从人类原话截取锚定片段（镜面原理：100% 引用原话）
function mirrorAnchor(text, maxLen = 22) {
  if (!text || text.trim().length < 4) return '';
  const t = text.trim().replace(/\s+/g, ' ');
  if (t.length <= maxLen) return t;
  // 取中后段，更可能是"刚说的那句"而非开场寒暄
  const start = Math.max(0, Math.floor((t.length - maxLen) / 2));
  return t.slice(start, start + maxLen);
}

// 响应模式推断（确定性启发式；真实校准信号来自人类响应模式，非模型判断）
//   stuck   ：回答很短或回避 → 降一档（更安全）
//   partial ：中等 → 持平
//   fluent  ：回答充实 → 升一档（更深）
function inferResponseMode(text) {
  if (!text || text.trim().length === 0) return 'partial';
  const len = text.trim().length;
  if (len < 12) return 'stuck';
  if (len > 60) return 'fluent';
  return 'partial';
}

// 层级升降（递进原理：ZPD 动态脚手架）
function calibrateLevel(baseKey, responseMode) {
  const order = ['clarify', 'example', 'cause', 'hypothesis', 'counterexample', 'metacog'];
  let idx = order.indexOf(baseKey);
  if (idx < 0) idx = 2;
  if (responseMode === 'stuck') idx = Math.max(0, idx - 1);
  else if (responseMode === 'fluent') idx = Math.min(order.length - 1, idx + 1);
  return order[idx];
}

// 选学徒姿态（确定性：按 target+probeType 哈希，稳定可复现，非随机）
function pickStance(target, probeType) {
  const pool = stableHash(target + '|' + probeType) % 2 === 0 ? STANCE.confused : STANCE.curious;
  return pool[stableHash(target + '|' + probeType + '|s') % pool.length];
}

// ---- 主入口：组装问句规格 ----
// 入参：{ target, probeType, weakPoint?, humanLastUtterance?, responseMode?, round? }
// 返回确定性 spec（LLM 据此说出口）
function buildQuestionSpec({ target, probeType, weakPoint = null, humanLastUtterance = '', responseMode = null, round = 1 }) {
  const rm = responseMode || inferResponseMode(humanLastUtterance);
  const baseKey = PROBE_TO_LEVEL[probeType] || 'cause';
  const levelKey = calibrateLevel(baseKey, rm);
  const prog = PROGRESSION[levelKey];
  const stance = pickStance(target, probeType);
  const quote = mirrorAnchor(humanLastUtterance);
  const anchorRequired = quote.length > 0;
  // 隐性经验检测未接线（③ 路线）前，track 恒为 A；B 轨模板已在 TRACK_B 就位待用。
  const track = 'A';
  return {
    target,
    probeType,
    weakPoint,                 // 可能含 signal/evidence/signalLabel（P0-1 实时定位）
    stance,
    mirroredQuote: quote,
    anchorRequired,
    progressionKey: levelKey,
    progressionLevel: prog.level,
    progressionCue: prog.cue,
    responseMode: rm,
    track,
    waitPrefix: WAIT.prefix,
    waitAfterAnswer: WAIT.afterAnswer,
  };
}

// 把 spec 渲染成喂给 LLM 的中文指令串（替代原 teacher.js 内联 wpHint）
function renderWpHint(spec) {
  const parts = [];
  if (spec.weakPoint && spec.weakPoint.signalLabel) {
    parts.push(`（确定性定位：先生在讲「${spec.target}」时露出"${spec.weakPoint.signalLabel}"信号——"${spec.weakPoint.evidence || ''}"。你这枚探测就专盯这个口子，别跑题。）`);
  }
  // 镜面锚定 + 确定性问句模板：把"学徒该怎么说"直接给到，LLM 只当嗓音（仍不靠模型编怎么问）
  if (spec.weakPoint && TRACK_A[spec.weakPoint.signal]) {
    const q = (spec.mirroredQuote || spec.weakPoint.evidence || spec.target).slice(0, 22);
    const phrasing = TRACK_A[spec.weakPoint.signal].replace(/\{q\}/g, q).replace(/\{a\}/g, q).replace(/\{b\}/g, q);
    parts.push(`🔎 这一枚就这么问（锚定原话，学徒口吻，别改写意思）：「${phrasing}」`);
  }
  // 镜面锚定：100% 引用原话
  if (spec.anchorRequired) {
    parts.push(`🔎 镜面锚定：你提问时务必引用先生刚说的原话——「${spec.mirroredQuote}」，把这句话以问题的形式反弹回去，不要凭空起问。`);
  }
  // 学徒姿态：谦逊探询，零评判
  parts.push(`🔎 姿态：${spec.stance}你是来听课的学生，不是考官——不要评判、不要纠错、不要说"你讲得真棒"这类空泛赞美。`);
  // 陌生学徒姿态（透明错觉 Keysar 1999/2002：人总高估自己被听懂，且对熟人高估更甚 → 越不脑补上下文，用户越把缺口讲出）
  parts.push('🔎 陌生学徒：你是零背景的陌生学生，不要替先生脑补他没说出口的上下文、前提或行业黑话——你越"不懂他的世界"，他越会把默认的前提讲出来。');
  // 解释不辩护护栏（解释性错觉 IOED / Rozenblit & Keil 2002；Fernbach 2013：请人解释机制才暴露盲区，请人为立场辩护反而固化看法）
  parts.push('🔎 解释不辩护：只请先生讲"这怎么发生 / 为什么"，绝不要请他为某个立场或结论辩护——要人辩护立场只会让他的看法更固化，偏离照见盲区。');
  // 递进层
  parts.push(`🔎 递进：落到第 ${spec.progressionLevel} 层（${spec.progressionCue}）；人类答得流畅就再深一档，答得短/卡就退回更安全的层。`);
  // 等待
  parts.push(`🔎 等待：${spec.waitAfterAnswer}`);
  return parts.join('\n');
}

module.exports = {
  STANCE, PROGRESSION, TRACK_A, TRACK_B, WAIT,
  PROBE_TO_LEVEL,
  stableHash, mirrorAnchor, inferResponseMode, calibrateLevel, pickStance,
  buildQuestionSpec, renderWpHint,
};
