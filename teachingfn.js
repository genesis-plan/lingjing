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
const { charNgrams } = require('./questioning.js');   // 复用确定性字符 2-gram（柯西内部差的度量基元）

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

// 方向性/符号性判断词（保号性：你给的方向在邻近情形里翻不翻）
// ⚠️ 词面近似（无 LLM 时）：只用多字方向词，且句子须指向本课概念才计入，减少误判。
const SIGN_CUES = [
  '导致', '使得', '必然', '一定', '总是', '所有', '必须', '应该', '优于', '不如',
  '关键', '本质', '根本', '肯定', '决不', '永远', '从来', '凡是', '只有', '对的',
  '错的', '好的', '坏的', '更重要', '更强', '更弱', '注定', '毫无疑问',
];
const SIGN_KEEP_CUES = [
  '除了', '一般', '通常', '往往', '只要', '前提', '情况下仍', '范围', '大多',
  '基本上', '大致', '差不多', '多数', '整体', '一般来说', '宽泛',
];
const SIGN_FLIP_CUES = [
  '反例', '例外', '反过来', '不一定', '并非', '也可能', '有时', '未必',
  '也有不', '不对的时候', '不成立', '并不是', '反过来说',
];

/**
 * ④ 保号性（sign preservation）：你给的"方向/符号判断"，在邻近情形里还保号吗
 *   局部保号性 lim f=A>0 ⇒ 去心邻域内 f>A/2。
 *   迁移到讲授 = 你讲的带符号/方向的断言（X 是对的／必然导致 Y／优于…），
 *   在稍微变体的例子（邻近情形）里，这个方向是否还成立？有没有翻号反例？
 *   两条独立证据（都是计数，不是评分）：
 *     (a) 保号型探针（type='sign'）问了几个、你答了几个
 *     (b) 你的话里，含方向性判断的句子里，有没有给"保持范围"或"翻号反例"
 * @param {{concepts:Array<string>, rounds:Array<{round:number,text:string}>, probes:Array}} o
 * @returns {{ok:boolean, directional:Array, preserved:Array, notPreserved:Array,
 *            signAsked:number, signAnswered:number, line:string, note:string}}
 */
function signPreservation(o = {}, opts = {}) {
  const cs = (o.concepts || []).map(String);
  const rounds = Array.isArray(o.rounds) ? o.rounds : [];
  const probes = Array.isArray(o.probes) ? o.probes : [];
  if (!cs.length) {
    return { ok: false, directional: [], preserved: [], notPreserved: [], signAsked: 0, signAnswered: 0, line: '没有概念表，无从谈保号（诚实拒绝）。', note: '' };
  }

  const signProbes = probes.filter((p) => p && p.type === 'sign');
  const signAsked = signProbes.length;
  const signAnswered = signProbes.filter((p) => p.answer != null).length;

  // 扫你话里的"带符号断言"句子：含方向性判断词、且提到某个概念
  const directional = [];
  const notPreserved = [];
  for (const r of rounds) {
    const text = String(r.text || '');
    for (const sent of text.split(/[。；;！!？?\n]/)) {
      const s = sent.trim();
      if (s.length < 6) continue;
      if (!SIGN_CUES.some((w) => s.indexOf(w) >= 0)) continue;
      const mention = cs.find((c) => s.indexOf(c) >= 0);
      if (!mention) continue;                         // 方向判断没指到本课概念，不计入
      const kept = SIGN_KEEP_CUES.some((w) => s.indexOf(w) >= 0);
      const flipped = SIGN_FLIP_CUES.some((w) => s.indexOf(w) >= 0);
      const rec = { concept: mention, sentence: s.slice(0, 40) };
      directional.push(rec);
      if (!kept && !flipped) notPreserved.push(rec);   // 只给方向、没保号证据 ⇒ 盲区
    }
  }

  const preserved = directional.filter((d) => !notPreserved.includes(d));
  const line =
    `你在 ${directional.length} 处给了带方向/符号的判断（"对/必然/优于…"）；` +
    (notPreserved.length
      ? `其中 ${notPreserved.length} 处只说了方向、没给"在哪些邻近情形仍成立"、也没举翻号的反例——` +
        `这正是不严格之处：就像保号性要求极限的符号在邻域里保持，你这个判断的方向，在稍微变一下的例子里还成立吗？`
      : '都给了保持范围或翻号检验（保了号）。') +
    `此外学生一共抛出 ${signAsked} 枚**保号型**探测，你回了 ${signAnswered} 枚——` +
    `没回的，就是你还没想清楚"方向在邻近情形里翻不翻"的地方。`;

  const note =
    `判据两条：话里的方向性判断（词面信号，无 LLM 时的可解释近似）+ 保号型探针的问答计数。` +
    `全部是计数，不是评分（守 A2）。数学根：局部保号性 lim f=A>0 ⇒ 去心邻域内 f>A/2；` +
    `与 Heine 结合——若某条趋近路径上方向翻了，则"收敛到该方向"不成立（极限不存在的判据）；` +
    `与 galois 闭包结合——翻号的实例即闭包里没保号的元素，正是盲区实体。`;

  return { ok: true, directional, preserved, notPreserved, signAsked, signAnswered, line, note };
}

