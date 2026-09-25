// experience.js — 灵境·体验节奏引擎
// =====================================================================
// 设计声明（用户 2026-09-25 拍板，本模块为这条原则的代码落地）：
//
//   **本产品的目标是让人获得体验，不是让机器人采集信息。**
//
//   所以一节课不是一条信息流水线，而是一段有呼吸的对话——有开场、有深潜、
//   有留白、有收束。镜子不是每一拍都必须追问：真正让人感到"被听见"的瞬间，
//   往往发生在镜子**接住他说的话然后闭嘴**的那一下，而不是它抛出的第 8 个问题。
//
//   对照旧实现（2026-09-25 之前）：probeKind() 每轮必定返回一枚探测类型，
//   于是课堂恒为"抛问 → 收集 → 抛问 → 收集"，人感受到的是被一台评估器筛。
//   本模块引入**拍子（beat）**概念，允许"这一拍镜子只是照一下、不追问"。
//
// 三条硬约束（与 A2 同源，本模块不评分）：
//   ① 不评分：任何输出都不表示人答得好不好、掌握不掌握。
//      reflectLine 只会举原话 + 一句好奇，绝不出"很好/答对了/这里有错"。
//   ② 不替人拍方向：节奏由课时长与轮次决定，不由"人表现如何"决定
//      （那样等于把人当被测对象，机器一看他表现好就加码，体验立刻变考核）。
//   ③ 确定性：除可选的随机种子外全为纯函数，同输入同输出，可单测可复现。
// =====================================================================

// ---- 拍子（体验弧线）------------------------------------------------
//   DEEPEN  深潜：抛一枚真探测（课堂的主体，占多数）
//   ECHO    呼应：照一句你刚才说的，带一句好奇，但不追问下一个
//   PAUSE   留白：接住你说的话，明确闭嘴，把话头交回给你
//   CLOSE   收束：这一课要收了，不再追
//
// 为什么分成 ECHO / PAUSE 两档：都是"不追问"，但体感不同。
//   ECHO 有一点探（"你为什么偏偏挑这句说"），PAUSE 什么都不探（"这句我记下了"）。
//   只留 PAUSE 会太冷；只留 ECHO 又回到盘问。交替才有呼吸。
const BEAT = { DEEPEN: 'DEEPEN', ECHO: 'ECHO', PAUSE: 'PAUSE', CLOSE: 'CLOSE' };

// 拍子的人话（给前端/日志显示；不写技术术语——用户要的是体验不是调度）
const BEAT_TEXT = {
  DEEPEN: '追问一枚',
  ECHO: '接住你说的话',
  PAUSE: '不追问了，你接着说',
  CLOSE: '这一课收在这儿',
};

// 排一节课的拍子（确定性：只由总轮数决定，不观测任何人）
//
// 规则：
//   ① 第 1 拍永远是 DEEPEN —— 开场就得把人拉进来，不能第一拍就沉默；
//   ② 最后一拍永远是 CLOSE —— 有始有终，不能上到一半突然结束；
//   ③ 从倒数第二拍起开始收（n≥3 时倒数第二拍为 PAUSE），给一个"准备收"的过渡；
//   ④ 每隔几拍插一次 ECHO（r % 3 === 0），其余为 DEEPEN。
function planBeats(maxRounds) {
  const n = Math.max(1, Math.floor(Number(maxRounds) || 1));
  const out = [];
  for (let r = 1; r <= n; r++) {
    if (r === 1) out.push(BEAT.DEEPEN);
    else if (r === n) out.push(BEAT.CLOSE);
    else if (r === n - 1 && n >= 3) out.push(BEAT.PAUSE);
    else if (n >= 4 && r % 3 === 0) out.push(BEAT.ECHO);
    else out.push(BEAT.DEEPEN);
  }
  return out;
}

// 第 round 拍的拍子（越界则钳到最后一拍，避免调用方传错轮次时 classroom 卡住）
function beatFor(round, maxRounds) {
  const beats = planBeats(maxRounds);
  if (!beats.length) return BEAT.DEEPEN;
  const i = Math.min(beats.length - 1, Math.max(0, Math.floor(Number(round) || 1) - 1));
  return beats[i];
}

// 这一拍镜子的身份（决定说话的语气与开口人数）
//   DEEPEN/CLOSE → 照常抛问；ECHO/PAUSE → 只照一句、且不抢话头
const SPEAKING_BEATS = new Set([BEAT.DEEPEN]);
function beatIsAsking(beat) {
  return SPEAKING_BEATS.has(beat);
}

// ---- 镜子的「映照」：本模块的核心体验件 --------------------------------
// 旧实现里，人说完一句之后下一拍必然是一枚新探测——人永远在被追问。
// 映照做的是另一件事：**把人自己的话原样举回来**，配一句具体的、好奇的（非考核的）反应。
//
// ⚠️ 不评分：下面全部模板只表达"没听清 / 想多知道一点 / 记下了"，
//    没有任何一个词能推出"人答得好 / 答得差"。测试里专门锁了这条（见 test_experience.mjs）。
//
// q: 是否带疑问（PAUSE 档恒为 false——留白就该闭嘴，不该改头换面再问一次）

