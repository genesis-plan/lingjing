// tools/test_teachingfn.mjs — 讲授作为函数：可逆性 / 跨时段 / 有界性 / 三种表示（确定性，无 LLM 依赖）
import {
  buildAnswerFunction, answerFunctionShift, boundedness, representations, sigOf,
} from '../teachingfn.js';

let passed = 0, failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ ' + name); }
}

const C = ['映射', '函数', '单射', '满射', '双射'];
const P = (round, ci, type, answer) => ({ round, ci, type, say: '问' + ci + round, answer });

// ── ① 回答函数：坍缩（多对一 ⇒ 无左逆）──
// 两个不同要点的回答触及同一批概念 ⇒ 签名相同 ⇒ 碰撞
const collapse = buildAnswerFunction([
  P(1, 0, 'example', '这不等于双射，别混了'),
  P(1, 1, 'example', '同样也不等于双射'),
  P(2, 2, 'example', '单射要求不同的输入有不同的输出'),
], C);
check('① 坍缩：识别出多对一', collapse.ok && collapse.injective === false);
check('① 坍缩：碰撞组里含这两个要点',
  collapse.collisions.some((c) => c.concepts.includes('映射') && c.concepts.includes('函数')));
check('① 坍缩：leftInvertible=false（不能唯一反推）', collapse.leftInvertible === false);

// ── ① 无坍缩：每个要点答得都不一样 ──
const clean = buildAnswerFunction([
  P(1, 0, 'example', '映射是单值对应，跟关系不同'),
  P(1, 1, 'example', '函数是数集上的映射'),
  P(2, 2, 'example', '单射要求不同输入不同输出'),
], C);
check('① 无坍缩：injective=true', clean.ok && clean.injective === true);
check('① 无坍缩：leftInvertible=true（能唯一反推）', clean.leftInvertible === true);
check('① 无坍缩：无碰撞', clean.collisions.length === 0);

// ── ① 真·非单值：同一角度两次答得不一样 ──
const unstable = buildAnswerFunction([
  P(1, 0, 'example', '映射是单值对应'),
  P(2, 0, 'example', '映射跟函数不是一回事'),
], C);
check('① 非单值：同一角度两次回答不一致被抓出', unstable.multiValued.length === 1);
check('① 非单值：点名了是哪个要点', unstable.multiValued[0] && unstable.multiValued[0].concept === '映射');

// ── ① 多角度：不同角度答得不一样，不算缺陷 ──
const multiAngle = buildAnswerFunction([
  P(1, 0, 'example', '映射是单值对应'),
  P(2, 0, 'bound', '映射跟函数不是一回事'),
], C);
check('① 多角度：不算非单值（避免把合理差异判成缺陷）', multiAngle.multiValued.length === 0);
check('① 多角度：单独记为 anglesDiffer', multiAngle.anglesDiffer.length === 1);

// ── ① 空回答不参与碰撞（否则两声"嗯"会被误判成坍缩）──
const empty = buildAnswerFunction([
  P(1, 0, 'example', '嗯'),
  P(1, 1, 'example', '哦'),
], C);
check('① 空回答：被记为 emptyAnswers', empty.emptyAnswers.length === 2);
check('① 空回答：不产生碰撞（不误判）', empty.collisions.length === 0);

// ── ① 诚实：满射/双射一律不判（本构造无自然对应域，硬造会让满射恒真）──
check('① 诚实：surjective 恒为 null', clean.surjective === null && collapse.surjective === null);
check('① 诚实：bijective 恒为 null', clean.bijective === null && collapse.bijective === null);

// ── ① 边界：拒绝而非编造 ──
check('① 边界：无概念表 → ok=false', buildAnswerFunction([P(1, 0, 'example', 'x')], []).ok === false);
check('① 边界：无已回答探测 → ok=false', buildAnswerFunction([P(1, 0, 'example', null)], C).ok === false);
check('① 边界：ci 越界不炸', buildAnswerFunction([P(1, 99, 'example', 'x')], C).ok === false);

// ── ② 跨时段比较（funext）──
const shiftSame = answerFunctionShift([
  P(1, 0, 'example', '映射是单值对应'),
  P(1, 1, 'example', '函数是数集上的映射'),
  P(3, 0, 'example', '映射是单值对应'),
  P(3, 1, 'example', '函数是数集上的映射'),
], C);
check('② 跨时段：前后一致 → 同一个函数', shiftSame.ok && shiftSame.equal === true);