// 阶比较词（无穷小/无穷大的"谁比谁小"——O/o/∼ 偏序，正好落进 FCA 概念格）
// ⚠️ 词面近似（无 LLM 时）：用较具体的阶比较词，且句子须指向本课概念才计入，减少误判。
const ORDER_CUES = [
  '高阶', '低阶', '同阶', '等价无穷小', '等价', '主部', '可忽略', '忽略不计', '数量级',
  '远大于', '渐近', '趋于零比', '比.*小得多', '比.*大得多',
];
// 锚定极限过程（保持范围）：阶比较必须相对于"朝哪趋、趋到哪"才成立
const ORDER_KEEP_CUES = [
  '当.*趋', '趋近于', '足够大', '足够小', '当x', '当n', '前提', '条件下', '如果', '一般',
  '通常', '除了', '取决于', '具体', '视', '范围', '趋于无穷', '趋于0', '趋于零',
];
// 翻号/反例信号（换了趋近方向，阶关系可能反过来）
const ORDER_FLIP_CUES = [
  '反例', '例外', '反过来', '不一定', '并非', '也可能', '有时', '未必', '不成立', '并不是', '反过来说', '视情况',
];

/**
 * ⑤ 阶比较（order comparison）：你做的"谁比谁小/高阶/等价"判断，锚定极限过程了吗
 *   无穷小/无穷大的阶（O/o/∼）本来就是个偏序，且必须相对于"朝哪个极限过程趋近"才有意义。
 *   迁移到讲授 = 你讲"X 比 Y 高阶/可忽略/等价于 Y"时，有没有指明这是在朝哪个点、哪种趋近下成立；
 *   有没有澄清"等价 ≠ 相等"（f∼g 是 lim f/g=1，不是 f=g，这是无穷小最经典的认知误区之一）。
 *   两条独立证据（都是计数，不是评分）：
 *     (a) 阶比型探针（type='order'）问了几个、你答了几个
 *     (b) 你的话里，含阶比较判断的句子，有没有锚定极限过程、有没有澄清"等价≠相等"
 * @param {{concepts:Array<string>, rounds:Array<{round:number,text:string}>, probes:Array}} o
 * @returns {{ok:boolean, comparison:Array, anchored:Array, notAnchored:Array,
 *            equivalenceTrap:Array, orderAsked:number, orderAnswered:number, line:string, note:string}}
 */
function orderComparison(o = {}, opts = {}) {
  const cs = (o.concepts || []).map(String);
  const rounds = Array.isArray(o.rounds) ? o.rounds : [];
  const probes = Array.isArray(o.probes) ? o.probes : [];
  if (!cs.length) {
    return { ok: false, comparison: [], anchored: [], notAnchored: [], equivalenceTrap: [], orderAsked: 0, orderAnswered: 0, line: '没有概念表，无从谈阶比较（诚实拒绝）。', note: '' };
  }

  const orderProbes = probes.filter((p) => p && p.type === 'order');
  const orderAsked = orderProbes.length;
  const orderAnswered = orderProbes.filter((p) => p.answer != null).length;

  // 扫你话里的"阶比较判断"句子：含阶比较词、且提到某个概念
  const comparison = [];
  const notAnchored = [];
  const equivalenceTrap = [];
  for (const r of rounds) {
    const text = String(r.text || '');
    for (const sent of text.split(/[。；;！!？?\n]/)) {
      const s = sent.trim();
      if (s.length < 8) continue;
      if (!ORDER_CUES.some((w) => new RegExp(w).test(s))) continue;
      const mention = cs.find((c) => s.indexOf(c) >= 0);
      if (!mention) continue;                         // 阶判断没指到本课概念，不计入
      const anchored = ORDER_KEEP_CUES.some((w) => new RegExp(w).test(s));
      const flipped = ORDER_FLIP_CUES.some((w) => s.indexOf(w) >= 0);
      const rec = { concept: mention, sentence: s.slice(0, 40) };
      comparison.push(rec);
      // 等价陷阱：说了"等价"却没澄清"不等于/只是极限为1/近似"
      if (/等价/.test(s) && !/(不等于|不是等于|约等于|近似|趋于1|极限为1|只是|并非相等)/.test(s)) {
        equivalenceTrap.push(rec);
      }
      if (!anchored && !flipped) notAnchored.push(rec);   // 只给阶判断、没锚定过程 ⇒ 盲区
    }
  }

  const anchoredCount = comparison.filter((d) => !notAnchored.includes(d)).length;
  const line =
    `你在 ${comparison.length} 处做了阶比较（"高阶/低阶/等价/可忽略…"）；` +
    (notAnchored.length
      ? `其中 ${notAnchored.length} 处只说了谁比谁小/大、**没指明这是在朝哪个点、哪种趋近下才成立**——` +
        `阶比较是相对于极限过程的，不锚定就含糊：就像说"高阶无穷小可忽略"，得说清是朝哪趋近时才忽略。`
      : '都锚定了极限过程或给了翻例（保了锚）。') +
    (equivalenceTrap.length
      ? `另外有 ${equivalenceTrap.length} 处提到"等价"却没澄清"等价≠相等"（f∼g 是 lim f/g=1，不是 f=g）——` +
        `这正是无穷小里最经典的一个误区。`
      : '') +
    `此外学生一共抛出 ${orderAsked} 枚**阶比型**探测，你回了 ${orderAnswered} 枚——` +
    `没回的，就是你还没讲清"这个阶关系在什么过程下才成立"的地方。`;

  const note =
    `判据两条：话里的阶比较判断（词面信号，无 LLM 时的可解释近似）+ 阶比型探针的问答计数。` +
    `全部是计数，不是评分（守 A2）。数学根：阶 O/o/∼ 是偏序（Hardy 1910 / Landau 1909），` +
    `且必须相对于极限过程才有意义；"等价"f∼g=lim f/g=1 但 f≠g（Oehrtman 2009 的 0.999… 误区同源）；` +
    `与 galois 结合——阶=概念格里的一条偏序边，高阶/等价即节点间的序关系，正好落进我们已落地的 FCA。`;

  return { ok: true, comparison, anchored: comparison.filter((d) => !notAnchored.includes(d) && !equivalenceTrap.includes(d)), notAnchored, equivalenceTrap, orderAsked, orderAnswered, line, note };
}

