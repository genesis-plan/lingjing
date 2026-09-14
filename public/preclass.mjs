// 灵境 · 课前「生产性失败」引擎（preclass.mjs）
// --------------------------------------------------------------------------
// 为什么要有这一层：灵境现在的流程是「你讲 → 学生问 → 课后总结」。
// 缺的是**你讲之前**那一段。而这一段恰恰是实证收益最大的：
//
//   Kapur 的 productive failure（先解题、后讲解，PS-I）：
//     · Kapur 2014：先挣扎组在后测上显著胜出，d = 2.25
//     · ETH Zurich 线性代数（650 人，一年期）：提前做失败任务的学生通过率高 20%
//     · ALTER-Math（5 万+ 中学生）：学习增益 1.56×
//   四个机制（4A）：Activate 激活先验 → Awareness 意识到缺口 → Affect 更想听讲解 → Assembly 与讲解对接
//
//   而且有硬条件，缺一个就白做：
//     ① 问题必须**真的超出当前能力**（否则不是探索，是复习）
//     ② 必须有**至少两次真实尝试**（Kapur：consolidation 只在两次尝试之后）
//     ③ 必须**有足够先验**——否则不是生产性失败，是干瞪眼（Kapur：PF requires prior knowledge）
//     ④ 讲解必须**接在自己的尝试上**（失败而不对接 = 就是失败，没有收益）
//
// 本模块用到的数学（全是可计算量，不是名词摆设）：
//   集合论/覆盖   —— 先验激活度 = 尝试命中的概念集对讲解概念集的**覆盖率**
//   组合/相似度   —— 尝试多样性 = 两次尝试词项集的 **Jaccard 距离**（换没换角度）
//   信息论        —— 缺口熵 H = −Σ p log p，再归一化；缺口越集中 ⇒ 越清楚自己缺什么
//   概率/贝叶斯   —— 每个概念命中的软概率（用词项重合度做似然），而非 0/1 命中
//   逻辑/因果     —— 真实尝试的判据：是否出现因果/反事实/假设连接词（"因为/如果/假设/应该是"）
//
// 诚实标注：全部确定性可计算；无 LLM 也能跑。它**不给学习结果打分**，只回答一个问题：
//   「现在放行讲解，是不是在浪费这次失败？」——答案不足时，明确说不足，而不是硬放行。
//
// 无 DOM、无网络、无依赖，可 Node 直接验。

export function clamp01(x) { return Math.max(0, Math.min(1, x)); }

// 去掉包装符号、压平空白
function plain(c) {
  return String(c == null ? '' : c).replace(/[「」“”''《》【】]/g, '').replace(/\s+/g, ' ').trim();
}
function short(c, n = 14) {
  const t = plain(c);
  return t.length > n ? t.slice(0, n) + '…' : (t || '概念');
}

// 词项切分：中文按 2-gram + 显式分隔符拆，够用且不引分词库
export function terms(text) {
  const t = plain(text).replace(/[，,。.！!？?；;：:、（）()\[\]]/g, ' ');
  const out = new Set();
  for (const seg of t.split(/\s+/)) {
    if (!seg) continue;
    // ⚠️ 不把长整段塞进集合：整段几乎永不命中，只会把集合撑大、把命中率稀释成假阴性。
    if (seg.length >= 2 && seg.length <= 6) out.add(seg);
    for (let i = 0; i + 2 <= seg.length; i++) out.add(seg.slice(i, i + 2));
  }
  return out;
}

// 概念的关键词（与 summary.mjs 同源思路：长概念切成 2 字以上的片段）
function keywordsOf(c) {
  const raw = plain(c);
  const parts = raw.split(/[\s,，、；;。]+/).map((w) => w.trim()).filter((w) => w.length >= 2);
  return parts.length ? parts : [raw.slice(0, 6)];
}

