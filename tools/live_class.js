// tools/live_class.js — 真人分步课堂驱动（任意课题，教案即输入，零硬编码）
// 架构立场（回应"人类所有知识难道都要写进代码吗"）：**不写**。
//   代码只装引擎——Λ/Σ/Φ/β/EIG 等算子对任何课题通用（它们只看文本事实，不看课题）；
//   知识是**输入**（A1：人是外部输入，教案本来就是人喂的）——你学什么、粘什么，镜子照什么。
//   人类所有知识从输入口流动注入，代码零改动。写死任何教案都是把"引擎"误当"知识库"。
// 用法：
//   node tools/live_class.js "标题::教案内容"                    → 开课，打印第 1 轮镜子提问
//   node tools/live_class.js "标题::教案内容" "回答1" "回答2" …  → 重放已给回答，打印下一轮提问
//   回答数到上限（5 轮）或触发停时 → 自动下课，落盘《课堂纪要》《我的收获》/world.json
// 重放原理：no-key 状态下探测走本地兜底语料（确定性），同一串回答 ⇒ 同一串探测，
//   因此每轮用新进程重建会话等价于连续上课。
// ⚠️ 重放要求**教案字节级一致**（探测靶由教案文本决定）——长教案务必用 --file，
//   命令行手打会漂移，一漂重放就错轮。
const fs = require('fs');
const { createSession } = require('../teacher.js');

const noop = () => {};

function usage() {
  console.log([
    '用法：node tools/live_class.js --file lessons/映射.txt ["回答1" "回答2" …]',
    '  或：node tools/live_class.js "标题::教案内容" ["回答1" "回答2" …]（短教案适用）',
    '',
    '  · 教案 = 你自学那一小节的原文或你的笔记——学什么开什么课，不改代码。',
    '  · 回答 = 你前几轮对镜子提问的原话，按顺序用空格隔开（还没答过就不填）。',
    '  · 到 5 轮上限或触发停时 → 自动下课，落盘《课堂纪要》《我的收获》。',
    '  · 重放时教案必须与上一轮完全一致 → 长教案用 --file，别在命令行手打。',
  ].join('\n'));
  process.exit(1);
}

function fmtProbe(p) {
  if (!p) return '（本轮没有探测——停时已触发）';
  return `【第${p.round}轮·镜子提问·类型 ${p.type}】\n${p.say}`;
}

async function main() {
  const args = process.argv.slice(2);
  if (!args.length) usage();
  let lessonArg;
  if (args[0] === '--file') {
    if (!args[1] || !fs.existsSync(args[1])) { console.error('找不到教案文件：' + args[1]); process.exit(1); }
    lessonArg = fs.readFileSync(args[1], 'utf-8').trim();
    args.splice(0, 2);
  } else {
    lessonArg = String(args[0]);
    args.shift();
  }
  if (!lessonArg.includes('::')) usage();
  const i = lessonArg.indexOf('::');
  const LESSON = { title: lessonArg.slice(0, i).trim() || '未命名课', content: lessonArg.slice(i + 2).trim() };
  if (!LESSON.content) usage();
  const replies = args;
  const s = createSession(LESSON, { maxRounds: 5 });
  await s.start(noop, noop);
  for (const r of replies) {
    if (s.done) break;
    await s.reply(r, noop, noop);
  }
  if (s.done || replies.length >= 5) {
    const res = s.finish(noop, noop);
    const md = (res && res.teacherReportMd) || '';
    console.log('==== 下课 ====');
    console.log(`课题《${LESSON.title}》共 ${s.round} 轮，探测 ${s.probes.length} 枚`);
    if (md) {
      console.log('\n---- 《我的收获》（尾部三段是 Λ/Σ/Φ）----');
      console.log(md);
    }
    if (res && res.minutes && res.minutes.path) console.log('\n课堂纪要 → ' + res.minutes.path);
  } else {
    const last = s.probes[s.probes.length - 1];
    console.log(`已重放 ${replies.length} 个回答，课堂进行到第 ${s.round} 轮。`);
    console.log('\n' + fmtProbe(last) + '\n');
  }
}

main().catch((e) => { console.error('课堂启动失败：', e && e.message); process.exit(1); });
