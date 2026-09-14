// 灵境·课室 —— HTTP 层端到端回归测试
// 为什么单独测 HTTP 层：3D 页面走的是 POST /api/class/start + POST /api/class/reply（会话式、SSE），
// 与 tools/test_session.mjs 直接调 teacher.js 的路径不同；这里验证**页面真正会遇到的**契约：
//   ① GET /api/roster 一打开就能拿到 5 名学生（"一进来就在教室"依赖它）
//   ② start → 拿到 session id + 第 1 轮（学生带前概念 mis）
//   ③ reply ×N → 轮次推进，最后一轮自动 done
//   ④ done 必须带 gains（人类教师的收益）与 minutes（五生共同的《课堂纪要》作品）
// 用法：node tools/test_http_session.mjs   （需先启动 node server.js）

const BASE = process.env.LJ_BASE || 'http://127.0.0.1:8080';
const LESSON =
  '光合作用::阳光不是植物的「饭」，它只是能量的来源；植物真正吃的是自己用光和水造出来的糖。' +
  '叶子发黄，多半不是缺肥，而是缺光或水太多。';

let fails = 0;
const ok = (cond, msg, extra = '') => {
  console.log((cond ? '  ✅ ' : '  ❌ ') + msg + (extra ? '  ' + extra : ''));
  if (!cond) fails++;
};

// 读一条 SSE 流，逐条回调
async function sse(url, body, onEvent) {
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok || !resp.body) throw new Error('HTTP ' + resp.status);
  const reader = resp.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const seen = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const line = chunk.split('\n').find((l) => l.startsWith('data: '));
      if (!line) continue;
      const ev = JSON.parse(line.slice(6));
      seen.push(ev);
      onEvent(ev);
    }
  }
  return seen;
}

const t0 = Date.now();
console.log('【1】GET /api/roster —— 页面一打开就摆学生');
const roster = await (await fetch(BASE + '/api/roster')).json();
ok(Array.isArray(roster.students) && roster.students.length === 5, '返回 5 名学生', JSON.stringify(roster.students.map((s) => s.name)));
ok(roster.students.every((s) => s.name && s.trait), '每生都有名字与性格');
ok(roster.llm && typeof roster.llm.usable === 'boolean', '返回 LLM 可用性（诚实标注用）', JSON.stringify(roster.llm));

console.log('\n【2】POST /api/class/start —— 开课 + 第 1 轮');
let session = null;
let doneEv = null;
const mis = {};
const Rtrack = [];
const evs1 = await sse(BASE + '/api/class/start', { lesson: LESSON }, (ev) => {
  if (ev.type === 'session') session = ev.id;
  if (ev.type === 'start') (ev.students || []).forEach((s) => (mis[s.name] = s.mis));
  if (ev.type === 'ask') Rtrack.push({ round: ev.round, name: ev.name, probeType: ev.probeType });
  if (ev.type === 'round_end') Rtrack.push({ round: ev.round, probeCount: ev.probeCount, canContinue: ev.canContinue, llmOk: ev.llmOk });
  if (ev.type === 'done') doneEv = ev;
});
ok(!!session, '拿到 session id', String(session).slice(0, 8) + '…');
ok(evs1.some((e) => e.type === 'start'), '收到 start 事件');
ok(evs1.some((e) => e.type === 'ask'), '第 1 轮学生有发言');
ok(evs1.filter((e) => e.type === 'ask').every((e) => !!e.probeType), '每枚探测都带类型（事件流里也有）');
ok(Object.keys(mis).length === 5 && Object.values(mis).every((m) => m && m.length > 3), '5 名学生各有前概念（不是白纸）');
ok(evs1.some((e) => e.type === 'round_end' && e.canContinue === true), '第 1 轮结束且允许老师回话');

console.log('\n【3】POST /api/class/reply × N —— 老师回话，直到自动收尾');
let rounds = 1;
for (let i = 0; i < 6 && !doneEv; i++) {
  const r = (i + 1) * 100;
  await sse(BASE + '/api/class/reply', { id: session, text: `我再说清楚一点（第 ${i + 1} 次追问的回应）。` }, (ev) => {
    if (ev.type === 'ask') Rtrack.push({ round: ev.round, name: ev.name, probeType: ev.probeType });
    if (ev.type === 'round_end') { rounds = Math.max(rounds, ev.round); Rtrack.push({ round: ev.round, probeCount: ev.probeCount }); }
    if (ev.type === 'done') doneEv = ev;
    if (ev.type === 'error') console.log('    (error)', ev.message);
  });
}
const rEnds = Rtrack.filter((x) => x.probeCount != null);
ok(rounds >= 2, '课堂推进了多轮', '共 ' + rounds + ' 轮');
ok(!!doneEv, '最后一轮自动 done（无需额外调用）');
ok(rEnds.length >= 2, 'round_end 带探测计数（每轮学生抛了几枚探测）',
  rEnds.map((r) => 'R' + r.round + '=' + r.probeCount + '枚').join(' '));

console.log('\n【4】done —— 人类教师的收益 + 五生共同的作品');
if (doneEv) {
  const g = doneEv.gains || {};
  const m = doneEv.minutes || {};
  ok(g && typeof g.points === 'number', 'gains.points（你讲出的要点）', String(g.points));
  ok(typeof g.probes === 'number', 'gains.probes（学生抛出多少枚探测）', String(g.probes));
  ok(typeof g.answered === 'number' && typeof g.open === 'number', 'gains.answered / open（你回了 / 还没回，纯计数）', g.answered + ' / ' + g.open);
  ok(typeof g.probeLine === 'string', 'gains.probeLine 给出六类构成人话', g.probeLine || '—');
  ok(!('completeness' in g) && !('resolved' in g) && !('caught' in g) && !('caughtRate' in g) && !('judged' in g) && !('blindSpots' in g), '已删除 completeness / resolved / caught / caughtRate / judged / blindSpots（假理论）');
  ok(!!m.md && m.md.length > 60, '《课堂纪要》非空（作品）', (m.md || '').length + ' 字');
  ok(m.md.includes('课堂纪要') || m.md.includes('先生'), '纪要含预期小节内容');
  ok(!/我们弄明白了/.test(m.md), '纪要不再写"我们弄明白了"（AI 学生说"我懂了"是演戏，不是事实）');
  ok(!!m.path, '纪要已落盘', m.path || m.error || '');
  ok(!('avgR' in doneEv) && !('finalP' in doneEv) && !('H' in doneEv) && !('conceptCaught' in doneEv), 'done 里不再有 avgR / finalP / H / conceptCaught');
  ok(Array.isArray(doneEv.probes) && doneEv.probes.every((p) => !!p.type), 'done.probes 每题带类型', (doneEv.probes || []).length + ' 枚');
  ok(doneEv.students.length === 5, '5 名学生都在产物里');
  console.log('\n  ── 纪要前 12 行 ──');
  console.log((m.md || '').split('\n').slice(0, 12).map((l) => '  ' + l).join('\n'));
} else {
  ok(false, 'done 事件缺失（以下断言跳过）');
}

console.log('\n耗时 ' + ((Date.now() - t0) / 1000).toFixed(1) + 's ｜ ' + (fails ? fails + ' 项未通过 ❌' : '全部通过 ✅'));
process.exit(fails ? 1 : 0);
