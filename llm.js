// 灵境 LingJing — LLM 连接器（独立模块，多提供商）
// ==================================================================
// 2026-09-16 从 teacher.js 抽离（ENGINEERING.md §五 P1：提测试性）。
// 2026-09-17 改多提供商：OpenRouter（默认，向后兼容） + 智谱 GLM-4.7-Flash（国内免费为主） + DeepSeek（低价备选）。
//
// 选择：LINGJING_LLM_PROVIDER = openrouter | zhipu | deepseek | siliconflow（默认 openrouter，保证 test_llm_wiring 不变）。
//   智谱：LINGJING_ZHIPU_KEY + 端点 open.bigmodel.cn（OpenAI 兼容），模型 glm-4.7-flash，免费无上限、200K 上下文、免费档 1 并发。
//   硅基流动：LINGJING_SILICONFLOW_KEY + 端点 api.siliconflow.cn（OpenAI 兼容），一个 key 调 100+ 模型（国内节点稳）。
//            ⚠️ 用真 key 实测（2026-09-18）筛出的【真免费】模型（DeepSeek-V3 / DeepSeek-R1 大模型属收费/限时免费档，已排除）：
//              · 语音 ASR（中国电信 免费）= XingChenAGI/XingChenGSR-V1.0（实测 200，走 /v1/audio/transcriptions）
//              · 翻译/大白话（腾讯 免费）= tencent/Hunyuan-MT-7B（实测 200）
//              · 推理（中国电信星辰 免费，答案在 reasoning_content）= XingChenAGI/Xing4.0-29B（实测 200）
//              · 对话（免费）= deepseek-ai/DeepSeek-R1-0528-Qwen3-8B（实测 200，蒸馏小模型；答案在 content 或 reasoning_content）
//              · 画图（免费）= Kwai-Kolors/Kolors（实测 200 返回图 URL）
//              · 图文识别 OCR（免费）= PaddlePaddle/PaddleOCR-VL-1.5
//              · （备用免费语音）Qwen/Qwen3-ASR-1.7B、FunAudioLLM/SenseVoiceSmall
//            ⚠️ 「按功能组合」管线（用户要求的"把免费模型拼起来"核心办法）见 SF_FUNCTIONS + sfCombo：
//              语音→电信ASR(XingChenGSR)→腾讯大白话(Hunyuan-MT)→电信推理(Xing4.0-29B)→免费对话(DeepSeek-R1-0528-Qwen3-8B)→输出
//            ⚠️ 模型名须严格匹配目录（如 Qwen/Qwen3-8B 而非 Qwen/Qwen3-8B-Instruct），错名会 400 "Model does not exist"。
//            ⚠️ 推理模型(DeepSeek-R1-0528-Qwen3-8B / Xing4.0-29B)答案在 reasoning_content，oneCall 已兜底读取；普通模型(content 直出)不受影响。
//   各提供商端点可被 *_BASE 环境变量覆盖（便于本地假模型/stub 验证，无需真 key）。
//
// 职责单一：把教师的话送进模型、把模型的话拿回来。不评分、不声称 AI 懂没懂；
// 所有"熔断/未验证"状态都如实上报（llmStatus）。密钥只读环境变量，绝不写进本文件或仓库。

const https = require('https');
const http = require('http');

// ---- OpenRouter 模型降级链（2026-09-10 实测重排，免费档）----
const OR_DEFAULT_CHAIN = [
  'nvidia/nemotron-3-super-120b-a12b:free',
  'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
  'google/gemma-4-31b-it:free',
  'google/gemma-4-26b-a4b-it:free',
  'inclusionai/ling-3.0-flash-sante:free',
];

