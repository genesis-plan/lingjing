// geometry.js — 灵境几何算子层（Γ / Φ / β / ⊕）
// --------------------------------------------------------------------------
// 为什么单开一层：docs/09 声称了 15 个算子，但代码里只落了 6 个（信息论熵/EIG、
// 最优停止、粗糙集近似、三态判定、图论中心性、复习动力系统）。剩下 4 个——
// Γ 信息散度、Φ 最优传输、β 持久同调、⊕ 轨迹幺半群——在代码里**一行都没有**。
// 这一层把那 4 个补上。
//
// ★ 共同红线（守 A2「镜子不评分」）：这一层**不产出任何"人做得好不好"的量**。
//   它只描述**形状**：两段话有多远（Γ）、断在哪儿（Φ）、概念怎么缠成一团（β）、
//   你按顺序说过什么（⊕）。所有输出的判词都用 aligned/diverged、hasCycle、
//   breakAt，绝不用 correct/wrong/score。
//
// 全部：纯函数、零副作用、可确定性重放、无外部依赖。
'use strict';

const LN2 = Math.log(2);

// ============ 0. 共用：字符 n-gram 频次 ============
// 中文没有空格，整词切分会让"重写一遍"和"原话"算成完全不重叠（假增益）。
// 用字符 n-gram，跟 questioning.js/estimateGain 同源口径。
function ngramFreq(text, n = 2, cap = 240) {
  const clean = String(text || '').replace(/[\s，。！？；：、""''（）()<>【】「」]/g, '').slice(0, cap);
  const m = new Map();
  if (!clean) return m;
  if (clean.length < n) { m.set(clean, 1); return m; }
  for (let i = 0; i + n <= clean.length; i++) {
    const g = clean.slice(i, i + n);
    m.set(g, (m.get(g) || 0) + 1);
  }
  return m;
}

function sumOf(m) { let s = 0; for (const v of m.values()) s += v; return s || 1; }

// ============ 1. Γ 缺口算子 — 信息散度（守 A2：描述距离，不判对错）============
// 用 Jensen–Shannon 散度而不是 KL：JS 对称（"你离它多远"必须跟方向无关），
// 且恒有限（KL 在不重叠时发散，而人说的和书上说的很可能真不重叠，发散了就没法用）。
//    JS(p‖q) = ½·KL(p‖m) + ½·KL(q‖m)，  m = (p+q)/2，  值域 [0, ln2]
// 诚实注：这是**经验分布**上的散度（把文本当 bag-of-ngram 的直方图），
//   不是统计流形上的 Fisher 信息测度——后者要嵌入才能算，YAGNI。
//
// ★★★ 2026-09-25 自我纠错（重要，别把这段删了）：
//   第一版拿这个散度去判"人这句有没有讲透"，实测立刻翻车：
//     "光合作用发生在叶绿体里，叶绿体是细胞里的一间小工厂。" —— 讲得很到位，
//     却被判 diverged（js=0.56），因为它跟整段教案**用词几乎不重叠**：人换了说法。
//   这跟 teaching.js 里那段被废弃的 overlapScore 是同一个坑（见它的注释）：
//   **词面重合不等于内容到位，方向甚至与直觉相反。**
//   所以这里**只报两件字面事实，不做任何"讲透/没讲透"的判断**：
//     ① distance：两段话的字面距离（描述用，不给阈值判定）；
//     ② missingPhrases：教案里哪几句话你没提到（可审计的字面事实，不推断）。
//   名字也不叫 score，免得后来人拿它当评分用。
function divergence({ utterance = '', reference = '', n = 2 } = {}) {
  const A = ngramFreq(utterance, n);
  const B = ngramFreq(reference, n);
  if (!A.size && !B.size) return { distance: 0, missingPhrases: [], note: '空输入' };

  const keys = new Set([...A.keys(), ...B.keys()]);
  const totalA = sumOf(A), totalB = sumOf(B);
  let js = 0;
  for (const k of keys) {
    const a = (A.get(k) || 0) / totalA;
    const b = (B.get(k) || 0) / totalB;
    const mm = 0.5 * (a + b);
    if (a > 0 && mm > 0) js += 0.5 * a * Math.log(a / mm);
    if (b > 0 && mm > 0) js += 0.5 * b * Math.log(b / mm);
  }
  // 缺了哪一块：**用短语级而不是 n-gram 碎片**。
  //   （第一版直接取"参考里频次高、人话里没有"的字符 2-gram，实测报的是「叶绿」「绿体」
  //    这种半个词的碎片，人读着完全不知道在说什么。改成把参考按标点切句，找人话里整体
  //    没出现的句子——那才是"它那边有、你这边没落到"的东西。）
  const missingPhrases = missingPhrase({ utterance, reference });
  return { distance: Number(js.toFixed(6)), missingPhrases, note: '' };
}

