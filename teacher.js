// 灵境 LingJing — 教师职业切片（MVP #1：人体验"教师"职业，AI 当学生）
//
// 落地框架（docs/classroom-framework.md）：BKT 概率状态 + ReKT 多层面 + 性格驱动 LLM 学生
//   世界 ⟨S,R,M,T⟩ —— 一个课堂（World），教师与学生的作品/知识态都留在同一世界
//   公理3          —— 人类教师的内容是外部输入（网页/CLI 传入），引擎不生成
//   R_教学         —— teachingRelation 连接 人类教师 -> AI 学生
//   P(t)           —— 5×M 知识状态矩阵，每轮按 Δp=α_i·β_j·LLM_i 更新
//   E(t)/σ²(t)     —— 教学效果与差异度（软信号，非客观测评，见 docs 局限性）
//   V(s)           —— 互动参与度（笔记互异率，作为框架世界一致性指标保留）
//   持久           —— 教案(lesson) + 学生笔记(note) + 知识态(kstate) 都作为 artifact 留世界
//
// MVP 原则（用户 2026-09-09 拍板）：不要复杂设计，要能落地、让人能用的初始产品，非完美。
//
// 2026-09-10 升级（用户："回答太机械了，要接近实际，把 5 个学生做成智能 AI"）：
//   ①**会话式课堂**：createSession 支持"老师回话 → 学生再反应"的问答闭环（原来学生只会单向提问）
//   ②**一人一调用**：每个学生一次 LLM 调用同时产出「理解自评 + 发言」，调用数减半、延迟减半
//   ③**独立记忆**：每个学生记得自己说过什么、同学说过什么、老师回答过什么（memory）
//   ④**独立人设**：说话方式/易卡点/口头禅（teaching.js PERSONALITIES 扩展字段）注入提示词
//   ⑤**行为多样**：每轮角色提示不同（提问 / 回应老师 / 举例 / 与同学讨论 / 复述确认），
//      允许说"没懂"、说"我走神了"，不再每轮都是模板提问
//   ⑥无密钥时的兜底语料改为**按性格×概念×掌握度生成**（不再 3 句死循环）
//
// 学生大脑走 OpenRouter（默认 google/gemma-4-26b-a4b-it:free，可用 LINGJING_OR_MODEL 覆盖；
// 免费档限 50 次/天，充值后升至 1000 次/天）。无密钥/超时/429 时走确定性兜底语料。
// 安全：密钥只从环境变量 LINGJING_OR_KEY 读取，绝不写进本文件或仓库。
//
// 运行（CLI）：     LINGJING_OR_KEY=sk-or-... node teacher.js "课题名::你的讲解…"
// 运行（网页）：   node server.js   →  浏览器开 http://localhost:8080

const https = require('https');
const fs = require('fs');
const path = require('path');
const { World } = require('./world.js');
const {
  PERSONALITIES, clamp, extractConcepts, estimateDifficulty, valueFunction, teachingRelation,
  guessMisconception, teacherPoints, isClarifying, quotable,
  teacherDiagnosis, teacherReport,
  PROBE_TYPES, classifyProbe, probeLabel, probeCounts, probeSummaryLine,
} = require('./teaching.js');

const KEY = process.env.LINGJING_OR_KEY || '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- 模型降级链（2026-09-10 实测重排）----
// 实测（curl 打真实响应 + 两行格式遵循度）：nemotron-3-super-120b 最快最稳（4s 出中文）；
// gemma-4-26b/31b 共享池频繁 429，放后面；inclusionai/ling-3.0-flash 可用但偶尔出戏。
// 顺序按"实测命中率"排，谁先成功谁被记住（goodModel），后续优先复用。
// ⚠️ 免费额度实测：本 key = 50 次/天（free-models-per-day），1 个学生 1 轮 = 1 次调用，
//    即一天约 10 轮课。充值 ≥10 credits 后升到 1000 次/天。也可用 LINGJING_OR_MODEL 指定自有模型。
const DEFAULT_CHAIN = [
  'nvidia/nemotron-3-super-120b-a12b:free',
  'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
  'google/gemma-4-31b-it:free',
  'google/gemma-4-26b-a4b-it:free',
  'inclusionai/ling-3.0-flash-sante:free',
];
const MODEL_CHAIN = (process.env.LINGJING_OR_MODEL ? [process.env.LINGJING_OR_MODEL] : []).concat(DEFAULT_CHAIN);
const MODEL = MODEL_CHAIN[0];
let goodModel = null; // 上一次成功的模型（命中即优先）

// 熔断：账户级额度/鉴权问题（如免费日额度用尽）→ 一段时间内直接走兜底，不再每轮白等模型
let quotaDeadUntil = 0;
let deadReason = '';
function markDead(ms, why) {
  quotaDeadUntil = Math.max(quotaDeadUntil, Date.now() + ms);
  if (why) deadReason = why;
}
function llmUsable() { return !!KEY && Date.now() >= quotaDeadUntil; }
// 诚实标注：区分「没配 key」/「额度或限流熔断」/「已配置但本课还没实测过」三种状态。
// verified 只在真的成功调用过 LLM 之后才为 true——避免页面一打开就宣称"真 LLM 学生在场"然后全部走兜底。
let llmVerified = false;
function llmStatus() {
  const usable = llmUsable();
  let state = 'ready', reason = deadReason;
  if (!KEY) { state = 'no-key'; reason = '未配置 LINGJING_OR_KEY'; }
  else if (!usable) { state = 'circuit-open'; reason = deadReason || '额度/限流熔断中'; }
  else if (!llmVerified) { state = 'unverified'; reason = '已配置，但本课尚未实测（首次调用前不保证可用）'; }
  else { state = 'verified'; reason = ''; }
  return { usable, verified: llmVerified, state, reason, until: quotaDeadUntil, model: goodModel || MODEL };
}

// 每轮 LLM 时间预算（超出即用兜底语料补齐，保证课堂节奏不卡死）
const LLM_BUDGET_MS = Number(process.env.LINGJING_LLM_BUDGET_MS) || 45000;

