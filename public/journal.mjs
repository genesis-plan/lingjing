// 灵境 · 跨课个人知识库（journal.mjs）
// --------------------------------------------------------------------------
// 为什么要有这一层：现在灵境每上一课就产出一组技能卡片，但**上完课就散了**——
// 下次来是全新的，前面讲的没有复利。学习科学里"复利"来自两件事：
//   ① 间隔重复（Ebbinghaus 遗忘曲线 + 主动回想）——但**排课方式**决定效率高低
//   ② 交错练习（interleaving，Dunlosky 2014：混着复习显著优于块状）
//
// 所以本模块把「一次性卡片」升级成「个人知识库」：每张卡有自己的记忆参数，
// 跨课累积，按**预测回忆概率**决定什么时候该复习谁。
//
// 排课用的是 FSRS 的 DSR 记忆模型（Jarrett Ye et al. 2022；Anki 23.10 起默认）：
//   Difficulty    D ∈ [1,10]      这张卡对你有多难
//   Stability     S（天）          回忆概率衰减到目标值所需的时间
//   Retrievability R(t) ∈ (0,1]   今天你能想起来它的概率
//
//   R(t, S) = (1 + F · t / S) ^ DECAY         F = 19/81，DECAY = −0.5（FSRS 公开形式）
//   反解"目标留存 r 时该复习" → t = S / F · (r^(1/DECAY) − 1)
//
//   ⚠️ 为什么不用现有的固定序列 [1,2,4,7,15,30,60]：
//      固定序列对每张卡一视同仁，难的嫌少、易的嫌多；FSRS 在 5 亿条真实复习记录上
//      比固定乘数少 20-30% 复习量而保持同等留存。既然要"加数学"，就用真的那个。
//
// 本模块还用到的其他数学：
//   概率/贝叶斯 —— 复习评分 → 后验难度与稳定度更新
//   信息论      —— 概念的"信息量"（越难越不确定，初始稳定度越低）
//   组合/排序   —— 交错队列（按主题轮转，而不是把同一主题堆在一起）
//   序关系      —— 队列按 R 升序 = "最快会忘的排最前"（最早截止优先的贪心）
//   统计        —— 记忆资产 = Σ S（天），成长叙事的可量化底料
//
// ⚠️ 2026-09-11：本模块曾经拿"AI 学生在这个要点上被接住的比例"当初始稳定度
//   （字段名叫 masteryHistory）。那是个两重假的数：分子靠 2-gram 自动判定（标定证明是噪声），
//   分母是我们自己按轮次轮转分配的探测数——拿它排你的复习表，等于拿随机数排你的复习表。
//   现在：初始稳定度**只由概念难度**给，真实水平交给**你自己复习时的评分**去修正。
//
// 诚实标注：参数是**公开模型的简化实现**，不是 FSRS 的 17 参数拟合版（那需要上千次
//   复习记录才能拟合个人参数）。这里只做"可解释、可预期、跨课累积"的骨架，
//   不宣称达到 FSRS 基准效率。无 DOM、无网络、无依赖，可 Node 直接验。

export function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }
function round(x, n = 4) { const p = Math.pow(10, n); return Math.round(x * p) / p; }
function plain(c) { return String(c == null ? '' : c).replace(/[「」“”''《》【】]/g, '').replace(/\s+/g, ' ').trim(); }
function short(c, n = 14) { const t = plain(c); return t.length > n ? t.slice(0, n) + '…' : (t || '概念'); }
const DAY = 86400000;

// FSRS 公开常量
export const FSRS_FACTOR = 19 / 81;   // ≈ 0.2346
export const FSRS_DECAY = -0.5;
export const TARGET_RETENTION = 0.9;  // 默认目标：回忆概率掉到 90% 前复习

// ===== 一、DSR 三个函数 =====
/** 今天还能想起来的概率。t 天未复习、稳定度 S。 */
export function retrievability(tDays, S) {
  if (!(S > 0)) return 0;
  const t = Math.max(0, tDays);
  return clamp(Math.pow(1 + FSRS_FACTOR * t / S, FSRS_DECAY), 0, 1);
}

/** 稳定度 S 下，等多久复习能把回忆概率压到 targetR。 */
export function nextIntervalDays(S, targetR = TARGET_RETENTION) {
  if (!(S > 0)) return 1;
  const r = clamp(targetR, 0.5, 0.99);
  const t = (S / FSRS_FACTOR) * (Math.pow(r, 1 / FSRS_DECAY) - 1);
  return clamp(t, 0.5, 365 * 5);
}

