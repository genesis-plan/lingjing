// 灵境 · 课后卡片 / 知识库生成器（纯数学，无 DOM、无网络、可 Node 直接验）
// --------------------------------------------------------------------------
// 本文件把"一堂课后，把人类**自己讲过的东西**整理成可复习的卡片组反馈给人类"这件事，
// 用灵境的全部数学定理实现——不靠神经网络、不靠肉眼编故事：
//
//   ① 世界模型 ⟨S,R,M,T⟩（teacher.js 的 World）：concepts / difficulties / probes / transcript /
//      teachingEdges / artifacts 都是课堂世界里真实落下的量，本模块只消费、不生成。
//   ② 热传导 FTCS（HeatWorld3D）：课室上方"教学能量场"是真实 3D 演化；它的能量来自**对话活动**。
//      activityScore() 把这份能量 + 世界里的 teach 边 + 作品数 + 学生提问量，合成一个
//      "这一课到底有多少东西真的发生了"的可读度量。
//   ③ 教中学 protégé effect（protégé effect + 费曼）：每次讲解被提炼成一张卡——卡背是教师要点 +
//      学生原话（学生**问过什么**）。卡面是**学生当初问你的那句话**，逼你做主动回想。
//   ④ Flow 理论（Csikszentmihalyi）：用 挑战(概念难度) vs 技能(你回答的澄清度) 校准"游戏感"。
//   ⑤ 间隔重复（艾宾浩斯 / FSRS DSR）：每张卡带一条复习间隔阶梯，让人类"主动回想"。
//
// ⚠️ 2026-09-11 两次改动，都与用户的两句批评直接对应：
//   （a）「算那几个 AI 学生的数据……那是假的理论，最终定位是为人服务，而不是为 AI 服务」
//       → 旧 `transferScore` 的 K 曾叫「知识已传入 AI 的度量」，卡面印「AI 已吃透（蒸馏热度）0.62」，
//         那个 0.62 就是学生自评理解度。两处都改掉了：K 现在叫**互动真实度**（事件计数）。
//   （b）「他们的作用只是为了让人类使用者更好的体验……不要算他们的平均值、期望」
//       → 卡片上原来还有一项 `mastery`＝"每个要点的探测被接住率"。它看着像事实，其实是两重假：
//         ① 分子靠 2-gram 自动判定（标定证明是噪声：好回答 0.000，敷衍 0.333）；
//         ② 分母是"探测落在这个要点上的枚数"，而探测落到哪个要点是**我们自己按轮次错开分配的**，
//            不是学生的真实困惑分布——拿自己造的分布当"学生在哪里卡住"的证据，是循环论证。
//       → `mastery` 整个字段**删除**。卡片不再声称任何"你答到了多少"，
//         改为把**学生问过的原话**摆在卡面当回顾题（真实文本），掌握与否由人类自己在复习时打分
//         （见 journal.mjs 的 reviewCard：S 只由**人类自己的评分**演化，初值只由难度定）。
//
// 诚实标注（务必记住）：卡片的复习排期初值**只由概念难度**定，因为我们不知道你掌握没掌握；
//   卡片只说"回顾用"，不当作"你已掌握"。activityScore / flowState 同理，都是相对信号。

export function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

// 艾宾浩斯遗忘曲线间隔（天）：主动回想 + 间隔重复，把短期讲授压成长期记忆
export const SPACED_INTERVALS_DAYS = [1, 2, 4, 7, 15, 30, 60];

// ---- 知识蒸馏：把"一段讲解"提炼成卡的背面（软目标）----
// 不做神经网络，用确定性抽取：取该概念相关的教师要点句 + 学生里提到该概念的原话。
function distillBack(concept, lessonText, transcript) {
  const raw = String(concept || '').replace(/[「」“”'']/g, '').trim();
  const kw = raw.split(/\s*[,，、；;。]\s*/).map((w) => w.trim()).filter((w) => w.length >= 2);
  const kset = kw.length ? kw : [raw.slice(0, 8)];

  const teacherBits = String(lessonText || '')
    .split(/[。！？；\n]+/).map((s) => s.trim()).filter((s) => s && kset.some((k) => s.includes(k)));

  const studentVoice = [];
  for (const line of (transcript || [])) {
    const t = String((line && line.text) || '');
    if (t && kset.some((k) => t.includes(k))) studentVoice.push(t);
    if (studentVoice.length >= 2) break;
  }
  const back = (teacherBits.length ? teacherBits : [raw]).slice(0, 3).join('；');
  return { back, studentVoice: studentVoice.slice(0, 2).join(' / ') };
}