// 参考里按标点切出来的句子，人话里一句都没提到的 → 取前两条，够长才报。
// 短句（"光合作用"这种）信息量太低，报出来像在挑刺，直接略过。
function missingPhrase({ utterance = '', reference = '', minLen = 4, topK = 2, maxLen = 12 } = {}) {
  const u = String(utterance || '');
  const phrases = String(reference || '')
    .split(/[，,。！？；：、\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= minLen);
  const out = [];
  for (const p of phrases) {
    let hit = false;
    for (let i = 0; i + p.length <= u.length && !hit; i++) {
      if (u.slice(i, i + p.length) === p) hit = true;   // 整句在不在（不要求逐字全等，标点已被剥）
    }
    if (!hit) out.push(p.length > maxLen ? p.slice(0, maxLen) : p);
    if (out.length >= topK) break;
  }
  return out;
}

// 把 missing 的碎片 n-gram 拼回能读的词（"能量厂"、"能量"这种要合成一个）
function readableGaps(gaps) {
  const out = [];
  for (const g of gaps || []) {
    const last = out[out.length - 1];
    if (last && g.startsWith(last)) out[out.length - 1] = g;
    else out.push(g);
  }
  return out.slice(0, 2);
}

// ============ 2. Φ 迁移算子 — 断链定位（一维最优传输的受限情形）============
// 诚实交代口径：真正的最优传输解的是**联合分布→边缘分布**的最小搬运代价（Wasserstein）。
// 这里没有分布可运，只有一条**有序**的人话序列；我们沿序列做对齐，找匹配度塌陷的那一段。
// 这是 OT 在一维有序情形下的退化（一维 OT 有闭式解＝分位数配对），
// 而不是完整 OT。用它定位断点够用，别拿它当 OT 论文引用。
function findBreak({ utterance = '', reference = '' } = {}) {
  const u = String(utterance || '').replace(/[\s，。！？；：、""''（）()]/g, '');
  const r = String(reference || '').replace(/[\s，。！？；：、""''（）()]/g, '');
  if (u.length < 6 || r.length < 6) {
    return { onTarget: true, breakAt: -1, head: '', tail: '', note: '太短，无从定位' };
  }
  // 滑窗：每 4 字一块，算块与参考的 2-gram 重叠
  const W = 4;
  const scores = [];
  for (let i = 0; i + W <= u.length; i += W) {
    const chunk = u.slice(i, i + W);
    const g = new Set();
    for (let j = 0; j + 2 <= chunk.length; j++) g.add(chunk.slice(j, j + 2));
    const rg = ngramFreq(r, 2);
    let hit = 0;
    for (const x of g) if (rg.has(x)) hit++;
    scores.push({ at: i, s: g.size ? hit / g.size : 0 });
  }
  // 找最长的一段连续低分（塌陷区）
  let best = { len: 0, start: -1, end: -1 };
  let runStart = 0;
  for (let i = 1; i <= scores.length; i++) {
    const bad = i < scores.length && scores[i].s < 0.25;
    if (!bad) {
      const len = i - runStart;
      if (len > best.len && runStart > 0) best = { len, start: runStart, end: i - 1 };
      runStart = i;
    }
  }
  const breakAt = best.len >= 2 ? scores[best.start].at : -1;
  const onTarget = breakAt < 0;
  if (onTarget) return { onTarget, breakAt, head: u.slice(0, Math.min(12, u.length)), tail: '', note: '' };
  return {
    onTarget: false,
    breakAt,
    head: u.slice(Math.max(0, breakAt - 6), breakAt),
    tail: u.slice(breakAt, breakAt + 8),
    note: '塌陷段长 ' + best.len + ' 块',
  };
}

// ============ 2.5 Φ 升级 — 离散最优传输（Sinkhorn）+ 共现地面代价 ============
// docs/09 §3.3 说"升级到 Wasserstein/EMD 需向量嵌入，非 drop-in"。这句话我们试过，
//   结果**否掉了自己**：一维经验分布的 W1 有闭式解、确实不需要嵌入，但在这个数据粒度上
//   它必然退化成摆设（见下面的踩坑记录）。既然算出来的是个不动的常数，就不该占一个"算子"的名额。
//
// ★★ 真实的出路：Φ 缺的不是"距离公式"，是**地面代价**（把概念 i 搬到概念 j 要花多少）。
//   有了 C_ij，最优传输就是一个线性规划，小规模有确定解——不需要嵌入：
//       W₁(P,Q) = min_{π∈Π(P,Q)} Σ_ij C_ij·π_ij ,     Π 的边际约束为 P、Q
//   我们用 **Sinkhorn–Knopp**（熵正则的迭代缩放）：K = exp(−C/ε)，交替投影到两个边际，
//   小规模（概念数 ≲ 40）迭代百来次即收敛，且**迭代次数写死 → 完全确定性、可重放**。
//   诚实口径：熵正则解不是精确 LP 最优；ε 越小越贴近 LP，但越小也越容易数值溢出。默认 ε=0.05。
//
//    地面代价 C 从哪来？——**从 β 的共现距离来**（同一个 pairs，同一套口径）。
//       C_ij = 1 − shared_ij / maxShared    （与 β 过滤里 d(i,j) 的定义同源）
//    这不是新造一个数：β 说"这几个概念缠得多紧"，Φ 把这份紧度当成搬运成本，
//    于是两者共用同一份可审计的证据。概念之间**没有任何共现记录**时，Φ 拒绝给数字。
//
// 用法：Φ 本职是"概念搬运"。两课（或前后两轮）之间算一次 W1：
//   小＝顺着上一段的说法搬过去的；大＝换了一整片说法，中间那座桥得自己搭。
//
// ❌ 2026-09-25 踩坑记录（删了的东西，别再捡回来）：
//   ① 一版把 n-gram 按**字典序排名**当一维坐标：W1(A,超市水果)=0.009。因为任何文本都是
//      "若干条 n-gram 均匀铺开 0~1"，这个量只测到"你用了多少个不同的片段"，测不到内容。
//   ② 改**原文首字位置**当坐标（pos = 平均首字位置/全文长）：W1(光合作用, 超市水果) = **0**。
//      更要命的是不同主题的两句话，字落点本来就均匀，一维投影把内容全糊掉了。
//   结论：文本在"词面"这一层没有天然的一维坐标；硬造一个是自欺。
//       ⇒ Φ 只在这条路上走通：**以概念为质点、以共现为地面距离**的离散最优传输。
function positionedNgrams(text, n = 2, cap = 240) {
  const clean = String(text || '').replace(/[\s，。！？；：、""''（）()<>【】「】]/g, '').slice(0, cap);
  const acc = new Map();
  if (!clean) return acc;
  if (clean.length < n) { acc.set(clean, { count: 1, pos: 0 }); return acc; }
  for (let i = 0; i + n <= clean.length; i++) {
    const g = clean.slice(i, i + n);
    const e = acc.get(g);
    if (e) { e.count += 1; e.pos += i; }
    else acc.set(g, { count: 1, pos: i });
  }
  return acc;
}

// 一个文本在概念空间里的**质量向量**：它提到了哪些概念、各提了几次（归一到总和 1）。
// 这就是 OT 里的边缘分布 P（或 Q）。
function conceptMass({ lines = [], concepts = [] } = {}) {
  const idx = new Map(concepts.map((c, i) => [String(c).trim(), i]));
  const m = new Float64Array(concepts.length);
  let total = 0;
  for (const l of lines || []) {
    const t = String((l && l.text) || '');
    if (!t) continue;
    for (const [c, i] of idx) if (c && t.includes(c)) { m[i] += 1; total += 1; }
  }
  if (total > 0) for (let i = 0; i < m.length; i++) m[i] /= total;
  return { mass: m, total };
}

// 地面代价矩阵：从共现 pairs 造 C_ij = 1 − shared/maxShared（＝ β 的距离口径）。
// pairs 为空 → 返回 null，并让上层**拒绝出数**（宁可说"算不了"，也不给一个恒定值充数）。
function groundCost({ count = 0, pairs = [] } = {}) {
  const n = count | 0;
  if (n < 2 || !pairs || !pairs.length) return null;
  const maxShared = Math.max(1, ...pairs.map((p) => p.shared || 0));
  const C = Array.from({ length: n }, () => new Float64Array(n));
  for (const p of pairs) {
    const a = p.a, b = p.b, d = 1 - (p.shared || 0) / maxShared;
    if (a >= 0 && a < n && b >= 0 && b < n) { C[a][b] = d; C[b][a] = d; }
  }
  for (let i = 0; i < n; i++) C[i][i] = 0;   // 自搬自＝零成本
  return C;
}

// Sinkhorn–Knopp 迭代缩放：解 min Σ C·π  s.t. 边际为 P、Q（熵正则近似）。
function sinkhorn({ massA = [], massB = [], cost = null, eps = 0.05, iters = 120 } = {}) {
  const n = massA.length, m = massB.length;
  if (!cost || !n || !m) return null;
  let sa = 0, sb = 0;
  for (let i = 0; i < n; i++) sa += massA[i];
  for (let j = 0; j < m; j++) sb += massB[j];
  if (sa <= 0 || sb <= 0) return null;
  const P = Array.from(massA, (v) => v / sa);
  const Q = Array.from(massB, (v) => v / sb);

  const K = Array.from({ length: n }, (_, i) => Float64Array.from({ length: m }, (_, j) => Math.exp(-(cost[i][j] || 0) / eps)));
  const bt = new Float64Array(m).fill(1);
  const rowSum = new Float64Array(n);
  const colSum = new Float64Array(m);
  let a = new Float64Array(n).fill(1);
  const small = 1e-12;
  for (let it = 0; it < (iters | 0); it++) {
    // a_i ← P_i / (K·b)_i
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let j = 0; j < m; j++) s += K[i][j] * bt[j];
      a[i] = s > small ? P[i] / s : 0;
    }
    // b_j ← Q_j / (Kᵀ·a)_j
    for (let j = 0; j < m; j++) {
      let s = 0;
      for (let i = 0; i < n; i++) s += K[i][j] * a[i];
      bt[j] = s > small ? Q[j] / s : 0;
    }
  }
  let w1 = 0;
  for (let i = 0; i < n; i++) {
    rowSum[i] = 0;
    for (let j = 0; j < m; j++) {
      const pi = a[i] * K[i][j] * bt[j];
      w1 += pi * (cost[i][j] || 0);
      rowSum[i] += pi;
    }
    if (!Number.isFinite(rowSum[i])) rowSum[i] = 0;
  }
  for (let j = 0; j < m; j++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += a[i] * K[i][j] * bt[j];
    colSum[j] = s;
  }
  const finite = Number.isFinite(w1);
  return {
    w1: finite ? Number(w1.toFixed(6)) : null,
    // 边际回收检查：解出的 π 的行和应当还原 P（Sinkhorn 的收敛判据）
    massRecovered: P.every((p, i) => Math.abs(rowSum[i] - p) < Math.max(1e-3, p * 0.2)),
    iters: iters | 0, eps,
  };
}

