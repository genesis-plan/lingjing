// 灵境 · 留存分析（运营方离线脚本，非用户可见）
// --------------------------------------------------------------------------
// 把 sessions/retention.jsonl 的匿名开课事件，算成 R1「全球刚需」的判别证据：
//   · 陌生人去重总数
//   · 自发二次到访率（开课 ≥2 次 / 去重总数）
//   · Kaplan–Meier 风格生存表：首次开课起第 d 天仍「未自发回访」的比例
//     （比例越低 = 留存越好 = R1 信号越强）
//
// 诚实标注：本脚本只给运营方看，绝不进用户屏幕（§8 指标隔离）。
// 样本过小（<5 名陌生人）时明确说 R1 仍不可证——不把噪声当结论。
//
// 用法： node tools/retention_report.js

'use strict';
const fs = require('fs');
const path = require('path');
const { RETENTION_FILE } = require('../retention.js');

const DAY = 86400000;

function load() {
  if (!fs.existsSync(RETENTION_FILE)) return [];
  return fs.readFileSync(RETENTION_FILE, 'utf8')
    .split('\n').filter((l) => l.trim())
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean)
    .filter((r) => r.kind === 'class_start' || r.kind === 'start'); // 两种开课入口都算
}

function main() {
  const rows = load();
  if (!rows.length) {
    console.log('暂无留存数据：还没有陌生人开过课（retention.jsonl 为空）。');
    console.log('R1 状态：不可证（无数据）。先让人用起来再来看这条曲线。');
    return;
  }

  const byId = new Map();
  for (const r of rows) {
    if (!byId.has(r.id)) byId.set(r.id, []);
    byId.get(r.id).push(r.ts);
  }
  const ids = [...byId.keys()];
  const total = ids.length;
  const returned = ids.filter((id) => byId.get(id).length >= 2);
  const returnRate = returned.length / total;

  console.log('=== 灵境 · 留存分析（R1 判据）===');
  console.log(`陌生人总数（去重） : ${total}`);
  console.log(`开课 ≥2 次（自发回访）: ${returned.length}`);
  console.log(`二次到访率           : ${(returnRate * 100).toFixed(1)}%`);

  // 首次 / 二次到访时间戳
  const firstTs = new Map();
  const secondTs = new Map();
  for (const id of ids) {
    const ts = byId.get(id).slice().sort((a, b) => a - b);
    firstTs.set(id, ts[0]);
    if (ts.length >= 2) secondTs.set(id, ts[1]);
  }

  // 生存表：第 d 天仍「未自发回访」的比例（越低越好）
  console.log('\n生存表（首次开课 → 第 d 天仍未自发回访的比例）:');
  console.log('day\tsurvive_not_returned');
  for (let d = 0; d <= 30; d += (d < 7 ? 1 : (d < 14 ? 2 : 4))) {
    let notReturned = 0;
    for (const id of ids) {
      const f = firstTs.get(id);
      const s = secondTs.get(id);
      const cutoff = f + d * DAY;
      if (!s || s > cutoff) notReturned++;
    }
    console.log(`${d}\t${(notReturned / total).toFixed(3)}`);
  }

  console.log('\n诚实结论:');
  if (total < 5) {
    console.log('  样本过小（<5 名陌生人）：R1「全球刚需」仍不可证——继续采集，别把噪声当结论。');
  } else if (returnRate === 0) {
    console.log('  零自发回访：R1 出现证伪信号——灵境可能只是作者自我感动，非真刚需。');
    console.log('  建议：先小范围找真人试，别急着堆硬件（呼应 R4）。');
  } else {
    console.log('  存在自发回访：R1 有真实信号，可推进阶段 B/C；但样本仍小，持续观测。');
  }
}

main();
