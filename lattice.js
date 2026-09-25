// lattice.js — 巩固分析层：Λ 概念格（形式概念分析） + Σ 覆盖骨架（Nerve）
// --------------------------------------------------------------------------
// 这两个是 docs/09 里唯二还标"路线"的算子（§8.4 Λ、§8.5 Σ）。其余算子（Γ/⊕/Φ/β/
// ∂/Δ/m/𝒢/Δ*/EIG/SM-2/ZPD fading）代码里都已有实现与测试守护，唯独这两个只有纸面。
// 这一层把它们补成真代码、真测试、真进用户耳朵的中文段落。
//
// ★ 共同红线（守 A2「镜子不评分」）：本层不产出任何"人学没学会"的量。
//   Λ 说的是"哪些课的哪一类信号是一伙的"（文本事实的聚类）；
//   Σ 说的是"你的口子在时间轴上怎么铺开的"（位置形状）。两者都不看人。
//
// 全部：纯函数、零依赖、确定性可重放。

// ============================================================================
// Λ 概念格 — 形式概念分析（Formal Concept Analysis, FCA）
// ============================================================================
// 形式背景 (G, M, I)：
//   G = 对象集（这里＝各课的 id / 标题）
//   M = 属性集（这里＝弱信号类型：jargon / jump / abstract / parrot / omit …）
//   I ⊆ G×M ＝"该课是否触发了该类信号"
//
// 导出算子（伽罗瓦对偶，一对互为闭包）：
//   A↑ = { g ∈ G | ∀m ∈ A: (g,m) ∈ I }     （A 的 extent：共享了属性集 A 的课）
//   B↓ = { m ∈ M | ∀g ∈ B: (g,m) ∈ I }     （B 的 intent：全体 B 里课共有的属性）
//   一个**形式概念**＝满足 A↑↓ = A 且 B↓↑ = B 的一对 (A↑, B)。
//
// 为什么必须真枚举而不是"数一数就完事"：
//   概念格的節點才是"卡点类型"——extent 是共享这一类型的课，intent 是该类型的全部信号。
//   只数复现次数（现在的 reps）拿到的是**频次**，拿不到"哪几课共享同一类卡点"这层结构；
//   概念格把这层结构显式化，并把"最泛的卡点"（所有课共有）与"最特的卡点"（只有一课命中）
//   分开——后者正是下次该针对性的那一个类。
//
// 实现：Ganter 的 **NextClosure** 算法。
//   全格最坏 |M| 指数膨胀，所以不一次性展开——从 ∅ 出发按字典序逐个求下一个闭包，
//   何时枚举完由算法自身决定；叠 maxConcepts 上限（诚实截断，绝不谎报"全部"）。
//   属性用位掩码（JS 位运算 31 位安全），故 |M| ≤ 31。
// ============================================================================

// 位掩码：属性索引 → bit。|M| 超 31 直接拒绝（位运算是 32 位），宁可不说也不装能算。
const MAX_ATTRS = 31;

// 弱信号类型 → 标准顺序（概念格的字典序由它决定，一旦定下不可随意改，否则同一批数据
// 会枚举出不同的概念排列，回放就不可复现了）。
const SIGNAL_ORDER = ['jargon', 'jump', 'abstract', 'parrot', 'omit'];

// objects: [{ id, title?, signals: string[] }]
//   signals 里的类型若未登记在 SIGNAL_ORDER，按出现顺序补进属性表（仍保持确定性）。
// 返回形式背景三元组。
function buildContext(objects = []) {
  const attrs = [];
  const index = new Map();
  const addAttr = (s) => {
    if (!s) return -1;
    if (index.has(s)) return index.get(s);
    if (attrs.length >= MAX_ATTRS) return -2;        // 溢出：不是"算不出来"，是拒绝假装能算
    index.set(s, attrs.length);
    attrs.push(String(s));
    return attrs.length - 1;
  };
  const rows = [];
  for (const o of objects || []) {
    let mask = 0;
    for (const s of (o && o.signals) || []) {
      const i = addAttr(s);
      if (i >= 0) mask |= (1 << i);
    }
    rows.push({ object: (o && (o.id != null ? o.id : o.title)) || '?', title: (o && o.title) || null, mask });
  }
  return { objects: rows, attrs, attrIndex: index };
}

// A↑（extent）：mask 里每个属性都被该对象命中的对象集。
function extentOf(mask, rows) {
  const out = [];
  for (let i = 0; i < rows.length; i++) if ((rows[i].mask & mask) === mask) out.push(i);
  return out;
}

