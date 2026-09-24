// 硅基流动 SiliconFlow 接线测试（无需真 key，本地 stub 验证请求形态）
// 覆盖：provider 选择 / Bearer 鉴权头 / 默认模型 deepseek-ai/DeepSeek-V3（限时免费，输出干净）/ 课题原文进提示词 / llmStatus 标出提供商。
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

// ---- 设置硅基流动环境后，再 require llm.js（模块在加载时读 env）----
process.env.LINGJING_LLM_PROVIDER = 'siliconflow';
process.env.LINGJING_SILICONFLOW_KEY = 'test-sf-key';
process.env.LINGJING_SILICONFLOW_BASE = `http://localhost:${port}/chat/completions`;

const llm = require('../llm.js');

console.log('[siliconflow wiring]');
const sys = '你是灵境课室里一名带着旧想法的学生，照着先生的讲解抛探测，不要打分。';
const usr = '先生讲了潮汐：主要是月亮引力造成，一天两次涨落。';
const out = await llm.orChat(sys, usr, { maxTokens: 200, timeoutMs: 8000 });

ok('orChat 返回非空（走通硅基流动路径）', typeof out === 'string' && out.length > 0);
ok('stub 收到至少 1 次请求', received.length >= 1);
ok('鉴权头为 Bearer test-sf-key', received[0] && received[0].auth === 'Bearer test-sf-key');
let bodyObj = null;
try { bodyObj = JSON.parse(received[0].body); } catch {}
ok('请求 model = deepseek-ai/DeepSeek-V3（默认限时免费模型）', bodyObj && bodyObj.model === 'deepseek-ai/DeepSeek-V3');
ok('课题原文进 user 消息', !!bodyObj && JSON.stringify(bodyObj.messages).includes('月亮引力'));
ok('回包含课题片段（端到端连通）', out.includes('月亮引力') || out.includes('潮汐'));
ok('llmStatus 标出硅基流动提供商', /硅基流动/.test(llm.llmStatus().provider || ''));

server.close();
console.log(fails === 0 ? '\n[siliconflow wiring] PASS' : `\n[siliconflow wiring] ${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
