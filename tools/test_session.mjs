// 灵境·课室 会话闭环回归测试（无需密钥，走兜底语料）
// 运行： node tools/test_session.mjs
//
// ⚠️ 2026-09-11 重写（用户："你为什么一直算那几个 AI 学生的数据呢，这不是假的吗……那是假的理论，
//   这个产品的最终定位是为人服务，而不是为AI服务"）。
//   旧版断言的是「疑惑解开度 R 随教师回答上升」「avgR > 0」「gains.completeness 存在」——
//   那三个量全是从**学生自评理解度**算出来的，没有真值来源。现在它们连生成都不生成了。
//   新版校验的是"学生到底问出了什么、这些问是不是真的跟着输入变"：
//     ①五个学生各有前概念 ②每轮每人各抛一枚探测（带类型）
//     ③一轮之内五人盯的要点不撞车、六类探测会轮遍
//     ④换课题 → 问的就换（不是固定那几句）
//     ⑤教师没答到的问题被如实记下来（盲区清单 + 类型）
//     ⑥产物里**不再有**任何"学生理解度"类字段
import { createRequire } from 'module';
import fs from 'fs';
const require = createRequire(import.meta.url);
const t = require('../teacher.js');

const lesson = t.parseLesson('光合作用::植物用阳光作能量，把水和二氧化碳变成糖和氧气。||阳光的作用|水和二氧化碳|糖和氧气');
const s = t.createSession(lesson, { maxRounds: 4 });

const rows = [];
const seenProbes = [];   // 从事件流收集全部探测（顺带验证事件本身也带类型）
const onEv = (e) => {
  if (e.type === 'ask') {
    seenProbes.push({ name: e.name, type: e.probeType, text: e.text });
    rows.push(`  ${e.name}［${e.probeType || '?'}］：${e.text}`);
  }
  if (e.type === 'round_end') rows.push(`  ── 第${e.round}轮：学生抛出 ${e.probeCount} 枚探测（你答到了几枚，课后逐条对照着判）`);
};
await s.start(onEv, () => {});
for (const txt of ['阳光是能量的来源，植物用它把水和二氧化碳合成糖', '糖把能量存起来，氧气是副产物', '所以没有阳光这一条，后面全都不会发生']) {
  await s.reply(txt, onEv, () => {});
}
await s.finish(onEv, () => {});

const r = s.result;
console.log('【课堂实录】');
console.log(rows.join('\n'));
console.log('\n【学生前概念（他们带进课堂的旧想法）】');
for (const st of r.students) console.log('  ' + st.name + '：' + st.mis);

console.log('\n【人类教师的收益（全部是数得出来的事件）】');
console.log('  要点 ' + r.gains.points + ' 条 | 澄清型回答 ' + r.gains.clarifying + '/' + r.gains.replies +
  ' | 学生抛出探测 ' + r.gains.probes + ' 枚（' + (r.gains.probeLine || '—') + '）' +
  ' | 你回了 ' + r.gains.answered + ' 枚 · 还有 ' + r.gains.open + ' 枚没回（"答到没"由你课后逐条判，机器只数词）');
console.log('  ⚠ 已从产物中移除：avgR / finalP / H / completeness / resolved / caught / blindSpots / conceptCaught');
console.log('     （源头都是学生自评或 2-gram 噪声判定，是假理论；判定权交回人类）');

console.log('\n【五生共同写出的《课堂纪要》】(' + r.minutes.by + ')');
console.log(r.minutes.md.split('\n').slice(0, 16).join('\n'));
console.log('  ... 落盘：' + r.minutes.path + ' （' + fs.statSync(r.minutes.path).size + ' 字节）');

// ---- 换课题：问的必须跟着换（"不管输入什么都回那几句"的反证）----
const s2 = t.createSession(t.parseLesson('彩虹::雨后空气里的小水珠把阳光分开，就成了七种颜色的彩虹。||小水珠|阳光|七种颜色'), { maxRounds: 1 });
const probes2 = [];
await s2.start((e) => { if (e.type === 'ask') probes2.push(e.text); }, () => {});
const probeTexts2 = probes2.join(' | ');