// B↓（intent）：对象索引集合 B 里全体对象共同拥有的属性位。
function intentOf(set, rows, attrCount) {
  let mask = attrCount >= MAX_ATTRS ? (1 << attrCount) - 1 : (1 << attrCount) - 1;
  for (const i of set) mask &= rows[i].mask;
  return mask;
}

// 闭包：mask → mask↑↓
function closureOf(mask, rows, attrCount) {
  const ext = extentOf(mask, rows);
  if (!ext.length) return 0;                       // 空 extent 的闭包是 ∅（格底之下的退化情形）
  return intentOf(ext, rows, attrCount);
}

// 一个掩码还原成 { extent: 对象下标[], intent: 属性名[] }
function conceptOf(mask, rows, attrs) {
  const ext = extentOf(mask, rows);
  const intent = [];
  for (let i = 0; i < attrs.length; i++) if (mask & (1 << i)) intent.push(attrs[i]);
  return { extent: ext, intent };
}

// 枚举全格：遍历全部属性子集 → 取各自的闭包 → 去重 → 按位掩码排序。
//   为什么不用教科书里的 **NextClosure**（在闭包链上跳着走）：
//   它默认"候选闭包的字典序严格前进"，可闭包并不保序——候选的闭包完全可能退回当前这一个。
//   真跑起来就是两种坏法：要么误判"枚举结束"（全格塌成一个节点，看着像"这课没信号"），
//   要么原地打转。本产品的属性就 5 类信号 + 1 条澄清事实，最多 6 个，2⁶=64 个子集一口气数完。
//   既不指数爆炸，又能被测试拿暴力法逐条对表 —— **能被验证**比"用了个更漂亮的算法"重要。
//   maxConcepts 是诚实上限：撞到就停，并在 note 里写明截断，绝不谎报"这是完整格"。
function formalConcepts(objects = [], { maxConcepts = 512 } = {}) {
  const { objects: rows, attrs } = buildContext(objects);
  const attrCount = attrs.length;
  if (!attrs.length) return { attrs, concepts: [], truncated: false, note: '一个属性都没有，无从成格。' };
  if (attrCount > 20) {
    // 2²⁰ 往上就不可枚举了。这时候**拒绝给结论**，而不是抛异常让上层崩。
    return { attrs, concepts: [], truncated: true, note: `属性 ${attrCount} 个，超出可枚举范围（>20），不做。` };
  }
  const total = 1 << attrCount;
  const seen = new Set();
  const masks = [];
  for (let m = 0; m < total; m++) {
    // ⚠️ 必须先看 extent 是否为空：extent 为空的子集（例如 {abstract, omit} 在没人同时命中它时）
    //   闭包会算成 0，可 0 又会经 extentOf(0) 被"还原"成**全体对象** —— 于是冒出一个
    //   "全员共享空属性"的假顶概念，格的第一行就错了。空 extent 不是概念，直接丢。
    if (!extentOf(m, rows).length) continue;
    const c = closureOf(m, rows, attrCount) >>> 0;
    if (seen.has(c)) continue;
    seen.add(c);
    masks.push(c);
    if (masks.length >= maxConcepts) {
      masks.sort((a, b) => a - b);
      return {
        attrs, truncated: true, note: `概念数撞到上限 ${maxConcepts}，已截断（非全格）。`,
        concepts: masks.map((c) => conceptOf(c, rows, attrs)),
      };
    }
  }
  masks.sort((a, b) => a - b);                        // 按属性序排 → 回放可重放
  const allEmpty = masks.every((c) => c === 0);
  return {
    attrs,
    concepts: masks.map((c) => conceptOf(c, rows, attrs)),
    truncated: false,
    note: allEmpty ? '所有课的信号都不重叠，格退化为单点。' : '',
  };
}