// ===== 一、生成"超出能力但可直觉入手"的探针问题 =====
// 依据 Kapur：问题要 "grasped intuitively but lacking the knowledge to solve"。
// 四类探针（不引 LLM 也能生成，全部基于概念文本重组）：
//   counterfactual 反事实 —— 把因果反过来还成立吗（制造认知失调，为后续"顿悟"埋点）
//   boundary       边界   —— 推到极端（最大/最小/零/无穷）会怎样
//   mechanism      机制   —— 中间那一步到底是什么（讲解里往往一带而过）
//   transfer       迁移   —— 换一个完全不同的领域，还成立吗
const PROBE_FORMS = [
  { kind: 'counterfactual', ask: (c) => `如果「${c}」这件事**反过来**——它不存在、或者发生顺序颠倒——结果还会一样吗？为什么？` },
  { kind: 'boundary',       ask: (c) => `把「${c}」推到极端（完全没有 / 无限多 / 卡在临界点上），会发生什么？` },
  { kind: 'mechanism',      ask: (c) => `「${c}」发生的**中间那一步**到底是什么？从 A 到 B 之间，具体是什么在起作用？` },
  { kind: 'transfer',       ask: (c) => `你能举一个**跟这个领域完全不搭边**的例子，说明「${c}」吗？` },
];

/**
 * 造课前预测试。
 * @param {string} topic 课题
 * @param {string} lessonText 讲解正文
 * @param {string[]} concepts 知识点（≤5）
 * @param {object} [opts] { maxProbes=3, seed=0 }
 * @returns {{topic, minAttempts, probes:[{id,kind,concept,ask,why}], rules:string[], note:string}}
 */
export function buildPreTest(topic, lessonText, concepts, opts = {}) {
  const maxProbes = Math.max(1, Math.min(opts.maxProbes || 3, 4));
  const cs = (Array.isArray(concepts) ? concepts : []).map(plain).filter(Boolean);
  const base = cs.length ? cs : [plain(topic) || '这个课题'];

  // 选"最值得失败的"概念：优先讲解里说得最多、但结构上最难直觉得到的
  const scored = base.map((c, i) => {
    const kw = keywordsOf(c);
    const sents = String(lessonText || '').split(/[。！？；\n]+/);
    const mention = sents.filter((s) => kw.some((k) => s.includes(k))).length;
    // 难度信号：概念越长、抽象词越多（为什么/关系/过程/机制）越难
    const abstract = /为什么|关系|过程|机制|本质|原理|作用|影响/.test(c) ? 1 : 0;
    return { c, i, score: mention * 1 + abstract * 0.8 + c.length * 0.02 };
  }).sort((a, b) => b.score - a.score);

  const probes = [];
  for (let k = 0; k < maxProbes; k++) {
    const pick = scored[k % scored.length];
    const form = PROBE_FORMS[(k + (opts.seed || 0)) % PROBE_FORMS.length];
    probes.push({
      id: 'p' + (k + 1),
      kind: form.kind,
      concept: pick.c,
      ask: form.ask(short(pick.c, 16)),
      why: ({
        counterfactual: '把因果反过来问，你会立刻发现自己说不清哪个是因、哪个是果。',
        boundary: '推到极端的题，靠背诵答不出来，只能靠真正的理解。',
        mechanism: '讲解常常跳过"中间那一步"，而这步才是理解的关节。',
        transfer: '换个领域还说得通，才算真的拿到手；只能原样复述＝还没拿到。',
      })[form.kind],
    });
  }

  return {
    topic: plain(topic) || '一课',
    minAttempts: 2,
    probes,
    rules: [
      '这些问题你现在**答不全很正常**——这就是设计目的，不是测验，也不打分。',
      '请至少给出**两次不同角度的尝试**，哪怕都不对、都不完整。',
      '想不出来时，先说"我确定的部分是……"，再从那里往外推。',
      '你的两次尝试会在下课后被拿出来对照讲解——所以尽量写得具体一点。',
    ],
    note: '依据 productive failure（Kapur）：先挣扎、后讲解，理解更深。前提是"挣扎过 + 讲解接得上"，两者缺一不可。',
  };
}