// ---- 多提供商定义 ----
const PROVIDERS = {
  openrouter: {
    label: 'OpenRouter',
    keyEnv: 'LINGJING_OR_KEY',
    key: process.env.LINGJING_OR_KEY || '',
    base: process.env.LINGJING_OR_BASE || 'https://openrouter.ai/api/v1/chat/completions',
    models: (process.env.LINGJING_OR_MODEL ? [process.env.LINGJING_OR_MODEL] : []).concat(OR_DEFAULT_CHAIN),
    concurrency: 4,
    kind: 'openrouter',
  },
  zhipu: {
    label: '智谱 GLM-4.7-Flash(免费)',
    keyEnv: 'LINGJING_ZHIPU_KEY',
    key: process.env.LINGJING_ZHIPU_KEY || '',
    base: process.env.LINGJING_ZHIPU_BASE || 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    models: [process.env.LINGJING_ZHIPU_MODEL || 'glm-4.7-flash'],
    concurrency: 1, // 免费档 1 并发：串行化避免 429
    kind: 'openai',
  },
  deepseek: {
    label: 'DeepSeek',
    keyEnv: 'LINGJING_DEEPSEEK_KEY',
    key: process.env.LINGJING_DEEPSEEK_KEY || '',
    base: process.env.LINGJING_DEEPSEEK_BASE || 'https://api.deepseek.com/v1/chat/completions',
    models: [process.env.LINGJING_DEEPSEEK_MODEL || 'deepseek-chat'],
    concurrency: 4,
    kind: 'openai',
  },
  siliconflow: {
    label: '硅基流动 SiliconFlow(免费)',
    keyEnv: 'LINGJING_SILICONFLOW_KEY',
    key: process.env.LINGJING_SILICONFLOW_KEY || '',
    base: process.env.LINGJING_SILICONFLOW_BASE || 'https://api.siliconflow.cn/v1/chat/completions',
    models: [process.env.LINGJING_SILICONFLOW_MODEL || 'deepseek-ai/DeepSeek-R1-0528-Qwen3-8B'],
    concurrency: 2, // 免费档保守串行，避免 429；课堂 5 学生本就经 _limit 排队
    kind: 'openai',
  },
};

function activeName() {
  const n = (process.env.LINGJING_LLM_PROVIDER || 'openrouter').toLowerCase();
  return PROVIDERS[n] ? n : 'openrouter';
}
const ACTIVE = PROVIDERS[activeName()];

// ==================================================================
// 硅基流动「按功能组合」路由（多模型编排核心：一个 key 调 100+ 模型）
// 把产品功能映射到【真免费】模型（2026-09-18 真 key 实测全部 200+真文本），统一走密钥环境变量，绝不下沉到前端/仓库。
// 功能 → 模型（均为实测真免费，不含任何限时/付费档）：
//   asr       语音识别(中国电信)  XingChenAGI/XingChenGSR-V1.0   /v1/audio/transcriptions
//   translate 翻译/大白话(腾讯)   tencent/Hunyuan-MT-7B          chat
//   reason    深度推理(中国电信)   XingChenAGI/Xing4.0-29B        chat（答案在 reasoning_content）
//   chat      对话/学生回话(免费)  deepseek-ai/DeepSeek-R1-0528-Qwen3-8B  chat（content 或 reasoning_content）
//   image     配图                Kwai-Kolors/Kolors             /v1/images/generations
//   ocr       图文识别            PaddlePaddle/PaddleOCR-VL-1.5  vision chat
//   fallback  国外免费兜底        见 OR_FREE_CHAIN（OpenRouter :free 模型）
// ⚠️ 学生(镜子)默认用 chat（免费蒸馏模型）；reason 仅作"人用的深度思考助手"，绝不替学生开口。
// ⚠️ 把上面串起来就是用户要的「组合管线」：sfCombo（语音→电信ASR→腾讯大白话→电信推理→免费对话→输出）。
const SF = PROVIDERS.siliconflow;
const SF_FUNCTIONS = {
  asr:      { model: process.env.LINGJING_SF_ASR       || 'XingChenAGI/XingChenGSR-V1.0', endpoint: 'asr'    },
  translate:{ model: process.env.LINGJING_SF_TRANSLATE || 'tencent/Hunyuan-MT-7B',        endpoint: 'chat'   },
  reason:   { model: process.env.LINGJING_SF_REASON    || 'XingChenAGI/Xing4.0-29B',      endpoint: 'chat'   },
  chat:     { model: process.env.LINGJING_SF_CHAT      || 'deepseek-ai/DeepSeek-R1-0528-Qwen3-8B', endpoint: 'chat' },
  // 镜子的"开口"专用：非推理对话模型（不冒思维链、不照抄提示），把"照"阶段找到的缺口说成学生口吻
  say:      { model: process.env.LINGJING_SF_SAY       || 'Qwen/Qwen3-8B',               endpoint: 'chat' },
  image:    { model: process.env.LINGJING_SF_IMAGE     || 'Kwai-Kolors/Kolors',           endpoint: 'image'  },
  ocr:      { model: process.env.LINGJING_SF_OCR       || 'PaddlePaddle/PaddleOCR-VL-1.5', endpoint: 'vision' },
};
function sfModel(fn) { return (SF_FUNCTIONS[fn] || SF_FUNCTIONS.chat).model; }

