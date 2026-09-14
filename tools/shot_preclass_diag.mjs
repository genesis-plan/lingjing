// 诊断截图：分别拍「一打开」「点了随手一课之后」两个状态 —— 用来判断界面是不是被文字盖住了。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const URL_ = process.env.LJ_URL || 'http://127.0.0.1:8080/classroom3d.html';
const OUT = process.env.LJ_OUT || path.join(os.tmpdir(), 'lj-diag');
const PORT = 9231;
const CAND = [process.env.LJ_EDGE, 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].filter(Boolean);
const EDGE = CAND.find((p) => { try { return fs.existsSync(p); } catch { return false; } });
fs.mkdirSync(OUT, { recursive: true });
const profile = path.join(os.tmpdir(), 'lj-diag-profile-' + Date.now());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let ws, nextId = 1; const pending = new Map();
function send(method, params = {}) {
  const id = nextId++;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((res, rej) => { pending.set(id, { res, rej }); setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('CDP 超时 ' + method)); } }, 30000); });
}
async function evaluate(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text || 'eval 异常');
  return r.result && r.result.value;
}
async function shot(n) {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  const p = path.join(OUT, n + '.png'); fs.writeFileSync(p, Buffer.from(r.data, 'base64'));
  console.log('  📷 ' + p);
}

const edge = spawn(EDGE, ['--headless=old', '--disable-gpu', '--no-sandbox', '--disable-extensions',
  '--remote-debugging-port=' + PORT, '--window-size=1440,900', '--user-data-dir=' + profile, 'about:blank'], { stdio: 'ignore' });

try {
  let target = null;
  for (let i = 0; i < 40 && !target; i++) {
    await sleep(300);
    try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); target = l.find((t) => t.type === 'page'); } catch {}
  }
  if (!target) throw new Error('Edge CDP 起不来');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); } });
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.navigate', { url: URL_ });
  await sleep(3500);

  console.log('【A】一打开页面');
  await shot('A-一打开');

  console.log('【B】点"随手一课"之后（课前探针出现）');
  await evaluate('document.querySelector("#chips a[data-demo]").click()');
  await sleep(1200);
  await shot('B-点了随手一课');
  const probeBox = await evaluate(`(()=>{const e=document.getElementById('probe');const r=e.getBoundingClientRect();
    return {w:Math.round(r.width),h:Math.round(r.height),top:Math.round(r.top),bottom:Math.round(r.bottom),vis:e.classList.contains('on')};})()`);
  console.log('    探针卡尺寸: ' + JSON.stringify(probeBox) + '  视口 1440x900');
  const area = (probeBox.w * probeBox.h) / (1440 * 900);
  console.log('    占屏面积: ' + (area * 100).toFixed(1) + '%');

  console.log('【C】课后面板：量一下文字块总高度 vs 课室可见区');
  await evaluate('document.getElementById("replyText").value = "我觉得阳光对植物来说是能量的来源，因为植物要靠光能制造糖，没有阳光就没能量。"');
  await evaluate('document.getElementById("replySend").click()'); await sleep(600);
  await evaluate('document.getElementById("replyText").value = "我猜叶子发黄是缺水，水少了就造不出糖，叶子就黄了。也可能是光照不够。"');
  await evaluate('document.getElementById("replySend").click()'); await sleep(600);
  await evaluate('document.getElementById("replyText").value = "光合作用::阳光不是植物的「饭」，它只是能量的来源；植物真正吃的是自己用光和水造出来的糖。叶子发黄多半不是缺肥，而是缺光或水太多。"');
  await evaluate('document.getElementById("replySend").click()'); await sleep(6000);
  let done = false, t = 0;
  while (!done && t < 120) {
    await sleep(2000); t += 2;
    const canSkip = await evaluate('(()=>{const b=document.getElementById("replySkip"); return b && b.offsetParent!==null && getComputedStyle(b).display!=="none";})()');
    if (canSkip) await evaluate('document.getElementById("replySkip").click()');
    done = await evaluate('document.getElementById("work").classList.contains("on")');
  }
  await sleep(1500);
  await evaluate('document.getElementById("work").scrollTop = 0');
  await sleep(600);
  await shot('C-课后第一屏');
  const workH = await evaluate('document.getElementById("work").scrollHeight');
  const visH = await evaluate('document.getElementById("work").clientHeight');
  console.log('    课后面板：内容高 ' + workH + 'px，可见 ' + visH + 'px → 要滚 ' + (workH / visH).toFixed(1) + ' 屏');
} catch (e) {
  console.error('❌ ' + (e && e.message || e));
} finally {
  try { ws && ws.close(); } catch {}
  try { edge.kill(); } catch {}
  await sleep(400);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
}
