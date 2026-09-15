// tools/test_questioning.mjs — TCMQ 提问引擎确定性验证
// 守红线：跨输入可复现、镜面锚定含原话、姿态零评判、六层在界、双轨模板就位、无评分语。
import { buildQuestionSpec, renderWpHint, mirrorAnchor, inferResponseMode, calibrateLevel, PROGRESSION, TRACK_A, TRACK_B, STANCE } from '../questioning.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; } else { fail++; console.log('  ✗ ' + m); } };
const noScore = (s) => !/评分|打分|掌握度|得分|BKT/.test(s);  // hint 中"你讲得真棒"只是禁止示例，不算评分语

// ① 确定性：同输入两次 → spec 关键字段一致（不靠随机）
const wp = { concept: '光合作用', probeType: 'mechanism', signalLabel: '逻辑跳了一步', evidence: '因为阳光被吸收所以能量转换', conceptIdx: 0 };
const a = buildQuestionSpec({ target: '光合作用', probeType: 'mechanism', weakPoint: wp, humanLastUtterance: '因为阳光被叶绿体吸收，所以能量被转成了化学能。', responseMode: 'fluent', round: 2 });
const b = buildQuestionSpec({ target: '光合作用', probeType: 'mechanism', weakPoint: wp, humanLastUtterance: '因为阳光被叶绿体吸收，所以能量被转成了化学能。', responseMode: 'fluent', round: 2 });
ok(a.stance === b.stance && a.progressionLevel === b.progressionLevel && a.mirroredQuote === b.mirroredQuote, '同输入两次产出确定一致（不靠随机）');

// ② 镜面锚定：mirroredQuote 必须来自人类原话
ok(a.anchorRequired && a.mirroredQuote.length > 0, '锚定开启且截得原话片段');
ok('因为阳光被叶绿体吸收，所以能量被转成了化学能。'.includes(a.mirroredQuote), 'mirroredQuote 确为人类原话子串');

// ③ 镜面渲染：wpHint 含"引用先生原话"且含该片段
const hint = renderWpHint(a);
ok(/引用先生刚说的原话/.test(hint) && hint.includes(a.mirroredQuote), 'renderWpHint 含镜面锚定指令与原话');

// ④ 姿态零评判：stance 来自困惑/好奇库，且 hint 显式禁评判/禁空泛赞美
const allStance = [...STANCE.confused, ...STANCE.curious];
ok(allStance.includes(a.stance), 'stance 取自谦逊探询困惑/好奇库');
ok(/不要评判|不要纠错|不要说/.test(hint) && /空泛赞美/.test(hint), 'hint 显式禁评判/纠错/空泛赞美');
ok(noScore(a.stance) && noScore(hint), 'stance 与 hint 无任何评分语');

// ⑤ 六层递进在界 + 响应模式校准
ok(a.progressionLevel >= 1 && a.progressionLevel <= 6, '递进层在 1..6');
ok(a.progressionLevel === PROGRESSION.cause.level + 1, 'fluent 模式下由 cause(3) 升一档到 ' + a.progressionLevel);
const stuck = buildQuestionSpec({ target: 'X', probeType: 'mechanism', humanLastUtterance: '嗯。', responseMode: 'stuck' });
ok(stuck.progressionLevel === 2, 'stuck 模式由 cause(3) 降一档到 2');
ok(calibrateLevel('clarify', 'stuck') === 'clarify', 'clarify 已是底层，stuck 不再降（不越界）');
ok(calibrateLevel('metacog', 'fluent') === 'metacog', 'metacog 已是顶层，fluent 不再升（不越界）');

// ⑥ 探测类型 → 基础层映射正确
const map = { distinct: 1, example: 2, mechanism: 3, bound: 4, counter: 5, apply: 4 };
for (const [k, lv] of Object.entries(map)) {
  const s = buildQuestionSpec({ target: 't', probeType: k, humanLastUtterance: '这是一段足够长的人类讲述内容用来测试推断模式。' });
  ok(s.progressionLevel === lv, `probeType=${k} → 基础层 ${lv}（实得 ${s.progressionLevel}）`);
}

// ⑦ 双轨模板就位（B 轨供 ③ 路线未来接线）
ok(Object.keys(TRACK_A).length >= 4, 'A 轨显性模板 ≥4');
ok(Object.keys(TRACK_B).length === 6, 'B 轨隐性萃取六模板齐全');
ok(Object.values(TRACK_B).every((t) => /\{q\}/.test(t)), 'B 轨模板含原话占位符 {q}');

// ⑧ 响应模式推断确定性
ok(inferResponseMode('短') === 'stuck' && inferResponseMode('这是一段足够长且具体的人类讲述内容用来覆盖 fluent 分支的测试文本，它必须足够长才能越过六十个字符的阈值从而被判定为流畅回答模式避免被误判。') === 'fluent' && inferResponseMode('这是一次中等长度的回答内容用来验证 partial 分支。') === 'partial', 'inferResponseMode 三档确定性正确');

// ⑨ 无薄弱点时 spec 仍可构建（轮转兜底路径也走引擎）
const rot = buildQuestionSpec({ target: '概念乙', probeType: 'example', humanLastUtterance: '先生讲完课了。' });
ok(rot && rot.probeType === 'example' && rot.track === 'A', '轮转兜底路径也能产出确定性 spec');

// ⑩ 陌生学徒姿态（透明错觉 Keysar）：hint 显式要求零背景、不脑补上下文
ok(/零背景的陌生学生/.test(hint) && /不要替先生脑补/.test(hint), 'renderWpHint 含陌生学徒姿态（不脑补用户上下文）');

// ⑪ 解释不辩护护栏（IOED / Fernbach）：hint 要求请解释机制、禁为立场辩护
ok(/只请先生讲/.test(hint) && /不要请他为某个立场/.test(hint), 'renderWpHint 含解释不辩护护栏（请解释机制，禁辩护立场）');

console.log(`\n提问引擎测试：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
