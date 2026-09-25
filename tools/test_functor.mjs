// tools/test_functor.mjs — 函子自然性自检（functor.js）回归
// 运行：node tools/test_functor.mjs
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const fn = require('../functor.js');

let pass = 0, fail = 0;
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log('  ✅ ' + name + (extra ? '  ' + extra : '')); }
  else { fail++; console.log('  ❌ ' + name + (extra ? '  ' + extra : '')); }
}

const BAN = ['掌握', '掌握度', '理解度', '评分', '评级', '得分', 'grade', 'score', 'level'];
function noScore(s) { return !BAN.some((w) => String(s || '').includes(w)); }

console.log('— 函子 / 自然变换 —');

// 1. 同一 stance 跨轮次 mirrored 一致 ⇒ 交换图闭合（commutative）
{
  const rounds = [
    { round: 1, stance: '映射|单射', mirrored: true },
    { round: 2, stance: '映射|单射', mirrored: true },
    { round: 3, stance: '满射|双射', mirrored: false },
  ];
  const r = fn.checkNaturality(rounds);
  ok('一致 ⇒ commutative=true', r.ok && r.commutative === true, JSON.stringify(r.flips));
  ok('一致输出守 A2', noScore(r.line) && noScore(r.note));
}

// 2. 同一 stance 跨轮次 mirrored 翻转 ⇒ 不交换（commutative=false, 报修）
{
  const rounds = [
    { round: 1, stance: '映射', mirrored: true },
    { round: 3, stance: '映射', mirrored: false }, // 同一概念，镜子翻牌
  ];
  const r = fn.checkNaturality(rounds);
  ok('翻转 ⇒ commutative=false', r.ok && r.commutative === false);
  ok('翻转 ⇒ flips 非空', r.flips.length === 1, JSON.stringify(r.flips));
  ok('翻转措辞点名概念与轮次', /第 1、3 轮/.test(r.line) && /映射/.test(r.line));
  ok('翻转输出守 A2（只报镜面问题）', noScore(r.line) && noScore(r.note));
}

// 3. 轮数 < 2 ⇒ 诚实拒绝
{
  const r = fn.checkNaturality([{ round: 1, stance: 'x', mirrored: true }]);
  ok('不足两轮 ⇒ ok:false', r.ok === false);
  ok('不足两轮 ⇒ 默认 commutative=true（不冤枉镜面）', r.commutative === true);
}

// 4. stance 不同 ⇒ 不比较（各算各的），不误报翻转
{
  const rounds = [
    { round: 1, stance: 'A', mirrored: true },
    { round: 2, stance: 'B', mirrored: false }, // 不同概念，不算翻转
  ];
  const r = fn.checkNaturality(rounds);
  ok('不同 stance 不误报', r.commutative === true && r.flips.length === 0);
}

console.log(`\nfunctor: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
