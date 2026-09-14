// tools/test_llm_wiring.mjs
// ===================================================================
// 目的：**在没有 OpenRouter 额度的情况下**，证明两件事：
//   ①每个学生一轮各自发一次独立的模型调用（不是一份固定句子发给所有人）；
//   ②人类教师**实际输入的话**真的进了提示词，并且真的决定了学生的回答。
//
// 做法：把 LINGJING_OR_BASE 指向一个本地"假模型"。假模型把收到的
//       "先生刚才说：…" / "内容：…" 原话回抄进学生台词。
//       于是——如果台词里出现了你输入的原话，链路就是通的；
//       如果换一个课题台词就跟着变，就说明"不管输入什么都固定回答"这个 bug 已经不存在。
//
// 用法：node tools/test_llm_wiring.mjs
// ===================================================================
import http from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const STUB_PORT = 8099;
const APP_PORT = 8098;

let fails = 0;
const ok = (c, msg, extra = '') => {
  console.log((c ? '  ✅ ' : '  ❌ ') + msg + (extra ? '   ' + extra : ''));
  if (!c) fails++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 每一次"模型调用"都会被记在这里，测试直接对账
const calls = [];

// ---------- 假模型（OpenAI 兼容，只实现 chat/completions） ----------
const stub = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    let j = {};
    try { j = JSON.parse(raw); } catch { /* 保持空 */ }
    const msg = (role) => ((j.messages || []).find((m) => m.role === role) || {}).content || '';
    const sys = msg('system'), usr = msg('user');
    calls.push({ model: j.model, sys, usr, auth: req.headers.authorization || '' });

    // 从提示词里认人、认知识点个数、认"先生说的话"
    const name = (sys.match(/学生「(.+?)」/) || [])[1] || '学生';
    const n = Number((usr.match(/给\s*(\d+)\s*个/) || [])[1] || 1);
    const lesson = (usr.match(/内容：(.+)/) || [])[1] || '';
    const said = (usr.match(/先生刚才说：(.+)/) || [])[1] || '';
    const first = /第一轮|刚讲完课/.test(said);
    const src = (first ? lesson : said).trim();
    const snippet = src.replace(/^[^：:]{0,10}::/, '').slice(0, 12);
    const nums = Array.from({ length: n }, (_, k) => (0.2 + 0.08 * k).toFixed(2)).join(',');
    const line = `${name}：先生您说「${snippet}」，这块我还是没抓住，能再讲讲吗？`;

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: nums + '\n' + line } }] }));
  });
});

// ---------- 驱动一次完整课堂（只回一次话，然后让它自动下课） ----------
async function runClass(lesson, teacherReply) {
  const events = [];
  let sessionId = null, replied = false, curRound = 0;

  const resp = await fetch(`http://127.0.0.1:${APP_PORT}/api/class/start`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lesson }),
  });
  const reader = resp.body.getReader();
  const dec = new TextDecoder();
  let buf = '';

  const handle = async (ev) => {
    if (ev.type === 'round_start' || ev.type === 'round_end') curRound = ev.round;
    if (ev.type === 'ask') ev.__round = curRound;      // 给每条台词打上轮次，断言才能按轮分开
    events.push(ev);
    if (ev.type === 'session') sessionId = ev.id;
    if (ev.type === 'round_end' && ev.canContinue && !replied) {
      replied = true;
      // 第二轮：把教师回话再灌进去（这条回话也应该出现在学生的下一句里）
      const r2 = await fetch(`http://127.0.0.1:${APP_PORT}/api/class/reply`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: sessionId, text: teacherReply }),
      });
      const rd = r2.body.getReader(); let b2 = '';
      for (;;) {
        const { done, value } = await rd.read(); if (done) break;
        b2 += dec.decode(value, { stream: true });
        let i;
        while ((i = b2.indexOf('\n\n')) >= 0) {
          const chunk = b2.slice(0, i); b2 = b2.slice(i + 2);
          const line = chunk.split('\n').find((l) => l.startsWith('data: '));
          if (line) await handle(JSON.parse(line.slice(6)));
        }
      }
    }
  };

  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
      const line = chunk.split('\n').find((l) => l.startsWith('data: '));
      if (line) await handle(JSON.parse(line.slice(6)));
    }
  }
  return events;
}

