'use strict';
// cards-routes：把「认知镜像卡 / 盲区账本 / 会回来的卡」挂进灵境 server.js 的最小路由层。
//
// 设计约束：
//   零侵入 —— server.js 只加 2 处：顶部 require + 路由链里 3 行（见 应用说明.md）；
//             页面本体是 public/cards.html，走现有 serveStatic，无需任何服务端改动。
//   A1/A2/A3/A4 与三个数据模块同源；本文件只做 HTTP 编排，不含任何教学/判定逻辑。
//   可注入 —— ctx 全部可注入（测试用内存桩），默认实现读 <仓库>/sessions/。
//
// 默认存储（唯一需要与仓库对齐的点，已隔离在 extractResult()/defaultCtx() 两处）：
//   课结果：sessions/*.json 里可识别 result 形状（probes/uncovered/concepts/mineRounds）；
//           若 world.js 的落盘格式不同，只需改 extractResult() 一个函数。
//   回卡队列：sessions/cards-queue.json（sessions/ 已 gitignore，用户数据不入库）。

const fs = require('fs');
const path = require('path');
const sc = require('./share-card.js');
const ledgerMod = require('./blindspot-ledger.js');
const rc = require('./return-cards.js');

// ── 小工具 ──────────────────────────────────────────────────────────
function safeFile(s) {
  const t = String(s || '').trim();
  // 允许 Unicode 字母/数字（真实课名是中文，如「手机摄影」）；仍禁路径分隔符、禁 ..
  if (!t || !/^[\p{L}\p{N}_.-]+$/u.test(t) || t.includes('..')) return null;
  return t;
}
function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let n = 0; const ch = [];
    req.on('data', (d) => { n += d.length; if (n > limit) { reject(Object.assign(new Error('body too large'), { status: 413 })); req.destroy(); } else ch.push(d); });
    req.on('end', () => resolve(Buffer.concat(ch).toString('utf8')));
    req.on('error', reject);
  });
}
function json(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}
// 软限流（30/min/IP）：与 server.js 的 rateOk 同参数；合并进其正则属可选优化。
const _hit = new Map();
function rateOk(ip) {
  const now = Date.now(); const win = now - 60000;
  const arr = (_hit.get(ip) || []).filter((t) => t > win);
  if (arr.length >= 30) { _hit.set(ip, arr); return false; }
  arr.push(now); _hit.set(ip, arr); return true;
}

// ── 结果抽取（与仓库落盘格式的唯一对齐点）───────────────────────────
// 识别「result 形状」：含 probes/uncovered/concepts/mineRounds 之一即可。
function extractResult(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const cand = obj.result && typeof obj.result === 'object' ? obj.result : obj;
  const pick = (k) => (Array.isArray(cand[k]) ? cand[k] : undefined);
  const has = pick('probes') || pick('uncovered') || pick('concepts') || pick('mineRounds');
  if (!has) return null;
  const date = normDate(obj.date || obj.savedAt || obj.saved_at || '');
  return {
    probes: pick('probes') || [],
    uncovered: pick('uncovered') || [],
    concepts: pick('concepts') || [],
    mineRounds: pick('mineRounds') || [],
    lessonTitle: String(obj.lessonTitle || obj.lesson || obj.title || '这一课'),
    date,
  };
}
function normDate(s) {
  const t = String(s || '');
  return /^\d{4}-\d{2}-\d{2}/.test(t) ? t.slice(0, 10) : '';
}

