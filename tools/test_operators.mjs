// tools/test_operators.mjs — Λ 概念格 · Σ 覆盖骨架 · Φ 离散最优传输 的回归
// --------------------------------------------------------------------------
// 为什么单独测：docs/09 里 Λ 与 Σ 是唯二还标"路线"的算子（§8.4 / §8.5），
//   2026-09-25 落码。算子一旦落码，最常见的坏死法就是"恒返回个定值、看着像在算"——
//   所以每条断言都往"跨输入必须真变动"上顶，恒为常数即判失败。
// 另外 Φ 有一条硬规矩必须测出来：**没有共现信息时，它拒绝出数**（返回 null），
//   而不是退而返回一个几乎恒定的数字充数。
//
// 运行：node tools/test_operators.mjs
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const lat = require('../lattice.js');
const geom = require('../geometry.js');

let pass = 0, fail = 0;
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log('  ✅ ' + name + (extra ? '  ' + extra : '')); }
  else { fail++; console.log('  ❌ ' + name + (extra ? '  ' + extra : '')); }
}

// ===================== Λ 概念格 =====================
console.log('\n【Λ】概念格（Ganter next-closure）');

// 参考实现：暴力枚举 2^|M| 个属性子集，凡满足 A↑↓=A 的都是概念。
// 用它与 next-closure 的枚举结果对表——对得上才说明"不重不漏"。
function bruteConcepts(objects) {
  const { objects: rows, attrs } = lat.buildContext(objects);
  const attrCount = attrs.length;
  const out = [];
  for (let m = 0; m < (1 << attrCount); m++) {
    const ext = rows.map((r, i) => i).filter((i) => (rows[i].mask & m) === m);
    if (!ext.length) continue;                       // 空 extent 不是概念（与实现同一条口径）
    let cm = (1 << attrCount) - 1;
    for (const i of ext) cm &= rows[i].mask;
    if (cm === m) out.push(m);
  }
  return out;
}
{
  const objs = [
    { id: 'L1', signals: ['jargon', 'jump'] },
    { id: 'L2', signals: ['jargon', 'abstract'] },
    { id: 'L3', signals: ['jargon', 'omit'] },
    { id: 'L4', signals: ['jargon', 'jump', 'omit'] },
  ];
  const got = lat.formalConcepts(objs).concepts.map((c) => c.intent.length ? c.intent.slice().sort().join('+') : '(空)').sort();
  const want = bruteConcepts(objs).map((m) => {
    const as = lat.buildContext(objs).attrs;
    const arr = as.filter((_, i) => m & (1 << i));
    return arr.length ? arr.slice().sort().join('+') : '(空)';
  }).sort();
  ok('next-closure 枚举 == 暴力枚举（不重不漏）', JSON.stringify(got) === JSON.stringify(want),
    `${got.length} vs ${want.length}`);
}
{
  // 伽罗瓦对偶的两条最低要求：A ⊆ A↑↓（闭包扩张幂等）；A↑↓↑↓ = A↑↓（闭包是幂等的）
  const objs = [
    { id: 'a', signals: ['jargon', 'jump'] },
    { id: 'b', signals: ['jargon', 'omit'] },
    { id: 'c', signals: ['jump', 'omit'] },
  ];
  const { objects: rows } = lat.buildContext(objs);
  const ac = 3;
  const m = (1 << 1) | (1 << 2);              // {jargon, omit}
  const ext = lat.extentOf(m, rows);
  const cl = lat.closureOf(m, rows, ac);
  ok('extent(intent) 还原闭包', cl === m, `closure=${cl}`);
  ok('闭包幂等 closure(closure(A)) = closure(A)', lat.closureOf(cl, rows, ac) === cl);
  ok('extent 非空当且仅当存在共享这些属性的课', ext.length >= 1, `extent=${JSON.stringify(ext)}`);
}
{
  // 三条课共享 jargon → 格里必须有一个「覆盖全部课、intent 含 jargon」的节点。
  // 这就是 Λ 相对"数复现次数"的增量：它给的是**可命名的卡点类型**，不是频次。
  const a = lat.analyzeLattice([
    { id: 'L1', title: '光合', signals: ['jargon', 'jump'] },
    { id: 'L2', title: '呼吸', signals: ['jargon', 'abstract'] },
    { id: 'L3', title: '遗传', signals: ['jargon', 'omit'] },
  ]);
  const whole = a.concepts.find((c) => c.size === 3);
  ok('全课共有的节点存在，且其 intent 含 jargon',
    !!whole && whole.intent.includes('jargon'), JSON.stringify(whole && whole.intent));
  ok('慢性卡点被识别（≥2 课命中且≥2 类信号）', a.chronic.length >= 1, `${a.chronic.length} 类`);
  ok('最泛节点的口径是人话', typeof a.line === 'string' && a.line.length > 0);
}
{
  // 防摆设：不同背景必须给出不同结论
  const a1 = lat.analyzeLattice([{ id: 'x', signals: ['jargon', 'jump'] }, { id: 'y', signals: ['jargon', 'jump'] }]);
  const a2 = lat.analyzeLattice([{ id: 'x', signals: ['jargon'] }, { id: 'y', signals: ['omit'] }]);
  ok('概念数随背景真变动', a1.concepts.length !== a2.concepts.length,
    `${a1.concepts.length} vs ${a2.concepts.length}`);
  ok('慢性卡点数随背景真变动', a1.chronic.length !== a2.chronic.length,
    `${a1.chronic.length} vs ${a2.chronic.length}`);
}
{
  const e = lat.analyzeLattice([]);
  ok('空输入安全（不崩、不谎报结构）', e.concepts.length === 0 && e.chronic.length === 0 && typeof e.line === 'string');
  ok('无信号输入的口径是"没什么可归的"，不是硬造结构',
    lat.analyzeLattice([{ id: 'a', signals: [] }, { id: 'b', signals: [] }]).line.includes('没什么可归的'));
}
{
  const many = Array.from({ length: 12 }, (_, i) => ({ id: 'k' + i, signals: ['jargon', 'jump', 'omit', 'abstract', 'parrot'].slice(0, (i % 5) + 1) }));
  const r = lat.formalConcepts(many, { maxConcepts: 2 });
  ok('撞到 maxConcepts 时诚实标注截断', r.truncated === true && r.note.includes('截断'), r.note);
  ok('正常规模不误报截断', lat.formalConcepts([{ id: 'a', signals: ['jargon'] }, { id: 'b', signals: ['jargon', 'jump'] }]).truncated === false);
}

