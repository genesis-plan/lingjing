// yoneda.js — 米田引理（Yoneda Lemma）落在「镜子」上：关系剖面 = 概念的身份
// ============================================================================
// 数学来源（本轮实查，非记忆）：
//   • Yoneda 引理（Yoneda 1954；Mac Lane《CWM》III.2；nLab `Yoneda lemma`）：
//       对局部小范畴 C、函子 F: C→Set、对象 A：
//           Nat(Hom(-, A), F) ≅ F(A)          （自然同构，且自然于 A 与 F）
//       取 F = Hom(-, B) 得推论：米田嵌入 y: A ↦ Hom(-, A) 【全忠实】，于是
//           y(A) ≅ y(B)  ⟺  A ≅ B
//   • 一句话读法：一个对象，被「所有指向它的态射」唯一决定——物即其关系。
//     （Cayley 定理是它在单对象群范畴上的特例。）
//
// 落到灵境：
//   mapmodel.reach(A) 只算了【出射】那一半（从 A 能到哪 = Hom(A, -) 的支撑集），
//   本模块补上【入射】那一半（谁能到 A = Hom(-, A)），并据全忠实性给出
//   「两个概念在你的讲授里是否可区分」的判据。
//
// ── 一个自己推出来的结论（决定了本模块为什么只有「一跳」）──────────────────
//   在由图生成的自由范畴里，态射 = 路径。设两个概念 A、B 的【一跳带标签出入边】
//   完全相同，则它们的直接后继（连同标签）相同，于是长度 2 的走法相同，
//   归纳得任意长度走法全相同 ⇒ Hom 剖面全同。
//   ⇒ 「多跳半径」不增加任何区分力：一跳剖面已经是这个图上【最强】的可算不变量。
//   所以本模块不做 radius 参数（做了也是摆设，留着就是自欺）。
//   粗粒度的「可达/入射支撑集」判据由 bisim.js 的互模拟商负责，不在这里重复。
//
// ⚠️ 诚实边界（不虚报）：
//   • 一跳剖面相同 ⇒ 在这张图里不可区分；这是【不可区分的证据】，
//     不是 Yoneda 同构的证明（同构要求自然同构，本模块只比对剖面字面值）。
//     返回值 approximate 恒为 true。
//   • 本模块【不评分】（守 A2）。只说「这两个概念在你这张图里没有区别」，
//     不说哪个讲得好/讲得差、不判对错。
// ============================================================================

'use strict';

const DEFAULT_CAP = 256;

/**
 * 归一化输入：接受 mapmodel 实例（concepts()/maps()）或 {concepts, maps}。
 * @returns {{concepts:string[], maps:Array, adj:Object, radj:Object}}
 *          adj 存出边 {to,label}；radj 存入边 {to,label}（to = 原图的 from）
 */
function normalize(src) {
  const empty = { concepts: [], maps: [], adj: {}, radj: {} };
  if (!src) return empty;

  let cs = [];
  let ms = [];
  if (typeof src.concepts === 'function' && typeof src.maps === 'function') {
    cs = (src.concepts() || []).map(String);
    ms = (src.maps() || []).map((m) => ({
      from: String(m.from), to: String(m.to), label: m.label == null ? '' : String(m.label),
    }));
  } else {
    cs = Array.isArray(src.concepts) ? src.concepts.map(String) : [];
    ms = Array.isArray(src.maps)
      ? src.maps.map((m) => ({
          from: String(m.from), to: String(m.to), label: m.label == null ? '' : String(m.label),
        }))
      : [];
  }

  const set = new Set(cs);
  for (const m of ms) { set.add(m.from); set.add(m.to); }   // 端点自动登记为对象

  const adj = {};
  const radj = {};
  for (const c of set) { adj[c] = []; radj[c] = []; }
  for (const m of ms) {
    if (m.from === m.to) continue;                          // 自环对区分度零贡献，跳过
    adj[m.from].push({ to: m.to, label: m.label || '→' });
    radj[m.to].push({ to: m.from, label: m.label || '→' });
  }
  return { concepts: [...set], maps: ms, adj, radj };
}

/** 沿给定邻接表做可达闭包（含起点） */
function closureFrom(adj, start) {
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length) {
    const c = queue.shift();
    for (const e of adj[c] || []) {
      if (!seen.has(e.to)) { seen.add(e.to); queue.push(e.to); }
    }
  }
  return seen;
}

/**
 * 入射可达闭包：所有能走到 A 的概念（含 A 自己）。
 * 这是 Hom(-, A) 在可达性层面的支撑集——米田嵌入 y(A) 的对象侧。
 * @param {Object|{concepts:Array, maps:Array}} src
 * @param {string} target
 * @returns {string[]}
 */
function coReach(src, target) {
  const { radj, concepts } = normalize(src);
  const t = String(target);
  if (!concepts.includes(t)) return [];
  return [...closureFrom(radj, t)];
}

/** 出射可达闭包（与 mapmodel.reach 的 allReached 同源，独立实现以便交叉验证） */
function reachSet(src, start) {
  const { adj, concepts } = normalize(src);
  const s = String(start);
  if (!concepts.includes(s)) return [];
  return [...closureFrom(adj, s)];
}

/**
 * 关系剖面（米田剖面，一跳带标签）。
 *   out：Hom(A, -) 的生成元侧（从 A 出发的直接带标签出边）
 *   in ：Hom(-, A) 的生成元侧（直接指向 A 的带标签入边）
 * 依据见文件头「一跳已是最强」的推导。
 * @param {Object} src
 * @param {string} concept
 * @param {{cap?:number}} opts
 * @returns {{ok:boolean, concept:string, out:Array<{to:string,via:string}>,
 *            in:Array<{from:string,via:string}>, fingerprint:string,
 *            truncated:boolean, approximate:true}}
 */
