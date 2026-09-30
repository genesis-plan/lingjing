'use strict';
// cards-routes 冒烟测试：全部走注入的内存 ctx，不碰磁盘。
const assert = require('assert');
const { Readable } = require('stream');
const Cards = require('../cards-routes.js');

let pass = 0, fail = 0;
function t(name, fn) { fn() && fn(); }
function t2(name, fn) {
  try { fn(); console.log('  ✓ ' + name); pass++; }
  catch (e) { console.log('  ✗ ' + name + ' :: ' + e.message); fail++; }
}

const F1 = {
  date: '2026-09-29', lessonTitle: '如何给团队讲清楚复利',
  result: {
    concepts: ['复利'], uncovered: ['贴现率'],
    probes: [{ say: '「复利的反例」——亏本中断之后还叫复利吗？', type: 'counterexample', round: 3 }],
    mineRounds: ['复利是利息再产生利息。'],
  },
};
const F_JUNK = { hello: 'world' };

function memCtx(files) {
  const store = { queue: { cards: [] }, saved: 0 };
  return {
    sessionsDir: '<mem>',
    listSessionFiles() { return Object.keys(files); },
    readSession(f) { return files[f] != null ? JSON.parse(JSON.stringify(files[f])) : null; },
    statDate(f) { return files[f] && files[f].date ? files[f].date : ''; },
    loadQueue() { return JSON.parse(JSON.stringify(store.queue)); },
    saveQueue(q) { store.queue = JSON.parse(JSON.stringify(q)); store.saved++; },
    _store: store,
  };
}
function fakeRes() { return { status: null, body: null, writeHead(s) { this.status = s; }, end(b) { this.body = b; } }; }
function fakeReq(method, url, bodyObj) {
  const req = new Readable({ read() {} });
  if (bodyObj != null) { req.push(JSON.stringify(bodyObj)); }
  req.push(null);
  req.method = method; req.url = url; req.socket = { remoteAddress: 'test-ip' };
  return req;
}
async function call(method, url, ctx, bodyObj) {
  const req = fakeReq(method, url, bodyObj);
  const res = fakeRes();
  const handled = await Cards.handle(req, res, ctx);
  return { handled, status: res.status, body: res.body ? JSON.parse(res.body) : null };
}

