import coalgebra from '../coalgebra.js';

let pass = 0, fail = 0;
const check = (name, cond) => {
  if (cond) { pass++; console.log('✓', name); }
  else { fail++; console.log('✗', name); }
};

// ① 最大不动点基础：F(X)=X∩{1,2} 在 universe={1,2,3} 上，gfp={1,2}
check('① gfp: X∩{1,2} over {1,2,3} = {1,2}', (() => {
  const res = coalgebra.greatestFixedPoint((X) => new Set([...X].filter((x) => x === 1 || x === 2)), new Set([1, 2, 3]));
  const got = [...res.fixed].sort().join(',');
  return res.stable && got === '1,2';
})());

// ② 互模拟：两条链 a→b→(终) 与 a'→b'→(终) 互模拟
check('② 两条同构链互模拟', (() => {
  const states = ['a', 'b', 'a2', 'b2'];
  const step = (s) => (s === 'a' ? ['b'] : s === 'b' ? [] : s === 'a2' ? ['b2'] : []);
  const r = coalgebra.bisimulationRelation(states, step);
  return r.complete && r.relation.has('a#a2') && r.relation.has('b#b2');
})());

// ③ 非互模拟：a→b→(终) 与 a→(终)（一步到位）不等价
check('③ 一步到位 vs 两步链 不互模拟', (() => {
  const states = ['a', 'b', 'x'];
  const step = (s) => (s === 'a' ? ['b'] : s === 'b' ? [] : s === 'x' ? [] : []);
  const r = coalgebra.bisimilar('a', 'x', states, step);
  return r.bisimilar === false;
})());

// ④ 互模拟对称 & 自反：单终止态与自己互模拟
check('④ 终止态自反互模拟', (() => {
  const states = ['t'];
  const step = () => [];
  const r = coalgebra.bisimilar('t', 't', states, step);
  return r.bisimilar === true;
})());

// ⑤ 分叉等价：a→{b,c} 与 a2→{b2,c2}，且 b,c / b2,c2 各终止 → 互模拟
check('⑤ 分叉结构互模拟', (() => {
  const states = ['a', 'b', 'c', 'a2', 'b2', 'c2'];
  const step = (s) => ({ a: ['b', 'c'], b: [], c: [], a2: ['b2', 'c2'], b2: [], c2: [] }[s] || []);
  const r = coalgebra.bisimilar('a', 'a2', states, step);
  return r.bisimilar === true;
})());

// ⑥ 有界诚实：状态对超上限 → unknown，不报错不编造
check('⑥ 超上限诚实返回 unknown', (() => {
  const states = Array.from({ length: 100 }, (_, i) => 's' + i);
  const step = () => [];
  const r = coalgebra.bisimulationRelation(states, step, { maxPairs: 50 });
  return r.unknown === true && r.relation.size === 0;
})());

// ⑦ gfp 与 tarski lfp 同机两面：在补集上 gfp(F)= complement(lfp(F^c)) 关系（简验单调性要求）
check('⑦ gfp 返回的是不动点', (() => {
  const F = (X) => new Set([...X].filter((x) => x !== 3)); // 单调：去掉3
  const res = coalgebra.greatestFixedPoint(F, new Set([1, 2, 3]));
  const Fof = F(res.fixed);
  return [...Fof].sort().join(',') === [...res.fixed].sort().join(',');
})());

// ⑧ 红线：无评分词汇（否定式已剥）
check('⑧ 红线：无评分/掌握度肯定式', (() => {
  const txt = coalgebra.coalgebraNote;
  const stripped = txt.replace(/(不|非|无|未|没有|拒绝)(掌握度|得分|评分|正确率|熟练度)/g, '');
  return !/掌握度|得分|评分|正确率|熟练度/.test(stripped);
})());

console.log(`\n=== test_coalgebra: ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
