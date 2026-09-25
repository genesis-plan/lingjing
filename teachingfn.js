// teachingfn.js — 把「讲授」本身当作一个函数 f，用函数思想照出盲区
// ============================================================================
// 为什么单开一个文件（不塞进 function.js）：
//   function.js 处理的是【概念 → 概念】的对应法则（教材里的抽象法则）；
//   本文件处理的是【探测 → 你的回答】——真实课堂产生的数据。数据形状不同，
//   但用的是同一套函数思想，并且【直接复用】function.js 已实现并测过的
//   invertibility（反函数 ⟺ 双射）与 extensionalEquality（funext）。
//   这两个算子此前一直"已实现未接线"，因为缺一个干净的函数对象；
//   问答对天然就是干净的函数（每个探测点对应一次回答），这里是它们唯一
//   能诚实接线的地方——不臆造、不失真。
//
// ── 核心洞察（决定了本文件为什么这样设计）──────────────────────────────
//   函数 ⊂ 映射，多出来的那一份是【值域落在数集上】。但 A2 禁的是评分，
//   不是计数。轮次 / 次数 / 条数是事实（不是评价）。所以本文件所有"量"
//   一律是计数或集合，绝不产出分数、比率、掌握度。
//
// ⚠️ 诚实边界（不虚报）：
//   • 回答的"取值"用【回答文本触及的概念集合】近似（无权重、无嵌入、可解释）。
//     这是近似，不是语义相似度；有 LLM 时可换语义判定，当前无 key 就用词面。
//   • 按【概念】归拢探测，不区分探测角度（type）。因此"从不同角度问同一个
//     概念、回答自然不同"被单独识别为 anglesDiffer，**不算缺陷**——
//     只有【同一角度两次答得不一样】才判为真·非单值。
//   • 回答没触及任何要点时 sig 为空，空签名【不参与】碰撞判定（否则会误判
//     所有空回答互相碰撞）。
//   • 本文件【不评分】（守 A2）。只说"可逆/不可逆""有界/未讲边界""缺哪种表示"。
// ============================================================================

'use strict';

const fnc = require('./function.js');

/** 回答触及的概念集合 → 稳定签名（排序后 join，规避插入顺序影响） */
function sigOf(text, concepts) {
  if (!text) return '';
  return concepts.filter((c) => text.indexOf(c) >= 0).sort().join('|');
}

/**
 * ① 讲授 = 一个函数 f：概念 ↦ 你的回答（的要点签名）
 *
 *   定义域 dom f = 被问到且你给了回答的概念
 *   值域   im f  = 这些回答触及的要点签名
 *
 *   于是三个函数性质都有了产品语义：
 *     非单值（同一角度两次答得不一样）⇒ 你的理解还不是个稳定的映射
 *     多对一（不同的点你给了同一个回答）⇒ 不可逆 ⇒ 回答太笼统、坍缩了
 *     可逆（双射）⇒ 听你答案的人能反推出他该问什么
 *
 * @param {Array<{round:number, ci:?number, type:string, say:string, answer:?string}>} probes
 * @param {Array<string>} concepts
 * @returns {{ok:boolean, reason?:string, domain:Array<string>, map:Object,
 *            codomain:Array<string>, multiValued:Array, anglesDiffer:Array,
 *            emptyAnswers:Array<string>, collisions:Array, ambiguous:Array<string>,
 *            leftInvertible:boolean, injective:boolean,
 *            surjective:null, bijective:null, line:string, note:string}}
 */
