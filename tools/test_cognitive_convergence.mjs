// test_cognitive_convergence.mjs — 认知收敛判据的实据测试
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const cc = require('../cognitive-convergence.js');

let pass = 0;
let fail = 0;
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log('✅', name, extra); }
  else { fail++; console.log('❌', name, extra); }
}

// 用回复文本数组构造 rounds（不依赖探针，直接用回复序列）
function mk(concepts, replies) {
  const rounds = replies.map((t, i) => ({ round: i + 1, text: t }));
  return cc.cognitiveConvergence({ concepts, rounds, probes: [] });
}

// 1) 收敛：稳定核心 + 保号（带"一般/通常"保持词）+ 前后半一致
{
  const cs = ['努力', '成功', '必然', '例外', '天赋'];
  const r = mk(cs, [
    '努力一般会导致成功，天赋也有一点用',
    '努力通常导致成功，天赋是次要的',
    '努力一般导致成功，天赋作用很小',
  ]);
  ok('收敛: ok', r.ok, r.verdict);
  ok('收敛: verdict=converged', r.verdict === 'converged', r.verdict);
  ok('收敛: localPreserved', r.localPreserved === true);
  ok('收敛: pathIndependent', r.pathIndependent === true);
}

// 2) 全局一致但方向翻号（只给方向、无保持/翻号词 → notPreserved>0）
{
  const cs = ['努力', '成功', '必然', '例外', '天赋'];
  const r = mk(cs, [
    '努力必然导致成功，天赋很重要',
    '努力必然导致成功，天赋很重要',
    '努力必然导致成功，天赋很重要',
  ]);
  ok('翻号: ok', r.ok, r.verdict);
  ok('翻号: verdict=global-ok-local-flip', r.verdict === 'global-ok-local-flip', r.verdict);
  ok('翻号: localPreserved=false', r.localPreserved === false);
  ok('翻号: notPreservedCount>0', r.notPreservedCount > 0, String(r.notPreservedCount));
}

// 3) 发散：前后矛盾（局部翻号 + 路径分叉）
{
  const cs = ['努力', '成功', '必然', '例外', '天赋'];
  const r = mk(cs, [
    '努力必然导致成功，天赋没用',
    '其实努力经常没用，天赋才关键',
  ]);
  ok('发散: ok', r.ok, r.verdict);
  ok('发散: verdict in (divergent/local-ok-global-divergent)',
    ['divergent', 'local-ok-global-divergent'].includes(r.verdict), r.verdict);
  ok('发散: localPreserved=false', r.localPreserved === false);
  ok('发散: pathIndependent=false', r.pathIndependent === false);
}

// 4) 轮次不足 → unknown（未进入去心邻域）
{
  const cs = ['努力', '成功'];
  const r = mk(cs, ['努力导致成功']);
  ok('未知: !ok', r.ok === false);
  ok('未知: verdict=unknown', r.verdict === 'unknown', r.verdict);
}

// 5) convergedCore：末尾 K 轮都出现的概念才进核
{
  const cs = ['a', 'b', 'c', 'd'];
  const seq = ['a|b', 'a|b|c', 'a|b', 'a|b']; // 末尾3轮都含 a,b；c 只在第2轮
  const core = [...cc.convergedCore(cs, seq, 3)].sort();
  ok('收敛核: 含 a', core.includes('a'), core.join(','));
  ok('收敛核: 含 b', core.includes('b'));
  ok('收敛核: 不含 c', !core.includes('c'));
  ok('收敛核: 不含 d', !core.includes('d'));
}

console.log(`\n=== test_cognitive_convergence: ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
