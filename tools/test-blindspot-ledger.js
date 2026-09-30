'use strict';
// 盲区账本冒烟测试：A1 只用观测 / A2 零评分 / A3 不改输入 / A4 空不编 / 闭环纯可观测。
const assert = require('assert');
const { buildLedger, closureMoments } = require('../blindspot-ledger.js');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log('  ✓ ' + name); pass++; }
  catch (e) { console.log('  ✗ ' + name + ' :: ' + e.message); fail++; }
}

const S1 = {
  date: '2026-07-01',
  result: {
    concepts: ['复利', '单利'],
    uncovered: ['贴现率', '机会成本'],
    probes: [{ say: '「复利的反例」——亏本中断之后还叫复利吗？', type: 'counterexample', round: 3 }],
    mineRounds: ['复利是利息再产生利息。'],
  },
};
const S2 = {
  date: '2026-09-30',
  result: {
    concepts: ['复利', '贴现率', '时间价值'],   // 「贴现率」这次真的讲到了
    uncovered: ['机会成本'],                     // 「机会成本」仍没讲圆
    probes: [{ say: '那「时间价值」呢？', type: 'why', round: 2, answer: '讲到了' }],
    mineRounds: ['贴现率就是把未来的钱折算到今天。'],
  },
};

console.log('盲区账本 buildLedger 冒烟');

t('A1 盲区条目来自 uncovered 与未答追问', () => {
  const L = buildLedger([S1]);
  assert.strictEqual(L.totalGaps, 3, '2 uncovered + 1 未答追问');
  assert(L.gaps.some((g) => g.kind === 'uncovered' && g.label === '贴现率'));
  assert(L.gaps.some((g) => g.kind === 'question' && g.label.includes('复利的反例')));
});
t('闭环纯可观测：后来讲到 ⇒ closed（含闭环日期）', () => {
  const L = buildLedger([S1, S2]);
  const g = L.gaps.find((x) => x.label === '贴现率');
  assert(g && g.status === 'closed' && g.closedDate === '2026-09-30', JSON.stringify(g));
  assert.strictEqual(L.closedCount, 1);
});
t('仍没讲圆的保持 open；已答追问不记账', () => {
  const L = buildLedger([S1, S2]);
  const g = L.gaps.find((x) => x.label === '机会成本');
  assert(g && g.status === 'open' && g.lastSeenDate === '2026-09-30');
  assert.strictEqual(L.openCount, 2); // 机会成本 + 那条未答追问
  assert(!L.gaps.some((x) => x.label.includes('时间价值呢')));
});
t('closureMoments：事实闭环时刻（哪天开的缝、哪天讲圆）', () => {
  const ms = closureMoments(buildLedger([S1, S2]), 3);
  assert.strictEqual(ms.length, 1);
  assert.strictEqual(ms[0].label, '贴现率');
  assert.strictEqual(ms[0].daysOpen, 91);
});
t('A3 append-only：输入绝不被改写', () => {
  const snap = JSON.stringify([S1, S2]);
  buildLedger([S2, S1]);   // 乱序传入也要 internally 排序
  assert.strictEqual(JSON.stringify([S1, S2]), snap, '入参必须原样');
});
t('乱序输入按 date 内部排序，结果与正序一致', () => {
  const a = JSON.stringify(buildLedger([S1, S2]));
  const b = JSON.stringify(buildLedger([S2, S1]));
  assert.strictEqual(a, b);
});
t('A4 空输入诚实返回，不编造', () => {
  const L = buildLedger([]);
  assert.strictEqual(L.totalGaps, 0);
  assert(L.honestEmpty && L.honestEmpty.includes('空着不编'));
});
t('A2 输出零评分：字段只有计数/日期/状态', () => {
  const L = buildLedger([S1, S2]);
  for (const g of L.gaps) {
    for (const k of Object.keys(g)) assert(['label', 'kind', 'firstDate', 'lastSeenDate', 'status', 'closedDate'].includes(k), '多余字段 ' + k);
  }
});
t('同轮「又讲又没讲完」不自我闭环（自证无效）', () => {
  const L = buildLedger([{ date: '2026-09-30', result: { concepts: ['贴现率'], uncovered: ['贴现率'], probes: [] } }]);
  assert.strictEqual(L.gaps[0].status, 'open');
});

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