/**
 * 新课的初始稳定度：**只由概念难度决定**。
 * ⚠️ 2026-09-11：这个函数原来收 `(mastery, difficulty)`，mastery 来自"AI 学生在这个要点上
 *   被接住的比例"——那是个两重假的数（分子靠 2-gram 噪声判定，分母是我们自己轮转分配的探测数）。
 *   用它给"你多久会忘"定初值，等于拿随机数排你的复习表。**已删。**
 *   我们不知道你掌握没掌握，所以初值老老实实只由难度给；真实水平交给**你自己复习时的评分**
 *   去修正（见 reviewCard）。初值偏低没关系——评分链会在几次复习内把它拉到正确位置。
 */
export function initialStability(difficulty) {
  const d = clamp(Number(difficulty) || 5, 1, 10);       // difficulty ∈ [1,10]，越大越难
  const base = 3;                                        // 天
  return clamp(base * ((11 - d) / 10), 0.2, 120);
}

// 评分：0=忘了 1=吃力 2=想起来了 3=轻松 → 映射到 SM-2 的 0..5 质量分
const RATING_Q = { 0: 2, 1: 3, 2: 4, 3: 5 };
export const RATINGS = [
  { v: 0, label: '忘了' },
  { v: 1, label: '吃力' },
  { v: 2, label: '想起来了' },
  { v: 3, label: '轻松' },
];

/**
 * 一次复习后更新卡片（DSR 后验更新）。
 * 稳定度增长用 SM-2 的易度因子做骨架（透明、可手算），难度按评分微调。
 */
export function reviewCard(card, rating, now = Date.now()) {
  const q = RATING_Q[clamp(Math.round(rating), 0, 3)];
  let D = clamp(Number(card.D) || 5, 1, 10);
  let S = Number(card.S) > 0 ? Number(card.S) : initialStability(D);
  const t = card.lastAt ? Math.max(0, (now - card.lastAt) / DAY) : 0;
  const R = retrievability(t, S);

  if (q < 3) {
    // 忘了：稳定度大幅回落，难度上升（这正是"这张卡对你难"的证据）
    S = Math.max(0.2, S * 0.35);
    D = clamp(D + 1.2, 1, 10);
  } else {
    // 易度因子按 SM-2 更新（q=3→降，4→平，5→升），下限 1.3
    let EF = clamp(Number(card.EF) || 2.5, 1.3, 3.5);
    EF = EF + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
    EF = clamp(EF, 1.3, 3.5);
    // 回忆得越轻松（R 越低却答对＝记忆比预期强）增长越多
    const bonus = 1 + 0.35 * (1 - R);
    S = clamp(S * EF * bonus, 0.2, 365 * 5);
    D = clamp(D - 0.25, 1, 10);
    card.EF = round(EF, 3);
  }

  card.D = round(D, 2);
  card.S = round(S, 3);
  card.reps = (Number(card.reps) || 0) + 1;
  card.lapses = (Number(card.lapses) || 0) + (q < 3 ? 1 : 0);
  card.lastAt = now;
  card.lastR = round(R, 3);
  card.dueAt = now + nextIntervalDays(S) * DAY;
  card.lastRating = clamp(Math.round(rating), 0, 3);
  // 评分历史：这是**人类自己给的**分（0 忘了 ~ 3 轻松），归一化到 [0,1] 存档。
  // ⚠️ 它以前叫 masteryHistory，装的是"AI 学生被接住的比例"——假数据。现在装的是你自己的复习自评。
  card.gradeHistory = (card.gradeHistory || [])
    .concat([round(clamp(card.lastRating / 3, 0, 1), 3)]).slice(-12);
  return card;
}

/** 到期状态：已到期 / 今天 / 未来。 */
export function dueState(card, now = Date.now()) {
  const t = card.lastAt ? (now - card.lastAt) / DAY : 0;
  const R = retrievability(t, card.S);
  const due = card.dueAt != null ? card.dueAt <= now : true;
  return { R: round(R, 3), daysSince: round(t, 2), overdue: due && t > 0, R_now: R };
}

// ===== 二、跨课累积 =====
/** 新库。 */
export function newJournal(owner = '你') {
  return { version: 1, owner, createdAt: Date.now(), updatedAt: Date.now(), topics: [], cards: [] };
}

/** 概念归一化 key（跨课去重靠它）。 */
function keyOf(concept) { return plain(concept).slice(0, 24); }

/**
 * 把一课的产出并进个人知识库。
 * @param {object} journal
 * @param {object} rec {topic, at, summary, deck, exploration}
 * @param {object} [opts] { targetRetention }
 */
