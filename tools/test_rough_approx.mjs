// 路线-cheap 单元测试：∂ 下/上近似 · m 证据区间 · Δ* 序贯三枝
// 防摆设：每个断言都验证"跨输入真变动"，恒为定值即失败。
import { roughApprox, evidenceInterval, sequentialConceptVerdict } from '../teaching.js';

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; } else { fail++; console.log('  ✗ ' + name); } }

// —— ∂ roughApprox ——
const A = roughApprox([{ concept: 'X', verdicts: ['POS', 'POS'] }]);
ok('全 POS → 落进下近似', A.lower.includes('X') && A.byConcept[0].state === 'POS');

const B = roughApprox([{ concept: 'Y', verdicts: ['NEG', 'NEG'] }]);
ok('全 NEG → 落进上近似外（upper 不含）', !B.upper.includes('Y') && B.byConcept[0].state === 'NEG');

const C = roughApprox([{ concept: 'Z', verdicts: ['POS', 'BND', 'NEG'] }]);
ok('混合 → 落在边界区', C.boundary.includes('Z') && C.byConcept[0].state === 'BND');
ok('边界区 = 上近似 \\ 下近似', C.boundary.length === C.upper.length - C.lower.length);

// 空输入不崩、不谎报
const E = roughApprox([]);
ok('空输入安全', E.lower.length === 0 && E.upper.length === 0 && E.boundary.length === 0);

// —— m evidenceInterval ——
const I = evidenceInterval([
  { concept: 'X', verdicts: ['POS', 'POS', 'BND'] },
  { concept: 'Y', verdicts: ['NEG', 'NEG', 'NEG'] },
]);
ok('Bel = POS/n（保留两位小数）', Math.abs(I[0].belief - 2 / 3) < 0.01);
ok('Pl = 1 - NEG/n', I[0].plausibility === 1);
ok('全 NEG → Pl=0（诚实下界）', I[1].plausibility === 0 && I[1].belief === 0);
// 区间宽度随证据变动：X 比 Y 宽 → 真变动
ok('区间宽度跨概念真变动', (I[0].plausibility - I[0].belief) !== (I[1].plausibility - I[1].belief));

// —— Δ* sequentialConceptVerdict ——
ok('探测不足阈值 → 一律 BND', sequentialConceptVerdict(['POS']) === 'BND');
ok('达阈值全 POS → POS', sequentialConceptVerdict(['POS', 'POS']) === 'POS');
ok('达阈值全 NEG → NEG', sequentialConceptVerdict(['NEG', 'NEG', 'NEG']) === 'NEG');
ok('达阈值混合 → BND', sequentialConceptVerdict(['POS', 'BND']) === 'BND');
ok('阈值可调', sequentialConceptVerdict(['POS', 'POS', 'BND'], 3) === 'BND');

console.log(`\ntest_rough_approx: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
