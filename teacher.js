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
// 学生大脑 = 「这个办法」的「免费对话→输出」环节：走 llm.sfChat('chat')（硅基流动免费对话模型
// deepseek-ai/DeepSeek-R1-0528-Qwen3-8B；硅基流动无 key/失败自动走 OpenRouter 免费兜底）。
// 与配图/翻译/推理/语音工具同一条免费链路——整个产品不再劈成两半。
// 无密钥/超时/限流时走确定性兜底语料。安全：密钥只从环境变量读取，绝不写进本文件或仓库。
//
// 运行（CLI）：     LINGJING_OR_KEY=sk-or-... node teacher.js "课题名::你的讲解…"
// 运行（网页）：   node server.js   →  浏览器开 http://localhost:8080

const fs = require('fs');
const path = require('path');
const { World } = require('./world.js');
const {
  PERSONALITIES, clamp, extractConcepts, estimateDifficulty, valueFunction, teachingRelation,
  assessLessonConcreteness,
  guessMisconception, teacherPoints, isClarifying, quotable,
  teacherDiagnosis, teacherReport,
  PROBE_TYPES, classifyProbe, probeLabel, probeCounts, probeSummaryLine,
  detectWeakPoints, weakPointToProbeType, probeVerdict,
  roughApprox, evidenceInterval, sequentialConceptVerdict, zpdFading,
} = require('./teaching.js');
const {
  buildQuestionSpec, renderWpHint, inferResponseMode,
} = require('./questioning.js');   // TCMQ 确定性提问引擎（提问方法论解耦为独立模块）
const reflection = require('./public/reflection.js');   // 双稿制确定性反思引擎（总结方法论解耦为独立模块）

const llm = require('./llm.js');   // LLM 传输层已抽离为独立连接器（见 llm.js）
const { KEY, MODEL, MODEL_CHAIN, oneCall, orChat, sfChat, llmStatus, llmUsable, markDead, LLM_BUDGET_MS } = llm;
const { buildWeakGraph } = require('./graph.js');   // G 图论盲区网（路线）
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// （LLM 传输层已抽离至独立模块 llm.js：模型降级链 / 额度熔断 / 端点覆盖 / oneCall / orChat。
//   本文件只通过上方 `const llm = require('./llm.js')` 取用，密钥仅读环境变量。）
// （oneCall / orChat 已随 LLM 传输层一并迁至 llm.js；本文件通过 `orChat` 别名直接调用。）