// 概念格分析：把课集合坍缩成"卡点类型"清单 + 一句人话。
//   · 一个概念节点＝一类卡点：extent 是命中它的课，intent 是这类卡点的全部信号。
//   · 取 extent ≥ 2 的节点＝"不止一课撞上"的慢性卡点（这是 Λ 相对 reps 计数的增量价值）。
//   · 最大的那个节点（extent 覆盖全部课）＝本次这批课的公共底子。
function analyzeLattice(objects = []) {
  const { attrs, concepts, truncated, note } = formalConcepts(objects);
  const withSize = concepts.map((c) => ({
    ...c,
    size: c.extent.length,
    label: c.extent.length === 0
      ? '（空）'
      : (c.extent.length === objects.length ? '全部课共有的底子' : c.intent.length ? c.intent.join('+') : '只露了一个信号'),
  }));
  withSize.sort((a, b) => (b.size - a.size) || (a.intent.length - b.intent.length));
  // 慢性卡点：≥2 课命中、且至少带两类信号（只有一类信号通常只是字面巧合）
  // 慢性卡点：≥2 次命中。只要求"命中两类以上"会漏掉最典型的那种——
  //   课课都甩术语（jargon 反复出现）本来就是慢性卡点，不该因为"只有一类信号"被抹掉。
  //   信号种类多的排前面（值得先看），同类里命中次数多的优先。
  const chronic = withSize.filter((c) => c.size >= 2 && c.intent.length >= 1)
    .sort((a, b) => (b.intent.length - a.intent.length) || (b.size - a.size));
  // 最特的节点：只被一课命中，下次可以针对性看
  const specific = withSize.filter((c) => c.size === 1);
  // 口径随输入粒度走：对象若是"课"，就说"跨课"；若是"一节课里的一次次开口"，就说"这几轮"。
  const unit = objects.length < 2 ? '次数' : (objects.length <= 8 ? '这几轮' : '这几课');
  const line = chronic.length
    ? `你这 ${objects.length} ${unit}里，有 ${chronic.length} 类卡点是**反复出现的**：`
      + chronic.slice(0, 3).map((c) => `「${c.intent.join('+')}」（${c.size} ${unit}命中）`).join('、')
      + '。它们不是某一次偶发，是带回的。'
    : (specific.length && objects.length >= 2
      ? `${unit}没有反复出现的卡点，各自的口子是各自的事（${specific.length} 条只出现过一次）。`
      : '这些开口都没触发可归类的信号——不是没算，是没什么可归的。');
  return {
    attrs, concepts: withSize, chronic, specific, truncated, note,
    line,
    hasStructure: chronic.length > 0,
  };
}