// Φ 的主入口：两段（课 / 轮）之间的**概念搬运成本**。
//   · 质量向量由各自提到的概念频次构成；
//   · 地面代价由共现 pairs 给出；没有 pairs 就返回 null —— 不编数字。
function transportCost({ conceptsA = [], linesA = [], conceptsB = [], linesB = [], pairs = null, count = null, eps = 0.05 } = {}) {
  const ca = Array.isArray(conceptsA) ? conceptsA : [];
  const cb = Array.isArray(conceptsB) ? conceptsB : ca;      // 同一套概念词表才谈得上搬运
  const totA = conceptMass({ lines: linesA, concepts: ca }).total;
  const totB = conceptMass({ lines: linesB, concepts: cb }).total;
  if (!totA || !totB) return { w1: null, note: '有一边没提到任何概念，无从搬运' };
  const cmap = count != null ? count : Math.max(ca.length, cb.length);
  const C = groundCost({ count: cmap, pairs });
  if (!C) return { w1: null, note: '概念之间没有任何共现记录，地面代价无从定义——不给数字' };
  const A = linesA.length ? conceptMass({ lines: linesA, concepts: ca }).mass : null;
  const B = linesB.length ? conceptMass({ lines: linesB, concepts: cb }).mass : null;
  const p = A && A.length ? A : Array.from({ length: cmap }, (_, i) => ca[i] != null ? 1 / ca.length : 0);
  const q = B && B.length ? B : Array.from({ length: cmap }, (_, i) => cb[i] != null ? 1 / cb.length : 0);
  const r = sinkhorn({ massA: p, massB: q, cost: C, eps });
  if (!r || r.w1 == null) return { w1: null, note: '数值发散，拒绝出数' };
  return { ...r, note: '' };
}

