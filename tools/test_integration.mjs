// 集成验：跑真实的 teacher.js（无 key → 确定性兜底，不发网络），把 finalize 的真实 result
// 直接喂给 skillcards.mjs，确认整条链在真实数据形状下不出错。
import { runClassroom } from '../teacher.js';
import { buildDeck, deckToMarkdown, transferScore, flowState } from '../public/skillcards.mjs';
import fs from 'fs';
import path from 'path';

const r = await runClassroom(
  { title: '光合作用', content: '植物用阳光作能量，把水和二氧化碳变成糖（储存能量）和氧气。叶子发黄，多半不是缺肥，而是缺光或水太多。' },
  { maxRounds: 2, onLog: () => {} }
);

let fail = 0;
const ok = (c, m) => { if (!c) { fail++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

ok(Array.isArray(r.concepts) && r.concepts.length > 0, `teacher.js 产出 concepts(${r.concepts.length})`);
// ⚠️ 2026-09-11：原来的 finalP / avgR 断言已删——那两个量源头是学生自评理解度，是假理论。
//   现在校验的是真实事件产物：探测流 + 按要点归拢的原始提问。
ok(Array.isArray(r.probes) && r.probes.length > 0, `probes 探测流存在(${r.probes.length} 枚)`);
ok(r.probes.every((p) => !!p.type), '每枚探测都带类型（反例/边界/正例/区分/机制/应用）');
ok(Array.isArray(r.probeByConcept) && r.probeByConcept.length === r.concepts.length, `probeByConcept 覆盖每个要点`);
ok(!('finalP' in r) && !('avgR' in r) && !('H' in r) && !('conceptCaught' in r), '产物中不再有 finalP / avgR / H / conceptCaught（假理论已清）');
ok(r.teachingEdges === 5, `teachingEdges=${r.teachingEdges}`);
ok(r.artifacts > 0, `artifacts=${r.artifacts}`);

const deck = buildDeck(r, { heatEnergy: 1.5, heatRef: 4 });
ok(deck.cards.length === r.concepts.length, `真实产出 → 卡片数=概念数(${deck.cards.length})`);
ok(deck.cards.every((c) => c.front && c.back && c.schedule[0] === 1), '每张卡都有 正面/背面/间隔');
ok(deck.transfer.K >= 0 && deck.transfer.K <= 1, `真实 K=${deck.transfer.K}`);
ok(['apathy', 'anxiety', 'arousal', 'flow', 'control', 'boredom'].includes(deck.flow.state), `真实 flow=${deck.flow.state}`);
const md = deckToMarkdown(deck);
ok(md.includes('# 《光合作用》· 课后卡片组'), 'Markdown 标题正确');

console.log('\n真实课堂摘要：K=' + deck.transfer.K + ' flow=' + deck.flow.label + ' 卡片=' + deck.cards.length + '张');
console.log('--- 卡片组 Markdown 片段 ---');
console.log(md.split('\n').slice(0, 14).join('\n'));

// 清理 finalize 落盘的会话文件（验证产物，不留垃圾）
try {
  const dir = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'sessions');
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir)) if (f.includes('光合作用')) fs.unlinkSync(path.join(dir, f));
  }
} catch {}

console.log(fail ? `\n❌ ${fail} 项失败` : '\n✅ 集成验证全部通过');
process.exit(fail ? 1 : 0);