// 极限运算法则前提（law premise）：你做极限运算时，先确认"各子极限存在且有限、分母≠0、连续点、根下符号"了吗
// ⚠️ 词面近似（无 LLM 时）：用较具体的运算/套公式词，且句子须指向本课概念才计入，减少误判。
const LAW_CUES = [
  '求极限', '代入', '运算法则', '四则', '用公式', '极限等于', '直接算', '未定式', '洛必达',
  '拆开', '分别求', '用法则', '算出', 'lim', '趋近', '合并', '有理化',
];
// 前提确认信号（各子极限存在且有限 / 分母≠0 / 连续点 / 根下符号 / 未定式须单独处理）
const LAW_KEEP_CUES = [
  '前提', '存在', '有限', '连续', '分母不为0', '分母≠0', '不等于0', '未定式', '不能直接',
  '先确定', '在.*连续', '各.*极限', '前提条件', '成立条件', '有定义', '根下',
];
// 典型误区（缺前提仍套四则：∞−∞=0、0/0=0、∞/∞=1、1^∞=1、根下负数开方）
// ⚠️ 误区句式独立于"是否显式做运算"扫描——只要句子踩了误区等式/根下负数，即捕获（认知上的误套四则）。
const LAW_TRAP_CUES = [
  '∞\\D{0,2}∞\\s*=\\s*0',                  // ∞−∞=0 / ∞-∞=0（误区）
  '0\\s*/\\s*0\\s*=\\s*0',                 // 0/0=0（误区）
  '∞\\s*/\\s*∞\\s*=\\s*1',                 // ∞/∞=1（误区）
  '1\\s*[的^]\\s*∞|1\\s*\\^\\s*∞\\s*=\\s*1', // 1^∞=1（误区）
  '根[号]?\\s*下?\\s*负数|负数\\s*开方',       // 根下负数开方（推论2 符号前提失误）
];

/**
 * ⑥ 极限运算法则前提（law premise）：你做极限运算时，先确认法则的前提了吗
 *   极限运算法则（四则+幂+根+复合）的前提是"每个参与运算的子极限都存在且为有限实数"，
 *   且商的法则分母极限≠0、复合法则要求内极限在外函数连续点、根法则要求根下符号合规。
 *   迁移到讲授 = 你算/讲极限时，有没有先确认"各子极限存在有限、分母≠0、连续点、根下符号"，
 *   有没有识别未定式（0/0、∞/∞、∞−∞、0·∞、1^∞、∞^0、0^0）、有没有在前提缺失时误套四则。
 *   两条独立证据（都是计数，不是评分）：
 *     (a) 法则前提型探针（type='law'）问了几个、你答了几个
 *     (b) 你的话里，含极限运算的句子，有没有确认前提、有没有踩未定式误区
 * @param {{concepts:Array<string>, rounds:Array<{round:number,text:string}>, probes:Array}} o
 * @returns {{ok:boolean, applied:Array, premiseChecked:Array, premiseMissing:Array,
 *            indeterminacyTrap:Array, lawAsked:number, lawAnswered:number, line:string, note:string}}
 */
