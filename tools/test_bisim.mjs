// tools/test_bisim.mjs — 互模拟商（bisim.js）回归
// 运行：node tools/test_bisim.mjs
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const bis = require('../bisim.js');

let pass = 0, fail = 0;
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log('  ✅ ' + name + (extra ? '  ' + extra : '')); }
  else { fail++; console.log('  ❌ ' + name + (extra ? '  ' + extra : '')); }
}

const BAN = ['掌握', '掌握度', '理解度', '评分', '评级', '得分', 'grade', 'score', 'level', '你错了'];
function noScore(s) { return !BAN.some((w) => String(s || '').includes(w)); }

console.log('— 互模拟商 —');

// 1. 确定性弱信号检测（与 detectWeakPoints 同源口径）
{
  const j = bis.signalsOf('这一节全是专业术语和行话');
  ok('signalsOf 命中 jargon', j.includes('jargon'));
  const p = bis.signalsOf('他就是在背，照念稿子');
  ok('signalsOf 命中 parrot', p.includes('parrot'));
  const t = bis.signalsOf('他突然跳去扯别的，跑题了');
  ok('signalsOf 命中 jump', t.includes('jump'));
  const o = bis.signalsOf('这个要点他漏了，没提，省略了');
  ok('signalsOf 命中 omit', o.includes('omit'));
}

// 2. 每轮信号都不同 ⇒ 无等价类可坍缩（count == 轮数）
{
  const rounds = [
    { round: 1, text: '全是专业术语行话' },
    { round: 2, text: '他背照念稿子' },
    { round: 3, text: '突然跳扯跑题' },
  ];
  const r = bis.bisimQuotient(rounds);
  ok('全不同 ⇒ ok:true 且 count==轮数', r.ok && r.count === 3, 'count=' + r.count);
  ok('全不同输出守 A2', noScore(r.line) && noScore(r.note));
}

// 3. 两轮同信号 ⇒ 坍缩成 1 个根误类（count=2：两个 jargon 轮合并，jump 轮独立）
{
  const rounds = [
    { round: 1, text: '这段专业术语太多' },
    { round: 2, text: '又是一堆术语行话' }, // 同为 jargon
    { round: 3, text: '他背照念稿子' },       // parrot，独立
  ];
  const r = bis.bisimQuotient(rounds);
  ok('同信号两轮合并 ⇒ count==2', r.ok && r.count === 2, 'count=' + r.count);
  // 第1、2轮应在同一类
  const merged = r.classes.find((c) => c.members.includes(1) && c.members.includes(2));
  ok('第1、2轮归同一根误类', !!merged);
  const alone = r.classes.find((c) => c.members.length === 1 && c.members[0] === 3);
  ok('第3轮（parrot）独立成类', !!alone);
  ok('坍缩输出守 A2', noScore(r.line) && noScore(r.note));
}

// 4. 轮数 < 2 ⇒ 诚实拒绝
{
  const r = bis.bisimQuotient([{ round: 1, text: '术语' }]);
  ok('不足两轮 ⇒ ok:false', r.ok === false);
}

// 5. signals 直接传入也行（不依赖 text）
{
  const rounds = [
    { round: 1, signals: ['jargon'] },
    { round: 2, signals: ['jargon'] },
  ];
  const r = bis.bisimQuotient(rounds);
  ok('signals 直传 ⇒ 合并', r.ok && r.count === 1, 'count=' + r.count);
}

console.log(`\nbisim: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