// ---- ① 这一课"真的发生了"多少（0~1）：热场能量 + 世界 teach 边 + 作品 + 学生提问量 ----
// heatEnergy：客户端实时传入的 HeatWorld3D.energy()（对话带来的"课室热度"）。
// ⚠️ 2026-09-11：这里原来叫「知识已传入 AI 的度量 K」——那是在给 AI 打分，用户已明确否掉。
//    后来一版掺了"接住率"（2-gram 自动判定），标定证明是噪声，也已撤掉。
//    现在四项输入全是事件/计数，没有任何一项读模型的心思、也没有任何一项依赖自动判定。
export function activityScore(ev, { heatEnergy = 0, heatRef = 4 } = {}) {
  const gains = (ev && ev.gains) || {};
  const edges = Number(ev && ev.teachingEdges != null ? ev.teachingEdges : 0) || 0;
  const artifacts = Number(ev && ev.artifacts != null ? ev.artifacts : 0) || 0;
  const heatNorm = clamp(heatEnergy / heatRef, 0, 1);             // 物理载体层：课室热度
  const edgeF = clamp(edges / 5, 0, 1);                            // 公理3：5 条 teach 边接进了世界
  const artF = artifacts > 0 ? 1 : 0;                              // 作品（教案+笔记）已落世界
  const probeF = clamp((gains.probes || 0) / 10, 0, 1);            // 学生抛出探测的量（10 枚≈满）
  const replyF = clamp((gains.replies || 0) / 3, 0, 1);            // 你回了几轮话（3 轮≈满）
  // 加权：能量场是"真发生"的最硬证据（35%），其余各档
  const K = 0.35 * heatNorm + 0.20 * edgeF + 0.20 * artF + 0.15 * probeF + 0.10 * replyF;
  return {
    K: Number(K.toFixed(3)),
    heatNorm: Number(heatNorm.toFixed(3)),
    edgeF: Number(edgeF.toFixed(3)),
    artF,
    probeF: Number(probeF.toFixed(3)),
    replyF: Number(replyF.toFixed(3)),
    edges, artifacts,
  };
}
// 旧名保留（前端/测试仍按 transferScore 引用）；语义已从"知识传入 AI"改成"互动真实度"
export const transferScore = activityScore;

// ---- ④ Flow 理论：挑战(概念难度) vs 技能(你回答的澄清度) 六态分类 ----
// skill 轴 = 你回答里"带出前提/例子/边界"的比例（isClarifying 的语言特征计数）。
// ⚠️ 2026-09-11：这一轴原来用"接住率"（2-gram 自动判定，噪声，已撤），
//   再之前用"学生自评理解 + 讲解完整度"（模型采样数，已撤）。
//   现在这一轴**只关于你自己说过的话**：它不读学生的心思，也不需要任何判定。
export function flowState(ev) {
  const diffs = (ev && ev.difficulties) || [];
  const challenge = diffs.length ? Math.max(...diffs.map(Number)) : 0.5;  // 最难的概念 = 本课挑战
  const gains = (ev && ev.gains) || {};
  const replies = Number(gains.replies) || 0;
  const skill = replies ? clamp(Number(gains.clarifying || 0) / replies, 0, 1) : 0;
  const gap = skill - challenge;            // >0 技能领先（偏轻松），<0 挑战领先（偏紧张）
  let state, label, advice, color;
  if (replies === 0) {
    state = 'apathy'; label = '没开口'; color = '#8a7f6a';
    advice = '这一课你只讲了、没回话，所以没有任何"你回答得怎么样"的证据。下一课至少回两轮。';
  } else if (skill < 0.3 && challenge < 0.3) {
    state = 'apathy'; label = '淡漠'; color = '#8a7f6a';
    advice = '这课两端都低——可能讲得太浅或没讲开。下一课挑个你真正拿不准的点来讲。';
  } else if (gap <= -0.20) {
    state = 'anxiety'; label = '吃力'; color = '#c2410c';
    advice = '概念偏难、你的回答大多没带出前提或例子——听着像在背定义。下一课把最难的那条拆成更小的步子。';
  } else if (gap < -0.07) {
    state = 'arousal'; label = '绷着'; color = '#d97706';
    advice = '比你的从容区难一点点，正好在"拉伸区"。保持这个节奏，是练得最深的带宽。';
  } else if (gap <= 0.07) {
    state = 'flow'; label = '心流'; color = '#15803d';
    advice = '难的你也讲得有前提有例子，你在 flow 通道里。这就是"游戏感"的来源——别停，继续讲。';
  } else if (gap <= 0.20) {
    state = 'control'; label = '从容'; color = '#0e7490';
    advice = '你讲得比概念本身难，比较从容。可以再上一个难度，或让学生多追问你几层。';
  } else {
    state = 'boredom'; label = '偏浅'; color = '#6b7280';
    advice = '学生问的东西对你太浅、你没被问住。下一课换你真正会卡壳的硬骨头来讲。';
  }
  return { state, label, advice, color, challenge: Number(challenge.toFixed(3)), skill: Number(skill.toFixed(3)) };
}