// ===== 二、评估探索质量（决定能不能放行讲解）=====
const REASON_WORDS = /因为|所以|如果|假设|应该是|我猜|可能|由于|导致|意味|也就是|换句话说|反过来|比如|举个例子|第一步|然后|接着|最后|先|再/;
const GIVEUP = /^(不知道|不会|没学过|不懂|不清楚|想不到|没有想法|跳过|skip|idk)[。.!！~～\s]*$/i;

function isGenuine(text) {
  const t = plain(text);
  if (t.length < 8) return false;
  if (GIVEUP.test(t)) return false;
  // 至少要有推理痕迹：连接词，或者够长的一段自述
  return REASON_WORDS.test(t) || t.length >= 24;
}

// 软命中：概念与该尝试的相关度 ∈ [0,1]
// ⚠️ 只用 keywordsOf 会失效——概念若是无分隔符的长中文串，keywordsOf 返回整段，
//    尝试里几乎不可能原样出现，命中率恒为 0（假阴性）。所以以 **2-gram 覆盖率**为主。
function softHit(concept, attemptTerms, attemptText) {
  const ct = terms(concept);
  const kws = keywordsOf(concept);
  const hitKw = kws.length
    ? kws.filter((k) => k.length >= 2 && attemptText.includes(k)).length / kws.length
    : 0;
  if (!ct.size) return clamp01(hitKw);
  let inter = 0;
  for (const x of ct) if (attemptTerms.has(x)) inter++;
  const cov = inter / ct.size;
  return clamp01(0.7 * cov + 0.3 * hitKw);
}

