// tools/test_function.mjs — 函数算子测试（确定性，无 LLM 依赖）
import {
  checkWellDefined, analyzeCoverage, extensionalEquality, invertibility, imageVsDefinition,
} from '../function.js';

let passed = 0, failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ ' + name); }
}

// ── ① 单值性 / 良定义 ──
const concepts = ['映射', '函数', '单射', '满射', '双射', '定义域', '值域'];
const utts = [
  { round: 1, text: '函数是定义域到值域的映射' },   // 一话多指 → 非单值
  { round: 2, text: '单射要求不同输入有不同输出' }, // 单值
];
const wd = await checkWellDefined(utts, concepts);
check('① 单值性：识别出第1轮一话多指（非单值）', wd.multiValued.some((m) => m.round === 1));
check('① 单值性：第2轮是单值（未被误报）', !wd.multiValued.some((m) => m.round === 2));
check('① 单值性：无概念时诚实拒绝', (await checkWellDefined(utts, [])).ok === false);

// ── ② 定义域 / 值域 / 对应域 ──
const cov = analyzeCoverage({
  domain: ['映射', '函数', '定义域'],
  image: ['映射', '函数'],              // 定义域提到"定义域"但没解释 → 非全
  codomain: ['映射', '函数', '单射', '满射', '双射'],
});
check('② 覆盖：识别出缺口（单射/满射/双射 没讲到）',
  cov.gap.includes('单射') && cov.gap.includes('满射') && cov.gap.includes('双射'));
check('② 覆盖：不满射', cov.surjective === false);
check('② 覆盖：识别出非全（提到"定义域"但没给出解释）', cov.undefinedOn.includes('定义域'));
check('② 覆盖：无对应域时诚实拒绝', analyzeCoverage({ image: ['a'], codomain: [] }).ok === false);

// ── ③ 外延相等 funext ──
const f1 = { 映射: '对应', 函数: '数集映射', 单射: '一对一' };
const f2 = { 映射: '对应', 函数: '数集映射', 单射: '一对一' };   // 措辞不同但取值全同
const f3 = { 映射: '对应', 函数: '公式' };                        // 定义域缺 + 取值不同
check('③ 外延相等：f1 与 f2 相等（不看措辞看取值）', extensionalEquality(f1, f2).equal === true);
check('③ 外延相等：f1 与 f3 不相等', extensionalEquality(f1, f3).equal === false);
check('③ 外延相等：f1 与 f3 定义域不同', extensionalEquality(f1, f3).sameDomain === false);
check('③ 外延相等：两空映射诚实拒绝', extensionalEquality({}, {}).ok === false);

// ── ④ 可逆性（反函数 ⟺ 双射）──
const bij = { 映射: 'A', 函数: 'B', 单射: 'C' };
const inv1 = invertibility(bij, ['A', 'B', 'C']);
check('④ 可逆性：双射 ⇒ 反函数存在', inv1.invertible === true && inv1.bijective === undefined || inv1.invertible === true);
const nonInj = { 映射: 'A', 函数: 'A', 单射: 'C' };   // 多对一
const inv2 = invertibility(nonInj, ['A', 'C']);
check('④ 可逆性：多对一 ⇒ 非单射 ⇒ 不可逆', inv2.injective === false && inv2.invertible === false);
check('④ 可逆性：报出多对一碰撞具体在哪', inv2.collisions.some((c) => c.output === 'A'));

// ── ⑤ 意象 vs 定义（Vinner & Dreyfus / Evangelidou）──
// 经典误解：定义说"函数"(宽)，例子清一色"一一对应"(窄)
const narrowed = imageVsDefinition(
  '函数是两个数集之间的单值对应关系，每个自变量对应唯一的函数值。',
  ['f(x)=2x+1 是一一对应', 'y=x³ 是双射', '这个映射是一一映射'],
);
check('⑤ 意象vs定义：识别出"把函数讲窄成一一对应"', narrowed.narrowed === true);
// 均衡：定义宽，例子宽窄都有
const balanced = imageVsDefinition(
  '函数是数集之间的单值映射。',
  ['f(x)=x² 不是一一对应（多对一）', 'f(x)=2x 是一一对应'],
);
check('⑤ 意象vs定义：宽窄例子都有 ⇒ 不算讲窄', balanced.narrowed === false);
check('⑤ 意象vs定义：统计到宽例与窄例', balanced.broadExamples >= 1 && balanced.narrowExamples >= 1);

// ── 红线：全程不评分 ──
const all = JSON.stringify([wd, cov, extensionalEquality(f1, f3), inv2, narrowed]);
check('红线：全部输出不含"掌握/学会/得分/评分"', !/掌握|学会|得分|评分/.test(all));

console.log(`\nfunction: ${passed} passed / ${failed} failed`);
process.exit(failed ? 1 : 0);