// ---- OpenRouter 真免费模型兜底链（国外，2026-09-18 实测 200；z-ai/glm-5.2:free 高峰 429 已排末位）----
const OR_FREE_CHAIN = [
  'deepseek/deepseek-v4-flash-0731:free',          // 免费 chat（实测 200）
  'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free', // 免费推理（实测 200）
  'openrouter/free',                               // 自动免费路由（实测 200）
  'z-ai/glm-5.2:free',                             // 免费 chat（高峰限流，兜底）
];
const OR_FREE = {
  label: 'OpenRouter 免费兜底',
  key: PROVIDERS.openrouter.key,
  base: PROVIDERS.openrouter.base,
  kind: 'openrouter',
  _limit: PROVIDERS.openrouter._limit,
  models: OR_FREE_CHAIN,
};
// 国外免费模型兜底对话（硅基流动无 key/失败时用；不重复计费，全免费）
async function orFreeChat(system, user, opts = {}) {
  if (!OR_FREE.key) return '';
  for (const m of OR_FREE.models) {
    if (opts.deadline && Date.now() > opts.deadline) return '';
    const t = await OR_FREE._limit(() => oneCall(OR_FREE, m, system, user, opts));
    if (t) return t;
  }
  return '';
}

// 文本/视觉类功能统一走 OpenAI 兼容 chat（ocr 可带 imageUrl 走多模态）
async function sfChat(fn, system, user, opts = {}) {
  if (opts.deadline && Date.now() > opts.deadline) return '';
  const f = SF_FUNCTIONS[fn] || SF_FUNCTIONS.chat;
  let txt = '';
  if (SF.key) {
    const messages = opts.imageUrl
      ? [{ role: 'system', content: system },
         { role: 'user', content: [
             { type: 'text', text: user },
             { type: 'image_url', image_url: { url: opts.imageUrl } },
         ] }]
      : undefined;
    txt = await SF._limit(() => oneCall(SF, f.model, system, user, { ...opts, messages }));
  }
  // 硅基流动无 key / 返回空 → 国外免费模型兜底（仍全免费）
  if (!txt) txt = await orFreeChat(system, user, opts);
  if (txt) llmVerified = true;
  return txt;
}

