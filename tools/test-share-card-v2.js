'use strict';
// 课后的整理卡 v3 冒烟测试（本地桩环境）。
// 断言对准产品不变量：A1 原文引用、A2 零评分词、A4 诚实降级、
// v3 新增：知识本体上卡、问答对上卡、数学过程不外露、全文不截断。
const assert = require('assert');
const sc = require('../share-card.js');

const result = {
  mineRounds: [
    '复利就是利息再产生利息，比如存银行。',
    '我觉得复利的关键其实是复利的本金要一直留在里面，不能中断。',
    '单利和贴现我还没想清楚。',
  ],
  probes: [
    { say: '「时间价值」你提到了，但没再往下讲——它卡在哪一步？', type: 'why', round: 3 },
    { say: '「复利的反例」——亏本中断之后还叫复利吗？', type: 'counterexample', round: 3 },
  ],
  concepts: ['复利', '单利', '贴现', '时间价值'],
  uncovered: ['贴现率'],
};
// 带有问有答数据 + 超长追问（测截断修复）
const resultQA = {
  mineRounds: [
    '复利就是利息再产生利息，比如存银行。',
    '阳光不是植物的饭，它只是能量的来源，真正的饭是糖，植物自己用光把水和二氧化碳做成糖。',
  ],
  probes: [
    { say: '那没有光的时候植物吃什么？它晚上是不是就不活了？这一点我一直很好奇到底是怎么回事。', type: 'why', round: 2 },
    { say: '叶子发黄是缺肥吗？', type: 'counterexample', round: 2, answer: '多半不是缺肥，是缺光或者水太多，叶子先黄的是下面那几片。' },
  ],
  concepts: ['植物真正吃的是自己用光和水造出来的糖', '叶子发黄，多半不是缺肥，而是缺光或水太多'],
  uncovered: ['光呼吸'],
};
const OPTS = { lessonTitle: '如何给团队讲清楚复利', result, date: '2026-09-30' };

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log('  ✓ ' + name); pass++; }
  catch (e) { console.log('  ✗ ' + name + ' :: ' + e.message); fail++; }
}

console.log('课后的整理卡 v3 冒烟');

// A1 金句：确定性挑原文
t('A1 pickQuote 选中的是用户原话的逐字子串', () => {
  const q = sc.pickQuote(result.mineRounds);
  assert(q, '应挑出金句');
  const all = result.mineRounds.join('\n');
  assert(all.includes(q.text.replace(/。$/, '')), '金句必须逐字来自原话: ' + q.text);
});
t('A1 pickQuote 确定性（同输入同输出）', () => {
  const a = sc.pickQuote(result.mineRounds);
  assert.deepStrictEqual(a, sc.pickQuote([...result.mineRounds]), '重复调用必须一致');
});
t('A1 含评分词的原话不被选用（A2 优先于 A1）', () => {
  const q = sc.pickQuote(['我的得分是最高的那一种复利思维模式的典型代表呀。']);
  assert.strictEqual(q, null, '含评分词/超长句应被过滤');
});
t('A4 挑不出金句返回 null（不编造）', () => {
  assert.strictEqual(sc.pickQuote(['太短']), null);
});

// A2 防火墙
t('A2 hasBanned 命中评分词', () => {
  assert.strictEqual(sc.hasBanned('你的得分是90'), '得分');
  assert.strictEqual(sc.hasBanned('正确率100%'), '正确率');
});
t('A2 hasBanned 不误伤「不打分」自述', () => {
  assert.strictEqual(sc.hasBanned('不打分的那面镜子'), null);
});
t('A2 两张卡输出均通过评分词防火墙（生成即校验，无异常即过）', () => {
  const a = sc.shareCardSvg(OPTS);
  const b = sc.blindCardSvg(OPTS);
  assert(a.includes('<svg') && b.includes('<svg'));
});
t('A2 防火墙 fail-closed：注入评分词必须抛错', () => {
  assert.throws(() => sc.shareCardSvg({
    lessonTitle: '这一课得分排名', result: { mineRounds: ['正常一句话讲完复利的本金逻辑'], probes: [], concepts: [], uncovered: [] },
  }), /\[A2\]/);
});