function lawPremise(o = {}, opts = {}) {
  const cs = (o.concepts || []).map(String);
  const rounds = Array.isArray(o.rounds) ? o.rounds : [];
  const probes = Array.isArray(o.probes) ? o.probes : [];
  if (!cs.length) {
    return { ok: false, applied: [], premiseChecked: [], premiseMissing: [], indeterminacyTrap: [], lawAsked: 0, lawAnswered: 0, line: '没有概念表，无从谈法则前提（诚实拒绝）。', note: '' };
  }

  const lawProbes = probes.filter((p) => p && p.type === 'law');
  const lawAsked = lawProbes.length;
  const lawAnswered = lawProbes.filter((p) => p.answer != null).length;

  // 扫你话里的句子（须指到本课概念）：
  //   · 未定式误区优先单独捕获（不论是否显式"做运算"）——踩了误区等式/根下负数即记；
  //   · 其余"做了极限运算"的句子，才判是否确认了法则前提。
  const applied = [];
  const premiseMissing = [];
  const indeterminacyTrap = [];
  for (const r of rounds) {
    const text = String(r.text || '');
    for (const sent of text.split(/[。；;！!？?\n]/)) {
      const s = sent.trim();
      if (s.length < 6) continue;
      const rec = { sentence: s.slice(0, 40) };
      // ① 未定式误区：独立扫描，优先捕获（不论是否指到本课概念——误区即误套四则的证据）
      const trapped = LAW_TRAP_CUES.some((w) => new RegExp(w).test(s));
      if (trapped) { indeterminacyTrap.push({ concept: '(通用误区)', ...rec }); continue; }
      // ② 做了极限运算（含运算词）才判前提缺失；须指到本课概念才计入盲区
      const mention = cs.find((c) => s.indexOf(c) >= 0);
      if (!mention) continue;                         // 没指到本课概念，不计入盲区
      const didApply = LAW_CUES.some((w) => s.indexOf(w) >= 0);
      if (!didApply) continue;                         // 没做运算表述，不计入盲区
      applied.push({ concept: mention, ...rec });
      const kept = LAW_KEEP_CUES.some((w) => new RegExp(w).test(s));
      if (!kept) premiseMissing.push({ concept: mention, ...rec }); // 只套公式、没确认前提 ⇒ 盲区
    }
  }

  const line =
    `你在 ${applied.length} 处做了极限运算（代入/拆/套四则/洛必达…）；` +
    (premiseMissing.length
      ? `其中 ${premiseMissing.length} 处只套了公式、**没先确认法则前提**——各子极限是否都存在且有限？分母极限是不是 ≠0（商的法则）？内极限是不是在外函数连续点（复合法则）？` +
        `极限运算法则只在"每个子极限存在且为有限实数"时才成立，∞ 不是有限实数，lim f=∞ 时 lim(f−g) 不能写成 ∞−∞。`
      : '都先确认了法则前提或识别了未定式（守了前提）。') +
    (indeterminacyTrap.length
      ? `另外有 ${indeterminacyTrap.length} 处踩了未定式误区（如 ∞−∞=0、0/0=0、1^∞=1、根下负数开方）——未定式必须单独处理（洛必达/等价无穷小/泰勒），不能直接套四则。`
      : '') +
    `此外学生一共抛出 ${lawAsked} 枚**法则前提型**探测，你回了 ${lawAnswered} 枚——` +
    `没回的，就是你还没讲清"这一处运算的法则前提成不成立"的地方。`;

  const note =
    `判据两条：话里的极限运算表述（词面信号，无 LLM 时的可解释近似）+ 法则前提型探针的问答计数。` +
    `全部是计数，不是评分（守 A2）。数学根：极限四则运算法则前提"各子极限存在且有限"` +
    `（Freek Wiedijk 的 HOL LIM_ADD 即要求 limits actually exist；Eberl 的 Isabelle tendsto_intros 要求各子极限收敛+连续性；` +
    `Boldo/Lelay/Melquiond 形式化实分析综述同样以"极限存在+连续"为前提）；` +
    `商的法则分母≠0 = 局部保号性推论（sign 探针已管）；未定式处理 = orderComparison 阶比较（上轮已落）。`;

  return { ok: true, applied, premiseChecked: applied.filter((d) => !premiseMissing.includes(d) && !indeterminacyTrap.includes(d)), premiseMissing, indeterminacyTrap, lawAsked, lawAnswered, line, note };
}

// ── 夹逼准则（squeeze / 迫敛性 / 极限存在准则Ⅰ，2026-09-28 落）────────────────────
// 数学：若在 x→x₀ 的某**去心邻域**内 g(x) ≤ f(x) ≤ h(x) 处处成立，且 lim g = lim h = **同一个 A**，则 lim f = A。
// 三个条件缺一不可，缺哪个就失去哪份力量——这正是探针要照的东西。
// 上界信号（单侧：只有这半边 ⇒ 那是"局部有界"，不是夹逼）
const SQUEEZE_UPPER_CUES = ['不超过', '不大于', '小于等于', '至多', '最多', '上限', '打住', '封顶'];
// 下界信号
const SQUEEZE_LOWER_CUES = ['至少', '不少于', '大于等于', '最少', '下限', '底下', '保底'];
// 双边信号（一句话里同时给上下两个界）
const SQUEEZE_BETWEEN_CUES = ['介于', '夹在', '之间', '中间', '两边', '介于.*和', '在.*范围内', '被.*限制', ' 两者之间'];
// 条件②：两边收敛到**同一个**极限（这是夹逼真正比"有界"多出来的那一份）
const SQUEEZE_SAMELIMIT_CUES = ['同一个', '同样的', '都趋', '都收敛到', '都等于', '都趋于', '两边都', '同一个极限', '一样', '同为', '相等'];
// 条件③：不等式在去心邻域内**处处**成立（不是只在个别点成立）
const SQUEEZE_NBH_CUES = ['足够近', '足够小', '足够大', '足够靠', '去心', '邻域', '附近', '只要.*近', '无论.*多近', '当.*趋近', '当.*接近', '只要.*小'];