// ---- 主入口：从一堂课的产出，生成"卡片组"（知识库 + 可复习卡）----
// ev 来自 teacher.js finalize 的 result：concepts / difficulties / probeByConcept / probes /
//      transcript / teachingEdges / artifacts / gains / students / rounds / minutes。
export function buildDeck(ev, opts = {}) {
  const concepts = (ev && ev.concepts) || [];
  const diffs = (ev && ev.difficulties) || concepts.map(() => 0.4);
  const byConcept = (ev && ev.probeByConcept) || [];
  const transcript = (ev && ev.transcript) || [];
  const lessonText = (ev && ev.lessonText) || (ev && ev.minutes && ev.minutes.md) || '';
  const title = (ev && ev.lessonTitle) || '这一课';

  const cards = [];
  for (let j = 0; j < concepts.length; j++) {
    const c = String(concepts[j] || ('概念' + (j + 1)));
    const short = c.length > 16 ? c.slice(0, 16) + '…' : c;
    const d = distillBack(c, lessonText, transcript);
    // 这个要点上**学生问过的原话**（真实文本，不改一个字）。没有就是空数组，不编。
    const asks = ((byConcept[j] && byConcept[j].asks) || []).map((a) => ({
      name: a.name, type: a.type, say: a.say, round: a.round, answered: !!a.answered,
    }));
    // 卡面（主动回想的题）：优先用**学生当初问你的那句话**——那是真被问住的瞬间，比抽象提问有效得多。
    const front = asks.length
      ? `${asks[0].name} 当时这样问你：「${asks[0].say.length > 30 ? asks[0].say.slice(0, 30) + '…' : asks[0].say}」——现在用你自己的话讲清它。`
      : (c.length > 14 ? `「${short}」到底是怎么回事？用自己的话讲给一个外行听。` : `你来讲讲「${c}」——它是什么、为什么重要？`);
    cards.push({
      id: 'card_' + (j + 1),
      concept: c,
      difficulty: Number((diffs[j] != null ? diffs[j] : 0.4).toFixed(3)),
      // ⚠️ 这里**没有 mastery**（曾＝"探测被接住率"，两重假，已删）。我们不知道你掌握没掌握。
      asks,                                                  // 学生在这个要点上问过的原话
      askCount: asks.length,
      front,
      back: d.back || c,
      studentVoice: d.studentVoice,                          // 学生在这里问过什么（真实原话）
      schedule: SPACED_INTERVALS_DAYS.slice(),
      nextDue: SPACED_INTERVALS_DAYS[0],                     // 下次复习：明天（间隔阶梯的第一格）
    });
  }

  const transfer = activityScore(ev, opts);
  const flow = flowState(ev);
  const gains = (ev && ev.gains) || {};
  return {
    title,
    generatedAt: new Date().toISOString(),
    transfer,           // 本课"真的发生了"多少（互动真实度）
    flow,               // 本课心流状态（挑战 vs 你的澄清度）
    cards,              // 卡片组
    probes: {
      total: Number(gains.probes) || 0,
      answered: Number(gains.answered) || 0,
      open: Number(gains.open) || 0,
      line: gains.probeLine || '',
    },
    worldRef: {
      edges: transfer.edges,
      artifacts: transfer.artifacts,
      note: '本组卡片来自课堂世界 ⟨S,R,M,T⟩：' + transfer.edges + ' 条 teach 边 + ' +
            transfer.artifacts + ' 件作品（教案/学生笔记）已落世界。',
    },
  };
}

// ---- 卡片组 → Markdown（可下载/打印/进知识库）----
export function deckToMarkdown(deck) {
  const L = [];
  L.push(`# 《${deck.title}》· 课后卡片组`);
  L.push('');
  L.push(`> 本课互动真实度 K = **${deck.transfer.K}** ｜ 本课节奏：**${deck.flow.label}**`);
  L.push(`> ${deck.worldRef.note}`);
  L.push(`> 学生这一课共抛出 ${deck.probes.total} 枚探测，其中 ${deck.probes.answered} 枚你给了回答`
    + `${deck.probes.open ? `、${deck.probes.open} 枚你没回` : ''}。`);
  L.push('');
  deck.cards.forEach((c, i) => {
    L.push(`## 卡 ${i + 1} · ${c.concept}`);
    L.push(`- 难度：${c.difficulty}`);
    L.push(`- **回顾（正面）**：${c.front}`);
    L.push(`- **要点（背面）**：${c.back}`);
    if (c.studentVoice) L.push(`- 学生问过的原话：${c.studentVoice}`);
    L.push(`- 复习间隔（天）：${c.schedule.join(' → ') || '—'}，下次：${c.nextDue} 天后`);
    L.push('');
  });
  L.push('---');
  L.push(`生成时间：${deck.generatedAt}`);
  L.push('');
  L.push('> 卡片由课堂实录确定性提炼（非 AI 自由生成），只作回顾用。');
  L.push('> 卡上**没有**"你答到了百分之多少"这种数——机器只能数词、不能读心，我们给不出那个数。'
    + '复习排期的初值只由**概念难度**定；之后由你自己每次复习时的评分来调整。');
  return L.join('\n');
}
