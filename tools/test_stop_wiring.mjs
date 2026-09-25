// tools/test_stop_wiring.mjs — 追问停时「真的接进了课堂主流程」的回归
// 为什么单独测：questioning.js 里的 shouldContinue 是纯函数，单元测试全过也不代表它接对了。
//   上一轮就踩过：estimateGain 用整词切分，中文无空格让"同义反复"算出假增益 1.0，
//   单元测试 21/0 全绿，跑真实课堂却在第 5 轮还在傻问。所以这里必须跑真课堂。
//   ① 重复型回答 → 应在早期停（不是傻问到 maxRounds）
//   ② 补充型回答 → 应一路问到上限
//   ③ probe_stop 事件不得夹带任何评分/掌握度（红线：机器只说"没新东西可问"，不下"你没学会"）
// 运行：node tools/test_stop_wiring.mjs
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { createSession } = require('../teacher.js');
const { planBeats } = require('../experience.js');   // 体验节奏：探测数不再等于轮数

const LESSON = '光合作用::植物用阳光把水和二氧化碳变成糖和氧气，叶子发黄多半不是缺肥。';

let fails = 0;
const ok = (cond, msg, extra = '') => {
  console.log((cond ? '  ✅ ' : '  ❌ ') + msg + (extra ? '  ' + extra : ''));
  if (!cond) fails++;
};

async function run(replies, maxRounds = 6) {
  const s = createSession({ title: '光合作用', content: LESSON }, { maxRounds });
  const stops = [];
  const onEvent = (e) => { if (e.type === 'probe_stop') stops.push(e); };
  const onLog = () => {};
  await s.start(onEvent, onLog);
  for (const r of replies) { if (s.done) break; await s.reply(r, onEvent, onLog); }
  if (!s.done) await s.finish(onEvent, onLog);
  return { s, stops };
}

console.log('\n【1】重复型回答 —— 问到没新东西就收，不许傻问到上限');
{
  const { s, stops } = await run([
    '植物用阳光把水和二氧化碳变成糖和氧气，产物储存在淀粉里。',
    '就是植物用阳光把水和二氧化碳变成糖和氧气。',
    '和刚才一样，是植物用阳光、水和二氧化碳变成糖和氧气。',
    '我再重复一遍：植物用阳光、水和二氧化碳，变成糖和氧气。',
  ]);
  ok(stops.length === 1, '恰好停一次', `实测 ${stops.length}`);
  ok(s.done === true, '停下后课堂已收尾（不再等老师回话）', `round=${s.round}`);
  ok(s.round < 4, '在早期就停（< 4 轮）', `实测 ${s.round} 轮`);
  ok(s.probes.length < 4, '没有为了凑探测而重复提问', `探测 ${s.probes.length} 枚`);
  const e = stops[0] || {};
  ok(e.reason === 'gain-below-cost', '停止原因是"新信息不值得打断成本"', String(e.reason));
  ok(typeof e.cost === 'number', '事件带出成本 c（c 由人定、可审计）', `c=${e.cost}`);
  ok(typeof e.why === 'string' && e.why.length > 0, '停止原因有人话说明', String(e.why));
  // 红线：停止事件不得夹带任何"你行不行"的判定
  const forbidden = ['score', 'score', '掌握', '掌握度', '理解度', 'level', 'grade', 'rating', 'caught', '接住'];
  const hit = forbidden.filter((k) => JSON.stringify(e).toLowerCase().includes(k.toLowerCase()));
  ok(hit.length === 0, '停止事件不含评分/掌握度字段', hit.length ? '发现 ' + hit.join(',') : '干净');
}

console.log('\n【2】补充型回答 —— 每轮都有新东西，就该一路问到上限');
{
  const { s, stops } = await run([
    '植物用阳光把水和二氧化碳变成糖和氧气，产物储存在淀粉里。',
    '光反应在类囊体膜上做，把光能转成 ATP，这一步需要叶绿素吸收红光。',
    '暗反应叫卡尔文循环，发生在基质里，用光反应给的 ATP 固定二氧化碳。',
    '气孔开着的时候二氧化碳进得来，但天热时植物会关气孔保水。',
  ]);
  ok(stops.length === 0, '没有提前停', `实测 ${stops.length} 次`);
  ok(s.round >= 4, '一路问到位', `实测 ${s.round} 轮`);
  // ⚠️ 探测数不再等于回答轮数：体验节奏（experience.js）下 planBeats(6) 里有 ECHO/PAUSE/CLOSE
  //   三拍，镜子只照不问、不产出探测。所以判据改成"探测数 == 追问拍数"——
  //   这样改能同时锁住两件事：① 留白拍确实不凑探测数；② 该问的拍一个没少。
  const askingBeats = planBeats(6).filter((b) => b === 'DEEPEN').length;
  ok(s.probes.length === askingBeats, '探测数 == 追问拍数', `探测 ${s.probes.length} 枚 / 追问拍 ${askingBeats}`);
}

console.log('\n【3】空回话（收尾触发）不得被当成一次有效回答而误停');
{
  const s = createSession({ title: '光合作用', content: LESSON }, { maxRounds: 6 });
  const stops = [];
  const onEvent = (e) => { if (e.type === 'probe_stop') stops.push(e); };
  await s.start(onEvent, () => {});
  for (let i = 0; i < 3; i++) { if (s.done) break; await s.reply('', onEvent, () => {}); }
  if (!s.done) await s.finish(onEvent, () => {});
  ok(stops.length === 0, '连续空回话不触发停时', `实测 ${stops.length} 次`);
}

console.log(fails === 0 ? '\n全部通过 ✅\n' : `\n${fails} 项未通过 ❌\n`);
process.exit(fails === 0 ? 0 : 1);
