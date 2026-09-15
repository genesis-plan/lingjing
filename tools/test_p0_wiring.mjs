// 验 P0-1 / P0-2 端到端接线：跑真实 runClassroom（无 key → 确定性兜底），
// 断言 weakPoints / weakPointHits / aiNotes 进 result，且「人判定」不变量守住（无 score / 无掌握度）。
import { runClassroom } from '../teacher.js';
import { buildSummary, summaryToMarkdown } from '../public/summary.mjs';

let fail = 0;
const ok = (c, m) => { if (!c) { fail++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

console.log('== P0-1/P0-2 端到端接线（runClassroom，无 key 兜底）==');
const r = await runClassroom(
  { title: '光合作用', content: '植物用阳光作能量。因为阳光被叶绿体吸收，所以这能量被转成化学能，把水和二氧化碳变成糖，并放出氧气。因此，叶子发黄，多半是缺光或水太多。总之，先看光，再看水。' },
  { maxRounds: 4, onLog: () => {} }
);

// —— P0-1 落 result ——
ok(Array.isArray(r.weakPoints), 'result.weakPoints 存在（数组）');
ok(r.weakPoints.length > 0, `本课的讲解检出薄弱点 (${r.weakPoints.length} 枚)`);
ok(typeof r.weakPointHits === 'number' && r.weakPointHits >= 1, `探针钉死薄弱点数 weakPointHits = ${r.weakPointHits}（事实计数）`);
ok(r.weakPointHits === r.weakPoints.length, `每个薄弱点都被一枚探测钉过一次（weakPointHits === weakPoints.length，无杜撰）`);
ok(r.weakPoints.every((w) => ['jargon', 'jump', 'abstract', 'parrot'].includes(w.signal)), 'weakPoints 信号均属四类定义信号');

// —— P0-2 落 result ——
ok(Array.isArray(r.aiNotes) && r.aiNotes.length === r.students.length, `result.aiNotes 每生一条镜子 (${r.aiNotes.length}/${r.students.length})`);
ok(r.aiNotes.every((n) => 'name' in n && 'mis' in n && 'took' in n && 'stuck' in n && 'selfCheck' in n && 'note' in n), 'aiNotes 字段齐全（旧想法/记下/没搞清/自我点检）');
ok(r.aiNotes.every((n) => !/(掌握|懂了|学会|BKT|掌握度|已理解)/.test(n.note + n.selfCheck)), 'aiNotes 不声称 AI 懂了、不评分（镜子诚实边界）');

// —— 人判定不变量：result 与总结里均无 score / mastery ——
ok(!('score' in r) && !('mastery' in r) && !('conceptCaught' in r), 'result 无 score/mastery/conceptCaught（人判定，机器不替人打分）');
const s = buildSummary(r, { heatEnergy: 1.6, heatRef: 4 });
ok(Array.isArray(s.aiNotes) && s.aiNotes.length === r.aiNotes.length, 'buildSummary 直接采用 ev.aiNotes（主路径，无二次编造）');
const md = summaryToMarkdown(s);
ok(md.includes('## 三、AI 理解笔记'), 'Markdown 含「## 三、AI 理解笔记（镜子，含它没搞懂的）」');
ok(!/(学生达成|掌握度|BKT|分数)/.test(md), '总结全文无「学生达成/掌握度/BKT/分数」等评分语');

// 清理 runClassroom 落盘的会话文件
try {
  const fs = await import('fs'); const path = await import('path');
  const dir = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'sessions');
  if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir)) if (f.includes('光合作用')) fs.unlinkSync(path.join(dir, f));
} catch {}

console.log(fail ? `\n❌ ${fail} 项失败` : '\n✅ P0-1/P0-2 接线全部断言通过（探针钉准薄弱点 + 镜子不评分 + 人判定不变量守住）');
process.exit(fail ? 1 : 0);
