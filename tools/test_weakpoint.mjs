// 验 P0-1 确定性薄弱点定位层（docs/理论基座.md §四.4 要求）。
// 核心不变量：detectWeakPoints 只分析「人类文本」表达特征，不声称知道 AI 懂没懂；
// 且四信号（jargon/jump/abstract/parrot）在不同讲解风格下的取值必须「真不同」——防数学摆设。
import { detectWeakPoints, weakPointToProbeType } from '../teaching.js';

let fail = 0;
const ok = (c, m) => { if (!c) { fail++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

// 三类风格截然不同的讲解文本：
//  A = 术语密集型（甩名词不解释，应触发 jargon）
//  B = 逻辑跳步型（结论词前无前提词，应触发 jump）
//  C = 平实生活型（无术语/无跳步/无抽象，应几乎无信号）
const A_concepts = ['能量', '模型', '梯度'];
const A = '在热力学里，系统的演化遵循熵增定律和能量守恒定理。信息处理可以用贝叶斯模型来描述。'
  + '神经网络的本质是梯度函数优化问题。这种拓扑结构是群环域上的映射算子。';

const B_concepts = ['相机', '画面', '曝光'];
const B = '我们先把相机拿起来。因此画面更亮了。于是噪点也变少了。这说明参数调对了。可见曝光很重要。';

const C_concepts = ['公园', '孩子', '冰淇淋'];
const C = '今天我和孩子去公园玩。他追着一只蝴蝶跑了很久。回家路上买了冰淇淋。我们都挺开心的。';

//  D = 前提盲区型（把断言讲成定论却没给启用条件，应触发 omit）
const D_concepts = ['方法', '沟通', '团队'];
const D = '这个方法在所有情况下都适用。沟通一定是越早越好。团队里所有人肯定都认可这个方案。';

const sigMultiset = (list) => list.map((w) => `${w.signal}@${w.conceptIdx}`).sort().join(',');
const countSig = (list, s) => list.filter((w) => w.signal === s).length;

console.log('== P0-1 detectWeakPoints 跨场景取值真不同 ==');
const rA = detectWeakPoints(A, A_concepts);
const rB = detectWeakPoints(B, B_concepts);
const rC = detectWeakPoints(C, C_concepts);
const rD = detectWeakPoints(D, D_concepts);

// ① 术语密集型应触发 jargon，且比平实型多
ok(countSig(rA, 'jargon') >= 1, `术语型触发 jargon 信号 (${countSig(rA, 'jargon')} 枚)`);
ok(countSig(rC, 'jargon') === 0, `平实型无 jargon 信号（对照成立）`);

// ② 逻辑跳步型应触发 jump，且比平实型多
ok(countSig(rB, 'jump') >= 1, `跳步型触发 jump 信号 (${countSig(rB, 'jump')} 枚)`);
ok(countSig(rA, 'jump') === 0, `术语型无 jump 信号（对照成立，证明不是逢文都报）`);

// ③ 跨场景「真不同」：四者信号多重集两两不全相等（防摆设硬红线）
const mA = sigMultiset(rA), mB = sigMultiset(rB), mC = sigMultiset(rC), mD = sigMultiset(rD);
ok(mA !== mB, `术语型 vs 跳步型 信号分布不同 (A=${mA || '∅'} / B=${mB || '∅'})`);
ok(mA !== mC, `术语型 vs 平实型 信号分布不同 (A=${mA || '∅'} / C=${mC || '∅'})`);
ok(mB !== mC, `跳步型 vs 平实型 信号分布不同 (B=${mB || '∅'} / C=${mC || '∅'})`);
ok(mD !== mC, `前提盲区型 vs 平实型 信号分布不同 (D=${mD || '∅'} / C=${mC || '∅'})`);

// ④ 确定性：同输入必得同输出（可复现，无随机）
const rA2 = detectWeakPoints(A, A_concepts);
ok(JSON.stringify(rA) === JSON.stringify(rA2), '同输入复现一致（确定性，无随机）');

// ⑤ 严重度降序（jump=3 应排在 jargon=2 前）——每次调用内部各自有序
const sortedIn = (list) => list.every((w, i) => i === 0 || list[i - 1].severity >= w.severity);
ok(sortedIn(rA) && sortedIn(rB) && sortedIn(rC), '返回列表按严重度降序（jump 先于 jargon）');

// ⑥ 信号 → 探测类型映射（铁律 4 信号 → 7 策略 → 六探测）
ok(weakPointToProbeType('jargon') === 'example', 'jargon → example（正例钉"这词到底指什么"）');
ok(weakPointToProbeType('jump') === 'mechanism', 'jump → mechanism（机制钉"缺的中间环节"）');
ok(weakPointToProbeType('abstract') === 'counter', 'abstract → counter（反例钉"从具体到抽象"）');
ok(weakPointToProbeType('parrot') === 'apply', 'parrot → apply（应用钉"用自己的话讲一遍"）');
ok(weakPointToProbeType('omit') === 'bound', 'omit → bound（边界钉"什么情况不成立/你默认了什么前提"）');

// ⑧ 第 5 类信号：前提盲区在"定论却无启用条件"文本下触发，且平实型不误报
ok(countSig(rD, 'omit') >= 1, `前提盲区型触发 omit 信号 (${countSig(rD, 'omit')} 枚)`);
ok(countSig(rC, 'omit') === 0, `平实型无 omit 误报（对照成立，证明不是逢确定词就报）`);
ok(rD.some((w) => w.signal === 'omit' && w.severity === 3), 'omit 严重度=3（与 jump 同级，属最深的盲区机制）');

// ⑦ 诚实边界：evidence 是句子切片（人类原话），不含任何「AI 懂/不懂」断言
ok(rA.every((w) => typeof w.evidence === 'string' && w.evidence.length > 0), 'evidence 是人类原话切片（未编造 AI 理解状态）');

// ⑨ 高信心缺口优先：定论式断言缺前提 → 严重度 +1（上限 5）
const Dc_concepts = ['方法', '沟通'];
const Dc = '沟通一定是越早越好。这个方法在所有情况下都适用。';   // 含高信心标记 → omit 应 boost 到 4
const Ds_concepts = ['沟通'];
const Ds = '这个沟通方法当然都有效果。';                           // 含 WP_CERTAIN(当然) 触发 omit，但无 WP_ASSERT_CONF 强信心标记 → 严重度 3（>8 字满足触发长度）
const rDc = detectWeakPoints(Dc, Dc_concepts);
const rDs = detectWeakPoints(Ds, Ds_concepts);
ok(rDc.some((w) => w.signal === 'omit' && w.severity === 4), `高信心定论缺口 omit 严重度=4（boost 生效：${JSON.stringify(rDc.filter(w=>w.signal==='omit').map(w=>w.severity))}）`);
ok(rDs.some((w) => w.signal === 'omit' && w.severity === 3), `无高信心标记的同类 omit 严重度=3（对照成立，证明 +1 仅来自高信心）`);
ok((rDc.find((w) => w.signal === 'omit') || {}).severity > (rDs.find((w) => w.signal === 'omit') || {}).severity, '高信心缺口排在更前（调度优先钉，命中高信心缺口最高收益窗口）');

console.log(fail ? `\n❌ ${fail} 项失败` : '\n✅ P0-1 全部断言通过（跨场景真不同 + 确定性 + 映射 + 诚实边界 + 高信心缺口优先）');
process.exit(fail ? 1 : 0);