function buildAnswerFunction(probes, concepts, opts = {}) {
  const cs = (concepts || []).map(String);
  const ps = Array.isArray(probes) ? probes : [];

  const reject = (reason, line) => ({
    ok: false, reason, domain: [], map: {}, codomain: [], multiValued: [], anglesDiffer: [],
    emptyAnswers: [], collisions: [], ambiguous: [], leftInvertible: false, injective: false,
    surjective: null, bijective: null, line, note: '不编结论。',
  });

  if (!cs.length) return reject('no-concepts', '没有概念表，无从谈函数（诚实拒绝）。');
  const answered = ps.filter((p) => p && p.answer != null && p.ci != null && cs[p.ci] != null);
  if (!answered.length) return reject('no-answered-probe', '这一课还没有"被问到且你给了回答"的探测，回答函数无从构造（诚实拒绝）。');

  // 按概念归拢每次回答
  const byConcept = new Map();
  for (const p of answered) {
    const c = cs[p.ci];
    const sig = sigOf(String(p.answer), cs);
    if (!byConcept.has(c)) byConcept.set(c, []);
    byConcept.get(c).push({ type: p.type || '', sig, round: p.round });
  }

  // 非单值 vs 多角度（两者的性质完全不同，必须分开，不能混为一谈）
  const multiValued = [];
  const anglesDiffer = [];
  const emptyAnswers = [];
  for (const [c, list] of byConcept) {
    const sigs = new Set(list.map((x) => x.sig));
    if (list.some((x) => x.sig === '')) emptyAnswers.push(c);
    if (sigs.size <= 1) continue;                       // 回答一致，无事
    const byType = new Map();
    for (const x of list) {
      if (!byType.has(x.type)) byType.set(x.type, []);
      byType.get(x.type).push(x.sig);
    }
    let conflict = null;
    for (const [t, sl] of byType) {
      if (sl.length >= 2 && new Set(sl).size > 1) { conflict = { type: t, sigs: [...new Set(sl)] }; break; }
    }
    if (conflict) multiValued.push({ concept: c, type: conflict.type, sigs: conflict.sigs });
    else anglesDiffer.push({ concept: c, sigs: [...sigs] });
  }

  // 代表取值：非单值的概念取众数，并在 ambiguous 里点名（诚实：它是有歧义的）
  const map = {};
  const ambiguous = [];
  for (const [c, list] of byConcept) {
    const tally = new Map();
    for (const x of list) tally.set(x.sig, (tally.get(x.sig) || 0) + 1);
    let bestSig = '';
    let bestN = -1;
    for (const [s, n] of tally) if (n > bestN) { bestN = n; bestSig = s; }
    map[c] = bestSig;
    if (list.length >= 2 && new Set(list.map((x) => x.sig)).size > 1) {
      const mv = multiValued.find((m) => m.concept === c);
      if (mv) ambiguous.push(c);
    }
  }

  // 值域 im f（不等于对应域！只作统计展示，绝不拿它当对应域判满射——那会让满射恒真）
  const codomain = [...new Set(Object.values(map).filter((s) => s !== ''))];

  // ── 复用 function.js 已实现并测过的 invertibility 来算坍缩（不重复造轮子）──
  // ⚠️ 关键诚实点：这里【传空对应域】，因为本构造下没有自然的对应域——
  //   f 的取值是"回答触及的要点集合"，不是单一要点，幂集作对应域会让满射变成
  //   永真或永假的无意义判据。若用值域反推对应域，满射会【恒真】——那是假结论。
  //   所以只取 injective（单射）与 collisions，满射/双射一律不判。
  // 判坍缩时【排除空签名】：回答没触及任何要点时不该被算成"互相坍缩"
  // （否则两声"嗯"就会被判成多对一——那是误判，不是发现）
  const invMap = {};
  for (const [c, s] of Object.entries(map)) if (s !== '') invMap[c] = s;
  const inv = fnc.invertibility(invMap, []);

  const collisions = (inv.collisions || []).map((c) => ({ sig: c.output, concepts: c.inputs || [] }));

  // 数学口径：单射 ⟺ 在 im f 上存在【左逆】 f⁻¹∘f = id。
  //   这正是"听你答案的人能不能反推出他该问什么"所需的条件——不需要满射。
  const leftInvertible = !!inv.injective;

  let line;
  if (leftInvertible) {
    line =
      `你的回答**没有互相坍缩**：每个要点你给出的回答都不一样。单射意味着在值域上存在左逆` +
      `（f⁻¹∘f = id）——听你答案的人能唯一反推出是哪个要点在问，也就能反推他该问什么。` +
      `这是"讲清楚了"的一个硬判据。`;
  } else {
    const names = collisions.map((c) => (c.concepts || []).join(' / ')).filter(Boolean).join('；');
    line =
      `你的回答有【坍缩】：几个不同的要点，你给出了触及同样内容的回答` +
      (names ? `（${names}）` : '') +
      `。这是多对一——不存在左逆。听你答案的人没法反推他该问什么，` +
      `因为不同的问题在你这里塌成了同一个答案。`;
  }
  if (multiValued.length) {
    line += ` 另外有 ${multiValued.length} 个要点，你在**同一个角度**上给出了前后不一致的回答` +
      `（${multiValued.map((m) => m.concept).join('、')}）——同一个输入给了不同输出，` +
      `严格说这就不是一个函数：你在这几个点上还没稳定下来。`;
  }

  const note =
    `dom f = ${Object.keys(map).length} 个要点，im f = ${codomain.length} 个取值；` +
    `复用 function.js 的 invertibility 取单射与坍缩。` +
    `**只判单射（⟺左逆存在），不判满射、不称双射**——本构造下无自然对应域，硬造会让满射恒真。` +
    (anglesDiffer.length
      ? ` 另有 ${anglesDiffer.length} 个要点是**不同角度**问的、回答自然不同（${anglesDiffer.map((a) => a.concept).join('、')}），这不算法。`
      : '');

  return {
    ok: true, domain: Object.keys(map), map, codomain, multiValued, anglesDiffer,
    emptyAnswers, collisions, ambiguous,
    leftInvertible, injective: !!inv.injective,
    surjective: null, bijective: null,
    line, note,
  };
}