/**
 * ⑦ 夹逼准则（squeeze bounds）：你给的范围断言，三个条件齐了吗
 *   迁移到讲授 = 当你断言"X 一定在某个范围里 / 不超过…至少…"时，有没有满足夹逼三条件：
 *     ① 双边（上下界都给）——只有一边那是局部有界性，推不出极限存在（−M 与 M 收敛到不同值，夹不住）；
 *     ② 两边收敛到**同一个 A**——这是夹逼真正比"有界"多出来的那一份，也是最常漏的一条；
 *     ③ 不等式在某个**去心邻域内处处成立**——只在个别点成立不算数。
 *   守 A2：只数"你给了几个范围断言、几个只有一边、几个没确认同极限、几个没说清在哪成立"，不评对错。
 * @param {{concepts:Array<string>, rounds:Array<{round:number,text:string}>, probes:Array}} o
 * @returns {{ok:boolean, bounds:Array, oneSideOnly:Array, sameLimitMissing:Array, notPunctured:Array,
 *            squeezeAsked:number, squeezeAnswered:number, line:string, note:string}}
 */
function squeezeBounds(o = {}, opts = {}) {
  const cs = (o.concepts || []).map(String);
  const rounds = Array.isArray(o.rounds) ? o.rounds : [];
  const probes = Array.isArray(o.probes) ? o.probes : [];
  if (!cs.length) {
    return { ok: false, bounds: [], oneSideOnly: [], sameLimitMissing: [], notPunctured: [], squeezeAsked: 0, squeezeAnswered: 0, line: '没有概念表，无从谈夹逼（诚实拒绝）。', note: '' };
  }

  const sqProbes = probes.filter((p) => p && p.type === 'squeeze');
  const squeezeAsked = sqProbes.length;
  const squeezeAnswered = sqProbes.filter((p) => p.answer != null).length;

  const bounds = [];
  const oneSideOnly = [];
  const sameLimitMissing = [];
  const notPunctured = [];
  for (const r of rounds) {
    const text = String(r.text || '');
    for (const sent of text.split(/[。；;！!？?\n]/)) {
      const s = sent.trim();
      if (s.length < 6) continue;
      const mention = cs.find((c) => s.indexOf(c) >= 0);
      if (!mention) continue;                        // 范围断言没指到本课概念，不计入
      const isUpper = SQUEEZE_UPPER_CUES.some((w) => s.indexOf(w) >= 0);
      const isLower = SQUEEZE_LOWER_CUES.some((w) => s.indexOf(w) >= 0);
      const isBetween = SQUEEZE_BETWEEN_CUES.some((w) => new RegExp(w).test(s));
      if (!isUpper && !isLower && !isBetween) continue;   // 不是范围断言
      const rec = { concept: mention, sentence: s.slice(0, 40) };
      bounds.push(rec);
      // ① 双边：一句话同时有上下界，或明说"介于/夹在…之间"
      const twoSided = isBetween || (isUpper && isLower);
      if (!twoSided) { oneSideOnly.push(rec); continue; } // 只有一边 ⇒ 那是局部有界，夹不住
      // ② 两边同极限（没确认 ⇒ 盲区）
      if (!SQUEEZE_SAMELIMIT_CUES.some((w) => s.indexOf(w) >= 0)) sameLimitMissing.push(rec);
      // ③ 在去心邻域内处处成立（没说清在哪成立 ⇒ 盲区）
      if (!SQUEEZE_NBH_CUES.some((w) => new RegExp(w).test(s))) notPunctured.push(rec);
    }
  }

  const line =
    `你在 ${bounds.length} 处给出了范围断言（不超过…／至少…／介于…之间）；` +
    (oneSideOnly.length
      ? `其中 ${oneSideOnly.length} 处**只给了一边**（只有上界或只有下界）——那是局部有界性，推不出极限存在：` +
        `\`-M ≤ f ≤ M\` 的两边收敛到 \`-M\` 和 \`M\`，不是同一个值，夹不住。`
      : '双边都给到了（两边都有的范围断言）。') +
    (sameLimitMissing.length
      ? `${sameLimitMissing.length} 处没确认**两边收敛到同一个极限**——这是夹逼真正比"有界"多出来的那一份，也是最常漏的一条。`
      : '') +
    (notPunctured.length
      ? `${notPunctured.length} 处没说清这个不等式**在哪个去心邻域内处处成立**——只在个别点成立不算数。`
      : '') +
    `此外学生一共抛出 ${squeezeAsked} 枚**夹逼型**探测，你回了 ${squeezeAnswered} 枚——` +
    `没回的，就是你还没讲清"这两个界是不是夹到同一个地方"的地方。`;

  const note =
    `判据两条：话里的范围断言（词面信号，无 LLM 时的可解释近似）+ 夹逼型探针的问答计数。全部是计数，不是评分（守 A2）。` +
    `数学根：极限存在准则Ⅰ（夹逼/迫敛性）——去心邻域内 g≤f≤h 处处成立且 lim g = lim h = 同一个 A ⇒ lim f = A，三条件缺一不可。` +
    `与已有算子咬合：**局部有界性**（boundedness）＝只夹一边的弱化版，故推不出极限存在；**保号性**（signPreservation）正是夹逼的推论——` +
    `lim f=A>0 取 ε=A/2 即把 f 夹在 A/2 与 3A/2 之间，所以"保号"其实是"用两个常数界夹逼"的一个特例。`;

  return { ok: true, bounds, oneSideOnly, sameLimitMissing, notPunctured, squeezeAsked, squeezeAnswered, line, note };
}

