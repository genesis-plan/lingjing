// tools/test_experience.mjs — 体验节奏引擎（product goal: 人获得体验，不是被机器人盘问）
//
// 这一组测试锁的是**产品原则**，不是代码细节。三条必须守：
//   ① 一节课里必须有"不追问"的拍子——每轮必抛探测的流水线是不合格的；
//   ② 不追问的拍子必须真的不追问（不许改头换面再问一次，那叫换汤不换药）；
//   ③ 全部输出不评分、不表示掌握度（A2）。

import { pathToFileURL, fileURLToPath } from 'url';
import path from 'path';

const here = path.dirname(fileURLToPath(import.meta.url));
const e = await import(pathToFileURL(`${here}/../experience.js`).href);
const t = await import(pathToFileURL(`${here}/../teacher.js`).href);

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; } else { fail++; console.log('  ✗ ' + m); } };
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
function section(s) { console.log('\n=== ' + s + ' ==='); }

// ---------------------------------------------------------------- 拍子表
section('拍子表：一节课的呼吸');
ok(e.planBeats(1).join() === 'DEEPEN', '1 轮：只有开场那一拍');
ok(e.planBeats(2).join() === 'DEEPEN,CLOSE', '2 轮：开场 + 收束，中间不留空');
ok(e.planBeats(3).join() === 'DEEPEN,PAUSE,CLOSE', '3 轮：收尾前留一次闭嘴');
ok(e.planBeats(6).join() === 'DEEPEN,DEEPEN,ECHO,DEEPEN,PAUSE,CLOSE',
  '6 轮：深潜→深潜→呼应→深潜→留白→收束');
for (const n of [3, 4, 5, 6, 7, 8]) {
  const bs = e.planBeats(n);
  ok(bs.length === n, `n=${n}：拍子数等于轮数`);
  ok(bs[0] === 'DEEPEN', `n=${n}：第一拍必抛探测（开场得把人拉进来）`);
  ok(bs[bs.length - 1] === 'CLOSE', `n=${n}：最后一拍必收（有始有终）`);
  ok(bs.includes('PAUSE') || bs.includes('ECHO'), `n=${n}：中间至少有一拍不追问`);
  const d = bs.filter((b) => b === 'DEEPEN').length;
  ok(bs.filter((b) => b === 'PAUSE').length <= 1, `n=${n}：留白至多一次（多了就冷场）`);
  ok(d >= 1, `n=${n}：深潜仍是主体（至少 1 拍）`);
}
ok(e.beatFor(99, 4) === 'CLOSE', 'beatFor 越界钳到最后一拍，不返回 undefined');
ok(e.beatFor(0, 4) === 'DEEPEN', 'beatFor(0) 钳到第一拍');
ok(e.beatIsAsking('DEEPEN') && !e.beatIsAsking('PAUSE')
   && !e.beatIsAsking('ECHO') && !e.beatIsAsking('CLOSE'), '');
pass--;   // 上面那条只是表达式，不计入
section('拍子的含义（人话，不是术语）');
for (const [b, txt] of Object.entries(e.BEAT_TEXT)) {
  ok(typeof txt === 'string' && txt.length > 0 && txt.length < 16, `${b} 有人话文案`);
}
ok(!/probe|type|调度|EIG/i.test(Object.values(e.BEAT_TEXT).join('')), '文案里没有引擎术语');
ok(/接住|不追问/.test(e.BEAT_TEXT.PAUSE), '留白拍的文案说清了"不追问"');

// ---------------------------------------------------------------- 不评分
section('不评分（A2）：映照句里不许有判定词');
for (const beat of ['DEEPEN', 'ECHO', 'PAUSE', 'CLOSE']) {
  for (let i = 0; i < 24; i++) {
    const s = e.reflectLine({ utterance: '光合作用发生在叶绿体里，阳光提供能量。', beat, seed: i }).say;
    ok(s && s.length > 0, `${beat}/seed${i}：有输出`);
    if (s) ok(!e.SCORING_WORDS.test(s), `${beat}/seed${i}：不含评分词 → "${s}"`);
  }
}
ok(!e.SCORING_WORDS.test(e.closeLine(0)), '收束句不含评分词');

// ---------------------------------------------------------------- 留白 = 真不追问
section('留白拍 = 真不追问');
{
  const u = '光合作用发生在叶绿体里：阳光提供能量，水和二氧化碳作为原料。';
  const pause = e.reflectLine({ utterance: u, beat: 'PAUSE', seed: 3 });
  ok(pause.asks === false, 'PAUSE：一句话都不探');
  ok(!/[？?]/.test(pause.say), 'PAUSE：连问号都不许有（改头换面再问一次不算留白）→ ' + pause.say);
  ok(pause.say.includes(u.slice(0, 6).replace(/[：:]/g, '')), 'PAUSE：确实举回了先生的话');
  let asks = 0;
  for (let i = 0; i < 20; i++) {
    const r = e.reflectLine({ utterance: u, beat: 'PAUSE', seed: i });
    ok(r.asks === false, 'PAUSE 恒定不探（不留随机缺口）');
    if (/[？?]/.test(r.say)) asks++;
  }
  ok(asks === 0, 'PAUSE：任意 seed 都不出问号');
}
section('呼应拍 = 可以好奇，但不是盘问');
{
  const u = '植物用阳光把水和二氧化碳变成糖和氧气。';
  let withQ = 0;
  for (let i = 0; i < 24; i++) {
    const r = e.reflectLine({ utterance: u, beat: 'ECHO', seed: i });
    ok(/[？?]/.test(r.say) ? r.asks === true : true, 'ECHO 带问号时必须标记为 asks');
    ok(!e.SCORING_WORDS.test(r.say), 'ECHO 不含评分词');
    if (/[？?]/.test(r.say)) withQ++;
  }
  ok(withQ > 0 && withQ < 24, 'ECHO：问与不问交替出现（全问＝盘问，全不问＝太冷）');
}

