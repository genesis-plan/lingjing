// questioning.js — 灵境·TCMQ 确定性提问引擎（提问方法论代码化）
// =====================================================================
// 设计铁律（与 P0-1 同源，守"不靠模型猜怎么问"的命根）：
//   1. 本模块只产出「问句规格 spec」（钉谁 / 什么类型 / 引哪句原话 / 第几层 / 等多久 / 什么姿态）；
//      LLM 只是"嗓音"，负责把 spec 用中文说出口。任何"怎么问"的规则都在此确定性落地，不交给模型。
//   2. 完全不评分、不评判、不纠错——只做"学徒不知而问"的困惑式反射（以好奇提问、请人解释机制、禁为人辩护立场）。
//   3. 纯函数、可单测、跨输入可复现（见 tools/test_questioning.mjs）。
//
// 各规则的原理（认知研究可查证，本产品只吸收方法、不挂出处）：
//   - 镜面锚定 100% 引用原话  → 中性重述建立信任、维持思考流，逼人自察
//   - 学徒姿态（不知而问）    → 以好奇提问、不装懂，结构性安全空间
//   - 六层递进（认知操作改编）→ 澄清→举例→因果→假设→反例→元认知，分层攀升
//   - 等待/沉默              → 提问后留认知停顿、不抢答（高阶问题尤需）
//   - 双轨（显性/隐性）       → 显性逻辑链 + 隐性场景·权衡链（B 轨模板就位，检测待接线）
//   - 非评判话术             → 模糊表扬把人摆成唯一评判者、抑制自判，须克制
//   - 陌生学徒姿态           → 扮零背景陌生人、不脑补上下文，最大化缺口外显
//   - 解释不辩护护栏         → 请人解释机制才暴露盲区，请人为立场辩护反固化
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
  // 第 5 类：前提盲区。以学徒好奇问"你默认了什么前提"，绝不摆出质疑姿态。
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

// ---- 等待提示（不立即甩下一问 + 复述确认）----
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

// =====================================================================
// 认知负荷约束 + 最优停时判据（2026-09-25 落码，守"不靠模型猜"铁律）
// -------------------------------------------------------------------
// ① 单轮单概念：研究显示「由模型发起的任务切换」是绩效下降的最强预测因子，
//    其影响约为内在认知负荷的 3 倍。故本引擎强制：一次探测只盯一个概念，
//    若 target 与当前 focus 不同，强制退回最安全的澄清层并显式标记换题。
// ② 最优停时：追问"问几轮停"不问设计师拍脑袋，而按
//        τ* = argmax_n E[ I_n − c·n ]       （I_n=本轮新信息，c=打断成本）
//    的停时结构判定——每轮只问一句"下一轮的新信息还值不值这个打断成本"。
//    注意：I_n 用**新词比例的代理度量**近似（确定性、零 LLM、可单测），
//    它不是真实互信息；真实信息增益需要人的真值，而 A2 禁止表示掌握概率。
//    故此处口径为"尽力而为的确定性代理"，不是最优停时的严格实现。
// =====================================================================

// 确定性分词（不引入任何分段器依赖）
function tokenize(text) {
  if (!text) return [];
  return String(text.toLowerCase())
    .split(/[^0-9a-z一-龥]+/i)
    .filter((t) => t.length > 1);
}

// 本轮新信息增益的**代理度量**：本轮相对上一轮的新词占比 ∈ [0,1]
// 字符 n-gram（默认 2-gram）：中文没有空格，"同义反复"的字面片段切分会随标点/虚词浮动，
// 用整词切分会把"和刚才一样，是植物用阳光、水和二氧化碳…"算成和上一轮完全不同 → 假增益 ≈1。
// 字符 2-gram 对这种浮动稳得多（重叠片段照旧重叠）。
function charNgrams(text, n = 2) {
  const s = String(text || '').replace(/\s+/g, '').toLowerCase();
  const out = new Set();
  if (!s) return out;
  if (s.length < n) { out.add(s); return out; }
  for (let i = 0; i <= s.length - n; i++) out.add(s.slice(i, i + n));
  return out;
}