// ── 柯西极限存在准则（Cauchy / 极限存在准则Ⅱ，2026-09-28 落）──────────────────────
// 数学：lim_{x→x₀} f(x) 存在 ⟺ ∀ε>0 ∃δ>0，凡 0<|x'−x₀|<δ 且 0<|x''−x₀|<δ 者，恒有 |f(x')−f(x'')|<ε。
// 关键：**不需要预先知道极限值 A** —— 只凭"足够近的两点，函数值之差任意小"就判定极限存在。
// 这在本产品里有一个精确的产品学对应：A2 禁的是"评分"，而柯西判据恰好只判定"是否存在"、不给出"极限是什么"。

/**
 * ⑧ 柯西内部差判据（cauchy convergence）：不看目标，只看你的表述之间差得越来越小了吗
 *   这是整套框架里**唯一一条不预设终点**的判据，也是与 A2 红线在数学上精确对应的那一条。
 *   做法：相邻轮次的字符 2-gram 集合算 Jaccard 距离 ⇒ 一串"内部差" gaps；
 *         gaps 单调收缩且末值足够小 ⇒ contracting（柯西意义上：极限存在）；
 *         否则 open（还在张开/振荡，判不出存在）。
 *   ⚠️ 诚实边界（必须写死）：柯西只证"存在"，不告诉你极限是什么——这里也有两层同构：
 *     ① 词面距离是对"语义差"的可解释近似（无 LLM 时），不是语义本身；
 *     ② 重复自己也会给出很小的距离，那是"卡住了"不是"收敛了"——所以本判据只报"在收拢/还在张开"，
 *        绝不报"你达到了某某理解水平"（那才是评分）。
 * @param {{concepts:Array<string>, rounds:Array<{round:number,text:string}>, probes:Array}} o
 * @param {{eps?:number, tolerance?:number}} [opts] eps=末值阈值，tolerance=单调判定容差
 * @returns {{ok:boolean, gaps:Array<number>, internalConvergence:string, contracting:boolean,
 *            cauchyAsked:number, cauchyAnswered:number, line:string, note:string}}
 */
