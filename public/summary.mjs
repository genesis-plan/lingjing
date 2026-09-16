// 灵境 · 课后总结引擎（给人类使用者的"理论感"提升）
// --------------------------------------------------------------------------
// 用户定调（2026-09-11）：重点不是那 5 个 AI 学生，是**人类**。
//   过程中给人类 —— 体验感 / 游戏感 / 实践感；
//   最后给人类 —— 一份总结，用来提升他自己的**理论感**。
//
// 所以本模块只做一件事：把这一堂课（人类亲手讲出来的东西）**重新组织成数学结构**，
// 让人类看见"我刚才讲的那点经验，其实落在这些数学分支上"，从而把实践升维成理论。
//
// 用到的数学（覆盖主要分支，均为可计算量，不是名词摆设）：
//   逻辑/证明论 —— 讲解的证明骨架（前提 → 推理 → 结论）+ 依赖无环性检查
//   图论       —— 知识依赖图：根/叶、深度、枢纽（度中心性）、环（循环论证风险）
//   信息论     —— 你的"强调分布"的 Shannon 熵：你把注意力平摊在多处，还是全压在一个点上
//   计数/事件  —— 探测枚数 / 你回答的枚数 / 要点数（纯计数，不含任何判定）
//   字符串特征 —— 你的回答里"带出前提/例子/边界"的比例（澄清度，纯语言特征计数）
//   分析/微分方程 —— 热传导 FTCS（物理载体）+ 遗忘曲线 dR/dt = −R/S
//   代数/关系  —— 世界 ⟨S,R,M,T⟩ 的关系代数（teach 边、作品）
//   控制论/优化 —— Flow 通道（你的澄清度-概念难度平衡）
//   统计       —— 探测构成（六类计数）
//   组合/序列  —— 间隔重复的复习时刻（艾宾浩斯 / DSR 反解）
//
// ⚠️ 2026-09-11 大改两次，都是用户直接指出的：
//   （a）「算那几个 AI 学生的数据……那是假的理论，这个产品的最终定位是为人服务，而不是为AI服务」
//       → 本模块原来有三块是在**给 AI 学生建模**：
//           · 概率/贝叶斯 BKT 后验掌握度（源头是"学生自评理解度"，模型采样出的数，无真值）
//           · 线性代数 知识状态矩阵 P ∈ [0,1]^{N×M}（同上，且整堂课在迭代它）
//           · 统计 E(t)/σ²（同上，是 self-report 的均值与方差）
//         这三块已全部删除。
//   （b）「不要算他们的平均值，期望什么的」——后来换成的 conceptCaught（"探测被接住率"）也一并删除：
//         它看着像事实，其实两重假：① 分子靠 2-gram 自动判定（好回答 0.000、敷衍 0.333，是噪声）；
//         ② 分母是"探测落在该要点的枚数"，而那是**我们自己按轮次轮转分配的**，不是学生的真实困惑分布。
//         拿自己造的分布当"学生在哪里卡住"的证据，是循环论证。
//       → 现在涉及 AI 学生的量**只剩纯计数**（抛了几枚探测、哪几枚收到了你的回答），
//         其余全部换成**关于你（人类）自己材料**的可计算量（强调分布熵、澄清度、图结构、遗忘曲线）。
//         我们从此**不声称知道任何 AI 学生的内部状态**，也不再替你判"你答到了没有"。
//
// 诚实标注：本模块全部是**确定性可计算量**，无神经网络、无采样、无读心。
//   总结的落点永远是"下一步该干什么"，不是给人打分。

import { initialStability, nextIntervalDays } from './journal.mjs';
import reflection from './reflection.js';   // 双稿制确定性反思引擎（总结方法论解耦为独立模块）

export function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