function estimateGain({ utterance = '', prevUtterance = '' } = {}) {
  if (!String(utterance || '').trim()) return 0;
  const cur = charNgrams(utterance);
  if (!cur.size) return 0;
  if (!String(prevUtterance || '').trim()) return 1; // 首轮：已知有信息
  const prev = charNgrams(prevUtterance);
  let fresh = 0;
  cur.forEach((t) => { if (!prev.has(t)) fresh++; });
  return fresh / cur.size;
}

// 最优停时判据：此刻是否仍值得继续追问
//   gain > cost → 净收益为正，继续；gain ≤ cost → 停；round ≥ maxRounds → 停（预算）
function shouldContinue({ round = 1, gain = 0, cost = 0.35, maxRounds = 8 } = {}) {
  if (round >= maxRounds) return { stop: true, reason: 'budget-exhausted', gain, cost };
  if (gain <= cost)   return { stop: true, reason: 'gain-below-cost', gain, cost };
  return { stop: false, reason: 'positive-net', gain, cost };
}

// 单轮单概念约束：换题即退回安全层，并把换题这件事显式暴露（可被 UI 与测试看见）
function enforceSingleFocus(spec, focus = null) {
  if (!focus) return { ...spec, focusShifted: false, focusedOn: spec.target };
  const focusedOn = focus;
  const focusShifted = spec.target !== focus;
  if (!focusShifted) return { ...spec, focusShifted: false, focusedOn };
  // 换题 → 强制澄清层，并给出换题理由（不静默跳概念）
  const safe = PROGRESSION.clarify;
  return {
    ...spec,
    target: focus,
    progressionKey: 'clarify',
    progressionLevel: safe.level,
    progressionCue: safe.cue,
    focusShifted: true,
    focusReason: `上轮还停在「${spec.target}」，本轮改问「${focus}」——按认知负荷约束，一次只追一个概念，故退回最安全的澄清层。`,
    focusedOn,
  };
}

// =====================================================================
// 期望信息增益（EIG）选问：挑"答与不答各一半"的那枚问题
// -------------------------------------------------------------------
// 原理（arXiv 2510.20886「Shoot First, Ask Questions Later」的闭式）：
//      一个人对某个问题的答案是**带噪信道**，噪声率记 ε（他可能答偏、答空、答非所问）。
//      设 p_t = 先验"他这次会顺着答"的概率，则问 q 能消除的不确定性是
//          EIG(q) = H_b( ε + (1−2ε)·p_t ) − H_b( ε )
//      其中 H_b 是二元熵。展开看：p_t = 0.5 时 EIG 最大（这枚问题一半一半，删掉的分支最多），
//      p_t → 1（他必然答）或 p_t → 0（他必然不答）时 EIG 都趋于 0——那就是枚没信息量的废问。
//   直觉对照：问"这个词什么意思"＝他必定答，听完了，但你没消除任何分支；
//             问"你默认了什么前提"＝他可能说也可能不说，一说你就砍掉一大片。所以后者更值。
//
// ⚠️ A2 兼容性（这条必须钉死）：p_t 与 ε 都是**写死在代码里的常量先验**，
//    不是从人类表现里估出来的。本引擎不表示掌握概率、不给人打分——
//    EIG 说的是"这一枚问句自身有多可能产生信息"，跟回答者的好坏无关。
//    想改先验就直接改下面的常量表，全部可审计、可单测。
//
// 与旧实现的差别：旧 probeKind() 是**轮转调度**（第几轮抛哪一类写死），问什么跟问得值不值无关；
//   EIG 是**信息调度**：每一轮从该问的类型里挑 EIG 最高的那枚。
// =====================================================================

// 通道噪声率 ε：答案可能含糊/答偏/跑题（认知研究里"解释性错觉 IOED"——人会答得比自己以为的更泛）
const CHANNEL_NOISE = 0.15;

// 先验 p_t：问这一类问题时，"对方会顺着答"的概率。
//   数值来自提问设计的常识标定（不是实测拟合），改这里就必须重跑 test_eig.mjs。
const PRIOR_ANSWERS = {
  distinct:     0.90, // "这两个说法差在哪" —— 人几乎一定会解释
  example:      0.85, // "给我个例子" —— 人几乎一定会举
  mechanism:    0.80, // "为什么会这样" —— 多半会讲
  bound:        0.55, // "什么情况下不成立" —— 有时答、有时绕
  apply:        0.55, // "换成别的还成立吗" —— 同上
  counter:      0.40, // "有没有反例" —— 经常举不出来，举不出来本身就是信息
  hypothesis:   0.50, // 边界假设
  land:         0.70, // 薄教案：把原话举起来逼落地，多半会补具体事例
};

