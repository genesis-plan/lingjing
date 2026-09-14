// 灵境 · 课堂节奏曲线（rhythm.mjs）
// --------------------------------------------------------------------------
// 为什么要有这一层：峰终定律（Kahneman）说人对一段经历的记忆由**高峰**和**结尾**决定。
// 灵境把"结尾"做得很重（课后总结），"高峰"这一块一直缺。
//
// ⚠️ 三次改版，每次都是被同一件事逼的——**不要把假数据画成图**：
//   ① 初版：检测"学生理解度的跃迁"（顿悟峰）。理解度来自学生**自评**，是模型采样出的
//      一个数，没有真值来源。在它上面做一阶差分、找"卡住→跃迁"，等于在噪声里找规律。
//   ② 二版：改成"探测有没有被先生的回答接住"（2-gram 文字重叠）。标定 9 组真实问答发现
//      是噪声——好回答 0.000（他换了词），敷衍的"好的下次再讲"0.333（它复述了学生用词）。
//   ③ 现在：**只画关于你（人类）的东西**。
//
// 现在这条曲线画的是：**第 k 轮学生抛出探测器之后，你下一次开口回了多少个字**
// （以及那一轮他们是在拿哪一类问题戳你）。它是你写下的字，数得出来，不需要任何判定。
//
// 为什么这条有用：**答得特别短的那一轮，往往正是你被问住的那一轮**。
//   不是我们判的——是你自己写下的长度自己暴露的。这比任何"接住率"都更直接、也更无从辩解。
//
// 明确不做的事：不检测"顿悟"、不判定"答到没有"、不估计任何 AI 学生的内部状态。
//   我们不知道一个 AI 学生有没有"悟"（它没有脑子），所以也不声称知道。
// 无 DOM、无网络、无依赖，可 Node 直接验。

export function clamp01(x) { return Math.max(0, Math.min(1, x)); }
function round(x, n = 3) { const p = Math.pow(10, n); return Math.round(x * p) / p; }

const KIND_LABEL = { counter: '反例', bound: '边界', example: '正例', distinct: '区分', mechanism: '机制', apply: '应用' };

/** 一轮里学生抛出的探测，按六类计数（纯计数）。 */
export function typeMix(probes) {
  const out = {};
  for (const p of (probes || [])) {
    const k = (p && p.type) || 'other';
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}
/** 六类计数 → 人话（"反例 2 · 边界 1"）。 */
export function mixLine(mix) {
  const parts = [];
  for (const [k, v] of Object.entries(mix || {})) {
    if (!v) continue;
    parts.push(`${KIND_LABEL[k] || k} ${v}`);
  }
  return parts.join(' · ');
}

/**
 * 把 teacher.js 的 rounds 摊成一条"你每轮回了多少"的真实序列。
 *
 * 时序说明（很关键，别搞错）：rounds[k].teacherReply 是**进入第 k+1 轮之前**老师说的那段话，
 * 也就是"对第 k 轮那批探测的回应"。所以第 k 轮的回话 = rounds[k+1].teacherReply。
 * 最后一轮之后没有下一轮 → 那一批探测**没人有机会回**（记为 hasReply:false，这是事实，不是失误）。
 *
 * @param {Array<{round:number, probes:Array, teacherReply:string}>} rounds
 * @returns {Array<{round:number, probes:number, reply:string, chars:number, hasReply:boolean, clarifying:boolean, mix:object, mixLine:string}>}
 */
export function rhythmSeries(rounds) {
  const list = Array.isArray(rounds) ? rounds : [];
  const out = [];
  for (let i = 0; i < list.length; i++) {
    const cur = list[i] || {};
    const nxt = list[i + 1];
    const reply = nxt ? String(nxt.teacherReply || '') : '';
    const chars = reply.replace(/\s/g, '').length;
    const mix = typeMix(cur.probes);
    out.push({
      round: Number(cur.round) || (i + 1),
      probes: (cur.probes || []).length,
      reply,
      chars,
      hasReply: !!reply,
      // 澄清型：回答里带出前提/例子/边界（语言特征命中，纯字符串计数）
      clarifying: /(因为|所以|前提|条件是|需要|比如|例如|注意|其实|换句话说|关键是|首先要|区别在于|例外|不完全是|也就是说)/.test(reply),
      mix,
      mixLine: mixLine(mix),
    });
  }
  return out;
}

/**
 * 全班节奏：找出"你答得最短的那一轮"（＝最可能被问住的那一轮）。
 * 只在**有回答**的轮次里比，不拿"最后一轮没机会回"去当"答得最短"。
 */
export function classRhythm(rounds) {
  const series = rhythmSeries(rounds);
  const answered = series.filter((s) => s.hasReply);
  if (!series.length || !answered.length) {
    return {
      series, shortest: null, longest: null, answeredRounds: 0, charsTotal: 0,
      enough: false,
      narrative: series.length
        ? '这一课你只讲了、没回话。所以这条曲线是空的——没有任何"你答得怎么样"的证据。'
        : '这一课还没有可分析的课堂时序。',
    };
  }
  let shortest = answered[0], longest = answered[0];
  for (const s of answered) {
    if (s.chars < shortest.chars) shortest = s;
    if (s.chars > longest.chars) longest = s;
  }
  const charsTotal = answered.reduce((a, b) => a + b.chars, 0);
  const meanChars = Math.round(charsTotal / answered.length);
  const kinds = {};
  for (const s of series) for (const [k, v] of Object.entries(s.mix)) kinds[k] = (kinds[k] || 0) + v;
  // 只描述事实：哪一轮答得最短、那一轮他们在拿什么戳你。不谈"学生懂了没"。
  const narrative =
    `你一共回了 ${answered.length} 轮，平均每轮 ${meanChars} 字。`
    + `答得最短的是第 ${shortest.round} 轮（${shortest.chars} 字${shortest.mixLine ? `，那一轮他们问的是：${shortest.mixLine}` : ''}）——`
    + `那一轮最可能就是你被问住的地方，值得回头看一眼自己当时怎么答的。`
    + `答得最长的是第 ${longest.round} 轮（${longest.chars} 字）。`;
  return {
    series, shortest, longest,
    answeredRounds: answered.length,
    charsTotal, meanChars,
    kindTotals: kinds,
    enough: series.length >= 2,
    narrative,
  };
}

/** 给前端的一句话（不摊内部数字，只说"发生了什么"）。 */
export function rhythmLine(r) {
  if (!r || !r.shortest) return null;
  return {
    who: `第 ${r.shortest.round} 轮你答得最短`,
    when: `${r.shortest.chars} 字`,
    detail: r.shortest.mixLine ? `那一轮学生问的是：${r.shortest.mixLine}` : '',
  };
}
