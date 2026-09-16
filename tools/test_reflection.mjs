// tools/test_reflection.mjs — 双稿制确定性反思引擎验证
// 守红线：跨输入可复现、镜稿三块全"我"开头、零评价语、五类修改 reducer 正确、
// 人定稿三阶组装不替人编造、七步状态机在界、空输入不崩。
import reflection from '../public/reflection.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; } else { fail++; console.log('  ✗ ' + m); } };
const noEval = (s) => !/评分|打分|掌握度|得分|你讲得|你没讲清|你错了|不对|建议你|应该改|不及格|优秀|良好/.test(s);

// 构造一份 P0-2 aiNotes（与 teacher.js finalize 输出同构）
const aiNotes = [
  {
    name: '小明', mis: '递归就是函数叫一次自己',
    took: [{ round: 1, type: 'mechanism', q: '它是怎么发生', answer: '递归是函数调用自己' }],
    stuck: [{ round: 2, type: 'bound', q: '终止条件谁定' }],
    selfCheck: '我原来以为「递归就是函数叫一次自己」；先生讲完，我最想不通的是「终止条件是谁定的」',
  },
  { name: '小红', mis: '', took: [], stuck: [], selfCheck: '这课我没什么想不通的——但也可能只是我没敢问。' },
];

// ① 确定性：同输入两次 → students 结构一致（generatedAt 不比）
const a = reflection.buildMirrorDraft(aiNotes);
const b = reflection.buildMirrorDraft(aiNotes);
ok(JSON.stringify(a.students) === JSON.stringify(b.students), '同输入两次产出确定一致（students 结构不靠随机）');

// ② 三块齐全 + 全"我"开头 + 零评价语
ok(a.students.length === 2, '镜稿按学徒数生成（2 名）');
for (const s of a.students) {
  ok(['heard', 'confused', 'misread'].every((k) => Array.isArray(s.blocks[k])), s.name + ' 三块(heard/confused/misread)齐全');
  const allText = [...s.blocks.heard, ...s.blocks.confused, ...s.blocks.misread].map((x) => x.text);
  ok(allText.every((t) => t.startsWith('我')), s.name + ' 镜稿每条全「我」开头');
  ok(allText.every(noEval), s.name + ' 镜稿零评价/评分语');
}

// ③ 镜稿平铺可读（聚合）
const mt = reflection.mirrorToText(a);
ok(/我听到的核心内容/.test(mt) && /我还没完全明白的地方/.test(mt) && /我可能理解偏了的地方/.test(mt), 'mirrorToText 含锁死三块标题');
ok(noEval(mt), 'mirrorToText 整体零评价语');

// ④ 反射状态初始化
const st0 = reflection.initReflectionState(a);
ok(st0.edits.length === 0 && Object.keys(st0.itemStatus).length === 0, 'initReflectionState 空状态');

// ⑤ 五类修改 reducer
const e1 = reflection.applyEdit(st0, { kind: 'confirm', student: '小明', block: 'heard', index: 0 });
ok(e1.itemStatus['小明::heard::0'].status === 'confirm', '确认 → itemStatus 标 confirm');

const e2 = reflection.applyEdit(e1, { kind: 'rewrite', student: '小明', block: 'heard', index: 0, text: '递归是函数调用自己，不是「叫自己」。' });
ok(e2.itemStatus['小明::heard::0'].status === 'rewrite' && e2.itemStatus['小明::heard::0'].humanText.includes('不是'), '改写 → 存人写文本');

const e3 = reflection.applyEdit(e2, { kind: 'delete', student: '小明', block: 'confused', index: 0 });
ok(e3.itemStatus['小明::confused::0'].status === 'delete', '删除 → 标 delete');

const e4 = reflection.applyEdit(e3, { kind: 'add', student: '小明', block: 'heard', text: '这里我还想加一句：终止条件是写代码的人自己定的。' });
ok(e4.edits.some((x) => x.kind === 'add' && x.text.includes('终止条件')), '补充 → 追加到人写内容');

const e5 = reflection.applyEdit(e4, { kind: 'transform', student: '小明', block: 'confused', index: 0, text: '我忘了讲终止条件是谁定的，下次要补。', reserve: false });
ok(e5.edits.some((x) => x.kind === 'transform' && x.text.includes('下次要补')), '转化 → 记人反思文本（route=reflect）');

// ⑥ reducer 不可变：原 state 不被改
ok(st0.edits.length === 0 && !st0.itemStatus['小明::heard::0'], 'applyEdit 不改原 state（不可变）');

// ⑦ 未知动作抛错
let threw = false;
try { reflection.applyEdit(st0, { kind: '评分', student: '小明', block: 'heard', index: 0 }); } catch { threw = true; }
ok(threw, '未知修改动作抛错（守住动作集合）');

// ⑧ 人定稿三阶组装（不替人编造）
const finalDraft = reflection.buildFinalDraft(e5, {
  fact: '我讲的核心是：递归是函数调用自己，必须有终止条件。',
  reflect: '我忘了讲终止条件是写代码的人自己定的。',
  action: '下次先讲栈，再讲递归，最后讲终止条件。',
  reserve: '',
});
ok(finalDraft.fact.includes('终止条件') && finalDraft.reflect.includes('忘了讲') && finalDraft.action.includes('栈'), 'buildFinalDraft 组装事实/反思/行动三阶');
ok(finalDraft.label === reflection.FINAL_LABEL, '终稿 label = 人类终审版·照镜札记');

// ⑨ 修改痕迹计数正确
ok(finalDraft.trace.confirmed.length === 1 && finalDraft.trace.rewritten.length === 1
  && finalDraft.trace.deleted.length === 1 && finalDraft.trace.transformed.length === 1 && finalDraft.trace.added.length === 1,
  'trace 五类计数各 1（确认/改写/删除/转化/补充）');

