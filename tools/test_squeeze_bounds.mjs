// test_squeeze_bounds.mjs — 夹逼准则（squeeze bounds / 极限存在准则Ⅰ）维度的不变量测试
// 守 A2：只数范围断言的三个条件齐不齐，只报事实，不评分。
// 数学根：极限存在准则Ⅰ——去心邻域内 g≤f≤h 处处成立，且 lim g = lim h = 同一个 A，则 lim f = A，三条件缺一不可。
//   只给一边 = 局部有界性（推不出极限存在，−M 与 M 落到不同值）；保号性 = 用两个常数界夹逼的特例。
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const tfn = require('../teachingfn.js');
const q = require('../questioning.js');

let pass = 0, fail = 0;
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log('✅', name); }
  else { fail++; console.log('❌', name, extra); }
}
const R = (arr) => arr.map((text, i) => ({ round: i + 1, text }));
const CS = ['极限'];

// ① 只给一边（只有上界）→ oneSideOnly>0（那是局部有界，不是夹逼）
const r1 = tfn.squeezeBounds({ concepts: CS, rounds: R(['这个极限不超过 1']), probes: [] });
ok('只给一边 → oneSideOnly>0', r1.ok && r1.oneSideOnly.length > 0, JSON.stringify(r1.oneSideOnly));
ok('只给一边不误判为缺同极限', r1.sameLimitMissing.length === 0 && r1.notPunctured.length === 0);

// ② 双边但没确认两边收敛到同一个极限 → sameLimitMissing>0（夹逼真正比"有界"多出来的那一份）
const r2 = tfn.squeezeBounds({
  concepts: CS,
  rounds: R(['这个极限介于两者之间，只要足够近就一直成立']),
  probes: [],
});
ok('缺"两边同极限" → sameLimitMissing>0', r2.ok && r2.sameLimitMissing.length > 0, JSON.stringify(r2.sameLimitMissing));
ok('但没误判为单边', r2.oneSideOnly.length === 0);

// ③ 双边且确认了同极限，但没说清在哪成立 → notPunctured>0
const r3 = tfn.squeezeBounds({
  concepts: CS,
  rounds: R(['这个极限介于两者之间，两边都收敛到同一个值']),
  probes: [],
});
ok('缺"去心邻域内处处成立" → notPunctured>0', r3.ok && r3.notPunctured.length > 0, JSON.stringify(r3.notPunctured));

// ④ 三条件齐 → 三者皆空（守住了夹逼）
const r4 = tfn.squeezeBounds({
  concepts: CS,
  rounds: R(['这个极限介于两者之间，两边都收敛到同一个极限，只要足够近就一直成立']),
  probes: [],
});
ok('三条件齐 → 三者皆空', r4.ok && r4.bounds.length === 1
  && r4.oneSideOnly.length === 0 && r4.sameLimitMissing.length === 0 && r4.notPunctured.length === 0);

// ⑤ 无范围断言（纯描述）→ bounds=0，不误伤
const r5 = tfn.squeezeBounds({ concepts: CS, rounds: R(['极限就是越来越靠近但不踩上去']), probes: [] });
ok('无范围断言 → bounds=0（不误伤）', r5.ok && r5.bounds.length === 0);

// ⑥ squeeze 在 EIG 调度是有效候选（adjustedEig 返回 >0）
const e = q.adjustedEig({ probeType: 'squeeze' });
ok('squeeze 在 EIG 调度是有效候选 (EIG>0)', typeof e === 'number' && e > 0, 'EIG=' + e);

// ⑦ squeeze 在 PROBE_TO_LEVEL 已登记合法层级
ok('squeeze 在 PROBE_TO_LEVEL 已登记', !!q.PROBE_TO_LEVEL.squeeze, q.PROBE_TO_LEVEL.squeeze);

// ⑧ 夹逼型探针计数
const r6 = tfn.squeezeBounds({ concepts: CS, rounds: [], probes: [{ type: 'squeeze', answer: '我想想' }] });
ok('squeeze 探针计数 squeezeAsked=1', r6.ok && r6.squeezeAsked === 1);
ok('squeeze 探针已答计数 squeezeAnswered=1', r6.squeezeAnswered === 1);

// ⑨ 无概念表 → 诚实拒绝（不编结论）
const r7 = tfn.squeezeBounds({ concepts: [], rounds: [], probes: [] });
ok('无概念表 → 诚实拒绝', r7.ok === false);

// ⑩ 守 A2：报告行是计数，不含"你答对了/理解了"这类评分断言
const r8 = tfn.squeezeBounds({ concepts: CS, rounds: R(['这个极限不超过 1']), probes: [] });
ok('守 A2：报告不含评分断言', !/理解得(好|对)|答对|掌握了|正确率/.test(r8.line + r8.note), r8.line.slice(0, 40));

console.log(`\n=== test_squeeze_bounds: ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
