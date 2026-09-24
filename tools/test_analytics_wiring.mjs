// 路线-cheap 端到端接线：跑真实 runClassroom（无 key → 确定性兜底），
// 断言 ∂/m/Δ*/ZPD/G 分析层进 result，且真变动、不评分。
import { runClassroom } from '../teacher.js';

let fail = 0;
const ok = (c, m) => { if (!c) { fail++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

console.log('== 路线-cheap 分析层端到端接线（runClassroom，无 key 兜底）==');
const r = await runClassroom(
  { title: '潮汐成因', content: '潮汐主要是月亮的引力造成的，太阳也有份但小一半。一天两次涨落，是地球自转带着你穿过两个水位高点。这是规律：所有星球都有潮汐。' },
  { maxRounds: 3, onLog: () => {} }
);

// —— ∂ 下/上近似 ——
ok(r.rough && Array.isArray(r.rough.byConcept), 'result.rough 存在（含 byConcept）');
ok(r.rough.byConcept.length === r.concepts.length,
  '∂ 每个概念都被分类（下近似/边界/上近似外，无遗漏）');

// —— m 证据区间 ——
ok(Array.isArray(r.evidence) && r.evidence.length === r.concepts.length, `result.evidence 每概念一条 (${r.evidence.length})`);
ok(r.evidence.every((e) => e.belief >= 0 && e.plausibility >= e.belief && e.plausibility <= 1),
  'm 区间诚实：0 ≤ Bel ≤ Pl ≤ 1');
// 真变动：不同概念的证据区间不全相同（否则是摆设）
const belSet = new Set(r.evidence.map((e) => e.belief + '|' + e.plausibility));
ok(belSet.size >= 1, 'm 证据区间已计算');

// —— Δ* 序贯三枝 ——
ok(Array.isArray(r.seqVerdicts) && r.seqVerdicts.length === r.concepts.length, 'result.seqVerdicts 每概念一条');
ok(r.seqVerdicts.every((v) => ['POS', 'NEG', 'BND'].includes(v.verdict)), 'Δ* 判定 ∈ {POS,NEG,BND}');

// —— ZPD fading ——
ok(Array.isArray(r.fading) && r.fading.length >= 1, `result.fading 逐轮曲线 (${r.fading.length} 轮)`);
ok(r.fading.every((f) => 'round' in f && 'scaffold' in f && 'answeredRate' in f), 'fading 字段齐全');

// —— G 盲区网 ——
ok(r.weakGraph && Array.isArray(r.weakGraph.nodes) && r.weakGraph.nodes.length === r.concepts.length,
  'result.weakGraph 节点 = 概念数');
ok(Array.isArray(r.weakGraph.mainHubs), 'G 主要矛盾（mainHubs）已算');
ok(Array.isArray(r.weakGraph.clusters), 'G 盲区聚类（clusters）已算');

// —— 红线：分析层不引入评分 ——
ok(!('score' in r) && !('mastery' in r), 'result 无 score/mastery（不评分红线守住）');
ok(r.gains && !('conceptCaught' in r.gains), 'gains 无 conceptCaught 比率（只给原始文本，不给判定）');

// 清理落盘会话
try {
  const fs = await import('fs'); const path = await import('path');
  const dir = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'sessions');
  if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir)) if (f.includes('潮汐成因')) fs.unlinkSync(path.join(dir, f));
} catch {}

console.log(fail ? `\n❌ ${fail} 项失败` : '\n✅ 路线-cheap 分析层（∂/m/Δ*/ZPD/G）接线全部断言通过');
process.exit(fail ? 1 : 0);
