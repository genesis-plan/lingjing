// 灵境 · 留存埋点（R-A1 数据层）
// --------------------------------------------------------------------------
// 为什么有这一层：R1「全球刚需」是假设非已证。唯一判据是「陌生人是否自发二次到访」
// （见 灵境-四框架融合与推演.md §G）。要算这个，必须先能跨次识别同一个陌生人——
// 但不建账号、不碰区块链（与「价值在体验非资产」划界一致）。
//
// 方案：每个浏览器一个匿名 lid（16 hex，HttpOnly 1 年 cookie）。它不是身份档案，
// 只是「这次和上次是不是同一个人」的去重键。留存分析只服务于 R1 验证，
// 是**运营方离线脚本**（tools/retention_report.js）读的东西，**绝不进用户屏幕**
// （与 §8 指标隔离红线一致）。
//
// 日志是 append-only 事件流（event-sourced，见数学框架 §13），与 world.save 同源思路：
// 只增不删，可重放、可审计。recordVisit 失败绝不阻断课堂（fail-closed 精神）。

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const RETENTION_FILE = path.join(__dirname, 'sessions', 'retention.jsonl');

// 从请求读匿名 id；无则生成并通过 res 下发 Set-Cookie（须在 writeHead 前调用）。
// 返回 { id, header, tracked }：
//   header 为 null 表示已有 cookie、无需重设；
//   tracked=false 表示用户选择「请勿追踪」(DNT)，本次不置 cookie、也不记留存（彻底退出 R1 追踪）。
//   secure=true（经 HTTPS 终止）时给 cookie 加 Secure 属性，防明文链路窃听。
//
// 隐私姿态（R-A5）：第一方 + 随机 16hex + 不跨站 + 不第三方，同 Matomo/ENISA 匿名访客 ID；
// 浏览器发 DNT:1 即视为明确退出，绝不偷偷追踪。
function getStrangerId(req, res, secure) {
  const dnt = (req.headers && (req.headers['dnt'] || req.headers['do-not-track'])) || '';
  if (dnt === '1' || String(dnt).toLowerCase() === 'yes') {
    // 彻底不追踪：生成一次性临时 id（不落盘、不置 cookie），tracked=false 让调用方跳过重访记录
    return { id: 'dnt-' + crypto.randomBytes(6).toString('hex'), header: null, tracked: false };
  }
  const cookie = (req.headers && req.headers['cookie']) || '';
  const m = cookie.match(/(?:^|;\s*)lid=([a-f0-9]{16})/);
  if (m) return { id: m[1], header: null, tracked: true };
  const id = crypto.randomBytes(8).toString('hex'); // 16 hex 字符
  const header = `lid=${id}; Max-Age=31536000; Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
  if (res && typeof res.setHeader === 'function') {
    res.setHeader('Set-Cookie', header); // 在 writeHead 之前设置才能随响应发出
  }
  return { id, header, tracked: true };
}

// 开课即记一行。kind 区分入口（start=会话式闭环 / teach=一键跑满）。
// title 只截前 120 字，仅用于运营回溯，不进任何用户可见界面。
function recordVisit(strangerId, lessonTitle, kind) {
  if (!strangerId) return;
  try {
    fs.mkdirSync(path.dirname(RETENTION_FILE), { recursive: true });
    const row = {
      ts: Date.now(),
      id: String(strangerId),
      kind: String(kind || 'event'),
      title: String(lessonTitle || '').slice(0, 120),
    };
    fs.appendFileSync(RETENTION_FILE, JSON.stringify(row) + '\n');
  } catch (e) {
    // 留存失败绝不阻断课堂（fail-closed：观测缺失 ≠ 课堂失败）
  }
}

module.exports = { getStrangerId, recordVisit, RETENTION_FILE };
