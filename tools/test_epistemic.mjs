// tools/test_epistemic.mjs — 认知负荷约束 + 最优停时判据（把数学做进代码）
// 守红线：零 LLM、零评分语、确定性可复现、不伪装"已有"；gain 是确定性代理度量，非真实互信息。
import {
  tokenize, estimateGain, shouldContinue, enforceSingleFocus, planNextProbe, buildQuestionSpec,
} from '../questioning.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; } else { fail++; console.log('  ✗ ' + m); } };
const noScore = (s) => !/评分|打分|掌握度|得分|BKT/.test(s);

// ① 分词确定性（跨调用可复现，不依赖任何外部库）
const t1 = tokenize('光合作用， chloroplast 与 能量转换！');
const t2 = tokenize('光合作用， chloroplast 与 能量转换！');
ok(JSON.stringify(t1) === JSON.stringify(t2), 'tokenize 同输入确定一致');
ok(t1.length === t1.filter((x) => typeof x === 'string').length && t1.includes('chloroplast'), 'tokenize 正确切出 token');

// ② 增益代理：首轮有信息 = 1；完全重复 = 0；部分翻新 ∈ (0,1)
ok(estimateGain({ utterance: '我有一个观点。' }) === 1, '首轮（无prev）增益为 1');
ok(estimateGain({ utterance: '', prevUtterance: 'x' }) === 0, '空回答增益为 0');
// 注：中文连写不产生分隔符（"我我我我"整体是一个 token），故用空格分隔的词表测全重复
const repeat = estimateGain({ utterance: '甲 乙 丙 丁', prevUtterance: '甲 乙 丙 丁' });
ok(repeat === 0, `全重复回答增益为 0（实测 ${repeat}）`);
const partial = estimateGain({ utterance: '这个流程的审批节点 涉及 财务 与 法务', prevUtterance: '这个流程的审批节点 涉及 财务' });
ok(partial > 0 && partial < 1, `部分翻新增益落在 (0,1)（实测 ${partial.toFixed(3)}）`);

// ③ 最优停时：增益 > 成本 → 继续；增益 ≤ 成本 → 停；超预算 → 停
const cont = shouldContinue({ round: 2, gain: 0.9, cost: 0.35 });
ok(cont.stop === false && cont.reason === 'positive-net', '高增益 → 继续追问');
const stop = shouldContinue({ round: 2, gain: 0.2, cost: 0.35 });
ok(stop.stop === true && stop.reason === 'gain-below-cost', '低增益 → 停（净收益为负）');
const budget = shouldContinue({ round: 8, gain: 0.99, cost: 0.35, maxRounds: 8 });
ok(budget.stop === true && budget.reason === 'budget-exhausted', '超预算 → 停（不无限追问）');
// 成本系数由人定：同一增益下，抬高成本应翻转结论（机器不代定成本）
ok(
  shouldContinue({ round: 2, gain: 0.30, cost: 0.10 }).stop === false &&
  shouldContinue({ round: 2, gain: 0.30, cost: 0.50 }).stop === true,
  '成本 c 由人设定即可翻转停时结论（机器不代定）',
);

// ④ 单轮单概念：同概念不换题；换题 → 退回安全层 + 显式标记
const same = enforceSingleFocus(buildQuestionSpec({ target: '光合作用', probeType: 'counterexample' }), '光合作用');
ok(same.focusShifted === false && same.focusedOn === '光合作用', 'target 与 focus 一致时不判换题');
const shifted = enforceSingleFocus(buildQuestionSpec({ target: '供应链管理', probeType: 'counterexample' }), '光合作用');
ok(shifted.focusShifted === true && focusedIs(shifted), '换题被显式标记');
function focusedIs(spec) { return spec.focusedOn === '光合作用'; }
ok(shifted.progressionLevel === 1 && shifted.progressionKey === 'clarify', '换题 → 强制退回澄清层（最安全档）');
ok(!!shifted.focusReason && shifted.focusReason.includes('一次只追一个概念'), '换题附带人类可读理由（不静默跳概念）');
ok(/一次只追一个概念/.test(shifted.focusReason), '换题理由解释认知负荷依据');

// ⑤ 计划入口：planNextProbe 返回 spec + 停时判定，且不产出任何评分语
const plan = planNextProbe({
  target: '光合作用', probeType: 'mechanism', humanLastUtterance: '叶绿体把光能转成化学能。', prevUtterance: '叶绿体把光能转成化学能，这个我懂。', round: 2, focus: '光合作用',
});
ok(plan.spec && plan.continueDecision, 'planNextProbe 返回 spec 与停时判定');
ok(typeof plan.gainEstimated === 'number' && plan.gainEstimated >= 0 && plan.gainEstimated <= 1, '代理增益落在 [0,1]');
ok(noScore(JSON.stringify(plan)), 'planNextProbe 全链路无任何评分/掌握度语');

// ⑥ 向后兼容：不带 focus 的旧调用不受影响
const legacy = buildQuestionSpec({ target: '光合作用', probeType: 'mechanism', humanLastUtterance: '因为阳光被叶绿体吸收。' });
ok(legacy.progressionLevel >= 1 && legacy.track === 'A' && legacy.focusShifted === false, '旧调用路径行为不变（向后兼容）');

// ⑦ 确定性：同输入 planNextProbe 两次结果逐字段一致
const p1 = planNextProbe({ target: 'A', probeType: 'counter', humanLastUtterance: '我做了三件事 分别 是 审计 与 复核', prevUtterance: '我做了三件事 分别 是 审计', round: 1, focus: 'A' });
const p2 = planNextProbe({ target: 'A', probeType: 'counter', humanLastUtterance: '我做了三件事 分别 是 审计 与 复核', prevUtterance: '我做了三件事 分别 是 审计', round: 1, focus: 'A' });
ok(JSON.stringify(p1) === JSON.stringify(p2), 'planNextProbe 跨调用确定可复现');

// ⑧ 单调性：回答越重复，越早停（这是"最优停时"该有的行为）
const seq = ['甲 乙 丙 丁', '甲 乙 丙 丁', '甲 乙 丙 丁', '甲 乙 丙 丁'];
let prevUtterance = '', stopRound = null;
for (let r = 1; r <= 6; r++) {
  const d = shouldContinue({ round: r, gain: estimateGain({ utterance: seq[r - 1], prevUtterance }), cost: 0.35 });
  prevUtterance = seq[r - 1];
  if (d.stop) { stopRound = r; break; }
}
ok(stopRound !== null && stopRound <= 3, `完全重复的回答会立刻触发停时（实测第 ${stopRound} 轮停）`);

console.log(`\n认知负荷·最优停时测试：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
