// test_geometry.mjs — Γ / Φ / β / ⊕ 四条几何算子的回归
// 重点锁三件事：
//   ① β 的环权重算得对不对（birth 必须等于环上最大边权，紧密的环 birth 小）
//   ② ⊕ 是不是真的**不可交换**（这是自由幺半群区别于交换幺半群的唯一判据）
//   ③ 四条算子**都不产出评分**（A2 红线）
import { pathToFileURL } from 'url';
import path from 'path';
// 返回 tools/ 目录本体（不是文件本身）
function here() { return path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))); }
const g = await import(pathToFileURL(path.join(here(), '..', 'geometry.js')).href);

let pass = 0; const fails = [];
const ok = (cond, name, extra = '') => {
  if (cond) pass++; else fails.push(name + (extra ? `（${extra}）` : ''));
};
function section(t) { console.log('\n— ' + t + ' —'); }
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

// ============ Γ 信息散度 ============
section('Γ 信息散度：量距离，不判对错');
{
  const full = '植物用阳光作能量，把水和二氧化碳变成糖（储存能量）和氧气。';
  const same = g.divergence({ utterance: full, reference: full });
  ok(near(same.distance, 0), '原话复述 → 距离 0', 'distance=' + same.distance);
  ok(!('verdict' in same) && !('score' in same),
    'Γ 不产出 verdict/score（名字上就不许当评分用）');

  const partial = '植物用阳光作能量，把水和二氧化碳变成糖和氧气。';
  const d1 = g.divergence({ utterance: partial, reference: full });
  ok(d1.distance > 0 && d1.distance < LN2BOUND(), '少一个插入语 → 距离为正但不爆炸',
    'distance=' + d1.distance);
  ok(Array.isArray(d1.missingPhrases), '缺的是**短语列表**，不是 n-gram 碎片');
  ok(d1.missingPhrases.every((s) => s.length >= 4),
    '报出来的每一条都够长（少于 4 字的是挑刺不是照见）', JSON.stringify(d1.missingPhrases));

  const unrelated = g.divergence({ utterance: '我昨天去了一趟海边，风很大', reference: full });
  ok(unrelated.distance > d1.distance, '跑题的说法距离更大', `${unrelated.distance} > ${d1.distance}`);

  // 对称性：JS 散度必须对称，否则"你离它多远"跟谁比谁有关，就没法当距离用
  const A = '植物用阳光作能量';
  const B = '海水蒸发需要吸热';
  const f = g.divergence({ utterance: A, reference: B }).distance;
  const r = g.divergence({ utterance: B, reference: A }).distance;
  ok(near(f, r), 'JS 散度对称（KL 不对称，这是选 JS 而非 KL 的理由）', `${f} vs ${r}`);

  ok(g.divergence({ utterance: '', reference: '' }).distance === 0, '空输入不炸');

  // ★★ 锁住 2026-09-25 的自我纠错：
  //   "光合作用发生在叶绿体里，叶绿体是细胞里的一间小工厂。" —— 讲得很到位，
  //   但因为换了说法，跟整段教案用词几乎不重叠，散度 high。第一版据此判它"偏离"，
  //   跟 teaching.js 里被废弃的 overlapScore 是同一个坑（词面重合 ≠ 内容到位）。
  //   现在 Γ 只报字面事实：这里人确实提到了"光合作用/叶绿体"，不该再被当成缺口。
  const goodRewrite = '光合作用发生在叶绿体里，叶绿体是细胞里的一间小工厂。';
  const dg = g.divergence({ utterance: goodRewrite, reference: full });
  ok(!dg.missingPhrases.includes('光合作用'),
    '换了说法但讲到位 → 不该把它当"没提到"', JSON.stringify(dg.missingPhrases));
  ok(dg.distance > 0,
    '同时诚实承认：换说法的字面距离就是大（不假装它小，也不据此外判）', 'distance=' + dg.distance);

  // A2：Γ 的输出里不许出现任何评分词
  const SCORING = /(错|答对|讲得好|掌握|不及格|优秀|差劲|分数|得分|评级|水平)/;
  for (const [u, rr] of [[partial, full], ['我昨天去海边', full], ['好的', full]]) {
    const out = g.divergence({ utterance: u, reference: rr });
    ok(!SCORING.test(JSON.stringify(out.missingPhrases)), `Γ 输出不评分：${JSON.stringify(out.missingPhrases)}`);
  }
}