// ── 默认 ctx（读 sessions/；测试注入内存版）────────────────────────
function defaultCtx() {
  const dir = path.join(__dirname, 'sessions');
  const queueFile = path.join(dir, 'cards-queue.json');
  return {
    sessionsDir: dir,
    listSessionFiles() {
      try { return fs.readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'cards-queue.json').sort(); }
      catch (e) { return []; }
    },
    readSession(f) {
      try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); }
      catch (e) { return null; }
    },
    statDate(f) {
      try { return new Date(fs.statSync(path.join(dir, f)).mtime).toISOString().slice(0, 10); }
      catch (e) { return ''; }
    },
    loadQueue() {
      try { return JSON.parse(fs.readFileSync(queueFile, 'utf8')); }
      catch (e) { return { cards: [] }; }
    },
    saveQueue(q) {
      try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
      fs.writeFileSync(queueFile, JSON.stringify(q, null, 2));
    },
  };
}
// 抽取全部课结果（按日期正序；无 date 用文件 mtime——可观测，不编造）
function loadResults(ctx) {
  const out = [];
  for (const f of ctx.listSessionFiles()) {
    const r = extractResult(ctx.readSession(f));
    if (r) out.push({ file: f, ...r, date: r.date || ctx.statDate(f) });
  }
  return out.sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

// 播种/合并回卡队列（幂等）：新课的未答追问按稳定 id（'Q::'+normKey）并入；
// 已有卡原样保留（答案历史只增不丢，A3）；只在真有新增时落盘。
function seedQueue(c) {
  const persisted = c.loadQueue() || { cards: [] };
  const byId = new Map((persisted.cards || []).map((x) => [x.id, x]));
  const rs = loadResults(c).map((r) => ({ date: r.date, result: r }));
  const fresh = rc.buildQueue(rs) || { cards: [] };
  for (const card of fresh.cards) if (!byId.has(card.id)) byId.set(card.id, card);
  const merged = { cards: [...byId.values()] };
  if (merged.cards.length !== (persisted.cards || []).length) c.saveQueue(merged);
  return merged;
}

// ── 路由本体 ────────────────────────────────────────────────────────
function isCards(url) {
  return String(url || '/').split('?')[0].startsWith('/api/cards');
}

async function handle(req, res, ctx) {
  if (!isCards(req.url)) return false;
  const c = ctx || defaultCtx();
  const u = String(req.url || '/');
  const pathname = u.split('?')[0];
  const query = new URLSearchParams(u.split('?')[1] || '');
  const ip = (req.socket && req.socket.remoteAddress) || '?';

  try {
    if (req.method === 'POST' && !rateOk(ip)) return json(res, 429, { ok: false, error: 'too many requests' }), true;

    // GET /api/cards/sessions —— 可带走卡的课列表
    if (req.method === 'GET' && pathname === '/api/cards/sessions') {
      const list = loadResults(c).map((r) => ({ file: r.file, date: r.date, lessonTitle: r.lessonTitle }));
      return json(res, 200, { ok: true, sessions: list, honestEmpty: list.length ? null : '还没有可带走的课。空着不编。' }), true;
    }

    // GET /api/cards/share?file=xxx —— 两张卡（SVG 文本）
    if (req.method === 'GET' && pathname === '/api/cards/share') {
      const f = safeFile(query.get('file'));
      if (!f) return json(res, 400, { ok: false, error: 'bad file' }), true;
      const r = extractResult(c.readSession(f));
      if (!r) return json(res, 404, { ok: false, error: '这份数据里没有可识别的课结果。空着不编。' }), true;
      const date = r.date || c.statDate(f);
      const opts = { lessonTitle: r.lessonTitle, result: r, date };
      return json(res, 200, {
        ok: true, file: f, date, lessonTitle: r.lessonTitle,
        lessonSvg: sc.shareCardSvg(opts), blindSvg: sc.blindCardSvg(opts),
      }), true;
    }

    // GET /api/cards/due?today=YYYY-MM-DD —— 今天该回来的卡
    if (req.method === 'GET' && pathname === '/api/cards/due') {
      const q = seedQueue(c);
      const today = normDate(query.get('today')) || new Date().toISOString().slice(0, 10);
      return json(res, 200, { ok: true, today, cards: rc.dueCards(q, { today }) }), true;
    }

    // GET /api/cards/ledger —— 盲区账本
    if (req.method === 'GET' && pathname === '/api/cards/ledger') {
      const rs = loadResults(c);
      const L = ledgerMod.buildLedger(rs.map((r) => ({ date: r.date, result: r })));
      return json(res, 200, { ok: true, ...L, closureMoments: ledgerMod.closureMoments(L, 5) }), true;
    }

    // POST /api/cards/answer —— 回卡二元自判 {id, said:'yes'|'no', date?}
    if (req.method === 'POST' && pathname === '/api/cards/answer') {
      let body = {};
      try { body = JSON.parse(await readBody(req) || '{}'); } catch (e) { return json(res, 400, { ok: false, error: 'bad json' }), true; }
      const id = String(body.id || '');
      const said = body.said === 'yes' ? 'yes' : body.said === 'no' ? 'no' : null;
      const date = normDate(body.date) || new Date().toISOString().slice(0, 10);
      if (!id || !said) return json(res, 400, { ok: false, error: 'need id and said(yes|no)' }), true;
      const q0 = seedQueue(c);
      const q1 = rc.recordAnswer(q0, id, { date, said });
      const card = q1.cards.find((x) => x.id === id);
      if (!card || card.answers.length === (q0.cards.find((x) => x.id === id) || { answers: [] }).answers.length) {
        return json(res, 404, { ok: false, error: 'no such card id' }), true;
      }
      c.saveQueue(q1);
      return json(res, 200, { ok: true, card }), true;
    }

    return json(res, 404, { ok: false, error: 'not found' }), true;
  } catch (e) {
    return json(res, (e && e.status) || 500, { ok: false, error: String((e && e.message) || e) }), true;
  }
}

module.exports = { isCards, handle, defaultCtx, extractResult, loadResults, safeFile };
