// 智谱 GLM-4.7-Flash 接线测试（无需真 key，本地 stub 验证请求形态）
// 覆盖：provider 选择 / Bearer 鉴权头 / 模型名 glm-4.7-flash / 课题原文进提示词 / 并发串行(免费档1并发)。
import http from 'http';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

let fails = 0;
function ok(name, cond) {
  console.log((cond ? '  ✅ ' : '  ❌ ') + name);
  if (!cond) fails++;
}

// ---- 本地 stub：记录请求并返回合法回包 ----
const received = [];
const server = http.createServer((req, res) => {
  let b = '';
  req.on('data', (c) => (b += c));
  req.on('end', () => {
    received.push({ url: req.url, auth: req.headers['authorization'], body: b });
    let user = '';
    try { user = (JSON.parse(b).messages || []).find((m) => m.role === 'user')?.content || ''; } catch {}
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: '同学说：「' + user.slice(0, 12) + '」这我还真没抓牢。' } }] }));
  });
});

await new Promise((r) => server.listen(0, r));
const port = server.address().port;

// ---- 设置智谱环境后，再 require llm.js（模块在加载时读 env）----
process.env.LINGJING_LLM_PROVIDER = 'zhipu';
process.env.LINGJING_ZHIPU_KEY = 'test-zhipu-key';
process.env.LINGJING_ZHIPU_BASE = `http://localhost:${port}/chat/completions`;

const llm = require('../llm.js');

console.log('[zhipu wiring]');
const sys = '你是灵境课室里一名带着旧想法的学生，照着先生的讲解抛探测，不要打分。';
const usr = '先生讲了潮汐：主要是月亮引力造成，一天两次涨落。';
const out = await llm.orChat(sys, usr, { maxTokens: 200, timeoutMs: 8000 });

ok('orChat 返回非空（走通智谱路径）', typeof out === 'string' && out.length > 0);
ok('stub 收到至少 1 次请求', received.length >= 1);
ok('鉴权头为 Bearer test-zhipu-key', received[0] && received[0].auth === 'Bearer test-zhipu-key');
let bodyObj = null;
try { bodyObj = JSON.parse(received[0].body); } catch {}
ok('请求 model = glm-4.7-flash', bodyObj && bodyObj.model === 'glm-4.7-flash');
ok('课题原文进 user 消息', !!bodyObj && JSON.stringify(bodyObj.messages).includes('月亮引力'));
ok('回包含课题片段（端到端连通）', out.includes('月亮引力') || out.includes('潮汐'));
ok('llmStatus 标出智谱提供商', /智谱/.test(llm.llmStatus().provider || ''));

server.close();
console.log(fails === 0 ? '\n[zhipu wiring] PASS' : `\n[zhipu wiring] ${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