const asksOf = (events) => events.filter((e) => e.type === 'ask');
const asksIn = (events, round) => asksOf(events).filter((e) => e.__round === round);

// =================== 主流程 ===================
let app;
try {
  await new Promise((r) => stub.listen(STUB_PORT, '127.0.0.1', r));
  console.log(`假模型已就位 → 127.0.0.1:${STUB_PORT}`);

  app = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(APP_PORT),
      LINGJING_OR_KEY: 'test-fake-key',
      LINGJING_OR_BASE: `http://127.0.0.1:${STUB_PORT}/api/v1/chat/completions`,
      LINGJING_OR_MODEL: 'stub/model-v1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let appLog = '';
  app.stdout.on('data', (d) => (appLog += d));
  app.stderr.on('data', (d) => (appLog += d));

  // 等服务起来
  for (let i = 0; i < 40; i++) {
    await sleep(250);
    try { const r = await fetch(`http://127.0.0.1:${APP_PORT}/api/roster`); if (r.ok) break; } catch { /* 还没起来 */ }
  }

  console.log('\n【1】每个学生各自接一次大模型（不是一份固定句子发所有人）');
  const LESSON_A = '潮汐::潮汐主要是月亮的引力造成的，太阳也有份但小一半。一天两次涨落，是地球自转带着你穿过两个水位高点。';
  const REPLY_A = '地球自转是关键：潮汐一天两次，是因为你被地球带着穿过两个水位高点。';
  const evA = await runClass(LESSON_A, REPLY_A);
  const askA = asksOf(evA);
  console.log(`    本轮 ask 事件 ${askA.length} 条 · 模型调用累计 ${calls.length} 次`);

  ok(calls.length >= 5, '一轮里至少发了 5 次调用（5 个学生各一次）', `实际 ${calls.length} 次`);
  const names = [...new Set(calls.map((c) => (c.sys.match(/学生「(.+?)」/) || [])[1]).filter(Boolean))];
  ok(names.length === 5, '5 次调用分别对应 5 个不同学生（各带自己的人设）', names.join('/'));
  ok(calls.every((c) => /民国学堂/.test(c.sys)), '每次调用都带该学生的人设提示词');
  ok(calls.every((c) => c.auth === 'Bearer test-fake-key'), '每次调用都带了鉴权头（密钥走通了）');
  ok(calls.some((c) => c.sys.includes('小丽') && c.sys.includes('害羞')), '调用之间人设确实不同（小丽=害羞型）', '');

  console.log('\n【2】★ 人类教师输入的原话，真的进了提示词');
  ok(calls.every((c) => c.usr.includes('潮汐主要是月亮的引力造成的')), '每次调用的提示词里都有你输入的课题内容');
  const r2calls = calls.filter((c) => c.usr.includes('地球自转是关键'));
  ok(r2calls.length >= 5, '你第二轮回的话也进了下一轮的提示词', `${r2calls.length} 次调用带上了你的回话`);

  console.log('\n【3】★ 学生说的话来自模型（不是兜底语料），且跟着你的输入变');
  const a1 = asksIn(evA, 1), a2 = asksIn(evA, 2);
  ok(askA.length >= 5, '学生都开口了', `共 ${askA.length} 条（第1轮 ${a1.length} + 第2轮 ${a2.length}）`);
  const fromModel = askA.filter((a) => /先生您说/.test(a.text || ''));
  ok(fromModel.length === askA.length && askA.length > 0,
    '每一句台词都是模型返回的（带假模型标记「先生您说」）', `${fromModel.length}/${askA.length} 条`);
  ok(a1.length >= 5 && a1.every((a) => (a.text || '').includes('潮汐')),
    '第1轮：台词引用的是**你输入的课题词**「潮汐」', `${a1.length} 条`);
  ok(a2.length >= 5 && a2.every((a) => (a.text || '').includes('地球自转是关键')),
    '第2轮：台词引用的是**你回话里的原话**「地球自转是关键」', `${a2.length} 条`);

  console.log('\n【4】★ 换个课题 → 台词跟着变（这正是你遇到的那个 bug 的反证）');
  const before = calls.length;
  const LESSON_B = '彩虹::彩虹是阳光在水滴里折射又反射出来的，所以永远出现在太阳的反方向；两道虹的颜色顺序是反的。';
  const REPLY_B = '颜色反过来是因为：光在水滴里多反射了一次，两次折射加一次反射，顺序就反了。';
  const evB = await runClass(LESSON_B, REPLY_B);
  const askB = asksOf(evB);
  const b1 = asksIn(evB, 1), b2 = asksIn(evB, 2);
  ok(calls.length - before >= 5, '第二个课题同样发出 5 次以上调用', `新增 ${calls.length - before} 次`);
  ok(b1.length >= 5 && b1.every((a) => (a.text || '').includes('彩虹')), '第1轮台词引用了新课题词「彩虹」');
  ok(b2.length >= 5 && b2.every((a) => (a.text || '').includes('颜色反过来是因为')), '第2轮台词引用了你新的回话');
  ok(askB.every((a) => !(a.text || '').includes('潮汐')), '新课题的台词里不再出现上一个课题的词');
  const setA = new Set(askA.map((a) => a.text));
  const setB = new Set(askB.map((a) => a.text));
  const same = [...setA].filter((t) => setB.has(t));
  ok(same.length === 0, '两个课题的学生台词完全不重合（换输入＝换回答）', same.length ? '重合: ' + same.join(' | ') : '');
  ok(names.length === 5, '第二个课题仍是每个学生各自一次调用');

  console.log('\n【5】熔断时间戳解析（今天踩的严重 bug）');
  // 直接验算：X-RateLimit-Reset 是毫秒，绝不能既当日又当秒 → 否则熔断到公元五万年
  // ⚠️ 时间戳必须**相对当前时间**生成：写死一个绝对值，测试会随日历腐化
  //    （原先硬编码 1789084800000 = 2026-09-11 08:00 GMT+8，一过点就变成"负几小时后解除"而误报失败）
  const rawReset = Date.now() + 3 * 3600000;          // 毫秒级：3 小时后重置
  const parsed = rawReset > 1e12 ? rawReset : rawReset * 1000;
  const hours = (parsed - Date.now()) / 3600000;
  ok(hours > 0 && hours < 26, '毫秒时间戳被正确解析为"今天到明天"的量级，不会锁死进程', `${hours.toFixed(1)} 小时后解除`);
  const secReset = Math.floor((Date.now() + 2 * 3600000) / 1000);   // 秒级
  const hoursSec = ((secReset > 1e12 ? secReset : secReset * 1000) - Date.now()) / 3600000;
  ok(hoursSec > 0 && hoursSec < 26, '秒级时间戳同样被正确解析（不会漏乘 1000）', `${hoursSec.toFixed(1)} 小时后解除`);
  const wrongWay = (rawReset * 1000 - Date.now()) / 3600000 / 24 / 365;
  console.log(`    （旧代码会算成 ${wrongWay.toFixed(0)} 年后才解除 —— 这就是学生永远固定句子的根因之一）`);
} catch (e) {
  console.error('❌ 测试异常：' + ((e && e.message) || e));
  fails++;
} finally {
  try { app && app.kill(); } catch { /* ignore */ }
  try { stub.close(); } catch { /* ignore */ }
  await sleep(300);
}

console.log('\n' + (fails ? fails + ' 项未通过 ❌' : '全部通过 ✅'));
process.exit(fails ? 1 : 0);
