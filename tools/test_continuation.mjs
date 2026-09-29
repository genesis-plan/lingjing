// test_continuation.mjs — 延拓唯一（解析延拓恒等定理，已证）维度的不变量测试
// 守 A2：只照"判据是否被说清沿用"，绝不判定推广本身对错。
// 数学根（已证）：同一解析函数，延拓若存在则必唯一——新旧地盘取值不同的"两个延拓"不可能同时成立。
//   故"广义的X"若与旧判据冲突，不是延拓，是偷换概念。
// 与 distinct 的边界：distinct 管"两个东西差在哪"，continuation 管"同一个东西换了地盘还认不认得出"。
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
const CS = ['函数'];

// ① 延拓话语 + 锚定判据 → 检出且不算未锚定
const r1 = tfn.continuation({
  concepts: CS,
  rounds: R(['把这个函数推广到复数域，判据还是同一个']),
  probes: [],
});
ok('推广+锚定判据 → 检出且 unanchored=0',
  r1.ok && r1.extendTalks.length === 1 && r1.unanchored.length === 0,
  JSON.stringify(r1.extendTalks) + ' unanchored=' + JSON.stringify(r1.unanchored));
ok('锚定情形 line 给出"延拓合法的样子"', /延拓合法/.test(r1.line), r1.line.slice(-60));

// ② 延拓话语但没说判据 → 计入 unanchored（可能不是推广，是偷换）
const r2 = tfn.continuation({
  concepts: CS,
  rounds: R(['把这个概念推广到更一般的情形']),
  probes: [],
});
ok('推广无判据 → unanchored=1',
  r2.ok && r2.extendTalks.length === 1 && r2.unanchored.length === 1,
  'unanchored=' + JSON.stringify(r2.unanchored));
ok('未锚定 line 点出"判据没沿用可能是偷换"', /偷换/.test(r2.line), r2.line.slice(-80));

// ③ 无延拓话语 → 诚实说算子没开工（不硬凑发现）
const r3 = tfn.continuation({
  concepts: CS,
  rounds: R(['这两个说法差在哪，我总搞混', '函数为什么会这样']),
  probes: [],
});
ok('无延拓话语 → extendTalks=0 且 line 说明未开工',
  r3.ok && r3.extendTalks.length === 0 && /没发现/.test(r3.line), r3.line.slice(0, 60));

// ④ distinct 的领地不触发 continuation（"差在哪/搞混"不是延拓话语）
ok('distinct 领地的句子不触发 continuation',
  r3.extendTalks.length === 0 && r3.unanchored.length === 0);

// ⑤ 探针计数：extend 型探测问了/答了分开数
const r5 = tfn.continuation({
  concepts: CS,
  rounds: R(['甲句话', '乙句话']),
  probes: [{ type: 'extend', answer: '好' }, { type: 'extend', answer: null }, { type: 'gap', answer: '嗯' }],
});
ok('extendAsked 只数 extend 型 = 2', r5.extendAsked === 2, 'extendAsked=' + r5.extendAsked);
ok('extendAnswered 只数有回答的 = 1', r5.extendAnswered === 1, 'extendAnswered=' + r5.extendAnswered);

// ⑥ extend 在 EIG 调度是有效候选（questioning.js 已登记 PRIOR_ANSWERS）
const e = q.adjustedEig({ probeType: 'extend' });
ok('extend 在 EIG 调度是有效候选 (EIG>0)', typeof e === 'number' && e > 0, 'EIG=' + e);

// ⑦ extend 在 PROBE_TO_LEVEL 已登记合法层级（hypothesis：追问假设/推广）
ok('extend 在 PROBE_TO_LEVEL 已登记为 hypothesis',
  q.PROBE_TO_LEVEL.extend === 'hypothesis', q.PROBE_TO_LEVEL.extend);

// ⑧ 守 A2（核心）：报告不得出现评分断言
ok('守 A2：line+note 均不含评分断言',
  !/理解得(好|对)|答对|掌握了|正确率|达到.*标准|你错了/.test(r1.line + r1.note)
  && !/理解得(好|对)|答对|掌握了|正确率|达到.*标准|你错了/.test(r2.line + r2.note));

// ⑨ 诚实边界必须写死：词面近似声明 + 锚定词命中≠条件真的一致
ok('note 声明词面信号近似', /词面信号近似/.test(r1.note), r1.note.slice(0, 60));
ok('note 声明锚定词命中不验证条件真一致', /不验证条件真的一致/.test(r1.note), r1.note.slice(0, 90));

// ⑩ 数学根是已证定理：必须照实写出恒等定理/唯一性
ok('line/note 照实写出恒等定理（延拓唯一）',
  /恒等定理/.test(r2.line + r2.note) && /唯一/.test(r2.line + r2.note),
  (r2.line + r2.note).slice(0, 80));

// ⑪ 空输入不崩
const r6 = tfn.continuation({ concepts: [], rounds: [], probes: [] });
ok('空输入 → ok 且零检出', r6 && r6.ok === true && r6.extendTalks.length === 0);

console.log(`\n=== test_continuation: ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
