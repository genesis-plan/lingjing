'use strict';
// 会回来的卡 冒烟测试：A1 只收未答追问 / A2 二元自判无评分 / A3 不改入参 / A4 空不编 / 确定性调度。
const assert = require('assert');
const rc = require('../return-cards.js');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log('  ✓ ' + name); pass++; }
  catch (e) { console.log('  ✗ ' + name + ' :: ' + e.message); fail++; }
}

const S1 = {
  date: '2026-09-29',
  result: {
    concepts: ['复利'],
    uncovered: ['贴现率'],
    probes: [{ say: '「复利的反例」——亏本中断之后还叫复利吗？', type: 'counterexample', round: 3 }],
  },
};
const S2 = {
  date: '2026-09-30',
  result: { concepts: ['复利', '贴现率'], uncovered: [], probes: [{ say: '讲过的那问', round: 1, answer: '这次答到了' }] },
};

console.log('会回来的卡 return-cards 冒烟');

t('A1 只收未答追问 + uncovered 派生（已答不收）', () => {
  const q = rc.buildQueue([S1]);
  assert.strictEqual(q.cards.length, 2, '1 probe + 1 derived');
  assert(q.cards.some((c) => c.question.includes('复利的反例')));
  assert(q.cards.some((c) => c.kind === 'derived' && c.question.includes('贴现率')));
});
t('已答过的追问不进队列（S2）', () => {
  const q = rc.buildQueue([S2]);
  assert.strictEqual(q.cards.length, 0);
  assert(q.honestEmpty && q.honestEmpty.includes('空着不编'));
});
t('首次到期=次日；key 与盲区账本同命名空间（Q::前缀）', () => {
  const q = rc.buildQueue([S1]);
  const c = q.cards[0];
  assert.strictEqual(c.dueDate, '2026-09-30');
  assert(c.id.startsWith('Q::'));
});
t('A2 答到了：streak+1、间隔递进 3→7→14；答到有据可查（append）', () => {
  let q = rc.buildQueue([S1]);
  const id = q.cards[0].id;
  q = rc.recordAnswer(q, id, { date: '2026-09-30', said: 'yes' });
  assert.strictEqual(q.cards[0].streak, 1);
  assert.strictEqual(q.cards[0].dueDate, '2026-10-03');   // 3 天
  q = rc.recordAnswer(q, id, { date: '2026-10-03', said: 'yes' });
  assert.strictEqual(q.cards[0].dueDate, '2026-10-10');   // 7 天
  q = rc.recordAnswer(q, id, { date: '2026-10-10', said: 'yes' });
  assert.strictEqual(q.cards[0].dueDate, '2026-10-24');   // 14 天
  assert.strictEqual(q.cards[0].answers.length, 3);
});
t('A2 还没：不惩罚不清零，明天再来', () => {
  let q = rc.buildQueue([S1]);
  const id = q.cards[0].id;
  q = rc.recordAnswer(q, id, { date: '2026-09-30', said: 'no' });
  assert.strictEqual(q.cards[0].streak, 0);
  assert.strictEqual(q.cards[0].dueDate, '2026-10-01');
});
t('A3 append-only：入参队列绝不被改写', () => {
  const q0 = rc.buildQueue([S1]);
  const snap = JSON.stringify(q0);
  rc.recordAnswer(q0, q0.cards[0].id, { date: '2026-09-30', said: 'yes' });
  assert.strictEqual(JSON.stringify(q0), snap);
});
t('dueCards 只出到期的；closureFacts 给闭环时刻', () => {
  let q = rc.buildQueue([S1]);
  const id = q.cards[0].id;
  assert.strictEqual(rc.dueCards(q, { today: '2026-09-29' }).length, 0);  // 明天才到期
  q = rc.recordAnswer(q, id, { date: '2026-09-30', said: 'yes' });
  const f = rc.closureFacts(q, 3);
  assert.strictEqual(f.length, 1);
  assert.strictEqual(f[0].closedDate, '2026-09-30');
  assert.strictEqual(f[0].streak, 1);
});
t('同一枚后来仍未答 ⇒ 保持尽快回来', () => {
  const S1b = JSON.parse(JSON.stringify(S1));
  const q = rc.buildQueue([S1, S1b]);
  const c = q.cards[0];
  assert.strictEqual(c.firstAsked, '2026-09-29');
});
t('A2 结构白名单：卡上字段只有计数/日期/状态/文本', () => {
  const q = rc.buildQueue([S1]);
  for (const c of q.cards) {
    for (const k of Object.keys(c)) assert(['id', 'question', 'kind', 'firstAsked', 'dueDate', 'streak', 'answers'].includes(k), '多余字段 ' + k);
  }
});

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
