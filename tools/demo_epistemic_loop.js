// tools/demo_epistemic_loop.js — 追问停时接线实测（不看文档，跑真实课堂）
// 目的：验证 questioning.js 的 shouldContinue 真的接进了 teacher.js 的追问循环，
//       并观察「不同质量的回答会把课堂停在第几轮」。
//   第 1 组：回答一次比一次重复 → 应该在早期就停（不该傻问到上限）
//   第 2 组：每轮都答出新东西 → 应该一路问到轮次上限
// 运行：node tools/demo_epistemic_loop.js
const { createSession } = require('../teacher.js');

async function run(title, replies) {
  const s = createSession({ title, content: '光合作用' }, { maxRounds: 6 });
  const lines = [];
  const onEvent = (e) => {
    if (e.type === 'probe_stop') lines.push(`  ⏹ 停：${e.why}  [${e.reasonLabel}]`);
  };
  const onLog = (t) => { if (String(t).includes('停时')) lines.push('  · ' + String(t).replace(/【停时】/, '')); };
  await s.start(onEvent, onLog);
  for (const r of replies) {
    if (s.done) break;
    await s.reply(r, onEvent, onLog);
  }
  if (!s.done) await s.finish(onEvent, onLog);
  console.log(`\n【${title}】共 ${s.round} 轮，探测 ${s.probes.length} 枚`);
  console.log('  ' + (lines.join('\n  ') || '  （本次未触发停时日志）'));
  console.log('  gain 记录：' + s.probes.map((p) => `#${p.round}:${p.type}`).join(' ') || '  （无探测）');
}

(async () => {
  // 第 1 组：第一次认真答，后面三次都是重复句
  await run('重复型回答', [
    '植物用阳光把水和二氧化碳变成糖和氧气，这个过程叫光合作用。',
    '就是植物用阳光把水和二氧化碳变成糖和氧气。',
    '和刚才一样，是植物用阳光、水和二氧化碳变成糖和氧气。',
    '我再重复一遍：植物用阳光、水和二氧化碳，变成糖和氧气。',
  ]);

  // 第 2 组：每轮都补出新信息
  await run('补充型回答', [
    '植物用阳光把水和二氧化碳变成糖和氧气，产物储存在淀粉里。',
    '光反应在类囊体膜上做，把光能转成 ATP，这一步需要叶绿素吸收红光。',
    '暗反应叫卡尔文循环，发生在基质里，用光反应给的 ATP 固定二氧化碳。',
    '气孔开着的时候二氧化碳进得来，但天热时植物会关气孔保水，这时就会缺二氧化碳。',
  ]);
})();
