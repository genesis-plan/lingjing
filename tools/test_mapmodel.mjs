// tools/test_mapmodel.mjs — 无权重关系推理引擎 PoC 测试（确定性，无 LLM 依赖）
import { makeModel } from '../mapmodel.js';

let passed = 0, failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ ' + name); }
}

// 场景：人类讲授"映射"概念网（全是映射，没有任何权重/训练）
const m = makeModel();
m.addMap('映射', '函数', '是特例');
m.addMap('函数', '关系', '是特殊');
m.addMap('关系', '映射', '广义');          // 环：映射→函数→关系→映射（空转）
m.addMap('单射', '映射', '是一种');
m.addMap('满射', '映射', '是一种');
m.addMap('双射', '单射', '要求');           // 双射 → 单射
m.addMap('双射', '满射', '要求');
m.addMap('映射', '原像', '对应');           // 原像：只当终点、无出射 = 真断头路（盲区）

// 1) 前向传播（复合映射应用）：从"映射"走到底，应到达"关系"
const r = m.reach('映射');
check('reach(映射) 包含落点 关系', r.terminals.some((t) => t.concept === '关系'));
check('reach(映射) 沿途经过 函数', r.allReached.includes('函数'));

// 2) 命名复合链：映射 --是特例--> 函数 --是特殊--> 关系
check('compose 链 映射→函数→关系', m.compose('映射', ['是特例', '是特殊']) === '关系');
check('compose 链断了返回 null（不编造）', m.compose('映射', ['是特例', '不存在的映射']) === null);

// 3) 盲区诊断：环检测到 映射-函数-关系
const bs = m.blindSpots();
const hasCycle = bs.cycles.some((cyc) => cyc.includes('映射') && cyc.includes('函数') && cyc.includes('关系'));
check('盲区：检测到 映射→函数→关系 环（空转）', hasCycle);

// 4) 盲区诊断：断头路（只当终点、无出射）—— 原像被提到但没再延伸
check('盲区：原像是断头路（deadEnd）', bs.deadEnds.includes('原像'));

// 5) 诚实：模型没有任何数值权重参数（概念与映射都是字符串/结构，无浮点参数表）
const dumped = JSON.stringify(m.maps());
check('模型无权重：映射表里不含数值参数', !/\b\d+\.\d+\b/.test(dumped) && !/weight|param/.test(dumped));

// 6) 红线：诊断镜不产出任何"掌握度/学会了"的判定
check('红线：盲区报告不含评分词', !/掌握|学会|得分|评分/.test(JSON.stringify(bs)));

console.log(`\nmapmodel: ${passed} passed / ${failed} failed`);
process.exit(failed ? 1 : 0);