const ok = [];
ok.push(['轮数=4', r.rounds.length === 4]);
ok.push(['五生均有前概念', r.students.every((x) => x.mis && x.mis.length > 4)]);
ok.push(['纪要非空', (r.minutes.md || '').length > 60]);
ok.push(['纪要已落盘', !!r.minutes.path && fs.existsSync(r.minutes.path)]);

// ---- 探测是产品的一等公民 ----
ok.push(['每轮每人都抛出探测', seenProbes.length === 20, seenProbes.length + ' 枚']);
ok.push(['每枚探测都带类型', seenProbes.every((p) => !!p.type),
  [...new Set(seenProbes.map((p) => p.type))].join('/')]);
ok.push(['六类探测都出现过', new Set(seenProbes.map((p) => p.type)).size === 6,
  [...new Set(seenProbes.map((p) => p.type))].join('/')]);
ok.push(['probes 与事件流一致', (r.probes || []).length === seenProbes.length,
  (r.probes || []).length + ' vs ' + seenProbes.length]);
ok.push(['探测带要点序号（可按要点统计接住率）', (r.probes || []).every((p) => typeof p.ci === 'number')]);
ok.push(['按要点归拢原始提问 probeByConcept 覆盖每个要点', Array.isArray(r.probeByConcept) && r.probeByConcept.length === r.concepts.length,
  r.probeByConcept.map((c) => c.concept).join(' / ')]);
ok.push(['每个要点的 asks 都是真实文本（他问的那句原话）', r.probeByConcept.every((c) => Array.isArray(c.asks) && c.asks.every((a) => a.say && a.name))]);

// ---- 一轮之内：要点全覆盖 + 五人类型不撞车（这样人一次能看见整篇讲解上所有的洞）----
// 注意：要点只有 3 个而学生有 5 个，所以"五个 ci 互不相同"是**做不到的**（数学上不可能）。
// 真正该保证的是：①一轮之内每个要点都被问到 ②五人抛的探测类型互不相同。
const r1 = (r.probes || []).filter((p) => p.round === 1);
ok.push(['第1轮覆盖了全部要点', new Set(r1.map((p) => p.ci)).size === r.concepts.length,
  [...new Set(r1.map((p) => p.ci))].sort().join(',') + ' / 共 ' + r.concepts.length + ' 个要点']);
ok.push(['第1轮五人抛的探测类型互不相同', new Set(r1.map((p) => p.type)).size === 5,
  r1.map((p) => p.type).join(',')]);

// ---- 输入变了 → 问的就变了 ----
ok.push(['换课题后学生问的跟着换', probes2.length === 5 && !/光合|氧气|二氧化碳/.test(probeTexts2),
  probeTexts2.slice(0, 60)]);
ok.push(['新课题的提问引用了新课题的词', /彩虹|雨|小水珠|颜色/.test(probeTexts2)]);

// ---- 假理论残留检查（这几条是这次改动的核心，必须一直是绿的）----
ok.push(['教师收益不再自动判定"答到了没有"（无 blindSpots / caught / judged / caughtRate）',
  !('blindSpots' in r.gains) && !('caught' in r.gains) && !('judged' in r.gains) && !('caughtRate' in r.gains)]);
ok.push(['教师收益不含"学生理解度"类字段',
  !('resolved' in r.gains) && !('avgR' in r.gains) && !('completeness' in r.gains)]);
ok.push(['产物不含知识状态矩阵 finalP', !('finalP' in r)]);
ok.push(['产物不含 avgR / H', !('avgR' in r) && !('H' in r)]);

console.log('\n【断言】');
let fail = 0;
for (const [k, v, extra] of ok) {
  console.log('  ' + (v ? '✅' : '❌') + ' ' + k + (extra ? '   ' + extra : ''));
  if (!v) fail++;
}
console.log(fail ? ('\n❌ ' + fail + ' 项失败') : '\n全部通过 ✅');
process.exit(fail ? 1 : 0);
