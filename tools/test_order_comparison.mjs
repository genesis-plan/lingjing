// test_order_comparison.mjs — 阶比较（order comparison）维度的不变量测试
// 守 A2：只数阶判断、只报事实，不评分。
// 数学根：阶 O/o/∼ 是偏序且必须相对于极限过程才有意义；"等价"f∼g=lim f/g=1 但 f≠g（经典误区）。
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const tfn = require('../teachingfn.js');
const q = require('../questioning.js');

let pass = 0, fail = 0;
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log('✅', name); }
  else { fail++; console.log('❌', name, extra); }
}

// ① 做了阶判断、无极限过程锚定/反例 → notAnchored>0（盲区=没锚定过程的阶断言）
const r1 = tfn.orderComparison({
  concepts: ['高阶无穷小', '低阶无穷小'],
  rounds: [{ round: 1, text: '高阶无穷小可以忽略低阶无穷小，它太小了' }],
  probes: [],
});
ok('做了阶判断无锚定 → notAnchored>0', r1.ok && r1.notAnchored.length > 0, JSON.stringify(r1.notAnchored));

// ② 锚定了极限过程（"当 x→0 时"）→ notAnchored=0（保了锚）
const r2 = tfn.orderComparison({
  concepts: ['高阶无穷小', '低阶无穷小'],
  rounds: [{ round: 1, text: '当 x 趋近于 0 时，高阶无穷小可以忽略低阶无穷小' }],
  probes: [],
});
ok('锚定了极限过程 → notAnchored=0', r2.ok && r2.notAnchored.length === 0);

// ③ 说"等价"却没澄清"不等于" → equivalenceTrap>0（等价≠相等的经典误区）
const r3 = tfn.orderComparison({
  concepts: ['sinx', 'x'],
  rounds: [{ round: 1, text: 'sinx 和 x 是等价的无穷小' }],
  probes: [],
});
ok('说等价没澄清≠相等 → equivalenceTrap>0', r3.ok && r3.equivalenceTrap.length > 0, JSON.stringify(r3.equivalenceTrap));

// ③′ 说"等价"且澄清"只是极限为1、不是相等" → equivalenceTrap=0（没踩陷阱）
const r3b = tfn.orderComparison({
  concepts: ['sinx', 'x'],
  rounds: [{ round: 1, text: 'sinx 和 x 是等价的无穷小，只是极限比值为1，并非真的相等' }],
  probes: [],
});
ok('等价且澄清≠相等 → equivalenceTrap=0', r3b.ok && r3b.equivalenceTrap.length === 0);

// ④ 无阶判断（纯描述）→ comparison=0，不误伤
const r4 = tfn.orderComparison({
  concepts: ['极限', '函数'],
  rounds: [{ round: 1, text: '极限就是越来越靠近但不踩上去' }],
  probes: [],
});
ok('无阶判断 → comparison=0（不误伤）', r4.ok && r4.comparison.length === 0);

// ⑤ order 在 EIG 调度是有效候选（adjustedEig 返回 >0，非 undefined/0）→ 证明探针调度会选中它
const e = q.adjustedEig({ probeType: 'order' });
ok('order 在 EIG 调度是有效候选 (EIG>0)', typeof e === 'number' && e > 0, 'EIG=' + e);

// ⑥ order 在 PROBE_TO_LEVEL 已登记合法层级（buildQuestionSpec 不会取 cause 兜底）
ok('order 在 PROBE_TO_LEVEL 已登记', !!q.PROBE_TO_LEVEL.order, q.PROBE_TO_LEVEL.order);

// ⑦ 阶比探针计数：构造一枚 type='order' 的探针 → orderAsked=1
const r5 = tfn.orderComparison({
  concepts: ['高阶无穷小', '低阶无穷小'],
  rounds: [],
  probes: [{ type: 'order', answer: '我想想' }],
});
ok('order 探针计数 orderAsked=1', r5.ok && r5.orderAsked === 1);

// ⑧ 无概念表 → 诚实拒绝（不编结论）
const r6 = tfn.orderComparison({ concepts: [], rounds: [], probes: [] });
ok('无概念表 → 诚实拒绝', r6.ok === false);

console.log(`\n=== test_order_comparison: ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