// 清洗学生发言：去思考过程/安全标签/代码围栏/引号；只挡**整句英文泄漏**，放行 CO₂、0.5 这类夹带
function cleanSay(s) {
  if (!s) return '';
  let line = String(s).split('\n').map((t) => t.trim()).filter(Boolean)[0] || '';
  if (/thinking process|user safety|analyze the|here's|<\/?think>|^```/i.test(line)) return '';
  const ascii = (line.match(/[A-Za-z]/g) || []).length;
  if (ascii > 0 && ascii / Math.max(1, line.length) > 0.3) return ''; // 大半是英文 → 判定泄漏
  // 剥开头泄漏的元指令标签（craft: / answer: / 类型： / 第2行： 等模型把内部提示词带进了嘴）
  // ⚠️ 2026-09-16 修：前缀上限从 {1,14} 收到 {1,6}。
  //   旧值会连"先生您说地球自转是关键："这种含冒号的引述从句也一口吞掉（最多 14 个汉字），
  //   导致第二轮学生把老师刚说的关键句（含冒号）整个丢掉、只留冒号后的碎片段——
  //   镜子没照全，且让"人类输入真的进了学生嘴"这条接线测试在第二轮误报红。
  //   真实说话人标签都是 ≤6 字（小明：/学生：/先生：/我想问：），收到 6 字足够且不伤引述。
  line = line.replace(/^[A-Za-z\u4e00-\u9fa5]{1,6}[:：]\s*/i, '')
            .replace(/^第\s*\d+\s*行\s*[:：]\s*/i, '')
            .replace(/^(类型|标签|探测类型|type|answer|response|reply|output|note)\s*[:：]\s*/i, '');
  line = line.replace(/[*`#>「」"]/g, '').replace(/^[^：:]{1,6}[：:]\s*/, '').trim();
  line = line.replace(/^[A-Za-z][A-Za-z'’-]{0,20}[:：]?\s*[（(]?/, (m) => (/[\u4e00-\u9fa5]/.test(m) ? m : ''));
  line = line.replace(/^[A-Za-z\s'’\-:]{0,24}(?=[\u4e00-\u9fa5])/, ''); // 含 ":" 才能吃掉 "craft:" 这类前缀
  // 剥尾部泄漏的元指令（免费模型有时把 "Count characters:" / "字数" 这类提示回显到句尾）
  line = line.replace(/\s*(?:count characters|character count|char count|字数|字符数|note)\s*[:：]?\s*[^\n。？！]*$/i, '');
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
      .replace(/^[A-Za-z\u4e00-\u9fa5]{1,14}[:：]\s*/i, '')
      .replace(/^[A-Za-z\s'’\-:]{0,24}(?=[\u4e00-\u9fa5])/, '').trim();
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
// 课堂纪要：LLM 可能把内部规划草稿（"We need to output markdown..."）当正文返回，
// 这种 CoT 泄漏必须拦下，否则课后交付物是废品。拦下则回退到本地拼装（见 buildMinutes 兜底）。
function looksLikeCoT(s) {
  if (!s) return true;
  const t = String(s).trim();
  if (/we need to|let'?s (extract|output|think|write)|let me|here'?s (a|the)|first,?\s|i (will|need to)|step \d|below is|as an ai/i.test(t)) return true;
  const head = t.slice(0, 240);
  const zh = (head.match(/[\u4e00-\u9fa5]/g) || []).length;
  const en = (head.match(/[A-Za-z]/g) || []).length;
  if (en > zh) return true; // 开头大半是英文 → 规划草稿
  return false;
}
function extractMarkdown(raw) {
  const text = String(raw || '').trim();
  const i = text.search(/^#{1,6}\s|^\s*[-*]\s|^\s*\d+\.\s/m);
  return (i > 0 ? text.slice(i) : text).trim();
}

const PROBE_ROLES = {
  counter:   (c) => `针对「${c}」，先说出你原来以为的样子（你的旧想法），再问先生：有没有反过来也成立的情况？`,
  bound:     (c) => `针对「${c}」，问先生：什么情况下它就不成立了？界限在哪儿？`,
  example:   (c) => `针对「${c}」，拿你生活里见过的一件具体小事，问先生：那件事到底算不算？`,
  distinct:  (c) => `针对「${c}」，问先生：它和另一个说法到底差在哪？你总把这两个搞混。`,
  mechanism: (c) => `针对「${c}」，问先生：为什么会这样？中间到底发生了什么？`,
  apply:     (c) => `针对「${c}」，问先生：要是把条件换成别的，结果还会是这样吗？`,
  // 薄教案专用：把先生原话**原样举起来**逼落地，而不是装作有概念可探
  land:     (c) => `把你听到的先生那句话「${c}」**原样举起来**，质疑它太虚：问"这到底什么意思""思维/概念指什么""能不能拿一件具体的事说明白""它跟别的说法差在哪"。逼先生把口号落地成能懂的东西。`,
};
// 轮次顺序：先把最"扎人"的三类放前面（反例／边界／正例），再补区分／机制／应用
const PROBE_ORDER = ['counter', 'bound', 'example', 'distinct', 'mechanism', 'apply'];
// 人类回话之后，任务加一层"先接话、再探测"（让课堂是对话，不是各自朗诵）
const FOLLOW_PREFIX = ['先回应先生刚才那句话，再', '听完先生这句，', '先生这么一说，你'];
// 本轮该学生盯哪个要点：串开索引，保证一轮之内 K 个学生不撞车、且覆盖全篇。
// 即「子模覆盖」的贪心指派（Nemhauser 1978 近似 1−1/e）：每枚探测覆盖一个新要点时边际增益最大；
// 当 K≤M 时一轮即可全覆盖——这是探测调度形式化的理论依据。
function probeTarget(concepts, k, round) {
  const M = Math.max(1, concepts.length);
  return concepts[(((k + round - 1) % M) + M) % M] || concepts[0] || '先生讲的内容';
}
// 本轮该学生抛哪一类探测：错开，保证一场课六类都会出现
function probeKind(k, round) {
  const n = PROBE_ORDER.length;
  return PROBE_ORDER[(((k + round - 1) % n) + n) % n];
}

// 信息论覆盖（概念空间）：探测对要点的覆盖 + 剩余盲区熵；覆盖 ≠ 掌握，只报事实
// 作为"探测调度 = 子模覆盖贪心"的可观测输出（Nemhauser 1978 近似 1−1/e）
function conceptCoverage(probes, concepts) {
  const M = Math.max(1, concepts.length);
  const hit = new Set(probes.map((p) => p.ci).filter((c) => c != null));
  const covered = hit.size;
  const uncovered = concepts.map((c, j) => j).filter((j) => !hit.has(j)).map((j) => concepts[j]);
  const counts = concepts.map((_, j) => probes.filter((p) => p.ci === j).length);
  const total = counts.reduce((a, b) => a + b, 0) || 1;
  let H = 0;
  for (const c of counts) if (c > 0) { const p = c / total; H -= p * Math.log2(p); }
  return { covered, total: M, uncovered, entropy: H, maxEntropy: Math.log2(M) };
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
  // 薄教案专用：6 个角度错开，避免 5 学生×多轮重复同一句。全部"举原话+逼落地"。
  land: [
    (c) => `先生，你说「${c}」——可我听不懂，「思维」到底指什么？`,
    (c) => `「${c}」听着像对的，可你能拿一件**具体的事**说说吗？别只说口号`,
    (c) => `我有点懵：「${c}」——它跟算数、做题到底啥关系，怎么就成了思维？`,
    (c) => `「${c}」这话太虚了，你能不能讲讲它**到底是怎么一回事**？`,
    (c) => `先生，我记住了「${c}」这句话，可不知道拿它干嘛、怎么用，能举个例子不？`,
    (c) => `「${c}」——那反过来，不算思维的数学有没有？你这话有没有漏的？`,
  ],
};
// 薄教案（口号式空话）专用提示：镜子把先生原话**原样举起来**逼落地。
// 不走 buildQuestionSpec（避免 pickStance/PROBE_TO_LEVEL 在 'land' 上取 undefined）。
function LAND_HINT(claim, round) {
  const q = String(claim || '').replace(/[「」]/g, '').slice(0, 24);
  // 按轮次换侧重，避免 4 轮都问同一句（CLI 无教师回话时尤其需要）
  const angle = [
    '先问"这话到底什么意思"',
    '逼他拿一件具体的事（比如买菜找零、解应用题）说明白',
    '问它跟算数/做题到底啥关系，怎么就成了"思维"',
    '问反过来：不算思维的数学有没有？这话有没有漏的',
  ][((round || 1) - 1) % 4];
  return [
    `🔎 先生这句是口号式的空话，没有具体例子、也没讲机制。`,
    `🔎 镜面锚定：把你听到的原话「${q}」**原样举起来**反弹回去——不要替他解释，也不要换个说法。`,
    `🔎 本轮侧重（别照抄这句、别背提示词，用自己的话、换角度问）：${angle}。`,
    `🔎 姿态：你是来听课的学生，不是考官——只请先生把这句话讲透，不评判、不赞美。`,
    `🔎 陌生学徒：零背景，别替先生脑补前提；你越"不懂他的世界"，他越会把默认前提讲出来。`,
    `🔎 解释不辩护：只请他讲"什么意思、怎么发生"，绝不为"数学是不是思维"这个立场辩护。`,
    `🔎 别和同学、也别和你自己上一轮说一样的话——每轮换个问法。`,
  ].join('\n');
}
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
const LABEL_RE = new RegExp('^(?:第?1行|类型|标签|探测类型)?[：:、.\\s]*(反例|边界|正例|区分|机制|应用|落地)$');
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

// ===== 镜子的「照—问」两步法（全免费，把组合办法真正落到镜子上）=====
// 照（推理 Xing4.0-29B 免费）：从先生的话 + 这枚学生的前概念，找出最该被追问的那一个具体缺口（内部，不展示）。
// 问（对话 Qwen3-8B 免费）：把缺口说成学生口吻的一句追问（非推理模型，不冒思维链、不照抄提示）。
// 任一段失败 → 退回旧的"单次 chat"用法（已实测可用），镜子绝不哑。
// 设计依据：一个推理模型既要找缝又要开口容易滑回提示句；两模型各司其职 → 缝更准、话更自然人话。
async function mirrorAsk(st, ctx) {
  const { i, round, lessonText, lessonTitle, concepts, teacherReply, target, kind, deadline, wpHint } = ctx;
  const pt = PROBE_TYPES.find((p) => p.key === kind) || PROBE_TYPES[1];

  // —— 照：推理模型找缝（内部，绝不展示给用户）——
  let gap = '';
  try {
    const g = await sfChat('reason',
      '你是课堂里的"镜子"。先生刚讲了一句话，你要找出这句话里最值得被追问的一个具体缺口——是空话没例子？概念混淆？机制没讲？还是反例没考虑？只输出这一枚缺口（不超过28字，不要解释、不要编号）。',
      `先生原话：「${lessonText}」\n` + (teacherReply ? `本轮补充：「${teacherReply}」\n` : '') +
      `这枚学生进课堂前以为：「${st.mis}」\n本轮要钉的要点：「${target}」\n探测类型：${pt.label}`,
      { maxTokens: 64, temperature: 0.35, deadline });
    gap = (cleanSay(g) || '').split('\n').map((s) => s.trim()).filter(Boolean).pop() || '';
  } catch { gap = ''; }
  if (!gap) gap = (wpHint ? ('（' + pt.label + '）') : '') + target;

  // —— 问：对话模型开口（学生口吻，≤40字，非推理不冒思维链）——
  let say = '';
  try {
    const s = await sfChat('say',
      `你是民国学堂里的学生「${st.name}」，${st.trait}。你不是助手，你就是这个学生本人。\n` +
      `你的说话方式：${st.voice}。你容易卡在：${st.weakness}。你爱说「${st.catch}」。称老师为"先生"。\n` +
      `你进课堂前就有一个（可能是错的）想法：「${st.mis}」。\n` +
      `⚠️ 你来上课不是来打分、不是来点头，只做一件事：逼先生把话说清楚。\n` +
      `⚠️ 必须先亮出你自己的旧想法，再说它跟先生讲的哪里对不上。\n` +
      `⚠️ 必须具体：拿生活里一件真事、一个数字当材料；不许讲空道理，不许问"能再讲一遍吗"。\n` +
      `只回一句话（不超过40字，大白话），把下面这个缺口用你自己的困惑反弹回去——不许替先生解释、不许改写他的意思。`,
      `先生在讲：《${lessonTitle}》\n内容：${lessonText}\n这枚缺口：${gap}\n你的旧想法：${st.mis}\n这轮姿态：${ctx.role}`,
      { maxTokens: 120, temperature: 0.9 + (i % 3) * 0.03, deadline });
    say = (cleanSay(s) || '').split('\n').map((x) => x.trim()).filter(Boolean).pop() || '';
    if (say.length > 48) say = say.slice(0, 48);
  } catch { say = ''; }

  // —— 兜底：退回旧的"单次 chat"用法（已实测可用），不让镜子变哑 ——
  if (!say || !/[一-龥]/.test(say)) {
    const fbSys =
      `你是民国学堂里的学生「${st.name}」，${st.trait}。你不是助手，你就是这个学生本人。\n` +
      `你的说话方式：${st.voice}。你容易卡在：${st.weakness}。你爱说「${st.catch}」。称老师为"先生"。\n` +
      `你进课堂之前，脑子里已经有一个（可能是错的）想法：「${st.mis}」。\n` +
      `⚠️ 你来上课**不是来给自己打分，也不是来配合点头**。你的用处只有一件：逼先生把话说清楚。\n` +
      `你这一轮要抛出的是一枚"探测"——一个具体、能回答、而且答不好就说明先生没讲透的问题。\n` +
      `🔎 提问只能用这七种句式之一（互惠同伴提问）：\n` +
      `   举个例子：……那件事算不算？／ 什么情况下它就不成立了？／ 有没有反过来也成立的？／\n` +
      `   这两个说法到底差在哪？／ 为什么会这样、中间发生了什么？／ 要是换成别的，会怎样？／\n` +
      `   落地：把先生刚说那句**原话举起来**问——"这话到底什么意思？拿件具体的事说明白"（专治口号式空话）\n` +
      `⚠️ **必须先亮出你自己的旧想法，再说它跟先生讲的哪里对不上。**\n` +
      `⚠️ 必须具体：拿生活里一件真事、一个数字、一个反着来的情况当材料；不许讲空道理，\n` +
      `   更不许问"能再讲一遍吗""我还是不明白"这种没内容的话。\n` +
      `请严格按两行回答，不要任何别的字：\n` +
      `第1行：本轮探测类型，只能填「反例」「边界」「正例」「区分」「机制」「应用」「落地」中的一个\n` +
      `第2行：你要说的一句话（不超过40字，大白话）`;
    const fbUsr =
      `先生在讲：《${lessonTitle}》\n内容：${lessonText}\n` +
      `本轮你盯住的要点：「${target}」\n` +
      `本轮你要抛的探测类型：${pt.label}（${pt.hint}）\n` +
      `先生刚才说：${teacherReply ? teacherReply : '（第一轮，先生刚讲完课）'}\n` +
      `你上轮说过：${st.last || '（还没发过言）'}\n` +
      `你进课堂前的旧想法：${st.mis}\n` +
      `这轮你要做的事：${ctx.role}\n` +
      (wpHint ? `🔎 ${wpHint}\n` : '') +
      `别说客套话；别重复自己说过的。两行。`;
    const fb = await sfChat('chat', fbSys, fbUsr, { maxTokens: 220, temperature: 0.85 + (i % 5) * 0.03, deadline });
    const t = parseTurn(fb, concepts.length, st.name);
    say = t.say || '';
  }
  return say;
}

// ===== 单个学生的一轮：一枚探测（类型 + 发言）=====
// 委托给 mirrorAsk（照—问两步法）；类型由确定性引擎指定（不靠模型自报）。
// 依据认知研究：学习只在学生到达 impasse（卡住）之后发生，学生不制造卡点，讲得再好也没用。
async function studentTurn(st, ctx) {
  const { kind, target, round, concepts, teacherReply, i } = ctx;
  const say = await mirrorAsk(st, ctx);
  // 分配 'land'（薄教案）时强制保留，不让本地正则把"落地挑战"误判成普通六类之一
  const kind2 = kind === 'land' ? 'land' : kind;
  const finalSay = say || fallbackSay(st, target, kind2, round, st.memory.map((m) => m.text), { teacherReply, i });
  return { say: finalSay, type: kind2, usedLLM: !!say, ci: ctx.targetIdx };   // ci = 盯住的是第几个要点
}

// ===== 课堂会话（支持"老师回话 → 学生再反应"的闭环）=====
// 沉默设计：每轮只让 1–2 名学生开口，其余静坐（不抢答、给传授者认知留白）。
// 第一轮两人暖场，其后每轮一人，轮转覆盖全部学生；绝不一口气 5 人齐发。
function shuffleIndices(n) {
  const a = [...Array(n).keys()];
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
function speakersForRound(round, order, maxRounds) {
  const n = order.length;
  if (n === 0) return [];
  if (n === 1) return [0];   // 只有一面镜子：每轮都开口（无沉默轮换可言，沉默设计在多生时才有意义）
  const size = (round === 1) ? 2 : 1;                 // 第一轮两人暖场，其后每轮一人
  const start = (round === 1) ? 0 : round;            // r1→[0,1], r2→[2], r3→[3], r4→[4]，五人各开口一次
  const out = [];
  for (let j = 0; j < size && start + j < n; j++) out.push(order[start + j]);
  return out;
}

function createSession(lesson, { maxRounds = 4, world } = {}) {
  const w = world || new World();
  const teacher = { id: w.addAgent({ kind: 'agent', name: '你（教师）', profession: 'teacher' }), name: '你（教师）' };

  const lessonTitle = lesson.title;
  const lessonText = lesson.content;
  const concepts = extractConcepts(lessonText, lesson.concepts);   // 定义1（须先于学生创建：前概念要挂到概念上）
  const lessonThin = assessLessonConcreteness(lessonText).thin;     // 薄教案（口号式空话）→ 走"落地挑战"分支
  const difficulties = concepts.map(estimateDifficulty);

  // P0-1 确定性薄弱点定位：对整段讲解做一次性检测（人类文本里的弱信号），作为探针调度的目标库。
  // 每轮老师回话后，也会把回话文本补检进池子（人类回答里同样可能跳步 / 甩术语）。
  // weakConsumed 保证同一薄弱点只被一枚探测钉一次；weakHits 计数"被定位钉死的探测"数（事实，非判定）。
  const weakPool = detectWeakPoints(lessonText, concepts);
  const weakConsumed = new Set();
  let weakHits = 0;

  // ⚠️ 2026-09-18：产品定为「一面镜子」——只保留第一枚学生人设（小明·好奇型）作为唯一的提问者。
  //   减员是产品决策（人类要的是一面能照出缝的镜子，不是一群分角色的学生），不是算法限制。
  const students = PERSONALITIES.slice(0, 1).map((p, i) => ({
    id: w.addAgent({ kind: 'agent', name: p.name, profession: 'student' }),
    ...p, last: '', memory: [],
    // 前概念（误解）+ 本轮抛出的探测类型。
    // ⚠️ 不再有"知识状态 p"，也不再有"上一轮探测被接住的程度 addressed"——
    //   我们不可能知道一个 AI 学生"学会了多少"或"被接住了多少"（它没有脑子），
    //   2-gram 判定那个近似也被证明是噪声。学生只负责抛探测，判定权归人类。
    mis: guessMisconception(i, concepts, lessonThin), myQ: '', probeType: null,
  }));
  teachingRelation(w, teacher.id, students.map((s) => s.id)); // R_教学

  // 发言轮转顺序（每堂课随机洗牌一次，保证覆盖且每堂不同）：沉默设计见 speakersForRound
  const speakerOrder = shuffleIndices(students.length);

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

    // 学生分批调用（每人一次调用同时产出 理解自评+发言）。
    // 2026-09-10 实测：多请求同时打免费池会互相挤掉（429），改为每批 2 人、批间 400ms，命中率明显更高。
    // 若 key 已充值（1000 次/天、限流宽松），可设 LINGJING_CONC=5 恢复全并发提速。
    const speakers = speakersForRound(round, speakerOrder, maxRounds);  // 沉默：本轮只这几位开口
    const turns = new Array(students.length);
    const deadline = Date.now() + LLM_BUDGET_MS;   // 本轮 LLM 时间预算（超出用兜底补齐）

    // P0-1：老师这轮回话里的文本，同样可能露出"甩术语 / 跳步"——补检进薄弱点池，让后续探测钉准。
    if (teacherReply) {
      for (const w of detectWeakPoints(teacherReply, concepts)) weakPool.push(w);
    }

    for (let si = 0; si < speakers.length; si++) {
      const k = speakers[si];
      if (si) await sleep(250);   // 免费池并发挤掉（429）防护：发言者之间留一点间隔
      // 本轮探测任务：优先把这一枚探测钉到"未消耗、严重度最高"的薄弱点上（确定性定位）；
      // 同一轮多位发言者各取一个不同的薄弱点（按 si 偏移），避免两人问同一处。
      let wp = null, wi = 0;
      for (const w of weakPool) { if (!weakConsumed.has(w)) { if (wi++ === si) { wp = w; break; } } }
      let target, kind, targetIdx, wpHint = '';
      const humanUtter = teacherReply || lessonText;
      if (wp) {
        weakConsumed.add(wp); weakHits++;
        target = wp.concept;
        kind = wp.probeType;
        targetIdx = wp.conceptIdx;
        const spec = buildQuestionSpec({
          target, probeType: kind, weakPoint: wp,
          humanLastUtterance: humanUtter, responseMode: inferResponseMode(teacherReply), round,
        });
        wpHint = renderWpHint(spec);
      } else if (lessonThin) {
        // 薄教案（口号式空话）：镜子把先生原话**原样举起来**逼落地——不退回占位符、不装作有概念可探
        kind = 'land'; target = lessonText; targetIdx = 0;
        wpHint = LAND_HINT(lessonText, round);
      } else {
        target = probeTarget(concepts, k, round);
        kind = probeKind(k, round);
        targetIdx = (((k + round - 1) % Math.max(1, concepts.length)) + Math.max(1, concepts.length)) % Math.max(1, concepts.length);
        const spec = buildQuestionSpec({
          target, probeType: kind, weakPoint: null,
          humanLastUtterance: humanUtter, responseMode: inferResponseMode(teacherReply), round,
        });
        wpHint = renderWpHint(spec);
      }
      const base = PROBE_ROLES[kind](target);
      const role = round <= 1 ? base : FOLLOW_PREFIX[(k + round) % FOLLOW_PREFIX.length] + base;
      turns[k] = await studentTurn(students[k], {
        i: k, round, lessonTitle, lessonText, concepts,
        teacherReply: teacherReply || '',
        peerLines, deadline, target, kind, role, wpHint,
        targetIdx,
      });
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

    const SILENCE_PAUSE = 2600;   // 认知留白：一位问完，停约 2.6s 再下一位，不抢答、给传授者消化
    const utterances = [];
    for (let si = 0; si < speakers.length; si++) {
      const st = students[speakers[si]], turn = turns[speakers[si]];
      if (si) await sleep(SILENCE_PAUSE);   // 沉默：轮到开口前先留白
      // ⚠️ 2026-09-11：Δp / P / E / σ² / H 与"自评理解度 R"全部删除。学生头顶不再表示任何"程度"。
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

  // ===== 下课：学生（镜子）产出一份《课堂纪要》（人类的作品/收获），并算出教师的益处 =====
  // 用户定框架：软件的价值是让**人类**整理、升华自己的知识；AI 学生是镜子与提问者，不是学习者。
  async function buildMinutes() {
    const pts = teacherPoints(lessonText);
    // 三、四两节必须互斥，且只能用**事实**来分：这一枚探测收到过先生的回答没有。
    // ⚠️ 只认探测记录本身（每枚探测带自己的 answer）——不再用 students[].myQ（那是"本轮新问的句子"，会错配）。
    // ⚠️ 也不再自动判"先生答到了没"：那个 2-gram 判据标定下来是噪声（好回答 0.000，敷衍 0.333），
    //   判定权交回人类（课后逐条看"他问的 / 你答的"，见 teacherReport 第二节）。
    const gotIt = probes.filter((p) => p.answer != null);
    const openQ = probes.filter((p) => p.answer == null);

    // 人数随产品决策变化（当前 1 面镜子），纪要提示词与文案都按真实人数生成，不写死"五个"。
    const names = students.map((s) => s.name);
    const plural = names.length > 1;
    const who = plural ? `你们是这学堂里的 ${names.length} 名学生（${names.join('、')}）` : `你是这学堂里唯一的学生（${names[0]}）`;

    if (llmUsable()) {
      const sys =
        `${who}，刚上完先生的课。` +
        `现在${plural ? '你们一起' : '你'}给先生写一份《课堂纪要》，用中文 Markdown，四个小节：` +
        `一、先生讲了什么（${plural ? '我们' : '我'}记下的要点）；二、${plural ? '我们' : '我'}原来的想法（可能不对的旧想法）；` +
        `三、${plural ? '我们' : '我'}问的、先生给了回答的；四、${plural ? '我们' : '我'}问的、先生还没回的（下次请先生补）。` +
        `注意：你${plural ? '们' : ''}是来**问**的，不是来夸的；第四节最重要，写得越具体先生越有用。` +
        `要具体、说人话、别客套、别用"老师讲得很好"这类空话。每节 2~5 条，短句。只输出 Markdown。`;
      const usr =
        `课题：《${lessonTitle}》\n先生的讲解：${lessonText}\n\n` +
        `课堂实录：\n${memory.map((m) => `${m.speaker}：${m.text}`).join('\n')}\n\n` +
        `${plural ? '我们各自的' : '我的'}旧想法：\n${students.map((s) => `- ${s.name}：${s.mis}`).join('\n')}\n`;
      const md = await sfChat('chat', sys, usr, { maxTokens: 700, timeoutMs: 25000 });
      if (md && md.length > 60 && !looksLikeCoT(md)) return { md: extractMarkdown(md), by: 'LLM 镜稿' };
    }
    // 兜底：由本场真实的发言与前概念拼装（不是凭空生成）
    const md = [
      `# 《${lessonTitle}》课堂纪要`,
      '',
      '## 一、先生讲了什么（记下的要点）',
      ...(pts.length ? pts.map((p) => `- ${p}`) : ['- （先生这次讲得比较短，没留下成条的要点）']),
      '',
      `## 二、${plural ? '我们' : '我'}原来的想法（可能不对的旧想法）`,
      ...students.map((s) => `- ${s.name}：${s.mis}`),
      '',
      '## 三、问的、先生给了回答的',
      // ⚠️ 这里**不再**写"弄明白了"——只是模拟学生，说"我懂了"是演戏，不是事实。
      //    也不写"先生答到了"——那需要判定"答没答到"，机器做不到（判据是噪声，已撤）。
      //    只并排两条**真实文本**："问的" + "先生答的"。答到没有，留给人自己看。
      // say 里已经带了「」→ 用 quotable 去内层引号，免得纪要里出现「…「…」…」套娃
      ...(gotIt.length ? gotIt.map((p) => `- ${p.name}［${probeLabel(p.type) || '探测'}］${quotable(p.say, 30)} —— 先生的回答：${quotable(p.answer, 26)}`)
        : ['- 抛出的问题，先生这一轮还没给回答。']),
      '',
      '## 四、问的、先生还没回的（下次请先生补）',
      ...(openQ.length ? openQ.map((p) => `- ${p.name}［${probeLabel(p.type) || '探测'}］${p.say}`)
        : ['- 问的，先生都回了。']),
      '',
      `> 这份纪要是课上 ${names.length} 名学生（镜子）的发言与旧想法整理出来的（由本地程序拼装，不是 AI 模型写的）。`,
    ].join('\n');
    return { md, by: '本地拼装' };
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
    const cov = conceptCoverage(probes, concepts);
    // Δ 三态（P1+）：把每枚探测的"先生有无回应"落成显式数据结构，镜子永不评分。
    //   POS=收到且带前提/例子/边界（文本特征）｜BND=收到但偏空泛、留人判｜NEG=没收到。
    const verdictCounts = { POS: 0, BND: 0, NEG: 0 };
    for (const p of probes) { p.verdict = probeVerdict(p); verdictCounts[p.verdict]++; }
    // 路线-cheap 分析层（全部守不评分红线，只认机器可观测的文本事实）：
    //   按概念归拢三态 → ∂ 下/上近似 · m 证据区间 · Δ* 序贯三枝；ZPD fading 曲线；G 盲区网。
    const conceptVerdicts = concepts.map((c, j) => ({
      concept: c, verdicts: probes.filter((p) => p.ci === j).map((p) => p.verdict),
    }));
    const rough = roughApprox(conceptVerdicts);                 // ∂：下/上近似 + 边界区
    const evidence = evidenceInterval(conceptVerdicts);         // m：[Bel, Pl] 诚实证据区间
    const seqVerdicts = conceptVerdicts.map((cv) => ({
      concept: cv.concept, verdict: sequentialConceptVerdict(cv.verdicts),
    }));                                                        // Δ*：问够才三划分
    const fading = zpdFading(probes);                          // ZPD：脚手架渐退曲线
    const weakGraph = buildWeakGraph([{ concepts, weakPoints: weakPool, probes }]);  // G：盲区网
    const gains = {
      points: pts.length,                       // 你讲出的要点条数
      replies: teacherReplies.length,           // 你回答了几轮
      clarifying: clarify,                      // 其中带出前提/例子/边界的澄清型回答
      probes: probes.length,                    // 学生一共抛出多少枚探测
      probeLine: probeSummaryLine(counts),      // 六类构成的"人话一行"（计数，非分数）
      probeKinds: counts,
      answered: probes.filter((p) => p.answer != null).length,  // 其中几枚收到了你的回答（事实，非判定）
      open: probes.filter((p) => p.answer == null).length,      // 其中几枚你没回（多为收尾前刚问的）
      verdictCounts,                             // Δ 三态计数（POS/BND/NEG，机器只认文本事实，不评分）
      // 路线-cheap 分析层（全部不评分，只认文本事实）：
      roughLower: rough.lower,                   // ∂ 下近似：全部探测皆 POS 的概念（机器可确定讲清了）
      roughBoundary: rough.boundary,             // ∂ 边界区：有口子、机器不敢认证，留人判
      roughUpper: rough.upper,                   // ∂ 上近似：非全 NEG（可能讲清了）
      evidence,                                  // m 证据区间 [Bel, Pl]（诚实，非伪概率）
      seqVerdicts,                               // Δ* 序贯三枝：问够才三划分的概念判定
      fading,                                    // ZPD fading 曲线：脚手架逐轮渐退
      blindHubs: weakGraph.mainHubs,             // G 主要矛盾：度中心性最高的口子
      blindClusters: weakGraph.clusters,         // G 盲区聚类：连通分量（哪些口子是一伙的）
      coverage: `${cov.covered}/${cov.total}`,                    // 概念覆盖（信息论，非掌握）
      uncovered: cov.uncovered,
      conceptEntropy: Number(cov.entropy.toFixed(2)),
      conceptEntropyMax: Number(cov.maxEntropy.toFixed(2)),
      meaning: w.relatedness(teacher.id),                        // 意义供给 = 教师在 R 图度中心性（共在他人数）
    };

    // —— 教师元认知收益层（需求⑥：教中学 / protégé effect + IOED + 费曼）——
    // 把课堂里**真实说过的话**（你的要点、你是否带出前提/例子、学生问了什么、你答了什么）整理成
    // 人话反馈：不替你下"答到了没有"的结论，而是把问题与你的回答并排放好，逼你自己正视。
    const teacherDiag = teacherDiagnosis({ points: pts, teacherReplies, probes });
    let teacherReportMd = teacherReport(teacherDiag, { title: lessonTitle });
    // 概念覆盖（信息论，非掌握度）：把"探测覆盖多少要点 / 剩余盲区"作为可观测事实报给教师
    const covLine = `本节课你讲了 ${cov.total} 个要点，学生探测覆盖了 ${cov.covered} 个`
      + `（盲区：${cov.uncovered.length ? cov.uncovered.join('、') : '无'}）；`
      + `探测分散度熵 H=${cov.entropy.toFixed(2)}（最大 ${cov.maxEntropy.toFixed(2)}，越高越均匀）。`
      + `覆盖≠掌握，只说明"哪些要点被学生逼你讲透了"。`;
    teacherReportMd += '\n\n## 概念覆盖（信息论，非掌握度）\n' + covLine;

    // Δ 三态（P1+）：机器只认"先生回答里有没有出现前提/例子/边界"这个文本特征，绝不声称你答透了。
    teacherReportMd += '\n\n## 探测回应三态（机器只认文本事实，不评分）\n'
      + `收到且带出前提/例子/边界的（POS）：${verdictCounts.POS} 枚；`
      + `收到但偏空泛、留给你自己判的（BND）：${verdictCounts.BND} 枚；`
      + `没收到的（NEG）：${verdictCounts.NEG} 枚。\n`
      + `POS 只表示"先生的回答里出现了前提/例子/边界"这个文本特征，不代表你答透了——那一步永远由你判。`;

    // 路线-cheap：G 盲区网 + m 证据区间（人话、不评分、不露内部数字）
    if (weakGraph.mainHubs.length) {
      teacherReportMd += '\n\n## 你的盲区连成了一张网\n'
        + `这几处口子被学生反复逼到、又互相连着，是这一课最该回看的主线：`
        + weakGraph.mainHubs.map((c) => `「${c}」`).join('、') + '。\n';
      if (weakGraph.clusters.length) {
        teacherReportMd += '盲区还分了几伙（同一伙的口子是一根链条上的）：'
          + weakGraph.clusters.map((cl) => cl.map((c) => `「${c}」`).join('→')).join('；') + '。\n';
      }
      const wide = evidence.filter((e) => e.n > 0 && (e.plausibility - e.belief) >= 0.5)
        .map((e) => `「${e.concept}」（探了 ${e.n} 枚，机器还拿不准）`);
      if (wide.length) teacherReportMd += '有几处机器尤其没把握，值得你多讲一遍：' + wide.join('、') + '。';
    }

    // —— 作品：学生（镜子）共同的《课堂纪要》落盘 ——
    let minutes = { md: '', by: '', path: '', error: '' };
    let teacherGainFile = '';
    let worldPath = '';
    try {
      const m = await buildMinutes();
      const dir = path.join(__dirname, 'sessions');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const base = `${stamp}-${String(lessonTitle).replace(/[\\/:*?"<>|\s]/g, '_')}`;
      const file = path.join(dir, `${base}-课堂纪要.md`);
      fs.writeFileSync(file, m.md, 'utf-8');
      minutes = { md: m.md, by: m.by, path: file, error: '' };
      onLog(`\n《课堂纪要》已由学生（镜子）写出 → ${file}`);
      // 教师的"我的收获"：教中学的核心作品，单独落盘，方便使用者留存/回看
      teacherGainFile = path.join(dir, `${base}-我的收获.md`);
      fs.writeFileSync(teacherGainFile, teacherReportMd, 'utf-8');
      onLog(`《我的收获》（教中学反馈）已写出 → ${teacherGainFile}`);
      // 世界对象本身持久化（R-M2 修复：world.save 原语已落，此处接入会话生命周期）
      worldPath = path.join(dir, `${base}-world.json`);
      try { w.save(worldPath); onLog(`世界状态已持久化 → ${worldPath}（T=${w.T}）`); }
      catch (we) { onLog(`世界持久化失败（不阻塞课堂）：${String((we && we.message) || we)}`); }
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

    // P0-2：AI 理解笔记（镜子，确定性拼装，不评分不对外）。
    // 机制（见 docs/理论基座.md §四）：镜子该把它"学到的"（=人类教的）暴露回给人类，
    // 含它可能理解错的地方，人类读到"它理解岔了"才照见自己哪句讲歧义了。
    // 本产品不声称 AI 有理解，所以这里全用真实文本拼：旧想法 + 它记下的先生原话 + 它没搞清的 + 一句自我点检。
    // "含错"天然落在两处：没收到的回答（它没得到澄清）+ 它的旧想法 mis（它带着的错）——正把人类盲区镜像回给人。
    const aiNotes = students.map((s) => {
      const mine = probes.filter((p) => p && p.name === s.name);
      const took = mine.filter((p) => p.answer != null)
        .map((p) => ({ round: p.round, type: p.type, q: p.say, answer: p.answer }));
      const stuck = mine.filter((p) => p.answer == null)
        .map((p) => ({ round: p.round, type: p.type, q: p.say }));
      // 自我点检：确定性模板，最尖的那枚没回的探测优先，其次第一枚探测，都没有则标"这课没怎么问"
      const sharp = stuck[0] || mine[0];
      const selfCheck = sharp
        ? `我原来以为「${quotable(s.mis, 20)}」；先生讲完，我最想不通的是「${quotable(sharp.say, 24)}」`
        : `这课我没什么想不通的——但也可能只是我没敢问。`;
      return {
        name: s.name,
        mis: s.mis,                         // 进课堂前的旧想法（已知，非估测）
        took,                              // 它"记下的"：先生原话 + 它抛的探测（逐条）
        stuck,                             // 它没搞清的：没收到的回答（=人类没讲到的口子）
        selfCheck,                         // 一句自我点检（确定性模板，非 LLM 生成）
        note: took.length
          ? `先生说的我都记下了：${took.map((t) => `「${quotable(t.answer, 18)}」`).join('；')}。${selfCheck}`
          : selfCheck,
      };
    });

    onLog(`你的收获：要点 ${gains.points} 条 · 澄清型回答 ${gains.clarifying}/${gains.replies} · 学生抛出探测 ${gains.probes} 枚`
      + `${gains.probeLine ? '（' + gains.probeLine + '）' : ''} · 其中 ${gains.answered} 枚你回了、${gains.probes - gains.answered} 枚没回`
      + `（"答到没有"由你在课后逐条判——机器只能数词，不能读心）`
      + ` · 概念覆盖 ${gains.coverage}（盲区 ${gains.uncovered.length} 个）· 意义供给(中心性) ${gains.meaning}`);
    if (!llmUsable()) onLog(`（注：${KEY ? 'LLM 当前不可用：' + (llmStatus().reason || '额度/限流') : '未检测到 LLM Key'}，学生发言走确定性兜底语料）`);

    const result = {
      lessonTitle, lessonText, concepts, difficulties,
      students: students.map((s) => ({ name: s.name, trait: s.trait, alpha: s.alpha, voice: s.voice, catch: s.catch, mis: s.mis, probeType: s.probeType })),
      rounds, lessons, notes, artifacts: lessons + notes,
      worldPath, worldT: w.T,
      coverage: gains.coverage, uncovered: gains.uncovered,
      conceptEntropy: gains.conceptEntropy, conceptEntropyMax: gains.conceptEntropyMax,
      meaning: gains.meaning,
      teachingEdges: [...w.R.values()].length, V, agents: w.measure().agents,
      usedLLM: llmUsable(),
      transcript: memory,
      probes,         // 本课全部探测（真实文本 + 本地复核类型）——产品的一等公民
      probeByConcept, // 按要点归拢的原始提问文本（替代已删的 conceptCaught 比率）
      gains,          // 人类教师的收益（产品目标）
      minutes,        // 学生（镜子）共同的《课堂纪要》（作品）
      teacherGain: teacherDiag,    // 教中学：教师自身盲区诊断（需求⑥）
      teacherReportMd,            // 教中学：教师人话"我的收获"报告（需求⑥核心交付物）
      weakPoints: weakPool,       // P0-1：确定性检测出的"人类可能讲漏/讲偏"的位置（分析人类文本，非对学生判定）
      weakPointHits: weakHits,    // P0-1：其中被探针钉死的枚数（事实计数，非分数）
      verdictCounts,              // Δ 三态计数（P1+：POS/BND/NEG，机器只认文本事实，不评分）
      rough, evidence, seqVerdicts, fading,   // 路线-cheap：∂ / m / Δ* / ZPD（全不评分）
      weakGraph,                  // G 图论盲区网（节点/边/度中心性排名/聚类）
      aiNotes,                    // P0-2：AI 理解笔记（镜子，含它没搞懂的）——确定性拼装，不评分不对外
      // 双稿制：把 P0-2 aiNotes 确定性转成锁死的「镜稿三块」（AI 初稿·待修订），供课后双稿 UI 用。不评分、不替人定稿。
      mirrorDraft: reflection.buildMirrorDraft(aiNotes),
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
  createSession, runClassroom, parseLesson, orChat, sfChat, oneCall, cleanSay, pickChineseLine, parseTurn, takeSay,
  fallbackSay, PERSONALITIES, studentTurn, MODEL, MODEL_CHAIN, llmStatus, llmUsable, markDead,
};