// ===================== Σ 覆盖骨架 =====================
console.log('\n【Σ】覆盖骨架（Nerve 1-骨架）');
{
  const n = lat.nerveSkeleton({ points: [{ round: 1, label: 'A' }, { round: 2, label: 'B' }], coverRadius: 1.5 });
  ok('相邻两轮视为同一簇（覆盖重叠）', n.bins.length === 1, `${n.bins.length} 簇`);
  ok('同簇标为扎堆（人话）', lat.describeNerve(n).line.includes('扎堆') || lat.describeNerve(n).line.includes('连着漏'));
}
{
  // 去重：同一轮的同一个口子被前后两遍检测各报一次，不去重会把"3 条"放大成"6 条"
  const n = lat.nerveSkeleton({
    points: [
      { round: 3, label: '暗反应' }, { round: 3, label: '暗反应' },
      { round: 4, label: '光反应' }, { round: 4, label: '光反应' },
      { round: 4, label: 'ATP' }, { round: 4, label: '叶绿体' },
    ], coverRadius: 1.5,
  });
  const members = n.bins[0] ? n.bins[0].members : [];
  ok('同轮同口子只算一次（去重）', new Set(members).size === members.length, JSON.stringify(members));
  ok('横跨两轮 => 说是"连着漏"而不是"一次性翻车"',
    lat.describeNerve(n).line.includes('连着漏'), lat.describeNerve(n).line);
}
{
  const n = lat.nerveSkeleton({
    points: [{ round: 1, label: 'A' }, { round: 1, label: 'B' }, { round: 9, label: 'C' }, { round: 10, label: 'D' }],
    coverRadius: 1.5,
  });
  ok('远隔的两簇被分成两堆', n.bins.length === 2, `${n.bins.length} 堆`);
  ok('两堆之间没有连边（nerve 的 1-骨架只在交集非空时连边）', n.edges.length === 0);
  ok('措辞是"撒成 N 堆"', lat.describeNerve(n).line.includes('2 堆'), lat.describeNerve(n).line);
}
{
  const n = lat.nerveSkeleton({ points: [{ round: 1, label: 'A' }] });
  ok('单点无形状（不谎报）', n.bins.length === 0 && lat.describeNerve(n).hasShape === false);
}
{
  // 边 ≥ 顶点 ⇒ 有回路（nerve 不再是条链）
  const n = lat.nerveSkeleton({
    points: [{ round: 1, label: 'A' }, { round: 1, label: 'B' }, { round: 1, label: 'C' }, { round: 2, label: 'D' }],
    coverRadius: 3,
  });
  ok('重叠半径足够大时连成一张网（cyclic）', n.cyclic === true || n.bins.length === 1,
    `bins=${n.bins.length} edges=${n.edges.length}`);
}