function cauchyConvergence(o = {}, opts = {}) {
  const cs = (o.concepts || []).map(String);
  const probes = Array.isArray(o.probes) ? o.probes : [];
  const rounds = Array.isArray(o.rounds) ? o.rounds : [];
  const fail = (line) => ({ ok: false, gaps: [], internalConvergence: 'undecidable', contracting: false, cauchyAsked: probes.filter((p) => p && p.type === 'cauchy').length, cauchyAnswered: probes.filter((p) => p && p.type === 'cauchy' && p.answer != null).length, line, note: '' });
  if (!cs.length) return fail('没有概念表，无从谈内部差（诚实拒绝）。');

  const texts = rounds.map((r) => String(r.text || '').trim()).filter(Boolean);
  if (texts.length < 2) return fail('不足两轮，无从谈"两点之差"——柯西判据比较的是两点的距离，一轮给不出距离（诚实拒绝）。');

  const cauchyProbes = probes.filter((p) => p && p.type === 'cauchy');
  const cauchyAsked = cauchyProbes.length;
  const cauchyAnswered = cauchyProbes.filter((p) => p.answer != null).length;

  // 相邻轮次的 Jaccard 距离 = 内部差 |f(x')−f(x'')| 的可观测代理
  const gaps = [];
  for (let i = 1; i < texts.length; i++) {
    const A = charNgrams(texts[i - 1]);
    const B = charNgrams(texts[i]);
    let inter = 0;
    A.forEach((g) => { if (B.has(g)) inter++; });
    const uni = new Set([...A, ...B]).size;
    gaps.push(uni ? +(1 - inter / uni).toFixed(4) : 0);
  }

  const eps = opts.eps != null ? opts.eps : 0.45;         // ε：末值要多小才算"差得任意小"
  const tolerance = opts.tolerance != null ? opts.tolerance : 0.05; // 单调判定的容差（允许微小回弹）
  const stationaryEps = opts.stationaryEps != null ? opts.stationaryEps : 0.10; // 退化阈值：从未真正差过
  const monotoneContracting = gaps.every((g, i) => i === 0 || g <= gaps[i - 1] + tolerance);
  const tailSmall = gaps[gaps.length - 1] < eps;
  // 退化态：从头到尾几乎没差过（常数列）。数学上它确实收敛，但那是"没往前走"，
  //   若把它报成"你在收拢"就是虚报——故单列 stationary，照实说"这只是重复"。
  const stationary = gaps.every((g) => g < stationaryEps);
  const contracting = monotoneContracting && tailSmall && !stationary;
  const internalConvergence = stationary ? 'stationary' : (contracting ? 'contracting' : 'open');

  const line =
    `你这几轮表述之间的**内部差**是 ${gaps.map((g) => g.toFixed(2)).join(' → ')}（相邻两轮的字面距离，越小越贴近）；` +
    (contracting
      ? `**在收缩**：每一轮比前一轮更贴近上一个说法，且末值已进入 ${eps} 以内——` +
        `按柯西准则，**表述之间存在极限**（你在收拢到一个稳定的说法上）。`
      : stationary
        ? `几乎是**恒定的**：从头到尾没怎么差过（差都 <${stationaryEps}）。数学上常数列也算收敛，` +
          `但镜子不替它粉饰——这只是"没往前走"，不构成"收拢"。要判断有没有真推进，得看别的算子（反例/机制/应用）。`
        : `还在张开或振荡：尚未满足"足够近时差得任意小"——按柯西准则，目前**判不出存在**（不是说你错了，是还收不住）。`) +
    `此外学生一共抛出 ${cauchyAsked} 枚**柯西型**探测，你回了 ${cauchyAnswered} 枚——` +
    `没回的，就是你还没让人看见"你和上一轮的自己差在哪"。`;

  const note =
    `诚实边界三条，写死不可含糊：① 这是**词面**距离，是对"语义差"的可解释近似（无 LLM 时），不是语义本身；` +
    `② 柯西准则只判定**极限存在**，**不给出极限是什么**——本产品因此只报"在收拢/还在张开"，` +
    `绝不报"你达到了某某理解水平"（那才是评分）。这与 A2（镜子不评分）在数学上精确对应：` +
`整套算子里唯一一条**不预设终点**的判据就是它。③ 三态判据：contracting（在收拢）/ open（还在张开或振荡）/` +
`stationary（几乎恒定）——后者数学上常数列确实收敛，但那是"没往前走"，镜子如实标明、不粉饰成收拢。数学根：极限存在准则Ⅱ（Cauchy）——` +
`∀ε>0 ∃δ>0，凡与 x₀ 距离皆小于 δ 的任意两点 x'、x''，恒有 |f(x')−f(x'')|<ε，则极限存在；反之亦然（完备性）。` +
`阈值 eps=${eps} 与 stationaryEps=${stationaryEps} 是按中文相邻表述的字符 2-gram 实测标定的启发式（不是定理）。`;

  return { ok: true, gaps, internalConvergence, contracting, cauchyAsked, cauchyAnswered, line, note };
}

// ════════════════════════════════════════════════════════════════════════
// inductionGap：归纳鸿沟——"我验了 N 个都对"填不上"例子 → 全体"这道缝。
// 数学根（已证的事实，不是猜想）：黎曼猜想经数值验证的零点数以万亿计、无一例外，
// 但它至今仍是猜想。例子支撑的是信心，不是结构。这是学习者第一大误区，
// 也是本产品哲学（A2 不评分、柯西不预设终点）的同族边界。
// 守 A2：只数"你几次把例子当成了证明"，不评判例子举得好不好。
// ════════════════════════════════════════════════════════════════════════

// 例子动作词：做了一次次"个例验证"
const GAP_EXAMPLE_CUES = ['试', '验', '检验', '验证', '举例', '带进去', '代入', '算过', '跑了', '测了', '枚举'];
// 归纳推断词：从个例跳到全体（必须是强信号词，避免误报）
const GAP_INFERENCE_CUES = [
  '都成立', '都对', '都符合', '都对得上', '每次都', '回回', '次次',
  '没有反例', '没遇到反例', '没发现反例', '从没错', '从没错过', '不会错', '从没出过错',
  '所以一定', '所以肯定', '必然', '肯定成立', '肯定对', '一定成立', '肯定都对', '总是成立',
];