const shiftDiff = answerFunctionShift([
  P(1, 0, 'example', '映射是单值对应'),
  P(3, 0, 'example', '映射跟函数不是一回事'),
], C);
check('② 跨时段：前后不一致 → 不是同一个函数', shiftDiff.ok && shiftDiff.equal === false);
check('② 跨时段：点名分歧的要点', shiftDiff.shifts.some((s) => s.concept === '映射'));
check('② 跨时段：单轮拒绝', answerFunctionShift([P(1, 0, 'example', 'x')], C).ok === false);

// ── ③ 有界性 ──
const bd = boundedness({
  concepts: C,
  rounds: [
    { round: 1, text: '映射要求单值，多值就不算映射了。' },
    { round: 2, text: '函数要求定义域和值域都是数集。' },
  ],
  probes: [
    { round: 1, type: 'bound', ci: 0, answer: '不能一对多' },
    { round: 2, type: 'bound', ci: 2, answer: null },
    { round: 2, type: 'example', ci: 1, answer: '随便' },
  ],
});
check('③ 有界：讲清边界的被归入 bounded', bd.bounded.includes('映射'));
check('③ 有界：没讲边界的被归入 unbounded', bd.unbounded.includes('函数'));
check('③ 有界：边界型探针计数正确（问 2 答 1）', bd.boundAsked === 2 && bd.boundAnswered === 1);
check('③ 有界：无概念表 → ok=false', boundedness({ concepts: [], rounds: [], probes: [] }).ok === false);

// ── ④ 三种表示互校 ──
const repAll = representations({
  definitionText: '函数是定义域和值域都是数集的映射',
  rounds: [
    { round: 1, text: '比如 f(x)=x² 就是个函数。' },
    { round: 2, text: '对应关系如下：x 对应 x²，y 对应 y²。' },
  ],
});
check('④ 表示：解析式被识别', repAll.analytic === 1);
check('④ 表示：例子（图像）被识别', repAll.graphic >= 1);
check('④ 表示：逐条对应（表格）被识别', repAll.tabular >= 1);
check('④ 表示：三种齐 → missing 为空', repAll.missing.length === 0);

const repNoTable = representations({
  definitionText: '函数是一种映射',
  rounds: [{ round: 1, text: '比如 f(x)=x²。' }],
});
check('④ 表示：缺表格被点名', repNoTable.missing.some((m) => m.includes('表格')));

const repConflict = representations({
  definitionText: '函数是一种映射',
  rounds: [{ round: 1, text: '比如 f(x)=x²。' }],
  conflict: true,
});
check('④ 表示：定义/例子冲突且缺表格时，点出"缺的是能裁决的那个"',
  repConflict.line.includes('裁决'));
check('④ 表示：无冲突时不做这个提示', !repNoTable.line.includes('裁决'));

// ── ⑤ 红线：不评分（守 A2）──
const allText = [
  collapse.line, collapse.note, clean.line, clean.note,
  unstable.line, multiAngle.line, shiftSame.line, shiftDiff.line,
  bd.line, bd.note, repAll.line, repConflict.line, repConflict.note,
].join('\n');
// 否定式清单要认全：不评分 / 不是评分 / 不给评分 / 非掌握度 ……
// ⚠️ 这个坑已经踩过三次（本报告里满是"非掌握度""不评分""不是评分"这类否定式声明，
//    它们恰恰是守红线的证据）——否定词与目标词之间可能夹"是/给/产/算"，必须留中间位。
const stripped = allText.replace(/(不|非|无|未|没有|拒绝)(是|给|产|算)?(掌握度|得分|评分|正确率|熟练度)/g, '');
const hit = ['掌握度', '得分', '评分', '正确率', '熟练度'].find((w) => stripped.includes(w));
check('⑤ 红线：全部输出不产出掌握度/得分/评分', !hit);
if (hit) console.log('    命中「' + hit + '」');

// ── ⑥ 签名工具 ──
check('⑥ 签名：同一批概念不同顺序 → 同一签名',
  sigOf('映射与函数', C) === sigOf('函数与映射', C));
check('⑥ 签名：空文本 → 空签名', sigOf('', C) === '');

console.log(`\n  teachingfn: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