export function upsertJournal(journal, rec, opts = {}) {
  const j = journal && journal.cards ? journal : newJournal();
  const now = (rec && rec.at) || Date.now();
  const topic = plain(rec && rec.topic) || '未命名一课';
  const deck = (rec && rec.deck) || {};
  const cards = Array.isArray(deck.cards) ? deck.cards : [];

  j.topics = j.topics || [];
  if (!j.topics.some((t) => t.topic === topic)) {
    j.topics.push({
      topic, firstAt: now, sessions: 0,
      senses: (rec && rec.summary && rec.summary.senses) || null,
    });
  }
  const topicRec = j.topics.find((t) => t.topic === topic);
  topicRec.sessions += 1;
  topicRec.lastAt = now;
  if (rec && rec.summary && rec.summary.senses) topicRec.senses = rec.summary.senses;

  let added = 0, refreshed = 0;
  for (const c of cards) {
    const key = keyOf(c.concept);
    if (!key) continue;
    let card = j.cards.find((x) => x.key === key);
    const diff = clamp(Number(c.difficulty) || 5, 1, 10);
    if (!card) {
      // 新课：初始稳定度**只由难度给**（我们不知道你掌握没掌握，不许编）；到期时间用 DSR 反解。
      const S = initialStability(diff);
      card = {
        key, concept: plain(c.concept),
        D: round(diff, 2), S: round(S, 3), EF: 2.5,
        reps: 0, lapses: 0,
        firstAt: now, lastAt: now, lastR: 1,
        dueAt: now + nextIntervalDays(S, opts.targetRetention || TARGET_RETENTION) * DAY,
        gradeHistory: [],            // 空白等你来填：只有你自己复习时给的分才写进来
        back: c.back || '', front: c.front || '',
        firstTopic: topic,
      };
      j.cards.push(card);
      added++;
    } else {
      // 旧概念又讲了一遍：本身等于一次"回忆成功"（你又能把它讲出来了），稳定度小幅上调。
      card.D = round(clamp(card.D * 0.85 + diff * 0.15, 1, 10), 2);
      card.S = round(clamp(Number(card.S) * 1.25, 0.2, 365 * 5), 3);
      card.reps = (Number(card.reps) || 0) + 1;
      card.lastAt = now;
      card.dueAt = now + nextIntervalDays(card.S, opts.targetRetention || TARGET_RETENTION) * DAY;
      card.topics = [...new Set([].concat(card.topics || [card.firstTopic], topic))];
      if (c.back) card.back = c.back;
      if (c.front) card.front = c.front;
      refreshed++;
    }
  }
  j.updatedAt = now;
  return { journal: j, added, refreshed, total: j.cards.length };
}

// ===== 三、交错复习队列 =====
/**
 * 今天该复习什么。两个原则：
 *   ① 按 R 升序（最快会忘的排最前）—— 贪心，最早截止优先
 *   ② **交错**：同一主题的卡不连续堆在一起（Dunlosky 2014：混着复习长期效果更好）
 */
export function reviewQueue(journal, now = Date.now(), opts = {}) {
  const budget = Math.max(1, opts.budget || 12);
  const cards = ((journal && journal.cards) || []).slice();
  if (!cards.length) return { due: [], upcoming: [], stats: {}, interleaved: [] };

  const enriched = cards.map((c) => {
    const st = dueState(c, now);
    return { key: c.key, concept: c.concept, topic: c.firstTopic || '一课', ...st, S: c.S, D: c.D, dueAt: c.dueAt, overdueDays: Math.max(0, (now - (c.dueAt || now)) / DAY) };
  });
  const due = enriched.filter((c) => c.overdue || (c.dueAt != null && c.dueAt <= now));
  const upcoming = enriched.filter((c) => !due.includes(c)).sort((a, b) => a.dueAt - b.dueAt);
  due.sort((a, b) => a.R - b.R);   // 最快忘的在前

  // 交错：对 due 序列按主题做"轮转重排"，避免同主题连排
  const buckets = new Map();
  for (const c of due) {
    if (!buckets.has(c.topic)) buckets.set(c.topic, []);
    buckets.get(c.topic).push(c);
  }
  const order = [...buckets.keys()];
  const interleaved = [];
  let guard = 0;
  while (interleaved.length < due.length && guard++ < 9999) {
    let pushed = false;
    for (const t of order) {
      const b = buckets.get(t);
      if (b.length) { interleaved.push(b.shift()); pushed = true; }
    }
    if (!pushed) break;
  }

  const meanR = due.length ? due.reduce((s, c) => s + c.R, 0) / due.length : null;
  return {
    due,
    upcoming: upcoming.slice(0, 10),
    interleaved: interleaved.slice(0, budget),
    stats: {
      totalCards: cards.length,
      dueCount: due.length,
      meanRetrievability: meanR == null ? null : round(meanR, 3),
      topicsCount: order.length,
      memoryAssetDays: round(cards.reduce((s, c) => s + (Number(c.S) || 0), 0), 1),
      reviewsTotal: cards.reduce((s, c) => s + (Number(c.reps) || 0), 0),
      lapsesTotal: cards.reduce((s, c) => s + (Number(c.lapses) || 0), 0),
    },
  };
}

