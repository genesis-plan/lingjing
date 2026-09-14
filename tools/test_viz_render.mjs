// 快测：三个新渲染函数有没有把 NaN / undefined / null 漏进 HTML。
// 做法：从单文件 HTML 里把函数源码抠出来 eval（不启动浏览器），先挡住低级错误，
//       再由 test_panel_browser.mjs 做真机验证。
import fs from 'node:fs';
import os from 'node:os';
import { pathToFileURL } from 'node:url';

const html = fs.readFileSync(new URL('../public/classroom3d.html', import.meta.url), 'utf8');
function grab(name) {
  const i = html.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('找不到函数 ' + name);
  let d = 0, started = false;
  for (let j = i; j < html.length; j++) {
    const c = html[j];
    if (c === '{') { d++; started = true; }
    else if (c === '}') { d--; if (started && d === 0) return html.slice(i, j + 1); }
  }
  throw new Error('函数 ' + name + ' 花括号不闭合');
}

const src = [
  'const LINE_COLORS = ["#b0492f","#2f6f4f","#1f5b8a","#8a5a1a","#7a3a6a"];',
  grab('hashStr'), grab('clampJS'), grab('escapeHtml'), grab('rhythmChartSvg'), grab('queueTimelineHtml'), grab('preDiffHtml'), grab('whyHtml'),
  'export { rhythmChartSvg, queueTimelineHtml, preDiffHtml, whyHtml, hashStr, clampJS, escapeHtml };'
].join('\n');
fs.mkdirSync(os.tmpdir() + '/lingjing_viz', { recursive: true });
const tmp = os.tmpdir() + '/lingjing_viz/_viz.mjs';
fs.writeFileSync(tmp, src);
const { rhythmChartSvg, queueTimelineHtml, preDiffHtml } = await import(pathToFileURL(tmp).href);

let pass = 0, fail = 0;
const reports = [];
function ok(cond, label, detail = '') {
  if (cond) { pass++; console.log('  ✅ ' + label + (detail ? '  ' + detail : '')); }
  else { fail++; console.log('  ❌ ' + label + (detail ? '  ' + detail : '')); }
}
const dirty = (s) => /NaN|undefined|null|Infinity/.test(String(s));

