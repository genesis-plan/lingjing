// 验 summary.mjs：①合成课断言结构与数学界 ②跑真实 teacher.js 产出入总结
import { runClassroom } from '../teacher.js';
import { buildSummary, summaryToMarkdown } from '../public/summary.mjs';

let fail = 0;
const ok = (c, m) => { if (!c) { fail++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

// ---------- ① 合成课 ----------
const concepts = ['植物用阳光作能量', '把水和二氧化碳变成糖', '叶子发黄多半是缺光或水多'];
const ev = {
  lessonTitle: '光合作用',
  lessonText: '植物用阳光作能量。因为阳光被叶绿体吸收，所以这能量被转成化学能，把水和二氧化碳变成糖，并放出氧气。因此，叶子发黄，多半是缺光或水太多。总之，先看光，再看水。',
  concepts, difficulties: [0.38, 0.55, 0.44],
  // ⚠️ 2026-09-11：finalP / avgR / conceptCaught 全部已废（源头是学生自评或 2-gram 噪声判定）。
  //   现在只给真实计数：抛了几枚探测、哪几枚收到了你的回答。判定权交回人类。
  teachingEdges: 5, artifacts: 14,
  rounds: [{ round: 1 }, { round: 2 }, { round: 3 }],
  probes: [
    { round: 1, name: '小明', type: 'counter', say: '那要是反过来呢' },
    { round: 1, name: '小红', type: 'bound', say: '什么情况下不成立' },
    { round: 2, name: '小刚', type: 'example', say: '我家里那件事算不算' },
  ],
  gains: {
    points: 4, replies: 3, clarifying: 2,
    probes: 3, probeLine: '反例 1 · 边界 1 · 正例 1', answered: 0, open: 3,
  },
};
console.log('== ① 合成课 ==');
const s = buildSummary(ev, { heatEnergy: 1.6, heatRef: 4 });
ok(s.graph.nodes === 3, `图节点 = 概念数 (${s.graph.nodes})`);
ok(Array.isArray(s.graph.edges) && s.graph.maxDepth >= 1, `依赖图有边且深度≥1 (edges=${s.graph.edgeCount}, depth=${s.graph.maxDepth})`);
ok(!s.graph.hasCycle, '依赖图无环（DAG）');
ok(s.proof.premises.length > 0, `证明骨架有前提 (${s.proof.premises.length})`);
ok(s.proof.inferences.length > 0, `证明骨架有推理 (${s.proof.inferences.length})`);
ok(s.probes.total === 3 && s.probes.answered === 0 && s.probes.open === 3, '探测计数 total/answered/open 正确（纯计数，非判定）');
ok(s.theory.every((t) => !/BKT|知识状态矩阵|E\(t\) 与 σ²/.test(t.math)), '数学地图里不再有"给 AI 建模"的分支（BKT/P 矩阵/E-σ²）');
ok(!('mastery' in s) && !('conceptEnt' in s) && !('kl' in s), 'summary 不再含 mastery/conceptEnt/kl（假理论已清）');
ok(Array.isArray(s.pairs) && Array.isArray(s.openQ), 'pairs / openQ 是逐条并列的原话（他问的/你答的；你没回的）');
ok(s.theory.length >= 8, `数学地图覆盖分支数 ≥8 (${s.theory.length})`);
ok(['experience', 'game', 'practice', 'theory'].every((k) => s.senses[k].value >= 0 && s.senses[k].value <= 1), '四感都在 [0,1]');
ok(s.flow.trajectory.length === 3, 'Flow 轨迹按轮次');
ok(s.reviewAt.every((t) => t > 0), '复习时刻为正');
const md = summaryToMarkdown(s);
ok(md.includes('## 一、你的四感') && md.includes('## 六、本课用到的数学'), 'Markdown 含四感与数学地图');
ok(md.includes('## 二、学生问的 / 你答的（逐条并排，答到没有你自己判）'), 'Markdown 第二节＝他问的/你答的逐条并排（由人自己判）');
ok(!/学生达成|掌握度|BKT/.test(md), '总结里不再出现"学生达成/掌握度/BKT"（假理论已清）');

// ---------- ② 真实 teacher.js ----------
console.log('\n== ② 真实 teacher.js（无 key → 兜底）==');
const r = await runClassroom(
  { title: '手机摄影', content: '优先用自然光。因为逆光时人脸会黑，所以要让脸转向光源。构图先找线条，再用三分法把主体放在交点上。总之，别用数码变焦，走近一点。' },
  { maxRounds: 3, onLog: () => {} }
);
const s2 = buildSummary(r, { heatEnergy: 1.2, heatRef: 4 });
ok(s2.graph.nodes === r.concepts.length, `真实产出 → 图节点 = 概念数 (${s2.graph.nodes})`);
ok(s2.theory.length >= 8, `真实产出 → 数学地图 ${s2.theory.length} 项`);
ok(typeof s2.senses.theory.value === 'number', `真实 理论感 = ${s2.senses.theory.value}`);
console.log('真实 K 四感：体验 ' + s2.senses.experience.value + ' / 游戏 ' + s2.senses.game.value +
  ' / 实践 ' + s2.senses.practice.value + ' / 理论 ' + s2.senses.theory.value);
console.log('真实 clarifyRatio=' + s2.clarifyRatio + ' flow.gap=' + s2.flow.gap + ' probes.total=' + s2.probes.total);

// 清理落盘会话文件
try {
  const fs = await import('fs'); const path = await import('path');
  const dir = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'sessions');
  if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir)) if (f.includes('手机摄影')) fs.unlinkSync(path.join(dir, f));
} catch {}

console.log(fail ? `\n❌ ${fail} 项失败` : '\n✅ 全部断言通过');
process.exit(fail ? 1 : 0);