// ⑩ 转化 route=reserve → 进保留段（允许保留困惑）
const eR = reflection.applyEdit(st0, { kind: 'transform', student: '小明', block: 'confused', index: 0, text: '栈溢出到底是什么画面，我还是没想清楚。', reserve: true });
const finalR = reflection.buildFinalDraft(eR, { fact: 'f', reflect: 'r', action: 'a', reserve: '' });
ok(finalR.reserve.includes('栈溢出') && finalR.trace.transformed[0].to === 'reserve', '转化(reserve=true) → 进「保留」段，不丢困惑');

// ⑪ 转化 route=reflect（默认）→ 不进保留
const eN = reflection.applyEdit(st0, { kind: 'transform', student: '小明', block: 'confused', index: 0, text: '我忘了讲终止条件。', reserve: false });
const finalN = reflection.buildFinalDraft(eN, { fact: 'f', reflect: '', action: 'a', reserve: '' });
ok(finalN.reserve === '' && finalN.trace.transformed[0].to === 'reflect', '转化(reserve=false) → 不进保留，归反思');

// ⑫ 七步状态机在界
ok(reflection.stepCount() === 7, '七步流程共 7 步');
ok(reflection.stepLabel(0) === 'AI 生成镜稿', '第 1 步 = AI 生成镜稿');
ok(reflection.stepLabel(6) === '下次传授前回看（可积累认知轨迹）', '末步 = 回看');
ok(reflection.nextStep(0) === 1 && reflection.nextStep(6) === null, 'nextStep 在界（首→1，末→null）');

// ⑬ 照镜札记 Markdown 含四段
const rm = reflection.reflectionToMarkdown(finalDraft);
ok(/一、事实/.test(rm) && /二、反思/.test(rm) && /三、行动/.test(rm) && /四、保留/.test(rm), 'reflectionToMarkdown 含照镜札记四段');
ok(/修改痕迹/.test(rm), 'reflectionToMarkdown 含修改痕迹');

// ⑭ 空输入不崩
const empty = reflection.buildMirrorDraft([]);
ok(empty.students.length === 0 && empty.label === reflection.MIRROR_LABEL, '空 aiNotes → 空 students 不崩');
const emptySt = reflection.initReflectionState(empty);
const emptyFinal = reflection.buildFinalDraft(emptySt, {});
ok(emptyFinal.fact === '' && emptyFinal.reflect === '' && emptyFinal.action === '' && emptyFinal.reserve === '', '空输入定稿全空（绝不替人编造文字）');

// ⑮ 无 took/stuck 的学徒：heard/confused 空，misread 落 selfCheck
const lonely = reflection.buildMirrorDraft([{ name: '独', mis: '', took: [], stuck: [], selfCheck: '这课我没什么想不通的——但也可能只是我没敢问。' }]);
ok(lonely.students[0].blocks.heard.length === 0 && lonely.students[0].blocks.confused.length === 0
  && lonely.students[0].blocks.misread.length === 1 && lonely.students[0].blocks.misread[0].text.startsWith('我')
  && lonely.students[0].blocks.misread[0].text.includes('没什么想不通'),
  '无 took/stuck 的学徒：heard/confused 空，misread 归一化为「我」开头落自我点检');

// ⑯ id 确定性
ok(reflection.buildMirrorDraft(aiNotes).students[0].blocks.heard[0].id === '小明::heard::0', '镜稿条目 id 确定性（name::block::i）');

// ---- 第二批书单方法论（LJ-GMR 增强层）----

// ⑰ 引导式设问：基于镜稿三块出可操作反思问题（非陈述、非评价）
const gp = reflection.buildGuidedPrompts(a);
ok(gp.length > 0, 'buildGuidedPrompts 基于镜稿生成了引导问题');
ok(gp.length === a.students.reduce((n, s) => n
  + s.blocks.heard.length + s.blocks.confused.length + s.blocks.misread.length, 0),
  '引导设问数 = 镜稿条目总数（逐条出问）');
ok(gp.every((p) => p.text.includes('？')), '引导设问每句都是问句（非陈述）');
ok(gp.every(noEval), '引导设问零评价语（守住只提问不评判）');

// ⑱ 元认知自检锚点 4 条 + 复盘四步锚点 4 条
const mc = reflection.buildMetacogPrompts();
ok(mc.length === 4 && mc.every((x) => x.question.endsWith('？')), '元认知自检锚点 4 条，皆问句');
const rv = reflection.buildReviewPrompts();
ok(rv.length === 4 && rv.map((x) => x.key).join(',') === 'goal,result,cause,pattern',
  '复盘四步锚点 = 目标/结果/原因/规律');

// ⑲ 跨课成长轨迹累积（保留=盲区、行动=意图；纯函数不可变）
const traj0 = reflection.accumulateTrajectory(null, finalDraft);
ok(traj0.entries.length === 1 && traj0.actionCount >= 1, '首课轨迹：1 条 entry，行动已计');
const traj1 = reflection.accumulateTrajectory(traj0, finalR);
ok(traj1.entries.length === 2, '次课轨迹累积到 2 条 entry（不丢前课）');
ok(traj1.blindSpotCount >= traj0.blindSpotCount, '盲区计数随课单调不减');
ok(traj0.entries.length === 1, 'accumulateTrajectory 不改原轨迹（纯函数不可变）');

// ⑳ 空镜稿 → 引导设问为空不崩
const gpEmpty = reflection.buildGuidedPrompts(empty);
ok(gpEmpty.length === 0, '空镜稿 → 引导设问为空（不崩）');

console.log(`\n反思引擎测试：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
