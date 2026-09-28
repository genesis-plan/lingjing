// test_law_premise.mjs — 极限运算法则前提（law premise）维度的不变量测试
// 守 A2：只数运算前提确认/未定式误区，只报事实，不评分。
// 数学根：极限四则运算法则前提"各子极限存在且有限"（Freek Wiedijk HOL LIM_ADD；Eberl Isabelle tendsto_intros；
//   Boldo/Lelay/Melquiond 形式化实分析综述）；商的法则分母≠0 = 保号性推论；未定式处理 = orderComparison 阶比较。
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const tfn = require('../teachingfn.js');
const q = require('../questioning.js');

let pass = 0, fail = 0;
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log('✅', name); }
  else { fail++; console.log('❌', name, extra); }
}

// ① 做了极限运算、无前提确认 → premiseMissing>0（盲区=没确认法则前提的运算）
const r1 = tfn.lawPremise({
  concepts: ['极限', '四则运算法则'],
  rounds: [{ round: 1, text: '这个极限我直接代入算，极限等于 3' }],
  probes: [],
});
ok('做了运算无前提确认 → premiseMissing>0', r1.ok && r1.premiseMissing.length > 0, JSON.stringify(r1.premiseMissing));

// ② 确认了前提（"各子极限都存在且有限"）→ premiseMissing=0（守了前提）
const r2 = tfn.lawPremise({
  concepts: ['极限', '四则运算法则'],
  rounds: [{ round: 1, text: '先用运算法则拆开，前提是两个子极限都存在且为有限实数' }],
  probes: [],
});
ok('确认了法则前提 → premiseMissing=0', r2.ok && r2.premiseMissing.length === 0);

// ③ 踩未定式误区（∞−∞=0）→ indeterminacyTrap>0（典型误区）
const r3 = tfn.lawPremise({
  concepts: ['极限', '无穷大'],
  rounds: [{ round: 1, text: '这里 ∞−∞=0，所以极限就是 0' }],
  probes: [],
});
ok('踩未定式误区 ∞−∞=0 → indeterminacyTrap>0', r3.ok && r3.indeterminacyTrap.length > 0, JSON.stringify(r3.indeterminacyTrap));

// ③′ 类似：0/0=0 也是误区
const r3b = tfn.lawPremise({
  concepts: ['极限'],
  rounds: [{ round: 1, text: '分子分母都趋0，所以 0/0=0' }],
  probes: [],
});
ok('踩未定式误区 0/0=0 → indeterminacyTrap>0', r3b.ok && r3b.indeterminacyTrap.length > 0);

// ④ 无运算表述（纯描述）→ applied=0，不误伤
const r4 = tfn.lawPremise({
  concepts: ['极限', '函数'],
  rounds: [{ round: 1, text: '极限就是越来越靠近但不踩上去' }],
  probes: [],
});
ok('无运算表述 → applied=0（不误伤）', r4.ok && r4.applied.length === 0);

// ⑤ law 在 EIG 调度是有效候选（adjustedEig 返回 >0，非 undefined/0）→ 证明探针调度会选中它
const e = q.adjustedEig({ probeType: 'law' });
ok('law 在 EIG 调度是有效候选 (EIG>0)', typeof e === 'number' && e > 0, 'EIG=' + e);

// ⑥ law 在 PROBE_TO_LEVEL 已登记合法层级（buildQuestionSpec 不会取 cause 兜底）
ok('law 在 PROBE_TO_LEVEL 已登记', !!q.PROBE_TO_LEVEL.law, q.PROBE_TO_LEVEL.law);

// ⑦ 法则前提探针计数：构造一枚 type='law' 的探针 → lawAsked=1
const r5 = tfn.lawPremise({
  concepts: ['极限', '四则运算法则'],
  rounds: [],
  probes: [{ type: 'law', answer: '我想想' }],
});
ok('law 探针计数 lawAsked=1', r5.ok && r5.lawAsked === 1);

// ⑧ 无概念表 → 诚实拒绝（不编结论）
const r6 = tfn.lawPremise({ concepts: [], rounds: [], probes: [] });
ok('无概念表 → 诚实拒绝', r6.ok === false);

console.log(`\n=== test_law_premise: ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
