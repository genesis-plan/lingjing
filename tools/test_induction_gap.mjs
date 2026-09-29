// test_induction_gap.mjs — 归纳鸿沟（黎曼已证事实的教学面）维度的不变量测试
// 守 A2：只数"你几次把例子当成了证明"，不评判例子举得好不好。
// 红线：只用"已证的事实"——黎曼猜想零点数以万亿计逐个验证、无一反例，它至今仍是猜想。
//   这个"数值验证不构成证明"的元事实是已证的；猜想本体（真假）绝不进产品逻辑。
// 数学根：归纳鸿沟＝"例子 → 全体"那一步没有演绎保证；例子支撑信心，不支撑结构。
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
const CS = ['中值定理'];

// ① 典型归纳鸿沟：例子动作 + 归纳推断同句 → 检出
const r1 = tfn.inductionGap({
  concepts: CS,
  rounds: R(['我验证了一百个例子都成立，所以这个定理一定成立']),
  probes: [],
});
ok('例子+推断同句 → 检出归纳鸿沟', r1.ok && r1.exampleClaims.length === 1,
  JSON.stringify(r1.exampleClaims));
ok('line 指出"例子支撑的是信心，不是结构"', /信心，不是结构/.test(r1.line), r1.line.slice(0, 80));

// ② 只做例子动作、没跳全体 → 不检出（举例是好习惯，不是鸿沟）
const r2 = tfn.inductionGap({
  concepts: CS,
  rounds: R(['我验证了一百个例子，越验越觉得有意思']),
  probes: [],
});
ok('只举例不推断 → 不检出', r2.ok && r2.exampleClaims.length === 0, JSON.stringify(r2.exampleClaims));

// ③ 只有推断断言、没有例子动作 → 不检出（这属于别的算子的照面）
const r3 = tfn.inductionGap({
  concepts: CS,
  rounds: R(['所以它必然成立，这是显然的道理']),
  probes: [],
});
ok('只推断不举例 → 不检出', r3.ok && r3.exampleClaims.length === 0, JSON.stringify(r3.exampleClaims));

// ④ 多轮文本，只有踩缝的句子算数
const r4 = tfn.inductionGap({
  concepts: CS,
  rounds: R(['先讲讲定理的条件', '我拿三个函数代入算过，每次都对得上', '下一节讲应用']),
  probes: [],
});
ok('多轮中只有踩缝句检出', r4.ok && r4.exampleClaims.length === 1, JSON.stringify(r4.exampleClaims));

// ⑤ 探针计数：gap 型探测问了/答了分开数
const r5 = tfn.inductionGap({
  concepts: CS,
  rounds: R(['甲句话', '乙句话']),
  probes: [{ type: 'gap', answer: '我想想' }, { type: 'gap', answer: null }, { type: 'bound', answer: '好' }],
});
ok('gapAsked 只数 gap 型 = 2', r5.gapAsked === 2, 'gapAsked=' + r5.gapAsked);
ok('gapAnswered 只数有回答的 = 1', r5.gapAnswered === 1, 'gapAnswered=' + r5.gapAnswered);

// ⑥ gap 在 EIG 调度是有效候选（questioning.js 已登记 PRIOR_ANSWERS）
const e = q.adjustedEig({ probeType: 'gap' });
ok('gap 在 EIG 调度是有效候选 (EIG>0)', typeof e === 'number' && e > 0, 'EIG=' + e);

// ⑦ gap 在 PROBE_TO_LEVEL 已登记合法层级（cause：追问因果/保证）
ok('gap 在 PROBE_TO_LEVEL 已登记为 cause', q.PROBE_TO_LEVEL.gap === 'cause', q.PROBE_TO_LEVEL.gap);

// ⑧ 守 A2（核心）：报告不得出现评分断言
ok('守 A2：line+note 均不含评分断言',
  !/理解得(好|对)|答对|掌握了|正确率|达到.*标准|你错了/.test(r1.line + r1.note));

// ⑨ 诚实边界必须写死：词面近似声明 + 不否定举例
ok('note 声明词面信号近似', /词面信号近似/.test(r1.note), r1.note.slice(0, 60));
ok('note 声明不否定举例', /不否定举例/.test(r1.note), r1.note.slice(0, 60));

// ⑩ 数学根是"已证事实"而非猜想本体：必须照实写出万亿验证仍是猜想
ok('line 照实写出万亿验证仍是猜想', /万亿/.test(r1.line) && /猜想/.test(r1.line), r1.line.slice(-80));

// ⑪ 空输入不崩
const r6 = tfn.inductionGap({ concepts: [], rounds: [], probes: [] });
ok('空输入 → ok 且零检出', r6 && r6.ok === true && r6.exampleClaims.length === 0);

console.log(`\n=== test_induction_gap: ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