function jaccardDistance(a, b) {
  if (!a.size && !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union ? 1 - inter / union : 0;
}

/**
 * 评估课前探索。**这是放行讲解的闸门**，不是打分器。
 * @param {string} topic
 * @param {string[]} concepts
 * @param {Array<{text:string, at?:number}>} attempts 按时间顺序
 * @param {object} [opts] { minAttempts=2, lessonText='' }
 */
export function evaluateExploration(topic, concepts, attempts, opts = {}) {
  const cs = (Array.isArray(concepts) ? concepts : []).map(plain).filter(Boolean);
  const list = (Array.isArray(attempts) ? attempts : []).map((a) => ({
    text: plain(a && a.text), at: (a && a.at) || null,
  })).filter((a) => a.text);

  const genuine = list.filter((a) => isGenuine(a.text));
  const attemptCount = list.length;
  const genuineCount = genuine.length;

  // 先验激活度
  // ⚠️ 只看"逐字命中概念"会把换了个说法的真实思考误判成"毫无先验"（假阴性）。
  //    所以以**与讲解的语汇相关度**为主，概念覆盖作为深度信号。
  const TOUCH = 0.2;   // 概念算"碰到了"的门槛
  const cover = cs.map(() => 0);
  const perAttemptTerms = genuine.map((a) => terms(a.text));
  genuine.forEach((a, k) => {
    cs.forEach((c, j) => { cover[j] = Math.max(cover[j], softHit(c, perAttemptTerms[k], a.text)); });
  });
  const coverage = cs.length ? cover.reduce((s, v) => s + v, 0) / cs.length : 0;
  const lessonTerms = terms(opts.lessonText || '');
  const rel = perAttemptTerms.map((at) => {
    if (!at.size || !lessonTerms.size) return 0;
    let inter = 0;
    for (const x of at) if (lessonTerms.has(x)) inter++;
    return inter / at.size;
  });
  const topicRelevance = rel.length ? rel.reduce((s, v) => s + v, 0) / rel.length : 0;
  const touched = cover.filter((v) => v >= TOUCH).length;
  const activation = clamp01(0.5 * topicRelevance + 0.3 * coverage + 0.2 * (cs.length ? touched / cs.length : 0));

  // 尝试多样性：两两 Jaccard 距离的最大值与均值
  const pairs = [];
  for (let a = 0; a < perAttemptTerms.length; a++)
    for (let b = a + 1; b < perAttemptTerms.length; b++)
      pairs.push(jaccardDistance(perAttemptTerms[a], perAttemptTerms[b]));
  const diversity = pairs.length ? pairs.reduce((s, v) => s + v, 0) / pairs.length : 0;
  const maxDiversity = pairs.length ? Math.max(...pairs) : 0;

  // 概念权重：该概念在讲解中被提及的句数（提及越多 ⇒ 越是重点）
  const sents = String(opts.lessonText || '').split(/[。！？；\n]+/);
  const weight = cs.map((c) => {
    const kws = keywordsOf(c);
    return 1 + sents.filter((s) => kws.some((k) => s.includes(k))).length;
  });
  const missIdx = cover.map((v, j) => (v < TOUCH ? j : -1)).filter((j) => j >= 0);

  // 缺口意识（awareness）：**你的注意力分布，与讲解的重点分布，对齐得怎么样**
  //   KL(P_你的命中 ‖ P_讲解权重)：对齐越好（KL→0），awareness→1
  //   ⚠️ 曾经用"缺失概念的权重熵"，实测恒等于 0（缺失概念的权重往往相近 ⇒ 熵恒接近上界）——
  //      这种"看着很数学、实则不动"的量就是摆设，必须换掉。
  const wsum = weight.reduce((a, b) => a + b, 0) || 1;
  const csum = cover.reduce((a, b) => a + b, 0);
  let klAttn = 0;
  if (csum > 0) {
    for (let j = 0; j < cs.length; j++) {
      const p = cover[j] / csum;
      const q = weight[j] / wsum;
      if (p > 0 && q > 0) klAttn += p * Math.log(p / q);
    }
  }
  const gapAwareness = csum > 0 ? clamp01(Math.exp(-klAttn)) : 0;
  const missingConcepts = missIdx.map((j) => cs[j]);

  // ===== 判定（放行闸门）=====
  const minAttempts = Math.max(2, opts.minAttempts || 2);
  let verdict, advice;
  if (attemptCount === 0) {
    verdict = 'no-attempt';
    advice = '先试着答一答。答不出来是预期的——但空着就什么也激活不了。';
  } else if (genuineCount === 0) {
    verdict = 'not-genuine';
    advice = '这几句还不算"尝试"。不用答对，把你**确定的那部分**先写下来，再从那里往外推。';
  } else if (genuineCount < minAttempts) {
    verdict = 'one-attempt';
    advice = `再来一次，**换个完全不同的角度**。不是把上一条改写，是换一条路走。`;
  } else if (activation < 0.15) {
    // ⚠️ 诚实判断：没有先验就不是生产性失败
    verdict = 'no-prior';
    advice = '你对这个课题的先验太少，现在硬答会变成"干瞪眼"而不是生产性失败（Kapur 的前提是有足够先验）。建议先补一点背景再回来。';
  } else if (diversity < 0.2) {
    // ⚠️ 阈值取得**偏松**（0.2 而不是 0.5）：中文 2-gram 的 Jaccard 距离天然偏高，
    //    阈值一严就会把"换了说法但确实是新角度"的尝试误判成雷同 —— 误杀比漏放更伤人。
    //    这里只拦"两次几乎是同一段话"（复制粘贴式假探索）。
    verdict = 'shallow';
    advice = '两次尝试基本是同一个角度。真探索的标志是**两次走的是不同的路**——换一种思路再试一次。';
  } else {
    verdict = 'ready';
    advice = '两次不同角度的尝试已经到位。现在去讲吧——你的尝试会在课后总结里被拿出来跟讲解对照。';
  }

  return {
    topic: plain(topic) || '一课',
    verdict,
    ready: verdict === 'ready',
    advice,
    attemptCount, genuineCount, minAttempts,
    activation: round(activation),
    coverage: round(coverage),
    touchedConcepts: touched,
    diversity: round(diversity),
    maxDiversity: round(maxDiversity),
    gapAwareness: round(gapAwareness),
    klAttention: round(klAttn),   // KL(你的注意力 ‖ 讲解重点)；越小＝越抓在点上
    coveredConcepts: cs.filter((_, j) => cover[j] >= TOUCH),
    missingConcepts,
    conceptCover: cs.map((c, j) => ({ concept: c, hit: round(cover[j]), weight: weight[j] })),
    fourA: {
      activate: round(activation),
      awareness: round(gapAwareness),
      affect: verdict === 'ready' ? 1 : (genuineCount >= 1 ? 0.5 : 0),
      assembly: 0, // 由课后总结填：讲解有没有接住这两次尝试
    },
  };
}

function round(x, n = 3) { const p = Math.pow(10, n); return Math.round(x * p) / p; }

// ===== 三、给课后总结的"对接触"：consolidation 必须建立在你自己的尝试上 =====
/**
 * 把探索记录整理成课后"接得住"的对照素材（Kapur：failure without consolidation is just failure）。
 * @param {object} pre  buildPreTest 的产物
 * @param {object} ev   评估结果（evaluateExploration）
 * @param {Array<{text:string}>} attempts
 */
export function consolidationNotes(pre, ev, attempts) {
  const list = (Array.isArray(attempts) ? attempts : []).map((a) => plain(a && a.text)).filter(Boolean);
  const out = [];
  list.forEach((t, i) => {
    out.push({
      index: i + 1,
      gist: t.length > 46 ? t.slice(0, 46) + '…' : t,
      full: t,
      // 这条尝试碰到过哪些概念（供课后对照"你当时已经摸到边了"）
      touched: (ev && ev.conceptCover || []).filter((c) => c.hit >= 0.2).slice(0, 3).map((c) => c.concept),
    });
  });
  return {
    attempts: out,
    missing: (ev && ev.missingConcepts) || [],
    probes: (pre && pre.probes) || [],
    instruction: '下课时，把这几次尝试与讲解逐条对照：哪一条方向是对的、卡在哪一步、讲解里的哪个概念刚好补上了那个缺口。',
    honest: '对照只用于回顾，不构成对错评判。',
  };
}

// ===== 四、Markdown 输出（课前 / 课后两用）=====
export function preTestToMarkdown(pre) {
  const L = [];
  L.push('# 课前：先自己试试 —— 《' + pre.topic + '》');
  L.push('');
  L.push('> ' + pre.note);
  L.push('');
  pre.probes.forEach((p, i) => {
    L.push('**' + (i + 1) + '. ' + p.ask + '**');
    L.push('　 ↳ ' + p.why);
    L.push('');
  });
  L.push('规则：');
  pre.rules.forEach((r) => L.push('- ' + r));
  return L.join('\n');
}

export function explorationToMarkdown(ev) {
  const L = [];
  L.push('# 课前探索评估');
  L.push('');
  L.push('| 量 | 值 | 它是什么意思 |');
  L.push('|---|---|---|');
  L.push(`| 真实尝试次数 | ${ev.genuineCount} / ${ev.minAttempts} | 少于 ${ev.minAttempts} 次就不进入讲解（Kapur 的设计条件） |`);
  L.push(`| 先验激活度 | ${ev.activation} | 你已经调动起来的相关知识有多少 |`);
  L.push(`| 尝试多样性 | ${ev.diversity} | 两次尝试是不是走了**不同**的路（Jaccard 距离） |`);
  L.push(`| 缺口意识 | ${ev.gapAwareness} | 你的注意力有没有落在讲解的重点上（KL 对齐度，越接近 1 越抓在点上） |`);
  L.push('');
  L.push('**判定：' + ev.verdict + '** —— ' + ev.advice);
  if (ev.missingConcepts.length) {
    L.push('');
    L.push('还没碰到的概念：' + ev.missingConcepts.map((c) => '「' + short(c) + '」').join('、'));
  }
  return L.join('\n');
}