console.log('\n【1】课堂节奏曲线 rhythmChartSvg（纵轴＝你回话的字数，只关于你自己的文本）');
{
  // series 项形如 { round, chars, hasReply, mixLine }；shortest 是 classRhythm 给的"答得最短的一轮"
  const series = [
    { round: 1, chars: 120, hasReply: true, mixLine: '反例 1' },
    { round: 2, chars: 40, hasReply: true, mixLine: '边界 1' },   // 这一轮最短 → 最可能被问住
    { round: 3, chars: 95, hasReply: true, mixLine: '正例 1' },
  ];
  const svg = rhythmChartSvg(series, { round: 2 });
  ok(/<svg/.test(svg), '产出 SVG');
  ok(!dirty(svg), '没有 NaN/undefined/null 漏进 SVG', (svg.match(/NaN|undefined|null/g) || []).join(','));
  ok(/纵轴＝你这一轮回话的字数/.test(svg), '纵轴标注＝你回话的字数（只关于你自己写下的文本）');
  ok(/最短/.test(svg), '答得最短的那一轮被标「最短」');
  ok(/你的平均水平 \d+ 字/.test(svg), '画了你的平均水平线');
  ok(/答得最短的一轮（最可能被问住）/.test(svg), '图例说明"答得最短＝最可能被问住"（不是"他懂了没"）');
  // ⭐ 反断言：图上不许出现任何"学生理解度 / 接住率 / 懂了没"——那是我们不可能知道的（假理论）
  ok(!/接住率|懂了没|被接住|通了|还糊涂|跟上了/.test(svg), '图上不再出现"学生懂了没 / 接住率"类断言（假理论已清除）',
    (svg.match(/接住率|懂了没|被接住|通了|还糊涂|跟上了/g) || []).join(','));
  ok(/第2轮/.test(svg) && /第3轮/.test(svg), '横轴标出每一轮');
}
{
  // 最后一轮没机会回 → 空心柱 + "没人有机会回"（这是事实，不是"答得最短"）
  const series = [
    { round: 1, chars: 80, hasReply: true, mixLine: '反例 1' },
    { round: 2, chars: 60, hasReply: true, mixLine: '边界 1' },
    { round: 3, chars: 0, hasReply: false, mixLine: '' },
  ];
  const svg = rhythmChartSvg(series, { round: 2 });
  ok(/没人有机会回/.test(svg), '最后一轮画成空心 + "没人有机会回"（不假装它是答得最短）');
}
{
  // 任意中间轮没回（hasReply:false）也如实画空心，不漏 NaN
  const series = [
    { round: 1, chars: 70, hasReply: true, mixLine: '反例 1' },
    { round: 2, chars: 0, hasReply: false, mixLine: '' },
    { round: 3, chars: 90, hasReply: true, mixLine: '正例 1' },
  ];
  const svg = rhythmChartSvg(series, { round: 1 });
  ok(!dirty(svg), '中间轮没回时不漏 NaN', (svg.match(/NaN|undefined|null/g) || []).join(','));
  ok(/没人有机会回/.test(svg), '中间轮没回也标"没人有机会回"');
}
{
  // 少于两轮 → 不硬画，返回空串（交给文字叙事）
  const svg = rhythmChartSvg([{ round: 1, chars: 50, hasReply: true, mixLine: '' }], { round: 1 });
  ok(svg === '', '少于两轮不硬画（返回空串，交给文字叙事）');
}
{
  // 整课没回话（answered 为空）→ 不挂"最短"（没有可比较的回答）
  const series = [
    { round: 1, chars: 0, hasReply: false, mixLine: '' },
    { round: 2, chars: 0, hasReply: false, mixLine: '' },
  ];
  const svg = rhythmChartSvg(series, null);
  ok(svg === '' || !/最短/.test(svg), '整课没回话 → 不挂"最短"（没有可比较的回答）');
}