// 沿一条轨迹逐段算"这一轮相对上一轮搬了多远"（把每轮看成一个概念质量分布）。
// 只报**跳变**的那几段——每段都报"你搬了"就成了噪音。
function transportAlong({ lines = [], concepts = [], pairs = null, eps = 0.05 } = {}) {
  const src = (lines || []).filter((l) => l && l.text).sort((x, y) => (x.round || 0) - (y.round || 0));
  if (src.length < 2) return { series: [], jumps: [], note: '不足两轮，无从谈搬运', line: '话还不够，谈不上传搬。' };
  const ca = Array.isArray(concepts) ? concepts : [];
  const cmap = ca.length ? ca : [...new Set(src.flatMap((l) => String(l.text).match(/./gu) ? [] : []))];
  // 没有概念词表 → 用所有出现过的概念（从质量向量反推），至少保证两轮可比
  const cset = new Set();
  for (const l of src) for (const c of ca || []) if (c && String(l.text).includes(c)) cset.add(c);
  const vocab = ca.length ? ca : [...cset];
  if (vocab.length < 2) return { series: [], jumps: [], note: '不足两个概念，无从谈搬运' };
  const series = [];
  for (let i = 1; i < src.length; i++) {
    const r = transportCost({
      conceptsA: vocab, linesA: [src[i - 1]],
      conceptsB: vocab, linesB: [src[i]],
      pairs, count: vocab.length, eps,
    });
    series.push({ round: src[i].round, w1: r.w1, note: r.note });
  }
  const ok = series.filter((s) => s.w1 != null);
  // 跳变阈值：绝对基线 0.18 与"本序列最大值的七成"取大者。
  //   纯绝对值不好使——实测同一节课里相邻两轮的搬运成本在 0.10~0.22 之间漂，订死一个数
  //   必然在别的课上失灵；用相对口径（相对这节课自己最远的一次）才跟得上不同课的尺度。
  //   ⚠️ 0.18 / 0.7 都是**经验标定**，不是理论分割点。
  const maxW1 = ok.reduce((m, s) => Math.max(m, s.w1 || 0), 0);
  const thresh = Math.max(0.18, maxW1 * 0.7);
  const jumps = ok.filter((s) => s.w1 >= thresh);
  return {
    series,
    jumps,
    line: jumps.length
      ? (jumps.length === 1
        ? `你的话在第 ${jumps.map((j) => j.round).join('、')} 轮整片换过一次说法——那一段不是从上一段顺着搬过来的，中间那座桥得你自己搭。`
        : `你的话在第 ${jumps.map((j) => j.round).join('、')} 轮连着换了 ${jumps.length} 次说法——这段期间你基本没沿用上一段的概念，每次都是重起炉灶。`)
      : (ok.length ? '你的话前后是顺着搬过来的，没有整片换说法。' : '这一段还看不出搬运，先把话说完。'),
    note: ok.length < series.length ? '有轮次算不出搬运成本（共现信息不足），已跳过' : '',
  };
}