/**
 * ①′ 跨时段比较：你前半堂和后半堂，是同一个回答函数吗（funext 的应用）
 *   两半各构造一个 map，用 function.js 的 extensionalEquality 比——
 *   不看措辞看取值。这是"你的讲法中途改口了/深化了"的可观测事实。
 * @returns {{ok:boolean, equal:?boolean, sameDomain:boolean, shifts:Array, line:string}}
 */
function answerFunctionShift(probes, concepts, opts = {}) {
  const cs = (concepts || []).map(String);
  const ps = (Array.isArray(probes) ? probes : []).filter((p) => p && p.answer != null && p.ci != null && cs[p.ci] != null);
  const rounds = [...new Set(ps.map((p) => p.round))].filter((r) => r != null).sort((a, b) => a - b);
  if (cs.length === 0 || rounds.length < 2) {
    return { ok: false, equal: null, sameDomain: false, shifts: [], line: '轮次不足两轮，没法比较前后两段（诚实拒绝）。' };
  }
  const mid = rounds[Math.floor(rounds.length / 2)];
  const build = (arr) => {
    const m = {};
    for (const p of arr) {
      const c = cs[p.ci];
      const s = sigOf(String(p.answer), cs);
      if (m[c] == null) m[c] = s;
      else if (m[c] !== s) m[c] = `${m[c]}≠${s}`;   // 同段内不一致：如实记为不等
    }
    return m;
  };
  const f1 = build(ps.filter((p) => p.round < mid));
  const f2 = build(ps.filter((p) => p.round >= mid));
  if (!Object.keys(f1).length || !Object.keys(f2).length) {
    return { ok: false, equal: null, sameDomain: false, shifts: [], line: '前后两段有一段没有回答，无从比较（诚实拒绝）。' };
  }
  const eq = fnc.extensionalEquality(f1, f2);
  const shifts = (eq.disagreements || []).map((d) => ({ concept: d.input, a: d.a, b: d.b }));
  return {
    ok: true,
    equal: !!eq.equal,
    sameDomain: !!eq.sameDomain,
    shifts,
    line: eq.equal
      ? '你前半堂和后半堂，对同一批要点给出的回答是**同一个函数**（取值全同）——你的讲法自始至终没变。'
      : `你前半堂和后半堂对同一批要点给出的回答**不是同一个函数**` +
        (shifts.length ? `（分歧在：${shifts.map((s) => s.concept).join('、')}）` : '') +
        `——按外延相等（funext）看，取值不同就是不同的函数：你讲着讲着深化了，或者改口了。这是事实，不是好坏。`,
  };
}

// 边界表述的词面信号（无 LLM 时的可解释近似）
const BOUND_CUES = [
  '不算', '之外', '超过', '为止', '极限', '不成立', '例外', '边界', '界线',
  '不再', '最多', '至少', '前提是', '条件是', '反例', '到什么份上', '才算', '就不',
];

/**
 * ③ 有界性：你讲清"到什么份上就不算数"了吗
 *   函数有界 = 存在上下界。迁移到讲授 = 你是否为这个概念划出了成立范围。
 *   两条独立证据（都是计数，不是评分）：
 *     (a) 边界型探针（type='bound'）问了几个、你答了几个
 *     (b) 你的话里，提到该概念的那些句子有没有边界表述
 * @param {{concepts:Array<string>, rounds:Array<{round:number,text:string}>, probes:Array}} o
 * @returns {{ok:boolean, bounded:Array<string>, unbounded:Array<string>,
 *            boundAsked:number, boundAnswered:number, line:string, note:string}}
 */