// ============================================================================
// Σ 覆盖骨架 — Nerve 的 1-骨架（盲区在时间轴上的形状）
// ============================================================================
// 做法（照 docs/09 §8.5，但把"需嵌入"这个前提拆掉）：
//   点云 → 像空间 cover（每个点掷一个半径 r 的区间，重叠即相连）
//        → 各 bin 内聚类（把重叠区间并成一族）
//        → nerve：顶点＝非空 cover 集，{U_i,U_j} 连边当且仅当 U_i∩U_j≠∅
//   我们只要 1-骨架（一张图）——高阶单纯形（三角/四面）在真人样本量下没有解释力，YAGNI。
//
// ★ 与 β（持久同调）的区别，别混：
//   β 看的是**概念之间**（共现图里的环，静态拓扑）；
//   Σ 看的是**口子之间随时间**（时间轴上的覆盖，位置拓扑）。
//   β 回答"这几个概念缠成圈了吗"，Σ 回答"你的口子是挤成一堆还是撒开了"。
//
// filter 函数用**课时轴**（round）——这是文档给的两个候选之一（另一个是主题嵌入）。
//   选课时轴的好处：零依赖、确定性、不引入任何嵌入模型。而且它命中的是真实体验——
//   人在课堂前段一口气卡住、后面缓过来，是一个形状，不该被当成两个孤立念头条目。
function nerveSkeleton({ points = [], coverRadius = 1.5 } = {}) {
  const r = Number(coverRadius) || 0;
  const pts = (points || [])
    .filter((p) => p && p.round != null)
    .map((p) => ({ id: p.id != null ? p.id : String(p.label || p.round), label: p.label || p.id || String(p.round), round: Number(p.round) }))
    .sort((a, b) => (a.round - b.round) || String(a.id).localeCompare(String(b.id)));   // 全序 → 可重放
  if (pts.length < 2) {
    return { bins: [], edges: [], isolated: pts.map((p) => p.label), hasShape: false, note: '口子不足 2 个，谈不上形状。' };
  }
  // 去重：同一轮的同一个口子会被前后两遍检测各报一次（本句一遍、"前一句+本句"一遍），
  //   不去重的话"第 3 轮有 7 条口子"里有一半其实是同一条，扎堆的结论就被放大了。
  const uniq = [];
  const seenPt = new Set();
  for (const p of pts) {
    const k = `${p.round}|${p.label}`;
    if (seenPt.has(k)) continue;
    seenPt.add(k);
    uniq.push(p);
  }
  // cover：每个点一个 [round-r, round+r] 的区间
  const iv = uniq.map((p) => ({ ...p, lo: p.round - r, hi: p.round + r }));
  // 一维区间并查集：重叠即合并（注意 lo 会变，用 lo/hi 双端条件）
  const parent = iv.map((_, i) => i);
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[rb] = ra; };
  for (let i = 0; i < iv.length; i++) {
    for (let j = i + 1; j < iv.length; j++) {
      if (iv[j].lo <= iv[i].hi + 1e-9) union(i, j);   // 区间相交
    }
  }
  // bin：并查集分组 → 每组的 [lo,hi] 并（bottle neck 的 cover 区间并）
  const groups = new Map();
  iv.forEach((p, i) => {
    const ri = find(i);
    if (!groups.has(ri)) groups.set(ri, []);
    groups.get(ri).push(p);
  });
  const bins = [...groups.entries()]
    .map(([, members], k) => ({
      id: k,
      span: [Math.min(...members.map((m) => m.round)), Math.max(...members.map((m) => m.round))],
      lo: Math.min(...members.map((m) => m.lo)),
      hi: Math.max(...members.map((m) => m.hi)),
      members: members.map((m) => m.label),
    }))
    .sort((a, b) => (a.lo - b.lo) || (a.members[0].localeCompare(b.members[0])));
  bins.forEach((b, k) => { b.id = k; });
  // nerve 的 1-骨架：两个 cover 集有交集（区间重叠）就连边
  const edges = [];
  for (let a = 0; a < bins.length; a++) {
    for (let b = a + 1; b < bins.length; b++) {
      if (bins[b].lo <= bins[a].hi + 1e-9) {
        edges.push({ a, b, shared: bins[a].members.filter((m) => bins[b].members.includes(m)) });
      }
    }
  }
  const degree = new Map(bins.map((b, i) => [i, 0]));
  for (const e of edges) { degree.set(e.a, degree.get(e.a) + 1); degree.set(e.b, degree.get(e.b) + 1); }
  const hub = [...degree.entries()].sort((x, y) => (y[1] - x[1]) || (x[0] - y[0]))[0];
  return {
    bins, edges,
    //  nerve 的 1-骨架若为树（边数 = 顶点数-1）＝一条链，谈不上有形状；
    //   出现回路（边 ≥ 顶点）才是"互搭成网"。
    hasShape: edges.length >= bins.length,
    cyclic: edges.length >= bins.length,
    hub: hub && hub[1] > 0 ? bins[hub[0]] : null,
    note: '',
  };
}

// Σ 的人话输出——这是 Σ 唯一进用户耳朵的通道。
function describeNerve(nerve) {
  if (!nerve || !nerve.bins || !nerve.bins.length) {
    return { hasShape: false, line: '你的口子还没攒出形状。' };
  }
  const bins = nerve.bins;
  if (bins.length === 1) {
    const b = bins[0];
    // 一个 bin 若横跨两轮以上，那是"连着漏"，不是"一次性翻车"——措辞得分开说，
    //   否则会把"第 3、4 轮都在打转"讲成"第 3 轮翻了一次车"，信息就错了。
    const line = b.span[1] > b.span[0]
      ? `你的口子是**连着漏**的：${b.members.join('·')} 这几条从第 ${b.span[0]} 轮一直拖到第 ${b.span[1]} 轮没解决，是同一口气卡住的。`
      : `你的口子是**一次性翻车**的：${b.members.join('·')} 全挤在第 ${b.span[0]} 轮，之后就没再冒出来。`;
    return { hasShape: true, line };
  }
  const spans = bins.map((b) => `第 ${b.span[0]}~${b.span[1]} 轮的「${b.members.join('·')}」`);
  let line = `你的口子沿时间轴撒成了 ${bins.length} 堆：` + spans.join('，') + '。';
  if (nerve.hub) line += `其中「${nerve.hub.members.join('·')}」这一堆跟你别的堆挨得最近，最容易被带出来。`;
  if (nerve.cyclic) line += '而且这几堆互相搭上了——不是三三两两，是一张网。';
  return { hasShape: true, line };
}

module.exports = {
  MAX_ATTRS, SIGNAL_ORDER,
  buildContext, extentOf, intentOf, closureOf, conceptOf, formalConcepts, analyzeLattice,
  nerveSkeleton, describeNerve,
};