// ============ 3. β 拓扑算子 — 概念同调（Vietoris–Rips 滤）============
// 输入：概念清单 + 两两共享度（同一句话里一起出现的次数）。
//   距离 d(i,j) = 1 - shared / maxShared   （共享越多距离越近）
// 滤：把边按 d 升序一条条放进来（ε 上升），用并查集维护连通分量：
//   · 两端不同分量 → 合并，被并掉的那个 H0 分量**消亡**，death = 这条边的 d
//   · 两端同分量   → 生成一个**环**，birth = 环上最大边权（要环成形，所有边都得已存在）
// ★★ 必须说清的一条：Vietoris–Rips 滤**只有增长、没有分裂**（加边只会合并分量），
//   所以这里的 H1 环一旦成形就不会消亡——在 Rips 滤里它的 death 是 ∞。
//   因此我们不用"寿命 life"衡量一个环，而用**出生半径 birth**（＝环有多紧）。
//   一个 birth 很小的环＝几个概念咬得死紧、分不开。这才是要照给人的东西。
function homology({ concepts = [], pairs = [] } = {}) {
  const n = concepts.length;
  if (n < 3) return { clusters: [], cycles: [], note: '概念不足 3 个，无同调可言' };

  const maxShared = Math.max(1, ...pairs.map((p) => p.shared || 0));
  const edges = pairs
    .filter((p) => p.shared > 0)
    .map((p) => ({
      a: p.a, b: p.b,
      d: Number((1 - (p.shared || 0) / maxShared).toFixed(6)),
      shared: p.shared,
    }))
    .sort((x, y) => (x.d - y.d) || (x.a - y.a) || (x.b - y.b));   // 全序 → 可重放

  const parent = [...Array(n).keys()];
  const members = new Map();
  for (let i = 0; i < n; i++) members.set(i, new Set([i]));
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };

  const clusters = [];
  const cycles = [];
  // MST 邻接（只装已进 MST 的边），用于同分量加边时找环；edgeW 记每条 MST 边的距离
  const mstAdj = Array.from({ length: n }, () => []);
  const edgeW = new Map();
  const ekey = (a, b) => (a < b ? a + '|' + b : b + '|' + a);
  const addMstEdge = (a, b, d) => { mstAdj[a].push(b); mstAdj[b].push(a); edgeW.set(ekey(a, b), d); };
  const pathMax = (path) => path.reduce((acc, v, i) => {
    const nxt = path[i + 1];
    return Math.max(acc, nxt != null ? (edgeW.get(ekey(v, nxt)) || 0) : 0);
  }, 0);

  // 在 MST 里找 s→t 路径（规模 < 30，BFS 足够，不必上 LCA）
  const bfsPath = (s, t) => {
    const prev = new Map([[s, null]]);
    const q = [s];
    while (q.length) {
      const x = q.shift();
      if (x === t) break;
      for (const y of mstAdj[x]) if (!prev.has(y)) { prev.set(y, x); q.push(y); }
    }
    if (!prev.has(t)) return null;
    const path = [];
    let cur = t;
    while (cur != null) { path.push(cur); cur = prev.get(cur); }
    return path.reverse();
  };

  for (const e of edges) {
    const ri = find(e.a), rj = find(e.b);
    if (ri === rj) {
      // 两端已同分量 → 这条边闭出一个环。Rips 滤里环要成形得等所有边到位，
      //   所以 birth = 环上最大边权（含这条新边自己）。
      const path = bfsPath(e.a, e.b);
      if (path) {
        const birth = Math.max(pathMax(path), e.d);
        const verts = [...new Set([...path, e.a, e.b])];
        cycles.push({ verts: verts.sort((x, y) => x - y), birth: Number(birth.toFixed(6)) });
        addMstEdge(e.a, e.b, e.d);
      }
    } else {
      // 合并：ri 留下，rj 消亡，消亡时刻 = 这条边的 d
      const rm = members.get(ri), rm2 = members.get(rj);
      for (const v of rm2) { rm.add(v); parent[v] = ri; }
      clusters.push({ verts: [...rm2].sort((x, y) => x - y), death: e.d });
      addMstEdge(e.a, e.b, e.d);
    }
  }
  cycles.sort((x, y) => (x.birth - y.birth) || (x.verts[0] - y.verts[0]));
  return { clusters, cycles, note: '' };
}

