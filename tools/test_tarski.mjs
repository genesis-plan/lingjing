// tools/test_tarski.mjs — Knaster–Tarski / Kleene 不动点 测试（确定性，无 LLM 依赖）
import { kleeneIterate, reachFixpoint, chainStability, tarskiNote, setEq } from '../tarski.js';
import { makeModel } from '../mapmodel.js';

let passed = 0, failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ ' + name); }
}

// ── ① Kleene 迭代本身 ──
const k1 = kleeneIterate((x) => Math.min(x + 1, 5), 0);
check('① Kleene：单调递增到 5 停住', k1.lfp === 5 && k1.stable === true);
check('① Kleene：迭代次数 = 6（0→1→…→5，第6步不再变）', k1.iterations === 6);
check('① Kleene：链上无回缩（extensive）', k1.extensive === true);

const k2 = kleeneIterate(() => new Set(), new Set(['a', 'b']));
check('① Kleene：非扩张映射被检出（extensive=false）', k2.extensive === false);
check('① Kleene：默认判等认得 Set，不会撞 maxIter（真缺陷回归）', k2.stable === true && k2.iterations === 2);

const k3 = kleeneIterate((x) => x + 1, 0, { maxIter: 3 });
check('① Kleene：无不动点时按 maxIter 停下并标 stable=false', k3.stable === false && k3.iterations === 3);

check('① 工具：setEq 判等', setEq(new Set(['a', 'b']), new Set(['b', 'a'])) === true);
check('① 工具：setEq 判不等', setEq(new Set(['a']), new Set(['a', 'b'])) === false);

// ── ② 可达闭包 = 传播算子的最小不动点 ──
const CONCEPTS = ['关系', '映射', '函数', '单射', '满射', '双射', '定义域', '值域'];
const MAPS = [
  { from: '函数', to: '映射', label: '属于' },
  { from: '映射', to: '关系', label: '属于' },
  { from: '单射', to: '映射', label: '是' },
  { from: '满射', to: '映射', label: '是' },
  { from: '双射', to: '单射', label: '是' },
  { from: '双射', to: '满射', label: '是' },
  { from: '定义域', to: '函数', label: '属于' },
  { from: '值域', to: '函数', label: '属于' },
];
const G = { concepts: CONCEPTS, maps: MAPS };

const r1 = reachFixpoint(G, '双射');
check('② 不动点：从双射出发走到 5 个概念', r1.closure.length === 5);
check('② 不动点：迭代次数不超过理论上界', r1.iterations <= r1.bound);
check('② 不动点：上界 = |C| - |seed| + 1 = 8', r1.bound === 8);
check('② 不动点：标注单调性由构造保证（非抽样）', r1.monotone === 'byConstruction');
check('② 不动点：稳定', r1.stable === true);

// 交叉验证：与 mapmodel.reach 的结果必须一致（实据，不靠嘴说）
const m = makeModel();
for (const c of CONCEPTS) m.addConcept(c);
for (const e of MAPS) m.addMap(e.from, e.to, e.label);
const mm = m.reach('双射').allReached.slice().sort();
check('② 交叉验证：与 mapmodel.reach 结果一致',
  JSON.stringify(mm) === JSON.stringify(r1.closure));
check('② 交叉验证：全图任意起点都与 mapmodel 一致',
  CONCEPTS.every((c) => JSON.stringify(m.reach(c).allReached.slice().sort()) ===
                        JSON.stringify(reachFixpoint(G, c).closure)));

// ── ③ 环（空转）也应有不动点 ──
const CYC = { concepts: ['映射', '函数', '关系'], maps: [
  { from: '映射', to: '函数', label: '包含' },
  { from: '函数', to: '关系', label: '属于' },
  { from: '关系', to: '映射', label: '包含' },
] };
const r2 = reachFixpoint(CYC, '映射');
check('③ 环：三元环闭合，闭包 = 全部 3 个', r2.closure.length === 3);
check('③ 环：仍在有限步内停住（不死循环）', r2.stable === true && r2.iterations <= r2.bound);

// ── ④ 诚实拒绝 ──
check('④ 边界：空图 → ok=false', reachFixpoint({ concepts: [], maps: [] }, 'a').ok === false);
check('④ 边界：起点不在图里 → ok=false', reachFixpoint(G, '不存在的概念').ok === false);
check('④ 边界：拒绝时给的是人话不是空串',
  reachFixpoint(G, '不存在').line.includes('诚实'));

// ── ⑤ 讲授链的稳定性上界 ──
const U = ['关系', '映射', '函数', '单射', '满射', '双射', '定义域', '值域'];
const c1 = chainStability([['关系', '映射'], ['关系', '映射', '函数'], ['关系', '映射', '函数', '单射']], U);
check('⑤ 链：识别为单调扩张', c1.monotone === 'increasing');
check('⑤ 链：剩余上界 = |U| - 当前 = 8 - 4 = 4', c1.remainingBound === 4);
check('⑤ 链：给了"最多再 N 轮"的保证', c1.line.includes('最多再 4 轮'));

const c2 = chainStability([['关系', '映射', '函数'], ['关系', '映射'], ['关系']], U);
check('⑤ 链：识别为单调收缩', c2.monotone === 'decreasing');
check('⑤ 链：收缩给出上界', typeof c2.remainingBound === 'number');

const c3 = chainStability([['关系', '映射'], ['映射', '函数'], ['关系', '映射']], U);
check('⑤ 链：非单调 → 诚实给不出上界', c3.monotone === 'none' && c3.remainingBound === null);
check('⑤ 链：非单调时文案承认给不出', c3.line.includes('给不出'));

const c4 = chainStability([['关系', '映射'], ['关系', '映射']], U);
check('⑤ 链：相邻两轮相同 → 已是不动点', c4.stable === true);

check('⑤ 链：单轮不给结论', chainStability([['关系']], U).monotone === 'none');

// ── ⑥ 红线：不评分（守 A2）──
const allText = [r1.line, r1.note, r2.line, c1.line, c2.line, c3.line, tarskiNote(G)].join('\n');
check('⑥ 红线：输出不含任何评分/掌握度词汇', !/掌握|学会|得分|评分|正确率|熟练/.test(allText));

console.log(`\n  tarski: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
