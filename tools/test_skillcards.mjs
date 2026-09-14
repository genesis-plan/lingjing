// 验 skillcards.mjs：用一堂"合成课"跑全流程，断言结构正确、数学在界内（非猜）。
import { buildDeck, deckToMarkdown, transferScore, flowState, SPACED_INTERVALS_DAYS } from '../public/skillcards.mjs';

const concepts = ['植物用阳光作能量', '叶子发黄多半是缺光或水多', '糖是植物自己造出来的饭'];
const difficulties = [0.55, 0.30, 0.45];
// ⚠️ 2026-09-11：finalP / conceptCaught 全部已废（源头是学生自评或 2-gram 噪声判定）。
//   卡片不再声称"你答到了多少"，改为把学生问过的原话摆在卡面当回顾题（真实文本）。
const transcript = [
  { round: 1, speaker: '小明', text: '那叶子发黄是不是因为缺肥？' },
  { round: 2, speaker: '小红', text: '先生说叶子发黄多半是缺光或水太多，我先确认一下' },
  { round: 3, speaker: '小刚', text: '糖是植物自己用光和水造出来的饭，像烧水那样？' },
  { round: 1, speaker: '你', text: '植物用阳光作能量，把水和二氧化碳变成糖和氧气' },
];
const ev = {
  lessonTitle: '光合作用',
  lessonText: '植物用阳光作能量，把水和二氧化碳变成糖（储存能量）和氧气。叶子发黄，多半不是缺肥，而是缺光或水太多。',
  concepts, difficulties,
  teachingEdges: 5,
  artifacts: 16,
  transcript,
  probes: [
    { round: 1, name: '小明', type: 'counter', say: '那要是反过来呢', ci: 0 },
    { round: 1, name: '小红', type: 'bound', say: '什么情况下叶子发黄就不算缺光', ci: 1 },
    { round: 2, name: '小刚', type: 'example', say: '我家里那盆算不算', ci: 2 },
  ],
  gains: {
    points: 3, replies: 3, clarifying: 2,
    probes: 3, probeLine: '反例 1 · 边界 1 · 正例 1', answered: 0, open: 3,
  },
  students: [{ name: '小明' }, { name: '小红' }, { name: '小刚' }, { name: '小丽' }, { name: '小华' }],
};

let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('  ✗ ' + msg); } else console.log('  ✓ ' + msg); };

console.log('== buildDeck ==');
const deck = buildDeck(ev, { heatEnergy: 1.6, heatRef: 4 });
ok(deck.cards.length === concepts.length, `卡片数 = 概念数 (${deck.cards.length})`);
deck.cards.forEach((c, i) => {
  ok(typeof c.front === 'string' && c.front.length > 4, `卡${i + 1} 正面回顾句非空`);
  ok(typeof c.back === 'string' && c.back.length > 0, `卡${i + 1} 背面要点非空`);
  ok(Array.isArray(c.schedule) && c.schedule[0] === 1, `卡${i + 1} 复习间隔从 1 天起`);
  ok(typeof c.difficulty === 'number' && c.difficulty >= 0, `卡${i + 1} 难度在界内 = ${c.difficulty}`);
});
ok(deck.cards[1].difficulty < deck.cards[0].difficulty, `最难概念难度(${deck.cards[1].difficulty}) < 最易(${deck.cards[0].difficulty})（难度来自课题，不来自学生）`);

console.log('== transferScore ==');
const t = transferScore(ev, { heatEnergy: 1.6, heatRef: 4 });
ok(t.K >= 0 && t.K <= 1, `K∈[0,1] = ${t.K}`);
ok(t.heatNorm > 0 && t.heatNorm <= 1, `heatNorm 归一 = ${t.heatNorm}`);
ok(t.edges === 5 && t.artifacts === 16, `world 边/作品计数正确 (${t.edges}/${t.artifacts})`);

console.log('== flowState ==');
const f = flowState(ev);
const STATES = ['apathy', 'anxiety', 'arousal', 'flow', 'control', 'boredom'];
ok(STATES.includes(f.state), `flow 态合法 = ${f.state}(${f.label})`);
ok(f.challenge >= 0 && f.challenge <= 1 && f.skill >= 0 && f.skill <= 1, `challenge/skill∈[0,1] = ${f.challenge}/${f.skill}`);

console.log('== deckToMarkdown ==');
const md = deckToMarkdown(deck);
ok(md.includes('# 《光合作用》· 课后卡片组'), 'Markdown 标题正确');
ok(md.includes('本课互动真实度 K'), 'Markdown 含互动真实度（不是"知识传入 AI"）');
ok(!/已传入 AI|AI 已吃透/.test(md), '卡片组里不再有"给 AI 打分"的话术');
ok(md.includes('卡上**没有**'), '卡片不再声称"你答到了百分之多少"（诚实标注）');
ok((md.match(/## 卡 /g) || []).length === concepts.length, 'Markdown 每概念一张卡');

console.log('\n== 摘要 ==');
console.log('K(互动真实度) =', t.K, '| 心流 =', f.label, `(${f.state})`, '| 卡片 =', deck.cards.length, '张');
console.log('间隔阶梯(天) =', SPACED_INTERVALS_DAYS.join('→'));

console.log(fails ? `\n❌ ${fails} 项断言失败` : '\n✅ 全部断言通过');
process.exit(fails ? 1 : 0);