// β 的输入构造器：从课堂实录里数"哪几个概念被一起带出来"（共现次数 = 共享度）。
// 共现越多次，在人脑子里的距离越近（d = 1 - shared/maxShared）。
//
// ★ window 为什么必须跨轮次（这是标定时才发现的）：
//   一开始按**单句**统计共现，结果恒为 0 —— 人一句通常只提一个概念，
//   于是 β 在任何课上都不出东西，等于白算。人的思路是流动的、跨句的：
//   "叶绿体" 在前一句抛出，"类囊体" 紧接着接上，这两个在同一条思路里，
//   就该算共现。所以默认把 window=1（本条 + 往前 1 条）放进同一个窗口。
//   这是**产品标定出来的口径**，不是通用最优解；想更宽可自己传 window。
function cooccurrence({ lines = [], concepts = [], window = 1 } = {}) {
  const idx = new Map(concepts.map((c, i) => [String(c).trim(), i]));
  const acc = new Map();
  const src = (lines || []).map((l) => String((l && l.text) || ''));
  for (let i = 0; i < src.length; i++) {
    const lo = Math.max(0, i - Math.max(0, window));
    const t = src.slice(lo, i + 1).join('');
    const hits = [];
    for (const [c, ix] of idx) if (c && t.includes(c)) hits.push(ix);
    hits.sort((x, y) => x - y);
    for (let a = 0; a < hits.length; a++) {
      for (let b = a + 1; b < hits.length; b++) {
        const k = hits[a] < hits[b] ? hits[a] + '|' + hits[b] : hits[b] + '|' + hits[a];
        acc.set(k, (acc.get(k) || 0) + 1);
      }
    }
  }
  return [...acc.entries()].map(([k, shared]) => {
    const [a, b] = k.split('|').map(Number);
    return { a, b, shared };
  });
}

