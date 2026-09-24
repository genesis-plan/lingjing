// graph.js — G 图论盲区网（路线）
// 把本课（或跨课）的「概念 + 薄弱点 + 探测」拼成一张图：
//   节点 = 概念；边 = 两个概念在同一段讲解里被共同钉到（盲区相连），
//           或同一名学生跨概念的探测（他的困惑跨口子）。
//   度中心性 → 主要矛盾（最常被逼的口子）；连通分量 → 盲区聚类（哪些口子是一伙的）。
// 算力忽略不计（概念数＝要点数，通常 < 30）。守不评分红线：只连"被钉到"的事实，不编理解度。
//
// 输入 lessons：[{ concepts:[...], weakPoints:[{conceptIdx?,concept?}], probes:[{ci?,name?,type?}] }]
//   单课传 [{concepts, weakPoints, probes}]；跨课把多课并成一个数组传进来（同一函数，零新依赖）。

function buildWeakGraph(lessons) {
  const L = Array.isArray(lessons) ? lessons : [lessons];
  const conceptList = [];
  const hitCount = new Map();   // 概念 idx -> 被钉次数（度中心性输入）
  const coHit = new Map();      // "i|j" -> 共同被钉次数（边权）
  for (const les of L) {
    const cs = Array.isArray(les.concepts) ? les.concepts : [];
    if (!conceptList.length) conceptList.push(...cs);
    // 薄弱点：同课里多个薄弱点概念两两连边（它们在同一段讲解里同时漏了）
    const wps = (les.weakPoints || [])
      .map((w) => (w.conceptIdx != null ? w.conceptIdx : cs.indexOf(w.concept)))
      .filter((x) => x >= 0);
    for (let a = 0; a < wps.length; a++) {
      const ia = wps[a];
      hitCount.set(ia, (hitCount.get(ia) || 0) + 1);
      for (let b = a + 1; b < wps.length; b++) {
        const ib = wps[b];
        const k = ia < ib ? ia + '|' + ib : ib + '|' + ia;
        coHit.set(k, (coHit.get(k) || 0) + 1);
      }
    }
    // 探测：同名学生跨概念的探测连边（他的困惑跨口子），单概念探测只记命中
    const byStudent = {};
    for (const p of (les.probes || [])) {
      const ci = p.ci != null ? p.ci : -1;
      if (ci < 0) continue;
      hitCount.set(ci, (hitCount.get(ci) || 0) + 1);
      const key = p.name || '?';
      (byStudent[key] = byStudent[key] || new Set()).add(ci);
    }
    for (const set of Object.values(byStudent)) {
      const arr = [...set];
      for (let a = 0; a < arr.length; a++) {
        for (let b = a + 1; b < arr.length; b++) {
          const ia = arr[a], ib = arr[b];
          const k = ia < ib ? ia + '|' + ib : ib + '|' + ia;
          coHit.set(k, (coHit.get(k) || 0) + 1);
        }
      }
    }
  }
  // 节点
  const nodes = conceptList.map((c, i) => ({ idx: i, concept: c, degree: 0, hits: hitCount.get(i) || 0 }));
  const edges = [];
  const adj = new Map();
  const link = (a, b, w) => {
    edges.push({ a, b, weight: w });
    (adj.get(a) || adj.set(a, new Set()).get(a)).add(b);
    (adj.get(b) || adj.set(b, new Set()).get(b)).add(a);
  };
  for (const [k, w] of coHit) {
    const [a, b] = k.split('|').map(Number);
    link(a, b, w);
  }
  for (const n of nodes) n.degree = (adj.get(n.idx) || new Set()).size;
  // 度中心性排名 → 主要矛盾（绑得最紧的口子）
  const ranked = nodes.slice().sort((x, y) => (y.degree - x.degree) || (y.hits - x.hits));
  const mainHubs = ranked.filter((n) => n.degree > 0).slice(0, 3).map((n) => n.concept);
  // 连通分量 → 盲区聚类（哪些口子是一伙的）
  const seen = new Set();
  const clusters = [];
  for (const n of nodes) {
    if (seen.has(n.idx)) continue;
    const stack = [n.idx], comp = [];
    while (stack.length) {
      const x = stack.pop();
      if (seen.has(x)) continue;
      seen.add(x);
      comp.push(conceptList[x] != null ? conceptList[x] : ('概念' + x));
      for (const y of (adj.get(x) || [])) if (!seen.has(y)) stack.push(y);
    }
    if (comp.length > 1) clusters.push(comp);
  }
  return { nodes, edges, ranked, mainHubs, clusters };
}

module.exports = { buildWeakGraph };