console.log('\n【2】复习时间轴 queueTimelineHtml');
{
  const now = Date.now();
  const q = [
    { concept: '阳光是能量来源', topic: '光合作用', dueAt: now + 1 * 86400000, overdue: false },
    { concept: '植物吃的是糖', topic: '光合作用', dueAt: now + 20 * 86400000, overdue: false },
    { concept: '三分法构图', topic: '手机摄影', dueAt: now - 3 * 86400000, overdue: true },
  ];
  const h = queueTimelineHtml(q, now);
  ok(!dirty(h), '没有 NaN/undefined 漏出', (h.match(/NaN|undefined|null/g) || []).join(','));
  ok(/1 天后/.test(h) && /20 天后/.test(h), '天数算对了');
  ok(/已到期 3 天/.test(h), '逾期单独标出（红字）');
  ok(/光合作用/.test(h) && /手机摄影/.test(h), '课题图例齐全');
  // 刻度锚在绝对天数（1 天…1 年），**不是**按本组最大值归一化：
  // 归一化的话，"这一课三张卡都是 3 天后"会被全画成 100% —— 长度就不携带任何量级信息了。
  const widths = [...h.matchAll(/width:(\d+)%/g)].map((m) => Number(m[1]));
  ok(widths.length === 3 && Math.max(...widths) <= 100 && new Set(widths).size === 3,
    '对数刻度让三条长度互不相同', JSON.stringify(widths));
  ok(widths[2] === Math.min(...widths), '逾期那条最短（最该现在复习的排最前）',
    '逾期 ' + widths[2] + '% vs 其他 ' + JSON.stringify(widths.slice(0, 2)));
  ok(/对数刻度/.test(h), '注明了用对数刻度（不然这张图看不懂）');
  ok((h.match(/tl-axis/g) || []).length >= 1 && /1年/.test(h), '带刻度尺（条长能翻译成天数，否则只是相对长短）');
  // 绝对刻度：同一间隔在任何一课/任何一组里都画成同样长度 → 跨课可比
  const wOf = (html) => Number((html.match(/width:(\d+)%/) || [0, 0])[1]);
  const wAlone = wOf(queueTimelineHtml([{ concept: 'A', topic: 'x', dueAt: now + 3 * 86400000 }], now));
  const wWithShort = wOf(queueTimelineHtml([
    { concept: 'A', topic: 'x', dueAt: now + 3 * 86400000 },
    { concept: 'B', topic: 'y', dueAt: now + 1 * 86400000 },
  ], now));
  ok(wAlone === wWithShort && wAlone > 0,
    '同一间隔在任何一组里都画成同一长度（绝对刻度，可跨课比较）',
    wAlone + '% vs ' + wWithShort + '%');
}
{
  const h = queueTimelineHtml([], Date.now());
  ok(!/NaN|undefined/.test(h) && /还没有排上复习的卡/.test(h), '完全没有卡时给人话，不是空表格');
}
{
  // 第一课刚上完：一张卡都还没到期。此时必须退而显示"接下来该复习的"，
  // 否则这张时间轴在第一课永远看不见（新卡都在几天后才到期）＝图白做。
  const now = Date.now();
  const up = [
    { concept: '阳光是能量来源', topic: '光合作用', dueAt: now + 3 * 86400000, overdue: false },
    { concept: '三分法构图', topic: '手机摄影', dueAt: now + 7 * 86400000, overdue: false },
  ];
  const h = queueTimelineHtml(up, now, { upcoming: true });
  ok(/今天没有到期的卡/.test(h) && /接下来该复习的/.test(h), '无到期卡时明确说明"下面是接下来该复习的"');
  ok((h.match(/tl-row/g) || []).length === 2, '无到期卡时时间轴仍然画出来（不是只剩一句话）',
    (h.match(/tl-row/g) || []).length + ' 条');
  const h2 = queueTimelineHtml(up, now, { upcoming: false });
  ok(!/今天没有到期的卡/.test(h2), '有到期卡时不挂"今天没有到期的卡"');
}
{
  const now = Date.now();
  const h = queueTimelineHtml([{ concept: 'X', dueAt: null, topic: null }], now);
  ok(!dirty(h), 'dueAt/topic 缺失时不漏 NaN', (h.match(/NaN|undefined|null/g) || []).join(',') || '干净');
}

console.log('\n【3】课前对照 preDiffHtml');
{
  const cons = { attempts: [{ index: 1, gist: '阳光是植物的饭', touched: ['阳光'] }, { index: 2, gist: '叶子黄是缺水' }] };
  const ev = { conceptCover: [{ concept: '阳光是能量来源', hit: 0.4 }, { concept: '植物吃的是糖', hit: 0 }] };
  const h = preDiffHtml(cons, ev);
  ok(!dirty(h), '没有 NaN/undefined 漏出', (h.match(/NaN|undefined|null/g) || []).join(','));
  ok(/你课前的那两次尝试/.test(h), '左栏=你的尝试（含"尝试"二字，测试依赖）');
  ok(/✓ 阳光是能量来源/.test(h) && /○ 植物吃的是糖/.test(h), '右栏 ✓/○ 区分碰到 / 缺口');
  ok(/class="hit"/.test(h) && /class="gap"/.test(h), '碰到 / 缺口有不同类名（可着色）');
  ok(/class="cchips"/.test(h), '右栏用标签排（比编号列表矮一半）');
  ok(/课前先摸到 1\/2 个/.test(h), '给出量化：摸到几个', (h.match(/课前先摸到[^<]*/) || [''])[0]);
  ok(/width:50%/.test(h), '缺口条按比例画（1/2 = 50%）');
}
{
  const h = preDiffHtml({ attempts: [] }, {});
  ok(!dirty(h), '空数据不漏 NaN', (h.match(/NaN|undefined|null/g) || []).join(',') || '干净');
}

console.log('\n' + (fail === 0 ? '✅ 全部通过' : '❌ 有失败') + '：' + pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