// 从课堂实录里**自动**提概念（β 用）。
// 为什么需要它：teaching.extractConcepts 按标点切句，薄教案下会把整句当概念
// （"植物用阳光作能量"），而人说话里根本不会命中整句 —— 概念集与实录零交集，
// β 就永远算不出东西。β 要照的是"你话里怎么缠"，所以概念得从**你实际说的话**里长。
//
//
// ⚠️ 2026-09-25：一度写了一套"从实录自动提概念"的启发式（滑窗 n-gram + 虚词表 +
//    碎片归并 + 重叠合并）。跑真课验证后删了，理由记在这里免得以后重蹈：
//    · 滑窗会产出 "一点我不确定"、"体是细胞里的" 这种跨词垃圾；
//    · 同一句话切出的 "光合作用发生" / "作用发生在叶" 等变体互相重叠，归并不干净，
//      结果 β 对着**同一个词自己的几个碎片**报"绕成了一个环"——比没有输出更糟；
//    · 想治好就得引入真正的中文分词器，那是另一个量级的工程，不在这一轮的范围。
// 结论：β 的概念**就用 teaching.extractConcepts 的既有口径**（课前给定或按标点切句），
//   cooccurrence 不关心概念从哪来，将来有人工词表直接传进来即可。
//
// 诚实的产品边界：β 需要 **≥3 个概念、且在你话里成对共现**才谈得上拓扑。
//   薄教案（一句话，切出 2 个"概念"）下它必然没有输出——这是口径，不是失败。
//   实测概念丰富的课（叶绿体/光反应/暗反应/ATP/类囊体…）能稳定报出环，见 tools/test_geometry.mjs。

