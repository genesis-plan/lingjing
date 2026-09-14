// 浏览器真机冒烟测试（CDP 驱动，零依赖）
// 为什么需要它：静态 HTML/DOM 校验看不出"点下去会发生什么"。这个脚本用 Edge 的 DevTools 协议
// 真的打开页面、真的点按钮、真的截图 —— 用来验证「一打开就是教室 → 点开始上课 → 学生开口 → 下课出作品」
// 这条主链路在浏览器里是通的（而不是只在 Node 里测过后端契约）。
//
// 用法：
//   node tools/smoke_browser.mjs                       # 只验课前状态 + 截图
//   node tools/smoke_browser.mjs --class                # 再点"随手一课"跑一堂课并截图
//   LJ_URL=http://127.0.0.1:8080/classroom.html LJ_OUT=shots/ node tools/smoke_browser.mjs
// 前置：先启动 node server.js

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const URL_ = process.env.LJ_URL || 'http://127.0.0.1:8080/classroom.html';
const OUT = process.env.LJ_OUT || path.join(os.tmpdir(), 'lj-smoke');
const PORT = Number(process.env.LJ_CDP_PORT) || 9223;
const RUN_CLASS = process.argv.includes('--class');
const EDGE = process.env.LJ_EDGE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

fs.mkdirSync(OUT, { recursive: true });
const profile = path.join(os.tmpdir(), 'lj-smoke-profile-' + Date.now());

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg, extra = '') => { console.log((c ? '  ✅ ' : '  ❌ ') + msg + (extra ? '   ' + extra : '')); if (!c) fails++; };

