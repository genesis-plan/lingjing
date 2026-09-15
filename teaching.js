'use strict';
/*
 * 灵境·课室 — 教学知识模型（BKT / ReKT(2024) / 性格驱动 LLM 学生模拟）
 * --------------------------------------------------------------------------
 * 本文件是纯数学模型（无网络、无 LLM 依赖），由 teacher.js 编排调用。
 *
 * 五个定义（见 docs/classroom-framework.md）：
 *   定义1 知识点空间 K = {k_1..k_M}，MVP 阶段 M<=5
 *   定义2 知识状态 p_{i,j}(t) ∈[0,1]，矩阵 P(t) ∈[0,1]^{N×M}
 *   定义3 更新 p(t+1)=p(t)+Δp−γ·p(t)，Δp=α_i·β_j·LLM_i(k_j)
 *   定义4 教学效果 E(t)=mean(p(t+1)−p(t))；方差 σ²(t)
 *   定义5 提问由性格 + 知识状态驱动
 *
 * 诚实标注（务必记住，别把软度量当诊断）：
 *   LLM_i 是 LLM 自评的"理解程度"，非客观校准概率。整条 Δp→E→σ² 链的可信度
 *   上限 = 该自评的可信度；免费/小模型有谄媚饱和风险（总回≈1 → P 锁 1、E 虚高）。
 *   因此 E(t)/σ²(t) 在 MVP 只读作"相对变化信号"，不冒充客观测评。
 *   框架自身在 docs 第六节已承认，v2.0 才引入客观测试。
 *
 * ⚠️ 2026-09-11 停用（用户指出：「算那几个 AI 学生的数据……那是假的理论」）：
 *   上面那句"只读作相对变化信号"是**自我安慰**。真实情况是：LLM_i 是模型**采样出来的一个数**，
 *   没有真值来源；在这上面算均值、方差、熵、峰，等于给随机数化妆（GIGO）。
 *   更严重的是它会被印给人看（旧 teacherReport 有一句「他理解度约 37%」）——那不是软度量，是编。
 *   因此 定义2/3/4（P / Δp / E / σ²）、classEntropy(H)、fallbackUnderstand 与 R=自评均值
 *   **全部停用**：函数暂留（不删，等用户拍板），但**没有任何地方再把自评喂进去、也没有地方再显示**。
 *   取代它们的是下面的「探测层」：学生抛探测（真实文本）→ 先生有没有接住（真实文本的事件）。
 *   性能取舍要讲清楚：新方案**放弃了**"AI 学生学会了多少"这个量——因为我们本来就不可能知道。
 *   保留的是"你还没答到的问题"清单，这才是对人有用的那部分。
 */

// 5 个性格（定义5 表）：名字 / 性格 / 学习能力系数 α_i / 提问风格提示
// 2026-09-10 扩展：每个学生补上**独立人设**（voice 说话方式 / weakness 易卡点 / catch 口头禅），
// 供 teacher.js 注入 LLM 提示词——让 5 个学生真正是 5 个不同的人，而非同一模型换名字。
// 说明：voice/weakness/catch 是人设数据（非数学），改这里即可调角色；
//      前 4 个字段（name/trait/alpha/style）保持向后兼容，前端只读这几个。
const PERSONALITIES = [
  { name: '小明', trait: '好奇型', alpha: 0.30, style: '为什么？如果…会怎样？',
    voice: '语速快、想到就问，常常不等别人说完就插话', weakness: '急着追问原理，常忽略前提条件', catch: '诶，那要是…呢？' },
  { name: '小红', trait: '严谨型', alpha: 0.25, style: '这里没太懂，能否再解释？',
    voice: '说话慢、有条理，喜欢先复述一遍再发问', weakness: '卡在定义的边界与例外情况上', catch: '我先确认一下——' },
  { name: '小刚', trait: '活泼型', alpha: 0.28, style: '我有个想法！那如果…',
    voice: '嗓门大、爱举手，张口就是生活里的例子', weakness: '记不住抽象步骤，一激动就跑题', catch: '我懂了我懂了！' },
  { name: '小丽', trait: '害羞型', alpha: 0.20, style: '那个…我可以问吗？',
    voice: '声音小、常停顿，习惯用"那个……"开头', weakness: '跟不上快节奏，又不太敢打断老师', catch: '那个……' },
  { name: '小华', trait: '自信型', alpha: 0.27, style: '我知道了！不对，好像不是',
    voice: '自信、爱抢答，偶尔自信过头把话说满', weakness: '自以为懂了，其实理解偏了一点', catch: '这个我会！' },
];

const GAMMA = 0.05; // 定义3：每轮遗忘因子（单会话可忽略，但保留机制）

function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

// 定义1：知识点抽取。可选显式给（"讲解||概念1|概念2"），否则按句切分自动抽 ≤5
function extractConcepts(text, provided) {
  if (Array.isArray(provided) && provided.length) return provided.slice(0, 5);
  const parts = (text || '').split(/[。！？；\n]+/).map((s) => s.trim()).filter(Boolean);
  if (parts.length >= 3) return parts.slice(0, 5);
  const byComma = (text || '').split(/[，,、]+/).map((s) => s.trim()).filter(Boolean);
  if (byComma.length >= 3) return byComma.slice(0, 5);
  return ['核心概念1', '核心概念2', '核心概念3'];
}

