// 灵境·课室 MVP —— 极简本地服务（纯 Node，无框架、无依赖、不部署）
// 让人点开浏览器就能当老师教课，看 AI 学生反应。本机跑，不过 .NET/Go/Unity/云 基建税。
// 运行： node server.js   →   浏览器开 http://localhost:8080
//       （LINGJING_OR_KEY 已配置则为真 LLM 学生；否则确定性兜底语料）
// 3D 课室：浏览器开 http://localhost:8080/classroom3d.html （Three.js 已本地化，无需联网）

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createSession, runClassroom, parseLesson } = require('./teacher.js');
const { World } = require('./world.js');
const { getStrangerId, recordVisit } = require('./retention.js'); // R-A1 身份 + R1 留存埋点
const llm = require('./llm.js'); // 硅基流动按功能组合（对话/推理/翻译/配图/语音/OCR）

const PORT = process.env.PORT || 8080;

// 会话式课堂（老师可中途回话，见 teacher.js createSession）：内存保存，进程重启即清空
const SESSIONS = new Map();
const SESSION_TTL_MS = 60 * 60 * 1000; // 1 小时
function newSessionId() { return crypto.randomBytes(9).toString('hex'); }
function gcSessions() {
  const now = Date.now();
  for (const [id, s] of SESSIONS) if (now - s.touchedAt > SESSION_TTL_MS) SESSIONS.delete(id);
}

// ===== 安全加固（合规/合法/安全 三维，2026-09-14）=====
// 理由：本产品会部署给公众（验证 R1），本地 MVP 也需把基本安全卫生做到位，避免上线即裸奔。
// 设计原则：fail-closed——任何一项失效都不能让课堂崩，只是降级防护。

// 安全响应头：防 MIME 嗅探 / 点击劫持 / referrer 泄露 / 注入载体。
// CSP 暂允许内联 script/style（MVP 用内联，路线：抽到外部文件 + nonce 后收紧到 'self'）。
function secHeaders() {
  return {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'",
  };
}
function applySec(res) { for (const [k, v] of Object.entries(secHeaders())) res.setHeader(k, v); }

// 客户端 IP（部署在反代后取 X-Forwarded-For 首跳；本地直连取 socket 地址）
function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length) return xff.split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
}