// ---- CDP 极简客户端 ----
let ws, nextId = 1;
const pending = new Map();
const events = [];
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
  // 等 CDP 端口起来
  let target = null;
  for (let i = 0; i < 40 && !target; i++) {
    await sleep(300);
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
    } catch (e) { /* 还没起来 */ }
  }
  if (!target) throw new Error('Edge CDP 起不来（检查 --remote-debugging-port 是否被占用）');

  ws = new WebSocket(target.webSocketDebuggerUrl);
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id); pending.delete(m.id);
      m.error ? rej(new Error(m.error.message)) : res(m.result);
    } else if (m.method) events.push(m);
  });
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });

  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.navigate', { url: URL_ });
  await sleep(2500);   // 等 boot() 把学生摆好

  console.log('【1】一打开就是教室（不是文字面板）');
  ok(!(await evaluate('!!document.getElementById("setup")')), '没有全屏 setup 文字面板');
  ok((await evaluate('document.querySelectorAll("#cast .stu").length')) === 5, '5 名学生已在教室里');
  const figsOk = await evaluate('Array.from(document.querySelectorAll("#cast .stu .fig")).every(i=>i.complete && i.naturalWidth>0)');
  ok(figsOk, '5 张立绘都真的加载出来了（不是碎图）');
  ok((await evaluate('document.getElementById("fg").style.opacity')) === '1', '前景遮挡层已就位（学生被课桌挡住）');
  const pos = await evaluate(`(()=>{const a=Array.from(document.querySelectorAll('#cast .stu')).map(e=>Math.round(parseFloat(e.style.left))+','+Math.round(parseFloat(e.style.top))+','+Math.round(parseFloat(e.style.height)));
    return a.join(' | ')})()`);
  console.log('    位置: ' + pos);
  ok((await evaluate('getComputedStyle(document.querySelector("#cast .stu .fig")).animationName')) === 'bob', '立绘有轻微呼吸动画（CSS 动画，非 rAF 循环）');
  ok((await evaluate('!!window.__ERR && window.__ERR.length===0')), '页面无 JS 错误', JSON.stringify(await evaluate('window.__ERR')));
  const st = await evaluate('document.getElementById("status").textContent');
  console.log('    状态条: ' + st);
  await shot('01-课前');

  if (RUN_CLASS) {
    console.log('\n【2】点"随手一课"→ 真的上一堂课');
    await evaluate('document.querySelector("#quick a[data-demo]").click()');
    await sleep(3000);
    const bubbles = await evaluate('document.querySelectorAll("#cast .stu .bub.show").length');
    const plate = await evaluate('Array.from(document.querySelectorAll("#cast .stu .pc")).map(e=>e.textContent).join(" / ")');
    console.log('    头顶: ' + plate);
    ok(bubbles >= 1, '有学生正在发言（对话泡出现）', '气泡数 ' + bubbles);
    const hasMis = await evaluate('Array.from(document.querySelectorAll("#cast .stu .bub")).some(b=>b.textContent.includes("进课堂前以为"))');
    ok(hasMis, '对话泡里带出了「他进课堂前以为…」（前概念）');
    // 学生头顶必须是人话状态词，不许出现百分比
    ok(/还没开口|还在琢磨|有点明白|明白多了|通了/.test(plate), '学生头顶写的是人话状态（不是数字）');
    ok(!/%/.test(plate), '学生头顶没有百分比');
    await shot('02-上课中');

    // 等这一轮跑完 → 讲台条应切成"回答"
    // 注意：不能用界面文案当信号（文案是给人看的，随时会改）。
    // 改读 #stage 上的机器可读状态 data-phase / data-round（见 classroom.html setPhase）。
    const phaseOf = async () => await evaluate('document.getElementById("stage").dataset.phase');
    const roundOf = async () => await evaluate('document.getElementById("stage").dataset.round');
    const workOn = async () => (await phaseOf()) === 'done';
    const waitPhase = async (want, tries) => {
      for (let i = 0; i < tries; i++) { await sleep(1000); if (await phaseOf() === want) return true; }
      return false;
    };
    await waitPhase('reply', 40);
    ok((await phaseOf()) === 'reply', '学生说完 → 轮到你回答（data-phase=reply）');
    const st2 = await evaluate('document.getElementById("status").textContent');
    console.log('    状态条: ' + st2);
    ok(/该你了|问完了/.test(st2), '状态条说的是课堂正在发生什么，不是开发日志');
    const modeTxt = await evaluate('document.getElementById("mode").textContent');
    console.log('    角标: ' + modeTxt);
    ok(/预演模式|真 AI 学生|AI 学生/.test(modeTxt), '角落角标如实说明 AI 学生是否真的在场');
    await shot('03-等你回话');

    console.log('\n【3】老师回话 ×3 → 自动下课 → 出作品');
    for (let i = 0; i < 3; i++) {
      await evaluate('document.getElementById("sayText").value="叶子发黄是缺光或缺水，不是缺肥；阳光只是能量的来源，不是饭。"');
      await evaluate('document.getElementById("sendBtn").click()');
      // 等到"离开 reply"再"回到 reply 或 done"，才算这一轮真的跑完
      for (let k = 0; k < 8; k++) { await sleep(1000); if ((await phaseOf()) !== 'reply') break; }
      for (let k = 0; k < 60; k++) { await sleep(1000); const p = await phaseOf(); if (p === 'reply' || p === 'done') break; }
      if (await workOn()) break;
    }
    for (let k = 0; k < 45; k++) { await sleep(1000); if (await workOn()) break; }
    ok(await workOn(), '下课后弹出作品面板');
    const mdLen = await evaluate('document.getElementById("wkMd").textContent.trim().length');
    ok(mdLen > 60, '《课堂纪要》渲染出来了', mdLen + ' 字');
    const human = await evaluate('document.getElementById("wkHuman").textContent');
    console.log('    你的收获（人话版）: ' + human.replace(/\s+/g, ' ').trim());
    ok(/你讲出了/.test(human) && !/R̄|σ²|V\(s\)|完整度/.test(human), '收获说的是人话，不是指标格');

    // ★ 核心产品断言：课堂上不许出现内部数据
    const visible = await evaluate('document.body.innerText');
    const jargon = ['R̄', 'σ²', '课堂熵', '走真 LLM', '完整度', 'V(s)', '重放', '已落盘', 'sessions/'];
    const leaked = jargon.filter((j) => visible.includes(j));
    ok(leaked.length === 0, '屏幕上没有任何内部指标泄漏', leaked.length ? '泄漏: ' + leaked.join(',') : '');
    ok(!(await evaluate('document.getElementById("drawer").classList.contains("on")')), '数据抽屉默认收起');
    await shot('04-课堂纪要作品');

    // 但数据一个没删：点开抽屉应该全都在
    await evaluate('document.getElementById("dataBtn").click()');
    await sleep(400);
    const drawTxt = await evaluate('document.getElementById("dRaw").textContent');
    ok(/R̄=/.test(drawTxt) && /σ²=/.test(drawTxt) && /V\(s\)=/.test(drawTxt), '点开后内部数据一件不少（R̄/σ²/V(s)）');
    ok(/AI 学生状态：llm=/.test(drawTxt), '抽屉里如实记录了 AI 学生状态（机器可查）');
    ok(/学生发言来源：/.test(drawTxt), '抽屉里如实记录了学生发言的来源');
    // 抽屉在折叠区下方 → 先滚过去再拍，否则截图里根本没有它（截图必须拍到它名字所说的东西）
    await evaluate('document.getElementById("drawer").scrollIntoView({block:"end"})');
    await sleep(500);
    await shot('05-点开的课堂数据');
    ok((await evaluate('window.__ERR.length===0')), '整堂课无 JS 错误', JSON.stringify(await evaluate('window.__ERR')));
  }
} catch (e) {
  console.error('❌ 冒烟失败：' + (e && e.message || e));
  fails++;
} finally {
  try { ws && ws.close(); } catch (e) {}
  try { edge.kill(); } catch (e) {}
  await sleep(400);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
}

console.log('\n' + (fails ? fails + ' 项未通过 ❌' : '全部通过 ✅') + '   截图在 ' + OUT);
process.exit(fails ? 1 : 0);