// ============ Φ 断链定位 ============
section('Φ 断链：找塌陷的那一段，给位置不给评价');
{
  const ref = '植物用阳光作能量，把水和二氧化碳变成糖，同时释放氧气。';
  // 前段照抄，后段忽然跳到完全无关的话题
  const u = '植物用阳光作能量，把水和二氧化碳变成糖。昨天周末我去了趟海边，风很大，还吃了烧烤。';
  const br = g.findBreak({ utterance: u, reference: ref });
  ok(br.onTarget === false, '后半段跑题 → 定位到塌陷', JSON.stringify(br));
  ok(br.breakAt > 0, '给出了断点位置', 'breakAt=' + br.breakAt);

  const straight = '植物用阳光作能量，把水和二氧化碳变成糖，同时释放氧气。';
  ok(g.findBreak({ utterance: straight, reference: ref }).onTarget === true,
    '通篇顺着讲 → 不报断点');
  ok(g.findBreak({ utterance: '好', reference: ref }).note.includes('太短'),
    '太短的输入不硬判');
}

// ============ β 持久同调 ============
section('β 同调：把你脑子里的"圈"照出来');
{
  // 紧密三角形：A-B / B-C 共享度 3，A-C 只共享 1（弱一点）
  const C1 = ['叶绿体', '类囊体', '光反应', '线粒体'];
  const sh = (a, b) => ({ a, b, shared: [0, 1, 2].includes(a) && [0, 1, 2].includes(b) ? (a === b ? 3 : 3) : 0 });
  const pairs = [
    { a: 0, b: 1, shared: 3 }, { a: 1, b: 2, shared: 3 }, { a: 0, b: 2, shared: 1 },
  ];
  const h = g.homology({ concepts: C1, pairs });
  ok(h.cycles.length === 1, '三角共现 → 恰好 1 个环', '实得 ' + h.cycles.length + ' 个');
  ok(h.cycles[0] && h.cycles[0].verts.join(',') === '0,1,2', '环由这三个点构成',
    JSON.stringify(h.cycles[0] && h.cycles[0].verts));
  // birth = 环上最大边权 = max(d(0,1)=0, d(1,2)=0, d(0,2)=2/3)
  ok(h.cycles[0] && near(h.cycles[0].birth, 2 / 3, 1e-3),
    'birth = 环上最大边权（弱边决定环有多紧）', 'birth=' + (h.cycles[0] && h.cycles[0].birth));

  // 紧密的环（三条边一样强）→ birth 必须更小
  const pairsTight = [
    { a: 0, b: 1, shared: 3 }, { a: 1, b: 2, shared: 3 }, { a: 0, b: 2, shared: 3 },
  ];
  const hTight = g.homology({ concepts: C1, pairs: pairsTight });
  ok(hTight.cycles.length === 1 && near(hTight.cycles[0].birth, 0, 1e-6),
    '三条边一样强 → birth=0（咬死的分不开）', 'birth=' + (hTight.cycles[0] && hTight.cycles[0].birth));
  ok(hTight.cycles[0].birth < h.cycles[0].birth, '紧环 birth < 松环 birth（同调能分出紧密程度）');

  // 孤立点不该产生环
  const hIso = g.homology({ concepts: C1, pairs: [{ a: 0, b: 1, shared: 3 }, { a: 2, b: 3, shared: 3 }] });
  ok(hIso.cycles.length === 0, '两条不相干的边不闭环（有 4 个点但没闭环）', '实得 ' + hIso.cycles.length);

  ok(g.homology({ concepts: ['a', 'b'], pairs: [] }).note.includes('不足'), '概念不足 3 个 → 明确拒答');
  ok(g.homology({ concepts: [], pairs: [] }).cycles.length === 0, '空输入不炸');

  // 确定性：同输入必须同输出（滤的全序排序保证）
  const h2 = g.homology({ concepts: C1, pairs });
  ok(JSON.stringify(h2) === JSON.stringify(h), '同输入同输出（可重放）');

  // A2：describeShape 不许评分
  const SCORING = /(错|答对|讲得好|掌握|不及格|优秀|差劲)/;
  const d = g.describeShape(h, C1);
  ok(d.hasCycle === true, 'describeShape 认出环');
  ok(!SCORING.test(d.line), '拓扑描述里没有评分词', d.line);
  ok(/绕成|圈|咬|缠|拆|落地/.test(d.line), '描述是给人读的话，不是数字', d.line);
  ok(g.describeShape({ cycles: [] }, C1).hasCycle === false, '无环时给摊开的描述');
}