// 把同调结果说成人话——这是 β 唯一进用户耳朵的通道。
// （不做这一层，同调就只是给测试看出去的数字，人什么也感觉不到。）
function describeShape(shape, concepts = []) {
  const name = (i) => concepts[i] != null ? String(concepts[i]).slice(0, 8) : '#' + i;
  const cycles = (shape && shape.cycles) || [];
  if (!cycles.length) {
    return { hasCycle: false, line: '这些点没绕成圈，是摊开的。' };
  }
  const top = cycles[0];
  const list = top.verts.map(name).join('、');
  const tight = top.birth < 0.34 ? '咬得很紧' : top.birth < 0.6 ? '缠得中等' : '勉强连成一片';
  return {
    hasCycle: true,
    line: `${list} 这几个是绕成一圈的：${tight}，圈起来之后谁也拆不开谁，可圈里没有落地的那一头。`,
    tight,
  };
}

// ============ 4. ⊕ 轨迹算子 — 自由幺半群（append-only，顺序有义）============
// 人按顺序说过的话构成 Σ* 里的一个词 w₁·w₂·…·wₙ。
// ★ 关键性质：**不可交换**——先说 A 再说 B ≠ 先说 B 再说 A；顺序本身是信息。
//   所以回放必须**严格保序**，任何"按词频排序"的做法都会丢掉信息（那是交换幺半群了）。
// 只增不减（A3）： trajectory() 只接受按 round 递增的追加，不提供删除接口。
function trajectory(lines = []) {
  const seq = (lines || [])
    .filter((l) => l && l.text)
    .slice()
    .sort((a, b) => (a.round || 0) - (b.round || 0))
    .map((l) => ({ round: l.round, speaker: l.speaker || '?', text: String(l.text) }));
  const words = seq.map((s) => s.text);
  // 指纹：保序拼接的确定性哈希（同序同指纹，换序必不同）
  let h = 2166136261;
  for (const w of words) {
    for (let i = 0; i < w.length; i++) { h ^= w.charCodeAt(i); h = Math.imul(h, 16777619); }
    h ^= 0x1f; h = Math.imul(h, 16777619);   // 词间分隔符：不让 "AB" 与 "A|B" 撞车
  }
  return {
    sequence: seq,
    length: words.length,
    fingerprint: (h >>> 0).toString(16).padStart(8, '0'),
    reversible: true,   // 严格保序，可原样回放
  };
}

module.exports = {
  ngramFreq, divergence, readableGaps, findBreak,
  // Φ 升级：离散最优传输（Sinkhorn，地面代价＝共现距离）
  conceptMass, groundCost, sinkhorn, transportCost, transportAlong,
  homology, describeShape, cooccurrence,
  trajectory,
  LN2,
};