function boundedness(o = {}, opts = {}) {
  const cs = (o.concepts || []).map(String);
  const rounds = Array.isArray(o.rounds) ? o.rounds : [];
  const probes = Array.isArray(o.probes) ? o.probes : [];
  if (!cs.length) {
    return { ok: false, bounded: [], unbounded: [], boundAsked: 0, boundAnswered: 0, line: '没有概念表，无从谈有界（诚实拒绝）。', note: '' };
  }

  // (a) 边界型探针
  const boundProbes = probes.filter((p) => p && p.type === 'bound');
  const boundAsked = boundProbes.length;
  const boundAnswered = boundProbes.filter((p) => p.answer != null).length;

  // (b) 话里的边界表述：按句切分，看提到该概念的句子有没有边界词
  const bounded = [];
  const unbounded = [];
  for (const c of cs) {
    let hit = false;
    for (const r of rounds) {
      const text = String(r.text || '');
      if (text.indexOf(c) < 0) continue;
      for (const sent of text.split(/[。；;！!？?\n]/)) {
        if (sent.indexOf(c) < 0) continue;
        if (BOUND_CUES.some((w) => sent.indexOf(w) >= 0)) { hit = true; break; }
      }
      if (hit) break;
    }
    (hit ? bounded : unbounded).push(c);
  }

  const line =
    `你在 ${bounded.length}/${cs.length} 个要点上讲清了"到什么份上就不算数"（划出了成立范围）；` +
    (unbounded.length ? `还有 ${unbounded.length} 个没讲到边界：${unbounded.join('、')}。` : '全部都划了界。') +
    `此外学生一共抛出 ${boundAsked} 枚**边界型**探测，你回了 ${boundAnswered} 枚——` +
    `没回的那些，就是你自己也还没想清楚界线在哪儿的地方。`;

  const note =
    `判据两条：话里的边界表述（词面信号，无 LLM 时的可解释近似）+ 边界型探针的问答计数。` +
    `全部是计数，不是评分（守 A2）。`;

  return { ok: true, bounded, unbounded, boundAsked, boundAnswered, line, note };
}

// 三种表示的词面信号
const CUE_EXAMPLE = ['比如', '例如', '举例', '比方', '举个', '像是', '举例来说', '打个比方'];
const CUE_TABULAR = ['第一', '第二', '第三', '其一', '其二', '分别', '对应如下', '如下', '一方面', '另一方面', '逐条', '列表'];

/**
 * ② 三种表示互校：解析式（你的定义）/ 图像（你的例子）/ 表格（逐条对应）
 *   函数独有——映射不强调三种表示。缺"表格"这个仲裁者时，定义与例子一旦
 *   冲突（Vinner & Dreyfus：意象 ≠ 定义）就没有能裁决的东西。
 * @param {{definitionText?:string, rounds?:Array<{round:number,text:string}>, conflict?:boolean}} o
 * @returns {{ok:boolean, analytic:number, graphic:number, tabular:number,
 *            missing:Array<string>, line:string, note:string}}
 */
function representations(o = {}, opts = {}) {
  const def = String(o.definitionText || '');
  const rounds = Array.isArray(o.rounds) ? o.rounds : [];
  const texts = rounds.map((r) => String(r.text || ''));
  const all = texts.join('\n');

  const count = (cues, s) => cues.reduce((n, w) => {
    let i = s.indexOf(w);
    let c = 0;
    while (i >= 0) { c++; i = s.indexOf(w, i + 1); }
    return n + c;
  }, 0);

  const analytic = def && /是|定义|指的|即/.test(def) ? 1 : 0;
  const graphic = count(CUE_EXAMPLE, all);
  const tabular = count(CUE_TABULAR, all);

  const missing = [];
  if (!analytic) missing.push('解析式（你自己的定义）');
  if (graphic === 0) missing.push('图像（例子）');
  if (tabular === 0) missing.push('表格（逐条对应）');

  let line =
    `同一个东西有三种表示：解析式（你的定义）、图像（你举的例子）、表格（逐条对应）。` +
    `这一课你用到了 ${3 - missing.length}/3 种` +
    (missing.length ? `，缺 ${missing.join('、')}。` : '，三种都用了。');

  if (tabular === 0) {
    line += o.conflict
      ? ` 而这堂课你的定义和例子宽窄对不上——**缺的正是一个能裁决的"表格"**。试着把你的定义逐条列成"什么对应什么"，列不出来，就说明你其实还没讲清。`
      : ` 表格是三种里最能**定案**的一种：定义说得含糊、例子举得偏了，都得靠逐条对应来落定。`;
  }

  const note = `词面信号统计（无 LLM 时的可解释近似）；计数，不评分（守 A2）。`;
  return { ok: true, analytic, graphic, tabular, missing, line, note };
}

module.exports = { buildAnswerFunction, answerFunctionShift, boundedness, representations, sigOf, BOUND_CUES };