// 「组合管线」——把多个真免费模型串成一个能解决问题的办法（用户 2026-09-18 明确要求）：
//   语音(kind:'voice')：电信免费 ASR(XingChenGSR) 转写 → 文本
//   文本(kind:'text') ：腾讯免费大白话(Hunyuan-MT) 整理 → 便于思考
//   → 电信免费推理(Xing4.0-29B) 拆解关键链条
//   → 免费对话(DeepSeek-R1-0528-Qwen3-8B) 最终表述
//   任一段为空都不致命：上游原文会顺延到下游，绝不整段失败。
async function sfCombo(input, opts = {}) {
  let text = input.text || '';
  if (input.kind === 'voice' && input.audioBuf) {
    const a = await sfAsr(input.audioBuf, input.mime);
    if (!a) return '';
    text = a;
  }
  if (!text) return '';
  const system = opts.system || '你是循循善诱的思考与对话助手。';
  // 1) 腾讯免费大白话/规范化
  const plain = await sfChat('translate', '把用户的话整理成清晰、口语化、便于思考的中文，不要作答，只做转写与润色。', text,
    { maxTokens: 200, timeoutMs: opts.timeoutMs ? Math.floor(opts.timeoutMs / 3) : 25000 });
  const work = plain || text;
  // 2) 电信免费推理
  const reasoned = await sfChat('reason', '你是善于拆解问题的思考助手，给出关键推理链条，不要客套。', work,
    { maxTokens: 400, timeoutMs: opts.timeoutMs ? Math.floor(opts.timeoutMs / 2) : 50000 });
  const thought = reasoned || work;
  // 3) 免费对话最终表述：用原始问题 + 推理作支撑，给出干净的面向初学者的回答（不复述"推理链条"）
  const out = await sfChat('chat',
    '你是循循善诱的老师。下面先给原始问题，再给一段参考推理。请据此用一段通俗、面向初学者的话直接回答原始问题——不要复述"推理链条"、不要列编号、不要出现"分析"二字。',
    '【原始问题】' + text + '\n【参考推理】' + thought,
    { maxTokens: 360, timeoutMs: opts.timeoutMs ? Math.floor(opts.timeoutMs / 3) : 25000 });
  return (out || thought).trim();
}