function inductionGap(o = {}) {
  const rounds = Array.isArray(o.rounds) ? o.rounds : [];
  const probes = Array.isArray(o.probes) ? o.probes : [];
  const cs = (o.concepts || []).map(String);
  const exampleClaims = [];   // 同时踩了"例子动作"与"归纳推断"的句子（归纳鸿沟所在）
  for (const r of rounds) {
    const text = String(r.text || '');
    for (const sent of text.split(/[。；;！!？?\n]/)) {
      const s = sent.trim();
      if (s.length < 6) continue;
      const hasExample = GAP_EXAMPLE_CUES.some((w) => s.indexOf(w) >= 0);
      const hasInference = GAP_INFERENCE_CUES.some((w) => s.indexOf(w) >= 0);
      if (hasExample && hasInference) {
        exampleClaims.push({ concept: cs.find((c) => s.indexOf(c) >= 0) || null, sentence: s.slice(0, 40) });
      }
    }
  }
  const gapAsked = probes.filter((p) => p && p.type === 'gap').length;
  const gapAnswered = probes.filter((p) => p && p.type === 'gap' && p.answer).length;

  const line = exampleClaims.length
    ? `有 ${exampleClaims.length} 处，你从"验过的例子"直接跳到了"所以成立"：` +
      exampleClaims.map((g) => `「${g.sentence}」`).join('、') + `。` +
      `**例子支撑的是信心，不是结构**——黎曼猜想的零点已数以万亿计地逐个验证、无一反例，` +
      `它至今仍是猜想。你的归纳，缺口在哪一步？`
    : `这一段没发现"例子直接当证明"的说法。注意：这是说没有这个**信号**，不是说你的论证都严密了——` +
      `别的缝隙要靠别的算子照。`;

  const note =
    `诚实边界：① 词面信号近似（无 LLM 时的可解释近似），"归纳"没被字面说出时可能漏检；` +
    `② 本算子**不否定举例**——举例是好习惯，被照出的只是"从个例跳到全体"的那一步；` +
    `③ 数学根是"已证的事实"而非猜想本身：万亿级数值验证依然不构成证明，这正是归纳鸿沟的量级示范。`;

  return { ok: true, exampleClaims, gapAsked, gapAnswered, line, note };
}

// ════════════════════════════════════════════════════════════════════════
// continuation：延拓唯一——推广若成立，新旧域的判据必须是同一个。
// 数学根（已证）：解析延拓的恒等定理——同一个解析函数，延拓若存在则必唯一；
// 旧域上取值不同的"两个延拓"不可能同时成立。故"广义的 X"若与 X 的旧判据冲突，
// 那不是延拓，是偷换概念。与 distinct（区分两个东西）不重叠：
// distinct 管"两个东西差在哪"，continuation 管"同一个东西换了地盘还认不认得出"。
// 守 A2：只数"几次延拓、几次锚定了判据"，不评判推广对不对。
// ════════════════════════════════════════════════════════════════════════

// 延拓话语：把概念搬到新地盘
const CONT_EXTENSION_CUES = ['广义', '推广', '扩展到', '延伸到', '一般化', '泛化', '这也算', '也算', '扩充', '放到更一般'];
// 判据锚定词：说清了新旧地盘共用什么判据/条件
const CONT_ANCHOR_CUES = ['判据', '标准', '定义', '条件', '前提', '同样适用', '还是成立', '依然成立', '沿用', '一致', '不变', '只要'];

function continuation(o = {}) {
  const rounds = Array.isArray(o.rounds) ? o.rounds : [];
  const probes = Array.isArray(o.probes) ? o.probes : [];
  const cs = (o.concepts || []).map(String);
  const extendTalks = [];
  const unanchored = [];
  for (const r of rounds) {
    const text = String(r.text || '');
    for (const sent of text.split(/[。；;！!？?\n]/)) {
      const s = sent.trim();
      if (s.length < 6) continue;
      const isExtend = CONT_EXTENSION_CUES.some((w) => s.indexOf(w) >= 0);
      if (!isExtend) continue;
      const mention = cs.find((c) => s.indexOf(c) >= 0) || null;
      const rec = { concept: mention, sentence: s.slice(0, 40) };
      extendTalks.push(rec);
      const anchored = CONT_ANCHOR_CUES.some((w) => s.indexOf(w) >= 0);
      if (!anchored) unanchored.push(rec);   // 推广没说清判据是否沿用 ⇒ 可能是偷换
    }
  }
  const extendAsked = probes.filter((p) => p && p.type === 'extend').length;
  const extendAnswered = probes.filter((p) => p && p.type === 'extend' && p.answer).length;

  const line = extendTalks.length
    ? `有 ${extendTalks.length} 处，你把概念往更大的地盘上搬：` +
      extendTalks.map((g) => `「${g.sentence}」`).join('、') + `。` +
      (unanchored.length
        ? `其中 ${unanchored.length} 处**没说清判据**——解析延拓有一条铁律（恒等定理）：延拓若存在，必唯一，` +
          `新旧地盘的取值必须自洽。判据没沿用，就可能不是推广，是偷换概念。`
        : `而且都锚定了判据（新地盘沿用/说明了什么条件）——这正是延拓合法的样子。`)
    : `这一段没发现"把概念往外推"的说法。等你开始说"广义的/推广的"时，这枚算子才开始工作。`;

  const note =
    `诚实边界：① 词面信号近似，"换个说法的延拓"没带广义/推广字样时会漏检；` +
    `② 锚定词命中只说明"提了条件"，不验证条件真的一致——那是 LLM 层或更细粒度判据的事；` +
    `③ 数学根（已证）：解析延拓的唯一性（恒等定理）——本算子只照"新旧判据是否被说清"，绝不判定推广本身对错（守 A2）。`;

  return { ok: true, extendTalks, anchored: extendTalks.length - unanchored.length, unanchored, extendAsked, extendAnswered, line, note };
}

module.exports = { buildAnswerFunction, answerFunctionShift, boundedness, representations, signPreservation, orderComparison, lawPremise, squeezeBounds, cauchyConvergence, inductionGap, continuation, sigOf, BOUND_CUES };