const SHORT = (c, n = 12) => {
  const t = String(c || '').replace(/[「」“”'']/g, '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n) + '…' : (t || '概念');
};
const PROBE_KIND = { counter: '反例', bound: '边界', example: '正例', distinct: '区分', mechanism: '机制', apply: '应用' };

// ---- 图论：知识依赖图 ----
function keywordsOf(c) {
  const raw = String(c || '').replace(/[「」“”'']/g, '').trim();
  const parts = raw.split(/[\s,，、；;。]+/).map((w) => w.trim()).filter((w) => w.length >= 2);
  return parts.length ? parts : [raw.slice(0, 6)];
}
function buildGraph(concepts, lessonText) {
  const M = concepts.length;
  const kw = concepts.map(keywordsOf);
  const sents = String(lessonText || '').split(/[。！？；\n]+/).map((s) => s.trim()).filter(Boolean);
  const edgeSet = new Set();
  for (const s of sents) {
    const hit = [];
    for (let i = 0; i < M; i++) if (kw[i].some((k) => s.includes(k))) hit.push(i);
    for (let a = 0; a < hit.length; a++) for (let b = a + 1; b < hit.length; b++) edgeSet.add(hit[a] + '-' + hit[b]);
  }
  if (!edgeSet.size && M > 1) for (let i = 0; i < M - 1; i++) edgeSet.add(i + '-' + (i + 1)); // 兜底：顺序链
  const edges = [...edgeSet].map((e) => e.split('-').map(Number)).filter(([a, b]) => a !== b);
  const adj = Array.from({ length: M }, () => []);
  const indeg = new Array(M).fill(0), outdeg = new Array(M).fill(0);
  for (const [a, b] of edges) { adj[a].push(b); outdeg[a]++; indeg[b]++; }
  const roots = []; const leaves = [];
  for (let i = 0; i < M; i++) { if (indeg[i] === 0) roots.push(i); if (outdeg[i] === 0) leaves.push(i); }
  // 环检测（DFS 三色）
  const color = new Array(M).fill(0); let hasCycle = false;
  const dfs = (u) => {
    color[u] = 1;
    for (const v of adj[u]) {
      if (color[v] === 1) hasCycle = true;
      else if (color[v] === 0) dfs(v);
    }
    color[u] = 2;
  };
  for (let i = 0; i < M; i++) if (color[i] === 0) dfs(i);
  // 深度（最长有向路径）
  const depth = new Array(M).fill(0);
  const order = (function topo() {
    const indeg2 = indeg.slice(), q = [], out = [];
    for (let i = 0; i < M; i++) if (!indeg2[i]) q.push(i);
    while (q.length) { const u = q.shift(); out.push(u); for (const v of adj[u]) if (--indeg2[v] === 0) q.push(v); }
    return out.length === M ? out : null;
  })();
  if (order) for (const u of order) for (const v of adj[u]) depth[v] = Math.max(depth[v], depth[u] + 1);
  const degree = Array.from({ length: M }, (_, i) => indeg[i] + outdeg[i]);
  const maxDeg = Math.max(1, ...degree);
  const hubs = degree.map((d, i) => ({ i, deg: d })).filter((x) => x.deg === maxDeg && maxDeg > 0).map((x) => x.i);
  return {
    nodes: M, edgeCount: edges.length, edges,
    roots, leaves, hasCycle, depth,
    maxDepth: Math.max(0, ...depth), hubs, degree, indeg, outdeg,
    topoOrder: order,
  };
}

// ---- 证明骨架（启发式：把要点按逻辑角色分类）----
const PREM = /(因为|由于|前提|条件是|需要|基于|假设|首先)/;
const INFER = /(所以|因此|于是|这就|说明|可见|推出|意味着|换句话说)/;
const CONCL = /(总之|结论|因此可以说|归根到底|一句话|关键是|要记住)/;
function proofSkeleton(lessonText) {
  const pts = String(lessonText || '').split(/[。！？；\n]+/).map((s) => s.trim()).filter((s) => s.length >= 4).slice(0, 8);
  const premises = [], inferences = [], conclusions = [];
  for (const p of pts) {
    if (CONCL.test(p)) conclusions.push(p);
    else if (INFER.test(p)) inferences.push(p);
    else if (PREM.test(p)) premises.push(p);
    else premises.push(p);            // 默认当前提（陈述性要点）
  }
  return { premises, inferences, conclusions, complete: premises.length > 0 && (inferences.length + conclusions.length) > 0 };
}

// P0-2：AI 理解笔记（镜子）确定性拼装（与 teacher.js finalize 同构；此处作 fallback，主路径用 ev.aiNotes）。
// 全用真实文本：旧想法 + 它记下的先生原话 + 它没搞清的 + 一句自我点检。不评分、不声称它"懂了"。
function buildAiNotes(probeList, students) {
  if (!students || !students.length) return [];
  return students.map((s) => {
    const name = s.name;
    const mine = probeList.filter((p) => p && p.name === name);
    const took = mine.filter((p) => p.answer != null)
      .map((p) => ({ round: p.round, type: p.type, q: p.say, answer: p.answer }));
    const stuck = mine.filter((p) => p.answer == null)
      .map((p) => ({ round: p.round, type: p.type, q: p.say }));
    const sharp = stuck[0] || mine[0];
    const selfCheck = sharp
      ? `我原来以为「${SHORT(s.mis, 18)}」；最想不通的是「${SHORT(sharp.say, 22)}」`
      : '这课我没什么想不通的——但也可能只是我没敢问。';
    return {
      name, mis: s.mis, took, stuck, selfCheck,
      note: took.length
        ? `记下了：${took.map((t) => `「${SHORT(t.answer, 16)}」`).join('；')}。${selfCheck}`
        : selfCheck,
    };
  });
}

// ---- 主入口 ----
export function buildSummary(ev, opts = {}) {
  const { heatEnergy = 0, heatRef = 4 } = opts;
  const concepts = (ev && ev.concepts) || [];
  const M = concepts.length;
  const diffs = (ev && ev.difficulties) || concepts.map(() => 0.4);
  const rounds = (ev && ev.rounds) || [];
  const lessonText = (ev && ev.lessonText) || '';
  const gains = (ev && ev.gains) || {};
  const title = (ev && ev.lessonTitle) || '这一课';

  // 图论 + 证明骨架
  const graph = buildGraph(concepts, lessonText);
  const proof = proofSkeleton(lessonText);

  // ⚠️ 2026-09-11：这里原来算的是"知识状态矩阵 P + 每概念掌握度"，再拿它求 E/σ²/H/峰。
  //   源头是学生的自评理解度——模型**采样出来的一个数**，没有真值来源（GIGO）。
  //   在它上面求均值、方差、熵，等于给随机数化妆。整段删除，换成下面两类**真东西**：
  //     · 关于 AI 学生的：只有纯计数（抛了几枚探测、哪几枚收到了你的回答）；
  //     · 关于你（人类）的：你自己材料上的可计算量（强调分布熵、澄清度、图结构、遗忘曲线）。
  const probeList = (ev && ev.probes) || [];
  const answered = Number(gains.answered != null ? gains.answered : probeList.filter((p) => p.answer != null).length) || 0;
  const probeTotal = Number(gains.probes != null ? gains.probes : probeList.length) || 0;
  const probeOpen = Number(gains.open != null ? gains.open : (probeTotal - answered)) || 0;
  const probeKinds = (gains && gains.probeKinds) || null;
  const pairs = probeList.filter((p) => p && p.answer != null)
    .map((p) => ({ name: p.name, q: p.say, answer: p.answer, type: p.type, round: p.round }));
  const openQ = probeList.filter((p) => p && p.answer == null)
    .map((p) => ({ name: p.name, q: p.say, type: p.type, round: p.round }));

  // P0-2：AI 理解笔记（镜子）。teacher.js 已在 finalize 算好 ev.aiNotes；此处有则直接用，无则从 probes/students 现场拼。
  const aiNotes = (ev && ev.aiNotes && ev.aiNotes.length) ? ev.aiNotes : buildAiNotes(probeList, (ev && ev.students) || []);

  // 信息论：你的"强调分布"的 Shannon 熵 —— 你把注意力平摊在多处（H 高），还是全压在一个点（H 低）。
  //   这一项**只关于你自己的讲解文本**，不涉及任何对学生脑子的估计。
  const attn = concepts.map((c) => {
    const kw = keywordsOf(c);
    return String(lessonText || '').split(/[。！？；\n]+/).filter((s) => kw.some((k) => s.includes(k))).length || 1;
  });
  const sumA = attn.reduce((a, b) => a + b, 0) || 1;
  const aDist = attn.map((x) => x / sumA);
  let H = 0;
  for (const p of aDist) if (p > 0) H -= p * Math.log(p);
  const emphasisEnt = M > 1 ? Number((H / Math.log(M)).toFixed(3)) : 0;   // 归一化到 [0,1]
  let topJ = 0;
  for (let j = 1; j < M; j++) if (aDist[j] > aDist[topJ]) topJ = j;

  // 字符串特征：你的回答"澄清度"＝回答里带出前提/例子/边界的比例（isClarifying 命中的计数比）
  const replies = Number(gains.replies) || 0;
  const clarifying = Number(gains.clarifying) || 0;
  const clarifyRatio = replies ? Number((clarifying / replies).toFixed(3)) : 0;

  // 控制论：Flow —— 挑战(概念难度) vs 技能(你的澄清度)
  const challenge = diffs.length ? Math.max(...diffs.map(Number)) : 0.5;
  const gap = clarifyRatio - challenge;
  const trajectory = rounds.map((r) => ({ round: r.round, probes: (r.probes || []).length }));

  // 组合/序列：遗忘曲线与复习时刻（初值**只由难度**定，因为不知道你掌握没掌握）
  const stability = concepts.map((_, j) => initialStability(diffs[j] != null ? diffs[j] : 5));
  const reviewAt = stability.map((S) => Number(nextIntervalDays(S).toFixed(1)));

  // 线性代数：能量二次型（热场）
  const energyNorm = clamp(heatEnergy / heatRef, 0, 1);

  // ---- 四感（人类视角）----
  const engage = clamp(rounds.length / 4, 0, 1);
  const artCount = Number((ev && ev.artifacts) || 0);
  const artF = artCount > 0 ? 1 : 0;
  const Y_体验 = clamp(0.5 * engage + 0.3 * artF + 0.2 * clamp(artCount / 16, 0, 1), 0, 1);
  const G_游戏 = clamp(1 - Math.abs(gap), 0, 1);
  const prv = clamp((gains.points || 0) / 4, 0, 1);
  const repv = clamp(replies / 3, 0, 1);
  const S_实践 = clamp(0.4 * prv + 0.4 * repv + 0.2 * clarifyRatio, 0, 1);
  const structF = clamp(graph.maxDepth / Math.max(1, graph.nodes - 1), 0, 1);
  // 理论感 = 你把知识讲成了多大一张有结构的地图 + 注意力铺得均不均 + 是真解释还是背定义
  const T_理论 = clamp(0.40 * structF + 0.25 * emphasisEnt + 0.20 * clarifyRatio + 0.15 * artF, 0, 1);

  // ---- 数学地图（覆盖主要分支）----
  const theory = [
    { branch: '逻辑 / 证明论', math: '前提 → 推理 → 结论', value: proof.complete ? '完整' : '待补推理/结论',
      meaning: proof.complete ? '你的讲解有完整的证明骨架。' : '你的讲解偏"陈述"，补上"所以/因此"这一步，学生才跟得上。' },
    { branch: '图论', math: `依赖图 ${graph.nodes} 节点 / ${graph.edgeCount} 边，最大深度 ${graph.maxDepth}`,
      value: graph.hasCycle ? '有环' : '无环(DAG)', meaning: graph.hasCycle ? '⚠ 概念间存在循环依赖，讲的时候会造成"用没学的解释没学的"。'
        : `枢纽概念是第 ${graph.hubs.map((h) => h + 1).join('、')} 个——先把它讲透，其余自然顺。` },
    { branch: '信息论', math: '你的强调分布的 Shannon 熵（归一到 [0,1]）', value: emphasisEnt.toFixed(2),
      meaning: emphasisEnt > 0.9 ? '你把注意力平摊在各个要点上，没有明显的主次——学生抓不到"哪个最重要"。'
        : (emphasisEnt < 0.5 ? `你的讲解高度集中（最多的是第 ${topJ + 1} 个概念），主线很清楚，但别的要点铺垫偏薄。`
          : '主次分明又不至于太偏，注意力的分布比较健康。') },
    { branch: '计数 / 事件', math: '要点数 / 你回答的轮数 / 探测枚数与其中你回的枚数', value: `${graph.nodes} 要点 · ${replies} 轮 · ${probeTotal} 枚探测（你回了 ${answered}、没回 ${probeOpen}）`,
      meaning: '这些是**纯计数**——数得出来、看得见、可反驳。本报告**不含**"学生学会了多少"这类估计，我们不可能知道。' },
    { branch: '字符串特征', math: '回答中带出前提/例子/边界的句数占比', value: `${clarifying}/${replies} = ${(clarifyRatio * 100).toFixed(0)}%`,
      meaning: replies ? (clarifyRatio >= 0.5 ? '你的回答多半给了前提或例子——是在真解释，不是把术语再说一遍。'
        : '你的回答里带出前提/例子/边界的不到一半，有几处更像"把术语又说了一遍"。') : '这一课你没怎么回话，这一项没有样本。' },
    { branch: '分析 / 微分方程', math: '热传导 FTCS + 遗忘曲线 dR/dt=−R/S', value: `能量 ${energyNorm.toFixed(2)}`,
      meaning: '知识像热一样在课室里扩散、也会冷却；下面给了每张卡的复习时刻。' },
    { branch: '代数 / 关系', math: '世界 ⟨S,R,M,T⟩', value: `${(ev && ev.teachingEdges) || 0} 条 teach 边 · ${artCount} 件作品`,
      meaning: '你的讲解被作为"外部输入"接进世界模型，与 5 名学生建立了教学关系。' },
    { branch: '控制论 / 优化', math: 'Flow 通道（你的澄清度 − 概念难度）', value: `gap=${gap.toFixed(3)}`,
      meaning: replies === 0 ? '这一课你没有回答，Flow 判据没有样本。'
        : (Math.abs(gap) <= 0.07 ? '你在心流通道里——这是最有效的表达带宽。' : (gap < 0 ? '概念比你的习惯表达更难，把步子拆细、多给生活例子。' : '概念的难度低于你平时的解释深度，可以换真会卡壳的东西来讲。')) },
    { branch: '统计', math: '探测构成（六类计数）', value: (probeKinds && gains.probeLine) || gains.probeLine || '—',
      meaning: '本课五名学生一共抛出多少枚探测、各属哪一类。**反例与边界例越多，越能照出你讲解里没交代的口子**。' },
    { branch: '组合 / 序列', math: 'DSR 反解复习时刻（初值只由难度定）', value: reviewAt.map((t) => t + 'd').join(' → '),
      meaning: '复习时刻的**初值只由概念难度**算（我们不知道你掌握没掌握，所以不编）；之后由你自己复习时的评分来修正。' },
  ];

  return {
    title,
    generatedAt: new Date().toISOString(),
    senses: {
      experience: { key: 'experience', label: '体验感', value: Number(Y_体验.toFixed(3)) },
      game: { key: 'game', label: '游戏感', value: Number(G_游戏.toFixed(3)) },
      practice: { key: 'practice', label: '实践感', value: Number(S_实践.toFixed(3)) },
      theory: { key: 'theory', label: '理论感', value: Number(T_理论.toFixed(3)) },
    },
    graph, proof,
    // 关于 AI 学生的量：**只有计数与原文**，没有任何"他懂了多少""你答到了多少"的判定
    probes: { total: probeTotal, answered, open: probeOpen, kinds: probeKinds, line: gains.probeLine || '' },
    pairs, openQ,                        // 逐条并列：他问的 / 你答的；以及你没回的
    aiNotes,                            // P0-2：AI 理解笔记（镜子，含它没搞懂的）
    emphasis: { attn, dist: aDist.map((x) => Number(x.toFixed(3))), entropy: emphasisEnt, top: M ? topJ : -1 },
    clarifyRatio,
    flow: { challenge: Number(challenge.toFixed(3)), gap: Number(gap.toFixed(3)), trajectory },
    reviewAt, energyNorm, theory,
    honest: '本总结由课堂实录确定性计算（无神经网络、无采样）。'
      + '其中「强调分布熵」「澄清度」「图结构」「要点/轮数」都来自**你自己讲过的话**；'
      + '涉及学生的那几项只有**纯计数与他们的原话**（抛了几枚探测、哪几枚收到了你的回答）。'
      + '本总结**不做**"你答到了没有"的判定——机器只能数词，不能读心；'
      + '也**不含**任何关于 AI 学生"学会了多少"的估计——我们不可能知道，也不声称知道。',
  };
}

// ---- 总结 → 人类可读 Markdown ----
export function summaryToMarkdown(s) {
  const L = [];
  const pct = (v) => Math.round(v * 100) + '%';
  L.push(`# 《${s.title}》· 课后总结（给你的）`);
  L.push('');
  L.push(`> 这一课重点不是那 5 个学生，是你。下面是把你刚才讲出的东西，重新组织成数学结构。`);
  L.push('');
  L.push('## 一、你的四感');
  L.push('');
  L.push('| 感受 | 数值 | 说明 |');
  L.push('|---|---|---|');
  L.push(`| 体验感 | ${pct(s.senses.experience.value)} | 课堂真的发生了：${s.graph.nodes} 个概念、${s.flow.trajectory.length} 轮对话被你接进世界。 |`);
  L.push(`| 游戏感 | ${pct(s.senses.game.value)} | 概念难度与你解释深度（前提/例子/边界占比）的贴合度。 |`);
  L.push(`| 实践感 | ${pct(s.senses.practice.value)} | 你亲手动手的量：讲要点、答疑问、给澄清。 |`);
  L.push(`| 理论感 | ${pct(s.senses.theory.value)} | 这课知识被你讲成了多大一张有结构的地图，注意力铺得均不均。 |`);
  L.push('');
  L.push('## 二、学生问的 / 你答的（逐条并排，答到没有你自己判）');
  L.push('');
  L.push(`学生一共抛出 ${s.probes.total} 枚探测，你给了回答的是 ${s.probes.answered} 枚，没回 ${s.probes.open} 枚。`);
  L.push('');
  if (s.pairs.length) {
    L.push('| 谁 | 什么时候 | 他问的 | 你答的 |');
    L.push('|---|---|---|---|');
    for (const p of s.pairs) {
      L.push(`| ${p.name} | 第 ${p.round} 轮［${PROBE_KIND[p.type] || '探测'}］ | ${SHORT(p.q, 34)} | ${SHORT(p.answer, 40)} |`);
    }
    L.push('');
    L.push('**这里不替你判"答到了没有"**：机器只能数词，不能读心。'
      + '我们试过按"你的回答和他的问题文字重叠"自动判——好回答能得 0.000，敷衍的"好的下次再讲"反而得 0.333，'
      + '是噪声，已撤掉。**逐条读过去，哪一条心里咯噔一下，那就是你的口子。**');
  } else {
    L.push('这一课你没有回答过任何探测——盲区没有暴露的机会。下次至少回两轮。');
  }
  if (s.openQ.length) {
    L.push('');
    L.push(`**你没回的 ${s.openQ.length} 枚**（多是收尾前刚问的，但它们往往最尖）：`);
    for (const p of s.openQ) L.push(`- ${p.name} 第 ${p.round} 轮［${PROBE_KIND[p.type] || '探测'}］${p.q}`);
  }
  L.push('');
  L.push('## 三、AI 理解笔记（镜子，含它没搞懂的）');
  L.push('');
  L.push('> 这不是给 AI 学生打分，是把它们当镜子——它们记下的、没搞清的，正把你讲解里的口子镜像回来。');
  L.push('> 数据不删、不对外、不评分；下面引用的是它们的原话和你（先生）的原话。');
  L.push('');
  for (const n of (s.aiNotes || [])) {
    L.push(`### ${n.name}`);
    L.push(`- 进课堂前的旧想法：${n.mis}`);
    if (n.took && n.took.length) {
      L.push('- 它记下的（先生原话）：');
      for (const t of n.took) L.push(`  - 第${t.round}轮［${PROBE_KIND[t.type] || '探测'}］它问：${SHORT(t.q, 30)} → 先生答：「${SHORT(t.answer, 36)}」`);
    } else {
      L.push('- 这一课它没接到你的回答（或没怎么问）。');
    }
    if (n.stuck && n.stuck.length) {
      L.push('- 它还没搞清的（你没回到的口子）：');
      for (const t of n.stuck) L.push(`  - 第${t.round}轮［${PROBE_KIND[t.type] || '探测'}］${SHORT(t.q, 30)}`);
    }
    L.push(`- 它一句自我点检：${n.selfCheck}`);
    L.push('');
  }
  L.push('');
  L.push('## 四、你的知识结构图（图论）');
  L.push('');
  L.push(`- 节点（概念）：${s.graph.nodes}　边（依赖）：${s.graph.edgeCount}　最大深度：${s.graph.maxDepth}`);
  L.push(`- 根（先讲这个）：${s.graph.roots.map((i) => i + 1).join('、') || '—'}　叶（最后落这里）：${s.graph.leaves.map((i) => i + 1).join('、') || '—'}`);
  L.push(`- 枢纽（讲了它其余就顺）：${s.graph.hubs.map((i) => i + 1).join('、') || '—'}　有无环：${s.graph.hasCycle ? '有（注意循环论证）' : '无（DAG）'}`);
  L.push('');
  L.push('## 五、你的注意力分布（信息论）');
  L.push('');
  L.push(`- 各要点被讲到的句数占比：${s.emphasis.dist.map((p, i) => `第${i + 1}个 ${(p * 100).toFixed(0)}%`).join('　')}`);
  L.push(`- 强调分布熵（归一到 [0,1]）= ${s.emphasis.entropy}${s.emphasis.top >= 0 ? `　讲得最多的是第 ${s.emphasis.top + 1} 个` : ''}`);
  L.push(`- 你回答的澄清度（带前提/例子/边界的占比）= ${(s.clarifyRatio * 100).toFixed(0)}%`);
  L.push('');
  L.push('## 六、本课用到的数学（理论感）');
  L.push('');
  L.push('| 分支 | 数学对象 | 你的值 | 对你意味着什么 |');
  L.push('|---|---|---|---|');
  for (const t of s.theory) L.push(`| ${t.branch} | ${t.math} | ${t.value} | ${t.meaning} |`);
  L.push('');
  L.push('## 七、下一步（把实践变理论）');
  L.push('');
  L.push('1. 挑上面 **枢纽概念**，用一句"所以"把它与**根概念**连起来——这就补上了你的证明骨架。');
  if (s.openQ.length) L.push(`2. 先回一下你没回的那 ${s.openQ.length} 枚探测——它们没人有机会被回答，但最可能戳到你的口子。`);
  L.push(`${s.openQ.length ? 3 : 2}. 把第二节那张"他问的 / 你答的"逐条读一遍，自己标出哪几条没答到；那是下一课要补的。`);
  L.push('');
  L.push('---');
  L.push(`> ${s.honest}`);
  L.push(`> 生成时间：${s.generatedAt}`);
  return L.join('\n');
}
