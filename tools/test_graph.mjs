// G 图论盲区网单元测试：buildWeakGraph（度中心性 → 主要矛盾；连通分量 → 盲区聚类）
import { buildWeakGraph } from '../graph.js';

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; } else { fail++; console.log('  ✗ ' + name); } }

const concepts = ['引力', '自转', '公转', '潮汐'];

// 单课：薄弱点 {0,1,2} 同段漏 → 两两连边；学生甲跨 0、3 探测连边
const one = buildWeakGraph([{
  concepts,
  weakPoints: [
    { conceptIdx: 0 }, { conceptIdx: 1 }, { conceptIdx: 2 },
  ],
  probes: [
    { ci: 0, name: '小明', type: 'bound' },
    { ci: 3, name: '小明', type: 'mechanism' }, // 同一学生跨概念 → 0-3 连边
  ],
}]);

ok('节点数 = 概念数', one.nodes.length === 4);
// 0 被 weakPoints + 跨概念探测双重钉到 → 度最高 = 主要矛盾
const deg0 = one.nodes.find((x) => x.idx === 0).degree;
ok('概念0 度中心性最高（主要矛盾）', one.mainHubs[0] === '引力' && deg0 >= 2);
ok('边真实生成', one.edges.length >= 4);

// 孤立概念不进聚类
ok('连通分量识别（0-1-2-3 连通）', one.clusters.length === 1 && one.clusters[0].length === 4);

// 两群不相连 → 两个聚类
const two = buildWeakGraph([{
  concepts: ['A', 'B', 'C', 'D'],
  weakPoints: [{ conceptIdx: 0 }, { conceptIdx: 1 }],   // 群1：A-B
  probes: [{ ci: 2, name: 'x', type: 'bound' }, { ci: 3, name: 'y', type: 'bound' }], // 群2：C-D 各自孤立
}]);
// C、D 各自只有单枚单概念探测，不互相连 → 不形成 >1 的聚类；A-B 连成一群
ok('A-B 连成盲区聚类', two.clusters.some((cl) => cl.includes('A') && cl.includes('B')));

// 跨课合并：同概念索引在不同课被钉 → 度累加
const cross = buildWeakGraph([
  { concepts, weakPoints: [{ conceptIdx: 0 }], probes: [] },
  { concepts, weakPoints: [{ conceptIdx: 0 }, { conceptIdx: 1 }], probes: [] },
]);
ok('跨课命中累加（概念0 被钉 2 次）', cross.nodes.find((x) => x.idx === 0).hits === 2);
ok('跨课后主要矛盾仍是被钉最狠的', cross.mainHubs[0] === '引力');

console.log(`\ntest_graph: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