// ── v3 核心：知识本体上卡 ──
t('v3 要点逐条上卡（concepts 原文出现在卡面）', () => {
  const svg = sc.shareCardSvg(OPTS);
  assert(svg.includes('这一课，你讲明白了'), '应有知识区块');
  assert(svg.includes('>复利<') && svg.includes('>单利<'), '要点原文应逐条上卡');
});
t('v3 有问有答：镜子的问题与你的原话回答都上卡', () => {
  const svg = sc.shareCardSvg({ ...OPTS, result: resultQA });
  assert(svg.includes('有问有答'), '应有问答区块');
  assert(svg.includes('叶子发黄是缺肥吗？'), '问题原文上卡');
  assert(svg.includes('多半不是缺肥，是缺光或者水太多'), '回答原话逐字上卡');
  assert(svg.includes('你的原话'), '应标注原话出处');
});
t('v3 数学过程不外露（无判据/走势/两轮说法的差）', () => {
  const svg = sc.shareCardSvg(OPTS);
  assert(!svg.includes('判据'), '内部判据不得出现在卡面');
  assert(!svg.includes('走势'), '内部走势图不得出现在卡面');
  assert(!svg.includes('两轮之间'), '内部对比措辞不得出现在卡面');
  assert(!svg.includes('unknown'), '内部状态值不得出现在卡面');
});
t('v3 带走的问题全文呈现不截断', () => {
  const svg = sc.shareCardSvg({ ...OPTS, result: resultQA });
  const tail = '这一点我一直很好奇到底是怎么回事。';
  // SVG 换行会把长句拆进多个 <text>，拼接全部可见文字后再断言连续性
  const texts = (svg.match(/<text[^>]*>([^<]*)<\/text>/g) || [])
    .map((x) => x.replace(/<[^>]+>/g, '')).join('');
  assert(texts.includes(tail), '超长追问的结尾必须完整出现在卡上（跨行拼接后连续）');
});
t('v3 计数压缩为一行（数字仍是计数）', () => {
  const svg = sc.shareCardSvg(OPTS);
  assert(svg.includes('3 轮讲授'), '轮数计数应出现');
  assert(svg.includes('2 问'), '问题计数应出现');
});
t('v3 卡高动态：内容多的卡更高', () => {
  const short = sc.shareCardSvg({ ...OPTS, result: { mineRounds: [], probes: [], concepts: [], uncovered: [] } });
  const long = sc.shareCardSvg({ ...OPTS, result: resultQA });
  const hOf = (s) => Number(s.match(/viewBox="0 0 840 (\d+)"/)[1]);
  assert(hOf(long) > hOf(short), '内容多的卡必须更高');
});
t('v3 clampLines 截断补省略号（不再无声切半）', () => {
  const lines = sc.clampLines('一'.repeat(100), 30, 2);
  assert.strictEqual(lines.length, 2);
  assert(lines[1].endsWith('……'), '被截的行要以……结尾');
});

// 结构与数据流（承 v2）
t('单课卡包含「你说过的那句话」区块且引用原话', () => {
  const svg = sc.shareCardSvg(OPTS);
  assert(svg.includes('你说过的那句话'));
  assert(svg.includes('你的原话'), '应标注原话出处');
});
t('盲区卡包含松端/未讲完/未答到的观测条目', () => {
  const svg = sc.blindCardSvg(OPTS);
  assert(svg.includes('这次照见'));
  assert(svg.includes('没再往下讲') || svg.includes('没把它们放在一起讲过'));
});
t('A4 盲区卡空数据诚实留白不编造', () => {
  const svg = sc.blindCardSvg({ lessonTitle: '空课', result: { mineRounds: [], probes: [], concepts: [], uncovered: [] } });
  assert(svg.includes('够不上'), '应输出诚实空态');
  assert(!svg.includes('①'), '空态不得出现编造条目');
});
t('主题参数：violet 与 ink 都能出图且不同', () => {
  const a = sc.shareCardSvg({ ...OPTS, theme: 'ink' });
  const b = sc.shareCardSvg({ ...OPTS, theme: 'violet' });
  assert(a.includes('#4f46e5') && b.includes('#6d5ce8'));
});
t('renderShareCardsHtml 一次渲染两张卡', () => {
  const html = sc.renderShareCardsHtml(OPTS);
  const n = (html.match(/<div class="card">/g) || []).length;
  assert.strictEqual(n, 2, '应含两个卡片容器，实际 ' + n);
});
t('向后兼容：renderShareCardHtml 仍返回单卡 HTML', () => {
  const html = sc.renderShareCardHtml(OPTS);
  assert((html.match(/<div class="card">/g) || []).length === 1);
});

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
