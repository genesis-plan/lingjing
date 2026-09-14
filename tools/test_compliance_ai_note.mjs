// 合规回归测试：AI 身份显著提示（#aiNote）
// 依据：《人工智能拟人化互动服务管理暂行办法》要求向公众提供模拟人类人格的服务时，
//       须**显著提示**用户"正在与人工智能而非自然人交互"。
// 为什么必须真机跑：提示可能被 display:none / 被别的浮层盖住 / 被顶到屏幕外 —— 静态看代码看不出来。
// 同时验证它**不挡人**：与讲台输入条、标题几何不相交，且 pointer-events:none。
//
// 前置：node server.js 已在跑（默认 127.0.0.1:8080）。零依赖，CDP 驱动 Edge。
// 用法：node tools/test_compliance_ai_note.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const URL_ = process.env.LJ_URL || 'http://127.0.0.1:8080/classroom3d.html';
const OUT = process.env.LJ_OUT || path.join(os.tmpdir(), 'lj-compliance');
const PORT = Number(process.env.LJ_CDP_PORT) || 9225;
const CAND = [
  process.env.LJ_EDGE,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean);
const EDGE = CAND.find((p) => { try { return fs.existsSync(p); } catch { return false; } });
if (!EDGE) { console.log('❌ 找不到 Edge，可用 LJ_EDGE=<path> 指定'); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });
const profile = path.join(os.tmpdir(), 'lj-compliance-profile-' + Date.now());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let fails = 0;
const ok = (c, m, extra = '') => { console.log((c ? '  ✅ ' : '  ❌ ') + m + (extra ? '   ' + extra : '')); if (!c) fails++; };

let ws, nextId = 1; const pending = new Map();
function send(method, params = {}) {
  const id = nextId++;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((res, rej) => {
    pending.set(id, { res, rej });
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('CDP 超时: ' + method)); } }, 30000);
  });
}
async function evaluate(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text || 'eval 异常');
  return r.result && r.result.value;
}
async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  const p = path.join(OUT, name + '.png');
  fs.writeFileSync(p, Buffer.from(r.data, 'base64'));
  console.log('  📷 ' + p);
}

const edge = spawn(EDGE, [
  '--headless=old', '--disable-gpu', '--no-sandbox', '--disable-extensions',
  '--remote-debugging-port=' + PORT, '--window-size=1440,900',
  '--user-data-dir=' + profile, 'about:blank',
], { stdio: 'ignore' });

try {
  let target = null;
  for (let i = 0; i < 40 && !target; i++) {
    await sleep(300);
    try { const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); target = list.find((t) => t.type === 'page'); } catch {}
  }
  if (!target) throw new Error('Edge CDP 起不来');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id); pending.delete(m.id);
      m.error ? rej(new Error(m.error.message)) : res(m.result);
    }
  });
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.navigate', { url: URL_ });
  await sleep(3000);

  console.log('【1】AI 身份提示真的在屏幕上');
  ok(await evaluate('!!document.getElementById("aiNote")'), '#aiNote 元素存在');
  const box = await evaluate(`(()=>{const e=document.getElementById('aiNote');const r=e.getBoundingClientRect();
    const cs=getComputedStyle(e);return {x:r.left,y:r.top,w:r.width,h:r.height,display:cs.display,vis:cs.visibility,op:cs.opacity,pe:cs.pointerEvents,pe2:getComputedStyle(e.parentElement).pointerEvents};})()`);
  ok(box.display !== 'none' && box.vis !== 'hidden' && Number(box.op) > 0.5, '可见（非 display:none / hidden / 透明）', `opacity=${box.op}`);
  ok(box.w > 100 && box.h > 20, '有实际尺寸（没被压成 0）', `${Math.round(box.w)}x${Math.round(box.h)}`);
  ok(box.x >= 0 && box.y >= 0 && box.x + box.w <= 1440 && box.y + box.h <= 900, '完整落在视口内（没被顶出屏幕）', `x=${Math.round(box.x)} y=${Math.round(box.y)}`);

  console.log('\n【2】文案说清了「在和 AI 交互、不是真人」');
  const txt = (await evaluate('document.getElementById("aiNote").textContent')).replace(/\s+/g, ' ').trim();
  console.log('    文案: ' + txt);
  ok(/AI|人工智能/.test(txt), '点明了 AI 身份');
  ok(/不是真人|非真人/.test(txt), '点明了「不是真人」');
  ok(/算法|模型生成/.test(txt), '说明课后反馈由算法生成（不冒充客观测评）');
  ok(/不能替代|不替代/.test(txt), '提示不替代真人老师/同学（不割裂现实人际关系）');

  console.log('\n【3】它不挡人（体验铁律：一打开就是教室、绝不立挡板）');
  ok(box.pe === 'none' || box.pe2 === 'none', '不接收鼠标事件（点得到下面的东西）', `pe=${box.pe}`);
  // 讲台输入条默认 display:none，强制点亮后再测几何，否则"不重叠"是假绿
  const clash = await evaluate(`(()=>{
    const n=document.getElementById('aiNote').getBoundingClientRect();
    document.getElementById('askbar').classList.add('on');
    const rs={};
    for(const id of ['askbar','top']){
      const e=document.getElementById(id); const r=e.getBoundingClientRect();
      rs[id]=Math.max(0,Math.min(n.right,r.right)-Math.max(n.left,r.left))>0 &&
             Math.max(0,Math.min(n.bottom,r.bottom)-Math.max(n.top,r.top))>0;
    }
    document.getElementById('askbar').classList.remove('on');
    return rs;})()`);
  ok(!clash.askbar, '与讲台输入条不重叠（上课时也挡不住你说话）');
  ok(!clash.top, '与顶部标题不重叠');
  ok(!(await evaluate('!!document.getElementById("setup")')), '没有全屏挡板（不是弹窗式同意书）');

  console.log('\n【4】没有情感依赖诱导（合规红线）');
  const body = await evaluate('document.body.innerText');
  const bait = ['离不开', '想你', '需要你', '陪着我', '陪着你', '别走', '舍不得', '只有你懂', '一直等你', '舍不得你', '孤单', '寂寞'];
  const hit = bait.filter((w) => body.includes(w));
  ok(hit.length === 0, '界面文案中无「离不开/想你/需要你」类依赖诱导', hit.length ? '命中: ' + hit.join(',') : '');

  ok((await evaluate('!window.__ERR || window.__ERR.length===0')), '页面无 JS 错误', JSON.stringify(await evaluate('window.__ERR||[]')));
  await shot('01-AI身份提示');
} catch (e) {
  console.error('❌ 合规测试失败：' + (e && e.message || e));
  fails++;
} finally {
  try { ws && ws.close(); } catch {}
  try { edge.kill(); } catch {}
  await sleep(400);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
}

console.log('\n' + (fails ? fails + ' 项未通过 ❌' : '全部通过 ✅') + '   截图在 ' + OUT);
process.exit(fails ? 1 : 0);
