// 分享卡回归测试（2026-09-29）
// 运行： node tools/test_share_card.mjs
//
// 这个文件同时肩负两个产品的核心不变量：
//   ① A2 镜子不评分 —— 卡片上**不得出现任何分/等级/正确率**；卡上的数字只能是计数。
//   ② 2026-09-29 修的真缺陷 —— 概念邻接必须能在**口语简称**下命中
//      （说"柯西"要认到"柯西准则"）。修复前，一次正常会话的邻接矩阵是全空的，
//      映射网/盲区图/分享卡的"还没连上的两件事"全都会空掉。
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const sc = require('../share-card.js');
const rd = require('../report-diagram.js');

const checks = [];
const ok = (name, cond, extra) => checks.push([name, !!cond, extra || '']);

// ── ① 口语简称能命中概念（修复的回归防线） ──────────────────────────
const cs = ['夹逼准则', '柯西准则', '去心邻域', '单调有界'];
// 这五句是真实会话规模的样本，刻意让「柯西准则」与「单调有界」互不相邻、
// 却都挨着「夹逼准则」「去心邻域」——这正是概念格里的一个洞。
const rounds = [
  { round: 1, text: '夹逼就是两边把它夹住，去心邻域那一点本身不算' },
  { round: 2, text: '柯西是看自己和自己的差别在不在变小' },
  { round: 3, text: '有界只能说明它跑不远，但不能说明它收敛' },
  { round: 4, text: '单调有界也能判定极限存在，可我不知道它和夹逼谁更强' },
  { round: 5, text: '这几个都离不开去心邻域' },
];
const adj = rd.conceptAdjacency({ concepts: cs, rounds, probes: [] });
const edges = cs.map((c, i) => c + '->' + [...adj[i]].map((j) => cs[j]).join(','));
ok('口语简称"柯西"命中概念"柯西准则"', adj[cs.indexOf('柯西准则')].size > 0, edges.join(' | '));
ok('口语简称"夹逼"命中概念"夹逼准则"', adj[cs.indexOf('夹逼准则')].size > 0, edges.join(' | '));
ok('同句共现仍然连边（未回归）', adj[cs.indexOf('夹逼准则')].has(cs.indexOf('去心邻域')));

// ── ② 相邻两轮连边（接着上一句讲＝已经连上） ────────────────────────
ok('相邻两轮连边（第1轮→第2轮）', adj[cs.indexOf('夹逼准则')].has(cs.indexOf('柯西准则')));

// ── ③ takeaway 取自镜子的追问原文 p.say ────────────────────────────
const probes = [{ round: 4, type: 'bound', ci: 0, say: '「去心邻域」到什么份上就不算数了？', answer: '' }];
const tq = sc.takeawayQuestion({ probes, uncovered: [] });
ok('takeaway 取到镜子原文', tq && String(tq.text).indexOf('去心邻域') >= 0, tq && tq.text);
ok('takeaway 保留可溯源信息（类型/轮次）', tq && tq.type === 'bound' && tq.round === 4);

// ── ④ 没有 probes 时，从真实盲区清单派生问题（不编造） ───────────────
const tq2 = sc.takeawayQuestion({ probes: [], uncovered: ['柯西准则', '单调有界'] });
ok('无探针时从盲区清单派生', tq2 && tq2.derived === true && String(tq2.text).indexOf('柯西准则') >= 0, tq2 && tq2.text);
ok('什么都没有时不硬凑', sc.takeawayQuestion({ probes: [], uncovered: [] }) === null);

// ── ⑤ looseEnds 诚实：算不出就说算不出 ────────────────────────────
ok('概念不足三个时不编洞', sc.looseEnds({ concepts: ['极限'], rounds, probes }) === null);
const leEmpty = sc.looseEnds({ concepts: ['甲概念', '乙概念', '丙概念'], rounds: [], probes: [], uncovered: [] });
ok('无任何线索时返回 null（不虚构连系）', leEmpty === null);
const le = sc.looseEnds({ concepts: cs, rounds, probes, uncovered: [] });
ok('有数据时算出概念格的洞', le && le.kind === 'hole' && !!le.a && !!le.b, le && JSON.stringify(le));
ok('洞的前提：两者确实不相邻', le && le.kind === 'hole'
  && !adj[cs.indexOf(le.a)].has(cs.indexOf(le.b)));
ok('洞的中间人确实两边都挨着', le && le.kind === 'hole' && le.via.length > 0
  && le.via.every((k) => adj[cs.indexOf(le.a)].has(cs.indexOf(k)) && adj[cs.indexOf(le.b)].has(cs.indexOf(k))));

// ── ⑥ A2 卡片禁止评分 ───────────────────────────────────────────
const result = { concepts: cs, rounds, probes, mineRounds: rounds, uncovered: ['单调有界'] };
const svg = sc.shareCardSvg({ lessonTitle: '极限存在准则', result, date: '2026-09-29' });
const BANNED = ['得分', '分数', '正确率', '正确度', '评级', '等级', '优秀', '及格', '掌握度%', '正确数'];
const hits = BANNED.filter((w) => svg.indexOf(w) >= 0);
ok('卡片不含任何评分字样（A2）', hits.length === 0, hits.join(','));
ok('卡片是合法 SVG', svg.indexOf('<svg') === 0 && svg.lastIndexOf('</svg>') === svg.length - 6);
ok('卡片含转载钩子（看到的人想要自己那张）', svg.indexOf('讲一遍，你也能拿到自己那张') >= 0);

// ── ⑦ 卡片数字＝计数，且取自 mineRounds（不是镜子那一侧） ─────────────
ok('卡片轮数取自 mineRounds 且数字为真值（v3：计数行）', svg.indexOf(rounds.length + ' 轮讲授') >= 0, '期望 ' + rounds.length);
ok('卡片盲区数为真值（v3：盲区以还开着的问题原文呈现）', svg.indexOf('「' + result.uncovered[0] + '」你提到了') >= 0);

// ── ⑧ 空输入不崩 ──────────────────────────────────────────────
let crashed = '';
try { sc.shareCardSvg({}); sc.shareCardSvg({ result: {} }); } catch (e) { crashed = String(e.message); }
ok('空输入不崩', crashed === '', crashed);

const fails = checks.filter((c) => !c[1]);
for (const [n, p, e] of checks) console.log((p ? '✅ ' : '❌ ') + n + (e ? '　— ' + e : ''));
console.log(`=== test_share_card: ${checks.length - fails.length} passed, ${fails.length} failed ===`);
process.exit(fails.length ? 1 : 0);
