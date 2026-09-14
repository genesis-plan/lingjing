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

const PORT = process.env.PORT || 8080;

// 会话式课堂（老师可中途回话，见 teacher.js createSession）：内存保存，进程重启即清空
const SESSIONS = new Map();
const SESSION_TTL_MS = 60 * 60 * 1000; // 1 小时
function newSessionId() { return crypto.randomBytes(9).toString('hex'); }
function gcSessions() {
  const now = Date.now();
  for (const [id, s] of SESSIONS) if (now - s.touchedAt > SESSION_TTL_MS) SESSIONS.delete(id);
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
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  // 根路径直接进 3D 课室（用户要求"5 人坐在座位上、数学用在 3D 空间"，故 3D 为默认体验）。
  // 2D 平面版仍在 /classroom.html（3D 加载失败时可回退）。
  if (urlPath === '/') urlPath = '/classroom3d.html';
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
  // GET /api/roster -> 5 名学生的静态人设（供页面一打开就把学生摆进教室，无需等上课）
  if (req.method === 'GET' && req.url.split('?')[0] === '/api/roster') {
    const { PERSONALITIES } = require('./teaching.js');
    const body = JSON.stringify({
      students: PERSONALITIES.map((p) => ({ name: p.name, trait: p.trait, alpha: p.alpha, voice: p.voice, catch: p.catch })),
      llm: require('./teacher.js').llmStatus(),
    });
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(body);
    return;
  }

  // POST /api/class/start  -> 开一堂课（会话式）：SSE 推 start + 第 1 轮，然后保持会话待老师回话
  if (req.method === 'POST' && req.url.split('?')[0] === '/api/class/start') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      let lesson;
      try {
        const j = JSON.parse(body || '{}');
        lesson = parseLesson(typeof j.lesson === 'string' ? j.lesson : '');
      } catch { lesson = parseLesson(''); }
      gcSessions();
      const id = newSessionId();
      const sess = createSession(lesson);
      SESSIONS.set(id, { sess, touchedAt: Date.now() });
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      const send = (obj) => res.write('data: ' + JSON.stringify(obj) + '\n\n');
      send({ type: 'session', id });
      try {
        await sess.start(send, () => {});
        res.end();
      } catch (e) {
        send({ type: 'error', message: String((e && e.message) || e) });
        res.end();
      }
    });
    return;
  }

  // POST /api/class/reply  -> 老师回话，推下一轮；到最后一轮自动收尾（done）
  if (req.method === 'POST' && req.url.split('?')[0] === '/api/class/reply') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      let j = {};
      try { j = JSON.parse(body || '{}'); } catch { /* 用空 */ }
      const rec = SESSIONS.get(String(j.id || ''));
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      const send = (obj) => res.write('data: ' + JSON.stringify(obj) + '\n\n');
      if (!rec) {
        send({ type: 'error', message: '课堂会话已失效（服务重启或超时），请重新开始上课' });
        res.end();
        return;
      }
      rec.touchedAt = Date.now();
      try {
        await rec.sess.reply(String(j.text == null ? '' : j.text), send, () => {});
        res.end();
      } catch (e) {
        send({ type: 'error', message: String((e && e.message) || e) });
        res.end();
      }
    });
    return;
  }

  // POST /api/teach  -> 跑课堂，SSE 流式逐步推送事件（体验感来源）
  if (req.method === 'POST' && req.url.split('?')[0] === '/api/teach') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      let lesson;
      try {
        const j = JSON.parse(body || '{}');
        lesson = parseLesson(typeof j.lesson === 'string' ? j.lesson : '');
      } catch {
        lesson = parseLesson('');
      }
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      const send = (obj) => res.write('data: ' + JSON.stringify(obj) + '\n\n');
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
  console.log(`  ${process.env.LINGJING_OR_KEY ? '已检测到 LINGJING_OR_KEY：真实 LLM 学生（' + (process.env.LINGJING_OR_MODEL || 'google/gemma-4-26b-a4b-it:free') + '）' : '未检测到 LINGJING_OR_KEY：AI 学生用确定性兜底语料'}`);
});
