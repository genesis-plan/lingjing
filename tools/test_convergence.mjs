// test_convergence.mjs — 不动点分析（Banach 压缩映射）回归测试
// 数学依据：相邻反射态距离几何递减 ⇒ 序列 Cauchy ⇒ 收敛到不动点。
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// 强制无 LLM 环境（本测试只验纯数学逻辑，不依赖外网）
['LINGJING_ZHIPU_KEY', 'ZHIPU_API_KEY', 'LINGJING_LLM_PROVIDER', 'LINGJING_OR_KEY',
 'SILICONFLOW_KEY', 'OPENROUTER_KEY', 'LINGJING_SF_KEY'].forEach((k) => delete process.env[k]);

const cvg = require('../convergence.js');

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; } else { fail++; console.log('  ✗ FAIL:', name); } };

// 1. 几何递减 ⇒ 收敛（不动点存在）
const r1 = cvg.analyzeConvergence([{ round: 2, w1: 0.30 }, { round: 3, w1: 0.15 }, { round: 4, w1: 0.07 }, { round: 5, w1: 0.03 }]);
ok('几何递减判为 converged', r1.status === 'converged');
ok('converged 标记为真', r1.converged === true);
ok('qEst 上界 < 0.85', r1.qEst < 0.85);

// 2. 弱递减 ⇒ 收敛中
const r2 = cvg.analyzeConvergence([{ round: 2, w1: 0.30 }, { round: 3, w1: 0.25 }, { round: 4, w1: 0.20 }, { round: 5, w1: 0.18 }]);
ok('弱递减判为 converging', r2.status === 'converging');

// 3. 递增 ⇒ 漂移（不动点未被逼近）
const r3 = cvg.analyzeConvergence([{ round: 2, w1: 0.20 }, { round: 3, w1: 0.25 }, { round: 4, w1: 0.30 }, { round: 5, w1: 0.33 }]);
ok('递增判为 drifting', r3.status === 'drifting');
ok('drifting 标记 converged 为假', r3.converged === false);

// 4. 摇摆 ⇒ oscillating
const r4 = cvg.analyzeConvergence([{ round: 2, w1: 0.30 }, { round: 3, w1: 0.10 }, { round: 4, w1: 0.25 }, { round: 5, w1: 0.08 }]);
ok('摇摆判为 oscillating', r4.status === 'oscillating');

// 5. 不足两轮 ⇒ 诚实拒绝
const r5 = cvg.analyzeConvergence([{ round: 2, w1: 0.3 }]);
ok('单轮判为 insufficient', r5.status === 'insufficient');

// 6. 含 null 的序列应被安全过滤
const r6 = cvg.analyzeConvergence([{ round: 2, w1: 0.30 }, { round: 3, w1: null }, { round: 4, w1: 0.12 }, { round: 5, w1: 0.05 }]);
ok('含 null 序列不崩且收敛', r6.status === 'converged' && r6.qEst < 0.85);

// 7. FCA 不动点注记
ok('有概念时注记非空', cvg.fcaFixedPointNote({ concepts: [{ extent: [0], intent: ['jargon'] }] }).length > 0);
ok('无概念时注记为空', cvg.fcaFixedPointNote({ concepts: [] }) === '');

// 8. A2 红线：输出不得含评分词
const allLines = [r1.line, r1.note, r2.line, r3.line, r4.line, r5.line, r6.line, cvg.fcaFixedPointNote({ concepts: [{ extent: [0], intent: ['j'] }] })].join(' ');
const banned = ['掌握', '评分', '掌握度', 'score', '评级', 'level', '理解度'];
ok('输出不含评分词（守 A2）', banned.every((w) => !allLines.includes(w)));

console.log(`\ntest_convergence: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
