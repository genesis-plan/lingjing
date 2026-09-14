// preclass.mjs 单测：生产性失败引擎
// 重点不是"函数不报错"，而是**每一档判定都真的能被触发**——
//   放行闸门如果永远判 ready，就等于没有闸门；永远判 no-prior，就等于产品不可用。
// 零依赖，直接 node 跑。
import { buildPreTest, evaluateExploration, consolidationNotes, preTestToMarkdown, explorationToMarkdown } from '../public/preclass.mjs';

let fails = 0;
const ok = (c, m, extra = '') => { console.log((c ? '  ✅ ' : '  ❌ ') + m + (extra ? '   ' + extra : '')); if (!c) fails++; };

const TOPIC = '光合作用';
const LESSON = '阳光不是植物的「饭」，它只是能量的来源。植物真正吃的是自己用光和水造出来的糖。叶子发黄，多半不是缺肥，而是缺光或水太多。';
const CONCEPTS = [
  '阳光不是植物的饭，它只是能量的来源',
  '植物真正吃的是自己用光和水造出来的糖',
  '叶子发黄多半不是缺肥，而是缺光或水太多',
];

// 两次不同角度的真尝试（合格）
const A1 = '我觉得阳光对植物来说应该是能量的来源，不是养分。因为植物要靠光能来制造糖，如果没有阳光，植物就没有能量，所以就长不大。这是我确定的部分。';
const A2 = '我猜叶子发黄是因为缺水，水少了就没办法造糖，糖不够叶子就黄了。也可能是光照不够，因为叶子需要用光来做这件事。我是从浇花的经验想到的。';
// 复制粘贴式假探索
const B2 = '我觉得阳光对植物来说应该是能量的来源，不是养分。因为植物要靠光能来制造糖，如果没有阳光，植物就没有能量，所以就长不大。这是我确定的部分。';
// 与课题无关的尝试（有先验，但不针对这个课题）
const C1 = '我觉得这个可能要分情况讨论，先看条件是什么，然后再决定怎么做才合适。';
const C2 = '我猜是跟数量有关系，数量多了结果就变，少了就不变。我是按常识推的。';

console.log('【1】课前探针生成');
const pre = buildPreTest(TOPIC, LESSON, CONCEPTS);
ok(pre.probes.length === 3, '造出 3 个探针', 'probes=' + pre.probes.length);
ok(pre.minAttempts === 2, '硬规则 minAttempts=2（Kapur 的设计条件）');
ok(new Set(pre.probes.map((p) => p.kind)).size >= 2, '探针不止一种形态（反事实/边界/机制/迁移）',
  pre.probes.map((p) => p.kind).join(','));
ok(pre.probes.every((p) => p.ask.includes('「') && p.ask.length > 12), '每个探针都是可回答的问题，不是名词');
ok(pre.rules.length >= 3, '规则清单 ≥3 条');
ok(/不打分|不是测验/.test(pre.rules.join('')), '明确说了不打分（低风险是生产性失败的前提）');
console.log('    探针示例: ' + pre.probes[0].ask);

console.log('\n【2】放行闸门：每一档都要能被触发');
const cases = [
  { name: '没尝试',        attempts: [],                   want: 'no-attempt' },
  { name: '只写"不知道"',   attempts: [{ text: '不知道' }],  want: 'not-genuine' },
  { name: '只有一次尝试',   attempts: [{ text: A1 }],        want: 'one-attempt' },
  { name: '复制粘贴式假探索', attempts: [{ text: A1 }, { text: B2 }], want: 'shallow' },
  { name: '答得离题（无关）', attempts: [{ text: C1 }, { text: C2 }], want: 'no-prior' },
  { name: '两次不同角度',   attempts: [{ text: A1 }, { text: A2 }], want: 'ready' },
];
const got = {};
for (const c of cases) {
  const ev = evaluateExploration(TOPIC, CONCEPTS, c.attempts, { lessonText: LESSON });
  got[c.name] = ev;
  ok(ev.verdict === c.want, `「${c.name}」→ ${c.want}`,
    `实际=${ev.verdict} · 真实=${ev.genuineCount} 激活=${ev.activation} 多样=${ev.diversity} 缺口=${ev.gapAwareness}`);
}
ok(got['两次不同角度'].ready === true && got['只有一次尝试'].ready === false, 'ready 标志与判定一致');

console.log('\n【3】数学量合理（不是恒等于 0 的摆设）');
const good = got['两次不同角度'];
ok(good.activation > 0 && good.activation <= 1, '先验激活度 ∈ (0,1]', String(good.activation));
ok(good.diversity > got['复制粘贴式假探索'].diversity, '真换角度的多样性 > 复制粘贴的多样性',
  `${good.diversity} > ${got['复制粘贴式假探索'].diversity}`);
ok(good.gapAwareness > 0 && good.gapAwareness <= 1, '缺口意识 ∈ (0,1]（不是恒为 0 的摆设）', String(good.gapAwareness));
ok(good.gapAwareness !== got['答得离题（无关）'].gapAwareness, '缺口意识有区分度（合格 vs 离题 取值不同）',
  `${good.gapAwareness} vs ${got['答得离题（无关）'].gapAwareness}`);
ok(good.klAttention >= 0, 'KL(注意力‖重点) ≥ 0（散度非负）', String(good.klAttention));
ok(good.diversity <= 1 && good.maxDiversity <= 1, 'Jaccard 距离 ≤ 1');
ok(Array.isArray(good.conceptCover) && good.conceptCover.length === CONCEPTS.length, '逐概念的命中覆盖表齐全');
ok(good.fourA && ['activate', 'awareness', 'affect', 'assembly'].every((k) => k in good.fourA), '4A 机制四要素都在（activate/awareness/affect/assembly）');
ok(good.fourA.assembly === 0, 'assembly 留 0 —— 由课后总结填（讲解有没有接住尝试）');
ok(/缺口|角度|去讲/.test(good.advice), '放行时给的是行动指令，不是分数');

console.log('\n【4】不过度苛刻：换了说法也能被认出来');
const paraphrase = evaluateExploration(TOPIC, CONCEPTS, [
  { text: '植物应该是拿光当能量用的吧，不是吃土里那些东西。它自己会做糖，我猜是靠光和水做出来的。' },
  { text: '叶子变黄我感觉是浇的水不对，水太多或者太少都会黄，肥反而没那么重要。' },
], { lessonText: LESSON });
ok(paraphrase.verdict === 'ready', '用自己的话（不照抄概念原词）也能通过', '实际=' + paraphrase.verdict + ' 激活=' + paraphrase.activation);

console.log('\n【5】对接触 + Markdown');
const cons = consolidationNotes(pre, good, [{ text: A1 }, { text: A2 }]);
ok(cons.attempts.length === 2, '两次尝试都被保留下来供课后对照');
ok(cons.attempts[0].gist.length <= 48, '摘要被压短（不会撑破版面）', String(cons.attempts[0].gist.length));
ok(/对照/.test(cons.instruction) && /不构成对错评判/.test(cons.honest), '对接触写明"只回顾、不评判"');
const md1 = preTestToMarkdown(pre);
const md2 = explorationToMarkdown(good);
ok(md1.includes(TOPIC) && md1.length > 200, '课前 Markdown 成文', md1.length + ' 字');
ok(md2.includes('缺口意识') && md2.includes('多样性'), '评估 Markdown 带数学量说明');

console.log('\n' + (fails ? fails + ' 项未通过 ❌' : '全部通过 ✅'));
process.exit(fails ? 1 : 0);