// 二元熵 H_b(p)，p∈[0,1]
function bernoulliEntropy(p) {
  const x = Math.min(1, Math.max(0, Number(p) || 0));
  if (x <= 0 || x >= 1) return 0;
  return -(x * Math.log2(x) + (1 - x) * Math.log2(1 - x));
}

// EIG = H_b(ε + (1−2ε)·p_t) − H_b(ε)
function eigOf(probeType, noise = CHANNEL_NOISE) {
  const pt = PRIOR_ANSWERS[probeType];
  if (pt == null) return 0;                       // 未登记类型 → 不参与优选（保守）
  const eps = Math.min(0.49, Math.max(0, noise));
  return bernoulliEntropy(eps + (1 - 2 * eps) * pt) - bernoulliEntropy(eps);
}

// 上一轮问过的类型 × 本次人类答得怎么样 → 本轮这一类的实际 EIG
//   responseMode='fluent'：他在这个方向上已经讲透了，再问剩余不确定性本来就少 → 打折
//   responseMode='stuck' ：他卡住了，多半是这枚问得太深 → 也打折（不硬顶）
//   repeatStreak：连续问过同一类的次数，越多越要打折（避免连着三问都在同一个方向上打转）
function adjustedEig({ probeType, responseMode = null, repeatStreak = 0, noise = CHANNEL_NOISE } = {}) {
  let base = eigOf(probeType, noise);
  if (responseMode === 'fluent') base *= 0.72;
  else if (responseMode === 'stuck') base *= 0.85;
  if (repeatStreak > 0) base *= Math.pow(0.55, repeatStreak);   // 0.55^n 快速衰减
  // 不做 6 位量化：表达式只有 mul/add/log2，双精度在同构环境里本就确定性，
  // 量化只会制造"为什么这个值少了末位"的困惑，没有任何可复现性收益。
  return base;
}

// 从候选类型里挑 EIG 最高的一枚（平手时按传入顺序取先者——确定性，可复现）
function pickByEig(candidates, opts = {}) {
  const list = (Array.isArray(candidates) && candidates.length) ? candidates : [];
  let best = null, bestEig = -Infinity;
  for (const c of list) {
    const e = adjustedEig({ probeType: c, ...opts });
    if (e > bestEig) { bestEig = e; best = c; }
  }
  return { probeType: best || list[0] || null, eig: bestEig === -Infinity ? 0 : bestEig };
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
// 入参：{ target, probeType, weakPoint?, humanLastUtterance?, responseMode?, round?, focus?, cost? }
// 返回确定性 spec（LLM 据此说出口）；focus 非空时启用单轮单概念约束
function buildQuestionSpec({ target, probeType, weakPoint = null, humanLastUtterance = '', responseMode = null, round = 1, focus = null, cost = null } = {}) {
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
    // 单轮单概念：默认视为未换题（不带 focus 调用的旧路径保持原行为）
    focusShifted: false,
    focusedOn: target,
  };
}

// 组装 + 单轮单概念约束（先算 spec，再约束 focus，最后给出停时判定）
// 返回 { spec, continueDecision }
function planNextProbe({ target, probeType, weakPoint = null, humanLastUtterance = '', responseMode = null, round = 1, focus = null, prevUtterance = '', cost = null, maxRounds = 8 } = {}) {
  const spec = buildQuestionSpec({ target, probeType, weakPoint, humanLastUtterance, responseMode, round });
  const constrained = enforceSingleFocus(spec, focus);
  const gain = estimateGain({ utterance: humanLastUtterance, prevUtterance });
  const c = cost === null ? 0.35 : cost;
  const continueDecision = shouldContinue({ round: round + 1, gain, cost: c, maxRounds });
  return { spec: constrained, continueDecision, gainEstimated: gain };
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
  tokenize, estimateGain, shouldContinue, enforceSingleFocus, planNextProbe,
  // EIG 选问（信息调度，替代轮转调度）
  CHANNEL_NOISE, PRIOR_ANSWERS, bernoulliEntropy, eigOf, adjustedEig, pickByEig,
};