// 难度系数 β_j：按概念文本长度启发式估计（长≈难）。真实场景可由教师预设/系统估计
function estimateDifficulty(concept) {
  const len = (concept || '').length;
  return clamp(0.3 + (len / 40) * 0.4, 0.2, 0.8);
}

// 定义2：初始知识矩阵。p0 由性格(α_i)与难度(β_j)共同决定（框架：初始掌握概率）
function initP(personalities, difficulties) {
  const N = personalities.length, M = difficulties.length;
  const P = [];
  for (let i = 0; i < N; i++) {
    const a = personalities[i].alpha;
    const row = [];
    for (let j = 0; j < M; j++) {
      const b = difficulties[j];
      row.push(clamp(0.20 + 0.30 * (1 - b) + 0.20 * (a - 0.20), 0, 1));
    }
    P.push(row);
  }
  return P;
}

// 确定性兜底理解评估（无密钥）：平滑递增 + 性格/难度调制，可复现。
// 仅作演示循环，真实理解须 LLM 自评（见 assess，在 teacher.js）。
function fallbackUnderstand(i, j, round, alpha, beta) {
  const seed = Math.sin((i + 1) * 12.9898 + (j + 1) * 78.233 + round * 37.719) * 43758.5453;
  const jitter = (seed - Math.floor(seed) - 0.5) * 0.06; // ∈[-0.03,0.03]
  const val = 0.25 + 0.10 * round + (alpha - 0.25) * 1.0 - 0.15 * beta + jitter;
  return clamp(val, 0.05, 0.98);
}

// 定义4：教学效果 E(t) 与方差 σ²(t)。σ² 按框架定义用 Δp 计算（非净变化）
function teachingEffect(P0, P1, delta) {
  const N = P0.length, M = P0[0].length;
  let sum = 0;
  for (let i = 0; i < N; i++) for (let j = 0; j < M; j++) sum += P1[i][j] - P0[i][j];
  const E = sum / (N * M);
  let s = 0;
  for (const x of delta) s += (x - E) * (x - E);
  const sigma2 = s / (N * M);
  const Ej = [];
  for (let j = 0; j < M; j++) {
    let sj = 0;
    for (let i = 0; i < N; i++) sj += P1[i][j] - P0[i][j];
    Ej.push(sj / N);
  }
  return { E, Ej, sigma2 };
}

// 信息论：课堂熵 H（灵境·课室体验设计"课堂活跃度"）—— 理解度在全体「学生×知识点」单元上分布的 Shannon 熵
//   H = -Σ p_k log p_k / log(K)，把每个 P[i][j] 落入 K=10 个等宽桶，p_k 为桶占比。
//   低熵 = 全班理解度高度一致（齐听懂或齐走神，全落少数桶）；高熵 = 各生各点参差（分布散）。
//   与文档"低熵=一致 / 高熵=各异"严格一致，也与 E(t) 互补：E 看均值，H 看离散度，
//   二者并列才能区分 低E低H(讲差无人应) / 低E高H(讲差但热议) / 高E低H(讲好但沉闷) / 高E高H(理想)。
function classEntropy(P) {
  const cells = [];
  for (const row of P) for (const v of row) cells.push(v);
  const N = cells.length; if (!N) return 0;
  const K = 10; const hist = new Array(K).fill(0);
  for (const v of cells) { const b = Math.min(K - 1, Math.max(0, Math.floor(v * K))); hist[b]++; }
  let H = 0;
  for (const c of hist) { const p = c / N; if (p > 0) H -= p * Math.log(p); }
  return H / Math.log(K);
}

// 保留：互动参与度 V(s)（与知识无关，框架世界一致性指标；非教学成效）
function valueFunction(world, teacherId, studentIds) {
  const notes = [];
  for (const v of world.S.values()) {
    if (v.kind === 'artifact' && v.payload && v.payload.type === 'note' && studentIds.includes(v.owner)) {
      notes.push(String(v.payload.text || ''));
    }
  }
  if (!notes.length) return 0;
  const uniq = new Set(notes);
  const nontrivial = notes.filter((t) => t.length >= 4).length;
  return (uniq.size / notes.length) * (nontrivial / notes.length);
}

// R_教学：教师 -> 每位学生 的关系边（框架世界 ⟨S,R,M,T⟩）
function teachingRelation(world, teacherId, studentIds) {
  for (const s of studentIds) world.addRelation('teach', teacherId, s, { round: 0, kind: 'human->ai' });
  return world.R;
}

// ================== 教学认知层（2026-09-10 用户定框架：人是学习者，AI 学生是镜子）==================
// 用户原话：「人类才说了一段话，5 个学生自己全部理解？这个过程不对，不符合实际情况，我们要用
// 教学认知的规律，让人类从这次传授中，整理、升华自己已有的知识，而不是让智能体学会知识。」
// 因此这里补三件事：
//   ①前概念/误解（misconception）——学生不是空白容器，带着旧想法进课堂，教师的核心工作就是处理误解；
//   ②教师讲解要点与澄清标记——把"人类说了什么"结构化，才能统计"你说了什么/补出了什么"；
//   ③疑问回应判定——判断某个学生的疑问是否被教师的回答真正碰到（可解释的 2-gram 重叠启发式）。

