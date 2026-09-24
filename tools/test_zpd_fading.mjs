// ZPD fading 曲线单元测试：脚手架随轮次渐退（不评分，只数文本事实）
import { zpdFading, ZPD_LEVEL } from '../teaching.js';

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; } else { fail++; console.log('  ✗ ' + name); } }

// 轮1 全 bound（脚手架最轻），轮2 全 mechanism（最重）→ 脚手架应上升
const probes = [
  { round: 1, type: 'bound', answer: 'a', name: 'x' },
  { round: 1, type: 'bound', answer: 'b', name: 'y' },
  { round: 2, type: 'mechanism', answer: 'c', name: 'x' },
  { round: 2, type: 'counter', answer: 'd', name: 'y' },
];
const f = zpdFading(probes);
ok('逐轮产出', f.length === 2 && f[0].round === 1 && f[1].round === 2);
ok('轮1 脚手架 = bound 档(1)', f[0].scaffold === ZPD_LEVEL.bound);
ok('轮2 脚手架 ≥ 轮1（渐退上升）', f[1].scaffold > f[0].scaffold);
ok('回答率逐轮算出', f[0].answeredRate === 1 && f[1].answeredRate === 1);

// 没回的探测 → 回答率 < 1
const g = zpdFading([
  { round: 1, type: 'bound', answer: 'a', name: 'x' },
  { round: 1, type: 'bound', name: 'y' }, // 没 answer
]);
ok('含未回探测 → 回答率 < 1', g[0].answeredRate === 0.5);

// 空输入安全
ok('空输入安全', zpdFading([]).length === 0);

console.log(`\ntest_zpd_fading: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