// ---- OpenRouter 调用（node 原生 https，绕过托管运行时 fetch 不发 Authorization 头的坑）----
// LINGJING_OR_BASE 可覆盖完整端点（默认 OpenRouter）——用于把课堂指向本地假模型，
// 在**没有额度**的情况下也能端到端验证"每个学生一次调用 + 教师的话真的进了提示词"。
const httpMod = require('http');
const OR_TARGET = (() => {
  const raw = process.env.LINGJING_OR_BASE || 'https://openrouter.ai/api/v1/chat/completions';
  try {
    const u = new URL(raw);
    return {
      mod: u.protocol === 'http:' ? httpMod : https,
      hostname: u.hostname,
      port: u.port ? Number(u.port) : undefined,
      path: u.pathname + (u.search || ''),
    };
  } catch {
    return { mod: https, hostname: 'openrouter.ai', port: undefined, path: '/api/v1/chat/completions' };
  }
})();
function oneCall(model, system, user, opts = {}, tried = false) {
  const { timeoutMs = 12000, maxTokens = 140, temperature = 0.85 } = opts;
  const body = JSON.stringify({
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    max_tokens: maxTokens,
    temperature,
  });
  return new Promise((resolve) => {
    const req = OR_TARGET.mod.request({
      hostname: OR_TARGET.hostname,
      port: OR_TARGET.port,
      path: OR_TARGET.path,
      method: 'POST',
      timeout: timeoutMs,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${KEY}`,
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
            // ① 账户级日额度用尽（free-models-per-day）→ 熔断到重置时刻，别再白等
            //    ⚠️ 2026-09-10 修严重 bug：X-RateLimit-Reset 是**毫秒**时间戳（如 1789084800000），
            //    旧代码又乘了 1000 → 熔断解除时间落在公元五万年，
            //    后果＝今天一旦熔断，**明天额度恢复了也永远不会再调模型**，学生永远是固定句子。
            //    现在：>1e12 视为毫秒，否则视为秒；并封顶 26 小时，任何异常值都不会锁死进程。
            if (/daily/i.test(src + msg) || /free-models-per-day/.test(msg)) {
              const rawReset = Number((meta.headers || {})['X-RateLimit-Reset']);
              const resetMs = !rawReset ? 0 : (rawReset > 1e12 ? rawReset : rawReset * 1000);
              const until = resetMs
                ? Math.min(Math.max(60000, resetMs - Date.now()), 26 * 3600 * 1000)
                : 3600000;
              markDead(until, '免费模型日额度已用尽');
              resolve(''); return;
            }
            // ② 鉴权失败 → 熔断 10 分钟
            if (j.error.code === 401) { markDead(600000, '密钥无效'); resolve(''); return; }
            // ③ 上游 429/403（共享池忙）→ 同模型再试一次，仍失败则交给降级链换模型
            if (!tried && (j.error.code === 429 || j.error.code === 403)) {
              setTimeout(() => oneCall(model, system, user, opts, true).then(resolve), 900);
              return;
            }
            resolve(''); return;
          }
          resolve((j.choices?.[0]?.message?.content || '').trim());
        } catch { resolve(''); }
      });
    });
    req.on('timeout', () => { req.destroy(); resolve(''); });
    req.on('error', () => resolve(''));
    req.write(body);
    req.end();
  });
}

// 依次尝试模型链，返回第一个非空回答；记住成功的模型
async function orChat(system, user, opts = {}) {
  if (!llmUsable()) return '';
  const deadline = opts.deadline || 0;
  const order = goodModel ? [goodModel].concat(MODEL_CHAIN.filter((m) => m !== goodModel)) : MODEL_CHAIN;
  for (const m of order) {
    if (deadline && Date.now() > deadline) return '';   // 超预算 → 立即走兜底，不拖慢课堂
    const txt = await oneCall(m, system, user, opts);
    if (txt) { goodModel = m; llmVerified = true; return txt; }
    if (!llmUsable()) return '';                        // 已熔断
  }
  return '';
}

// 清洗学生发言：去思考过程/安全标签/代码围栏/引号；只挡**整句英文泄漏**，放行 CO₂、0.5 这类夹带
function cleanSay(s) {
  if (!s) return '';
  let line = String(s).split('\n').map((t) => t.trim()).filter(Boolean)[0] || '';
  if (/thinking process|user safety|analyze the|here's|<\/?think>|^```/i.test(line)) return '';
  const ascii = (line.match(/[A-Za-z]/g) || []).length;
  if (ascii > 0 && ascii / Math.max(1, line.length) > 0.3) return ''; // 大半是英文 → 判定泄漏
  line = line.replace(/[*`#>「」"]/g, '').replace(/^[^：:]{1,6}[：:]\s*/, '').trim();
  line = line.replace(/^[A-Za-z][A-Za-z'’-]{0,20}[:：]?\s*[（(]?/, (m) => (/[\u4e00-\u9fa5]/.test(m) ? m : '')); // 剥掉开头的英文碎片（Let's count: 等）
  line = line.replace(/^[A-Za-z\s'’\-]{0,24}(?=[\u4e00-\u9fa5])/, '');
  const zh = (line.match(/[\u4e00-\u9fa5]/g) || []).length;
  if (zh < 4) return '';                                  // 太短 → 多半是残句
  if (/[(（【[「,，、:：]$/.test(line)) return '';          // 截断在半句 → 丢弃
  if (line.length > 60) line = line.slice(0, 60);
  return line;
}

// 推理型模型会把思考过程写进 content（如 "Here's a thinking process: ..."），
// 这里从全文里捞第一条像中文口语的句子，避免整条回答被丢掉。
function pickChineseLine(raw, self) {
  for (const l of String(raw).split('\n')) {
    const line = l.replace(/[*`#>「」"]/g, '').replace(/^\s*[-•]\s*/, '').trim();
    if (ECHO_WORDS.test(line)) continue;
    const m = line.match(/^(小明|小红|小刚|小丽|小华|先生|老师|学生)\s*[:：]\s*/);
    if (m && (!self || m[1] !== self)) continue;          // 只放行"自己的名字"，别人的算串台
    const body = (m ? line.slice(m[0].length) : line)
      .replace(/^[A-Za-z\s'’\-]{0,24}(?=[\u4e00-\u9fa5])/, '').trim();
    const zh = (body.match(/[\u4e00-\u9fa5]/g) || []).length;
    const asc = (body.match(/[A-Za-z]/g) || []).length;
    if (zh >= 6 && asc <= zh * 0.6) return body.slice(0, 60);
  }
  return '';
}

// 每轮"探测任务"（2026-09-11 重做）：不再让模型自由发挥，而是指定**盯着哪个要点**、**抛哪一类探测**。
// 为什么必须指定：旧版是 5 条固定角色提示轮转（提问题／举例／复述…），5 个学生拿到的任务几乎不变，
// 加上模型天生爱说漂亮话，结果就是"不管我输入什么，他们都回那几句"。
// 现在目标由 (学生序号 + 轮次) 决定：**5 个学生自动分散到不同要点上**——人类讲了 5 个要点，
// 就有 5 个方向被同时探测，一次能看见自己整段讲解上所有的洞；六类探测按轮次错开，4 轮覆盖全六类。
const PROBE_ROLES = {
  counter:   (c) => `针对「${c}」，先说出你原来以为的样子（你的旧想法），再问先生：有没有反过来也成立的情况？`,
  bound:     (c) => `针对「${c}」，问先生：什么情况下它就不成立了？界限在哪儿？`,
  example:   (c) => `针对「${c}」，拿你生活里见过的一件具体小事，问先生：那件事到底算不算？`,
  distinct:  (c) => `针对「${c}」，问先生：它和另一个说法到底差在哪？你总把这两个搞混。`,
  mechanism: (c) => `针对「${c}」，问先生：为什么会这样？中间到底发生了什么？`,
  apply:     (c) => `针对「${c}」，问先生：要是把条件换成别的，结果还会是这样吗？`,
};
// 轮次顺序：先把最"扎人"的三类放前面（反例／边界／正例），再补区分／机制／应用
const PROBE_ORDER = ['counter', 'bound', 'example', 'distinct', 'mechanism', 'apply'];
// 人类回话之后，任务加一层"先接话、再探测"（让课堂是对话，不是各自朗诵）
const FOLLOW_PREFIX = ['先回应先生刚才那句话，再', '听完先生这句，', '先生这么一说，你'];
// 本轮该学生盯哪个要点：串开索引，保证一轮之内 5 个学生不撞车、且覆盖全篇
function probeTarget(concepts, k, round) {
  const M = Math.max(1, concepts.length);
  return concepts[(((k + round - 1) % M) + M) % M] || concepts[0] || '先生讲的内容';
}
// 本轮该学生抛哪一类探测：错开，保证一场课六类都会出现
function probeKind(k, round) {
  const n = PROBE_ORDER.length;
  return PROBE_ORDER[(((k + round - 1) % n) + n) % n];
}

// 老师刚回过话时的"接话开头"（让兜底也像对话，而不是自说自话）
const REACT_OPEN = {
  '小明': ['哦——原来是这样！那', '明白了明白了，那', '嗯嗯，那我还是想问：'],
  '小红': ['先生这么说，我确认一下：', '我记下了。那', '按您的说法，'],
  '小刚': ['哦哦懂了！那', '嗨，原来是这么回事，那', '我就说嘛！那'],
  '小丽': ['先生这么一说，我好像有点明白了……那个', '嗯……那我小声问一句：', '我记下来了……那个'],
  '小华': ['哦——我就说是这样！那', '对对对，那', '行，那我知道了，'],
};
// 兜底探测（无密钥/额度不足）：按 探测类型 × 性格语气 × 要点 组合生成，且**跨轮跳过已说过的**；
// 老师刚回过话时，加上"接话开头"（让兜底也像对话，而不是自说自话）。
// 2026-09-11 重做：旧版是"按最弱概念套 6 句固定台词"，与用户报的"不管输入什么都回那几句"直接相关。
//   新版是**组合式**：6 类探测 × 3 个句式骨架 → 换要点即换句子，再叠性格语气修饰；
//   而且每一句都**指向先生实际讲过的那个要点**——所以输入变了，学生问的就一定跟着变。
//   没有 LLM 时，学生也仍然在干"照出盲区"这件正事，只是问得朴素一点。
const PROBE_FRAME = {
  counter: [
    (c) => `那要是把「${c}」反过来说，还成立吗？`,
    (c) => `「${c}」有没有反过来也说得通的情况？`,
    (c) => `我见过一个跟「${c}」反着来的，先生您说那算什么？`,
  ],
  bound: [
    (c) => `「${c}」到什么份上就不算数了？界线在哪儿？`,
    (c) => `什么情况下「${c}」就不成立了？`,
    (c) => `「${c}」有没有例外？我一直拿不准这个边界`,
  ],
  example: [
    (c) => `我家里那件事，算不算「${c}」？`,
    (c) => `「${c}」我在生活里见过，可我不确定是不是同一回事`,
    (c) => `我能不能拿身边的一件事来试「${c}」？`,
  ],
  distinct: [
    (c) => `「${c}」跟另一个说法到底差在哪？我老搞混`,
    (c) => `我总觉得「${c}」好像就是另一个东西，是不是一回事？`,
    (c) => `「${c}」该怎么跟别的东西区分开？`,
  ],
  mechanism: [
    (c) => `「${c}」为什么会这样？中间到底发生了什么？`,
    (c) => `凭什么一定得是「${c}」这样？里面是怎么走的？`,
    (c) => `「${c}」是怎么来的？我只记住了结果`,
  ],
  apply: [
    (c) => `要是把条件换成别的，「${c}」还会是这样吗？`,
    (c) => `换成另外一种情况，「${c}」还算数吗？`,
    (c) => `我拿别的例子套「${c}」，会不会就不灵了？`,
  ],
};
const VOICE_OPEN = {
  '小明': (s) => s,
  '小红': (s) => '我先确认一下——' + s,
  '小刚': (s) => s + '（我瞎猜的，您别笑）',
  '小丽': (s) => '那个……' + s,
  '小华': (s) => '这个我懂！不过——' + s,
};
function fallbackSay(st, concept, kind, round, used = [], opts = {}) {
  const c = quotable(concept, 18);
  const pool = PROBE_FRAME[kind] || PROBE_FRAME.bound;
  const build = (i) => (VOICE_OPEN[st.name] || ((s) => s))(pool[i % pool.length](c));
  // 先按轮次挑，撞了已说过的话就顺延换骨架（换不出新的就接受重复）
  let line = '';
  for (let i = 0; i < pool.length + 2; i++) {
    const cand = build((round - 1 + i) % pool.length);
    if (!used.includes(cand)) { line = cand; break; }
  }
  if (!line) line = build((round - 1) % pool.length);
  // 老师刚回答过 → 接一句口语化的反应开头
  if (opts.teacherReply) {
    const opens = REACT_OPEN[st.name] || ['嗯，那'];
    const open = opens[(round + (st.i || 0)) % opens.length];
    const merged = open + line;
    if (!used.includes(merged)) line = merged;
  }
  return line;
}

// 判断是否"照抄提示词/串了别人的名字"（小模型常见失败模式）
// 提示词的元话语（"不超过""两行""格式"…）＝模型在复述要求，不是学生自己要说的话
const ECHO_WORDS = /不超过|纯口语|理解度|知识点|say|JSON|第一行|第二行|格式|两行|回答|复述给|该做的事/;
function isEcho(line) {
  return ECHO_WORDS.test(String(line || ''))
    || /^(小明|小红|小刚|小丽|小华|先生|老师|学生)\s*[:：]/.test(String(line || ''));
}

// 把一行模型输出变成"学生要说的一句话"。
//
// ⭐ 2026-09-10 修真 bug（用户现象："不管我输入什么，他们几个都回答固定句子"）：
//   旧逻辑是 `if (!say && !isEcho(l)) say = cleanSay(l)`，而 isEcho() 把**任何**
//   以学生名开头的行（"小明：…"）一律判成"照抄提示词"→ 直接丢弃。
//   但模型给自己写台词时，"小明：…"恰恰是最自然的写法。
//   后果：模型明明答了，却被判无效 → 静默回落到 fallbackSay() 的确定性固定句，
//        表现为"学生完全不理我输入什么"。日志上还看不出问题（调用是成功的）。
//   正确做法：**自己的名字＝正常，剥掉前缀照用；顶着别人的名字＝串台，才丢。**
function takeSay(rawLine, self) {
  let line = String(rawLine == null ? '' : rawLine).trim();
  const m = line.match(/^(小明|小红|小刚|小丽|小华|先生|老师|学生)\s*[:：]\s*/);
  if (m) {
    if (!self || m[1] !== self) return '';      // 别人的名字 → 串台/复述提示词
    line = line.slice(m[0].length).trim();
  }
  if (ECHO_WORDS.test(line)) return '';
  return cleanSay(line);
}

// 解析"一人一次"调用：两行格式（第1行 探测类型，第2行 发言），兼容旧数字格式与 JSON。
//
// ⚠️ 2026-09-11 改：第1行从"N 个理解度小数"改成"一个探测类型"。
//   旧数字格式仍然被吃掉（不报错、不影响解析），但**不再作为任何量的输入**——
//   那是模型采样出来的数，不是对任何东西的观测。见 teaching.js 顶部"停用"说明。
//   类型以模型自报为参考，**以本地正则复核为准**（不采信自报，免得模型乱填）。
const LABEL_RE = new RegExp('^(?:第?1行|类型|标签|探测类型)?[：:、.\\s]*(反例|边界|正例|区分|机制|应用)$');
function parseTurn(raw, n, self) {
  const text = String(raw || '');
  const lines = text.split('\n').map((t) => t.replace(/[*`#>「」"]/g, '').trim()).filter(Boolean);
  let type = null, say = '';
  for (const l of lines) {
    if (!type) {
      const m = l.replace(/\s+/g, '').match(LABEL_RE);
      if (m) { type = PROBE_TYPES.find((p) => p.label === m[1]).key; continue; }
    }
    // 旧格式（一行 N 个 0~1 小数）→ 只跳过，不采用
    if ((l.match(/[\u4e00-\u9fa5]/g) || []).length < 3) {
      const nums = (l.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
      if (nums.length === n && nums.every((x) => x >= 0 && x <= 1)) continue;
    }
    if (!say) { const c = takeSay(l, self); if (c) say = c; }
  }
  // JSON 兼容路径（部分模型仍输出 {"say":"..."}；旧的 {"u":[...]} 只忽略）
  if (!say) {
    const jm = text.match(/\{[\s\S]*\}/);
    if (jm) {
      try {
        const o = JSON.parse(jm[0]);
        if (typeof o.say === 'string') say = takeSay(o.say, self);
        if (!type && typeof o.type === 'string') {
          const lab = o.type.replace(/\s+/g, '');
          const hit = PROBE_TYPES.find((p) => p.label === lab || p.key === lab);
          if (hit) type = hit.key;
        }
        if (!type && typeof o.探测类型 === 'string' && PROBE_TYPES.find((p) => p.label === o.探测类型)) {
          type = PROBE_TYPES.find((p) => p.label === o.探测类型).key;
        }
      } catch { /* 忽略 */ }
    }
  }
  if (!say) say = pickChineseLine(text, self);
  // 模型自报的类型只作参考：与本地正则复核不一致时，以本地复核为准；
  // 复核不出（null）才退回自报——这样"这一课问到了哪几类"这个计数不会被模型随口填坏。
  const local = classifyProbe(say);
  if (local) type = local;
  return { type, say };
}

// ===== 单个学生的一轮：一次调用 → 一枚探测（类型 + 发言）（含人设、记忆、探测任务）=====
//
// 2026-09-11 重做（用户："重新考虑他们的回答……对学生使用者有用……不要固定是那几句"）。
// 与旧版的三个实质差别：
//   ① 第1行从"给我自己打 N 个理解分"改成"本轮探测类型"——**输入源换了**，不再是模型采样数字。
//   ② 探测任务（盯哪个要点、抛哪一类）由 (学生序号 + 轮次) 指定，所以**输入变了问的就一定变**；
//      旧版是 5 条固定角色轮转，模型很容易滑回那几句。
//   ③ 明确"你来上课不是来打分、不是来配合点头"，而是**逼先生把话说清楚**——
//      依据 VanLehn (2003)：学习只在学生到达 impasse 之后发生，学生不制造卡点，讲得再好也没用。
async function studentTurn(st, ctx) {
  const { i, round, lessonText, lessonTitle, concepts,
          teacherReply, peerLines, target, kind, deadline } = ctx;
  const pt = PROBE_TYPES.find((p) => p.key === kind) || PROBE_TYPES[1];
  const sys =
    `你是民国学堂里的学生「${st.name}」，${st.trait}。你不是助手，你就是这个学生本人。\n` +
    `你的说话方式：${st.voice}。你容易卡在：${st.weakness}。你爱说「${st.catch}」。称老师为"先生"。\n` +
    `你进课堂之前，脑子里已经有一个（可能是错的）想法：「${st.mis}」。\n` +
    `⚠️ 你来上课**不是来给自己打分，也不是来配合点头**。你的用处只有一件：逼先生把话说清楚。\n` +
    `你这一轮要抛出的是一枚"探测"——一个具体、能回答、而且答不好就说明先生没讲透的问题。\n` +
    // 句式脚手架：King (2002) Guided Reciprocal Peer Questioning —— 通用句式比"随便问"产出质量高得多
    `🔎 提问只能用这六种句式之一（互惠同伴提问）：\n` +
    `   举个例子：……那件事算不算？／ 什么情况下它就不成立了？／ 有没有反过来也成立的？／\n` +
    `   这两个说法到底差在哪？／ 为什么会这样、中间发生了什么？／ 要是换成别的，会怎样？\n` +
    // 必须"具体"：Watson & Mason 的边界例要求造出具体例子，而不是停在抽象层面
    `⚠️ **必须先亮出你自己的旧想法，再说它跟先生讲的哪里对不上。**\n` +
    `⚠️ 必须具体：拿生活里一件真事、一个数字、一个反着来的情况当材料；不许讲空道理，\n` +
    `   更不许问"能再讲一遍吗""我还是不明白"这种没内容的话。\n` +
    `请严格按两行回答，不要任何别的字：\n` +
    `第1行：本轮探测类型，只能填「反例」「边界」「正例」「区分」「机制」「应用」中的一个\n` +
    `第2行：你要说的一句话（不超过40字，大白话）`;
  const usr =
    `先生在讲：《${lessonTitle}》\n内容：${lessonText}\n` +
    `本轮你盯住的要点：「${target}」\n` +
    `本轮你要抛的探测类型：${pt.label}（${pt.hint}）\n` +
    `先生刚才说：${teacherReply ? teacherReply : '（第一轮，先生刚讲完课）'}\n` +
    `同学刚才说：${peerLines.length ? peerLines.join('；') : '（还没人发言）'}\n` +
    `你上轮说过：${st.last || '（还没发过言）'}\n` +
    `你进课堂前的旧想法：${st.mis}\n` +
    `这轮你要做的事：${ctx.role}\n` +
    `可以拿你的旧想法对照，可以和同学争；别说客套话；别重复自己说过的。两行。`;

  const raw = await orChat(sys, usr, { maxTokens: 220, temperature: 0.85 + (i % 5) * 0.03, deadline });
  const t = parseTurn(raw, concepts.length, st.name);
  const kind2 = t.type || kind;
  const say = t.say || fallbackSay(st, target, kind2, round, st.memory.map((m) => m.text), { teacherReply, i });
  return { say, type: kind2, usedLLM: !!t.say, ci: ctx.targetIdx };   // ci = 盯住的是第几个要点
}

// ===== 课堂会话（支持"老师回话 → 学生再反应"的闭环）=====
function createSession(lesson, { maxRounds = 4 } = {}) {
  const w = new World();
  const teacher = { id: w.addAgent({ kind: 'agent', name: '你（教师）', profession: 'teacher' }), name: '你（教师）' };

  const lessonTitle = lesson.title;
  const lessonText = lesson.content;
  const concepts = extractConcepts(lessonText, lesson.concepts);   // 定义1（须先于学生创建：前概念要挂到概念上）
  const difficulties = concepts.map(estimateDifficulty);

  const students = PERSONALITIES.map((p, i) => ({
    id: w.addAgent({ kind: 'agent', name: p.name, profession: 'student' }),
    ...p, last: '', memory: [],
    // 前概念（误解）+ 本轮抛出的探测类型。
    // ⚠️ 不再有"知识状态 p"，也不再有"上一轮探测被接住的程度 addressed"——
    //   我们不可能知道一个 AI 学生"学会了多少"或"被接住了多少"（它没有脑子），
    //   2-gram 判定那个近似也被证明是噪声。学生只负责抛探测，判定权归人类。
    mis: guessMisconception(i, concepts), myQ: '', probeType: null,
  }));
  teachingRelation(w, teacher.id, students.map((s) => s.id)); // R_教学

  const asked = [];          // 全程已发言（跨轮去重参考）
  const memory = [];         // 课堂对话记忆：[{round, speaker, text}]
  const probes = [];         // 本课全部探测：[{round, name, type, say}]（真实文本 + 本地复核的类型）
  const rounds = [];
  const teacherReplies = []; // 教师的每一轮回答（用于"你补出了什么"）
  let round = 0;
  let done = false;
  let _result = null;

  // 第 1 拍：教师讲授（公理3：外部输入）-> lesson 作品持久留世界
  w.addArtifact({ owner: teacher.id, kind: 'artifact', payload: { type: 'lesson', role: 'lesson', title: lessonTitle, content: lessonText } });

  function startPayload() {
    return {
      type: 'start',
      lessonTitle, lessonText, concepts, difficulties, maxRounds,
      usedLLM: llmUsable(),
      llm: llmStatus(),
      students: students.map((s) => ({ name: s.name, trait: s.trait, alpha: s.alpha, voice: s.voice, catch: s.catch, mis: s.mis })),
    };
  }

  async function playRound(teacherReply, onEvent, onLog) {
    round += 1;
    if (teacherReply) memory.push({ round: round - 1, speaker: '老师', text: teacherReply });
    onEvent({ type: 'round_start', round, teacherReply: teacherReply || '' });
    onLog(`-- 第${round}轮 --${teacherReply ? `（老师回答：${teacherReply}）` : ''}`);

    const peerLines = memory.filter((m) => m.speaker !== '老师').slice(-4).map((m) => `${m.speaker}：${m.text}`);

    // 5 个学生分批调用（每人一次调用同时产出 理解自评+发言）。
    // 2026-09-10 实测：5 个请求同时打免费池会互相挤掉（429），改为每批 2 人、批间 400ms，命中率明显更高。
    // 若 key 已充值（1000 次/天、限流宽松），可设 LINGJING_CONC=5 恢复全并发提速。
    const turns = new Array(students.length);
    const BATCH = Math.max(1, Math.min(5, Number(process.env.LINGJING_CONC) || 2));
    const deadline = Date.now() + LLM_BUDGET_MS;   // 本轮 LLM 时间预算（超出用兜底补齐）
    for (let s0 = 0; s0 < students.length; s0 += BATCH) {
      const idx = [];
      for (let k = s0; k < Math.min(s0 + BATCH, students.length); k++) idx.push(k);
      const res = await Promise.all(idx.map((k, t) => (async () => {
        if (t) await sleep(250);
        // 本轮探测任务：盯哪个要点（串开，一轮内 5 人不撞车）、抛哪一类（六类错开）
        const target = probeTarget(concepts, k, round);
        const kind = probeKind(k, round);
        const base = PROBE_ROLES[kind](target);
        const role = round <= 1 ? base : FOLLOW_PREFIX[(k + round) % FOLLOW_PREFIX.length] + base;
        return studentTurn(students[k], {
          i: k, round, lessonTitle, lessonText, concepts,
          teacherReply: teacherReply || '',
          peerLines, deadline, target, kind, role,
          targetIdx: (((k + round - 1) % Math.max(1, concepts.length)) + Math.max(1, concepts.length)) % Math.max(1, concepts.length),
        });
      })()));
      idx.forEach((k, t) => { turns[k] = res[t]; });
      if (s0 + BATCH < students.length) await sleep(400);
    }

    // ⚠️ 2026-09-11 重大更正：这里原来做「接住」自动判定（教师回答与学生问题的 2-gram 重叠）。
    //   上标定发现它**基本是噪声**：好回答能得 0.000，敷衍的"好的下次再讲"反而得 0.333。
    //   （标定数据见 .workbuddy/reports/2026-09-11-停止给AI学生打分.md）
    //   于是这个判断**整段删除**，交回给人：课后逐条列出"学生问了什么 / 你答了什么"，
    //   由人类自己判"答到了没有"。这更诚实，也更管用——逐条正视本身就把盲区逼出来了。
    //   这里只做一件机器确实做得到的事：把**你的回答原文**挂到那枚探测上（一一对应，不改一个字）。
    if (teacherReply) {
      teacherReplies.push({ round: round - 1, text: teacherReply, clarifying: isClarifying(teacherReply) });
      for (const st of students) {
        const lastP = probes.filter((p) => p.name === st.name).pop();
        if (lastP && lastP.answer == null) lastP.answer = teacherReply;   // 这枚探测收到的回答
      }
    }

    const utterances = [];
    for (let i = 0; i < students.length; i++) {
      const st = students[i], turn = turns[i];
      // ⚠️ 2026-09-11：Δp / P / E / σ² / H 与"自评理解度 R"全部删除（见 teaching.js 顶部"停用"说明）。
      //   学生头顶那条不再表示任何"程度"——它等着**人类在课后逐条判定**后才亮起来。
      onEvent({ type: 'probe', round, name: st.name, mis: st.mis });
      await sleep(200);
      st.myQ = turn.say;          // 本轮抛出的探测（下一轮收到的回答会回填到 probes 记录上）
      st.probeType = turn.type;
      st.probeCi = turn.ci;
      if (turn.say) probes.push({ round, name: st.name, type: turn.type, ci: turn.ci, say: turn.say, answer: null });
      onEvent({ type: 'ask', round, name: st.name, text: turn.say, probeType: turn.type, usedLLM: turn.usedLLM });
      onLog(`  ${st.name}［${probeLabel(turn.type) || '探测'}］：${turn.say}`);
      st.last = turn.say;
      st.memory.push({ round, text: turn.say });
      memory.push({ round, speaker: st.name, text: turn.say });
      asked.push(turn.say);
      w.addArtifact({ owner: st.id, kind: 'artifact', payload: { type: 'note', role: 'student-note', text: turn.say, round, probeType: turn.type } });
      utterances.push({ name: st.name, text: turn.say, usedLLM: turn.usedLLM, probeType: turn.type, mis: st.mis });
      await sleep(360);
    }

    const canContinue = round < maxRounds;
    const llmOk = turns.filter((t) => t.usedLLM).length;   // 本轮真走 LLM 的学生数（诚实标注用）
    const roundProbes = probes.filter((p) => p.round === round);
    // 机器只报事实：这一轮学生问了几枚；"你答到了几枚"要等人类课后逐条判（不预判）
    onEvent({ type: 'round_end', round, canContinue, llmOk, probeCount: roundProbes.length });
    onLog(`第${round}轮：学生抛出探测 ${roundProbes.length} 枚（LLM 学生 ${llmOk}/${students.length}）· 你答到了几枚，课后逐条对照着判`);
    rounds.push({ round, utterances, llmOk, probes: roundProbes, teacherReply: teacherReply || '' });
    return { round, canContinue };
  }

  // ===== 下课：5 个学生共同产出一份《课堂纪要》（人类的作品/收获），并算出教师的益处 =====
  // 用户定框架：软件的价值是让**人类**整理、升华自己的知识；AI 学生是镜子与提问者，不是学习者。
  async function buildMinutes() {
    const pts = teacherPoints(lessonText);
    // 三、四两节必须互斥，且只能用**事实**来分：这一枚探测收到过先生的回答没有。
    // ⚠️ 只认探测记录本身（每枚探测带自己的 answer）——不再用 students[].myQ（那是"本轮新问的句子"，会错配）。
    // ⚠️ 也不再自动判"先生答到了没"：那个 2-gram 判据标定下来是噪声（好回答 0.000，敷衍 0.333），
    //   判定权交回人类（课后逐条看"他问的 / 你答的"，见 teacherReport 第二节）。
    const gotIt = probes.filter((p) => p.answer != null);
    const openQ = probes.filter((p) => p.answer == null);

    if (llmUsable()) {
      const sys =
        `你们是这个学堂里的五个学生（小明、小红、小刚、小丽、小华），刚上完先生的课。` +
        `现在你们五个一起给先生写一份《课堂纪要》，用中文 Markdown，四个小节：` +
        `一、先生讲了什么（我们记下的要点）；二、我们原来的想法（可能不对的旧想法）；` +
        `三、我们问的、先生给了回答的；四、我们问的、先生还没回的（下次请先生补）。` +
        `注意：你们是来**问**的，不是来夸的；第四节最重要，写得越具体先生越有用。` +
        `要具体、说人话、别客套、别用"老师讲得很好"这类空话。每节 2~5 条，短句。只输出 Markdown。`;
      const usr =
        `课题：《${lessonTitle}》\n先生的讲解：${lessonText}\n\n` +
        `课堂实录：\n${memory.map((m) => `${m.speaker}：${m.text}`).join('\n')}\n\n` +
        `我们各自的旧想法：\n${students.map((s) => `- ${s.name}：${s.mis}`).join('\n')}\n`;
      const md = await orChat(sys, usr, { maxTokens: 700, timeoutMs: 25000 });
      if (md && md.length > 60) return { md: md.trim(), by: 'LLM 五生合写' };
    }
    // 兜底：由本场真实的发言与前概念拼装（不是凭空生成）
    const md = [
      `# 《${lessonTitle}》课堂纪要`,
      '',
      '## 一、先生讲了什么（我们记下的要点）',
      ...(pts.length ? pts.map((p) => `- ${p}`) : ['- （先生这次讲得比较短，没留下成条的要点）']),
      '',
      '## 二、我们原来的想法（可能不对的旧想法）',
      ...students.map((s) => `- ${s.name}：${s.mis}`),
      '',
      '## 三、我们问的、先生给了回答的',
      // ⚠️ 这里**不再**写"我们弄明白了"——我们只是模拟学生，说"我懂了"是演戏，不是事实。
      //    也不写"先生答到了"——那需要判定"答没答到"，机器做不到（判据是噪声，已撤）。
      //    只并排两条**真实文本**："我们问的" + "先生答的"。答到没有，留给人自己看。
      // say 里已经带了「」→ 用 quotable 去内层引号，免得纪要里出现「…「…」…」套娃
      ...(gotIt.length ? gotIt.map((p) => `- ${p.name}［${probeLabel(p.type) || '探测'}］${quotable(p.say, 30)} —— 先生的回答：${quotable(p.answer, 26)}`)
        : ['- 我们抛出的问题，先生这一轮还没给回答。']),
      '',
      '## 四、我们问的、先生还没回的（下次请先生补）',
      ...(openQ.length ? openQ.map((p) => `- ${p.name}［${probeLabel(p.type) || '探测'}］${p.say}`)
        : ['- 我们问的，先生都回了。']),
      '',
      `> 这份纪要是课上五名学生的发言与旧想法整理出来的（由本地程序拼装，不是 AI 模型写的）。`,
    ].join('\n');
    return { md, by: '五生发言拼装' };
  }

  async function finalize(onEvent, onLog) {
    let lessons = 0, notes = 0;
    for (const v of w.S.values()) {
      if (v.kind === 'artifact') {
        if (v.payload.type === 'lesson') lessons++;
        else if (v.payload.type === 'note') notes++;
      }
    }
    const V = valueFunction(w, teacher.id, students.map((s) => s.id));

    // —— 教师收益（用户的收益才是产品目标）——
    // ⚠️ 2026-09-11 两次删除，说清楚为什么，免得以后又被"补回来"：
    //   ① `resolved`（"疑惑被解开的"）与 `completeness`（"讲解完整度"）—— 源头都是**学生自评理解度**，
    //      那是模型随机采样出的一个数，没有真值来源。在它上面求均值/方差/熵，等于给随机数化妆。删。
    //   ② `caught` / `caughtRate` / `blindSpots` / `conceptCaught` 的**自动**版本 —— 用"教师回答与
    //      学生问题 2-gram 重叠"判定"答到了没有"。标定 9 组真实问答后发现它基本是噪声：
    //      好回答得 0.000（他换了词），敷衍的"好的下次再讲"得 0.333（它复述了学生用词）。
    //      **用噪声下判断，比不判更糟**，所以判定权交回人类（课后把"他问的 / 你答的"逐条并排）。
    //   于是 gains 里**只剩机器真数得出来的事实**，一个判断性的数都没有：
    //   "你答到了几枚"这个问题在本产品的数据模型里**不存在**，它只存在于人读完清单之后的脑子里。
    const pts = teacherPoints(lessonText);
    const clarify = teacherReplies.filter((r) => r.clarifying).length;
    const counts = probeCounts(probes);
    const gains = {
      points: pts.length,                       // 你讲出的要点条数
      replies: teacherReplies.length,           // 你回答了几轮
      clarifying: clarify,                      // 其中带出前提/例子/边界的澄清型回答
      probes: probes.length,                    // 学生一共抛出多少枚探测
      probeLine: probeSummaryLine(counts),      // 六类构成的"人话一行"（计数，非分数）
      probeKinds: counts,
      answered: probes.filter((p) => p.answer != null).length,  // 其中几枚收到了你的回答（事实，非判定）
      open: probes.filter((p) => p.answer == null).length,      // 其中几枚你没回（多为收尾前刚问的）
    };

    // —— 教师元认知收益层（需求⑥：教中学 / protégé effect + IOED + 费曼）——
    // 把课堂里**真实说过的话**（你的要点、你是否带出前提/例子、学生问了什么、你答了什么）整理成
    // 人话反馈：不替你下"答到了没有"的结论，而是把问题与你的回答并排放好，逼你自己正视。
    const teacherDiag = teacherDiagnosis({ points: pts, teacherReplies, probes });
    const teacherReportMd = teacherReport(teacherDiag, { title: lessonTitle });

    // —— 作品：五生共同的《课堂纪要》落盘 ——
    let minutes = { md: '', by: '', path: '', error: '' };
    let teacherGainFile = '';
    try {
      const m = await buildMinutes();
      const dir = path.join(__dirname, 'sessions');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const base = `${stamp}-${String(lessonTitle).replace(/[\\/:*?"<>|\s]/g, '_')}`;
      const file = path.join(dir, `${base}-课堂纪要.md`);
      fs.writeFileSync(file, m.md, 'utf-8');
      minutes = { md: m.md, by: m.by, path: file, error: '' };
      onLog(`\n《课堂纪要》已由五名学生共同写出 → ${file}`);
      // 教师的"我的收获"：教中学的核心作品，单独落盘，方便使用者留存/回看
      teacherGainFile = path.join(dir, `${base}-我的收获.md`);
      fs.writeFileSync(teacherGainFile, teacherReportMd, 'utf-8');
      onLog(`《我的收获》（教中学反馈）已写出 → ${teacherGainFile}`);
    } catch (e) {
      minutes = { md: '', by: '', path: '', error: String((e && e.message) || e) };
      onLog(`《课堂纪要》生成失败：${minutes.error}`);
    }

    onLog(`\n课堂结束：世界 T=${w.T}，在场 ${w.measure().agents}（1 教师 + ${students.length} AI 学生）`);
    onLog(`留存作品 ${lessons + notes} 件；R_教学边 ${[...w.R.values()].length}；V(s)=${V.toFixed(3)}`);
    // ⚠️ 2026-09-11：原来这里的 `conceptCaught`（每个要点上"探测被接住率"）已删除，它有两重毛病：
    //   ① 分子靠 2-gram 自动判定 —— 标定证明是噪声；
    //   ② 分母是"探测落在这个要点上的枚数" —— 而探测落到哪个要点是**我们自己按轮次错开分配的**
    //      （见 probeTarget），压根不是"学生的真实困惑分布"。
    //   拿自己造出来的分布当"学生在哪里卡住"的证据，是循环论证。
    //   要按要点看，就直接给原始提问文本（下面 probeByConcept），不给比率、不给分数。
    const probeByConcept = concepts.map((c, j) => ({
      concept: c,
      asks: probes.filter((p) => p.ci === j).map((p) => ({
        name: p.name, type: p.type, say: p.say, round: p.round, answered: p.answer != null,
      })),
    }));

    onLog(`你的收获：要点 ${gains.points} 条 · 澄清型回答 ${gains.clarifying}/${gains.replies} · 学生抛出探测 ${gains.probes} 枚`
      + `${gains.probeLine ? '（' + gains.probeLine + '）' : ''} · 其中 ${gains.answered} 枚你回了、${gains.probes - gains.answered} 枚没回`
      + `（"答到没有"由你在课后逐条判——机器只能数词，不能读心）`);
    if (!llmUsable()) onLog(`（注：${KEY ? 'LLM 当前不可用：' + (deadReason || '额度/限流') : '未检测到 LINGJING_OR_KEY'}，学生发言走确定性兜底语料）`);

    const result = {
      lessonTitle, lessonText, concepts, difficulties,
      students: students.map((s) => ({ name: s.name, trait: s.trait, alpha: s.alpha, voice: s.voice, catch: s.catch, mis: s.mis, probeType: s.probeType })),
      rounds, lessons, notes, artifacts: lessons + notes,
      teachingEdges: [...w.R.values()].length, V, agents: w.measure().agents,
      usedLLM: llmUsable(),
      transcript: memory,
      probes,         // 本课全部探测（真实文本 + 本地复核类型）——产品的一等公民
      probeByConcept, // 按要点归拢的原始提问文本（替代已删的 conceptCaught 比率）
      gains,          // 人类教师的收益（产品目标）
      minutes,        // 五生共同的《课堂纪要》（作品）
      teacherGain: teacherDiag,    // 教中学：教师自身盲区诊断（需求⑥）
      teacherReportMd,            // 教中学：教师人话"我的收获"报告（需求⑥核心交付物）
      teacherGainFile,            // 教中学报告落盘路径
    };
    done = true;
    _result = result;
    onEvent({ type: 'done', ...result });
    return result;
  }

  return {
    lesson, lessonTitle, lessonText, concepts, difficulties, students, world: w,
    get round() { return round; },
    get memory() { return memory; },
    get probes() { return probes; },
    get done() { return done; },
    get result() { return _result; },
    get rounds() { return rounds; },
    startPayload,
    // 开始上课：发出 start，跑第 1 轮
    async start(onEvent, onLog) {
      onLog(`【教师讲授】《${lessonTitle}》：${lessonText}`);
      onEvent(startPayload());
      return playRound('', onEvent, onLog);
    },
    // 老师回话 → 跑下一轮；已是最后一轮则自动收尾（emit done）
    async reply(text, onEvent, onLog) {
      if (done) return { done: true };
      if (round >= maxRounds) { await finalize(onEvent, onLog); return { done: true }; }
      return playRound((text || '').trim(), onEvent, onLog);
    },
    finish(onEvent, onLog) { return done ? { done: true } : finalize(onEvent, onLog); },
  };
}

// ---- 自动跑满 maxRounds 轮（CLI 与 2D 网页 /api/teach 用；不需要老师中途回话）----
async function runClassroom(lesson, { onLog = () => {}, onEvent = () => {}, maxRounds = 4 } = {}) {
  const s = createSession(lesson, { maxRounds });
  await s.start(onEvent, onLog);
  while (!s.done && s.round < maxRounds) await s.reply('', onEvent, onLog);
  await s.finish(onEvent, onLog);   // 已 done 时为 no-op（finalize 是 async，必须 await）
  return s.result;
}

// ---- CLI 入口 ----
function parseLesson(arg) {
  const i = arg.indexOf('::');
  if (!arg) return { title: '光合作用', content: '植物用阳光作能量，把水和二氧化碳变成糖（储存能量）和氧气。' };
  const body = i >= 0
    ? { title: arg.slice(0, i).trim(), content: arg.slice(i + 2).trim() }
    : { title: '我的课题', content: arg };
  const dbl = body.content.indexOf('||');
  if (dbl >= 0) {
    body.concepts = body.content.slice(dbl + 2).split('|').map((s) => s.trim()).filter(Boolean);
    body.content = body.content.slice(0, dbl);
  }
  return body;
}

if (require.main === module) {
  // 真实形态：人把自己的知识/经验作为教案输入；此处可用命令行传入任意课题
  //   node teacher.js "课题名::你的讲解…[||概念1|概念2]"
  const arg = process.argv.slice(2).join(' ').trim();
  runClassroom(parseLesson(arg), { onLog: console.log });
}

module.exports = {
  createSession, runClassroom, parseLesson, orChat, oneCall, cleanSay, pickChineseLine, parseTurn, takeSay,
  fallbackSay, PERSONALITIES, studentTurn, MODEL, MODEL_CHAIN, llmStatus, llmUsable, markDead,
};
