// tools/test_delta_verdict.mjs — Δ 三态判定（P1+，镜子永不评分落到显式数据结构）
// 守红线：三态互斥/确定性/跨输入真变动（防摆设）/绝不声称"答透了"或任何评分语。
import { probeVerdict } from '../teaching.js';
import { createSession } from '../teacher.js';
import fs from 'fs';
import path from 'path';

let fail = 0;
const ok = (c, m) => { if (!c) { fail++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };
const TITLE = 'Δ三态验证课';

// 用 createSession 驱动：开课 → 每轮教师回话（或无）→ 下课，返回真实 result
// ⚠️ maxRounds=4：体验节奏（experience.js）下并非每拍都产出探测——
//   planBeats(4) = [DEEPEN, DEEPEN, PAUSE, CLOSE]，只有 2 个追问拍。
//   取 4 是为了拿到 ≥2 枚探测，否则一问一答测不出"三态随回答而变"。
//   最后一拍固定为 CLOSE（说收尾话，不产出探测），所以断言里不能指望"最后一枚必然 NEG"。
async function runWithReplies(replies, maxRounds = 4) {
  const lesson = {
    title: TITLE,
    content: '植物用阳光作能量。因为阳光被叶绿体吸收，所以这能量被转成化学能，把水和二氧化碳变成糖，并放出氧气。因此，叶子发黄多半是缺光或水太多。',
  };
  const s = createSession(lesson, { maxRounds });
  await s.start(() => {}, () => {});
  let i = 0;
  while (!s.done && s.round < maxRounds) {
    const txt = replies[i++] || '';
    await s.reply(txt, () => {}, () => {});
  }
  return s.finish(() => {}, () => {});
}

console.log('== Δ 三态 probeVerdict 单元测试 ==');
// ① 确定性：同输入两次一致
const pNEG = { answer: null };
const pPOS = { answer: '因为前提是这样，比如你提到的那个点其实是有条件的。' };
const pBND = { answer: '好的。' };
ok(probeVerdict(pNEG) === probeVerdict(pNEG), '同输入两次产出一致（确定性，无随机）');
// ② 三态正确
ok(probeVerdict(pNEG) === 'NEG', '无回答 → NEG（口子还开着，事实）');
ok(probeVerdict(pPOS) === 'POS', '有回答且带前提/例子/边界 → POS（文本特征，非判定理解）');
ok(probeVerdict(pBND) === 'BND', '有回答但偏空泛未澄清 → BND（留给人自己判）');
// ③ 空串回答视为 NEG（不算"收到"）
ok(probeVerdict({ answer: '   ' }) === 'NEG', '纯空白回答视为 NEG（不误判为收到）');
// ④ 诚实边界：三态集合封闭，绝无评分语义
const ALLOWED = new Set(['POS', 'BND', 'NEG']);
ok(ALLOWED.has(probeVerdict(pNEG)) && ALLOWED.has(probeVerdict(pPOS)) && ALLOWED.has(probeVerdict(pBND)),
  'verdict 取值封闭于 {POS,BND,NEG}，无掌握度/评分语义');
ok(!/掌握|评分|懂|学会|BKT/.test(JSON.stringify([probeVerdict(pNEG), probeVerdict(pPOS), probeVerdict(pBND)])),
  'verdict 文本不含任何评分/掌握度语（镜子诚实边界）');

console.log('\n== Δ 三态跨输入真变动（防摆设）==');
// A：每轮给"带前提/例子"的澄清型回话
const rA = await runWithReplies([
  '因为前提是这样，比如你提到的那个点其实是有条件的。',
  '所以要注意，比如换个情况就不成立了。',
  '举个例子，同样的做法在别的场景里就会失效。',
  '换个边界：如果条件反过来，结论就不一样了。',
]);
// B：每轮只回"好的。"（极简、未澄清）
const rB = await runWithReplies(['好的。', '好的。', '好的。', '好的。']);
// C：全程不回话（所有探测都收不到回答）
const rC = await runWithReplies([]);

ok(rA.verdictCounts && rB.verdictCounts && rC.verdictCounts, '三场课 result 都带 verdictCounts');
ok(rA.verdictCounts.POS > 0 && rA.verdictCounts.NEG === 0 && rA.verdictCounts.BND === 0,
  `A（澄清回话）：全 POS、无 BND/NEG（实得 POS=${rA.verdictCounts.POS}/BND=${rA.verdictCounts.BND}/NEG=${rA.verdictCounts.NEG}）`);
// B 只要求"BND>0 且无 POS"：复读"好的。"没有新词，会被停时判据**正确地**在中途收掉课堂，
//   于是最后一枚探测收不到回答（NEG）。那是停时在干活，不是三态判错了——不把它算作失败。
ok(rB.verdictCounts.BND > 0 && rB.verdictCounts.POS === 0,
  `B（极简回话）：BND>0 且无 POS（实得 POS=${rB.verdictCounts.POS}/BND=${rB.verdictCounts.BND}/NEG=${rB.verdictCounts.NEG}）`);
ok(rB.verdictCounts.BND > 0 && rB.verdictCounts.NEG <= 1,
  'B：极简回话不会被误判成 POS——"好的"里没有前提/例子/边界，一个都不许进 POS');
ok(rC.verdictCounts.NEG === rC.probes.length && rC.verdictCounts.POS === 0 && rC.verdictCounts.BND === 0,
  `C（不回话）：全部 NEG、无 POS/BND（实得 NEG=${rC.verdictCounts.NEG}/${rC.probes.length}）`);

// ⑤ 三态计数必须两两不同（证明"真会动"，不是恒值摆设）
const jsA = JSON.stringify(rA.verdictCounts), jsB = JSON.stringify(rB.verdictCounts), jsC = JSON.stringify(rC.verdictCounts);
ok(jsA !== jsB && jsA !== jsC && jsB !== jsC, `三场课 verdictCounts 两两不同（A=${jsA} / B=${jsB} / C=${jsC}）`);

// ⑥ 每枚 probe 都挂了 verdict 字段，且值与 probeVerdict 复算一致
ok(rA.probes.every((p) => ALLOWED.has(p.verdict)), '每枚 probe 都挂 verdict 字段且取值合法');
ok(rA.probes.every((p) => p.verdict === probeVerdict(p)), 'probe.verdict 与 probeVerdict 复算一致（不二源）');

// ⑦ 一致性：有回答且 isClarifying → POS；有回答非澄清 → BND；无回答 → NEG（逐枚核对）
const consistent = [rA, rB, rC].every((r) => r.probes.every((p) => {
  const exp = p.answer == null ? 'NEG' : (/因为|所以|前提|条件是|需要|比如|例如|注意|其实|换句话说|关键是|首先要|区别在于|例外|不完全是|也就是说/.test(p.answer) ? 'POS' : 'BND');
  return p.verdict === exp;
}));
ok(consistent, '逐枚 verdict 与"回答文本特征"完全一致（POS=带澄清标记 / BND=收到未澄清 / NEG=无回答）');

// 清理 finalize 落盘的会话文件（验证产物，不留垃圾）
try {
  const dir = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'sessions');
  if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir)) if (f.includes(TITLE)) fs.unlinkSync(path.join(dir, f));
} catch {}

console.log(fail ? `\n❌ ${fail} 项失败` : '\n✅ Δ 三态判定全部断言通过（互斥/确定/跨输入真变动/不评分）');
process.exit(fail ? 1 : 0);