// ①前概念模板（按性格位次分配，参数化到具体知识点；有 LLM 时由 LLM 生成更贴题的误解）
// ⚠️ 2026-09-10 修：concepts 来自 extractConcepts()，当讲解有 ≥3 句时是**整句要点**，
//    而旧模板假设 a 是短名词（`以为${a}是原因，其实它是结果`）→ 拼出病句：
//    「以为阳光不是植物的「饭」，它只是能量的来源是原因，其实它是结果」。
//    改法：把要点当作**被引用的说法**放进「」，模板只描述"学生对这个说法的旧态度"。
//    整句进引号也通顺；而且在没有真实知识模型时，本来就只该声称"态度"，
//    不该编造"他具体错在哪"——那是假装知道学生的脑子。
function quotable(s, max) {
  const cap = max || 20;
  let t = String(s == null ? '' : s).replace(/[「」“”"]/g, '').replace(/\s+/g, ' ').trim();
  if (t.length > cap) t = t.slice(0, cap).replace(/[，,、；;：:。]+$/, '') + '…';
  return t || '这个说法';
}
const MISCONCEPTION_TPL = [
  (a) => `以前听过「${a}」，但一直没当真`,
  (a) => `觉得只要记住「${a}」就够了，没想过还要看条件`,
  (a, b) => `把「${a}」和「${b}」当成一回事`,
  (a) => `以为「${a}」一直是这样，不知道还有例外`,
  (a) => `把「${a}」背下来了，但说不清它到底是怎么来的`,
];
function guessMisconception(i, concepts) {
  const list = (Array.isArray(concepts) && concepts.length) ? concepts : ['这个说法'];
  const a = quotable(list[i % list.length]);
  const b = quotable(list[(i + 1) % list.length]);
  return MISCONCEPTION_TPL[i % MISCONCEPTION_TPL.length](a, b);
}

// ②教师讲解要点：把人类说的话切成可追踪的要点（用于"你讲了什么""要点够不够"）
function teacherPoints(text) {
  return String(text || '')
    .split(/[。！？；\n]+/)
    .map((s) => s.replace(/^[，,、\s]+/, '').trim())
    .filter((s) => s.length >= 4)
    .slice(0, 8);
}
// 教师在回答里是否给出了"澄清型"内容（前提/条件/例子/边界）→ 统计"你补出了什么"
const CLARIFY_MARK = /(因为|所以|前提|条件是|需要|比如|例如|注意|其实|换句话说|关键是|首先要|区别在于|例外|不完全是|也就是说)/;
function isClarifying(text) { return CLARIFY_MARK.test(String(text || '')); }

// ③中文 2-gram 重叠：只作**字符串工具**留着（供"课前尝试碰到了哪几个概念"这类字面匹配用）。
// ⚠️ 2026-09-11：曾用它做"先生的回答有没有接住学生疑问"的自动判定，标定后证明是噪声，判定已撤销——
//    见下方 addressScore 的说明。别再把这两个函数接回判定链路。
function bigrams(s) {
  const t = String(s || '').replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, '');
  const g = new Set();
  for (let i = 0; i < t.length - 1; i++) g.add(t.slice(i, i + 2));
  return g;
}
function overlapScore(question, answer) {
  const A = bigrams(question), B = bigrams(answer);
  if (!A.size || !B.size) return 0;
  let hit = 0;
  for (const x of A) if (B.has(x)) hit++;
  return hit / A.size;
}
// ⚠️ 2026-09-11 停用（**已无调用点**，保留仅为等用户拍板是否物理删除）：
//   它把"2-gram 重叠度"映射成 0/0.35/0.65/1 的"疑惑解开程度"。标定 9 组真实问答后发现：
//     · 一个真正回答了问题的回答 → 重叠 0.000（因为他换了词，没复述学生的用词）
//     · 一句敷衍的"好的，下次再讲" → 重叠 0.333（因为它复述了学生问题里的词）
//   即它**量的是用词重合，不是答没答到**，方向甚至与直觉相反。用噪声下判断比不判更糟，
//   所以该判定已从 playRound 整段删除，判定权交回人类（课后逐条看"他问的/你答的"）。
function addressScore(question, teacherReply) {
  if (!teacherReply) return 0;
  const s = overlapScore(question, teacherReply);
  return s >= 0.30 ? 1 : s >= 0.15 ? 0.65 : s > 0.05 ? 0.35 : 0.08;
}

// ================== 探测层（2026-09-11 用户定方向：AI 学生不做被计算的对象，只做照出人类盲区的镜子）==================
// 用户原话：「你为什么一直算那几个AI学生的数据呢，这不是假的吗，他们只是模拟学生，并不是真正学会知识……
//   那是假的理论，重新考虑他们的回答，不要固定是那几句，而是从这个产品的定位出发，
//   让他们的提问回答，对人类使用者有用，比如发现人类使用者所传授的知识的盲区、反例、正例，
//   让人类使用者顿悟，有所思考……这个产品的最终定位是为人服务，而不是为AI服务。」
//
// 所以学生的一轮输出，从「给我自己打 N 个理解分」改成「抛出一枚探测」。
// 这不是换说法，是**把量的来源换掉**：
//   旧：Δp = α·β·(LLM 自评 u) → P → E/σ²/H   ← 源头是模型采样出的一个数，没有真值来源，GIGO。
//   新：学生抛出一枚探测（真实文本）→ 先生回答（真实文本）→ 课后两段原文并排给人看。
//       机器只负责**搬运原文**，不负责判"答到了没有"（那个判据试过，是噪声，已撤）。
//
// 六类探测（后四类直接对应 Watson & Mason 的 boundary examples；句式取自 King 2002 互惠同伴提问）：
//   反例 counter   —— 有没有反过来也成立的？我想到一个好像不符合的
//   边界 bound     —— 什么情况下它就不成立了？（"没人会想到的正例 / 别人以为对其实错的非例"）
//   正例 example   —— 我生活里见过的那件事，算不算？
//   区分 distinct  —— 这两个说法到底差在哪？我总把它们搞混
//   机制 mechanism —— 为什么会这样，中间是怎么发生的？
//   应用 apply     —— 要是换成别的，会怎样？
//
// 为什么是这六类（文献锚点，2026-09-11 核实）：
//   · VanLehn (2003) "Why Do Only Some Events Cause Learning during Human Tutoring"：
//     学习**只在学生到达 impasse（卡住／答错）之后**发生；不卡住时，讲得再好也难学会。
//     → 学生的职责是**制造 impasse**，不是配合点头。探测就是 impasse 的引信。
//   · King (2002) Guided Reciprocal Peer Questioning：用**通用句式脚手架**逼出高层认知
//     （举例／边界／对比／解释为什么／强弱），比让学生"随便问"的产出质量高得多。
//   · Watson & Mason（learner-generated examples）：让学生自己造**边界例**
//     ——"没人会想到的正例"＋"别人以为对其实错的非例"。这是"照出盲区"最锋利的一类。
//   · Schwartz & Biswas（Teachable Agents / Betty's Brain）：学习-by-教学中**真正学的是人类**，
//     可教代理是镜子；镜子该做的，是把它"学到的"（＝人类教的）暴露回给人类。
//
// ⚠️ 诚实标注：探测**由 LLM 扮演的学生生成**，它不是真人学生。它的价值不在"它学会了"，
//   而在"它问出的东西，能不能让人类发现自己没讲透"。
//   下面 classifyProbe 是**本地正则复核**（不采信模型自报的类型）；probCounts 是**计数**，
//   不是分数。两者都只回答"这一课学生把你往哪些方向逼了"，**不是**对学生的测评。
const PROBE_TYPES = [
  { key: 'counter',   label: '反例',   hint: '有没有反过来也成立的？我想到一个好像不符合的' },
  { key: 'bound',     label: '边界',   hint: '什么情况下它就不成立了？' },
  { key: 'example',   label: '正例',   hint: '我生活里见过的那件事，算不算？' },
  { key: 'distinct',  label: '区分',   hint: '这两个说法到底差在哪？我总把它们搞混' },
  { key: 'mechanism', label: '机制',   hint: '为什么会这样，中间是怎么发生的？' },
  { key: 'apply',     label: '应用',   hint: '要是换成别的，会怎样？' },
];
const PROBE_LABELS = PROBE_TYPES.map((p) => p.label);
const PROBE_RE = [
  ['bound',     /什么(情况|时候|条件|样的情况).*(不|没|例外|才算)|什么时候就不|不成立|例外|除外|怎么界定|边界|前提是|什么时候才不/],
  ['counter',   /反过来|难道|岂不是|不可能吧|不对吧|那就不是|万一|偏偏|可是我见过|怎么会是|说不通/],
  ['example',   /算不算|是不是一种|算作|我(见过|家里|爸爸|妈妈|同学|上次)|比如说我|那.*(算吗|算不算)|拿.*来算|我拿.*比/],
  ['distinct',  /有什么(不一样|区别|不同|差别)|是不是一回事|一回事吗|分不清|搞混|哪个才是|区别(在哪|是)|怎么区分|差在哪|有啥区别|有什么差别|怎么分/],
  ['mechanism', /为什么会|凭什么|原理|中间.*(怎么|发生)|怎么来的|为什么一定|到底是怎么|怎么就能/],
  ['apply',     /如果换|要是.*换|换成.*(会|是不是|呢|吗)|要是.*(改|变|别的)|能不能用|拿来.*(做|用)|倒过来会|换个别/],
];
// 本地复核探测类型：宁可判不出（null），也不硬套一类（硬套＝另一种编）
function classifyProbe(say) {
  const t = String(say || '');
  if (!t) return null;
  for (const [k, re] of PROBE_RE) if (re.test(t)) return k;
  return null;
}
function probeLabel(key) {
  const hit = PROBE_TYPES.find((p) => p.key === key);
  return hit ? hit.label : '';
}
// 本课探测构成：**计数**，不是分数。回答"这一课，学生把你往哪些方向逼了"
function probeCounts(probes) {
  const out = { counter: 0, bound: 0, example: 0, distinct: 0, mechanism: 0, apply: 0, unknown: 0 };
  for (const p of probes || []) {
    const k = p && p.type;
    if (k && out[k] != null) out[k]++; else out.unknown++;
  }
  return out;
}
// 探测构成的"人话一行"（给报告用；只说事实，不评分）
function probeSummaryLine(counts) {
  if (!counts) return '';
  const named = PROBE_LABELS
    .map((label, i) => ({ label, n: counts[PROBE_TYPES[i].key] || 0 }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n);
  if (!named.length) return '';
  return named.map((x) => `${x.label} ${x.n}`).join(' · ');
}

// ================== 确定性薄弱点定位层（P0-1，2026-09-15 加）==================
// 设计哲学（见 docs/理论基座.md §四）：AI 学生不做被计算的对象、不评分；但"照出人类盲区"必须**确定性**——
// 不靠 LLM 自由发挥猜人类哪里讲漏了（那会退化成"不管输入什么他们都回那几句"）。
// 本层对人类讲解文本做**可解释、可复现**的弱信号检测，把"可能讲漏 / 讲偏"的位置钉出来，
// 喂给探针调度：哪枚探测去逼哪个口子，有依据。
//
// 五类理解漏洞信号（来自认知科学 / 可教代理研究；确定性正则，跨场景取值必不同，否则是摆设）：
//   jargon   用术语未解释   —— 专业词出现但同句邻句无解释标记
//   jump     逻辑跳跃 A→C   —— 推理词出现但前句无前提标记（缺中间的 B）
//   abstract 具体→抽象      —— 抽象词出现但本句无生活例 / 数字锚点
//   parrot   用原话非自己话 —— 连续两句高度重复（疑似背定义）
//   omit     前提盲区(WYSIATI)—— 把断言讲成定论却没给启用条件（Kahneman 2011：缺失前提不"感觉"缺失）
// 五类信号 → 六类探测映射（确定性，证据见理论基座.md §四.3 / §十.11 / §十.12）：
//   jargon→example  jump→mechanism  abstract→counter  parrot→apply  omit→bound
// 调度优先级：omit/jump 且带高信心标记 → 严重度 +1（上限 5），优先钉（hypercorrection 最高收益窗口）。

function wpKeywordsOf(c) {
  const raw = String(c || '').replace(/[「」""'']/g, '').trim();
  const parts = raw.split(/[\s,，、；;。]+/).map((w) => w.trim()).filter((w) => w.length >= 2);
  return parts.length ? parts : [raw.slice(0, 6)];
}
const WP_JARGON = /([一-龥A-Za-z]{2,}(?:定律|定理|效应|模型|函数|方程|理论|算法|机制|原理|概念|范式|熵|梯度|矩阵|向量|微分|积分|拓扑|群|环|域|映射|算子|场|势|流形))/;
const WP_INFER = /(所以|因此|于是|这就|说明|可见|推出|意味着|换句话说|归根到底|一句话|关键是|要记住)/;
const WP_PREM = /(因为|由于|前提|条件是|需要|基于|假设|首先|第一步)/;
const WP_ABSTRACT = /(本质|规律|核心|根本|抽象|意义上|层面|维度|结构|框架|范式|底层|底层逻辑)/;
const WP_CONCRETE = /(比如|例如|我|生活|见过|去年|上次|实际|具体|数字|\d|％|%|％)/;
// —— 第 5 类信号：前提盲区（WYSIATI / Kahneman 2011）——
// 人用已有信息拼出自洽故事、把没说的前提当成"不存在"。钉：把断言陈述成确定/普适、却没给启用条件。
// 命中条件（确定性，降误报）：① 含确定/普适标记 ② 含"成立/适用/有效"等断言动词 ③ 无弱化语 ④ 非问句。
const WP_CERTAIN = /(一定|肯定|必然|当然|总是|永远|全都|都是|所有|无一例外|毫无例外|没有例外|就是|注定)/;
const WP_QUAL = /(除非|除了|例外|除外|前提|不一定|未必|可能|也许|有时候|某些情况|大多数|通常|一般|往往|如果.*(不成立|不)|并非所有|例外情况)/;
const WP_CLAIM = /(适用|成立|正确|有效|能|会|是|对|没问题|行得通|靠谱|管用|错不了)/;
// 高信心标记（用于"高信心缺口优先"，见下 wpSeverityOf）：定论式、毋庸质疑的口吻。
// 来源：hypercorrection effect（Metcalfe & Butterfield 2001）——人对高信心错误反而纠正得最持久，
//       因为"自信却错了"触发元认知惊讶→注意捕获→编码增强。故 P0-1 调度应优先钉高信心缺口。
const WP_ASSERT_CONF = /(显然|毫无疑问|肯定|必定|铁定|就是|注定|绝对|永远|一定|毋庸置疑|明摆着)/;
const WP_SIGNAL_LABEL = {
  jargon: '用了术语却没解释',
  jump: '逻辑跳了一步（缺中间环节）',
  abstract: '突然从具体飞到抽象',
  parrot: '像是照本宣科',
  omit: '把断言讲成了定论，却没说启用条件（你默认了什么前提）',
};
const WP_SEVERITY = { jargon: 2, jump: 3, abstract: 1, parrot: 1, omit: 3 };
const WP_STRATEGY = { jargon: 'example', jump: 'mechanism', abstract: 'counter', parrot: 'apply', omit: 'bound' };
function weakPointToProbeType(signal) { return WP_STRATEGY[signal] || 'apply'; }

// 严重度（基线 + 高信心缺口优先 boost）
// 基线见 WP_SEVERITY；当信号是 omit/jump 且句子带高信心标记时 +1（上限 5），
// 让"定论式断言却缺前提/跳步"的薄弱点排在调度最前 → 命中 hypercorrection 最高收益窗口。
function wpSeverityOf(sig, sent) {
  let s = WP_SEVERITY[sig] || 1;
  if ((sig === 'omit' || sig === 'jump') && WP_ASSERT_CONF.test(sent)) s = Math.min(5, s + 1);
  return s;
}

// 单句弱信号检测：返回命中的信号数组（可多个）
function sentenceSignals(sent, prevSent) {
  const out = [];
  if (WP_JARGON.test(sent) && !CLARIFY_MARK.test(sent)) out.push('jargon');
  if (WP_INFER.test(sent) && prevSent && !WP_PREM.test(prevSent)) out.push('jump');
  if (WP_ABSTRACT.test(sent) && !WP_CONCRETE.test(sent)) out.push('abstract');
  // 第 5 类：前提盲区（WYSIATI）。确定/普适断言 + 含成立动词 + 无弱化语 + 非问句。
  if (WP_CERTAIN.test(sent) && WP_CLAIM.test(sent) && !WP_QUAL.test(sent)
      && !/[？?]$/.test(sent.trim()) && sent.trim().length > 8) out.push('omit');
  return out;
}
// 跨句重复检测（parrot）：本句与上一句 bigram 重叠率 > 0.7 且都较长
function isParrot(sent, prevSent) {
  if (!prevSent || sent.length < 8) return false;
  const clean = (s) => String(s).replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, '');
  const ta = clean(sent), tb = clean(prevSent);
  const A = new Set(), B = new Set();
  for (let i = 0; i < ta.length - 1; i++) A.add(ta.slice(i, i + 2));
  for (let i = 0; i < tb.length - 1; i++) B.add(tb.slice(i, i + 2));
  if (!A.size || !B.size) return false;
  let hit = 0; for (const x of A) if (B.has(x)) hit++;
  return hit / A.size > 0.7;
}

// 主入口：对人类讲解文本做确定性弱信号检测，返回按严重度降序的薄弱点列表。
// 入参：lessonText（人类原话）、concepts（extractConcepts 结果）
// 返回：[{conceptIdx, concept, signal, signalLabel, strategy, probeType, evidence, severity}]
// ⚠️ 诚实标注：detectWeakPoints 只分析**人类文本**里的表达特征，不声称知道 AI 学生"懂没懂"；
//   它钉出的是"人类可能讲漏的地方"，是给探针调度当目标的依据，不是对学生的判定。
function detectWeakPoints(lessonText, concepts) {
  const M = Array.isArray(concepts) ? concepts.length : 0;
  const kw = Array.from({ length: M }, (_, j) => wpKeywordsOf(concepts[j]));
  const sents = String(lessonText || '').split(/[。！？；\n]+/).map((s) => s.trim()).filter(Boolean);
  const found = [];
  for (let i = 0; i < sents.length; i++) {
    const sent = sents[i], prev = i > 0 ? sents[i - 1] : '';
    const sigs = sentenceSignals(sent, prev);
    if (isParrot(sent, prev)) sigs.push('parrot');
    if (!sigs.length) continue;
    const hitIdx = [];
    for (let j = 0; j < M; j++) if (kw[j].some((k) => sent.includes(k))) hitIdx.push(j);
    const anchors = hitIdx.length ? hitIdx : (M ? [i % M] : [0]);
    for (const sig of sigs) {
      for (const j of anchors) {
        found.push({
          conceptIdx: j,
          concept: concepts[j] || concepts[0] || '这个说法',
          signal: sig,
          signalLabel: WP_SIGNAL_LABEL[sig],
          strategy: WP_STRATEGY[sig],
          probeType: weakPointToProbeType(sig),
          evidence: sent.slice(0, 22),
          severity: wpSeverityOf(sig, sent),
        });
      }
    }
  }
  // 严重度降序；同严重度按概念序，保证可复现
  found.sort((a, b) => (b.severity - a.severity) || (a.conceptIdx - b.conceptIdx));
  return found;
}

// ================== 教师元认知收益层（需求⑥：教中学 / protégé effect + IOED + 费曼）==================
// 用户原话：「查找外部资料，看看怎么会让使用的人，从讲授给别人听，获得自己的东西」。
// 即：让人（教师）通过把知识讲授给 AI 学生，反过来获得属于自己的理解深化、盲区暴露、元认知校准。
//
// 理论锚点（已在外部资料核实，见需求⑥研究笔记）：
//   - Protégé Effect（学习陪练效应）：预期要教 + 实际教学，同时激活
//       检索练习 + 深度加工 + 元认知监控 + 生成效应 四件事，理解更深、保留更久。
//   - IOED 解释深度错觉（Rozenblit & Keil, 2002）：人高估自己对机制性知识的理解；
//       只有尝试逐步解释时才暴露差距（自评下降 1.5~2 分），单纯重评不降。
//       这是费曼技巧的诊断基础，也是"教中学"暴露盲区的最硬证据。
//   - 费曼技巧四步：选概念 → 用外行能懂的话教 → 卡壳处回源重学 → 简化+类比。
//      核心是"输出倒逼输入""页面不点头"——无法糊弄。
//
// 本层把"教师讲解要点 + 每轮回答是否澄清 + 学生疑问与是否被回应"反推成**教师自身的盲区诊断**，
// 并在下课后给教师一份人话反馈（进课后抽屉/作品，绝不进体验层）。
//
// ⚠️ 诚实标注（务必记住，别把启发式当诊断）：这是基于对话文本的**可解释启发式推断**，
//   不是读心术、不是客观测评。只说"可能/值得"，不当作定论；落点永远是"下一步该干什么"，
//   而非"你哪里不行"。框架自身（docs 局限性）已承认：v2.0 才引入客观测试。

// 从教师的回答里挑出"像术语带过"的原话：未命中澄清标记、且非空。最多 3 条，供教师回看。
function jargonMaskedQuotes(replies) {
  return (replies || [])
    .filter((r) => r && !r.clarifying)
    .map((r) => String(r.text || '').trim())
    .filter(Boolean)
    .slice(0, 3);
}

// 教师诊断：把课堂里**真实发生过的对话事件**整理成给教师看的东西。
// 入参（均由 teacher.js finalize 提供）：
//   points:        教师讲解要点数组（teacherPoints(lessonText)，已滤 <4 字碎片）
//   teacherReplies: [{round,text,clarifying}] 教师每一轮回答
//   probes:        [{round,name,type,say,answer}] 本课学生抛出的全部探测
//                  （say＝学生原话；answer＝这枚探测收到的那段教师回答原文，没收到的为 null）
// 返回结构化诊断（供渲染 + 生成人话报告复用）。
//
// ⚠️ 2026-09-11 两次更正（用户："算那几个 AI 学生的数据是假理论"、"产品定位是为人服务，不是为 AI 服务"）：
//   ① 旧版有 hardBlind 分支：依据「学生自评理解度 R < 0.45」判定"他真没懂"，
//      并在报告里**直接印出**「小明卡在：「…」（他理解度约 37%）」。
//      那是把**模型随机采样出的一个数**当成对另一个人脑子的观测，是编，不是测量。已删除。
//   ② 后来又有一版用「教师回答与学生问题的 2-gram 重叠」自动判"接住没接住"。
//      标定发现它基本是噪声（好回答能得 0.000，敷衍的"好的下次再讲"反而得 0.333）——
//      **用噪声下判断，比不判更糟**。已整段删除（标定数据见 .workbuddy/reports/2026-09-11-停止给AI学生打分.md）。
//   现在本层只做**机器确实做得到**的事：把"学生问了什么 / 你答了什么"逐条并排摆好，
//   "答到了没有"这一步**留给人类自己**——逐条读过去，哪一条心里咯噔一下，那就是口子。
//   代价摊开讲：我们**无法**知道 AI 学生"懂没懂"（它没有脑子），所以从不声称知道。
function teacherDiagnosis(input) {
  const { points = [], teacherReplies = [], probes = [] } = input || {};
  const replies = teacherReplies || [];
  const clar = replies.filter((r) => r && r.clarifying).length;
  const clarifyRatio = replies.length ? clar / replies.length : 0;
  const unclarified = jargonMaskedQuotes(replies);          // 你用术语带过的原话
  const all = (probes || []).filter(Boolean);
  // 「有你的回答 / 没有你的回答」是**事实**（answer 是原样回填的回答原文），不是判定。
  // ⚠️ 一一对应只认探测记录本身；绝不用 students[].myQ——那是"本轮新问的句子"，会错配。
  const pairs = all
    .filter((p) => p.answer != null)
    .map((p) => ({ name: p.name, q: p.say, answer: p.answer, type: p.type || classifyProbe(p.say), round: p.round }));
  const openQ = all
    .filter((p) => p.answer == null)
    .map((p) => ({ name: p.name, q: p.say, type: p.type || classifyProbe(p.say), round: p.round }));
  const counts = probeCounts(all);
  const totalProbes = all.length;
  const pointCount = points.length;
  const clarified = clarifyRatio >= 0.5;   // 过半回答带前提/例子/边界（真解释 vs 背定义 的代理）
  return {
    pointCount,
    replies: replies.length,
    clarifyRatio: Math.round(clarifyRatio * 100) / 100,
    clarified,
    unclarified,                // 你用术语带过的原话（值得再用自己的话讲一遍）
    pairs,                      // 逐条并排：他问的 / 你答的（原文，一个字没改）
    openQ,                      // 你还没回的（多为收尾前刚问的）
    answered: pairs.length,     // 事实计数：几枚探测收到了你的回答
    openCount: openQ.length,    // 事实计数：几枚你没回
    probeCounts: counts,
    probeTotal: totalProbes,
    probeLine: probeSummaryLine(counts),
    // —— 以下字段语义已废，保留空占位只为避免下游读到 undefined 崩 ——
    unaddressed: [],            // 曾＝"自动判你没答到的"，已删（判定权交回人）
    stuck: [],                  // 曾＝旧名同义，已删
    caught: null,               // 曾＝自动"接住"计数，已删
    judged: null,               // 曾＝"有回答可判"计数，已删
    hardBlind: [],              // 曾＝基于学生自评的"真没懂"，已删
    ioedHits: false,            // 曾＝"存在没答到的"，依赖自动判定，已删
  };
}

// 把诊断翻译成教师的"人话收获报告"（Markdown，四节：讲清了 / 他问的你答的 / 术语带过 / 下一步费曼）。
// 核心交付物——让使用者从讲授中获得"属于自己的东西"。
// ⚠️ 锋利的地方不在"替你下判决"，而在**把问题与你的回答逐条并排放好**：
//   直面清单本身就会把人问住；我们不假装机器知道他答到了没有（那是读心，机器做不到）。
function teacherReport(diag, ctx) {
  const title = (ctx && ctx.title) || '这一课';
  const L = [];
  L.push(`## 你从这次讲授里，得到了什么`);
  L.push('');
  L.push(`你站在讲台上，把脑子里的东西往外拿了一遍——这正是"教中学"。`);
  L.push(`讲出来的过程，逼你重新检索、重新组织；学生问住你的地方，逼你回头看自己到底懂没懂。`);
  L.push('');
  L.push(`### 一、你讲清了的部分`);
  L.push(`- 你总共讲出了 **${diag.pointCount}** 个要点，做了 **${diag.replies}** 轮回答。`);
  if (diag.replies === 0) {
    L.push('- 这一课你还没怎么回话——试着在下一次多接几句学生的疑问，盲区才暴露得出来。');
  } else if (diag.clarified) {
    L.push('- 你的回答里多半带出了前提、例子或边界——说明你不是背定义，是在真解释。这正是对自己知识的深度加工。');
  } else {
    L.push('- 但你的回答里带出前提/例子/边界的不到一半，有几句更像"把术语又说了一遍"（见第三节）。');
  }
  L.push('');
  L.push(`### 二、学生问到的地方，逐条摆给你（答到了没有，你自己判）`);
  L.push('这一课五个学生一共抛出 **' + diag.probeTotal + '** 枚探测'
    + (diag.probeLine ? `（${diag.probeLine}）` : '') + '，'
    + `其中 **${diag.answered}** 枚你给了回答，**${diag.openCount}** 枚你没回。`);
  if (diag.pairs.length) {
    L.push('');
    L.push('**下面逐条并排：他问的 / 你答的。**（都是原话，一个字没改）');
    L.push('');
    for (const p of diag.pairs) {
      const tag = p.type ? `［${probeLabel(p.type)}］` : '';
      L.push(`- ${p.name} 第${p.round}轮问：${tag}「${quotable(p.q, 34)}」`);
      L.push(`  - 你答：「${quotable(p.answer, 46)}」`);
    }
    L.push('');
    L.push('**我不替你判"答到了没有"。** 机器只能数词，不能读心——'
      + '我们试过"教师回答与问题文字重叠"这个自动判据：好回答能得 0.000，'
      + '敷衍的一句"好的下次再讲"反而得 0.333。用这种噪声下判断，比不判更糟。'
      + '所以这一步留给你：**逐条读过去，哪一条你心里"咯噔"一下，那就是你自己知识里的口子。**');
  }
  if (diag.openQ.length) {
    L.push('');
    L.push(`**你没回的 ${diag.openQ.length} 枚探测**（多是收尾前刚问的，没人有机会回——`
      + '但它们往往正是这一课最尖的那几刀）：');
    for (const p of diag.openQ) {
      const tag = p.type ? `［${probeLabel(p.type)}］` : '';
      L.push(`- ${p.name} 第${p.round}轮问：${tag}「${quotable(p.q, 34)}」`);
    }
  }
  if (diag.replies === 0) {
    L.push('');
    L.push('这一课你只讲了、没回话。学生的探测全都没人接——下次至少回两轮，盲区才暴露得出来。');
  }
  if (diag.pairs.length || diag.openQ.length) {
    L.push('');
    L.push('把这几处补上，比再讲十遍有用——那是你自己知识里的口子。');
  }
  L.push('');
  L.push(`### 三、用术语带过的地方，值得再用自己的话讲一遍`);
  if (diag.unclarified.length) {
    for (const t of diag.unclarified) L.push(`- 「${quotable(t, 26)}」`);
    L.push('');
    L.push('试着对一窍不通的人讲一遍这几句——讲不顺的那一刻，就是你真该补的地方。');
  } else {
    L.push('- 你这课的回答大多给了前提或例子，没有单纯甩术语。很好，说明你在用自己的理解讲，不是照本宣科。');
  }
  L.push('');
  L.push(`### 四、下一步（费曼技巧）`);
  L.push('挑上面任意一条，假装讲给一个完全不懂的人听：不用任何专业词，只用类比和大白话。');
  L.push('你卡住、绕弯、说不清的地方，就是你自己还没真懂的地方——把它当成下一次要讲透的目标。');
  L.push('');
  L.push('> 这份"我的收获"里只有两类东西：① 从你讲解和回答里**数得出来**的事实（要点条数、回答轮数、'
    + '带没带前提/例子、学生抛了几枚探测、哪几枚你回了）；② 把"他问的"和"你答的"并排摆好的清单。'
    + '报告**不做**"你答到了没有"的判定——机器只能数词，不能读心；那一步留给你自己。');
  return L.join('\n');
}

module.exports = {
  PERSONALITIES, GAMMA, clamp,
  extractConcepts, estimateDifficulty, initP, fallbackUnderstand, teachingEffect, classEntropy,
  valueFunction, teachingRelation,
  // 教学认知层
  guessMisconception, teacherPoints, isClarifying, bigrams, overlapScore, addressScore, quotable,
  // 探测层（2026-09-11：学生从"被计算"改成"照盲区"）
  PROBE_TYPES, PROBE_LABELS, classifyProbe, probeLabel, probeCounts, probeSummaryLine,
  // 确定性薄弱点定位层（P0-1：分析人类讲解文本的弱信号，钉探针目标）
  detectWeakPoints, weakPointToProbeType,
  // 教师元认知收益层（教中学）
  jargonMaskedQuotes, teacherDiagnosis, teacherReport,
};
