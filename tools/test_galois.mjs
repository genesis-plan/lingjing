import galois from '../galois.js';

let pass = 0, fail = 0;
const check = (name, cond) => {
  if (cond) { pass++; console.log('✓', name); }
  else { fail++; console.log('✗', name); }
};

// 背景：G={a,b,c,d}, M={1,2,3,4}，关联如下
//   a:1,2   b:2,3   c:1,2,3   d:4
const OBJS = ['a', 'b', 'c', 'd'];
const M = ['1', '2', '3', '4'];
const I = [
  ['a', '1'], ['a', '2'],
  ['b', '2'], ['b', '3'],
  ['c', '1'], ['c', '2'], ['c', '3'],
  ['d', '4'],
];
const ctx = new galois.GaloisContext({ G: OBJS, M, I });

// ① 派生算子
check('① ↑({a}) = {1,2}', JSON.stringify([...ctx.deriveUp(new Set(['a']))].sort()) === '["1","2"]');
check('① ↓({2}) = {a,b,c}', JSON.stringify([...ctx.deriveDown(new Set(['2']))].sort()) === '["a","b","c"]');

// ② 闭包扩张性：X ⊆ ↓↑(X)
check('② 扩张性 a⊆↓↑{a}', (() => {
  const cl = ctx.closureExtent(new Set(['a']));
  return cl.has('a');
})());

// ③ 闭包幂等：↓↑↓↑ = ↓↑
check('③ 幂等 ↓↑↓↑=↓↑', (() => {
  const cl = ctx.closureExtent(new Set(['a']));
  const cl2 = ctx.closureExtent(cl);
  const a = [...cl].sort().join(','), b = [...cl2].sort().join(',');
  return a === b;
})());

// ④ 反单调：{a,b}⊆{a,b,c} ⇒ ↑({a,b,c}) ⊆ ↑({a,b})
check('④ 反单调 ↑ 随集合增大而缩小', (() => {
  const uAB = ctx.deriveUp(new Set(['a', 'b']));
  const uABC = ctx.deriveUp(new Set(['a', 'b', 'c']));
  return [...uABC].every((m) => uAB.has(m));
})());

// ⑤ 单对象概念：objectConcept('a') = (↓↑{a}, ↑{a})
check('⑤ 对象概念 a', (() => {
  const oc = ctx.objectConcept('a');
  if (!oc) return false;
  const expIntent = JSON.stringify([...ctx.deriveUp(new Set(['a']))].sort());
  const gotIntent = JSON.stringify(oc.intent.sort());
  return gotIntent === expIntent && oc.extent.includes('a');
})());

// ⑥ 盲区：c 拥有 1,2,3；↓↑{c} = {c}（因为 c 是唯一同时拥有 1,2,3 的）。盲区应为空。
check('⑥ 盲区(封闭概念 c) 为空', (() => {
  const bs = ctx.blindSpot('c');
  return bs.ok && bs.blind.length === 0 && bs.closure.length === 0;
})());

// ⑦ 盲区(开放概念 a)：a 拥有 1,2；↓↑{a} = {a,c}（c 也拥有 1,2）。c 是 a 没明说牵连的 → 盲区含 c
check('⑦ 盲区(开放概念 a) 含 c', (() => {
  const bs = ctx.blindSpot('a');
  return bs.ok && bs.blind.includes('c') && bs.closure.includes('c');
})());

// ⑧ 伽罗瓦连接自检三律
check('⑧ selfCheck 三律全过', (() => {
  const sc = ctx.selfCheck([new Set(['a']), new Set(['b']), new Set(['a', 'b']), new Set(['a', 'b', 'c'])]);
  return sc.extensive && sc.idempotent && sc.antimonotone;
})());

// ⑨ 空集约定：↑(∅)=全属性，↓(∅)=全对象
check('⑨ 空集约定 ↑∅=M, ↓∅=G', (() => {
  const u = ctx.deriveUp(new Set());
  const d = ctx.deriveDown(new Set());
  return u.size === M.length && d.size === OBJS.length;
})());

// ⑩ fromMapModel 接线契约：用最小图验证
check('⑩ fromMapModel 构造自反背景', (() => {
  const fakeModel = {
    concepts: () => ['x', 'y', 'z'],
    maps: () => ([{ from: 'x', to: 'y' }, { from: 'y', to: 'z' }]),
  };
  const gc = galois.fromMapModel(fakeModel);
  // x 自反+指向 y；闭包 ↓↑{x} 至少含 x 自身
  const cl = gc.closureExtent(new Set(['x']));
  return cl.has('x');
})());

// ⑪ 红线：不产出评分词汇（否定式已剥）
check('⑪ 红线：无评分/掌握度肯定式', (() => {
  const bs = ctx.blindSpot('a');
  const txt = (bs.line || '') + galois.galoisNote;
  const stripped = txt.replace(/(不|非|无|未|没有|拒绝)(掌握度|得分|评分|正确率|熟练度)/g, '');
  return !/掌握度|得分|评分|正确率|熟练度/.test(stripped);
})());

console.log(`\n=== test_galois: ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
