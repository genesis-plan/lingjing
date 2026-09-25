// tools/test_mapbridge.mjs — 大模型↔零权重模型 桥接测试（确定性，无真 key 也可跑）
import { extractMaps, buildModelFromTeaching, fallbackExtract, parseTriples } from '../mapbridge.js';

let passed = 0, failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ ' + name); }
}

// 1) parseTriples：从夹带解释文字的响应里抠出 JSON 数组
const fake = '好的，这是结果：[{"from":"映射","to":"函数","label":"是"},{"from":"函数","to":"关系","label":"是"}] 以上。';
const parsed = parseTriples(fake);
check('parseTriples 从杂讯响应里抽出 2 条三元组', parsed && parsed.length === 2 && parsed[0].from === '映射');
check('parseTriples 过滤掉缺字段的坏元素', parseTriples('[{"from":"A"}]') === null || parseTriples('[{"from":"A"}]').length === 0);

// 2) fallbackExtract：词面共现抽取（无 key 场景）
const gloss = ['映射', '函数', '关系', '单射', '满射', '双射'];
const text = '映射是函数的特例。函数是关系的一种。单射是一种映射，满射是一种映射。双射同时要求单射和满射。';
const fb = fallbackExtract(text, gloss);
check('fallback 抽到映射→函数（是）', fb.some((m) => m.from === '映射' && m.to === '函数' && m.label === '是'));
check('fallback 抽到函数→关系（是）', fb.some((m) => m.from === '函数' && m.to === '关系' && m.label === '是'));
check('fallback 抽到单射→映射 / 满射→映射', fb.some((m) => m.from === '单射' && m.to === '映射') && fb.some((m) => m.from === '满射' && m.to === '映射'));

// 3) 端到端（无 key → 走回退）：能建模型、能诊断盲区
const mb = await buildModelFromTeaching(text, { concepts: gloss });
check('端到端：建出模型且地图非空', mb.maps.length > 0);
check('端到端：无 key 时 usedLLM=false', mb.usedLLM === false);
// 回退是有向抽取：映射→函数→关系，故"关系"无出射 = 真正的断头路（盲区）
check('端到端：诊断出断头路（关系 无出射）', mb.blindSpots.deadEnds.includes('关系'));

// 4) LLM 路径：注入假 llmApi（不碰真实只读命名空间），验证 usedLLM=true 且解析 JSON
const fakeApi = {
  llmUsable: () => true,
  orChat: async () => '[{"from":"映射","to":"函数","label":"是"},{"from":"函数","to":"关系","label":"是"}]',
};
const r2 = await extractMaps('映射是函数的特例，函数是关系的一种。', { concepts: gloss, llmApi: fakeApi });
check('LLM 路径：usedLLM=true', r2.usedLLM === true);
check('LLM 路径：解析出大模型给的 2 条映射', r2.maps.length === 2 && r2.maps[0].to === '函数');

// 5) 红线：桥不产出"掌握度/学会了"判定（盲区报告无评分词）
check('红线：盲区诊断不含评分词', !/掌握|学会|得分|评分/.test(JSON.stringify(mb.blindSpots)));

console.log(`\nmapbridge: ${passed} passed / ${failed} failed`);
process.exit(failed ? 1 : 0);
