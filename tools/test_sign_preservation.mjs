// test_sign_preservation.mjs — 保号性（sign preservation）维度的不变量测试
// 守 A2：只数方向性判断、只报事实，不评分。
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const tfn = require('../teachingfn.js');
const q = require('../questioning.js');

let pass = 0, fail = 0;
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log('✅', name); }
  else { fail++; console.log('❌', name, extra); }
}

// ① 带方向性判断、无保持范围/翻号例 → notPreserved>0（盲区=伪定性断言）
const r1 = tfn.signPreservation({
  concepts: ['努力', '成功'],
  rounds: [{ round: 1, text: '努力必然导致成功，天赋不重要' }],
  probes: [],
});
ok('带方向无保持 → notPreserved>0', r1.ok && r1.notPreserved.length > 0, JSON.stringify(r1.notPreserved));

// ② 给了保持范围（"一般/有时/也重要"）→ notPreserved=0（保了号）
const r2 = tfn.signPreservation({
  concepts: ['努力', '成功'],
  rounds: [{ round: 1, text: '努力一般导致成功，但天赋也重要，有时努力了也不成' }],
  probes: [],
});
ok('给了保持范围 → notPreserved=0', r2.ok && r2.notPreserved.length === 0);

// ③ 无方向判断（纯描述）→ directional=0，不误伤
const r3 = tfn.signPreservation({
  concepts: ['极限', '函数'],
  rounds: [{ round: 1, text: '极限就是越来越靠近但不踩上去' }],
  probes: [],
});
ok('无方向判断 → directional=0（不误伤）', r3.ok && r3.directional.length === 0);

// ④ sign 在 EIG 调度是有效候选（adjustedEig 返回 >0，非 undefined/0）→ 证明探针调度会选中它
const e = q.adjustedEig({ probeType: 'sign' });
ok('sign 在 EIG 调度是有效候选 (EIG>0)', typeof e === 'number' && e > 0, 'EIG=' + e);

// ⑤ sign 在 PROBE_TO_LEVEL 已登记合法层级（buildQuestionSpec 不会取 cause 兜底）
ok('sign 在 PROBE_TO_LEVEL 已登记', !!q.PROBE_TO_LEVEL.sign, q.PROBE_TO_LEVEL.sign);

// ⑥ sign 探针计数：构造一枚 type='sign' 的探针 → signAsked=1
const r4 = tfn.signPreservation({
  concepts: ['努力', '成功'],
  rounds: [],
  probes: [{ type: 'sign', answer: '我想想' }],
});
ok('sign 探针计数 signAsked=1', r4.ok && r4.signAsked === 1);

// ⑦ 无概念表 → 诚实拒绝（不编结论）
const r5 = tfn.signPreservation({ concepts: [], rounds: [], probes: [] });
ok('无概念表 → 诚实拒绝', r5.ok === false);

console.log(`\n=== test_sign_preservation: ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
