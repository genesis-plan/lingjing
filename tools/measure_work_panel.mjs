// 量课后面板：到底要滚几屏？哪一块最占地方？
// 用途：判断"界面变成文字"是不是真的 —— 用数字说话，不靠感觉。
const URL_ = process.env.LJ_URL || 'http://127.0.0.1:8080/classroom3d.html';
const PORT = 9232;
const fs = await import('node:fs');
const path = await import('node:path');
const os = await import('node:os');
const { spawn } = await import('node:child_process');

const CAND = [process.env.LJ_EDGE, 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].filter(Boolean);
const EDGE = CAND.find((p) => { try { return fs.existsSync(p); } catch { return false; } });
const profile = path.join(os.tmpdir(), 'lj-measure-' + Date.now());
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

  // ---- 打开时：3D 课室占多大 ----
  const openInfo = await evaluate(`(()=>{
    const c = document.querySelector('canvas');
    const r = c ? c.getBoundingClientRect() : null;
    return { vw: innerWidth, vh: innerHeight,
      canvas: r ? {w:Math.round(r.width),h:Math.round(r.height)} : null,
      teacherBar: (()=>{const b=document.querySelector('#askbar .bar'); const q=b.getBoundingClientRect();
        return {w:Math.round(q.width),h:Math.round(q.height),bottom:Math.round(innerHeight-q.bottom)};})(),
      aiNote: (()=>{const n=document.getElementById('aiNote'); const q=n.getBoundingClientRect();
        return {w:Math.round(q.width),h:Math.round(q.height),area:+(q.width*q.height/(innerWidth*innerHeight)*100).toFixed(1)};})(),
      metricsVisible: getComputedStyle(document.getElementById('metrics')).display !== 'none'
    };})()`);
  console.log('【打开时】视口 ' + openInfo.vw + 'x' + openInfo.vh + '，3D 画布 ' + JSON.stringify(openInfo.canvas));
  console.log('  讲台条 ' + JSON.stringify(openInfo.teacherBar) + '，AI 提示占屏 ' + openInfo.aiNote.area + '%');

  // ---- 跑完一课 ----
  // 流程（和界面一致）：点随手一课 → 进课前探索 → 两次尝试 → 开讲 → 学生问到你 → 课后
  const DEMO = '光合作用::阳光不是植物的「饭」，它只是能量的来源；植物真正吃的是自己用光和水造出来的糖。叶子发黄，多半不是缺肥，而是缺光或水太多。';
  await evaluate('document.querySelector("#chips a[data-demo]").click()');
  await sleep(1500);
  // 这里只为量课后面板，课前探索直接跳过（对照块的"有内容"形态由 test_panel_browser 覆盖）
  const probeOn = await evaluate('document.getElementById("probe").classList.contains("on")');
  if (probeOn) {
    await evaluate('document.getElementById("pSkip").click()');
    await sleep(1200);
  }
  // preready 阶段要再发一次才真正开讲
  await evaluate(`(()=>{const t=document.getElementById("replyText");t.value=${JSON.stringify(DEMO)};document.getElementById("replySend").click();})()`);
  await sleep(3000);
  let done = false, t = 0;
  while (!done && t < 240) {
    await sleep(2000); t += 2;
    const canSkip = await evaluate('(()=>{const b=document.getElementById("replySkip"); return b && b.offsetParent!==null && getComputedStyle(b).display!=="none";})()');
    if (canSkip) await evaluate('document.getElementById("replySkip").click()');
    done = await evaluate('document.getElementById("work").classList.contains("on")');
  }
  if (!done) throw new Error('课后没出来（等 ' + t + 's 超时）—— 下面的数字不可信');
  await sleep(1500);

  // ---- 量课后面板 ----
  const m = await evaluate(`(()=>{
    const work = document.getElementById('work');
    const box = work.querySelector('.scroll');
    const H = (el) => el ? Math.round(el.getBoundingClientRect().height) : null;
    const sec = (sel) => { const e = box.querySelector(sel); return e ? Math.round(e.getBoundingClientRect().height) : 0; };
    const blocks = {
      '纪要正文 #wkMd': sec('#wkMd'),
      '我的收获 .gains': sec('.gains'),
      '技能卡片组 .deckwrap': sec('.deckwrap'),
      '最后一课总结 .sumwrap': sec('.sumwrap'),
      '课前对照 .prewrap': sec('.prewrap'),
      '顿悟峰 .peakwrap': sec('.peakwrap'),
      '知识库 .jwrap': sec('.jwrap'),
      '按钮排 .acts': sec('.acts')
    };
    const contentH = box.scrollHeight;
    const visH = work.clientHeight;
    return { contentH, visH, screens: +(contentH/visH).toFixed(2), blocks,
      textLen: (box.innerText||'').length,
      charsPerScreen: Math.round((box.innerText||'').length/(contentH/visH)) };
  })()`);
  console.log('【课后面板】内容高 ' + m.contentH + 'px，可见 ' + m.visH + 'px → 要滚 ' + m.screens + ' 屏');
  console.log('  正文字数 ' + m.textLen + '，平均每屏约 ' + m.charsPerScreen + ' 字');
  const total = m.contentH;
  Object.entries(m.blocks).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => {
    console.log('  ' + String(v).padStart(5) + 'px  ' + ((v / total) * 100).toFixed(0).padStart(3) + '%   ' + k);
  });
} catch (e) {
  console.error('❌ ' + (e && e.message || e));
  process.exitCode = 1;
} finally {
  try { ws && ws.close(); } catch {}
  try { edge.kill(); } catch {}
  await sleep(400);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
}