// 是否经 HTTPS 终止（决定 cookie 是否加 Secure）
function isHttps(req) {
  return !!(req.socket && req.socket.encrypted) ||
    (req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
}

// 极简滑动限流：每 IP 每分钟最多 RATE_MAX 次开课/回话（防部署后被刷/DoS）
const RATE = new Map();
const RATE_MAX = 30, RATE_WIN = 60 * 1000;
function rateOk(ip) {
  const now = Date.now();
  let e = RATE.get(ip);
  if (!e || now - e.t > RATE_WIN) e = { n: 0, t: now };
  e.n += 1; RATE.set(ip, e);
  return e.n <= RATE_MAX;
}

// 路径/文件名加固：只允许 [A-Za-z0-9_-]，杜绝 ../ 穿越与任意文件读
function safeName(s) { return String(s || '').replace(/[^A-Za-z0-9_-]/g, '_'); }

// 内容安全护栏（占位，fail-closed）：输出前对显式违规词脱敏，真实防护接内容安全 API（路线）
// 默认空清单（不误伤教学文本）；用 LINGJING_BLOCKLIST=词1,词2 注入，或接外部服务替换本函数。
const BLOCK = (process.env.LINGJING_BLOCKLIST || '').split(',').map((s) => s.trim()).filter(Boolean);
function redact(s) {
  if (typeof s !== 'string' || !BLOCK.length) return s;
  let out = s;
  for (const w of BLOCK) if (out.includes(w)) out = out.split(w).join('█'.repeat(Math.max(1, w.length)));
  return out;
}
// 递归脱敏事件对象里所有字符串字段（不破坏结构/类型，只替换违规子串）
function sanitize(obj) {
  if (Array.isArray(obj)) return obj.map(sanitize);
  if (obj && typeof obj === 'object') { const r = {}; for (const k of Object.keys(obj)) r[k] = sanitize(obj[k]); return r; }
  return redact(obj);
}

// 统一读请求体 + 体上限（防内存耗尽 DoS）：超 MAX_BODY 直接 413 并断开
const MAX_BODY = 256 * 1024;
function readBody(req, res, onEnd) {
  let body = '', tooBig = false;
  req.on('data', (c) => {
    if (tooBig) return;
    if (body.length + c.length > MAX_BODY) {
      tooBig = true;
      try { res.writeHead(413, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('payload too large'); } catch {}
      req.destroy();
      return;
    }
    body += c;
  });
  req.on('end', () => { if (!tooBig) onEnd(body); });
  req.on('error', () => {});
}

// 手工解析 multipart/form-data 的 file 字段（不引第三方库）：抽第一个 name="file" 的二进制
function parseMultipartFile(buf, boundary) {
  const b = Buffer.from('--' + boundary);
  let from = buf.indexOf(b), idxs = [];
  while (from !== -1) { idxs.push(from); from = buf.indexOf(b, from + b.length); }
  for (let i = 0; i < idxs.length; i++) {
    const next = idxs[i + 1];
    if (next === undefined) break;
    const part = buf.slice(idxs[i] + b.length, next);
    const hl = part.indexOf('\r\n\r\n');
    if (hl === -1) continue;
    const header = part.slice(0, hl).toString('utf8');
    if (!/name="file"/.test(header)) continue;
    const mimeM = header.match(/Content-Type:\s*([^\r\n]+)/i);
    const mime = mimeM ? mimeM[1].trim() : 'audio/webm';
    let content = part.slice(hl + 4);
    if (content.endsWith(Buffer.from('\r\n'))) content = content.slice(0, content.length - 2);
    return { buffer: content, mime };
  }
  return null;
}

// 静态资源 MIME（含 .js 必须是 text/javascript，否则浏览器拒绝把 ESM 当模块）
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function serveStatic(req, res) {
  applySec(res); // 安全响应头（所有静态响应）
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  // 2026-09-18 用户指示：课室背景要用「有窗户、有阳光照进来、有煤油灯」的战争年代照片课室，
  // 3D 程序化课室（空棕色盒子、学生被课桌挡住只剩头）"以后不要用" → 根路径回到照片课室。
  // 3D 变体仍保留在 /classroom3d.html（未删除，随时可改回这一行恢复为默认）。
  if (urlPath === '/') urlPath = '/classroom.html';
  // 防目录穿越：规范化后必须仍在 public/ 内
  const filePath = path.join(__dirname, 'public', path.normalize(urlPath));
  const publicRoot = path.join(__dirname, 'public');
  if (filePath !== publicRoot && !filePath.startsWith(publicRoot + path.sep)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('forbidden');
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  // 限流（安全）：开课/回话类端点每 IP 每分钟限次，超限 429。GET 与静态资源不在此列。
  if (req.method === 'POST' && /^\/api\/(class\/start|class\/reply|teach|llm|image|asr)$/.test(req.url.split('?')[0])) {
    if (!rateOk(clientIp(req))) {
      res.writeHead(429, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('too many requests');
      return;
    }
  }
  // GET /api/roster -> 学生的静态人设（供页面一打开就把学生摆进教室，无需等上课）。当前产品为「一面镜子」，只返回第一枚（小明）。
  if (req.method === 'GET' && req.url.split('?')[0] === '/api/roster') {
    const { PERSONALITIES } = require('./teaching.js');
    const body = JSON.stringify({
      students: PERSONALITIES.slice(0, 1).map((p) => ({ name: p.name, trait: p.trait, alpha: p.alpha, voice: p.voice, catch: p.catch })),
      llm: require('./teacher.js').llmStatus(),
    });
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', ...secHeaders() });
    res.end(body);
    return;
  }

  // POST /api/class/start  -> 开一堂课（会话式）：SSE 推 start + 第 1 轮，然后保持会话待老师回话
  if (req.method === 'POST' && req.url.split('?')[0] === '/api/class/start') {
    let body = '';
    req.on('data', (c) => {
      if (body.length + c.length > MAX_BODY) {
        try { res.writeHead(413, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('payload too large'); } catch {}
        req.destroy();
        return;
      }
      body += c;
    });
    req.on('end', async () => {
      const sc = getStrangerId(req, res); // R-A1：取/设匿名身份（须在 writeHead 前）
      let lesson, resumeWorld = null;
      try {
        const j = JSON.parse(body || '{}');
        lesson = parseLesson(typeof j.lesson === 'string' ? j.lesson : '');
        if (j.resumeWorld) resumeWorld = String(j.resumeWorld);
      } catch { lesson = parseLesson(''); }
      if (sc.tracked) recordVisit(sc.id, lesson.title, 'start'); // R1 数据层：开课即记一行（DNT 用户不追踪）
      gcSessions();
      const id = newSessionId();
      let world = null;
      if (resumeWorld) {
        try { world = World.load(path.join(__dirname, 'sessions', resumeWorld.replace(/[\/\\]/g, '_'))); }
        catch (e) { world = null; }
      }
      const sess = createSession(lesson, world ? { world } : undefined);
      SESSIONS.set(id, { sess, touchedAt: Date.now() });
      const headers = {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        ...secHeaders(),
      };
      if (sc.header) headers['Set-Cookie'] = sc.header;
      res.writeHead(200, headers);
      // 心跳（R-A2）：长轮次（每轮 ~25–30s）经空闲代理可能被掐；每 15s 发 SSE 注释行保活
      const hb = setInterval(() => { try { res.write(': keep-alive\n\n'); } catch {} }, 15000);
      const send = (obj) => res.write('data: ' + JSON.stringify(sanitize(obj)) + '\n\n');
      send({ type: 'session', id });
      try {
        await sess.start(send, () => {});
      } catch (e) {
        send({ type: 'error', message: String((e && e.message) || e) });
      } finally {
        clearInterval(hb);
        res.end();
      }
    });
    return;
  }

  // POST /api/class/reply  -> 老师回话，推下一轮；到最后一轮自动收尾（done）
  if (req.method === 'POST' && req.url.split('?')[0] === '/api/class/reply') {
    let body = '';
    req.on('data', (c) => {
      if (body.length + c.length > MAX_BODY) {
        try { res.writeHead(413, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('payload too large'); } catch {}
        req.destroy();
        return;
      }
      body += c;
    });
    req.on('end', async () => {
      let j = {};
      try { j = JSON.parse(body || '{}'); } catch { /* 用空 */ }
      const rec = SESSIONS.get(String(j.id || ''));
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      // 心跳（R-A2）：保活长轮次 SSE 连接
      const hb = setInterval(() => { try { res.write(': keep-alive\n\n'); } catch {} }, 15000);
      const send = (obj) => res.write('data: ' + JSON.stringify(sanitize(obj)) + '\n\n');
      if (!rec) {
        clearInterval(hb);
        send({ type: 'error', message: '课堂会话已失效（服务重启或超时），请重新开始上课' });
        res.end();
        return;
      }
      rec.touchedAt = Date.now();
      try {
        await rec.sess.reply(String(j.text == null ? '' : j.text), send, () => {});
      } catch (e) {
        send({ type: 'error', message: String((e && e.message) || e) });
      } finally {
        clearInterval(hb);
        res.end();
      }
    });
    return;
  }

  // POST /api/teach  -> 跑课堂，SSE 流式逐步推送事件（体验感来源）
  if (req.method === 'POST' && req.url.split('?')[0] === '/api/teach') {
    let body = '';
    req.on('data', (c) => {
      if (body.length + c.length > MAX_BODY) {
        try { res.writeHead(413, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('payload too large'); } catch {}
        req.destroy();
        return;
      }
      body += c;
    });
    req.on('end', async () => {
      const sc = getStrangerId(req, res); // R-A1：取/设匿名身份（须在 writeHead 前）
      let lesson;
      try {
        const j = JSON.parse(body || '{}');
        lesson = parseLesson(typeof j.lesson === 'string' ? j.lesson : '');
      } catch {
        lesson = parseLesson('');
      }
      if (sc.tracked) recordVisit(sc.id, lesson.title, 'teach'); // R1 数据层：开课即记一行（DNT 用户不追踪）
      const headers = {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        ...secHeaders(),
      };
      if (sc.header) headers['Set-Cookie'] = sc.header;
      res.writeHead(200, headers);
      const send = (obj) => res.write('data: ' + JSON.stringify(sanitize(obj)) + '\n\n');
      try {
        await runClassroom(lesson, { onLog: () => {}, onEvent: send });
        res.end();
      } catch (e) {
        send({ type: 'error', message: String((e && e.message) || e) });
        res.end();
      }
    });
    return;
  }
  // GET /api/world/:name -> 取回已持久化的世界对象（跨重启留存，R-M2 修复）
  if (req.method === 'GET' && req.url.split('?')[0].startsWith('/api/world/')) {
    const name = safeName(req.url.split('?')[0].slice('/api/world/'.length)); // 只允许 [A-Za-z0-9_-]，防穿越
    try {
      const w = World.load(path.join(__dirname, 'sessions', name));
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', ...secHeaders() });
      res.end(JSON.stringify({ ok: true, T: w.T, agents: w.measure().agents, artifacts: w.measure().artifacts, snapshot: w.snapshot() }));
    } catch (e) {
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8', ...secHeaders() });
      res.end(JSON.stringify({ ok: false, error: String((e && e.message) || e) }));
    }
    return;
  }
  // POST /api/llm -> 硅基流动「按功能组合」文本/视觉调用（翻译/深度思考/对话/OCR/combo 组合管线）
  if (req.method === 'POST' && req.url.split('?')[0] === '/api/llm') {
    readBody(req, res, async (raw) => {
      let j = {}; try { j = JSON.parse(raw || '{}'); } catch {}
      const fn = String(j.fn || 'chat');
      const system = typeof j.system === 'string' ? j.system : '';
      const user = typeof j.user === 'string' ? j.user : '';
      // 组合管线：语音/文本 → 电信ASR → 腾讯大白话 → 电信推理 → 免费对话 → 输出（全真免费模型）
      if (fn === 'combo') {
        const txt = await llm.sfCombo({ kind: j.kind === 'voice' ? 'voice' : 'text', text: user, audioBuf: null, mime: j.mime },
          { system, timeoutMs: Number(j.timeoutMs) || 120000, maxTokens: Number(j.maxTokens) || 320 });
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', ...secHeaders() });
        res.end(JSON.stringify({ ok: !!txt, fn: 'combo', text: txt }));
        return;
      }
      const fdef = llm.SF_FUNCTIONS[fn];
      if (!fdef || fdef.endpoint === 'image' || fdef.endpoint === 'asr') {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8', ...secHeaders() });
        res.end(JSON.stringify({ ok: false, error: 'unsupported fn (用 /api/image 或 /api/asr 处理图片/语音；combo 走 /api/llm?fn=combo)' }));
        return;
      }
      const txt = await llm.sfChat(fn, system, user, {
        imageUrl: j.imageUrl,
        timeoutMs: Number(j.timeoutMs) || 45000,                                   // 转发 HTTP 超时（推理模型需更长）
        deadline: Date.now() + (Number(j.timeoutMs) || 45000) + 5000,             // 预算护栏（超时即走兜底，不拖课堂）
        maxTokens: Number(j.maxTokens) || 400,
      });
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', ...secHeaders() });
      res.end(JSON.stringify({ ok: !!txt, fn, model: llm.sfModel(fn), text: txt }));
    });
    return;
  }

  // POST /api/image -> 硅基流动 Kolors 生图（永久免费），返回图片 URL 或 data: base64
  if (req.method === 'POST' && req.url.split('?')[0] === '/api/image') {
    readBody(req, res, async (raw) => {
      let j = {}; try { j = JSON.parse(raw || '{}'); } catch {}
      const prompt = String(j.prompt || '').slice(0, 1000);
      if (!prompt) { res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8', ...secHeaders() }); res.end(JSON.stringify({ ok: false, error: 'prompt required' })); return; }
      const url = await llm.sfImage(prompt, { size: j.size, steps: j.steps });
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', ...secHeaders() });
      res.end(JSON.stringify({ ok: !!url, model: llm.sfModel('image'), url }));
    });
    return;
  }

  // POST /api/asr -> 硅基流动 中国电信 XingChenGSR 语音识别（真免费），multipart 音频 → 文本
  if (req.method === 'POST' && req.url.split('?')[0] === '/api/asr') {
    let chunks = [], size = 0, tooBig = false;
    req.on('data', (c) => {
      if (tooBig) return;
      size += c.length;
      if (size > 12 * 1024 * 1024) { tooBig = true; try { res.writeHead(413); res.end('audio too large'); } catch {} req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', async () => {
      if (tooBig) return;
      const buf = Buffer.concat(chunks);
      const ct = req.headers['content-type'] || '';
      const m = ct.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
      if (!m) { res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8', ...secHeaders() }); res.end(JSON.stringify({ ok: false, error: 'multipart boundary required' })); return; }
      const file = parseMultipartFile(buf, m[1] || m[2]);
      if (!file) { res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8', ...secHeaders() }); res.end(JSON.stringify({ ok: false, error: 'no audio file part' })); return; }
      const out = await llm.sfAsr(file.buffer, file.mime);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', ...secHeaders() });
      res.end(JSON.stringify({ ok: !!out, model: llm.sfModel('asr'), text: out }));
    });
    req.on('error', () => {});
    return;
  }

  // 其余 GET 一律走静态资源（含 /classroom3d.html 与本地 /three.module.js）
  if (req.method === 'GET') {
    serveStatic(req, res);
    return;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('not found');
});

server.listen(PORT, () => {
  console.log(`灵境·课室 MVP 运行中 → http://localhost:${PORT}`);
  console.log(`  2D 课室:  http://localhost:${PORT}/`);
  console.log(`  3D 课室:  http://localhost:${PORT}/classroom3d.html  (Three.js 已本地化，无需联网)`);
  console.log(`  会话式课堂(老师可回话): POST /api/class/start , POST /api/class/reply`);
  console.log(`  ${process.env.LINGJING_SILICONFLOW_KEY ? '已检测到 LINGJING_SILICONFLOW_KEY：AI 学生 + 工具全部走硅基流动免费模型（DeepSeek-R1-0528-Qwen3-8B 等），失败自动 OpenRouter 免费兜底' : (process.env.LINGJING_OR_KEY ? '仅检测到 LINGJING_OR_KEY：AI 学生走 OpenRouter 免费兜底' : '未检测到免费模型 Key：AI 学生用确定性兜底语料')}`);
});
