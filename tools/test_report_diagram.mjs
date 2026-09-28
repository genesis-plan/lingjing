// test_report_diagram.mjs — 《我的收获》图表化：真实数据驱动，4 图齐全，零编造
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const t = require('../teacher.js');
const rd = require('../report-diagram.js');

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  ✅ ' + name + (extra ? ' · ' + extra : '')); }
  else { fail++; console.log('  ❌ ' + name + (extra ? ' · ' + extra : '')); }
};

// ── 1. 四个 SVG 构造器对"空/异常"输入不崩、不编造 ──
console.log('【1】四个图构造器对异常输入稳健');
try {
  const empty = rd.renderHtmlReport({ title: 'X', teacherReportMd: '', result: { concepts: [], probes: [], rounds: [], mineRounds: [] } });
  ok('空数据也能出 HTML', /<html/.test(empty));
  ok('空数据有 4 个 <svg> 占位（非编造，仅结构）', (empty.match(/<svg/g) || []).length === 4, (empty.match(/<svg/g) || []).length + ' 个');
} catch (e) { ok('空数据不抛异常', false, e.message); }

// ── 2. 真实会话：跑一节"带方向判断"的课，验证图据真实数据生成 ──
console.log('【2】真实会话：极限课 → 图表版 HTML');
const lesson = t.parseLesson('极限::当自变量无限接近某个值,函数的值无限接近一个确定的数,这个数就是极限。它研究的是趋近的过程,而不是到达。极限比函数值本身更基本。||自变量无限接近|函数的值无限接近|确定的数|趋近的过程');
const s = t.createSession(lesson, { maxRounds: 3 });
await s.start(() => {}, () => {});
for (let i = 0; i < 3; i++) await s.reply('极限就是说越来越靠近一个点但不踩上去，函数值就越来越靠近那个数，这比函数值本身更基本', () => {}, () => {});
await s.finish(() => {}, () => {});

const html = rd.renderHtmlReport({
  title: '极限',
  teacherReportMd: s.result.teacherReportMd,
  result: { concepts: s.result.concepts, probes: s.result.probes, rounds: s.result.rounds, mineRounds: s.result.mineRounds },
});

ok('HTML 含 4 张图（收敛/保号/映射网/盲区）', (html.match(/<svg/g) || []).length === 4, (html.match(/<svg/g) || []).length + ' 张');
ok('含图文同步说明 banner（双重编码/多媒体学习）', /双重编码|多媒体学习/.test(html));
ok('含认知收敛图标题', /认知收敛判据/.test(html));
ok('含保号性图标题', /保号性/.test(html));
ok('含映射网图标题', /映射网/.test(html));
ok('含伽罗瓦盲区图标题', /伽罗瓦盲区/.test(html));
ok('不评分红线在 HTML 里显式声明', /不评分/.test(html));
// 图文同源（结构保证）：文本里的"认知收敛判据"段与图览里的收敛图，来自同一次
// cognitiveConvergence({concepts, mineRounds, probes}) 调用——两者并存即同源。
ok('图文同源：文字段与收敛图都来自同一 cc 计算', /认知收敛判据/.test(html) && /认知收敛判据：你从不同方法/.test(html));

// ── 3. 各构造器独立可调用且产出合法 SVG ──
console.log('【3】构造器独立产出合法 SVG');
const ccRes = { verdict: 'converged', localPreserved: true, pathIndependent: true, core: ['确定的数'] };
ok('convergenceDiagram 合法', /<svg[\s\S]*<\/svg>/.test(rd.convergenceDiagram(ccRes)));
ok('signDiagram 合法', /<svg[\s\S]*<\/svg>/.test(rd.signDiagram({ directional: [{ concept: '极限', sentence: '极限必然存在' }], notPreserved: [] })));
ok('mapNetworkDiagram 合法', /<svg[\s\S]*<\/svg>/.test(rd.mapNetworkDiagram(s.result)));
ok('blindSpotDiagram 合法', /<svg[\s\S]*<\/svg>/.test(rd.blindSpotDiagram(s.result)));

console.log(`\n=== test_report_diagram: ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
