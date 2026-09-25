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
  estimateGain, shouldContinue, adjustedEig,
} = require('./questioning.js');   // TCMQ 确定性提问引擎（提问方法论解耦为独立模块）
const {
  BEAT, BEAT_TEXT, beatFor, beatIsAsking, beatRationale,
  reflectLine, closeLine, varyPhrase,
} = require('./experience.js');    // 体验节奏引擎（人获得体验，不是被机器人盘问）
// 几何算子层（Γ 信息散度 / Φ 断链 / β 概念同调 / ⊕ 轨迹幺半群，均为纯函数、不评分）
const geom = require('./geometry.js');
// 巩固分析层：Λ 概念格（形式概念分析）+ Σ 覆盖骨架（Nerve 1-骨架）
//   Λ 与 Σ 是 docs/09 §八里唯二还标"路线"的算子；2026-09-25 落码，与 Γ/⊕/Φ/β 并列进纪要。
const lat = require('./lattice.js');
const cvg = require('./convergence.js'); // 不动点分析：Banach 压缩映射定理应用到反射序列（2026-09-25 落）
const alm = require('./analogy.js');   // 类比结构分析（映射思想的元应用：照见学生自己搭的映射，2026-09-25 落）
const conj = require('./conjugacy.js'); // 拓扑共轭应用：学生概念轨迹 vs 教材脉络（2026-09-25 落）
const fn = require('./functor.js');     // 函子自然性自检：镜面在没改口时是否前后一致（2026-09-25 落）
const bis = require('./bisim.js');      // 互模拟商：弱信号序列坍缩成根误类（2026-09-25 落）
const ref = require('./referent.js');    // 同指识别：N 个表达坍缩成 1 个被识别的东西（复合映射纤维/商，2026-09-25 落）
const comp = require('./composite.js');  // 多层复合映射：N 轮合成一步 g=f_N∘…∘f_1（2026-09-25 落）
const mbridge = require('./mapbridge.js'); // 大模型↔零权重模型桥：NL讲授→大模型抽映射→mapmodel诊断（2026-09-25 落）
const fnc = require('./function.js');      // 函数思想算子（fn 已被 functor.js 占用）
const reflection = require('./public/reflection.js');   // 双稿制确定性反思引擎（总结方法论解耦为独立模块）

const llm = require('./llm.js');   // LLM 传输层已抽离为独立连接器（见 llm.js）
const { KEY, MODEL, MODEL_CHAIN, oneCall, orChat, sfChat, llmStatus, llmUsable, markDead, LLM_BUDGET_MS } = llm;
const { buildWeakGraph } = require('./graph.js');   // G 图论盲区网（路线）
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// —— 追问停时（最优停时判据，见 docs/09-数学框架.md §9.7.2）——
//   τ* = argmax E[I_n − c·n]：这一轮问出了新东西，减去打断你说的成本，谁大接着问。
//   继续追问 ⟺ E[ΔI_{n+1} | F_n] > c。c 是"你愿意被追问多密"的价格，**由人定，引擎不代定**——
//   所以它是显式常量、可由环境变量覆盖，并随 start 事件报给前端，不在任何地方被模型推断。
//   ⚠️ gain 是 estimateGain 的**代理度量**（新词占比），不是真实互信息：真实信息增益需要"人的真值"，
//      而 A2 禁止引擎表示掌握概率。停时结论随 c 单调翻转，c 由人设才使这条判据有意义。
const QUESTION_COST = Number(process.env.LINGJING_QUESTION_COST) > 0
  ? Number(process.env.LINGJING_QUESTION_COST)
  : 0.35;