function profileOf(src, concept, opts = {}) {
  const { adj, radj, concepts } = normalize(src);
  const cap = opts.cap == null ? DEFAULT_CAP : opts.cap;
  const a = String(concept);
  if (!concepts.includes(a)) {
    return {
      ok: false, concept: a, out: [], in: [], fingerprint: '', truncated: false,
      approximate: true, note: '这个概念不在知识图里（诚实返回空剖面，不猜）。',
    };
  }
  const key = (x) => `${x.via}@${x.to}`;
  const out = adj[a].slice(0, cap).map((e) => ({ to: e.to, via: e.label })).sort((p, q) => key(p).localeCompare(key(q)));
  const inn = radj[a].slice(0, cap).map((e) => ({ from: e.to, via: e.label })).sort((p, q) => key(p).localeCompare(key(q)));
  const truncated = adj[a].length > cap || radj[a].length > cap;

  return {
    ok: true,
    concept: a,
    out,
    in: inn,
    fingerprint: JSON.stringify({ out: out.map(key), in: inn.map((x) => `${x.via}@${x.from}`) }),
    truncated,
    approximate: true,
  };
}

/**
 * 不可区分分组：关系剖面字面相同的概念（仅返回 size ≥ 2 的组）。
 * 依据（全忠实性的反向读法）：y 全忠实 ⇒ y(A) 与 y(B) 长得一样时，
 * 这张图里没有任何关系能把 A、B 分开——你讲了两个名字，结构上是同一个东西。
 * @param {Object} src
 * @param {{cap?:number}} opts
 * @returns {{groups:Array<Array<string>>, approximate:true, truncated:boolean, line:string, note:string}}
 */
function indistinguishable(src, opts = {}) {
  const { concepts } = normalize(src);
  const cap = opts.cap == null ? DEFAULT_CAP : opts.cap;

  const buckets = new Map();
  let truncated = false;
  for (const c of concepts) {
    const p = profileOf(src, c, { cap });
    if (!p.ok) continue;
    truncated = truncated || p.truncated;
    if (!buckets.has(p.fingerprint)) buckets.set(p.fingerprint, []);
    buckets.get(p.fingerprint).push(c);
  }
  const groups = [...buckets.values()].filter((g) => g.length >= 2).map((g) => g.slice().sort());

  let line;
  if (!groups.length) {
    line = '你讲的概念，彼此都能被关系分开——没有两个名字在讲同一个东西。';
  } else {
    const names = groups.map((g) => g.join(' / ')).join('；');
    line =
      `这几组概念，在你这张关系图里完全分不开（${names}）：` +
      `指向它们的关系一样、从它们出发的关系也一样。米田引理说——对象由指向它的态射决定，` +
      `分不开就是没区别：要么你换了名字重讲同一件事，要么其中一个根本没讲出特征。`;
  }
  const note = groups.length
    ? `指纹重合 ${groups.length} 组（一跳带标签剖面；不可区分的证据，非同构证明）。`
    : '一跳带标签剖面上未发现指纹重合。';
  return { groups, approximate: true, truncated, line, note };
}

/**
 * 分离证据：找出那条能把 A 与 B 分开的关系。
 * 找不到 ⇒ 当前知识库下二者不可分离（separates=false，不硬编证据）。
 * @returns {{separates:boolean, witness:?{kind:string,a:string,b:string}, line:string}}
 */
function separation(src, a, b) {
  const pa = profileOf(src, a);
  const pb = profileOf(src, b);
  if (!pa.ok || !pb.ok) {
    return { separates: false, witness: null, line: '概念不在图里，无从分离（诚实拒绝）。' };
  }
  if (pa.fingerprint === pb.fingerprint) {
    return { separates: false, witness: null, line: `${a} 与 ${b} 的关系剖面一致，这张图里分不开。` };
  }
  const so = pa.out.map((x) => `${x.via}@${x.to}`);
  const so2 = pb.out.map((x) => `${x.via}@${x.to}`);
  const si = pa.in.map((x) => `${x.via}@${x.from}`);
  const si2 = pb.in.map((x) => `${x.via}@${x.from}`);

  let witness = null;
  for (let i = 0; i < Math.max(so.length, so2.length); i++) {
    if (so[i] !== so2[i]) { witness = { kind: '出射', a: so[i] || '（无）', b: so2[i] || '（无）' }; break; }
  }
  if (!witness) {
    for (let i = 0; i < Math.max(si.length, si2.length); i++) {
      if (si[i] !== si2[i]) { witness = { kind: '入射', a: si[i] || '（无）', b: si2[i] || '（无）' }; break; }
    }
  }
  return {
    separates: true,
    witness,
    line: witness
      ? `能把 ${a} 和 ${b} 分开的是一条${witness.kind}关系：一边是「${witness.a}」，另一边是「${witness.b}」。`
      : `${a} 与 ${b} 可分离。`,
  };
}

/** 米田视角的一句话注记（给报告用，无评分） */
function yonedaNote(src) {
  const { concepts, maps } = normalize(src);
  return (
    `〔米田引理：一个对象由所有指向它的态射唯一决定——` +
    `你这张图里有 ${concepts.length} 个概念、${maps.length} 条映射。` +
    `只算「从它出发能到哪」只看了半张脸，另一半是「谁能到它」。〕`
  );
}

module.exports = { coReach, reachSet, profileOf, indistinguishable, separation, yonedaNote };