// 图片生成（Kolors，永久免费）—— 返回图片 URL 或 data: base64
function sfImage(prompt, opts = {}) {
  return new Promise((resolve) => {
    if (!SF.key) { resolve(''); return; }
    const f = SF_FUNCTIONS.image;
    const body = JSON.stringify({
      model: f.model,
      prompt: String(prompt || '').slice(0, 1000),
      image_size: opts.size || '1024x1024',
      num_inference_steps: opts.steps || 20,
      guidance_scale: opts.guidance || 7.5,
    });
    const target = parseTarget('https://api.siliconflow.cn/v1/images/generations');
    const req = target.mod.request({
      hostname: target.hostname, port: target.port, path: target.path, method: 'POST',
      timeout: opts.timeoutMs || 60000,
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SF.key}`, 'Content-Length': Buffer.byteLength(body), 'X-Enable-Watermark': '0' },
    }, (res) => {
      let d = ''; res.on('data', (c) => (d += c));
      res.on('end', () => {
        try {
          const j = JSON.parse(d);
          if (j.error) { console.error('[sfImage]', j.error.message); resolve(''); return; }
          const item = (j.data && j.data[0]) || {};
          resolve(item.url || (item.b64_json ? 'data:image/png;base64,' + item.b64_json : ''));
        } catch { resolve(''); }
      });
    });
    req.on('timeout', () => { req.destroy(); resolve(''); });
    req.on('error', () => resolve(''));
    req.write(body); req.end();
  });
}

// 语音识别（SenseVoice，永久免费）—— audioBuf=Buffer，返回转写文本
function sfAsr(audioBuf, mime) {
  return new Promise((resolve) => {
    if (!SF.key || !audioBuf) { resolve(''); return; }
    const f = SF_FUNCTIONS.asr;
    const boundary = '----sf' + Date.now().toString(16);
    const head = Buffer.from(
      '--' + boundary + '\r\nContent-Disposition: form-data; name="model"\r\n\r\n' + f.model + '\r\n'
      + '--' + boundary + '\r\nContent-Disposition: form-data; name="file"; filename="audio"\r\nContent-Type: ' + (mime || 'audio/webm') + '\r\n\r\n');
    const tail = Buffer.from('\r\n--' + boundary + '--\r\n');
    const body = Buffer.concat([head, audioBuf, tail]);
    const target = parseTarget('https://api.siliconflow.cn/v1/audio/transcriptions');
    const req = target.mod.request({
      hostname: target.hostname, port: target.port, path: target.path, method: 'POST',
      timeout: 60000,
      headers: { 'Content-Type': 'multipart/form-data; boundary=' + boundary, 'Authorization': `Bearer ${SF.key}`, 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let d = ''; res.on('data', (c) => (d += c));
      res.on('end', () => {
        try { const j = JSON.parse(d); if (j.error) { console.error('[sfAsr]', j.error.message); resolve(''); return; } resolve(j.text || ''); }
        catch { resolve(''); }
      });
    });
    req.on('timeout', () => { req.destroy(); resolve(''); });
    req.on('error', () => resolve(''));
    req.write(body); req.end();
  });
}

// 对外兼容导出（teacher.js 解构了这些符号）
const KEY = ACTIVE.key;
const MODEL = ACTIVE.models[0];
const MODEL_CHAIN = ACTIVE.models.slice();

// 每轮 LLM 时间预算（超出即用兜底语料补齐，保证课堂节奏不卡死）
const LLM_BUDGET_MS = Number(process.env.LINGJING_LLM_BUDGET_MS) || 45000;

// ---- 熔断（账户级额度/鉴权问题 → 一段时间内直接走兜底）----
let quotaDeadUntil = 0;
let deadReason = '';
function markDead(ms, why) {
  quotaDeadUntil = Math.max(quotaDeadUntil, Date.now() + ms);
  if (why) deadReason = why;
}
function llmUsable() { return !!ACTIVE.key && Date.now() >= quotaDeadUntil; }
// 诚实标注：区分「没配 key」/「额度或限流熔断」/「已配置但本课还没实测过」三种状态。
let llmVerified = false;
function llmStatus() {
  const usable = llmUsable();
  let state = 'ready', reason = deadReason;
  if (!ACTIVE.key) { state = 'no-key'; reason = `未配置 ${ACTIVE.label} 的 API Key（${ACTIVE.keyEnv}）`; }
  else if (!usable) { state = 'circuit-open'; reason = deadReason || '额度/限流熔断中'; }
  else if (!llmVerified) { state = 'unverified'; reason = '已配置，但本课尚未实测（首次调用前不保证可用）'; }
  else { state = 'verified'; reason = ''; }
  return { usable, verified: llmVerified, state, reason, until: quotaDeadUntil, model: goodModel || MODEL, provider: ACTIVE.label };
}

// ---- 端点解析（支持 http 假模型 / 覆盖）----
function parseTarget(raw) {
  try {
    const u = new URL(raw);
    return {
      mod: u.protocol === 'http:' ? http : https,
      hostname: u.hostname,
      port: u.port ? Number(u.port) : undefined,
      path: u.pathname + (u.search || ''),
    };
  } catch {
    return { mod: https, hostname: 'open.bigmodel.cn', port: undefined, path: '/api/paas/v4/chat/completions' };
  }
}

// ---- 并发限制（免费档 1 并发的智谱必须串行，否则 429 熔断）----
function makeLimiter(n) {
  let active = 0;
  const waiting = [];
  const release = () => { active--; pump(); };
  const pump = () => {
    while (active < n && waiting.length) {
      active++;
      const task = waiting.shift();
      Promise.resolve().then(task).then(release, release);
    }
  };
  return (task) => new Promise((resolve, reject) => {
    waiting.push(() => Promise.resolve().then(task).then(resolve, reject));
    pump();
  });
}
// 每个提供商都预置并发限制器（硅基流动功能路由也用得到，即使它不是 ACTIVE）
Object.values(PROVIDERS).forEach((p) => { if (!p._limit) p._limit = makeLimiter(p.concurrency || 1); });
// OR_FREE 在上方定义时引用了 PROVIDERS.openrouter._limit（此时尚未赋值），这里补绑，确保兜底串行限流可用
if (!OR_FREE._limit) OR_FREE._limit = PROVIDERS.openrouter._limit;

// ---- 单次调用（OpenAI 兼容 chat/completions）----
function oneCall(p, model, system, user, opts = {}, tried = false) {
  const { timeoutMs = 12000, maxTokens = 140, temperature = 0.85 } = opts;
  // 允许调用方自带 messages（多模态 vision：text + image_url）
  const messages = opts.messages || [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
  const body = JSON.stringify({
    model,
    messages,
    max_tokens: maxTokens,
    temperature,
  });
  const target = parseTarget(p.base);
  return new Promise((resolve) => {
    const req = target.mod.request({
      hostname: target.hostname,
      port: target.port,
      path: target.path,
      method: 'POST',
      timeout: timeoutMs,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${p.key}`,
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => {
        try {
          const j = JSON.parse(d);
          if (j.error) {
            const meta = j.error.metadata || {};
            const src = String(meta.limit_source || '');
            const msg = String(j.error.message || '');
            const code = j.error.code;
            // ① OpenRouter 账户级日额度用尽（free-models-per-day）→ 熔断到重置时刻
            //    ⚠️ X-RateLimit-Reset 是**毫秒**时间戳；旧代码又乘 1000 → 锁定到公元五万年。
            //    现在：>1e12 视为毫秒，否则秒；封顶 26 小时，任何异常值都不锁死进程。
            if (p.kind === 'openrouter' && (/daily/i.test(src + msg) || /free-models-per-day/.test(msg))) {
              const rawReset = Number((meta.headers || {})['X-RateLimit-Reset']);
              const resetMs = !rawReset ? 0 : (rawReset > 1e12 ? rawReset : rawReset * 1000);
              const until = resetMs
                ? Math.min(Math.max(60000, resetMs - Date.now()), 26 * 3600 * 1000)
                : 3600000;
              markDead(until, '免费模型日额度已用尽');
              resolve(''); return;
            }
            // ② 鉴权失败 → 熔断 10 分钟
            if (code === 401) { markDead(600000, `${p.label} 密钥无效`); resolve(''); return; }
            // ③ 上游 429/403（共享池忙/并发超限）→ 同模型再试一次，仍失败则交给降级链
            if (!tried && (code === 429 || code === 403)) {
              setTimeout(() => oneCall(p, model, system, user, opts, true).then(resolve), 900);
              return;
            }
            resolve(''); return;
          }
          // 兼容推理模型（如中国电信 Xing4.0-29B、DeepSeek-R1）：答案写在 reasoning_content，
          // content 可能为空 → 回退读 reasoning_content，否则推理模型一律"答空"。
          const _msg = j.choices?.[0]?.message || {};
          const _txt = (_msg.content || _msg.reasoning_content || '').trim();
          resolve(_txt);
        } catch { resolve(''); }
      });
    });
    req.on('timeout', () => { req.destroy(); resolve(''); });
    req.on('error', () => resolve(''));
    req.write(body);
    req.end();
  });
}