// 停止原因的人话（只描述机器可观测的事实，不下"你没进步"这类判定）
function stopReasonHuman(reason, gain) {
  if (reason === 'budget-exhausted') return '已经问到你设定的轮次上限了';
  if (reason === 'gain-below-cost') return `这轮你答的和上一轮差不多（新信息 ${(Number(gain) || 0).toFixed(2)}），问下去多半还是重复`;
  return '这轮没有值得再问的新东西';
}
// 停止原因的机器可读标签（前端/日志用；与 questioning.js shouldContinue 的 reason 同源）
const STOP_REASON_LABEL = {
  'gain-below-cost': 'new-info-not-worth-the-cost',
  'budget-exhausted': 'round-budget-reached',
};

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
// 本轮该学生抛哪一类探测：**信息调度**，取代旧的"按轮次轮转"。
//
// 旧实现（PROBE_ORDER 轮转）的毛病：第几轮抛哪一类写死在数组里，问什么跟"这一问值不值"无关——
//   上一轮刚问过反例、这一轮照样轮到反例，也可能该问澄清时它还在推进反例。
// 新实现：每轮在六类里挑**期望信息增益 EIG 最高**的一枚（=H_b(ε+(1−2ε)p_t)−H_b(ε)，见 questioning.js），
//   并对三种情况打折：这个类上一轮问过（别连着打同一个方向）、老师这轮答得流畅（这个方向他已讲透）、
//   老师这轮卡住（这枚问太深）。平手时按 PROBE_ORDER 原顺序落定 → 仍可复现。
//   ⚠️ 不评分：EIG 只说"这枚问句自身有多可能产生信息"，不表示人答得好不好（A2）。
//
// ⚠️ 但纯贪心会退化，而且这是**数学上的必然不是意外**：EIG 在 p_t≈0.5 取最大，
//    故 p_t∈[0.4,0.55] 的几类（counter/bound/hypothesis）基础 EIG 全挤在 0.376~0.390 的窄带里；
//    纯贪心每轮挑同一个，选完打折、下轮换个同类又打平，实测序列就是在两个最高者之间来回摆
//      （bound → apply → bound → apply → …），澄清/举例/机制这几层一次都轮不到。
//    而本产品的探测本来就是分层认知操作（澄清→举例→因果→假设→反例→元认知），
//    只问"边界/应用"等于把最值钱的分层能力弄丢了。所以加一层**覆盖优先**约束：
//    ① 前 coverRounds 轮，先把本场还没照到的类放进候选池（保证六类都被照一次）；
//    ② 候选池内部再按 EIG 挑最高的。分层覆盖是骨架，EIG 只做池内优选。
//
// ⚠️ 适用边界（别把 EIG 当万能钥匙）：EIG 最大化的是"这枚问句能消除多少不确定性"，
//    而本产品的增量价值是**照出盲区**——两者并不完全重合。典型反例是 `distinct`（这两个说法差在哪）：
//    它基础 EIG 最低（p_t=0.9，人必然答），可恰恰是"人以为自己懂了、其实混淆了两个概念"的**高发区**。
//    纯 EIG 会几乎永不优先问它。所以分层覆盖约束必须保留：EIG 只决定池内顺序，不决定要不要照到。
//    一句话：EIG 管"问哪一枚更值"，不管"哪些层面必须被照到"。
function probeKind(k, round, { responseMode = null, recentTypes = [], coverRounds = 6 } = {}) {
  const n = PROBE_ORDER.length;
  const seen = new Set(recentTypes.filter(Boolean));
  const unseen = PROBE_ORDER.filter((t) => !seen.has(t));
  const pool = (round <= coverRounds && unseen.length) ? unseen : PROBE_ORDER;

  const streakOf = (t) => {
    let s = 0;
    for (let i = recentTypes.length - 1; i >= 0 && recentTypes[i] === t; i--) s++;
    return s;
  };
  let best = null, bestEig = -Infinity;
  for (const t of pool) {
    const e = adjustedEig({ probeType: t, responseMode, repeatStreak: streakOf(t) });
    if (e > bestEig) { bestEig = e; best = t; }
  }
  // 全被折扣压到同值（理论上不会，保险起见）→ 退回轮转，保证课堂一定cover到不同类型
  return best || PROBE_ORDER[(((k + round - 1) % n) + n) % n];
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
// 拼接清洁：接话开头以"那/嗯/哦"收尾、问句本体又自带一个"那" → "那那要是…"，读起来像卡顿。
// 例：REACT_OPEN 小明「明白了明白了，那」+ PROBE_FRAME.counter[0]「那要是把…」
//   → 旧行为是硬拼成"明白了明白了，那那要是把…"（旧代码就有的 bug，不是本轮引入）。
// 只削掉**重复的那一个字**，其余照原样并排——不重写、不改写问句本意。
const STAMMER_CHARS = '那哦嗯行对好';
function joinNaturally(a, b) {
  const x = String(a || ''), y = String(b || '');
  if (!x || !y) return x || y;
  if (STAMMER_CHARS.includes(x.slice(-1)) && STAMMER_CHARS.includes(y.slice(0, 1))) {
    return x + y.slice(1);
  }
  return x + y;
}

function fallbackSay(st, concept, kind, round, used = [], opts = {}) {
  const c = quotable(concept, 18);
  const pool = PROBE_FRAME[kind] || PROBE_FRAME.bound;
  // 去模板化（体验层 experience.js）：**只作用在模板句本体上**，不作用在拼接结果上——
  //   若加在最终结果前面，"接话开头"+"换问法前缀"会叠成"我打个比方问——明白了明白了，那…"。
  //   作用于本体后，外层前缀照常包在外面，读起来是"明白了明白了，那我换个问法——…"。
  const seed = round * 7 + (st.i || 0);
  const build = (i) => (VOICE_OPEN[st.name] || ((s) => s))(varyPhrase(pool[i % pool.length](c), seed));
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
    const merged = joinNaturally(open, line);   // 旧行为"明白了明白了，那"+"那要是把…"="…那那要是…"
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
  const raw = await mirrorAsk(st, ctx);
  // 分配 'land'（薄教案）时强制保留，不让本地正则把"落地挑战"误判成普通六类之一
  const kind2 = kind === 'land' ? 'land' : kind;
  //   LLM 说出口的不再叠加换说法（它本来就自然），只有兜底语料需要去模板化——
  //   模板感正是兜底语料的问题，不是产品的问题。
  const finalSay = raw || fallbackSay(st, target, kind2, round, st.memory.map((m) => m.text), { teacherReply, i });
  return { say: finalSay, type: kind2, usedLLM: !!raw, ci: ctx.targetIdx };   // ci = 盯住的是第几个要点
}

// ===== 镜子的「接住」拍：这一拍不追问，只把先生刚说的话举回去 =====
//
// 产品原则（用户 2026-09-25 拍板）：**这个产品让人获得体验，不是让机器人采集信息。**
//   旧实现每拍必抛一枚探测 —— 人从头到尾被追问，像在给一台评估器交作业。
//   这里给课堂加入"呼吸"：ECHO / PAUSE / CLOSE 三拍镜子只说一句（多数时候就一句），
//   然后把话头交回给先生。真正让人感到"被听见"的往往就是这一下，不是第 8 个问题。
//
// ⚠️ 不评分（A2）：映照句只做两件事——原样举回他的话 + 一句好奇。
//    绝不出"讲得好 / 答错了 / 你这里没掌握"这类判定。测试里锁了这条（tools/test_experience.mjs）。
//
// ── Γ 织入（2026-09-25）─────────────────────────────────────────────
// 只在 **PAUSE（留白）拍** 启用，理由是节奏上的：留白拍本来就说"接住你这句"，
// 不追问；把 Γ 的缺口并到这一拍，内容升级而节奏不变。若加到 ECHO/DEEPEN 拍上，
// 就成了"每轮都补一刀"，立刻退回盘问。
//
// 口径：Γ **不做任何"讲透/没讲透"的判断**（见 geometry.divergence 的自我纠错——
//   词面重合不等于内容到位）。这里只报一件事：**教案里哪几句话你这句没提到**，
// 措辞是摆事实，不是评价。
function gapEcho({ utterance = '', reference = '' }) {
  const d = geom.divergence({ utterance, reference });
  if (!d.missingPhrases || !d.missingPhrases.length) return '';
  const gaps = d.missingPhrases.filter((s) => s && typeof s === 'string').slice(0, 1);
  if (!gaps.length) return '';
  return `它那边还摆着一句「${gaps[0]}」，你这句没带到。`;
}

async function reflectTurn(st, ctx) {
  const { round, teacherReply, beat, seed, reference = '' } = ctx;
  const r = (beat === BEAT.PAUSE)
    ? reflectLine({ utterance: teacherReply, beat: BEAT.PAUSE, seed })   // 留白：连好奇都不给
    : reflectLine({ utterance: teacherReply, beat: BEAT.ECHO, seed });
  let say = r.say;
  if (beat === BEAT.CLOSE) say = closeLine(round + (st.i || 0));
  // Γ 只走留白拍（见上方说明）
  if (beat === BEAT.PAUSE && teacherReply) {
    let g = '';
    try { g = gapEcho({ utterance: teacherReply, reference }); } catch (e) { g = ''; }
    if (g) say = (say ? say : '') + g;
  }
  if (!say) say = `${st.name}没再追问，只是把先生那句在嘴里过了一遍。`;
  return { say, type: 'reflect', usedLLM: false, beat: beat || BEAT.ECHO };
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
  // ⚠️ 容错：CLI 的 "标题::内容" 写法若被直接喂进 createSession，会把标题一起焊进第一个"概念"里，
  //   于是这个概念（"光合作用::植物用阳光…"）人类永远说不出来，靠它匹配的算子（β/Φ/Σ）就永远空转。
  //   这里按 parseLesson 的同一套规则拆一次，保证 API 与 CLI 走同一份概念提取。
  if (typeof lesson.content === 'string' && lesson.content.includes('::') && !Array.isArray(lesson.concepts)) {
    const i = lesson.content.indexOf('::');
    const t = String(lesson.title || '').trim();
    const head = lesson.content.slice(0, i).trim();
    if (!t || head === t) {
      lesson = { ...lesson, title: t || head, content: lesson.content.slice(i + 2).trim() };
    }
  }
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
  // 上一轮老师的回答文本（停时判据要拿它当"新信息"的比较基准；不表示掌握概率，只比文本）
  let lastTeacherReply = '';
  // 老师是否已给过一次真实回答（第一次回答不参与逐字比较，否则相对"课题"会被误判为没新信息）
  let answeredOnce = false;

  // 第 1 拍：教师讲授（公理3：外部输入）-> lesson 作品持久留世界
  w.addArtifact({ owner: teacher.id, kind: 'artifact', payload: { type: 'lesson', role: 'lesson', title: lessonTitle, content: lessonText } });

  function startPayload() {
    return {
      type: 'start',
      lessonTitle, lessonText, concepts, difficulties, maxRounds,
      // 追问成本 c 随 start 报出：它**由人设**（环境变量 LINGJING_QUESTION_COST），引擎不推断、不代定
      questionCost: QUESTION_COST,
      usedLLM: llmUsable(),
      llm: llmStatus(),
      students: students.map((s) => ({ name: s.name, trait: s.trait, alpha: s.alpha, voice: s.voice, catch: s.catch, mis: s.mis })),
    };
  }

  async function playRound(teacherReply, onEvent, onLog) {
    round += 1;
    if (teacherReply) memory.push({ round: round - 1, speaker: '老师', text: teacherReply });
    onEvent({ type: 'round_start', round, teacherReply: teacherReply || '' });

    // —— 体验节奏（experience.js）：一节课是一段有呼吸的对话，不是一条信息流水线 ——
    //   第 1 拍抛探测把人拉进来，中间隔几拍给一次"只照不问"，收尾前留一次闭嘴。
    //   拍子只由总轮数决定，**不观测任何人表现**——一旦按表现加码，课堂立刻变考场。
    const beat = beatFor(round, maxRounds);
    const asking = beatIsAsking(beat);
    onLog(`-- 第${round}轮 [${BEAT_TEXT[beat]}] --${teacherReply ? `（老师回答：${teacherReply}）` : ''}`);
    if (!asking) onLog(`  ${beatRationale(beat)}`);

    // —— 追问停时判据（docs/09 §9.7.2）：先问"这一轮还值不值得追问"，不值就直接收，不再生成探测 ——
    //   两条前置条件：① 第 1 轮（课堂开场，尚无"回答"这件事）不判定；
    //                 ② 本轮 teacherReply 为空（例如收尾触发的空回话）也不是一次有效回答，同样不判定。
    //   ⚠️ 停是**诚实收尾**（finalize），不是判定"你没学会"——引擎不表示掌握概率（A2），只说"没新东西可问了"。
    const hasAnswer = Boolean(teacherReply && teacherReply.trim());
    if (round > 1 && hasAnswer) {
      // 第一次认真回答：相对"你的课题/讲解"作答，先按"有信息"处理（与 estimateGain 的首轮语义一致）；
      // 第二次起才和上一轮逐字比——重复回答的假增益就是在这里被挡掉的。
      const gain = answeredOnce ? estimateGain({ utterance: teacherReply, prevUtterance: lastTeacherReply }) : 1;
      answeredOnce = true;
      const dec = shouldContinue({ round, gain, cost: QUESTION_COST, maxRounds });
      lastTeacherReply = teacherReply;
      // 收束拍优先于停时判据：排好的拍子里最后一拍本来就是 CLOSE，
      //   该由它说那句收尾话。否则用户看到的是"已经问到你设定的轮次上限了"——
      //   这是机器在汇报预算，不是一堂课在收尾。
      const closing = beat === BEAT.CLOSE;
      if (dec.stop || closing) {
        if (closing) {
          // 收束拍：由 CLOSE 那句话收尾——"这一课收在这儿"，而不是汇报预算
          const st0 = students[0] || { name: '镜子' };
          const line = closeLine(round);
          onEvent({
            type: 'reflect', round, beat: BEAT.CLOSE, beatText: BEAT_TEXT[BEAT.CLOSE],
            name: st0.name, text: line, asks: false, closes: true,
          });
          onLog(`  ${st0.name}［${BEAT_TEXT[BEAT.CLOSE]}］：${line}`);
        } else {
          const why = stopReasonHuman(dec.reason, dec.gain);
          onEvent({
            type: 'probe_stop', round, reason: dec.reason,
            reasonLabel: STOP_REASON_LABEL[dec.reason] || dec.reason,
            why, gain: Number(dec.gain).toFixed(3), cost: QUESTION_COST, humanSays: '追问到此为止',
          });
          onLog(`【停时】第${round}轮不再追问：${why}（gain=${Number(dec.gain).toFixed(3)} ≤ c=${QUESTION_COST}）`);
        }
        await finalize(onEvent, onLog);   // 走 done 事件收尾：前端按既有 done 流程结束课堂，不会卡在等下一轮
        return;
      }
      onLog(`【停时】继续追问：本轮新信息 gain=${Number(dec.gain).toFixed(3)} > c=${QUESTION_COST}`);
    } else {
      // 开场/空回话：基准只在还空着时落到「第 1 拍讲授」——那才是老师真正的开场内容
      if (!lastTeacherReply) lastTeacherReply = lessonText;
    }

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

      // —— 非追问拍：镜子只接一句、不抛探测（体验节奏的核心；旧实现这里必定抛一枚）——
      //   探测装配（薄弱点 / 概念覆盖 / wpHint）整段跳过，turns[k] 已由 reflectTurn 填好；
      //   第二段循环照常播出，只是发的是 reflect 事件、不进 probes 序列。
      if (!asking) {
        turns[k] = await reflectTurn(students[k], {
          // reference = 教案原文：Γ 拿它当"标准说法"，量人这句离它多远
          i: k, round, beat, teacherReply: teacherReply || '', seed: round * 5 + k * 3,
          reference: lessonText || '',
        });
        continue;
      }

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
        // EIG 信息调度：这一轮抛哪一类，按"哪枚问的信息量最大"挑，并避让上一轮问过的方向。
        //   recentTypes = 本场已抛出的探测类型（最近的几条），用于算"连续重复"折扣；
        //   responseMode = 老师这一轮的作答状态，答得流畅/卡住都会调低该方向的 EIG。
        kind = probeKind(k, round, {
          responseMode: inferResponseMode(teacherReply),
          recentTypes: probes.slice(-4).map((p) => p.type),
        });
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

      // —— 非追问拍：这一拍不产出探测，只发一句"接住"的话—————————————————
      //   不发 probe_stop 之类内部标签，也不进 probes 序列（它不是探测）。
      if (turn && turn.beat && turn.beat !== BEAT.DEEPEN) {
        if (turn.say) {
          onEvent({
            type: 'reflect', round, beat: turn.beat, beatText: BEAT_TEXT[turn.beat] || '接住你说的话',
            name: st.name, text: turn.say, asks: turn.beat === BEAT.ECHO,
          });
          onLog(`  ${st.name}［${BEAT_TEXT[turn.beat] || '接住'}］：${turn.say}`);
          st.last = turn.say;
          st.memory.push({ round, text: turn.say });
          memory.push({ round, speaker: st.name, text: turn.say });
          w.addArtifact({ owner: st.id, kind: 'artifact', payload: { type: 'note', role: 'reflect', text: turn.say, round } });
        }
        continue;   // 不进 probes、不算 llmOk 探测数
      }

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
    onEvent({ type: 'round_end', round, beat, beatText: BEAT_TEXT[beat], canContinue, llmOk, probeCount: roundProbes.length });
    if (asking) {
      onLog(`第${round}轮：学生抛出探测 ${roundProbes.length} 枚（LLM 学生 ${llmOk}/${students.length}）· 你答到了几枚，课后逐条对照着判`);
    } else {
      onLog(`第${round}轮：这一拍镜子没追问，只接住了先生的话（不统计探测枚数）。`);
    }
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

    // ── Λ 概念格 · Σ 覆盖骨架 · Φ 搬运（2026-09-25 落：docs/09 §八唯二的"路线"补上）───────
    // 形式背景的对象不是"课"，是**你这节课一次次开口的那一轮**（单课内也能算，格才有意义）；
    // 属性＝该轮话里触发的弱信号类型（jargon/jump/abstract/parrot/omit，与 detectWeakPoints 同源）。
    // 于是 Λ 回答"哪几轮是同一个毛病"，Σ 回答"这些毛病在时间轴上堆成什么形状"。
    // ══ Λ / Σ / Φ 三件 ══
    const mineRounds = memory
      .filter((m) => m.speaker === '老师' && m.text)
      .map((m) => ({ round: m.round, text: String(m.text) }))
      .sort((a, b) => (a.round || 0) - (b.round || 0));
    const coPairs = geom.cooccurrence({ lines: memory, concepts });      // β 与 Φ 共用同一份共现证据
    // 信号源用"本句 + 前一句"的并集（与 β 共现的 window=1 同理）：
    //   单独一句常常凑不齐五类信号里的任一条（它们多半要靠上下文才判得出来），
    //   只看单句会让 Λ 在任何课上都是空集——那不是诚实，是没接上。
    const roundHits = mineRounds.map((r, i) => {
      const hits = detectWeakPoints(r.text, concepts);
      const ctx = i > 0 ? `${mineRounds[i - 1].text}。${r.text}` : r.text;
      const ctxHits = i > 0 ? detectWeakPoints(ctx, concepts) : [];
      const sigs = [...new Set([...hits, ...ctxHits].map((w) => w.signal))];
      // 光靠五类弱信号当属性太窄：这堂课整课检测下来是空集，只有某一轮蹦出几条，
      // 格就只剩一个节点。补一条每轮都有的确定性文本事实（该轮回答是否带出前提/例子/边界），
      // 与 detectWeakPoints 同源口径（isClarifying），不是新造的判据。
      const clarifiedByThisRound = teacherReplies.some((tr) => tr.round === r.round && tr.clarifying);
      if (clarifiedByThisRound) sigs.push('clarify');
      return { round: r.round, text: r.text, signals: sigs, hits };
    });
    // Λ：形式概念分析（枚举 2^|M| 子集取闭包去重；不是 Ganter NextClosure——闭包不保序，见 lattice.js 注释）
    const lattice = lat.analyzeLattice(roundHits.map((r) => ({ id: r.round, title: `第${r.round}轮`, signals: r.signals })));
    // Σ：把每轮被钉出的口子当下云点，课时轴当 filter，看它们沿时间铺成什么
    //   label 截短——薄教案下"概念"就是整句，整句塞进人话里没法读。
    const nerve = lat.nerveSkeleton({
      points: roundHits.flatMap((r) => r.hits.map((w) => ({ round: r.round, label: String(w.concept).slice(0, 8) }))),
      coverRadius: 1.5,
    });
    // Φ：逐段算"这一轮相对上一轮搬了多远"（共现即地面代价，无共现就不出数）
    const transport = geom.transportAlong({ lines: mineRounds, concepts, pairs: coPairs });

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

      // ── 几何算子层（Γ / Φ / β / ⊕，2026-09-25 落）────────────────
      // 四条都只描述形状，不给人打分（A2）。它们进纪要，是让人**看见**自己话的形状。
      trajectory: geom.trajectory(memory.filter((m) => m.speaker === '老师')),  // ⊕：你原话的保序回放
      // Φ：取你说过的**最长的一段**做断链定位（短句无从定位，报出来是噪音）
      breakPoint: (() => {
        const mine = memory.filter((m) => m.speaker === '老师' && m.text)
          .slice().sort((a, b) => String(b.text).length - String(a.text).length);
        if (!mine.length) return null;
        const r = geom.findBreak({ utterance: String(mine[0].text), reference: lessonText || '' });
        return r.onTarget ? null : { round: mine[0].round, tail: r.tail };
      })(),
      shape: (() => {                                                            // β：概念有没有绕成圈
        const h = geom.homology({ concepts, pairs: coPairs });
        return { ...h, speak: geom.describeShape(h, concepts) };
      })(),
      // Λ / Σ / Φ 三条（2026-09-25 落）
      lattice,
      nerve,
      transport,
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

    // ── ⊕ 轨迹回放（自由幺半群）：严���保序，顺序本身就是信息 ──
    // 不是把 transcript 换个位置重贴一遍——自由幺半群的要点是**不可交换**：
    // 先说 A 再说 B，跟先说 B 再说 A 是两回事。所以这里带轮次编号回放你自己的话，
    // 让人看见自己话是怎么一节一节长起来的（回看时顺序不能乱）。
    const traj = gains.trajectory;
    if (traj && traj.length > 0) {
      teacherReportMd += '\n\n## 你在这节课上说过的话（保序回放）\n'
        + traj.sequence.map((s) => `第${s.round}轮：${s.text}`).join('\n')
        + `\n\n（共 ${traj.length} 段，顺序不可交换：先说后说不是一回事，回放时不能打乱。）`;
      // Φ：只在明显塌陷时提一句，不每段都判——每句都报"你跳走了"就成了挑刺。
      if (gains.breakPoint && gains.breakPoint.tail) {
        teacherReportMd += `\n第 ${gains.breakPoint.round} 轮那段，后半截你带到了「${gains.breakPoint.tail}」，`
          + `跟前半截不是一条线上的。它标的是**对齐塌陷的位置**，不是你有错。\n`;
      }
    }

    // ── β 拓扑（Vietoris–Rips）：这几个概念在你话里绕成圈了吗 ──
    // 诚实口径：Rips 滤只有增长、没有分裂，所以环一旦成形不会消亡——
    //   这里报的是它的**出生半径**（环有多紧），不是寿命。
    const shape = gains.shape;
    if (shape && (shape.cycles.length || shape.clusters.length)) {
      let t = '\n\n## 这几个概念在你的话里长成了什么形状\n';
      t += shape.speak.line + '\n';
      if (shape.clusters.length) {
        t += `另外，有几撮是贴在一起的：` + shape.clusters
          .filter((c) => c.verts.length > 1)
          .map((c) => c.verts.map((v) => concepts[v]).join('·')).join('；') + '。\n';
      }
      t += `（用 Vietoris–Rips 滤看共现：共现越多距离越近。环的"紧"用出生半径量，越小越咬得死。）`;
      teacherReportMd += t;
    }

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

    // ── Λ 概念格（形式概念分析）：哪几轮是同一个毛病 ──
    //   Λ 与现在的"复现次数"不是一回事：计数只说"它出现过几次"，格能说
    //   "第 2、4、7 轮这三轮**恰好共享同一组信号**"——那才是可命名的卡点类型。
    if (lattice && lattice.concepts.length > 1 && lattice.hasStructure) {
      let t = '\n\n## 你这几轮是同一个毛病吗\n' + lattice.line + '\n';
      t += lattice.chronic.slice(0, 3).map((c) =>
        `「${c.intent.join('+')}」：撞在第 ${c.extent.map((i) => roundHits[i] && roundHits[i].round).join('、')} 轮，`
        + '这几轮的毛病是同一组，不是三次巧合。').join('\n') + '\n';
      if (lattice.note) t += `（${lattice.note}）`;
      t += cvg.fcaFixedPointNote(lattice);
      teacherReportMd += t;
    }

    // ── Σ 覆盖骨架（Nerve 1-骨架）：盲区沿时间轴铺成什么形状 ──
    //   Σ 与 β 分工：β 看"概念之间绕不绕成圈"（静态），Σ 看"口子之间随时间挤不挤"（沿时间）。
    const nrv = lat.describeNerve(gains.nerve);
    if (nrv.hasShape) {
      teacherReportMd += '\n\n## 你的口子是散着还是扎堆\n' + nrv.line + '\n';
    }

    // ── Φ 最优传输（离散 OT，共现作地面代价）：你这节课搬过几次家 ──
    if (transport && transport.series.length) {
      teacherReportMd += '\n\n## 你的话搬了几次家\n' + transport.line + '\n';
      if (transport.note) teacherReportMd += `〔${transport.note}〕\n`;
    }

    // ── 类比结构分析（映射思想的元应用）：学生搭的类比本身就是一个映射 ──
    //   Gentner SME：类比 = 源域→靶域映射，映射的是关系而非属性；本算子照见学生建的映射保真/破裂。
    //   与 Λ/Σ/Φ 同口径守 A2：只描述结构，绝不出"理解度/对错"量。
    const analogy = await alm.analyzeAnalogMapping({
      rounds: mineRounds,
      targetConcept: lessonTitle,
      lessonContent: lessonText,
    });
    if (analogy.found) {
      teacherReportMd += '\n\n## 你的类比，本身就是一个映射\n' + analogy.body;
      if (analogy.note) teacherReportMd += `\n〔${analogy.note}〕`;
    }

    // ── 不动点分析（Banach 压缩映射定理）：这面镜子的反射序列在收敛吗 ──
    //   Φ 的逐轮 W1 距离 = 相邻两轮反射态之间的距离；几何递减 ⇒ 序列 Cauchy ⇒ 收敛到不动点。
    if (transport && transport.series.length) {
      const cv = cvg.analyzeConvergence(transport.series);
      teacherReportMd += '\n\n## 这面镜子照出：你的讲授在自洽收拢吗（不动点）\n' + cv.line + '\n';
      if (cv.note) teacherReportMd += `〔${cv.note}〕\n`;
    }

    // ── 拓扑共轭（hf=gh）：你走过的概念图，与教材脉络是同一张吗 ──
    //   共轭思想：两张“概念转移图”结构同构（仅重标号不同）⇒ 你重建出了作者本来的结构。
    //   数据派生：教材脉络 = 各 concept 在 lessonText 中首次出现的顺序；
    //            学生轨迹 = 每轮触及的 concept 集合，按轮次抽出有序轨迹。
    if (Array.isArray(concepts) && concepts.length && mineRounds.length) {
      const lessonCanonical = concepts
        .map((c) => ({ c, i: lessonText.indexOf(c) }))
        .filter((o) => o.i >= 0)
        .sort((a, b) => a.i - b.i)
        .map((o) => o.c);
      const studentRoundConcepts = mineRounds.map((r) =>
        concepts.filter((c) => r.text && r.text.indexOf(c) >= 0));
      const cj = conj.analyzeConjugacy(studentRoundConcepts, lessonCanonical);
      if (cj.ok) {
        teacherReportMd += '\n\n## 你的讲法，和作者本来的骨架对得上吗（拓扑共轭）\n' + cj.line + '\n';
        if (cj.note) teacherReportMd += `〔${cj.note}〕\n`;
      }
    }

    // ── 函子 / 自然变换（镜子自检）：你没改口时，镜面是否前后一致 ──
    //   自然性 = 同一 stance 跨轮次，镜面结构判定（是否归为“被命名卡点”）应一致。
    //   数据派生：mirrored = 这轮触及的概念里有被 Λ 慢性卡点命名的；stance = 概念组合签名。
    if (mineRounds.length >= 2 && lattice && Array.isArray(lattice.chronic)) {
      const chronicConcepts = lattice.chronic
        .reduce((acc, c) => acc.concat(c.intent || []), []);
      const fnRounds = mineRounds.map((r) => {
        const hit = concepts.filter((c) => r.text && r.text.indexOf(c) >= 0);
        const mirrored = hit.some((c) => chronicConcepts.indexOf(c) >= 0);
        return { round: r.round, stance: hit.join('|'), mirrored };
      });
      const fj = fn.checkNaturality(fnRounds);
      if (fj.ok) {
        teacherReportMd += '\n\n## 镜面自己前后一致吗（函子自然性）\n' + fj.line + '\n';
        if (fj.note) teacherReportMd += `〔${fj.note}〕\n`;
      }
    }

    // ── 互模拟商：你翻来覆去，其实归到几个根误类 ──
    //   把每轮看成状态、弱信号集合看成观察标签，做互模拟划分求精 → 等价类坍缩。
    if (mineRounds.length >= 2) {
      const bj = bis.bisimQuotient(mineRounds.map((r) => ({ round: r.round, text: r.text })));
      if (bj.ok) {
        teacherReportMd += '\n\n## 你翻来覆去其实就几个根误（互模拟商）\n' + bj.line + '\n';
        if (bj.note) teacherReportMd += `〔${bj.note}〕\n`;
      }
    }

    // ── 同指识别（复合映射的纤维 / 商）：你不同说法，指的可是同一个东西 ──
    //   用户洞见：1→2、2→3 是映射，合成 1→3 是复合映射（不变元）；1→N 是关系，
    //   其反向 N→1 需归一化（商）。镜子建这个商：把 N 个表达坍缩成被识别的 1 个东西。
    //   数据派生：每轮原话 → 指到的规范概念（concepts）；跨轮不同表达指同概念 ⇒ 同指簇。
    //
    // ⚠️ 2026-09-25 夜修正（真 bug）：semanticAsk 原先声明在下面 referent 的 if 块【内部】，
    //    而 composite 块（以及本次新增的单值性检查）在块外引用它——const 是块级作用域，
    //    两个 if 条件完全相同，所以走到就必然 ReferenceError。单元测试只测模块、没跑 finalize，
    //    一直没暴露。现提升到 if 块之外，供同指识别 / 复合映射 / 单值性共用。
    const semanticAsk = (typeof llm.llmUsable === 'function' && llm.llmUsable())
      ? async (text, cs) => {
          const sys = '你是镜子里的语义裁判。只输出学生这段话指到的规范概念名（从给定列表选，可多个，用顿号隔开，没有就输出"无"）。不评分、不解释。';
          const usr = `规范概念列表：${cs.join('、')}。\n学生原话：${text}\n指到哪些？`;
          const r = await llm.orChat(sys, usr, { maxTokens: 60, deadline: 8000 }).catch(() => '');
          if (!r || r.indexOf('无') >= 0) return [];
          return r.split(/[、，\s]+/).filter((x) => cs.indexOf(x) >= 0);
        }
      : undefined;
    if (mineRounds.length >= 2 && Array.isArray(concepts) && concepts.length) {
      const utts = mineRounds.map((r) => ({ source: '你', round: r.round, text: r.text || '' }));
      // 语义增强钩子已在上方声明（有 LLM 时抓"奶茶排队"这种不提名但同指的表达）；无 key 为 undefined，回退词面。
      const rj = await ref.referentCluster(utts, concepts, { semanticAsk });
      if (rj.ok && rj.clusters.length) {
        teacherReportMd += '\n\n## 你不同说法，指的可是同一个东西（同指识别）\n' + rj.line + '\n';
        if (rj.note) teacherReportMd += `〔${rj.note}〕\n`;
      }
    }

    // ── 多层复合映射（g = f_N∘…∘f_1）：你 N 轮合起来是一步什么映射 ──
    //   用户追问 1→2→3→…→N 的多层复合：每层是一次映射，合成后压成一步直接 1→N 的净映射。
    //   镜子照出：哪层是恒等/扩张/收窄/重构、有没有绕圈空转（互为逆层）、净变换把起点态变到哪。
    //   与同指识别互补：同指是 N→1 的【静态商】，本段是逐层看"商怎么被一层层织出来"。
    if (mineRounds.length >= 2 && Array.isArray(concepts) && concepts.length) {
      const roundSetsForComp = mineRounds.map((r) => ({
        round: r.round,
        concepts: concepts.filter((c) => r.text && r.text.indexOf(c) >= 0),
      }));
      const lessonCanonicalComp = (lessonText && Array.isArray(concepts) && concepts.length)
        ? concepts.map((c) => ({ c, i: lessonText.indexOf(c) }))
            .filter((o) => o.i >= 0).sort((a, b) => a.i - b.i).map((o) => o.c)
        : [];
      const cp = await comp.analyzeComposite(roundSetsForComp, concepts, {
        lessonCanonical: lessonCanonicalComp,
        semanticAsk,
      });
      if (cp.ok) {
        teacherReportMd += '\n\n## 你 N 轮合起来，是一步什么映射（多层复合映射）\n' + cp.line + '\n';
        if (cp.note) teacherReportMd += `〔${cp.note}〕\n`;
      }
    }

    // ── 概念映射网（大模型抽映射 + 零权重模型诊断）：这面镜子把你讲的"概念→概念"织成一张图 ──
    //   用户拍板（2026-09-25 夜）：权重无关引擎做推理内核，大模型只在"需要自然语言理解的地方"接入。
    //   本段即具象点：人类自然语言讲授 → 大模型抽出映射 → mapmodel 零权重照出断头/环/缝隙（盲区）。
    if (mineRounds.length && Array.isArray(concepts) && concepts.length) {
      try {
        const taught = mineRounds.map((r) => r.text || '').join('\n');
        const mb = await mbridge.buildModelFromTeaching(taught, { concepts, deadline: 12000 });
        if (mb.maps.length) {
          let line = `你这堂课讲出来的概念，被连成了一张映射网（共 ${mb.maps.length} 条映射，`
            + `大模型抽取=${mb.usedLLM ? '是' : '否（无 key，回退到词面）'}）：\n`;
          const bs = mb.blindSpots;
          if (bs.deadEnds.length)
            line += `· 断头路（讲了但没再延伸的概念）：${bs.deadEnds.join('、')}——这些可能就是你的盲区。\n`;
          if (bs.orphans.length)
            line += `· 孤源（只被别人提到、自己从没被当作起点）：${bs.orphans.join('、')}。\n`;
          if (bs.cycles.length)
            line += `· 绕圈（概念映射绕回自己）：${bs.cycles.length} 处，净效果≈空转。\n`;
          if (bs.gapPairs > 0)
            line += `· 结构缝隙：有 ${bs.gapPairs} 对概念在网中互不连通，可能漏了连接。\n`;
          if (!bs.deadEnds.length && !bs.orphans.length && !bs.cycles.length && bs.gapPairs === 0)
            line += '· 这张网暂时没有断头、没有孤源、没有环、没有缝隙——结构是自洽的。\n';
          teacherReportMd += '\n\n## 你讲的概念，连成了一张映射网（断头/孤源/环/缝隙）\n' + line;
        }
      } catch (_) { /* 抽映射失败不影响主线，静默跳过 */ }
    }

    // ── 函数思想（大学数学第2节）：单值性 / 覆盖 / 意象vs定义 ──
    //   文献支撑：Vinner & Dreyfus 1989（意象≠定义）；Evangelidou et al. 2004（把函数讲窄成一一对应
    //   是记录在案的经典误解）；funext 外延相等；函数=全+单值、反函数⟺双射。
    //   ⚠️ 只接"数据干净"的三个算子：单值性(原话→概念)、覆盖(值域/对应域)、意象vs定义(教材定义 vs 你举的例子)。
    //      外延相等 与 可逆性 需要一个干净的【概念→概念】函数对象，当前 mapbridge 产出的是多值关系
    //      （一概念可有多条出边），不是函数——硬套会失真，故已实现并测过，暂不接线，不臆造。
    if (mineRounds.length && Array.isArray(concepts) && concepts.length) {
      try {
        // ① 单值性：一话多指 ⇒ 非良定义（是关系不是函数）⇒ 真歧义
        const wd = await fnc.checkWellDefined(
          mineRounds.map((r) => ({ round: r.round, text: r.text || '' })), concepts, { semanticAsk });
        if (wd.ok) {
          teacherReportMd += '\n\n## 你的表达满足"函数"的单值性吗（良定义）\n' + wd.line + '\n';
          if (wd.note) teacherReportMd += `〔${wd.note}〕\n`;
        }
        // ② 覆盖：值域 vs 对应域（缺口/越界）。
        //    totality（"提到了但没解释"）需要可靠的"讲清楚"信号，目前没有，故 domain 传与 image 相同，
        //    不臆造"非全"结论——诚实留白，等有信号再补。
        const mentioned = concepts.filter((c) => mineRounds.some((r) => (r.text || '').indexOf(c) >= 0));
        const cov = fnc.analyzeCoverage({ domain: mentioned, image: mentioned, codomain: concepts });
        if (cov.ok) {
          teacherReportMd += '\n\n## 值域覆盖到对应域了吗（覆盖缺口）\n' + cov.line + '\n';
          if (cov.note) teacherReportMd += `〔${cov.note}〕\n`;
        }
        // ⑤ 意象 vs 定义：教材定义 vs 你举的例子，口径是否等宽（只报错位，不错位就不出声）
        const ivd = fnc.imageVsDefinition(lessonText || '', mineRounds.map((r) => r.text || ''));
        if (ivd.ok && (ivd.narrowed || ivd.widened)) {
          teacherReportMd += '\n\n## 你的例子和你的定义，是同一个宽窄吗（意象 vs 定义）\n' + ivd.line + '\n';
          if (ivd.note) teacherReportMd += `〔${ivd.note}〕\n`;
        }
      } catch (_) { /* 不影响主线 */ }
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
    // 收尾并返回 result。
    // ⚠️ 停时判据可能已经替我们 finalize 过一次（done=true 已有 result），此时必须把这个 result **交回去**——
    //   否则调用方（测试 / 3D 页面）拿到的会是 `{done:true}`，课堂纪要、gains、verdictCounts 全部丢失。
    finish(onEvent, onLog) {
      if (done && _result) return _result;              // 已由停时收尾：交回已有 result，不重跑 finalize
      return done ? { done: true } : finalize(onEvent, onLog);
    },
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
  probeKind, PROBE_ORDER, conceptCoverage,
  // 体验节奏（用户拍板：产品让人获得体验，不是让机器人采集信息）
  reflectTurn, BEAT, BEAT_TEXT, beatFor,
};
