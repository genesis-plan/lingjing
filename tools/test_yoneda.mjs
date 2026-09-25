// tools/test_yoneda.mjs — 米田剖面 / 不可区分分组 测试（确定性，无 LLM 依赖）
import { coReach, reachSet, profileOf, indistinguishable, separation, yonedaNote } from '../yoneda.js';
import { makeModel } from '../mapmodel.js';

let passed = 0, failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ ' + name); }
}

// 人类传授的一张映射图（刻意让 单射/满射、定义域/值域 结构同形）
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

// ── ① 入射闭包 Hom(-, A)：补上 mapmodel 没算的那半张脸 ──
const intoGuanxi = coReach(G, '关系');
check('① 入射闭包：所有概念最终都指向「关系」', intoGuanxi.length === 8);
check('① 入射闭包：含「双射」（双射→单射→映射→关系）', intoGuanxi.includes('双射'));
check('① 入射闭包：含「定义域」（定义域→函数→映射→关系）', intoGuanxi.includes('定义域'));
check('① 入射闭包：不在图里的概念诚实返回空', coReach(G, '不存在的概念').length === 0);

// ── ② 出射闭包（与 mapmodel 交叉验证，实据）──
const m = makeModel();
for (const c of CONCEPTS) m.addConcept(c);
for (const e of MAPS) m.addMap(e.from, e.to, e.label);
const mmReach = m.reach('双射').allReached.slice().sort();
const yReach = reachSet(G, '双射').slice().sort();
check('② 出射闭包：与 mapmodel.reach 完全一致（交叉验证）',
  JSON.stringify(mmReach) === JSON.stringify(yReach));
check('② 出射闭包：双射 走到 5 个概念（单射/满射/映射/关系/自身）', yReach.length === 5);

// ── ③ 关系剖面 ──
const pShuang = profileOf(G, '双射');
check('③ 剖面：双射 有两条出射（→单射、→满射）', pShuang.out.length === 2);
check('③ 剖面：双射 无入射', pShuang.in.length === 0);
check('③ 剖面：单射 有一条入射（来自双射）', profileOf(G, '单射').in.length === 1);
check('③ 剖面：不在图里 → ok=false 且不猜', profileOf(G, '空集').ok === false);
check('③ 剖面：approximate 恒为 true（不自称同构证明）', pShuang.approximate === true);

// ── ④ 不可区分分组（核心）──
const ind = indistinguishable(G);
// 注意：JS 默认 sort 按 UTF-16 码位（"值"U+503C < "定"U+5B9A），故断言不写死组内顺序
const flat = ind.groups.map((g) => g.slice().sort().join('/'));
const hasGroup = (a, b) => ind.groups.some((g) => g.includes(a) && g.includes(b) && g.length === 2);
check('④ 分组：识别出「单射/满射」结构同形', hasGroup('单射', '满射'));
check('④ 分组：识别出「定义域/值域」结构同形', hasGroup('定义域', '值域'));
check('④ 分组：恰好 2 组（不把 双射 误拉进来）', ind.groups.length === 2);
check('④ 分组：报告文案点名了这两组',
  ind.line.includes('单射') && ind.line.includes('满射') &&
  ind.line.includes('定义域') && ind.line.includes('值域'));

// 同形被打破后应消失：给 满射 单独加一条入射
const G2 = { concepts: CONCEPTS, maps: MAPS.concat([{ from: '函数', to: '满射', label: '要求' }]) };
const ind2 = indistinguishable(G2);
check('④ 分组：给满射加一条独有的入射后，它不再与单射同形',
  !ind2.groups.some((g) => g.includes('单射') && g.includes('满射')));

// ── ⑤ 分离证据 ──
const s1 = separation(G, '单射', '满射');
check('⑤ 分离：单射 vs 满射 分不开', s1.separates === false && s1.witness === null);
const s2 = separation(G, '定义域', '函数');
check('⑤ 分离：定义域 vs 函数 可分开', s2.separates === true);
check('⑤ 分离：给出了具体证据（出射）', s2.witness && s2.witness.kind === '出射');
const s3 = separation(G, '双射', '单射');
check('⑤ 分离：双射 vs 单射 可分开', s3.separates === true && !!s3.witness);
// 只用「入射」才分得开的一对：X 与 Y 出射完全相同，仅 X 多一条入射
const G3 = { concepts: ['X', 'Y', 'Z', 'W'], maps: [
  { from: 'X', to: 'Z', label: '是' },
  { from: 'Y', to: 'Z', label: '是' },
  { from: 'W', to: 'X', label: '是' },
] };
const s4 = separation(G3, 'X', 'Y');
check('⑤ 分离：出射相同、仅入射不同 → 判据落在入射', s4.separates === true && s4.witness.kind === '入射');
check('⑤ 分离：概念不在图里 → 诚实拒绝', separation(G, '甲', '乙').separates === false);

// ── ⑥ 空图 / 边界 ──
check('⑥ 边界：空图不炸、返回空分组', indistinguishable({ concepts: [], maps: [] }).groups.length === 0);
check('⑥ 边界：单概念图不炸', indistinguishable({ concepts: ['x'], maps: [] }).groups.length === 0);

// ── ⑦ 红线：不评分（守 A2）──
const allText = [ind.line, ind2.line, s1.line, s2.line, s3.line, yonedaNote(G)].join('\n');
check('⑦ 红线：输出不含任何评分/掌握度词汇', !/掌握|学会|得分|评分|正确率|熟练/.test(allText));

console.log(`\n  yoneda: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