// ============ β 的输入：概念共现 ============
section('共现统计：window 必须跨轮次，否则恒为 0');
{
  const cs = ['叶绿体', '类囊体', '光反应'];
  // 每句只提一个概念 —— 按单句统计共现必然全空（标定前就是这么写的，然后 β 永远不输出）
  const lines = [
    { round: 1, speaker: '老师', text: '光合作用发生在叶绿体里。' },
    { round: 2, speaker: '老师', text: '具体点：类囊体的薄膜吸收光能。' },
    { round: 3, speaker: '老师', text: '这一步叫光反应。' },
  ];
  const w0 = g.cooccurrence({ lines, concepts: cs, window: 0 });
  const w1 = g.cooccurrence({ lines, concepts: cs, window: 1 });
  ok(w0.length === 0, 'window=0（只算单句）→ 共现为空（这就是当初 β 白算的原因）',
    JSON.stringify(w0));
  ok(w1.length > 0, 'window=1（本条＋前一条）→ 共现出来了', JSON.stringify(w1));
  ok(w1.every((p) => p.shared >= 1), '共现次数 >= 1');

  const p2 = g.cooccurrence({ lines, concepts: cs, window: 2 });
  ok(p2.length >= w1.length, 'window 放宽 → 共对不会变少', `${w1.length} → ${p2.length}`);
  ok(g.cooccurrence({ lines: [], concepts: cs }).length === 0, '空实录不炸');
  ok(g.cooccurrence({ lines, concepts: ['不存在的词'] }).length === 0, '概念没被提到 → 无共现');
}

// ============ ⊕ 自由幺半群 ============
section('⊕ 轨迹：不可交换，顺序本身就是信息');
{
  const lines = [{ round: 1, speaker: '老师', text: '植物用阳光' }, { round: 2, speaker: '老师', text: '把水和二氧化碳变成糖' }];
  const t1 = g.trajectory(lines);
  ok(t1.length === 2 && t1.sequence[0].text.includes('阳光'), '严格保序（round 升序）');
  ok(t1.sequence[1].text.includes('二氧化碳'), '第二轮在后');
  ok(/^[0-9a-f]{8}$/.test(t1.fingerprint), '指纹是 8 位 hex', t1.fingerprint);

  // ★ 不可交换：同样两句话，先后颠倒 → 指纹必须不同。
  //   反过来若这条挂了，说明实现退化成了交换幺半群（按词频/去重统计，丢掉了顺序信息）。
  const sw = [
    { round: 1, speaker: '老师', text: '把水和二氧化碳变成糖' },
    { round: 2, speaker: '老师', text: '植物用阳光' },
  ];
  const t2 = g.trajectory(sw);
  ok(t2.fingerprint !== t1.fingerprint,
    '先说 A 再说 B ≠ 先说 B 再说 A（自由幺半群）',
    `${t1.fingerprint} vs ${t2.fingerprint}`);
  ok(t2.sequence[0].text === '把水和二氧化碳变成糖' && t2.sequence[1].text === '植物用阳光',
    '交换后 sequence 顺序真的变了（不是排序把它摆回去）');

  // 拼接歧义：分隔符必须让 "AB" 与 "A|B" 撞不上
  const x = g.trajectory([{ round: 1, text: 'AB' }]).fingerprint;
  const y = g.trajectory([{ round: 1, text: 'A' }, { round: 2, text: 'B' }]).fingerprint;
  ok(x !== y, '词间分隔符挡住了拼接歧义（"AB" ≠ "A|B"）', `${x} vs ${y}`);

  ok(g.trajectory([]).length === 0, '空轨迹不炸');
  ok(g.trajectory([{ round: 3, text: 'c' }, { round: 1, text: 'a' }]).sequence[0].text === 'a',
    '乱序输入按 round 归位');
  ok(g.trajectory([{ round: 1, text: '' }]).length === 0, '空文本不入轨迹（A3 不留空行）');
}

// ============ 汇总 ============
function LN2BOUND() { return Math.log(2) + 1e-9; }
console.log('\n' + '='.repeat(52));
if (fails.length) {
  console.log(`✗ ${pass} 通过 / ${fails.length} 失败`);
  for (const f of fails) console.log('  ✗ ' + f);
  process.exit(1);
} else {
  console.log(`✅ ${pass} 通过 / 0 失败`);
}

// 引用检查（防 tree-shaking 误伤，放在最后以免 TDZ）
void g.divergence; void g.findBreak; void g.homology; void g.trajectory; void g.describeShape;