const REFLECT_TEMPLATES = [
  { q: false, text: (q) => `「${q}」——我先记下这句。` },
  { q: true,  text: (q) => `你刚说的是「${q}」。我卡了一下：你是在哪种情形下想到它的？` },
  { q: true,  text: (q) => `「${q}」——这句听着跟前面那句不太一样，你把这两句摆一块儿看看？` },
  { q: false, text: (q) => `你说的「${q}」，我得消化一下——不急着往下走。` },
  { q: true,  text: (q) => `「${q}」。这句是你自己最想说的那个点吗？` },
  { q: true,  text: (q) => `「${q}」——我记住了。你为什么偏偏挑这句说？` },
  { q: true,  text: (q) => `「${q}」我得问一下：你说的这个"它"，指的是哪一个？` },
  { q: false, text: (q) => `「${q}」——好，我把它摆在我这儿了。` },
];

// 收束句（CLOSE 拍）：把这一课停下来，不留一个"还想再问"的钩子
const CLOSE_LINES = [
  '就到这儿吧——你说的这些，我得回去慢慢理一理。',
  '我这边记满了。你还有什么想补的，随时接着说。',
  '先生，今天就问到这儿。你刚才那句我还没完全想透，下次接着来。',
];

// 截一句值得被映照的"人话"：太长的段落映照起来像摘要，不是镜子
function pickQuote(utterance, maxLen = 24) {
  if (!String(utterance || '').trim()) return '';
  const t = String(utterance).replace(/\s+/g, ' ').trim();
  // 按句号/问号/叹号切，取最后一句（人说话的重心常在末尾那句）
  const parts = t.split(/[。！？.!?]+/).map((s) => s.trim()).filter(Boolean);
  const last = parts[parts.length - 1] || t;
  const body = (parts.length > 1 && last.length <= 12) ? last : (parts[0] || t);
  const q = body.length > maxLen ? body.slice(0, maxLen) : body;
  return q.replace(/[「」]/g, '').trim();
}

// 生成一句映照（纯函数、确定性：同一 (utterance, beat, seed) 永远同一句）
function reflectLine({ utterance = '', beat = BEAT.ECHO, seed = 0 } = {}) {
  const q = pickQuote(utterance);
  if (!q) return { say: '', quoted: '' };
  // 留白档恒为"接住不问"：不信 seed，强行取 q:false 的模板
  const pool = beat === BEAT.PAUSE
    ? REFLECT_TEMPLATES.filter((t) => !t.q)
    : REFLECT_TEMPLATES;
  const s = Math.abs(Math.floor(Number(seed) || 0));
  const tpl = pool[s % pool.length] || pool[0];
  return { say: tpl.text(q), quoted: q, asks: !!tpl.q, beat };
}

// 收束句（确定性）
function closeLine(seed = 0) {
  const s = Math.abs(Math.floor(Number(seed) || 0));
  return CLOSE_LINES[s % CLOSE_LINES.length];
}

// ---- 问句的「多副面孔」：去模板化 -------------------------------------
// 旧实现：PROBE_FRAME 每类只有 3 句模板，LLM 一挂就是"「X」到什么份上就不算数了？"，
//        人立刻听出这是同一套话术。这里给每枚问句加上可换的开口与收尾，
//        让同一逻辑问句有 ≥6 种说法，且换法由确定性哈希决定（可复现、可单测）。
const OPENINGS = ['', '', '', '我换个问法——', '我打个比方问——', '我这么问行不行：'];
const CLOSERS = ['', '', '', '（我这么理解着问的，先生别笑话）', '——我怕我没问到位。'];

function stableHash(s) {
  let h = 0;
  for (let i = 0; i < String(s).length; i++) h = (h * 31 + String(s).charCodeAt(i)) | 0;
  return Math.abs(h);
}

// 给一句问句换上开口/收尾（不改问句本意，只换说法）
function varyPhrase(text, seed = 0) {
  const s = Math.abs(Math.floor(Number(seed) || 0));
  const o = OPENINGS[s % OPENINGS.length];
  const c = CLOSERS[(s >> 2) % CLOSERS.length];
  const base = String(text || '').trim();
  if (!base) return base;
  // 已有开口（开头是标点类）就不叠加，避免"我换个问法——那我试试这么问——"
  const hasOpen = /^(我|换个|打个|这么)/.test(base);
  return (hasOpen ? base : (o + base)) + (c && !/[，。？！]$/.test(base) ? c : '');
}

// ---- 体验层的自检口径（给测试与日志用）--------------------------------
//   机器只报"这一拍在干什么"，绝不报"人表现如何"——这是体验与考核的分界线。
function beatRationale(beat) {
  const M = {
    [BEAT.DEEPEN]: '这一拍抛一枚真探测：逼先生把一个具体的缺口讲透。',
    [BEAT.ECHO]:   '这一拍只照一句、不问下一个：让人感到自己刚说的话被接住了。',
    [BEAT.PAUSE]:  '这一拍镜子闭嘴：把话头交回给先生，不给追问。',
    [BEAT.CLOSE]:  '这一拍收课：不再追问，只留一句收尾。',
  };
  return M[beat] || M[BEAT.DEEPEN];
}

// 本模块自带的"不评分"自检词表：映照句/收束句里出现这些词即视为违约
const SCORING_WORDS = /讲得好|讲得很好|不错|很好|棒|厉害|答对|答错|掌握|理解[了得]?|进步|提升|失败|错了吗|你错了|正确|优秀|差了/;

module.exports = {
  BEAT, BEAT_TEXT, planBeats, beatFor, beatIsAsking, beatRationale,
  reflectLine, closeLine, varyPhrase, pickQuote, stableHash, SCORING_WORDS,
};