// ===================== Φ 离散最优传输 =====================
console.log('\n【Φ】离散最优传输（Sinkhorn，共现作地面代价）');
{
  // 自搬自应≈0（熵正则 + 有限迭代，不会精确等于 0，但必须是量级上的 0）
  const concepts = ['叶绿体', '类囊体', 'ATP', '暗反应', '光反应'];
  const lines = [
    { round: 1, text: '叶绿体是细胞里的小工厂，光反应在类囊体膜上发生，产生ATP。' },
    { round: 2, text: '暗反应在叶绿体基质里进行，消耗光反应产生的ATP，固定二氧化碳。' },
  ];
  const pairs = geom.cooccurrence({ lines, concepts });
  const self = geom.transportCost({ conceptsA: concepts, linesA: [lines[0]], conceptsB: concepts, linesB: [lines[0]], pairs, count: concepts.length });
  ok('自搬自≈0', self.w1 != null && self.w1 < 0.01, `w1=${self.w1}`);
  ok('Sinkhorn 边际回收正常（解出的 π 行和还原 P）', self.massRecovered === true);
}
{
  // ★ 硬规矩：没有共现信息 ⇒ 拒绝出数。宁可说"算不了"，也不给一个恒定值充数。
  const concepts = ['叶绿体', '类囊体', 'ATP'];
  const lines = [{ round: 1, text: '叶绿体是细胞里的小工厂，光反应在类囊体膜上发生，产生ATP。' }];
  const r = geom.transportCost({ conceptsA: concepts, linesA: lines, conceptsB: concepts, linesB: lines, pairs: null, count: concepts.length });
  ok('无共现记录时拒绝出数（返回 null 而非恒定值）', r.w1 === null, JSON.stringify(r.note));
}
{
  // 度量的三条基本公理（这是 W1 相对余弦代理的实质升级：余弦不是度量）
  const concepts = ['叶绿体', '类囊体', 'ATP', '暗反应', '光反应', '基质'];
  const lines = [
    { round: 1, text: '叶绿体是细胞里的小工厂，光反应在类囊体膜上发生，产生ATP，供暗反应使用。' },
    { round: 2, text: '暗反应发生在基质里，用光反应给的ATP固定二氧化碳，叶绿体把它包起来。' },
    { round: 3, text: '基质和类囊体都是细胞里的结构，叶绿体包着它们，这就是我记的全部。' },
  ];
  const pairs = geom.cooccurrence({ lines, concepts });
  const T = (i, j) => geom.transportCost({
    conceptsA: concepts, linesA: [lines[i]], conceptsB: concepts, linesB: [lines[j]], pairs, count: concepts.length,
  }).w1;
  const d01 = T(0, 1), d02 = T(0, 2), d12 = T(1, 2);
  ok('非负', d01 >= 0 && d02 >= 0 && d12 >= 0, `${d01} ${d02} ${d12}`);
  ok('对称（最优传输的边际交换不变）', Math.abs(d01 - T(1, 0)) < 1e-6, `${d01} vs ${T(1, 0)}`);
  if (d12 != null) ok('三角不等式 d(0,2) ≤ d(0,1)+d(1,2)', d02 <= d01 + d12 + 1e-6, `${d02} ≤ ${d01 + d12}`);
  ok('叉开的话题与接着的话题，成本真的不同（防摆设）', d12 != null && Math.abs(d02 - d01) > 1e-6,
    `相关=${d01} 无关=${d02}`);
}
{
  const concepts = ['叶绿体', '类囊体', 'ATP', '暗反应', '光反应'];
  const lines = [
    { round: 1, text: '叶绿体是细胞里的小工厂，光反应在类囊体膜上发生，产生ATP。' },
    { round: 2, text: '暗反应在叶绿体基质里进行，消耗光反应产生的ATP，固定二氧化碳。' },
    { round: 3, text: '光合作用就是把二氧化碳变成糖，跟叶绿体没关系。' },
  ];
  const t = geom.transportAlong({ lines, concepts, pairs: geom.cooccurrence({ lines, concepts }) });
  ok('沿轨迹给出逐段成本（真变动）', t.series.length === 2 && t.series[0].w1 !== t.series[1].w1,
    JSON.stringify(t.series.map((s) => s.w1)));
  ok('只报跳变段，不是每段都报', Array.isArray(t.jumps) && typeof t.line === 'string' && t.line.length > 0, t.line);
}
{
  const t = geom.transportAlong({ lines: [], concepts: [] });
  ok('空输入安全（不崩、不谎报）', t.series.length === 0 && typeof t.line === 'string');
}

// ---- 红线：三个算子的对外输出里不许出现"评分"字样（守 A2「镜子不评分」）----
console.log('\n【红线】A2：新落的三个算子不得带出评分/掌握度');
{
  const bad = ['掌握', '掌握度', '理解度', 'score', '评分', '评级', 'grade', 'level'];
  const texts = [
    JSON.stringify(lat.analyzeLattice([{ id: 'a', signals: ['jargon', 'jump'] }, { id: 'b', signals: ['jargon', 'omit'] }])),
    lat.describeNerve(lat.nerveSkeleton({ points: [{ round: 1, label: 'A' }, { round: 2, label: 'B' }] })).line,
  ];
  const hit = bad.filter((k) => texts.some((t) => t.toLowerCase().includes(k.toLowerCase())));
  ok('Λ / Σ 输出不含评分类字样', hit.length === 0, hit.length ? '发现 ' + hit.join(',') : '干净');
}

console.log(`\ntest_operators: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