async function main() {
  console.log('cards-routes 冒烟');

  // 非卡片路径：必须返回 false（不吞别的路由）
  {
    const r = await call('GET', '/api/roster', memCtx({}));
    t2('非 /api/cards 路径返回 false 不拦截', () => assert.strictEqual(r.handled, false));
  }
  // sessions 列表
  {
    const r = await call('GET', '/api/cards/sessions', memCtx({ 's1.json': F1 }));
    t2('sessions 列出可识别的课', () => { assert(r.body.ok && r.body.sessions.length === 1); assert.strictEqual(r.body.sessions[0].lessonTitle, '如何给团队讲清楚复利'); });
  }
  {
    const r = await call('GET', '/api/cards/sessions', memCtx({ 'j.json': F_JUNK }));
    t2('A4 无法识别 → 诚实空态', () => assert(r.body.honestEmpty && r.body.honestEmpty.includes('空着不编')));
  }
  // share
  {
    const r = await call('GET', '/api/cards/share?file=s1.json', memCtx({ 's1.json': F1 }));
    t2('share 出两张 SVG', () => { assert.strictEqual(r.status, 200); assert(r.body.lessonSvg.includes('<svg')); assert(r.body.blindSvg.includes('<svg')); });
  }
  {
    const r = await call('GET', '/api/cards/share?file=../etc', memCtx({}));
    t2('路径穿越被拒（400）', () => assert.strictEqual(r.status, 400));
  }
  {
    const r = await call('GET', '/api/cards/share?file=j.json', memCtx({ 'j.json': F_JUNK }));
    t2('A4 无课结果 → 404 空着不编', () => { assert.strictEqual(r.status, 404); assert(r.body.error.includes('空着不编')); });
  }
  // 中文课名文件（真实产品里 base 含中文课题）——回归：safeFile 必须放行 Unicode、仍禁穿越
  {
    const CN = '2026-09-30T00-00-00-手机摄影-cards.json';
    const r = await call('GET', '/api/cards/share?file=' + encodeURIComponent(CN), memCtx({ [CN]: F1 }));
    t2('中文课名文件可出卡（回归 09-30 冒烟）', () => { assert.strictEqual(r.status, 200); assert(r.body.lessonSvg.includes('<svg')); });
    const bad = await call('GET', '/api/cards/share?file=' + encodeURIComponent('..\\手机.json'), memCtx({}));
    t2('穿越（反斜杠）仍被拒（400）', () => assert.strictEqual(bad.status, 400));
  }
  // 播种：队列文件为空时，due 必须从未答追问播种（回归 09-30 冒烟：队列永远空）
  {
    const ctx = memCtx({ 's1.json': F1 });
    const r = await call('GET', '/api/cards/due?today=2026-09-30', ctx);
    t2('due 从课数据播种未答追问', () => {
      assert.strictEqual(r.body.cards.length, 2); // 1 未答探测 + 1 uncovered 派生
      assert.strictEqual(ctx._store.saved, 1);   // 播种落盘一次
      assert(r.body.cards[0].id.startsWith('Q::'));
    });
    const id = r.body.cards[0].id;
    const ok = await call('POST', '/api/cards/answer', ctx, { id, said: 'yes', date: '2026-09-30' });
    t2('播种后的卡可作答落账', () => { assert(ok.body.ok); assert(ok.body.card.streak === 1 || ok.body.card.streak === 0); });
  }
  // due + answer
  {
    const ctx = memCtx({});
    ctx._store.queue = { cards: [{ id: 'Q::x', question: '问', kind: 'probe', firstAsked: '2026-09-01', dueDate: '2026-09-02', streak: 0, answers: [] }] };
    const r0 = await call('GET', '/api/cards/due?today=2026-09-01', ctx);
    t2('未到期不出', () => assert.strictEqual(r0.body.cards.length, 0));
    const r1 = await call('GET', '/api/cards/due?today=2026-09-03', ctx);
    t2('到期出卡', () => assert.strictEqual(r1.body.cards.length, 1));
  }
  {
    const ctx = memCtx({});
    ctx._store.queue = { cards: [{ id: 'Q::y', question: '问', kind: 'probe', firstAsked: '2026-09-01', dueDate: '2026-09-02', streak: 0, answers: [] }] };
    const bad = await call('POST', '/api/cards/answer', ctx, { id: 'Q::y', said: 'maybe' });
    t2('A2 非二元自判拒绝（400）', () => assert.strictEqual(bad.status, 400));
    const ok = await call('POST', '/api/cards/answer', ctx, { id: 'Q::y', said: 'yes', date: '2026-09-30' });
    t2('answer 落账并持久化', () => { assert(ok.body.ok); assert.strictEqual(ctx._store.saved, 1); assert.strictEqual(ok.body.card.streak, 1); assert.strictEqual(ok.body.card.dueDate, '2026-10-03'); });
    const nf = await call('POST', '/api/cards/answer', ctx, { id: 'Q::nope', said: 'yes' });
    t2('未知卡 id → 404', () => assert.strictEqual(nf.status, 404));
  }
  // ledger
  {
    const r = await call('GET', '/api/cards/ledger', memCtx({ 's1.json': F1 }));
    t2('ledger 汇总账本 + 闭环时刻字段', () => { assert(r.body.ok); assert.strictEqual(r.body.totalGaps, 2); assert.strictEqual(r.body.openCount, 2); assert(Array.isArray(r.body.closureMoments)); });
  }
  // 未知 cards 子路径
  {
    const r = await call('GET', '/api/cards/nope', memCtx({}));
    t2('未知子路径 404', () => assert.strictEqual(r.status, 404));
  }

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error('测试崩溃:', e); process.exit(1); });