// ===== 四、成长叙事 =====
/**
 * 一句话说明"你积累了什么"。**用事实，不用鼓励话术**（不做"你真棒"式夸奖，
 * 也不做"再不回来就白学了"式恐吓——后者是暗黑模式）。
 */
export function growthLine(journal, now = Date.now()) {
  const j = journal && journal.cards ? journal : newJournal();
  const n = j.cards.length;
  if (!n) return { text: '还没有积累——上完第一课，这里就会开始长东西。', metrics: { cards: 0 } };
  const q = reviewQueue(j, now);
  const days = j.createdAt ? Math.max(1, Math.round((now - j.createdAt) / DAY)) : 1;
  const topics = (j.topics || []).length;
  // "已经稳的卡"＝你自己复习时给过 2（想起来了）或 3（轻松）的卡。
  // ⚠️ 以前这里读的是 masteryHistory 的最后一个数——那是"AI 学生被接住的比例"，假数据。已换成你自己的评分。
  const master = j.cards.filter((c) => Number(c.lastRating) >= 2).length;
  const asset = q.stats.memoryAssetDays;
  const text = `你已经把 ${n} 个概念讲到了别人能听懂，分布在 ${topics} 个课题里；` +
    `按遗忘曲线算，这些记忆值 ${asset} 天。今天有 ${q.stats.dueCount} 张卡到了该复习的时候。`;
  return {
    text,
    metrics: {
      cards: n, topics, days, strong: master,
      memoryAssetDays: asset,
      dueToday: q.stats.dueCount,
      reviewsTotal: q.stats.reviewsTotal,
      lapsesTotal: q.stats.lapsesTotal,
    },
  };
}

// ===== 五、Markdown 输出 =====
export function journalToMarkdown(journal, now = Date.now()) {
  const j = journal && journal.cards ? journal : newJournal();
  const L = [];
  L.push('# 我的知识库');
  L.push('');
  const g = growthLine(j, now);
  L.push('> ' + g.text);
  L.push('');
  const q = reviewQueue(j, now);
  if (q.interleaved.length) {
    L.push('## 今天该复习的（按"最快会忘"排序）');
    L.push('');
    L.push('| # | 概念 | 课题 | 现在还记得的概率 | 稳定度(天) |');
    L.push('|---|---|---|---|---|');
    q.interleaved.forEach((c, i) => {
      L.push(`| ${i + 1} | ${short(c.concept, 18)} | ${short(c.topic, 10)} | ${(c.R * 100).toFixed(0)}% | ${c.S} |`);
    });
    L.push('');
    L.push('> 顺序是**交错**排的：相邻几张来自不同课题，混着复习比按课题成堆复习记得更牢（Dunlosky 2014）。');
  } else {
    L.push('## 今天没有到期的卡');
    L.push('');
    L.push('按遗忘曲线，下一张到期的卡在 ' + (q.upcoming[0] ? new Date(q.upcoming[0].dueAt).toLocaleDateString('zh-CN') : '——') + '。');
  }
  L.push('');
  L.push('## 全部卡片');
  L.push('');
  L.push('| 概念 | 难度 D | 稳定度 S(天) | 复习次数 | 忘记次数 | 首次来自 |');
  L.push('|---|---|---|---|---|---|');
  j.cards.slice().sort((a, b) => a.S - b.S).forEach((c) => {
    L.push(`| ${short(c.concept, 20)} | ${c.D} | ${c.S} | ${c.reps || 0} | ${c.lapses || 0} | ${short(c.firstTopic || '', 10)} |`);
  });
  L.push('');
  L.push('> D/S 是 FSRS 的 DSR 记忆模型量：D∈[1,10] 越大越难，S 是"回忆概率衰减到 90% 所需天数"。');
  L.push('> 本实现是公开模型的**简化骨架**，不是 FSRS 17 参数拟合版（那需要上千次复习记录）；不宣称达到 FSRS 基准效率。');
  return L.join('\n');
}