let goodModel = null; // 上一次成功的模型（命中即优先，后续复用）

// 依次尝试模型链，返回第一个非空回答；记住成功的模型
async function orChat(system, user, opts = {}) {
  const p = ACTIVE;
  if (process.env.LINGJING_DIAG) console.error('[orChat] provider=' + p.label + ' usable=' + llmUsable() + ' deadlineExceeded=' + !!(opts.deadline && Date.now() > opts.deadline) + ' goodModel=' + goodModel);
  if (!llmUsable()) return '';
  const deadline = opts.deadline || 0;
  const order = goodModel ? [goodModel].concat(p.models.filter((m) => m !== goodModel)) : p.models;
  for (const m of order) {
    if (deadline && Date.now() > deadline) return '';   // 超预算 → 立即走兜底，不拖慢课堂
    const txt = await p._limit(() => oneCall(p, m, system, user, opts)); // 受并发限制（智谱免费档串行）
    if (txt) { goodModel = m; llmVerified = true; if (process.env.LINGJING_DIAG) console.error('[orChat] got txt len=' + txt.length); return txt; }
    if (!llmUsable()) return '';                        // 已熔断
  }
  if (process.env.LINGJING_DIAG) console.error('[orChat] return EMPTY (all models empty)');
  return '';
}

module.exports = {
  KEY, MODEL, MODEL_CHAIN,
  oneCall, orChat, llmStatus, llmUsable, markDead, LLM_BUDGET_MS,
  // 硅基流动按功能组合（多模型编排，全真免费）
  SF, SF_FUNCTIONS, sfModel, sfChat, sfImage, sfAsr, sfCombo, orFreeChat, OR_FREE_CHAIN,
};