// ---------------------------------------------------------------- 确定性
section('确定性');
{
  const a = e.reflectLine({ utterance: '水是原料。', beat: 'ECHO', seed: 7 });
  const b = e.reflectLine({ utterance: '水是原料。', beat: 'ECHO', seed: 7 });
  ok(a.say === b.say, '同 (输入, beat, seed) → 同一句（可复现、可回归）');
  const c = e.closeLine(2), d = e.closeLine(2);
  ok(c === d, '收束句同 seed 同句');
  ok(e.planBeats(6).join() === e.planBeats(6).join(), '拍子表可复现');
  const v = e.varyPhrase('「光合作用」到什么份上就不算数了？', 3);
  ok(v !== '「光合作用」到什么份上就不算数了？', 'varyPhrase 确实换了说法');
  ok(e.varyPhrase('「X」到什么份上就不算数了？', 1) === '「X」到什么份上就不算数了？',
    '多数 seed 保持原样（不是每句都加料）');
  const dupes = new Set();
  for (let i = 0; i < 12; i++) dupes.add(e.varyPhrase('「X」到什么份上就不算数了？', i));
  ok(dupes.size >= 3, '同一枚问句有 ≥3 种说法（去模板化的下限）');
}

// ---------------------------------------------------------------- 课堂接线
section('课堂接线：真实会话里的呼吸');
{
  const lesson = { title: '光合作用', content: '植物用阳光作能量，把水和二氧化碳变成糖（储存能量）和氧气。' };
  // 真实答法：每轮说**新的**内容（递进 clarification），不是复读同一句——
  //   复读会被停时判据正确地在第 2 轮收掉课堂，那样测的就不是体验节奏而是停时。
  const answers = [
    '光合作用发生在叶绿体里——叶绿体是细胞里的一间小工厂。',
    '具体点：类囊体的薄膜吸收光能，先把水拆开。',
    '那释放的氧气，是不是就来自水被拆开的那一步？',
    '我猜还有分工：光反应做 ATP，暗反应拿它去固定二氧化碳。',
    '这么说，夜里没光，暗反应也会跟着停下来？',
    '还有一点我不确定——糖里的能量，和水里的能量是一回事吗？',
  ];
  const s = t.createSession(lesson, { maxRounds: 6 });
  const asks = [], reflects = [];
  const collect = (ev) => { if (ev.type === 'ask') asks.push(ev); if (ev.type === 'reflect') reflects.push(ev); };
  await s.start(collect, () => {});
  let i = 0;
  while (!s.done && s.round < 6) {
    await s.reply(answers[i++ % answers.length], collect, () => {});
  }
  await s.finish(collect, () => {});
  ok(reflects.length >= 2, `6 轮课堂里出现 ≥2 次"只照不问"（实测 ${reflects.length} 次）——每轮必抛探测的流水线不合格`);
  ok(asks.length < 6, `探测数少于总轮数（实测 ${asks.length}/6）——这就是呼吸`);
  ok(reflects.every((r) => !r.text || !e.SCORING_WORDS.test(r.text)), '课堂里的映照句无评分词');
  ok(reflects.every((r) => r.beatText && r.beatText.length > 0), '映照事件带人话标签（前端可直接显示）');
  const kinds = new Set(reflects.map((r) => r.beat));
  ok([...kinds].every((k) => ['ECHO', 'PAUSE', 'CLOSE'].includes(k)), '映照事件的 beat 不污染探测类型');
  console.log(`  · 探测 ${asks.length} 枚 / 只照不问 ${reflects.length} 次`);
}
section('留白拍不产出探测记录');
{
  const lesson = { title: '光合作用', content: '植物用阳光作能量，把水和二氧化碳变成糖和氧气。' };
  const replies = [
    '光合作用发生在叶绿体里——叶绿体是细胞里的一间小工厂。',
    '具体点：类囊体的薄膜吸收光能，先把水拆开。',
    '那释放的氧气，是不是就来自水被拆开的那一步？',
    '我猜还有分工：光反应做 ATP，暗反应拿它去固定二氧化碳。',
  ];
  const s = t.createSession(lesson, { maxRounds: 6 });
  await s.start(() => {}, () => {});
  let i = 0;
  while (!s.done && s.round < 6) {
    await s.reply(replies[i++ % replies.length], () => {}, () => {});
  }
  await s.finish(() => {}, () => {});
  ok(s.probes.every((p) => p.type === 'land' || ['counter', 'bound', 'example', 'distinct', 'mechanism', 'apply'].includes(p.type)),
    'probes 序列里干净：没有 reflect 混进去');
  ok(s.probes.length === 0 || s.probes.every((p) => !/「/.test(p.type)), '类型字段未被 reflect 污染');
}

console.log(`\n${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
