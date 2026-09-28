// test_cauchy_convergence.mjs — 柯西极限存在准则（Cauchy / 极限存在准则Ⅱ）维度的不变量测试
// 守 A2：这是整套算子里唯一一条【不预设终点】的判据——只报"在收拢/还在张开/几乎恒定"，
//   绝不报"你达到了某某理解水平"（那才是评分）。数学上精确对应 A2。
// 数学根：∀ε>0 ∃δ>0，凡与 x₀ 距离皆小于 δ 的任意两点 x'、x''，恒有 |f(x')−f(x'')|<ε ⇔ 极限存在（完备性）。
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

// ① 越讲越贴近 → contracting（内部差在收缩）
const r1 = tfn.cauchyConvergence({
  concepts: CS,
  rounds: R(['极限就是 x 越来越靠近某个数', '极限是 x 无限接近某个确定的数', '极限是 x 无限接近某个确定的数']),
  probes: [],
});
ok('典型收拢 → contracting', r1.ok && r1.internalConvergence === 'contracting'
  && r1.contracting === true, JSON.stringify(r1.gaps) + ' state=' + r1.internalConvergence);

// ② 几乎重复 → stationary（不虚报成"收拢"——那只是没往前走）
const r2 = tfn.cauchyConvergence({
  concepts: CS,
  rounds: R(['极限是无限接近某个数', '极限是无限接近某个数', '极限是无限接近某个数']),
  probes: [],
});
ok('几乎重复 → stationary（不虚报 contracting）', r2.ok && r2.internalConvergence === 'stationary'
  && r2.contracting === false, 'state=' + r2.internalConvergence);

// ③ 发散跑题 → open（隔着整个话题，差恒为最大）
const r3 = tfn.cauchyConvergence({
  concepts: CS,
  rounds: R(['极限是无限接近某个确定的数', '明天天气不错去公园散步晒太阳', '红烧肉要先焯水再下锅才香']),
  probes: [],
});
ok('发散跑题 → open', r3.ok && r3.internalConvergence === 'open', JSON.stringify(r3.gaps));

// ④ 振荡来回 → open（差恒定不小）
const r4 = tfn.cauchyConvergence({
  concepts: CS,
  rounds: R(['极限是无限接近某个确定的数', '无穷小就是极限为零的量', '极限是无限接近某个确定的数']),
  probes: [],
});
ok('振荡来回 → open', r4.ok && r4.internalConvergence === 'open', JSON.stringify(r4.gaps));

// ⑤ 内部差个数 = 轮数−1（相邻两点之差，n 点给 n−1 段距离）
ok('gaps 长度 = 轮数−1', r1.gaps.length === r1.gaps.length && r3.gaps.length === 2, 'gaps=' + JSON.stringify(r3.gaps));

// ⑥ 不足两轮 → 诚实拒绝（一轮给不出"两点之差"）
const r5 = tfn.cauchyConvergence({ concepts: CS, rounds: R(['极限就是靠近一个数']), probes: [] });
ok('不足两轮 → 诚实拒绝', r5.ok === false && /不足两轮/.test(r5.line), r5.line);

// ⑦ 无概念表 → 诚实拒绝
const r6 = tfn.cauchyConvergence({ concepts: [], rounds: R(['甲', '乙']), probes: [] });
ok('无概念表 → 诚实拒绝', r6.ok === false);

// ⑧ cauchy 在 EIG 调度是有效候选
const e = q.adjustedEig({ probeType: 'cauchy' });
ok('cauchy 在 EIG 调度是有效候选 (EIG>0)', typeof e === 'number' && e > 0, 'EIG=' + e);

// ⑨ cauchy 在 PROBE_TO_LEVEL 已登记合法层级
ok('cauchy 在 PROBE_TO_LEVEL 已登记', !!q.PROBE_TO_LEVEL.cauchy, q.PROBE_TO_LEVEL.cauchy);

// ⑩ 柯西型探针计数
const r7 = tfn.cauchyConvergence({ concepts: CS, rounds: R(['甲句话', '乙句话']), probes: [{ type: 'cauchy', answer: '我想想' }] });
ok('cauchy 探针计数 cauchyAsked=1', r7.ok && r7.cauchyAsked === 1);
ok('cauchy 探针已答计数 cauchyAnswered=1', r7.cauchyAnswered === 1);

// ⑪ 守 A2（核心）：这是唯一不预设终点的判据——报告不得出现"达标/正确/掌握了"等评分断言
ok('守 A2：三态报告均不含评分断言',
  ![r1, r2, r3, r4].some((r) => /理解得(好|对)|答对|掌握了|正确率|达到.*标准/.test(r.line + r.note)));
// ⑫ 阈值是启发式而非定理，必须照实写在 note 里（不虚称是定理）
ok('阈值如实声明为启发式', /启发式/.test(r1.note), r1.note.slice(-60));

console.log(`\n=== test_cauchy_convergence: ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
